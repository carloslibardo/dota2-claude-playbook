# 2. The toolchain in ten minutes

This chapter is the whole build system, explained once. If you read only one
chapter before opening an editor, read this one — the rest of the playbook
assumes you know what `bun run build` actually does.

## What a Dota 2 custom game is, physically

A custom game is two directories inside your Dota 2 installation:

```
<Steam>/steamapps/common/dota 2 beta/
  game/dota_addons/<your_addon>/       <- what the game LOADS at runtime
  content/dota_addons/<your_addon>/    <- what the TOOLS COMPILE FROM
```

`game/` holds Lua scripts, KV data files, and localization. `content/` holds
sources that need compiling: maps, materials, particles, and Panorama UI.

Your repository mirrors that split — `game/` and `content/` at the root — and a
postinstall script links the two together. More on that in a moment.

The engine finds your code by convention, not configuration. It looks for
`game/dota_addons/<addon>/scripts/vscripts/addon_game_mode.lua` and calls two
global functions in it: `Precache` and `Activate`. That is the entire contract.
Everything else in your game is something you chose to build on top.

## Why TypeScript

Dota's scripting language is Lua 5.1 with a Valve-flavored standard library.
It works, and plenty of excellent custom games are written directly in it. But
it has no types, and the engine API is enormous — thousands of functions across
dozens of entity classes, most of which fail silently when misused.

[TypeScriptToLua](https://typescripttolua.github.io/) (tstl) compiles
TypeScript to Lua. Combined with ModDota's `@moddota/dota-lua-types`, you get
the full Dota scripting API as typed declarations. `hero.GetAbilityByIndx(0)`
becomes a compile error instead of a runtime nil.

That matters for a human. It matters much more for an agent, which cannot
notice that a function name looked slightly wrong. A typechecker is the fastest,
cheapest feedback loop available on a codebase where the *real* feedback loop
involves launching a several-gigabyte game client.

## The build

```bash
bun install     # deps, then postinstall: link repo dirs into Dota
bun run build   # run-p build:vscripts build:panorama
bun run dev     # the same two compilers, in --watch
bun run test    # vitest
bun run launch  # start Dota with -tools -addon <name>
```

`build` is two independent compilers running in parallel:

| Script | Tool | From | To |
|---|---|---|---|
| `build:vscripts` | `tstl --project src/vscripts/tsconfig.json` | `src/vscripts/**/*.ts` | `game/scripts/vscripts/**/*.lua` |
| `build:panorama` | `tsc --project src/panorama/tsconfig.json` | `src/panorama/**/*.ts` | `content/panorama/scripts/custom_game/**/*.js` |

`run-p` is a laptop convenience only: on the Windows VM that runs the headless
playtest it reports success having compiled nothing, so there you invoke
`build:vscripts` and `build:panorama` separately and check each exit code (see
[chapter 6](06-autonomous-vm-rig.md)).

They are different compilers because they have different targets. Game logic
becomes Lua for the server-side VM. UI becomes JavaScript for Panorama, Valve's
browser-like UI runtime, which wants ES2017.

The two share types through `src/common/*.d.ts`, which **both** tsconfigs
include. That is how a custom event payload gets declared once and checked on
both sides.

### The vscripts tsconfig, line by line

```jsonc
{
    "compilerOptions": {
        "outDir": "../../game/scripts/vscripts",
        "types": ["@moddota/dota-lua-types/normalized"],
        "plugins": [{ "transform": "@moddota/dota-lua-types/transformer" }],
        "strict": true
    },
    "tstl": {
        "luaTarget": "JIT",
        "sourceMapTraceback": false   // <- see below. Do not turn this on.
    },
    "include": ["**/*.ts", "../common/**/*.d.ts"],
    "exclude": ["**/__tests__/**"]    // <- see chapter 5. Load-bearing.
}
```

`luaTarget: "JIT"` matches Dota's LuaJIT VM. The transformer plugin handles
Dota-specific emit details, most visibly turning `Vector` arithmetic into the
right metamethod calls.

`sourceMapTraceback: false` is not a preference. With it on, tstl emits
`__TS__SourceMapTraceBack(debug.getinfo(...))` at the top of every output file,
and the retail macOS client ships a Lua VM with no `debug` library at all. Every
module dies at load. The engine masks the whole thing as "error in error
handling", which tells you nothing. This is landmine L1 in chapter 4, and the
comment explaining it lives in the tsconfig itself so nobody helpfully
"modernizes" it later.

`exclude: ["**/__tests__/**"]` keeps your vitest files out of the Lua output.
It pairs with `vitest.config.ts`, which includes exactly those directories.
Together they are the trick that makes unit testing possible; chapter 5 is
about nothing else.

## The symlink installer

`scripts/install.js` runs as a postinstall hook. On first run it **moves** your
repo's `game/` and `content/` directories into the Dota install and symlinks
them back:

```
repo/game     ->  <Dota>/game/dota_addons/<addon>       (junction)
repo/content  ->  <Dota>/content/dota_addons/<addon>    (junction)
```

After that, `bun run build` writing to `repo/game/scripts/vscripts/` is
writing straight into what the engine loads. No copy step, no sync step. Edit,
compile, `script_reload` in the tools console, see the change.

Three things to know about it:

1. **It is idempotent.** Run twice and the second run recognizes an existing
   correct link and skips.
2. **It no-ops without Dota.** `getDotaPath()` uses `@moddota/find-steam-app`
   and swallows `SteamNotFoundError`, so on a machine with no Steam it prints
   "No Dota 2 installation found. Addon linking is skipped." and exits zero.
   This is the single detail that makes CI possible; see below.
3. **The addon name comes from `package.json`.** `getAddonName()` reads the
   `name` field and enforces `^[a-z][\d_a-z]+$`. That name is the addon
   directory, the `-addon` launch argument, and the folder Workshop publishes.
   Choosing it is a real decision; renaming it later means re-linking.

**If the link is ever lost** — a fresh clone on a machine where the directories
were already moved, a manual `rm`, a Steam reinstall — you get the single most
disorienting failure in this whole stack: builds succeed, the game runs, and
nothing you change has any effect. You are compiling into the repo while the
engine reads a detached copy somewhere else. That is landmine L9. Check for it
first, every time, whenever someone says "I rebuilt and it's still broken".

## Continuous integration on a Valve game mod

Because `install.js` no-ops, this workflow runs on a stock ubuntu runner:

```yaml
- uses: oven-sh/setup-bun@v2
- run: bun install --frozen-lockfile
- run: bunx tsc --noEmit -p src/vscripts/tsconfig.json
- run: bunx tsc --noEmit -p src/panorama/tsconfig.json
- run: bun run build
- run: bunx vitest run --passWithNoTests
```

A few minutes, no GPU, no Steam, no Dota. It will not tell you the game is fun,
or that the projectile renders. It will tell you that every file typechecks
against the real engine API, that Lua emit succeeds for the whole tree, and
that your pure logic still behaves — which catches a large fraction of the
mistakes an agent actually makes.

Two typecheck steps *and* a build step is deliberate. `tsc --noEmit` gives you
clean, complete diagnostics; `tstl` gives you emit errors that `tsc` alone
would not surface.

One CI step worth adding later, once you have any generated-and-committed
artifact — a map manifest, a balance table exported to JSON — is a **drift
gate**: regenerate it and fail if the result differs from what is committed.
It is cheap and it catches the whole class of "somebody edited the output
instead of the source." Just be aware before you add it that a drift gate
asserts your generator is deterministic on every machine that runs it, which
stops being true the moment floating-point maths is involved. That is landmine
L17 in [chapter 4](04-landmines.md), and it cost us a week of red CI.

## The runtime shims you get on day one

Four files in `src/vscripts/lib/` are non-negotiable infrastructure. They come
from ModDota's template lineage; the template in this repo carries them with
their comments intact.

**`dota_ts_adapter.ts`** — the `BaseAbility` / `BaseItem` / `BaseModifier`
classes and the `@registerAbility` / `@registerModifier` decorators. The engine
expects an ability script to be a global table named after the ability, with
methods hung off it. The decorator does that wiring, so you can write an
ordinary TypeScript class. Without this file there is no way to author abilities
in TypeScript at all.

**`tstl-utils.ts`** — the `@reloadable` decorator. It caches class objects by
name so that `script_reload` in the tools console updates methods on the
*existing* instance instead of orphaning it. This is what makes hot reload work
instead of half-work.

**`timers.lua` + `timers.d.ts`** — the community `Timers` library, shipped as
raw Lua with a TypeScript declaration beside it. Every custom game needs
"do this in 0.3 seconds" and "do this every second"; the engine's own
`SetContextThink` is workable but unpleasant. tstl copies the `.lua` into the
output as-is when you `import "./lib/timers"`.

**`debugPolyfill.ts`** — a shim that installs a minimal `debug.traceback` when
the `debug` library is missing. It must be the **first** import in
`addon_game_mode.ts`, before `timers`, because Timers wires `debug.traceback`
as an xpcall handler on every tick. It deliberately does *not* fake
`debug.getinfo`, because `dota_ts_adapter` feature-detects the real one and
takes a stack-walking fallback path when it is absent. Faking it would break
that detection silently.

There is also `engineExtras.d.ts`, which is not a shim but an escape hatch: a
place to declare engine globals that exist in the live API but are missing from
the generated typings. Every call site of anything declared there must nil-guard
it, so an engine build without the global degrades to a no-op rather than a
script error.

## Data files: the part that is not code

A lot of your game is KV files under `game/scripts/npc/`. They are Valve's
key-value format, and the engine reads them directly.

| File | What it defines |
|---|---|
| `npc_heroes_custom.txt` | Hero overrides — stats, ability slots |
| `npc_abilities_custom.txt` | Every ability: base class, script file, cooldown, tunable values |
| `npc_units_custom.txt` | Non-hero units |
| `npc_items_custom.txt` | Items |
| `herolist.txt` | Which heroes are enabled for this game |
| `custom_net_tables.txt` | Net table names the engine will permit |

They all have to exist, even empty. And they follow the engine's general rule:
a malformed or missing entry does not raise an error, it just produces a game
where something quietly does not work.

The important convention is that **tunable numbers belong in the KV file**, read
back with `GetSpecialValueFor("damage")`. Two reasons: a balance change becomes
a data edit with no recompile, and the tooltip renders the same number the code
uses. Hard-code a value in TypeScript and the tooltip will eventually lie.

Localization is `game/resource/addon_english.txt`. Loc keys are the only place
tooltips exist. A missing key renders the raw token — `#npc_dota_hero_windrunner`
right there in the UI — which reads as a UI bug and is actually a data one.

## Panorama, briefly

Panorama is Valve's UI runtime: XML for structure, CSS for style, JavaScript
for behavior. It is browser-shaped but is not a browser, and the differences
bite.

- `custom_ui_manifest.xml` is the single entry point. Anything not reachable
  from it never loads.
- There are no JS modules. Every included `.js` shares one global scope, so
  wrap each file's logic in an IIFE.
- Panels default to `hittest="true"`. A full-screen panel with hit testing on
  silently swallows every mouseover in the game — native ability and item
  tooltips just stop appearing, while clicks still fall through to the world so
  the game stays playable. The bug is invisible and the cause is one attribute.
  Set `hittest="false"` all the way down unless a panel genuinely needs clicks.
- Prefer **net tables over events** for anything that is state. An event fired
  before a panel finished loading is gone forever; a net table value is still
  there when the panel gets around to reading it. Subscribe, then read once
  immediately.

Panorama is also where the build/serve asymmetry hurts. `game/scripts` (Lua) and
`game/resource` (localization) are read **live** from disk. Panorama and maps
are served **compiled** — `.vxml_c`, `.vcss_c`, `.vjs_c`, `.vpk` — so editing
Panorama source does nothing at all until `resourcecompiler` runs. See landmine
L9.

## What to do next

Clone `template/`, change `name` in `package.json`, and get
`bun install && bun run build && bun run test` green. That takes about two
minutes and proves your toolchain works before any Dota is involved.

Then read [chapter 4](04-landmines.md), which is the list of things that will
otherwise cost you a day each.
