# 9. Research-first design

Some projects start from a blank page. Many do not: you are rebuilding something
that existed, porting a mechanic from another game, or reconstructing a system
whose original documentation is gone.

That work has a failure mode with a specific shape. Six months in, nobody can
tell which numbers came from a source and which somebody made up on a Tuesday.
Every balance argument becomes archaeology. And when an agent is doing the
implementing, the problem compounds — a model asked to "make it like the
original" will confidently produce something plausible, and plausible is
indistinguishable from sourced unless you wrote down which was which.

This chapter is the discipline that fixes it. It is four rules and one audit.

## Rule 1 — every fact carries its source

In the research document, every recovered fact gets a bracketed tag naming where
it came from:

```
- 20 kills to win [wiki]
- 19-item shop, sold only from the center obelisk [workshop 2025]
- Base arrow cooldown 3.0s at level 1 [wc3 w3a]
- Hook drags the target toward the caster [github rmwxiong@a3f21c9]
```

The tags are short and mechanical because they have to survive being written
hundreds of times. What matters is that the tag identifies a **retrievable**
source — a specific wiki page, an archived Workshop description, a decompiled
ability file, a repository at a specific commit — not a vibe.

Two things this buys you:

**Disputes become checkable.** "The cooldown feels too long" is an opinion.
"The cooldown is 3.0s [wc3 w3a], and it feels too long" is a decision about
whether to depart from the source, made knowingly.

**Sources can be ranked.** A decompiled ability file is stronger evidence than a
fan wiki, which is stronger than a forum post recalling a game from a decade
ago. When two sources conflict, the tags let you say which one you trusted, and
why.

## Rule 2 — gaps are marked `DESIGN-FRESH`

There will be things you cannot recover. Some numbers were never written down,
some mechanics only existed in someone's memory, and some parts of your remake
have no original at all because the target platform is different.

Those get an explicit tag:

```
- Respawn time: 5s  DESIGN-FRESH
  (no source; original W3 respawn was tied to a mechanic we do not have)
- Kill bounty: 150 gold  DESIGN-FRESH
  (the original had no gold economy; the shop needs funding somehow)
```

`DESIGN-FRESH` is not an apology. It is a *label*, and it is doing the most
important job in the document: separating "this is how it was" from "this is
what we chose".

The consequence is practical. A `DESIGN-FRESH` number is free to change — it
was invented, and inventing a better one is a normal design decision. A sourced
number requires a deliberate departure. Without the label, both feel equally
arbitrary and every change becomes an argument.

It also gives an agent the right instruction. "Balance numbers trace to the
research document or are tagged DESIGN-FRESH" is a rule it can follow and you
can check by grep.

## Rule 3 — the clean-room boundary, stated at the top

If you are reconstructing someone else's work, the document opens with a notice
saying exactly what was recovered and what was not:

> **Clean-room notice.** This document records names, rules, and numeric
> parameters recovered from public sources. No code, art, models, sounds, or
> other assets from the original are reproduced, included, or referenced. The
> implementation is written from scratch against this description.

That boundary is the thing that makes the whole exercise legitimate, and it has
to be stated where the first reader sees it — not buried in a footnote, not
assumed.

It is also an operational instruction. It tells an agent reading the document
that recovering *behavior* is in scope and copying *implementation* is not,
which is a distinction it will otherwise happily blur. If you have raw source
material — decompiled files, archived pages, screenshots — keep it in a clearly
separated area, and do not ship it as part of anything you publish.

## Rule 4 — the research pass produces a feature checklist, not just facts

Rules 1 through 3 make every fact you wrote down trustworthy. They say nothing
about the facts you never wrote down, and that is the gap that ships broken
games.

Pudge Wars, 2026-07-27. "Traditional Pudge Wars" had been researched properly:
sourced facts, tagged, a spec, a marker contract, gates. Run 13 was rejected by
the reviewer for a reason no gate could have raised — **nothing ever spawned in
the river.** The river-item mechanic is as canonical to Pudge Wars as the hook
itself, and it had never been specced. Not deferred, not descoped, not decided
against. It had simply never been written down, so nothing downstream could
possibly notice its absence. The research had been mined only for the pieces
that were already known to be broken.

> **Unwritten = unshipped = undetectable.** A missing feature is invisible to
> every mechanism in this playbook. Tests check what exists. Gates check what
> the contract names. Frame review checks what is on screen against what you
> expected to be on screen — and if you never expected it, the frames look fine.

So the research pass has a second deliverable beside the tagged facts: **an
explicit feature checklist of the reference game.** Enumerate what X *is*,
exhaustively, at the granularity of "a player would name this as part of the
game" — every mechanic, mode, item class, map element, win condition, ritual.

Then every line on that checklist gets exactly one of three dispositions, and
none of them is silence:

```
- Hook (skillshot, drags target)          -> spec 002
- Two fields + river arena                -> spec 006
- River items / gift chests               -> spec 009
- Rot (toggle AoE damage aura)            -> spec 003
- Hook-length upgrade shop                -> spec 005
- Team scoreboard taunts                  -> OUT OF SCOPE (no chat UI this milestone)
- 1v1 duel mode                           -> OUT OF SCOPE (deferred to v2)
- Random-hero mutator                     -> USER DECISION (asked 2026-07-27, pending)
```

A **spec** means it is being built and something will gate it. **Out of scope**
means it was seen and deliberately dropped, with a reason — which is a
completely different artifact from an omission, because it can be revisited.
**User decision** means the call is not yours and the checklist is now the thing
that stops it from being quietly made by default.

The checklist is also the cheapest audit in this chapter. Read it beside the
spec directory and any line with no disposition is a hole you can see in ten
seconds. Read the spec directory alone and you cannot see holes at all — a
directory of five good specs looks exactly like a directory of five good specs
that is missing a sixth.

## The design-integrity audit: incentives versus enforcement

One more sweep belongs at design time, and it is a different *kind* of audit
from everything else in this book. Every other check here asks "is this system
correct?" This one asks "do two correct systems want opposite things?"

Pudge Wars again. Spec 008 established that the river is never a resting state —
an order filter kept bots out of the water, and a stranded-return sweep pulled
back anything that ended up there. Spec 004, written earlier, gave the river
**+30 HP/s regeneration**. Both specs were internally coherent, individually
implemented, individually tested. Together they were enforcement fighting
incentive: the design paid players to stand in the exact place the design
forbade them to stand, and the resulting behaviour — bots repeatedly drawn in
and repeatedly ejected — looked like a pathfinding bug for a while, because it
manifests as motion, not as an error. The resolution was a design call (flip the
river from reward to hazard), made explicitly once the contradiction was
written down. **Scan the design for mechanics that reward what another system
forbids, and resolve the contradiction on paper — the alternative is discovering
it as behaviour, where it wears the costume of a bug.**

## Structure

A research document that works has four sections beyond the facts themselves —
five, counting the feature checklist from rule 4, which is usually large enough
to earn its own file:

**Sources**, listed up front with what each one is and how reliable you judge
it. This is what the bracketed tags dereference to.

**The facts**, organized by system rather than by source, each tagged.

**Unknowns** — questions you could not answer, kept as questions:

> - Did the original's Fade grant true invisibility or only fog concealment?
>   Wiki says "invisible"; the ability file suggests a modifier we cannot fully
>   read. Currently implemented as brief untargetability, DESIGN-FRESH.

**Discrepancies** — places where sources actively disagree, with which one you
chose and why. Two sources both claiming to be authoritative is information, and
it deserves to be recorded rather than silently resolved.

## Why this matters more with an agent

A human implementing from a fuzzy memory will feel the fuzziness and hedge. A
model will produce a specific, confident, well-formatted number. The output
looks identical whether the number was recovered or generated.

So the tag is not documentation overhead — it is the only signal that survives.
Without it, a research document and a plausible fabrication are the same
artifact.

The workflow that follows:

```
research doc (tagged facts + DESIGN-FRESH gaps + unknowns)
  -> feature checklist   every line: spec / out-of-scope / user decision
  -> spec        cites the research for every parameter table
  -> plan        "values verbatim from the spec table"
  -> implement   KV files carry the numbers, code reads them back
```

At each step the provenance narrows but never disappears. When a value in a KV
file looks wrong nine months later, you can walk it back: KV → spec table →
research tag → the actual source. Or to `DESIGN-FRESH`, which means somebody
chose it, and you are allowed to choose differently.

## What not to do

Do not ship the research document as part of a template or a starter kit. It is
specific to one reconstruction, it may contain material with its own licensing
situation, and it is not reusable by anyone else.

Ship the **method**: sourced-fact tagging, `DESIGN-FRESH` for gaps, unknowns
kept as questions, discrepancies recorded, a feature checklist where every line
carries a disposition, an incentives-versus-enforcement sweep before
implementation, and a clean-room notice at the top. That is the part that
transfers.
