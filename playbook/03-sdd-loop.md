# 3. The SDD loop

Spec-driven development is not new, and there are plenty of writeups of the
spec → plan → implement pipeline. This chapter is about the version that
survived contact with a game engine, which differs from the usual account in
two ways: the **contract** step in the middle, and the **landmine** step at the
end.

The loop:

```
research
  -> spec.md      user stories, Given/When/Then, explicit non-goals
  -> plan.md      architecture + GLOBAL CONSTRAINTS + numbered tasks
  -> contracts/   the log markers and net tables the verifier will grep for
  -> implement    one commit per task, tests green before each
  -> evidence     run it for real -> markers -> frames -> a written verdict
  -> landmine     anything that surprised you becomes a comment + an invariant
```

The last arrow is the one that compounds. Everything else is table stakes.

## Why any of this, for a game

The obvious objection to writing specs for a hobby game is that games are
discovered, not specified. You do not know if a mechanic is fun until you play
it.

That is true, and it is not an argument against specs. It is an argument about
*what* the spec contains. A spec that says "Spread Shot should feel satisfying"
is worthless. A spec that says "Spread Shot fires three arrows in a 30° cone,
each dealing full damage, sharing one cooldown" is a contract an agent can
implement and a verifier can check. Whether the result is fun is a separate
question, answered by playing it, and the answer feeds the *next* spec.

The second reason is specific to agents. An agent that has read a good spec
makes different mistakes than one that has not. Without a spec it invents
plausible behavior and implements that. Given a spec it implements the spec and,
when the spec is ambiguous, either asks or picks something and marks it. The
failure mode moves from "wrong game" to "wrong detail", which is enormously
cheaper.

## Research first

Every good spec in Archer Wars starts from a document that is not a spec:
a research dossier reconstructing the original 2015 game, a verbatim quote of a
playtester's complaint, or a console log from a run that went wrong.

That input is what stops the spec from being fiction. [Chapter 9](09-research-first-design.md)
covers the discipline for the reconstruction case — sourced-fact tagging,
explicit `DESIGN-FRESH` gaps, clean-room boundaries. The general principle is
smaller: **write down where each requirement came from**, so that later, when
something feels wrong, you can tell "we chose this and were wrong" apart from
"we misremembered the source".

## The spec

A spec is short. The ones in Archer Wars run 74 to 286 lines. It contains:

- **Goal** — one paragraph. What is different after this ships.
- **Prioritized user stories** — each with Given/When/Then acceptance
  scenarios, and an **Independent Test**: how you would verify *this story
  alone*, without the others being done.
- **Architecture** — a file tree of what will exist, and parameter tables for
  anything numeric.
- **Non-goals** — explicitly out of scope.
- **Open questions** — what you do not know yet.

The Independent Test per story is worth more than it looks. It forces the
stories to actually be independent, which is what makes it possible to ship
half of them and have a working game. It also means the plan can order tasks by
value rather than by dependency.

Numbers go in tables in the spec, not in prose, and not invented during
implementation. From the bot engine spec:

| Difficulty | Aim σ | Reaction | Dodge chance |
|---|---|---|---|
| Easy | 12° | 600 ms | 20% |
| Medium | 7° | 400 ms | 45% |
| Hard | 3° | 250 ms | 75% |
| Unfair | 1° | 150 ms | 90% |

Four rows that took ten minutes to write and removed every subsequent argument
about what "hard" means. When the plan later says "difficulty values verbatim
from spec", there is something to be verbatim about.

## The plan

The plan is where an agent-executed project differs most from a human one. It
is long — the bot engine plan is 2,683 lines — because it contains literal code
and literal test bodies.

Structure:

1. **Goal, architecture, tech stack, link back to the spec.**
2. **Global constraints** — the section that does the real work.
3. **Numbered tasks**, each with:
   - `**Files:**` Create / Modify / Test
   - `**Interfaces:**` Consumes / Produces
   - `- [ ]` checkbox steps, containing actual code

### Global constraints

This section is a standing instruction that applies to every task in the plan.
The bot engine plan's version, paraphrased:

> - **Purity rule.** These files must not touch any Dota global — no `Vector`,
>   no `GameRules`, no `PlayerResource`, no `RandomFloat`: `vec.ts`, `aim.ts`,
>   `dodge.ts`, `targetSelect.ts`, `huntNav.ts`, `shopBrain.ts`, `difficulty.ts`,
>   `persona.ts`. Plain structs in, decisions out. Randomness is an injected
>   `() => number`.
> - **Dual compilation.** Every file above must compile under tstl *and* run
>   under vitest. Stick to `Math.*`, `Map`, arrays, interfaces.
> - **Bots never drive human heroes.** In either mode. Ever.
> - **Difficulty values verbatim from the spec table.**
> - **Commit after every task. Run `bun run test` before each commit.**

Notice these are not style preferences. Each one is a property of the finished
system that no individual task would produce on its own, and which is expensive
to retrofit. The purity rule in particular is what makes 14 test files possible;
discovered late, it would have meant rewriting the whole subsystem.

Naming the *exact files* the purity rule covers matters too. "Keep logic pure"
is advice. "These eight files must not reference `GameRules`" is checkable, by
grep, by a reviewer, by the agent itself.

### Tasks with literal code

A task looks like this, in outline:

> ### Task 1 — vector helpers
>
> **Files:** Create `src/vscripts/bots/vec.ts`, `src/vscripts/bots/__tests__/vec.test.ts`. Modify `vitest.config.ts`.
> **Interfaces:** Produces `Vec2`, `add`, `sub`, `len`, `normalize`, `angleBetween`.
>
> - [ ] Extend `vitest.config.ts` include list with `src/vscripts/bots/__tests__/**/*.test.ts`
> - [ ] Write the failing test:
>   ```ts
>   it("normalizes to unit length", () => {
>     expect(len(normalize({ x: 3, y: 4 }))).toBeCloseTo(1);
>   });
>   ```
> - [ ] Implement `vec.ts` until it passes
> - [ ] `bun run test` green, commit

Task 1 being "write the test config and a failing test" is not an accident. TDD
ordering is baked into the plan rather than left as a hope. And writing the test
body literally in the plan means the *specification* of correct behavior was
decided while thinking about design, not while thinking about implementation —
which is exactly when you want it decided.

The cost is that plans are long and take real time to write. The benefit is that
execution becomes mechanical, parallelizable, and reviewable task by task. If a
task's diff does not match its plan entry, something went wrong, and you can see
it without understanding the whole feature.

## Contracts

This is the step that most SDD writeups do not have, and it exists because of
how you verify a game.

A `contracts/` directory holds the **observable interface between the code and
its verifier**. Not the public API — the strings and tables that a test harness
will look for to decide whether the feature works.

For a visual feature, `contracts/visuals-and-markers.md` might specify:

```
[ELEM] bow=fire arrow=particles/.../fire_arrow.vpcf caster=<pid>
[ELEM] victim=<pid> element=fire fx=attached
```

Those exact strings, printed at those exact moments. Then:

- the implementation prints them,
- `vm-run.ps1` greps for them,
- the review reads them,

and all three agree because they were written down once, before any of it
existed. Without a contract, the verifier greps for whatever the implementation
happened to print, which means it can only ever confirm that the code does what
the code does.

The same applies to net tables: name them, give their shape, say who writes and
who reads. `src/common/netTables.d.ts` is that contract expressed as types.

## Implement

One commit per task. `bun run test` green before each. Nothing exotic.

Two habits are worth naming:

**Tests as executable documentation of design constraints.** Archer Wars'
`arenaManifest.test.ts` recomputes the arena's ruin-ring geometry from first
principles to prove the keep-out distances claimed in a source comment — rather
than, as the test's own comment says, "trusting this comment". When a design
constraint is arithmetic, a test can hold it true forever. Comments cannot.

**Known-benign noise gets documented.** tstl emits "Only false and nil evaluate
to 'false'" truthiness warnings in a few files where the behavior is correct
and intended. That fact is written down in `CLAUDE.md`. Without it, every agent
that sees the warning will try to fix it, and some will succeed at changing
working code.

## Evidence

For anything the player can see, "the tests pass" is not a verdict. The
acceptance gate is:

1. Run it for real on the VM rig ([chapter 6](06-autonomous-vm-rig.md)).
2. Confirm the contract markers appear in `console.log`.
3. Extract frames from the recording — a 1-per-3s sweep for the run, 15 fps for
   any window where the thing you care about lasts about a second.
4. **Look at the pixels.**
5. Write a `review.md`: what was checked, what was seen, PASS or FAIL, and the
   frame numbers backing it.

Step 4 is not automatable, and pretending otherwise is how you ship a feature
whose particle renders nothing. An un-precached particle produces no error, no
warning, and no visual — the log will happily tell you the ability fired.
[Chapter 5](05-testing-without-engine.md) treats this as a genuine fourth tier
of testing rather than an afterthought.

Two examples worth studying in Archer Wars:

- **The publish quality gate.** The spec said: before publishing, prove every
  ability and every item actually *does something*. The implementation is a
  convar-gated sweep that casts every ability, buys every item, and asserts an
  observable effect for each — driven by the VM rig, video-recorded, with the
  verdict scraped into a timestamped artifacts directory. The definition of
  done became an executable, recorded gate. The team's shorthand for the
  release criterion became "qgate stays 94/0".
- **The elemental visuals spec.** Input: a verbatim quote of a reviewer saying
  they could not tell which element was on their bow. Four prioritized stories,
  a marker contract, and dense frame extraction over each proc window. The
  verdict was issued by reading frames.

## Landmine

The final step, and the one that makes the loop compound: **anything that
surprised you becomes a permanent artifact.**

Concretely, two places:

1. **A comment at the site of the fix**, with the date it was observed, the
   symptom you actually saw, and why the obvious alternative is wrong.
2. **A line in `CLAUDE.md`** under "Architecture invariants", phrased as a rule.

Look at what that produces in practice:

```ts
// The retail macOS Dota client ships its Lua VM WITHOUT the `debug` library
// (tools mode and Windows retail keep it). Seen live 2026-07-05: anything
// touching `debug.*` on a Mac client dies with "attempt to index global
// 'debug' (a nil value)", masked by the engine as "Script Runtime Error:
// error in error handling".
//
// This shim fills ONLY `debug.traceback` [...] It deliberately does NOT fake
// `debug.getinfo`: lib/dota_ts_adapter.ts checks for the real getinfo and uses
// a stack-walk fallback when it is absent — a fake would silently break that
// detection.
//
// MUST be the first import of addon_game_mode.ts so it runs before timers.
```

Four things are in there that a future reader — human or agent — cannot derive:
the platform split, the *masked* error message they would actually see, the
deliberate incompleteness of the shim, and the ordering requirement. Delete the
comment and all four are lost; the code looks like an odd little polyfill
someone could clean up.

The `CLAUDE.md` half matters because it is loaded into context at the start of
every session. A comment protects the code it sits next to. An invariant
protects code that has not been written yet.

The rule of thumb: **if it cost you more than an hour and the cause was not
visible from the symptom, it is a landmine.** Write it down in both places
before you move on. [Chapter 4](04-landmines.md) is seventeen of them.

## When the invariant is wrong

One honest note. `CLAUDE.md` in Archer Wars said, for months:

> Seat bots with `dota_create_fake_clients`, never `dota_bot_populate`

That is true and it is also incomplete. The real rule is two-path:
`dota_create_fake_clients` works in **tools mode only** — it is cheat-gated and
silently ignored on a retail client — while `AddBotPlayerWithEntityScript` is
the cheat-free API for real matches. The code knew this; the invariant did not.

Invariants drift from the code that taught them. When you touch the code, re-read
the invariant. An invariant that is subtly wrong is worse than none, because it
is trusted.
