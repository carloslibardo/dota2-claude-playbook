# Plan NNN — <feature name>

## Global Constraints

<!-- The single most useful section. List every invariant from CLAUDE.md this
     feature could plausibly violate, so they are in front of whoever (or
     whatever) implements it BEFORE the first line is written. Example: -->

- New ability must be imported from `GameMode.ts` and precached (silent
  no-exist / invisible-particle failures otherwise).
- Any hero-keyed lookup uses BASE hero names.
- Decision logic lands in `lib/` with zero Dota globals, tested in vitest.

## Marker contract

Written in `contracts/log-markers.md` before implementation. Summarize here:

- Requires: `[FEAT] <exact string the game will print>`
- Forbids: standard failure patterns (`Script Error`, `nil value`, ...)

## Work order

1. <file to touch> — <what changes>
2. ...

## Test plan

- Unit: <which pure modules, which new test files>
- e2e: <which markers prove it live; smoke or full run>
- Frames: <what a reviewer must SEE for visual features>
