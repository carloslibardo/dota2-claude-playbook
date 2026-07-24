---
name: debug-silent-failures
description: Use when something in the game does not work and there is no error — nothing spawned, nothing rendered, the ability does nothing, the UI never updates, the addon will not load. Symptom-first index into the known causes before you start guessing
---

# Debugging silent engine failures

This engine's failure mode of choice is silence. Before forming a theory, check
the symptom against the table — twenty-two of the twenty-five catalogued
landmines produce no error at all. `/landmine-check` is the prevention sweep;
this is the diagnosis one. Chapters 4 and 11 are the full catalog and the
seventeen stories behind it.

## First, get an actual log

- Launch with `-condebug`; read `console.log`, do not rely on the in-game
  console scrollback.
- Grep for `attempt to index`, `is invalid`, `loop or previous error loading
  module`, `error in error handling`. Any of these means load-time death, and
  everything downstream of it is a symptom, not a cause.
- **`script_reload` does not reload KV, and never reloads panorama.** Relaunch
  before believing a KV or UI change did nothing.

## Symptom → suspects

| Symptom | Look here first |
|---|---|
| **Addon does not load at all**, "error in error handling" | `debugPolyfill` is not the first import of `addon_game_mode.ts`; `sourceMapTraceback` got turned back on (L1). Retail macOS has no `debug` library |
| **Addon does not load**, "loop or previous error loading module" | A `require` cycle: a variant imported from inside its base module instead of after it, from the entry file (L8) |
| **My new ability/modifier does nothing, no error** | Not imported from `GameMode.ts` — the decorator never ran, so the class does not exist. Then: KV block name ≠ class name |
| **Particle/effect invisible** | Not precached (L3/L12), or the particle path is a renamed/removed engine asset. Both render nothing and report nothing |
| **Player got a random stock hero** | A custom hero name that does not resolve; selection timed out (L2). Base names only |
| **"unit ... is invalid" on spawn** | Un-precached hero or unit |
| **Bots stand still forever** | Heroes resolved with `GetSelectedHeroEntity` (nil for assigned heroes, all match — L5), or a think that returned nothing and silently died |
| **Client hard-crashed, no traceback** | `dota_bot_populate` in a laneless map (L4) |
| **Bots exist but are heroless** | Seated after `CUSTOM_GAME_SETUP` — "bogus player id" (L6) |
| **Everyone spawns on top of each other** | Custom FFA teams have no Hammer spawn points; `spawnPositions.ts` was removed or bypassed (L7) |
| **Purchases vanish into the stash** | `SetUseUniversalShopMode(true)` missing in a fountain-less arena (L13) |
| **Map goes pitch black mid-match** | Nothing pins time of day; nothing does it for you (L15) |
| **UI change had no effect** | Panorama is served COMPILED even in tools mode — no resourcecompile, no change. Then: is the layout in `custom_ui_manifest.xml`? |
| **UI renders empty** | Net-table name drifted between server, `custom_net_tables.txt` and the panel; or the panel subscribed without doing an initial `GetTableValue` read |
| **Native tooltips died / clicks feel wrong** | A full-screen panel left at default `hittest="true"` swallowing every mouseover |
| **A value arrives as the wrong thing client-side** | A wire `0` is truthy in Lua (L18); modifier parameters are server-only and the client predicts zero (L19) |
| **Tooltip shows `#DOTA_Tooltip_...`** | Missing localization token. Reliable smoke signal — cheap to check first |
| **A number in game ≠ the number in KV** | Renamed `AbilityValues` key: `GetSpecialValueFor` returns 0 silently. Duplicate KV keys: last one wins, silently |
| **Green on the rig, broken on a real client** | Different Lua VM and different flags. Rig-green is not a claim about retail (F9) |
| **It worked, then stopped after a sync** | Compiled Lua/panorama are gitignored; the machine is running its own stale build (L10). Rebuild there |

## Method when it is not in the table

1. **Prove the code ran.** Add a marker at the entry of the suspect path and
   look for it in `console.log`. Absent → the problem is upstream (registration,
   import, load order), not in the logic you are staring at.
2. **Bisect the five registrations** (`/kv-authoring`): KV block, TS class,
   entry import, precache, localization. Silent failures cluster here.
3. **Do not trust that it rendered because it logged.** For anything visual, get
   a frame (`/evidence-gate`).
4. **Then write it down.** A new silent failure goes into `CLAUDE.md`'s
   Architecture invariants in the same commit as its fix. That is where every
   row of the table above came from.
