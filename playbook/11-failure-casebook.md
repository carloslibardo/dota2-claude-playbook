# 11. The Failure Casebook

Seventeen failures, told properly.

[Chapter 4](04-landmines.md) is the terse version — the landmine list, each entry a symptom, a
cause and a mechanical fix, written to be scanned in five minutes when something is broken.
This chapter is the other half: the same incidents as stories, with the quotes, the wrong
turns, and the rule each one bought.

The format is a pair. On the left, what happened. On the right, the generalizable rule. We
recommend reading it front to back once, because the failures compound — F1 makes F2 possible,
F8 makes F11 inevitable, and F12 is what happens when you fix deliverables instead of
pipelines three times in a row.

Where a failure has a mechanical counterpart in the landmine list, we say so.

---

<a id="f1"></a>
## F1 — The engine command that killed the process

**Story.** The headless smoke run died. Not crashed with a stack trace, not exited with an
error code we could read — the Dota process simply stopped existing. The harness's own report
line was `process alive at kill: False`, which is a polite way of saying the thing we were
supposed to kill had already died on its own, some time ago, for reasons nobody logged.

There was nothing to debug. No traceback, no error, no last log line that looked different
from the previous hundred. The console log just stopped.

What broke the deadlock was bisecting by *engine command* rather than by code. The harness
issued a small number of console commands at startup to seat bots into the empty player slots.
One of them was `dota_bot_populate`. Swapping it for `dota_create_fake_clients` produced:

> ✅ `process alive at kill: True` — the crash is GONE. `dota_create_fake_clients` did NOT
> crash (previous run: `False` = died at `dota_bot_populate`).

`dota_bot_populate` is unsupported in a laneless free-for-all map. It does not refuse. It takes
the process down.

**Rule.** **When a game process dies with no error, the last engine command you issued is the
prime suspect — bisect by command, not by code.** Your code did not crash a C++ binary; a
command did. And once you know, write it into `CLAUDE.md` as a hard invariant, because the
next agent has no memory of this and will reach for the obvious-sounding API again.

> Mechanical fix: [chapter 4, L4](04-landmines.md) — including the correction that the real
> rule is two-path (fake clients in tools mode, `AddBotPlayerWithEntityScript` for real
> matches).

---

<a id="f2"></a>
## F2 — The crash was fixed and nothing happened

**Story.** With the crash gone, the smoke ran to completion. Ten minutes of clean execution,
no errors, exit code fine. And every tick of the driver printed:

```
[E2E] driving 0 archer(s)
```

Zero. For ten minutes. No bots, no combat, no kills — a perfectly healthy run of nothing.

The fake clients were connecting at `GAME_IN_PROGRESS`, which is *after* the window in which
heroes get force-selected. Player IDs 1 through 9 existed, were connected, and had never
received a hero. The fix was to explicitly call `CreateHeroForPlayer` for every heroless fake
client after seating them.

But the interesting part is that this run *looked like a pass*. Nothing failed. The harness had
been built to detect crashes and script errors, and there were none.

**Rule.** **A green "did not crash" is not a green "did the thing."** Every smoke test needs at
least one positive-evidence assertion — a count that must be greater than zero, a marker that
must appear. `driving N archers, N > 0` is a better test than the entire error scanner, because
absence of failure is not presence of behaviour.

This is the same shape as rule 5 (liveness detection) and it will bite you in every autonomous
harness you ever build.

> Mechanical fix: [chapter 4, L6](04-landmines.md) — seating order versus game state.

---

<a id="f3"></a>
## F3 — The heroes that could not exist

**Story.** This one cost the better part of a day and produced three of the four architecture
invariants in `CLAUDE.md`.

We had defined four custom archer heroes in `npc_heroes_custom.txt`, using the documented
`override_hero` mechanism, with distinct names: `npc_dota_hero_windrunner_custom` and friends.
The KV parsed. Precaching succeeded. The compiled Lua was present. Everything upstream reported
success.

At spawn time the engine said:

```
ReplaceHeroWith failed as the unit npc_dota_hero_windrunner_custom is invalid.
```

One recorded run summarized as *"smoke 8: 11 class locks, 0 heroes spawned"* — eleven players
successfully choosing a class, zero heroes appearing.

The debugging went through a sequence of increasingly baroque hypotheses: a byte-order mark in
the hero file (a real problem, separately — the engine's encoding sniff was rejecting the whole
file), missing precache entries, `herolist.txt` registration, a temporary spawn probe that
itself crashed addon load and had to be removed 63 minutes later.

At hypothesis five, the agent stopped:

> "Everything structural checks out — abilities defined, ScriptFiles correct, compiled Lua
> present, hero KV clean, precache thorough. I've exhausted cheap inference. `unit is invalid`
> = engine has no unit registered under that `_custom` name despite a well-formed, precached
> `override_hero` entry. Docs say it *should* register; this project's live runs say it
> doesn't."

And ran a live probe on the VM instead of writing a sixth theory.

The answer: `override_hero` patches an existing hero's data. It does **not** register an
independently spawnable unit name. The fix is the pattern used by Open Angel Arena — override
the base heroes in place, keying the KV entries by base hero name. Windrunner became Assault,
Mirana became Sniper, Drow became Shadow, Clinkz became Demolitionist.

Before making the change, the agent measured the blast radius:

> "Before churning 7 files on a hypothesis, I'll [measure the blast radius]… 41 refs across 11
> files — but `game/scripts/vscripts/*.lua` are tstl build output (regenerated), and `src/` is
> the source of truth. Real edits: hero KV + 6 TS/loc files."

Forty-one references sounded like a rewrite; six files was an afternoon. One design change fell
out of it: two classes cannot share one base hero, so the Trapper had to move off Clinkz and
was repointed to Medusa. A gameplay decision forced by an engine constraint, made explicitly
and written down.

**Rule.** Two, and they're both about epistemics.

**When documentation and live runs disagree, live runs win** — and the correct next action is a
probe, not another hypothesis. An agent generating a fifth plausible theory is producing
confident-sounding noise; a probe produces a fact. Say "I've exhausted cheap inference" out
loud and change activity.

**Measure the blast radius before a rename refactor**, so the "cheap patch versus real
refactor" decision is made on counts rather than vibes. Note also *what* the count included:
41 references, most of them in generated files that regenerate themselves. Knowing which of
your files are build output is part of knowing your own repo.

> Mechanical fix: [chapter 4, L2 and L3](04-landmines.md) — custom hero names, and precaching.

---

<a id="f4"></a>
## F4 — The heroes that existed but could not be found

**Story.** Immediate sequel to F3. Heroes were now spawning. You could watch them on screen.
They fought, they died, they credited kills to the scoreboard. And the bot engine reported that
it could see no heroes at all.

`PlayerResource.GetSelectedHeroEntity()` returns nil for fake clients — because they never
*selected* anything. They were seated after selection closed and had heroes handed to them via
`CreateHeroForPlayer`, which sets the *assigned* hero, not the *selected* one. The two are
different fields with one obvious-looking getter.

The fix was `lib/heroResolve.ts::heroForPlayer()`, one function that tries selected, then
assigned, then falls back to scanning `HeroList` for a hero whose owner ID matches. Every
caller in the codebase goes through it.

The way it was caught is worth noting: a lint hook flagged it mid-merge, not a test.

> "The linter/hook surfaced a critical seam… The bot engine uses `GetSelectedHeroEntity`
> everywhere — that would return nil for bots."

**Rule.** **One resolver function per ambiguous engine concept.** The moment there are two ways
for a thing to come into existence — two spawn paths, two auth paths, two config sources — stop
calling the engine getter directly anywhere. Write the resolver, forbid the raw call, and
enforce it with a lint rule so the next agent cannot casually reintroduce it in a file you
aren't looking at.

> Mechanical fix: [chapter 4, L5](04-landmines.md).

---

<a id="f5"></a>
## F5 — Thirty-nine orders a second, zero arrows

**Story.** A ten-minute headless combat smoke on July 7. The bots moved. The bots aimed. The
bots issued roughly **39 cast orders per second** and released **zero arrows**, scoring **zero
kills in ten minutes**.

The diagnostic that cracked it was a counter module, `combatDiag.ts`, that did nothing but tally
events per second: cast orders issued, arrows launched, arrows blocked, kills. The
telling number was `arrowBlocked=0` — no arrow had ever been blocked, because no arrow had ever
launched, because the cooldown had never started. The casts were not merely missing. They were
never happening.

The 0.25-second think tick recomputed the world and re-issued the full intent every tick:
orbit-move for spacing, then cast. A Dota cast has 0.2–0.4 seconds of turn plus cast point, and
a new order cancels a winding-up one. Every tick the bot cancelled its own cast a third of the
way through and started a new one. Forever, at 39 hertz.

`CAST_HOLD_SECONDS = 0.9` fixed it: after issuing a cast, suppress all new orders until the
hold expires, with the expiry doubling as a stuck-cast timeout. It is locked in by a regression
test named `"holds engage orders while a cast is winding up (no windup-cancel loop)"`.

**Rule.** Two.

**An agent loop that re-issues intent every tick will starve any action with a windup. Design
ticks as commitments, not recomputations.** This is not a Dota fact. Anywhere a downstream
system has a multi-tick execution phase — animation, network, physics, a tool call — a
controller that recomputes and reissues faster than the action completes produces maximum
activity and zero throughput, with logs that look busy and healthy.

And the meta-rule, which is the more useful one: **build a counter panel before you build a
theory.** Several passes of reading `botAgent.ts` found nothing, because the code was correct
line by line. Four counters side by side made the bug arithmetic.

> Full treatment: [chapter 7, §7.3](07-testable-bots.md).

---

<a id="f6"></a>
## F6 — Nine bots standing perfectly still for six minutes

**Story.** A July 5 playtest. Nine bots, zero kills, six-plus minutes. Not fighting badly, not
thrashing — motionless.

`MoveToPosition` called with an unpathable destination does nothing at all. No error, no return
value, no log line. The bots were issuing move orders to points just past the arena's rim wall,
and the engine was discarding every one of them in silence.

The fix was not to clamp the destinations. It was to inject a `canPath` predicate — backed by
`GridNav.CanFindPath` in production, and by a three-line rectangle check in tests — at the
engine boundary in `huntNav.ts`. That made waypoint rolling, stuck detection and last-sighting
pursuit into pure functions with real unit tests, and it gave the bot something to say when
navigation fails instead of standing there.

**Rule.** **Silent no-op APIs are the enemy of autonomous testing.** Wrap each one in a
predicate you can unit-test on your laptop. You get two things from one change: testable logic,
and an explicit failure signal where there was previously only stillness.

> Related: [chapter 7, §7.4](07-testable-bots.md); the wider hazard class is
> [chapter 4](04-landmines.md).

---

<a id="f7"></a>
## F7 — Rich bots who never bought anything

**Story.** Bots accumulated gold for an entire match and completed zero purchases.

The shop entry condition was, in essence, `enemies.length === 0 || insideShopZone` — go
shopping when nothing is trying to kill you. Perfectly reasonable on a whiteboard. In a
hot-centre free-for-all, an enemy is visible almost all the time, and the condition was being
re-evaluated several times a second. Tick N: nobody in range, head to the shop. Tick N+1:
someone steps into vision, abort and engage. Tick N+2: they step out. The bot oscillated
between two states forever and completed neither.

The fix was a band. `SAFE_SHOP_BAND = 1500`, deliberately above both the engage radius (900)
and the sniper radius (1400), so the decision to shop is made from a position where it will
stay valid for a while rather than from the knife edge where one step flips it back.

**Rule.** **Boolean state gates in a hot loop produce oscillation. Use hysteresis bands, not
equality conditions.** If a state machine flickers, the bug is not in either branch — both
branches are correct — it is in the distance between the enter and exit thresholds.

The deeper connection to F5: a decision made at high frequency must include a reason to *stay*
decided. Cast-hold and shop-band are the same fix wearing different clothes.

> Full treatment: [chapter 7, §7.5](07-testable-bots.md).

---

<a id="f8"></a>
## F8 — The grapple hook that hit but never pulled, twice

**Story.** The hook was the signature ability. It shipped broken, was fixed, and shipped broken
again.

Round one, from a playtest report:

> `both W and R looks not working as expect it only animate something in my front without any effect.`

Round two, after the fix:

> `W and R dont literally hook or do something like that in terms or animation and bringing the character - like pudge does.`

The cause: `modifier_grapple_pull` declared itself as
`LuaModifierMotionType.HORIZONTAL` but never called `ApplyHorizontalMotionController(this)` on
its parent. The engine only ticks `UpdateHorizontalMotion` after that call has been made. So
everything visible happened — the projectile flew, the modifier applied, the target was briefly
rooted (invisible in play) — and the pull, the entire point of the ability, did not. The same
bug lived in `item_pull_gem`, which shared the modifier.

And here is why the harness missed it, twice:

> `SkillsExercise.verify()` checks only `GetCooldownTimeRemaining() > 0` — the cast released,
> the effect failed.

That assertion is true whenever the ability *casts*. It is true for a completely inert ability.
It was structurally incapable of failing on this bug.

There was a further sting. Even after the motion-controller fix, the hook did nothing on retail
macOS — for an entirely different reason, which is F9. The motion-controller approach was
eventually abandoned altogether in favour of an interval-tick reel plus a Pudge-style chain
particle.

**Rule.** **"The cast fired" is not "the ability worked."** Assert the effect: HP dropped, the
unit is ≥250 units closer to the caster than it was, the modifier is present on the victim. **A
test that cannot fail on a broken feature is not a test.**

The larger consequence: this failure, more than any other, is why the publish quality gate
exists. Two rounds of shipping the same broken ability is the point at which you stop fixing
the ability and start fixing the thing that keeps saying it's fine.

---

<a id="f9"></a>
## F9 — Green on the rig, 193 errors on the author's Mac

**Story.** The quality gate was green on the Windows VM. On the author's retail macOS client,
the same build produced **193 modifier-class errors**, in a stream of:

```
Modifier script modifiers/modifier_grapple_pull failed to find class named modifier_grapple_pull
```

The retail macOS Dota client ships a Lua VM with no `debug` library and no working `getfenv`.
The TypeScript-to-Lua adapter uses `debug.getinfo` to place modifier classes into the sandboxed
scope the engine reads. So on macOS, *not one Lua modifier ever applied.* The hook pulled
nothing. The ice bow never chilled anything. The burning arrow never burned.

The engine's report of this catastrophe: `Script Runtime Error: error in error handling.`

The fix is a shim, `lib/debugPolyfill.ts`, imported first in `addon_game_mode.ts`. It provides
`debug.traceback` and **deliberately does not provide `debug.getinfo`** — because the adapter
feature-detects real `getinfo`, and if you fake it the adapter takes the wrong path. Left
absent, the adapter falls back to a `pcall(getfenv)` stack walk, and `registerModifier` falls
back to the name-equals-filename convention. A polyfill that is *too* complete breaks the
detection it was meant to help.

**Rule.** **Your CI platform is not your player's platform.** An entire class of bugs lived in
the gap between the Windows tools client, where the gate ran, and retail macOS, where the human
actually played. The quality-gate spec names this limitation explicitly and carries a short
manual macOS checklist alongside the automated run. Honest scoping beats a false green.

Corollary, learned from the polyfill: when you shim a missing capability, check whether anything
downstream *feature-detects* it. Half-shims that defeat detection are worse than the absence.

> Mechanical fix: [chapter 4, L1](04-landmines.md).

---

<a id="f10"></a>
## F10 — The invisible owl, in three acts

**Story.** A scout ability was supposed to summon an owl that gives you vision.

**Act one.** The playtest report:

> `the hawk summoded by shadow has no visual`

The screenshot showed a floating health bar and, hovering next to it, the raw string
`#NPC_ARCHER_SCOUT_BIRD`. The unit had been given
`models/development/invisiblebox.vmdl` plus a fade modifier. The player was looking at
literally nothing with a name tag that was itself an unlocalized token — a missing localization
key renders as the raw token, silently. The fix: a real stock model (`beastmaster_hawk.vmdl`),
keep the fade so it stays invisible *to enemies*, add English and Brazilian Portuguese tokens,
and rewrite a tooltip that described a health-loss backlash the ability did not have.

**Act two.** Next round:

> `owl now has some asset, but is not the owl - I was expecting a owl controlable for a few seconds - giving me the vision.`

The unit had `DOTA_UNIT_CAP_MOVE_NONE` and `MovementSpeed 0`, and was never handed to the
player. Fix: `SetControllableByPlayer` plus `SetOwner`, real movement, roughly eight seconds of
life.

**Act three** is the interesting one, because it is not a bug fix. There is no owl model in
Dota. There is a hawk. The agent wrote the constraint down rather than shipping a fourth
approximation and hoping:

> "there is no stock Dota **owl** model; a bespoke owl is out of scope (v1 principle: no custom
> model work). Documented; revisit only if Carlos insists."

**Rule.** **A placeholder asset is a bug with a delayed fuse.** `invisiblebox.vmdl`,
`ERROR_FILEOPEN` model paths, an unlocalized token, a tooltip describing a mechanic that was
never implemented — each of these is a decision to ship something known-wrong on the assumption
that someone will remember. Nobody remembers.

And: **when a user asks for X and the engine only has Y, say so in the spec** instead of
silently shipping Y. Two of these three rounds were caused not by a defect but by an
unstated substitution.

> Related: [chapter 4, L12](04-landmines.md) — stale and renamed engine particles, which fail
> the same silent way.

---

<a id="f11"></a>
## F11 — "Verified and delivered," and the camera never moved

**Story.** Told in full as the opening of [chapter 1](01-why-this-is-hard.md); here is the
short form.

An agent delivered a recorded showcase run as verified. The console log said
`SHOWCASE RESULT: shown=42/42` and `[DIRECTOR] roaming camera engaged`. The video showed empty
terrain — the camera did not move for the entire match.

> `also the video full didnt showed the camera of user - even the skills being used — its useless`

Two bugs, both invisible to logs by construction:

1. **An unregistered convar.** `archer_wars_e2e_showcase` was never passed to
   `RegisterConvar`, so it read as `0`, so the run executed the default combat loop instead of
   the showcase — while the showcase logging path still printed showcase-shaped lines.
2. **The camera was never actually moved.** The "look at this" instruction went to the client
   through a net table, which in practice left the camera on empty field; in match mode it
   parked on the idle host about half the time.

The fix was server-side camera control — `PlayerResource.SetCameraTarget` locking the recording
host's camera to the acting hero — plus registering the convar and logging its resolved value
at boot.

The review file's framing became the project's motto:

> **Two real bugs caught by FRAME review (not logs).** The logs said 'shown=42/42 / director
> engaged' — but watching the frames caught two defects the logs hid, exactly the miss that got
> the prior deliverable rejected.

**Rule.** **Watch the frames.** For anything visual, log agreement is insufficient evidence,
full stop. And make it institutional rather than personal: this became a written acceptance
criterion in the next spec — *"Acceptance is frame review, never log-only claims."* A habit
lasts one session; a written criterion lasts as long as the file does.

Second rule, cheaper and easily forgotten: **an unregistered convar reads as zero.** Register
every flag, and log its resolved value at boot, so "the mode was off" is a visible line rather
than an inference three days later.

> Related: [chapter 4, L10](04-landmines.md) — gitignored build artifacts causing the VM to run
> stale code, which produced a nearly identical "the camera won't move" symptom for a
> completely different reason.

---

<a id="f12"></a>
## F12 — Three rejected deliverables and the spec that fixed the pipeline

**Story.** The best self-diagnosis in the repository is the opening of
`specs/003-e2e-visual-evidence/spec.md`, and it deserves quoting whole:

> Three prior evidence deliverables for spec 002 were rejected by the reviewer, each time for
> the same class of failure: **the logs said pass while the frames showed nothing.**
> Specifically:
> 1. Skill clips showed the caster alone — Shadow Hook (W) and Grapple Volley (R) fired
>    off-frame with no victim to grab.
> 2. Item clips showed a caption label over an **empty inventory bar**, because the camera
>    followed a bot whose HUD the engine hides from a spectator in FFA.
> 3. An attempted fix (forcing the recording host to own the bot) **hung the engine**,
>    producing zero evidence.

Read those three in order. The first is "we filmed the wrong thing." The second is "the engine
won't show a spectator a bot's HUD, so this framing can never work." The third is "our fix for
that hung the game and produced nothing, which our harness did not treat as a failure."

At that point the response was not a fourth attempt at the video. It was a spec about how
things get proven, with three structural answers:

- **A host demonstrator.** The recording player *owns* the hero being demonstrated, so the
  native HUD renders and inventory is visible on camera.
- **A live demo victim**, positioned in frame for every one of the 42 class×slot casts, so a
  clip shows a skill *connecting* rather than a caster alone.
- **A hang detector**, as a numbered functional requirement:
  `FR-009: the pipeline MUST detect a hung/frozen run (game clock not advancing while wall
  clock advances) and report it as FAIL.`

**Rule.** **When a deliverable is rejected twice for the same reason, stop fixing the
deliverable and go fix the evidence pipeline.** The third rejection is not a signal about the
artifact; it is a signal about the machine that produces artifacts.

And its companion: **a hung run must fail, not silently pass.** Absence of errors is not
evidence of success — a process that dies quietly generates no counter-evidence at all, which
a naive scanner reads as clean. Game clock versus wall clock is a cheap, general liveness
check; find the equivalent pair in your own system.

---

<a id="f13"></a>
## F13 — The star of the show, sealed in a tree pocket

**Story.** A fifteen-minute showmatch was recorded to be the project's hero footage: the camera
follows one designated star hero through a full ten-bot match.

The star stood still for the entire match, casting into nothing.

Spawn slot 0 sat inside a pocket of trees with no navigable exit. The pocket had been created
by a map-dressing pass — Phase 3 added a denser tree wall for visual quality — which nobody
connected to spawn geometry, because dressing is cosmetic and spawns are gameplay.

The fix (commit `a369780`) was a *navigable spawn fallback plus a star probe*: check at spawn
time whether the slot can reach the play area, and relocate if not. Four full recorded runs
happened before the footage was accepted.

**Rule.** **Procedural or cosmetic map dressing can invalidate spawn geometry.** Probe every
spawn for pathability as part of map generation, not as a playtest surprise. More generally: a
change described as cosmetic that touches world geometry is not cosmetic, and the assertion that
catches it belongs in the generator, where it costs nothing, rather than in a thirteen-minute
recorded run, where it costs thirteen minutes and a human's attention.

Related, from the same family: the eight custom free-for-all teams have no Hammer spawn points
at all, so every hero on them spawns at world origin — nine bots piled at map centre for a whole
match ([chapter 4, L7](04-landmines.md)).

---

<a id="f14"></a>
## F14 — The sidebar: eight smaller ones

Not every failure earns a full story. These eight each cost real time, and each carries a rule
worth a sentence.

| Symptom | Cause | Rule |
|---|---|---|
| `Math.imul` breaks the Lua build | TypeScriptToLua doesn't support it | Maintain a **known-API-risk list in the plan, before implementation** — ours split names into "verified against 4.38.2" and "unverified," each unverified one shipping with an inline fallback |
| Shop trigger-touch events never fire | trigger-touch events don't exist in this engine | An absent API can force an architecture change; `shopZone.ts` was rewritten to poll. Budget for this — it is not a bug, it is a redesign |
| `ModifierState.TRUE_SIGHT doesn't exist` | invented API name that looks exactly right | The model will write plausible engine code that isn't real. Split verified from unverified API names *in the plan*, not in the debugger |
| Bots dodged on stale arrow speed | an item boosted real arrow speed; the threat registry recorded base speed | Any model the bot keeps of the world drifts the moment a feature changes an input. Pass the real value as a parameter — *"threat model stays honest"* |
| A bought passive item "does nothing" | it worked; there was no feedback | *"the only sign a purchase landed is the inventory icon"* — invisible correctness is indistinguishable from breakage. Give effects visible feedback |
| The quality-gate sentinel grep never matched | the sentinel string carried a `$(Get-Date)` suffix | Use a **canonical literal sentinel** — `QGATE DONE`, no interpolation. Anything a poller greps for must be byte-stable |
| Ruin models rendered as `ERROR_FILEOPEN` | guessed asset paths | Verify stock asset paths against the installed engine; a wrong path is silent in most contexts and loud in exactly one |
| Corrupted showmatch mp4 | ffmpeg race — the poller killed the recorder before `-t` let it self-finalize | Let bounded recorders finish and finalize their own container; pull artifacts in a separate job |

---

<a id="f15"></a>
## F15 — The toggle that did the opposite

**Story.** F1 through F14 were all bought the same way: a human played the game, or watched
the frames, and something was wrong. F15, F16 and F17 come from a different source, and that
is most of their point.

On July 20, after the game was published and playable, three agents were pointed at the
repository with no brief beyond "find what is wrong" — one on core systems, one on the bot
engine, one on content and tooling. They returned 71 ranked findings. Several were defects a
player would hit in their first match.

The most instructive is four characters long. The bot panel's fill toggle wrote its state to a
convar:

```ts
Convars.SetInt("archer_wars_fill_bots", enabled ? 1 : 0);
```

Panorama sends that flag as `boolean | 0 | 1`, and the engine hands the server a `0` for a
wire `false`. In Lua, `0` is truthy. The ternary took the `1` branch. Setting **Fill bots:
Off** filled the lobby with bots.

Read the line again, because the reason this survived is that it looks like the *fix*. It is
not a lazy `if (enabled)` — it is a defensive normalization to 1/0, written by someone who was
thinking about the wire format, under a comment that correctly described the wire format. Both
the author and every subsequent reader parsed it as the careful version. tstl's truthiness
warning — the one thing in this toolchain that catches the whole family — does not fire, because
a ternary on a `boolean | 0 | 1` is a legal boolean test to the compiler.

The fix is `lib/wireFlags.ts::normalizeFlag`: three explicit comparisons, no truthiness, pure,
with a unit test that passes the exact failing value.

**Rule.** **A value that crosses a boundary you did not write can arrive in a representation
your conditional was never written for.** Convert it in one named function, at the boundary,
and unit-test that function at the value that breaks it. And the sharper lesson: **the code
most likely to hide this bug is the code that looks like it already handled it.** When you
audit a translation layer, do not skip the lines that appear to be doing the conversion — those
are where the wrong conversion lives.

> Mechanical fix: [chapter 4, L18](04-landmines.md).

---

<a id="f16"></a>
## F16 — The refund that paid for the item

**Story.** Archer Wars sells items from a marked shop zone. Because the engine cannot restrict
delivery by location in a fountain-less arena (L13), the restriction is enforced after the
fact: a guard listens for `dota_item_purchased`, and if the buyer was outside the zone it takes
the item back and returns the gold.

That worked for every plain item in the nineteen-item catalog. For the recipe-built ones, it
paid players to break the rule.

The guard looked up `event.itemname` in the buyer's inventory and removed it. For
`item_recipe_marksmans_luck_2`, the lookup found nothing — the engine had already combined the
recipe with its components and placed the *built* item in the inventory before the event fired.
So the removal was a no-op. The refund was not. Buy the most expensive weapon in the game from
anywhere on the map, keep the weapon, take the recipe gold back, repeat.

Two things are worth extracting. First, the mistaken model: the handler was written as if the
event were a *request* it could veto, when it is a *notification of a completed transaction*.
The engine had already done three things — charged the gold, consumed the components, built the
product — before the code got a say.

Second, the structure that let a half-executed compensation ship. The removal and the refund
were two independent statements, and only one of them could fail. The fix makes them a single
returned decision:

```ts
const removeItemName = purchasedName.startsWith("item_recipe_")
    ? resolved.item.internalName   // the BUILT item
    : purchasedName;
return { removeItemName, refundGold: resolved.cost };
```

One pure function, both branches unit-tested, and no way for a later edit to keep one half.

**Rule.** **When you react to an engine event, ask what the engine already did before it told
you.** Anything you intend to undo must be undone against the state as it is now, not the state
implied by the event's name.

And the general form, which is not about Dota: **a compensating action must not be able to run
when its paired action failed.** If your rollback is two statements, it is one bug away from
being a giveaway. Return them together, or perform them in one function that cannot succeed
partially.

> Mechanical fix: [chapter 4, L20](04-landmines.md).

---

<a id="f17"></a>
## F17 — Three registries, three silences, one test shape

**Story.** The same review turned up three defects with different symptoms and one cause.

Bots piloting three of the seven classes never cast a single ability for an entire match. They
moved, they chased, they aimed, they right-clicked. The bot kit table in
`bots/kits/kitAdvisor.ts` was keyed by hero name and had four entries; the game had shipped
seven classes.

Separately, three ultimates were never castable by any bot at all. The bot's ability probe
walked a hand-written array of ability names, and `archer_grapple_volley`,
`archer_spread_shot_volley` and `archer_sniper_shot_deadeye` were not in it, so nothing ever
asked the engine whether they were ready.

Separately again, the two most expensive items in the game could be bought from anywhere on the
map. `item_marksmans_luck_2` and `_3` were in `game/scripts/shops.txt` at 1200 and 1800 gold
with no entry in `lib/itemCatalog.ts`, so the shop-zone guard could not resolve them and
declined to act on the purchase — the same guard as F16, failing open instead of paying out.

None of the three produced an error, a warning, or a log line. All three require playing one
specific class, or buying one specific item, to notice. And the headless rig did not catch the
kit gap for a reason that is almost funny: the bots it spawned were the four classes that had
kits.

What connects them is a shape, not a subsystem. In every case the engine reads one file and the
TypeScript keeps a second copy of what it believes is in that file. Both were correct when
written. Then one side gained an entry, and nothing in this stack — not the type checker, not
the tests, not the compiler — can see across that gap.

The fix is the most portable idea to come out of the whole review: **drift tests**. A pure Node
test reads the authoritative file with `readFileSync`, scans it with a twenty-line parser, and
diffs it against the TypeScript table. It runs in milliseconds with no engine. Archer Wars now
has three — KV against the shop catalog, KV against the localization files, and a source scan
that asserts every `archer_*` ability literal appearing anywhere in `bots/kits/*.ts` is present
in the exported registry.

Where the second copy can be deleted instead, it was: the ability list is now *derived* from
the kit table rather than maintained beside it.

**Rule.** **Every hand-maintained table that mirrors data the engine owns will drift, and the
drift is silent.** Derive it if you can. If you cannot, write a test that parses the engine's
copy and diffs it — the parser only has to be good enough for one file format you control, and
that test is the cheapest coverage in the entire project.

The generalization worth carrying out of Dota: this is what to write whenever a fact lives in
two places and only one of them is compiled. Route tables versus handlers, migrations versus
models, feature flags versus their defaults, `package.json` versus the lockfile. The failure
mode is always the same — the newer entry is invisible to the older copy, and the symptom is
that one specific thing quietly does nothing.

> Mechanical fix: [chapter 4, L21](04-landmines.md). Technique in full:
> [chapter 5, drift tests](05-testing-without-engine.md#drift-tests).

---

## Reading the casebook as a whole

Sorted by underlying cause rather than by symptom, the seventeen collapse into six families:

**Silent no-ops (F1, F6, F10, F11, and half of F14).** The engine accepted the call and did
nothing. This is the dominant hazard class in game work and the reason
[chapter 4](04-landmines.md) exists.

**Assertions that couldn't fail (F2, F8).** The test measured the call, not the effect. Both
shipped broken features past a green harness.

**Loop dynamics (F5, F7).** High-frequency recomputation with no commitment. Two very different
symptoms, one fix shape.

**Platform gaps (F9).** The rig and the player were not running the same Lua.

**Evidence pipeline (F11, F12, F13).** The proof machinery was aimed at the wrong thing, and no
amount of re-running it would have said so.

**Two copies that must agree (F15, F16, F17).** A wire value and the Lua that reads it; the
engine's model of a purchase and the handler's model of it; a KV file and the TypeScript table
that mirrors it. Nothing errors, because each copy is internally consistent.

If you are starting a project of this kind, the honest prediction is that you will meet all six
families in your first two weeks. The point of writing them down is not that you will avoid
them — it is that you will recognize them on day two instead of day eight, and that when the
third rejected deliverable arrives you will know to stop and go build the pipeline.

One last thing about the sixth family, since it arrived last and by a different route. F1
through F14 were found by playing the game. F15 through F17 were found by three agents reading
the repository adversarially, after the game was built, tested, gated and published, in a
codebase that had 600+ passing unit tests, a headless rig and a frame-review gate. They found 71 findings, several of which a
player meets in their first match. Playtests and evidence pipelines catch what a human can
perceive; a directed adversarial read catches the defects whose entire symptom is that one
specific thing quietly does nothing. Budget for both.

**Next:** [chapter 12, mine your own story](12-mine-your-own-story.md) — how to dig this
material out of your own transcripts, with the true numbers.
