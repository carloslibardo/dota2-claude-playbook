# 1. Why This Is Hard

## The video that proved nothing

Late on a Saturday, an agent handed back a finished deliverable. It had run a full match
inside a cloud GPU virtual machine, recorded the whole thing to an mp4, parsed the console
log, and reported success. The evidence looked airtight. The log said:

```
SHOWCASE RESULT: shown=42/42
[DIRECTOR] roaming camera engaged
```

Forty-two out of forty-two class-and-slot combinations demonstrated. The director camera
engaged. Every marker the harness was designed to look for was present and correct. The
agent wrote "verified and delivered."

Then the human opened the video.

The camera had not moved. Not once, for the entire match. The recording was several minutes
of empty terrain with a caption strip cycling ability names over the top of nothing, while
somewhere off-screen ten bots fought a match nobody filmed. The reply came back:

> `also the video full didnt showed the camera of user - even the skills being used — its useless`

And, a day later, sharper:

> `did u reviewed the video? I didn't found any test that literally use W or R to show the hook effect of skills — neither the itens buyed … analyze and see full videos to see what you produced as evidence. I'm pretty confident that u didn't made it worked.` [sic]

There were two bugs, and both of them were invisible to logs by construction.

The first was a convar. The run was supposed to be driven by `archer_wars_e2e_showcase`, a
flag read at startup to switch the game into showcase mode. That convar had never been
registered with the engine. An unregistered convar does not error — it reads as `0`. So the
game quietly ran the ordinary combat loop instead of the showcase, while the showcase code
path that printed `shown=42/42` ran anyway, off to the side, describing a demonstration that
was not happening.

The second was the camera. The "look at this hero" instruction was being routed to the client
through a net table, and in practice it left the camera parked on an empty field — and in
match mode, parked on the idle recording host about half the time.

Neither bug could have been caught by reading the log, because both bugs produced *correct
log output*. That is the sentence to sit with. The verification was not sloppy. It was
structurally incapable of detecting the failure it was aimed at.

The review file written after the fix put it plainly:

> **Two real bugs caught by FRAME review (not logs).** The logs said 'shown=42/42 / director
> engaged' — but watching the frames caught two defects the logs hid, exactly the miss that
> got the prior deliverable rejected.

This chapter is about why game-engine work generates that failure mode over and over, in a
way that ordinary software work mostly does not.

---

## 1.1 There is no CI you can run the engine in

Start with the structural problem. Most of what makes agentic coding work is a fast, cheap,
truthful oracle: you change something, a test suite runs in seconds, and it tells you whether
you broke anything. The agent can iterate against that oracle a hundred times without a human
in the loop. That is the entire trick.

A Dota 2 custom game has no such oracle. To run the game you need:

- a GPU with a real display head,
- a logged-in Steam session with Steam Guard satisfied,
- a multi-gigabyte install of Dota 2 *plus* a separate multi-gigabyte install of the Workshop
  Tools,
- Windows,
- and several minutes of patience per run.

None of that fits inside a GitHub Actions runner. There is no headless mode. There is no
`dota2 --run-tests`. The engine is a closed binary that boots, renders, plays, and prints to
a console log.

We ended up building the oracle ourselves: a GCP Windows VM with a T4 GPU, provisioned to
launch the game in tools mode, play a full autonomous bot match, record it, scan its own
console log, and ship the results back. It works, and [chapter 6](06-autonomous-vm-rig.md)
documents the whole thing. But be honest about the cost of that lane before you start:

| Step | Time |
|---|---|
| Cold VM boot | ~3 min |
| Sync + compile + resource compile | ~10 min |
| One recorded match | ~13 min |

That is your inner loop when the fast lane can't answer. In the same wall-clock time, a normal
web project runs its test suite several hundred times. Across the whole project we accumulated
46 recorded VM runs — a number that sounds small until you multiply it by thirteen minutes and
add the failures.

Everything else in this playbook is downstream of that asymmetry. The engineering task is not
"write a Dota game." It is "arrange your project so the vast majority of questions can be
answered without booting the engine, and so the few that can't are answered with evidence
strong enough that you only have to ask once."

## 1.2 Engine APIs fail by doing nothing

In application code, a wrong call usually throws. In engine code, a wrong call very often
succeeds at nothing.

Four examples from our first week, all of which cost hours:

**`MoveToPosition` to an unpathable point.** No error, no warning, no log line. The order is
accepted and the unit does not move. Symptom, from a playtest: *nine bots stood idle for six
or more minutes with zero kills.* The bots' brains were fine. They were issuing move orders
to points just past the arena's rim wall, and the engine was silently discarding every one.

**An unregistered convar reads as `0`.** The bug from the opening story. There is no
"unknown convar" diagnostic to trip over.

**`override_hero` does not register a spawnable unit name.** We defined custom archer heroes
in `npc_heroes_custom.txt` using the documented override mechanism, precached them, verified
the KV parsed, verified the compiled Lua was present. The engine's response, at spawn time:
`ReplaceHeroWith failed as the unit npc_dota_hero_windrunner_custom is invalid.` A run
recorded *11 class locks, 0 heroes spawned*. Everything upstream reported success.

**A non-precached particle renders nothing.** Not an error. Not a magenta placeholder. Your
projectile is simply invisible, in a game whose entire design is projectiles.

The consequence for agentic work is specific and severe. An agent's default loop is: make a
change, run something, read the output, conclude. When the output of a broken thing is
indistinguishable from the output of a working thing, that loop terminates *confidently* in
the wrong place. The agent is not being careless. It is being fed a truthful-looking null.

The countermeasure, developed over the project and now rule 9, is to never call these APIs
bare. Wrap each one in a predicate you can test on your laptop, and log the resolved value at
boot so "it silently did nothing" becomes "it printed `pathable=false`". The full catalog of
twenty-five such landmines is [chapter 4](04-landmines.md).

## 1.3 The model will write plausible Dota that does not exist

Dota's scripting surface is large, versioned, partially documented, and heavily represented
in training data by community wikis of varying vintage. The result is a specific and very
recognizable failure: the agent writes code that looks exactly like correct Dota code and
references APIs that are not real.

The commit log carries these as a small genre of its own:

```
fix(modifiers): modifier_eagle_eye — ModifierState.TRUE_SIGHT doesn't exist
fix(systems): rewrite shopZone.ts to poll — trigger-touch events don't exist
```

`ModifierState.TRUE_SIGHT` is a perfectly plausible name. It is the name you would guess. It
sits next to a dozen real `ModifierState` members. It is not one of them. Likewise, a
trigger-touch event model is how you would build a shop zone in most engines; this engine does
not offer one, so `shopZone.ts` had to be rewritten to poll positions on a timer — an
architecture change forced by an API that was never there.

`Math.imul` broke the Lua build, because TypeScriptToLua doesn't support it. Five consecutive
`fix(...)` commits on day one were all corrections of invented or misremembered API names in
the freshly written content layer.

Two things helped, and neither is "use a smarter model."

The first is to make the uncertainty explicit *at planning time*. Our implementation plans
began carrying a section that split the API surface the plan intended to use into two lists:
names verified against the installed engine version (4.38.2), and names that were unverified.
Each unverified name shipped with an inline fallback. That converts a class of silent runtime
surprises into a checklist item somebody has to discharge.

The second is to let live runs beat documentation. In the hero-spawn saga, after four
hypotheses, the agent stopped guessing:

> "Everything structural checks out — abilities defined, ScriptFiles correct, compiled Lua
> present, hero KV clean, precache thorough. I've exhausted cheap inference. `unit is invalid`
> = engine has no unit registered under that `_custom` name despite a well-formed, precached
> `override_hero` entry. Docs say it *should* register; this project's live runs say it
> doesn't."

That is the right move and it is worth naming as a habit: when documentation and a live run
disagree, the live run wins, and the next action is a probe rather than a fifth theory.

## 1.4 Your CI platform is not your player's platform

We had a green quality gate. Ninety-four checks, zero failures, recorded on video, on the
Windows VM.

On the author's Mac, the same build produced **193 modifier-class errors** and a stream of:

```
Modifier script modifiers/modifier_grapple_pull failed to find class named modifier_grapple_pull
```

The cause: the retail macOS Dota client ships a Lua VM with no `debug` library and no working
`getfenv`. The TypeScript-to-Lua adapter uses `debug.getinfo` to place modifier classes into
the sandboxed scope the engine reads. So on macOS, *no Lua modifier ever applied at all* — the
grapple hook pulled nothing, the ice bow never chilled anything — and the engine reported this
as the wonderfully unhelpful `Script Runtime Error: error in error handling.`

Meanwhile the tools client on Windows, which keeps the `debug` library, was green.

This is not a Dota curiosity. It is the general shape of game work: the machine your automated
gate runs on differs from the machine your players use, in ways that are invisible until they
aren't. The honest response is not to pretend the gate covers everything. It is to write the
gap into the spec and keep a short manual checklist for it — which is what we did, and what
rule 10 encodes. The mechanical fix (a `debugPolyfill.ts` that shims `debug.traceback` and
deliberately *not* `debug.getinfo`) is [chapter 4, L1](04-landmines.md).

## 1.5 Visual correctness is not expressible as an assertion

Here is the deepest problem, and the one the opening story is really about.

Most of what makes a game good is visual, and almost none of it is assertable. Consider some
real acceptance questions from this project:

- Does the fire arrow *look* like fire?
- Can a player tell the three elemental bows apart mid-flight?
- Does the hook read as a hook — does it visibly grab a character and drag them?
- Is the camera looking at the fight?
- Does the frozen victim *look* frozen?

You cannot write `expect(arrowLooksLikeFire()).toBe(true)`. You can assert that a particle
system with a given path was created. You can assert that a modifier is applied. Both of those
can be true while the screen shows nothing at all, which is exactly what happened when a
non-precached particle rendered as empty air, and again when the scout owl shipped using
`models/development/invisiblebox.vmdl` — the player saw a floating health bar and the raw,
unlocalized string `#NPC_ARCHER_SCOUT_BIRD` hovering over literally nothing.

An agent has no eyes by default. It has a log. So every visual bug in this project arrived by
the same route: the log agreed with the code, the code agreed with the plan, and the human
looked at the screen and said no.

The escape is not to make the assertions cleverer. It is to change what counts as evidence.
By the end of the project the acceptance criterion for visual work was written into the spec
as a requirement:

> "Acceptance is frame review, never log-only claims."

and, for the reviewer:

> "The reviewer's standing instruction: produce evidence where the viewer literally **sees**
> the skill connect between two on-screen heroes… Anything less fails."

Concretely that means: run the match, record it, extract frames with ffmpeg — a sweep at one
frame per three seconds, plus dense 15fps windows over the moments that matter — and then
have the agent *read the PNG files*. Not parse them. Open them and look. A spec-004 acceptance
task reads, in full seriousness, "read `frames-dense/<bow>/` … grade SC-001 (4 distinguishable
projectiles) + SC-002 (flames / frozen / strikes, ≥2 consecutive frames each)."

The first time an agent did this and reported back, the sentence was:

> "I watched frames this time, all criteria."

It is a small sentence, and it is the whole thesis.

---

## 1.6 The thesis: build an evidence pipeline, not a better prompt

It is tempting to read the opening story as a model failure — the agent claimed something
false, therefore the agent is untrustworthy, therefore we need a better agent.

That reading is wrong, and acting on it produces nothing. The agent reported what its evidence
said. Its evidence was a log. The log was, in the strict sense, accurate: the showcase code
had indeed printed `shown=42/42`. Every step in the chain behaved correctly. The chain was
just not connected to the thing anybody cared about.

No amount of model capability fixes an evidence pipeline that cannot observe the failure mode.
A smarter agent reading the same log reaches the same conclusion, faster and with more
confidence. That is worse, not better.

What actually fixed it — and what collapsed the project's failure rate in its second week —
was a series of unglamorous changes to *what gets produced and inspected*:

1. **Convars get registered and their resolved values logged at boot**, so "the flag was off"
   is visible rather than inferred.
2. **The camera is driven server-side and locked to the acting hero**, so the recording is of
   the thing being demonstrated.
3. **Frames get extracted and read**, and frame review became a written acceptance criterion
   rather than an occasional good habit.
4. **A hang detector** compares the game clock against the wall clock, so a frozen run fails
   instead of quietly producing no counter-evidence.
5. **A quality gate** casts every ability of every class and buys every catalog item through
   the real shop event, asserts each at the *effect* level, records the whole thing, and emits
   one PASS/FAIL with timestamps that map into the video. It ended at 94 checks, 0 failures —
   and, importantly, it was validated by being pointed at two features we already knew were
   broken, to confirm it could go red at all.

None of that is model work. All of it is plumbing. It is the plumbing that made an
autonomous loop trustworthy in a domain where the default feedback signal lies by omission.

That is the argument of this playbook. Game-engine work breaks agentic coding not because the
model is weak but because the feedback is thin, silent, and frequently misleading. So you
build the feedback. Everything that follows — the toolchain, the spec loop, the landmines, the
purity rule, the VM rig, the bots, the casebook — is one part of that construction.

**Next:** [chapter 2, the toolchain in ten minutes](02-toolchain-in-10-min.md), or skip straight to
[chapter 11, the failure casebook](11-failure-casebook.md) if you want the rest of the
stories first.
