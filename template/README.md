# Hello Arena — a Dota 2 custom game template

A minimal, working Dota 2 custom game in TypeScript. Ten players, free-for-all,
one skillshot ability, first to ten kills wins. About thirty files.

It exists so you do not have to spend your first two days discovering that the
hero grid appears even when the hero does not exist, or that panorama is served
compiled while Lua is served live.

## Start building in 5 minutes

```bash
bunx degit carloslibardo/dota2-claude-playbook/template my_game
cd my_game
bun run init my_game       # renames everything, then builds and tests to prove it
```

That is the whole setup. `init` rewrites the addon name across package.json,
`addoninfo.txt`, the net tables, the convars, the localization and the docs,
then runs `bun install && bun run build && bun run test` in front of you. It
needs no Dota 2 install, no network beyond the dependency fetch, and it changes
nothing outside the project directory.

Then open Claude Code in the directory and say what you want to build. It reads
`CLAUDE.md` on the way in — the invariants, and the trigger table that says
which skill to reach for.

<details>
<summary>No <code>degit</code>, or working from a clone</summary>

```bash
git clone https://github.com/carloslibardo/dota2-claude-playbook.git
cp -R dota2-claude-playbook/template my_game
cd my_game && bun run init my_game
```

</details>

## The commands

```bash
bun install     # dependencies ONLY. Never touches your Dota install
bun run build   # TypeScript -> Lua, and panorama TypeScript -> JS
bun run test    # unit tests. No Dota required, works on macOS and Linux
bun run init    # rename this template to your game (re-runnable)

bun run link    # opt-in: move game/ and content/ into dota_addons/<addon>, symlinked back
bun run launch  # open Dota 2 with this addon. Workshop Tools are Windows-only
bun run unlink  # reverse the link
```

`bun install && bun run build && bun run test` all pass with **no Dota 2
installed at all**. That is what makes CI on a Valve game mod possible.

**Linking is opt-in on purpose.** `bun run link` *moves* `game/` and `content/`
into your Dota install and leaves symlinks behind. That is the correct end state
for developing an addon and a very rude thing for `bun install` to do
unannounced — so installing dependencies reports what it found and stops there.

## What you get

| | |
|---|---|
| `src/vscripts/GameMode.ts` | The five things every custom game configures: FFA teams, selection/pre-game timers, a forced base hero, a kill listener, and a convar |
| `src/vscripts/abilities/example_ability.ts` | One skillshot: linear projectile, first hero hit takes damage |
| `src/vscripts/lib/` | The engine shims you need on day one (`dota_ts_adapter`, `Timers`, the macOS `debug` polyfill) plus two pure, tested helpers |
| `src/vscripts/systems/e2eHarness.ts` | A convar-gated headless bot loop that prints `[E2E]` markers — the hook the VM test rig grabs onto |
| `src/panorama/` | A hello-world HUD panel reading a custom net table |
| `game/`, `content/` | The KV files and layouts the engine insists on, each with a comment saying why |
| `.github/workflows/ci.yml` | Typecheck + build + tests on every push |
| `CLAUDE.md` | Pre-filled architecture invariants, so an agent starts the project already knowing what will silently break |
| `.claude/skills/` | Eleven Claude Code skills covering the whole loop — see below |
| `docs/specs/` | Spec and plan templates the `/sdd-feature` skill instantiates per feature |
| `scripts/init.ts` | The rename: template -> your game, in one command |

## The skills

An agent working in this repo gets these, with a trigger table in `CLAUDE.md`
saying when to reach for each. They carry the checklist; the playbook carries
the reasoning.

| Phase | Skill |
|---|---|
| Start a feature | `/sdd-feature` — spec → plan → marker contract → implement → evidence → landmine |
| Write an ability or item | `/ability-modifier-patterns` |
| Add a hero or unit | `/new-hero-authoring` |
| Author KV or localization | `/kv-authoring` |
| Build UI | `/panorama-ui` |
| Any vscripts TypeScript | `/tstl-lua-gotchas` — where compiled Lua diverges from TS |
| Claim it works | `/evidence-gate` — what counts as proof at each tier |
| Run a real match | `/vm-testrig` — the GPU VM that plays the game and greps the log |
| It is broken and silent | `/debug-silent-failures` — symptom → suspects |
| Before committing | `/landmine-check` — the silent-failure sweep |
| Ship it | `/workshop-publish` — cook, `steamcmd`, and what is still manual |

## The one step you cannot script

You need a `.vmap`. Maps are made in Hammer, which is Windows-only and has no
command-line "new map" path. See `content/maps/README.md` for the five-minute
version.

## Making it yours

`bun run init <addon_name>` does it: package.json, `addoninfo.txt`, the
`hello_arena_*` convars and net-table names (`GameMode.ts`,
`systems/e2eHarness.ts`, `src/common/netTables.d.ts`, `custom_net_tables.txt`
and `src/panorama/hud.ts` — the HUD hardcodes the net-table name and renders
silently empty if it drifts), the localization, `CLAUDE.md`, and this README.
It reads the current name out of `package.json` rather than assuming
`hello_arena`, so it is safe to re-run and it renames a project that was
already renamed. `--title "Display Name"` if the derived one is not what you
want, `--no-verify` to skip the build.

Two things it deliberately leaves you:

1. The map. Rename it in Hammer to `<addon_name>.vmap` and create it —
   `content/maps/README.md`.
2. `CLAUDE.md`'s **Architecture invariants**. Keep the section, keep every
   entry, and add to it every time the engine surprises you. That list is the
   most valuable file in the project and it only grows by being written in.

## Where this came from

Extracted from [Archer Wars](https://github.com/carloslibardo/archer-wars), a
full-scale custom game built with Claude Code. The toolchain layer descends
from ModDota's `dota-2-typescript-template`; the comments explaining *why* each
piece is shaped the way it is are what Archer Wars added, generally by getting
it wrong first.

The reasoning behind every invariant in `CLAUDE.md` is written up in
[the playbook](../playbook/), one chapter per problem.
