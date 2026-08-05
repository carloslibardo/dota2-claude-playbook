# CLAUDE.md — Hello Arena

A Dota 2 custom game written in TypeScript, compiled to Lua with
TypeScriptToLua. Free-for-all, first to 10 kills.

> This file is read automatically by Claude Code at the start of every session.
> It is the highest-leverage file in the repo: everything here is context the
> agent gets for free, and everything not here has to be rediscovered — usually
> by breaking something first. Replace the "Hello Arena" specifics with your
> own; keep the **Architecture invariants** section and add to it.

## Commands

```bash
bun install        # dependencies ONLY. Never touches a Dota install
bun run init <name>  # rename this project (idempotent, re-runnable, no network)
bun run build      # TS -> Lua (tstl) + panorama (tsc). run-p build:*
bun run dev        # both compilers in --watch
bun run test       # vitest, pure-logic unit tests (run anywhere, no Dota needed)

bun run link       # OPT-IN: MOVES game/ and content/ into dota_addons/hello_arena,
                   # leaving symlinks behind. Needed before `launch`
bun run launch     # start Dota 2 -addon hello_arena. Workshop Tools are Windows-only
bun run unlink     # reverse the link, moving both directories back here
```

**Never run a Dota-linking step implicitly.** `bun run link` *moves* `game/`
and `content/` out of the project into the user's Steam install. It is correct
when developing the addon and destructive-feeling when it is a surprise, so it
is opt-in and stays opt-in: do not move it back into `postinstall`, and do not
run it on someone's machine without being asked. It is the only step here that
reaches into a Dota install at all.

CI (`.github/workflows/ci.yml`) runs typecheck on both tsconfigs, the full
build, and vitest on every push and PR — on ubuntu, with no Dota installed.

## Where code lives

| Path | What |
|------|------|
| `src/vscripts/` | Game logic. TS -> `game/scripts/vscripts/*.lua` |
| `src/vscripts/lib/` | Pure helpers, unit-tested. Tests in `lib/__tests__/` |
| `src/vscripts/abilities/` | One TypeScript class per ability |
| `src/vscripts/systems/` | Match systems (spawns, e2e harness, ...) |
| `src/common/` | Types shared by vscripts and panorama (events, net tables) |
| `src/panorama/` | UI TS -> `content/panorama/scripts/custom_game/` |
| `game/`, `content/` | Dota addon dirs (KV data, layouts, maps). Compiled output here is **gitignored** |
| `scripts/` | init (rename) / install (link) / launch helpers |
| `docs/specs/` | One directory per feature: spec + plan + marker contract (templates provided) |
| `.claude/skills/` | The skills below. Read the one that matches before writing code |

## Which skill, when

Invoke the skill **before** writing the code, not after it breaks.

| Reach for | When |
|---|---|
| `/sdd-feature` | Starting any feature, ability, item, or system. The six-gate loop |
| `/ability-modifier-patterns` | Writing an ability, item, or modifier |
| `/new-hero-authoring` | Adding or reworking a playable hero or a summoned unit |
| `/kv-authoring` | Touching anything under `game/scripts/npc/` or `game/resource/` |
| `/panorama-ui` | Touching anything under `src/panorama/` or `content/panorama/` |
| `/tstl-lua-gotchas` | Any `src/vscripts/` work — truthiness, GC, handle hygiene |
| `/evidence-gate` | About to claim something works, or judging such a claim |
| `/vm-testrig` | Running the headless playtest, or writing the e2e harness |
| `/debug-silent-failures` | Something does not work and there is no error |
| `/landmine-check` | Before committing anything touching heroes, abilities, particles, bots, KV, panorama, or spawns |
| `/workshop-publish` | Cooking and uploading to the Steam Workshop |

## Workflow

New features follow the SDD loop — invoke `/sdd-feature` when starting one:
spec → plan → **marker contract** → implement → **evidence** → **landmine**.
The last three arrows are the ones that catch this engine: the contract is
written before the code, the evidence is a frame and not a log line for
anything visual, and a surprise that cost an hour gets appended to the
invariants below before the feature closes.

A feature typically walks: `/sdd-feature` → the craft skill for the area →
`/evidence-gate` → `/vm-testrig` if it needs a real match → `/landmine-check`
→ commit.

## Architecture invariants

Each of these describes a real failure mode of the Dota 2 engine. Most of them
fail **silently** — no error, no traceback, just a game that is subtly or
completely wrong. Violate one and you will spend hours looking in the wrong
place.

- **Heroes are BASE heroes overridden in place.** `SetCustomGameForceHero`
  needs a real base name; a custom name like `npc_dota_hero_windrunner_custom`
  does not resolve, and the engine hands the player a random stock hero at
  timeout. Override base heroes in `game/scripts/npc/npc_heroes_custom.txt`.
  Consequence: `GetUnitName()` returns the BASE name forever, so any
  hero-keyed dispatch table must key base names.
- **Precache anything you spawn.** Un-precached heroes make
  `CreateHeroForPlayer` / `ReplaceHeroWith` fail with "unit ... is invalid".
  Un-precached particles render *nothing*, with no error whatsoever. Both go in
  `GameMode.Precache`.
- **Every ability, item, and modifier must be imported from `GameMode.ts`.**
  TSTL only emits Lua for modules reachable from the entry point. And import
  order matters: importing a variant from inside its base module creates a Lua
  `require` cycle ("loop or previous error loading module") that kills the
  entire addon load. Import variants *after* their bases, from the entry file.
- **`debugPolyfill` must be the first import of `addon_game_mode.ts`.** The
  retail macOS client ships a Lua VM with no `debug` library; without the shim
  every module dies at load, masked as "error in error handling". The paired
  half is `"sourceMapTraceback": false` in `src/vscripts/tsconfig.json` — do not
  turn it back on.
- **Never call `dota_bot_populate`** — it hard-crashes the tools client in a
  laneless map (the process dies, no traceback). Seat bots by mode instead:
  `dota_create_fake_clients` in **tools mode only** (it is cheat-gated and is
  silently ignored on retail), and
  `GameRules.AddBotPlayerWithEntityScript` for **real matches**.
- **Resolve bot heroes with `lib/heroResolve.ts#heroForPlayer()`**, never
  `PlayerResource.GetSelectedHeroEntity` — bots get heroes *assigned*, not
  *selected*, so the selected accessor is nil for them the entire match.
- **Seat e2e bots at `CUSTOM_GAME_SETUP`**, before hero selection closes.
  Seated later, `CreateHeroForPlayer` rejects them ("bogus player id") and they
  spend the match heroless.
- **Fake clients join TEAMLESS.** `dota_create_fake_clients` seats players with
  no team assignment. FFA hides this (everyone gets their own `CUSTOM_*` team
  anyway), but on ANY non-FFA layout teamless bots never pass hero selection and
  sit the match out — no error. Run an explicit `SetCustomTeamAssignment` sweep
  over every seated bot during `CUSTOM_GAME_SETUP`. And note the seam is deeper
  than it looks: converting this template from FFA to two teams also touches
  `addoninfo.txt` (`TeamCount`), the team list, spawn logic, the net tables and
  the HUD — it is not a KV toggle.
- **A particle is networked only to clients connected at the instant it is
  created.** World FX spawned at `Activate` / GameMode construction run while
  the server sits in INIT, ~15 s before the first client connects — they render
  for NOBODY, silently, while every server-side log marker stays green. Create
  persistent world visuals at `GAME_IN_PROGRESS` and print a draw marker so the
  rig can prove the timing.
- **Custom FFA teams have no Hammer spawn points.** Heroes on the eight
  `DotaTeam.CUSTOM_*` teams all spawn at the world origin. `systems/spawnPositions.ts`
  repositions them onto a ring; do not remove it.
- **`GameRules.SetUseUniversalShopMode(true)` is mandatory in a fountain-less
  arena**, or every native store purchase strands in the stash.
- **Nothing pins time of day for you.** A custom arena with no day/night logic
  goes pitch black at night. The e2e harness pins a repeating
  `GameRules.SetTimeOfDay(0.5)` timer, but only when engaged — a human playtest
  needs the same pin (or a real day/night design) or the map goes night-blind.
- **Panorama panels default to `hittest="true"`.** A full-screen hittest panel
  silently swallows every mouseover in the game, killing native tooltips while
  leaving the game otherwise playable. Set `hittest="false"` all the way down
  unless a panel genuinely needs clicks.

## Testing strategy

1. **Unit (fast, runs anywhere, runs in CI):** vitest over pure logic —
   `bun run test`. Keep decision logic in files that touch **zero** Dota
   globals (no `Vector`, `GameRules`, `PlayerResource`, `RandomFloat`); take
   plain structs in, return decisions out; inject randomness as a
   `() => number` so tests are deterministic. `src/vscripts/tsconfig.json`
   excludes `**/__tests__/**` from Lua emit, and `vitest.config.ts` includes
   exactly those dirs — the two configs are complementary halves of one trick.
2. **Headless e2e (a Windows machine with a GPU):** launch Dota in tools mode
   with `+hello_arena_e2e 1`, let `systems/e2eHarness.ts` drive bots through a
   whole match, then scan `console.log` for script errors and `[E2E]` markers.
3. **Manual playtest:** `bun run launch` on a machine with Dota 2 installed.

Engine-facing layers (`GameMode.ts`, the systems, the abilities) are
deliberately thin: they translate world state into plain data and decisions
back into orders. They are covered by tier 2, not tier 1.

## Conventions

- Bun is the package manager and runner. Strict TypeScript. English everywhere.
- Compiled artifacts (`game/scripts/vscripts/**/*.lua`, panorama `.js`) are
  build outputs — never commit them, never edit the Lua directly.
- Balance numbers live in the KV files and are read with `GetSpecialValueFor`,
  not hard-coded in TypeScript.
- **When something surprises you, write it down here.** A landmine that costs
  an hour and is not recorded costs that hour again.
