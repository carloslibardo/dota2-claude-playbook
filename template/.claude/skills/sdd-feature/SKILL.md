---
name: sdd-feature
description: Use when starting any new feature, ability, item, or system in this Dota 2 custom game — walks the spec → plan → marker contract → implement → evidence → landmine loop so nothing ships on "it compiles"
---

# SDD feature loop

Every feature in this codebase moves through six gates, in order. Skipping one
is how silent engine failures ship. The full reasoning is in the playbook's
chapter 3 (`playbook/03-sdd-loop.md` in the repo this template came from).

## 1. Spec

Create `docs/specs/<NNN>-<feature-name>/spec.md` from
`docs/specs/spec-template.md`. State what the player experiences, not how the
code is shaped. Every balance number gets a source: cite where it came from, or
tag it `DESIGN-FRESH` so nobody later mistakes an invention for research.

## 2. Plan

Add `plan.md` beside it: files to touch, order of work, and a **Global
Constraints** section listing the invariants from `CLAUDE.md` that this feature
could plausibly violate. Read `CLAUDE.md`'s Architecture invariants NOW, not
after something breaks.

## 3. Marker contract — BEFORE implementing

Add `contracts/log-markers.md`: the exact `[MARKER]` strings the game will
print to prove the feature worked, and the failure patterns that must NOT
appear. The VM rig greps for these verbatim. Writing the contract first means
implementation and verification agree on paper, not by accident.

## 4. Implement

- Pure decision logic goes in `src/vscripts/lib/` (zero Dota globals — no
  `Vector`, `GameRules`, `PlayerResource`, `RandomFloat`), with a vitest file
  beside it in `lib/__tests__/`. Inject randomness as `() => number`.
- Engine-facing code stays thin: translate world state to plain data in, plain
  decisions out.
- New abilities/items/modifiers MUST be imported from `GameMode.ts` (side
  effect registration) and precached in `Precache` — both failures are silent.

## 5. Evidence

"It compiles" and "tests pass" are not done. Done is:

- `bun run test` green (the pure half),
- the e2e harness (`+<addon>_e2e 1`, via the test rig or locally) prints every
  marker from the contract and no failure patterns,
- for anything visual: a frame — screenshot or extracted video frame — showing
  the player would have seen it. A log line proves code ran; only a frame
  proves it rendered.

## 6. Landmine

If the engine surprised you at any point — silent failure, wrong docs,
behavior that cost more than ten minutes to explain — append it to
`CLAUDE.md`'s Architecture invariants before closing the feature. A landmine
not written down will be stepped on again.
