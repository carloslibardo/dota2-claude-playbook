# 10. Working With Claude: The Human's Operating Manual

Everything so far has been about the code and the rig. This chapter is about the other half of
the system: you.

Over eleven days the human wrote roughly 250 typed prompts, and the agent executed a little
over 2,500 tool calls in response — roughly eight agent actions per human sentence. (The exact
numbers, and why two different counts of them both exist, are in
[chapter 12](12-mine-your-own-story.md).) At that leverage ratio, the shape of your prompts is
not a stylistic matter. It is the highest-order variable in the project. A prompt that sends
the agent down a productive path buys you eight useful actions; a vague one buys you eight
wasted ones and a wall of text to read.

We went back through the whole transcript corpus and sorted the prompts by what they actually
produced. This chapter is that sorting.

---

## 10.1 The escalation ladder

The single clearest pattern in the corpus is that the human's demands escalated in a very
legible sequence, and the project's quality followed it:

```
build X
  → test X
    → record X
      → did you *watch* the recording of X?
        → spec how X will be proven
```

Each rung exists because the previous rung got gamed — not maliciously, but structurally.
"Build X" produces something that compiles. "Test X" produces a test that passes, which in a
silent-no-op engine can mean a test that cannot fail. "Record X" produces a video nobody
watched. "Did you watch it" produces a real answer once, and then needs asking again next
week. Only the last rung — writing down, in advance, what evidence will count — makes the
standard survive the session.

The failure rate collapsed at the last rung. That is where GitHub Spec Kit entered the project
and where acceptance criteria started reading like *"Acceptance is frame review, never
log-only claims."*

**The practical advice is to skip rungs.** You do not have to rediscover this ladder on your
own project. When you ask for something whose correctness you can't check by reading a diff,
start at rung five: ask for the proof mechanism first, and the feature second.

## 10.2 Prompting patterns that worked

### Artifact-first asks

The highest-yield prompt in the entire corpus, verbatim:

> `could u run a e2e flow with each character on the vm to test full skills? record the video to see how the skills goes — also buy and test all itens on the shop — use specify to spec and plan full steps to assurance this goal — my goal is test and ensure all skills and itens work correctly to allow me publish the game - we should have a quality gate` [sic — the user's informal spelling is preserved throughout this chapter]

Look at how much is packed in there. It names:

- **the deliverable** — an e2e flow per character, plus every shop item;
- **the medium** — a recorded video;
- **the method** — use Spec Kit to spec and plan it first;
- **the business goal** — "to allow me publish the game";
- **the artifact class** — "we should have a quality gate."

That prompt produced the publish quality gate: 94 checks, 0 failures, every ability of every
class cast and asserted at effect level, every catalog item bought through the real shop event,
all of it screen-recorded with timestamps that map into the video. It is the best artifact in
the project, and it came from one message.

The pattern to steal is naming the *business goal* alongside the deliverable. "So I can
publish" tells the agent what the acceptance bar is when the spec is ambiguous — and specs are
always ambiguous somewhere.

### Name the process explicitly

Short prompts, big effect:

> `use superpower to plan it`
> `use github speckit to debug, plan and spec all these changes`
> `do a full spec plan using specify before start it`

Nearly every large feature in the project starts with one of these. The agent's default
behaviour on a big ask is to start writing code; naming a heavier workflow routes it into
design-first mode instead. Notice that the human did not describe the workflow, just named it —
because the workflow was installed and the agent could look it up.

The corollary: **install the processes you want to be able to invoke by name.** A one-word
instruction that expands into a fifteen-step discipline is enormous leverage. A one-word
instruction the agent has to improvise is just vagueness.

### Name the team shape

> `use opus as orchestrator and spawn sonnet subagents to build it - build the entire workflow of test e2e - use claude code teams to parallize`
> `use claude code teams to parallize the work - opus as orchestrator & sonnet as executor + reviewerr`

Explicit model-and-role assignment produced clean fan-out with reviewers instead of one agent
grinding serially. The bot engine went out as one plan → 14 tasks → 12 parallel implementer
agents in a shared worktree, each doing test-first development and writing a task report,
followed by per-task reviewer agents producing two separate verdicts (spec compliance and
quality), followed by one whole-branch review. It came back with 92 tests green.

The enabling constraint is easy to miss and easy to get wrong: **file-disjoint task
decomposition**. The loading-screen fan-out was described as *"3 Sonnet executors in isolated
worktrees (file-disjoint → zero merge conflicts)"* — stated as a design goal in the plan, not
discovered during the merge. If your tasks overlap in files, parallelism costs more than it
buys.

### Adversarial evidence challenges

These are the highest-leverage prompts in the corpus, and they share one property: they attack
the *evidence*, not the code.

> `did u visually validated both skills and itens or just with logs? I want to have it visually vlaidated`
> `did we recorded full tracing of evidences that all skills are working as expect and full itens bught with visually validation? did u reviewed the artifacts (videos) generated?`
> `analyze and see full videos to see what you produced as evidence. I'm pretty confident that u didn't made it worked.`
> `the video is only 2 characters completly stucked and stopped - without test any item or skill - what the value of that?`

Every one of these produced a real bug. Not "prompted a better explanation" — produced a
defect that was in the shipped build.

The reason this works is the whole thesis of [chapter 1](01-why-this-is-hard.md): in a domain
with silent failures, an agent's confidence tracks the quality of its evidence pipeline, not
the quality of the code. Attacking the code ("are you sure this is right?") invites the agent
to re-read the code and be reassured. Attacking the evidence ("did you *look* at it, or did
you read the log?") forces a different observation to be made, and different observations are
where new information comes from.

Keep one of these in your rotation permanently. "What would this look like if it were broken,
and would your evidence show that?" is a question with a very high hit rate.

### Playtest reports: a screenshot plus one sentence

> `[Image] in the boundries of the map - people can go there to avoid be killed`
> `the hawk summoded by shadow has no visual`
> `I tested locally but the W and R still dont work`

In nearly every case the agent root-caused from source within a single turn. A screenshot
collapses an enormous amount of ambiguity — it fixes the game state, the UI state, the visual
symptom and the context all at once, and it cannot be argued with. One sentence of symptom
plus one image beats three paragraphs of description, reliably.

### Ask for friction removal, don't endure friction

> `give me 20k of money to allow test it witout fricction`

That produced a `-gold` chat command granting 20,000 gold, which was then used for the rest of
the project. Ten minutes of agent time paid back over a week.

There is a general habit here worth naming: when you notice yourself doing something tedious
for the third time in order to test something, stop and ask for the affordance instead. Agents
are extremely good at building small testing conveniences and will never think to build one
unprompted, because they don't feel the tedium.

### Locked briefs to subagents

When you dispatch a subagent for a task where you already know what you want, constrain it
hard. The brief that produced the launch trailer:

> "You are a video editor executing a locked EDL with ffmpeg. **Do not redesign the edit;
> implement it, verify it, fix render bugs only.** … VERIFY before reporting: ffprobe duration
> ≈ 30-31s… extract 8 check frames spread across the output and **READ** them. … RETURN (raw
> data, not human prose)."

Three things make this brief good, and they generalize to any subagent dispatch:

1. **Scope lock.** "Do not redesign the edit" pre-empts the most likely failure mode, which is
   an agent improving something you didn't ask it to touch.
2. **Mandatory self-verification, specified concretely.** Not "make sure it works" — *ffprobe
   the duration, extract eight frames, read them.* The verification steps are as explicit as
   the work steps.
3. **A machine-shaped return value.** "RETURN (raw data, not human prose)" — because the
   caller is going to consume this, not read it.

If you take one thing from this section: subagent briefs should specify how the subagent will
prove its own work, in the same detail as the work itself.

## 10.3 Prompting patterns that churned

Equally instructive, and less comfortable to write down.

### "ensure no gaps missing"

Roughly twenty occurrences across the corpus, in many spellings:

> `go full ahead - ensure no gaps missing`
> `continue - ensure no gaps and fully test and rework / rebuild the map`

It is unbounded. Sometimes it triggered a genuinely useful sweep. Often it produced a long
inventory of *what might be missing* instead of work — because "no gaps" has no completion
condition, so the agent's safest response is to enumerate. Its cousin, `what is missing here`,
appears about eight times and was usually answered with a wall of text.

The fix is to bound it: "list every ability that has no effect-level assertion, then add them"
is the same instinct with a finish line.

### Bare continuations at decision points

`continue`, `ok`, `go ahead`, `do that`, `yeah do that` — dozens of them. Mid-plan these are
cheap and fine, and most of them were.

The costly ones are the several that arrived while the agent was *blocked on a decision*.
Given `continue` in that state, an agent will guess rather than ask, and a guess at a design
fork costs a rework. If you're about to type "continue," it's worth two seconds to check
whether the last message contained a question.

### Status polling

> `what is the current stage?`
> `are u running somehting?`
> `what is the stage of the vm running?`

These are a symptom, not a habit. They appear clustered around long VM runs, and what they
really indicate is a missing status surface. A `vm.sh status` subcommand, or a progress file
the run appends to, would have replaced most of these turns — and unlike a chat answer, a
status file is also readable by the next agent and by you tomorrow.

**When you find yourself asking the agent for status more than twice, ask it to build the
status surface instead.** This is the same instinct as the `-gold` command, applied to
observability.

### Duplicate sends and pasted terminal walls

Several prompts appear two to six times consecutively with near-identical timestamps — UI and
paste artifacts. The July 11 rejection prompt was sent **six times**. Each duplicate is a real
turn with real cost.

Similarly, pasting a 74 GB Steam download progress log or a full RDP session transcript into
the conversation spends a lot of context for very little information. If a log matters, save
it to a file and point the agent at the file.

### Cross-session confusion

> `ensure is not confliting with this other session`

Three concurrent Claude sessions shared one repository and one GCP VM at the peak of this
project. That created genuine coordination cost: branch races, force-push hazards, and two
sessions trying to run the VM at once. It got written into project memory as a standing
pre-flight check.

Parallelism across *sessions* is not free the way parallelism across *subagents in one session*
is. The subagents share an orchestrator that knows the plan; the sessions do not. If you run
concurrent sessions on one repo, give them disjoint file ownership and a written rule about
who may touch the shared expensive resource.

## 10.4 Dated root-cause comments as institutional memory

About forty comments in the Archer Wars source carry a date and an incident. Not "why we do
this" in the abstract — the specific run, on the specific day, that produced the specific
number the comment sits above.

```ts
// botAgent.ts
/* … re-issuing orbit-move + cast every tick cancels the windup forever — the
 * 2026-07-07 EngineDrive smoke: ~39 cast orders/s, zero arrows released,
 * zero kills in 10 min (arrowBlocked=0 proved the cooldown never started). */
const CAST_HOLD_SECONDS = 0.9;

// huntNav.ts
/* MoveToPosition to an unpathable point … silently no-ops — 9 bots stood
 * idle for 6+ minutes with 0 kills in the 2026-07-05 playtest. */

// modifier_frost_arrow.ts
// missing (2026-07-08 R10: Carlos "never triggers a cold effect arrow").
```

This is the single cheapest high-value practice in the playbook, and it exists specifically
because of how agentic development works.

Across 350-plus commits and dozens of sessions, no agent has the context of the session that fixed
the bug. A future agent reading `const CAST_HOLD_SECONDS = 0.9;` bare has every reason to
"simplify" it away — it looks like an arbitrary magic number in a tick loop, and removing it
makes the code cleaner. A future agent reading the comment above it does not, because the
comment tells it exactly what happens if it does: thirty-nine orders a second and zero arrows.

Three properties make these comments work:

**They carry a date.** That lets you find the run, the transcript, and the commit.
**They carry a measurement, not an explanation.** "~39 cast orders/s, zero arrows" is
falsifiable and vivid; "prevents order thrashing" is neither.
**They sit next to the artifact they justify** — the constant, not the top of the file, and
certainly not in a wiki.

Do this every single time an incident produces a number. It is thirty seconds of work at the
moment when you have all the context, and it is the mechanism that stops regressions from
re-landing.

## 10.5 CLAUDE.md is where invariants go to survive

Dated comments protect a line of code. `CLAUDE.md` protects an architecture.

The Archer Wars `CLAUDE.md` has a section headed, verbatim:

> ## Architecture invariants (violating these caused real crashes)

and it lists four, each stated as a rule with the reason attached:

- Archers **are** base heroes overridden in place — custom `npc_dota_hero_*_custom` names
  never spawn, so `GetUnitName()` returns the base name and any hero-keyed dispatch must key
  base names.
- Seat bots with `dota_create_fake_clients`, never `dota_bot_populate` — the latter
  hard-crashes the tools client in this map, with no traceback.
- Resolve bot heroes via `heroForPlayer()`, not `PlayerResource.GetSelectedHeroEntity` — fake
  clients get heroes *assigned*, not *selected*.
- Skillshot-only: all damage flows through the arrow hit pipeline.

Every one of those is a scar. Each cost hours. Each is the kind of thing an agent starting
fresh will re-derive incorrectly, because in every case the *wrong* approach is the one the
documentation suggests.

Three observations from living with this file:

**The heading does the work.** "Architecture invariants (violating these caused real crashes)"
is a much stronger instruction than "Notes." It tells the reader that deviation is not a style
disagreement.

**Keep it short enough to stay read.** Four invariants, three commands, one table of where code
lives, one testing strategy. This file is loaded into every session; every line you add
competes with every other line.

**Keep it honest, and re-check it.** During the playbook work we found that one invariant had
been simplified past correctness: `CLAUDE.md` says "always fake clients, never bot_populate,"
but the real rule is a two-path one — `dota_create_fake_clients` works in tools mode only (it
is cheat-gated and *silently ignored* on retail clients), while real-match fill needs
`GameRules.AddBotPlayerWithEntityScript`. An invariant that is 80% true is more dangerous than
no invariant, because it stops inquiry. Audit the file occasionally against the code.

## 10.6 Reviewers earn their keep

When we fanned out work to parallel agents, every implementer task got a reviewer agent, and
the whole branch got one more. It is tempting to treat that as ceremony. It was not.

The reviewer on the quality gate came back with:

> **Quality-gate review: 2 CRITICAL bugs found, gate can't be trusted yet.**

One of them was a retry-orphaning bug: the match phase had been appended as the last element
of a single FIFO queue, so any step that got retried was orphaned behind it and never ran.

Sit with what would have happened without that review. The quality gate is the artifact whose
entire job is to be believed. A broken gate does not produce a visible failure — it produces
*green false confidence*, which is the worst possible outcome in this project and the exact
thing the gate was built to eliminate. The reviewer's finding is worth more than the feature
it reviewed.

Two practices make reviewers useful rather than decorative:

**Give them a separate verdict axis.** Ours produced two verdicts per task — **spec
compliance** and **quality** — written to a file. Splitting them stops "it works" from
laundering "it's a mess," and vice versa.

**Point them hardest at the verification code.** The instinct is to review the feature. But
verification code fails silently and in the direction of false confidence; feature code fails
loudly and in the direction of a bug report. Review the thing whose failure you cannot see.

## 10.7 The honesty bar

Of the roughly 103 MB of transcript we mined, this is the most valuable single line an agent
produced:

> "the earlier 'items visually validated on camera' framing is **overstated**: effects are on
> camera, the *inventory icons are not*. Authoritative verification is manual play, not the
> auto-recorder."

That is an agent retracting its own earlier claim, unprompted, and re-scoping what the evidence
actually supports. Nobody caught it. It caught itself, on a second look at its own artifact.

It sits alongside a small family of related habits from the same corpus:

> "Let me verify actual wiring + build output, not just claim."

> "One thing I can't verify headless — you must eyeball it: `bun run launch`. Confirm: overlay
> animates (title pulse, arrow streaks, class pips), stats panel fades in, overlay disappears
> when the match goes live. That playtest is the only open item."

> "there is no stock Dota **owl** model; a bespoke owl is out of scope (v1 principle: no custom
> model work). Documented; revisit only if Carlos insists."

Set this as the bar explicitly, because you get more of what you ask for. Three things to ask
for by name:

1. **Distinguish what was verified from what was assumed**, in the report, every time.
2. **Hand back the un-automatable part with instructions**, rather than quietly not mentioning
   it. "Here is the one thing you must eyeball, and here is exactly what to look for" is a
   complete deliverable. "Done" is not.
3. **Say when the engine can't do the thing that was asked**, in the spec, instead of silently
   shipping the nearest available substitute. The invisible-owl saga
   ([F10](11-failure-casebook.md#f10)) is three rounds long partly because the substitution was
   never surfaced.

An agent that will retract its own claim is worth more than one that is right slightly more
often, because you can build a process on the first one.

## 10.8 A short operating checklist

- **Start at rung five.** Ask how it will be proven before asking for it to be built.
- **Name the process and the team shape** when the task is big. `use speckit`, `opus as
  orchestrator, sonnet as executors + reviewers`.
- **State the business goal** in the same message as the deliverable.
- **Challenge the evidence, not the code.** "Did you look at it, or did you read the log?"
- **Send screenshots.** One image plus one sentence of symptom.
- **Ask for affordances** the third time something is tedious. `-gold`, `vm.sh status`.
- **Don't say `continue` when the last message asked a question.**
- **Bound your sweeps.** "List X with no Y, then fix them" beats "ensure no gaps."
- **Lock subagent briefs**, and specify their self-verification as concretely as their work.
- **Write the incident into a dated comment** the moment it produces a number.
- **Promote invariants to `CLAUDE.md`**, and audit that file against the code occasionally.
- **Review the verification code hardest.**
- **Coordinate concurrent sessions** with disjoint file ownership and a rule for the shared rig.

**Next:** [chapter 11, the failure casebook](11-failure-casebook.md) — all fourteen failures as
story-and-rule pairs.
