# Building a Dota 2 custom game with Claude Code

A playbook, a working boilerplate, and an autonomous test rig — extracted from
[Archer Wars](https://github.com/carloslibardo/archer-wars), a full-scale Dota 2
custom game built with Claude Code, and then tested by building a second game,
[Pudge Wars](https://github.com/carloslibardo/pudge-wars), from nothing but what
is in this repo. That second game is
[published and playable](https://steamcommunity.com/sharedfiles/filedetails/?id=3778117052),
and the things it caught that this playbook had not written down are in here too.

Three things live here:

| | |
|---|---|
| **[`playbook/`](playbook/)** | Thirteen chapters on the parts that are actually hard: the engine's silent failures, testing something CI cannot run, and what the process has to look like when an agent is doing the typing. |
| **[`template/`](template/)** | A ~50-file custom game — half of them one-line stubs the engine insists on — that builds, tests, and passes CI with **no Dota installed**, plus eleven Claude Code skills covering the build loop end to end. One command renames it into your game. |
| **[`testrig/`](testrig/)** | A GPU VM that plays your game for you, screenshots it, greps the log against a marker contract, ships back the evidence, and turns itself off. |

## Who this is for

Someone who wants to build a Dota 2 custom game — probably with an AI agent
doing a lot of the work — and would rather not rediscover, one at a time, the
several dozen ways this engine fails without telling you.

It assumes you can read TypeScript. It assumes nothing about Dota modding,
Source 2, Lua, Panorama, or Hammer.

Much of it generalizes past Dota. If you are building anything an agent can
write but cannot run — a game, a renderer, a desktop app — chapters 3, 5, 6, and
10 are about that problem in general.

## Start building in 5 minutes

```bash
bunx degit carloslibardo/dota2-claude-playbook/template my_game
cd my_game
bun run init my_game       # renames everything, then builds and tests to prove it
```

`init` rewrites the addon name across `package.json`, `addoninfo.txt`, the net
tables, the convars, the localization and the docs, then runs
`bun install && bun run build && bun run test` in front of you. It is
re-runnable, needs no network beyond the dependency fetch, and touches nothing
outside the project directory.

Then open Claude Code in that directory and describe what you want to build. It
reads `CLAUDE.md` on the way in — the engine invariants, and a table saying
which skill to reach for when.

<details>
<summary>Prefer a clone</summary>

```bash
git clone https://github.com/carloslibardo/dota2-claude-playbook.git
cp -R dota2-claude-playbook/template my_game
cd my_game && bun run init my_game
```

</details>

All of that passes on macOS or Linux with **no Dota 2 anywhere on the machine**.
With Dota installed, `bun run link` wires the addon into it — explicitly, never
as a side effect of installing dependencies — and `bun run launch` opens it.

Then read [chapter 4](playbook/04-landmines.md) before you write anything.

## The chapters

| # | Chapter | Why read it |
|---|---|---|
| 0 | [Ten rules](playbook/00-ten-rules.md) | The whole playbook compressed. Start here. |
| 1 | [Why this is hard](playbook/01-why-this-is-hard.md) | The engine fails silently, and an agent cannot notice that a game feels wrong. |
| 2 | [The toolchain in ten minutes](playbook/02-toolchain-in-10-min.md) | TypeScript → Lua, the symlink installer, and how you get real CI on a Valve game mod. |
| 3 | [The SDD loop](playbook/03-sdd-loop.md) | spec → plan → **contract** → implement → **evidence** → **landmine**. The last three arrows are the ones missing elsewhere. |
| 4 | [Landmines](playbook/04-landmines.md) | Twenty-five failures with symptom, cause, and fix. Twenty-two of them are silent. |
| 5 | [Testing without the engine](playbook/05-testing-without-engine.md) | The purity rule, the two-config trick, and why reading pixels is a real tier of testing. |
| 6 | [The autonomous VM rig](playbook/06-autonomous-vm-rig.md) | How "play the game" becomes one command, and what it costs. |
| 7 | [Bots you can unit-test](playbook/07-testable-bots.md) | The bots were the test rig, so the bots had to be more trustworthy than the game. |
| 8 | [Publishing and its ceiling](playbook/08-publishing-ceiling.md) | Where automation actually stops — which turned out not to be where the documentation says it does. |
| 9 | [Research-first design](playbook/09-research-first-design.md) | Sourced-fact tagging and `DESIGN-FRESH`, so nobody has to guess which numbers were invented. |
| 10 | [Working with Claude](playbook/10-working-with-claude.md) | What actually changed the output: the shape of the prompts. |
| 11 | [The failure casebook](playbook/11-failure-casebook.md) | Seventeen failures as stories — symptom, quoted evidence, and the rule each one produced. |
| 12 | [Mine your own story](playbook/12-mine-your-own-story.md) | Your transcripts hold your true numbers and your best material. How to extract both. |

There is also [`article/`](article/) — the long-form write-up of the Archer Wars
build itself.

## What is genuinely novel here

Honesty about provenance, since it affects what is worth your time.

The **toolchain layer** — `install.js`, `launch.js`, `dota_ts_adapter.ts`,
`tstl-utils.ts`, `timers.lua`, the tsconfigs — descends from ModDota's
`dota-2-typescript-template` and its lineage. It is excellent, it is not ours,
and you should use it. What this repo adds to it is the comments explaining why
each piece is shaped the way it is, generally learned by breaking it.

The **landmine catalog**, the **evidence-based process**, and the **VM rig** are
the parts that did not exist anywhere. That is where the value is, and the
chapters are weighted accordingly.

## The worked examples

There are two, and they play different roles. The first is where this came
from; the second is what happened when someone tried to use it.

### Archer Wars — the source

[Archer Wars](https://github.com/carloslibardo/archer-wars) is the full-scale
reference: a ten-player skillshot free-for-all, seven classes, twenty items,
a layered bot FSM with a unit test beside every decision module, and a publish
quality gate that casts every ability and buys every item on video before a
release is allowed.

Three things there are worth reading directly:

- `docs/superpowers/specs/` and `docs/superpowers/plans/` — the spec/plan pairs,
  including the 2,683-line bot engine plan whose *Global Constraints* section is
  the single most useful page in the ledger.
- `specs/004-elemental-visuals/` — a Spec Kit feature whose acceptance gate is
  frame review, with the marker contract written down in `contracts/`.
- `CLAUDE.md` — the invariants file, and the model for how to hand an agent
  everything the codebase learned the hard way.

### Pudge Wars — the test of this playbook

[Pudge Wars](https://github.com/carloslibardo/pudge-wars) is the more useful
example, because it is the one that could fail. It was built a month later, from
this template, by an agent following these chapters as written — a two-team
hook-fantasy arena where a landed hook is a kill — and it is
[published and playable](https://steamcommunity.com/sharedfiles/filedetails/?id=3778117052).

The interesting output was not the game. It was the list of things that went
wrong anyway. A project that had already read every word of chapter 4 still lost
runs to a modifier name it was not allowed to reuse, particles created fifteen
seconds before anyone was connected to see them, and a gate that reported dead
code about a working subsystem. Those became landmines **L26–L33**, casebook
entries **F18–F21**, and two more bot pathologies in chapter 7 — all of them
written *after* someone paid for them a second time.

Worth reading directly:

- `docs/PLAYBOOK-NOTES.md` — the running field report, written as the runs
  happened rather than reconstructed afterwards. This is the raw material every
  v1.1+ chapter edit came from.
- `CLAUDE.md` — the invariants file as it looks after 42 verification runs, each
  entry dated to the run that bought it.
- `scripts/vm.sh` and `scripts/vm-smoke.ps1` — the testrig here, adapted to a
  second game, which is the honest measure of whether the rig generalizes.

Read it alongside the failure casebook. Chapter 11 tells those stories properly;
the repo is where you can check them.

## License

MIT, matching the ModDota template lineage the toolchain descends from.
