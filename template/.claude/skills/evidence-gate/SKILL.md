---
name: evidence-gate
description: Use when about to claim a feature works, or when judging whether someone else's claim is supported — what counts as evidence at each tier, how to write the marker contract first, and why a log line never proves a thing rendered
---

# Evidence gate

"It compiles" is not evidence. "Tests pass" is evidence about pure logic and
nothing else. This skill is the standard a claim has to meet before the word
*works* is allowed. Reasoning: the playbook's chapters 5 and 6; the ways this
gate has been failed are casebook F9, F10, F11.

## The tiers, and exactly what each one proves

| Tier | Proves | Cannot prove |
|---|---|---|
| 1 — vitest | Pure decision logic is correct | That any of it is reachable in the engine |
| 2 — headless e2e (`/vm-testrig`) | The code path executed in a real match | That anything appeared on screen |
| 3 — human playtest | It feels right | Reproducibility; humans miss *slightly* wrong |
| 4 — frame review | It rendered | Nothing else; it is narrow and it is the only proof of visuals |

The trap is tier 2 masquerading as tier 4. `[ELEM] applied fire to victim 3`
proves the branch ran. An un-precached particle renders nothing and reports
nothing — the marker still prints. **For anything visual, a log line is not
evidence. A frame is.**

## Write the contract before implementing

`docs/specs/<NNN>-<feature>/contracts/log-markers.md`, authored at step 3 of
`/sdd-feature`, before code:

- **Required markers** — exact strings, verbatim, that the run must print.
  Prefix by subsystem (`[E2E]`, `[UI]`, `[ABILITY]`) so scans stay greppable.
- **Forbidden patterns** — script errors, "unit ... is invalid", "attempt to
  index", "loop or previous error loading module", plus this feature's specific
  wrong-path strings.
- **Known-benign noise** — engine chatter that always appears (L16). Write it
  down or every future run re-litigates it.
- **Frame windows** — which seconds of the recording a reviewer must look at,
  and what must be visible in them.

Markers carry timestamps so the windows can be computed from the log afterwards.

## Producing frame evidence

1. The rig run records an MP4 next to its screenshots.
2. `extract-frames.sh run.mp4 out/` — one frame per 3 s across the run. Enough
   for anything persistent.
3. Effects lasting ~1 s (a projectile, a proc, a status landing) fall between
   those frames. Compute the window from the marker timestamp and re-extract:
   `extract-frames.sh run.mp4 --window 143 4 out/` (15 fps).
4. **Look at the frames.** Issue the verdict in writing, citing frame numbers.

This step is not automatable, and automating it is precisely how the
invisible-particle class of bug ships.

## Judging a claim (yours or an agent's)

Reject it unless:

- [ ] The claim names its tier. "Works" without a tier is not a claim.
- [ ] Every required marker from the contract appears in the quoted log —
      quoted, not summarized.
- [ ] No forbidden pattern appears, and the run was long enough to reach the
      code path at all.
- [ ] Anything visual has a frame, and the frame shows the thing, not just the
      game running.
- [ ] The evidence came from a build that contains the change. Compiled Lua and
      panorama JS are gitignored: syncing source without rebuilding on the
      target machine tests last week's code (L10).
- [ ] A green run on one machine is not a claim about another. Retail macOS
      runs a different Lua VM than the tools client (L1, F9).

If the run failed, the evidence still matters — the log, the screenshots and
the frames from a failed run are how you find out why. Retrieve them before
tearing anything down.
