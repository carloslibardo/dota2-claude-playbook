# Hello Arena — a Dota 2 custom game template

A minimal, working Dota 2 custom game in TypeScript. Ten players, free-for-all,
one skillshot ability, first to ten kills wins. About thirty files.

It exists so you do not have to spend your first two days discovering that the
hero grid appears even when the hero does not exist, or that panorama is served
compiled while Lua is served live.

```bash
bun install     # installs deps, then symlinks game/ and content/ into your Dota install
bun run build   # TypeScript -> Lua, and panorama TypeScript -> JS
bun run test    # unit tests. No Dota required, works on macOS and Linux
bun run launch  # opens Dota 2 in tools mode with this addon (Windows/macOS with Dota installed)
```

`bun install && bun run build && bun run test` all pass with **no Dota 2
installed at all** — `scripts/install.js` detects a missing Steam and skips the
linking step. That is what makes CI on a Valve game mod possible.

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

## The one step you cannot script

You need a `.vmap`. Maps are made in Hammer, which is Windows-only and has no
command-line "new map" path. See `content/maps/README.md` for the five-minute
version.

## Making it yours

1. Change `name` in `package.json`. It is load-bearing: `scripts/utils.js`
   derives the addon directory from it and enforces `^[a-z][\d_a-z]+$`.
2. Rename the map in `game/addoninfo.txt` and create it in Hammer.
3. Rename the `hello_arena_*` convars and net tables (`GameMode.ts`,
   `systems/e2eHarness.ts`, `src/common/netTables.d.ts`,
   `game/scripts/custom_net_tables.txt`, and `src/panorama/hud.ts` — the HUD
   hardcodes the net-table name and renders silently empty if it drifts; the
   test rig's convar derives from the addon name, so it follows step 1 free).
4. Rewrite `CLAUDE.md` for your game — but keep the **Architecture invariants**
   section, and add to it every time the engine surprises you.

## Where this came from

Extracted from [Archer Wars](https://github.com/carloslibardo/archer-wars), a
full-scale custom game built with Claude Code. The toolchain layer descends
from ModDota's `dota-2-typescript-template`; the comments explaining *why* each
piece is shaped the way it is are what Archer Wars added, generally by getting
it wrong first.

The reasoning behind every invariant in `CLAUDE.md` is written up in
[the playbook](../playbook/), one chapter per problem.
