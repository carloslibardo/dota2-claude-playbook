---
name: landmine-check
description: Use before committing any change that touches heroes, abilities, particles, bots, KV files, panorama, or spawn logic — sweeps the change against the engine's known silent failure modes
---

# Landmine check

The Dota 2 engine's failure mode of choice is *silence*: no error, no
traceback, a game that is subtly wrong. Before committing, check the change
against every invariant below that its diff plausibly touches. The full
catalog with symptoms and war stories is the playbook's chapter 4.

## The sweep

**Heroes / hero KV**
- Only BASE hero names anywhere (`SetCustomGameForceHero`, KV block keys,
  dispatch tables). `_custom` names do not resolve; the engine hands out a
  random stock hero at selection timeout.
- No `override_hero` keys — override base heroes in place.
- Anything spawned is precached in `GameMode.Precache`, or
  `CreateHeroForPlayer`/`ReplaceHeroWith` fails with "unit ... is invalid".

**Abilities / items / modifiers**
- Imported from `GameMode.ts` for the decorator side effect — an unimported
  ability simply does not exist, with no error.
- Variants imported AFTER their bases, from the entry file — importing a
  variant inside its base module makes a Lua require cycle that kills the
  whole addon load.
- Particles precached, or they render nothing, silently.
- Balance numbers in KV, read via `GetSpecialValueFor` — not hardcoded in TS.

**Bots / e2e**
- Never `dota_bot_populate` (hard-crashes the tools client in a laneless map).
- Fake clients seated at `CUSTOM_GAME_SETUP`, before selection closes.
- Bot heroes resolved via `heroForPlayer()`, never `GetSelectedHeroEntity`
  (nil for assigned heroes, the entire match).

**Panorama**
- `hittest="false"` down the tree unless a panel genuinely takes clicks — one
  full-screen hittest panel silently eats every native tooltip.
- Panorama is served COMPILED even in tools mode: no resourcecompile, no
  UI change.

**Build / entry**
- `debugPolyfill` stays the first import of `addon_game_mode.ts`;
  `sourceMapTraceback` stays `false`.
- No compiled Lua or panorama JS in the commit — build outputs are gitignored;
  never edit the Lua directly.

**Spawns / arena**
- Custom FFA teams have no Hammer spawn points — `spawnPositions.ts` owns
  repositioning; do not remove or bypass it.
- Fountain-less arena keeps `SetUseUniversalShopMode(true)` or purchases
  strand in the stash.

## After the sweep

If the change survived something NOT on this list — a fresh surprise — add it
to `CLAUDE.md`'s Architecture invariants in the same commit. That is how this
list got here.
