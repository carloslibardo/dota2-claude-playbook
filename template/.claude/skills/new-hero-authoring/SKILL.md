---
name: new-hero-authoring
description: Use when adding, replacing, or reworking a playable hero or a summoned unit — the base-hero override model, the five places a hero has to exist, and the selection/precache failures that hand players a random stock hero instead
---

# Hero authoring

The single most expensive misconception in Dota modding: **you do not create
heroes, you override existing ones in place.** A custom hero name does not
resolve, and the way it fails is that a player silently gets a random stock
hero. The full story is the playbook's chapter 4 (L2, L3) and casebook F3/F4.

## The model

- Pick a **base hero** whose model, animations and attack type suit the design.
  That base name (`npc_dota_hero_windrunner`) is the hero's real identity
  forever: `GetUnitName()` returns it, dispatch tables must key it, the KV block
  must be keyed by it.
- Write **only deltas** in `game/scripts/npc/npc_heroes_custom.txt` — everything
  unstated inherits from the stock hero.
- Never invent `npc_dota_hero_x_custom`, never use an `override_hero` key.
  `SetCustomGameForceHero` with a name the engine does not know does not error;
  it times out hero selection and assigns something at random.
- One base hero can back exactly one custom hero. Two custom heroes on the same
  base is the collision that has no symptom until both are in the same match.

## The five places a hero exists

Miss one and the failure is silent:

1. **KV block** in `npc_heroes_custom.txt`, keyed by the base name.
2. **`herolist.txt`** — every hero you force or offer in selection. Absent
   here, it is not selectable, and the grid still looks fine.
3. **`GameMode.Precache`** — precache the hero AND every particle/model/sound
   its abilities use. Un-precached: `CreateHeroForPlayer` / `ReplaceHeroWith`
   fail with "unit ... is invalid"; un-precached particles render *nothing*
   with no error at all.
4. **Abilities** — `Ability1..Ability6` in the KV block. An empty string (`""`)
   clears an inherited slot; slots you do not mention keep the stock hero's
   spells, which is almost never what a conversion wants. Each custom ability
   also needs its own five registrations (`/kv-authoring`).
5. **Localization** in `game/resource/addon_english.txt` — hero name and every
   ability tooltip, or the UI renders `#DOTA_Tooltip_...` literally.

## Resolving a hero at runtime

- **Always `lib/heroResolve.ts#heroForPlayer()`**, never
  `PlayerResource.GetSelectedHeroEntity` — bots are *assigned* heroes, not
  *selected* ones, so the selected accessor is nil for them the whole match.
- **Do not key state by entity index.** A hero replacement (`ReplaceHeroWith`,
  respawn-as, Meepo-likes) invalidates the index and every table keyed by it
  (L24). Key by player ID, or re-resolve.
- Validate stored handles before every use: `if (!hero || hero.IsNull()) return;`

## Common shapes

- **Removing right-click:** `"AttackCapabilities" "DOTA_UNIT_CAP_NO_ATTACK"`.
  A 1-damage floor alone still lets chip damage through.
- **Non-hero units** (summons, wards) go in `npc_units_custom.txt`, not the
  hero file, and still need precaching by whatever spawns them.
- **Stat/scaling overrides** are plain KV keys; put balance numbers here, not in
  TypeScript, and cite their source in the spec (`/sdd-feature`).

## Done means

- [ ] KV block keyed by a base hero, deltas only, no `_custom` name anywhere
- [ ] `herolist.txt` updated; hero + all its assets precached
- [ ] Every ability slot deliberate (`""` to clear, not silence)
- [ ] Localization tokens for hero and every ability
- [ ] Runtime lookups go through `heroForPlayer()`, keyed by player ID
- [ ] Evidence that the hero spawned *as itself*: an e2e marker naming the
      resolved unit name, plus a frame (`/evidence-gate`). "The match started"
      is exactly the observation a random stock hero also produces.
