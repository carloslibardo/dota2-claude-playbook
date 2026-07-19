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

This chapter is the discipline that fixes it. It is three rules.

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

## Structure

A research document that works has four sections beyond the facts themselves:

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
kept as questions, discrepancies recorded, and a clean-room notice at the top.
That is the part that transfers.
