---
name: kv-authoring
description: Use when touching any file under game/scripts/npc/ or game/resource/ — Valve KeyValues authoring rules for heroes, abilities, items, localization, and the five registrations every new thing needs
---

# KV authoring

Valve KeyValues files are the engine's data layer. They are stringly-typed,
unvalidated, and silently ignore what they do not understand — a typo'd key
is not an error, it is a default you did not choose.

## Format rules

- Quoted `"key" "value"` pairs; `//` comments; braces for blocks. Tabs vs
  spaces do not matter; consistency does.
- **Duplicate keys: last one wins, silently.** A merge that leaves two
  `"AbilityDamage"` lines is a balance bug with no symptom but the number.
- Numbers are strings. `"1 2 3"` is a valid value (space-separated arrays,
  used for per-level values: `"AbilityDamage" "100 200 300"`).
- KV files are read at addon load — changes need a game restart (tools mode:
  usually a `script_reload` is NOT enough for KV; relaunch).

## The files

| File | Owns |
|---|---|
| `npc_heroes_custom.txt` | Hero overrides — keyed by BASE hero name, no `override_hero` (landmine L2) |
| `npc_abilities_custom.txt` | Custom abilities: behavior flags, cast point/range, mana, cooldown, `AbilityValues` |
| `npc_items_custom.txt` | Items — same shape as abilities plus cost/shop metadata |
| `npc_units_custom.txt` | Non-hero units (wards, summons) |
| `herolist.txt` | Which heroes are selectable — must agree with what you force/precache |
| `../resource/addon_english.txt` | Every player-visible string |

## AbilityValues — the balance interface

```
"AbilityValues"
{
    "damage"        "120 180 240"
    "arrow_speed"   "1600"
}
```
TS reads these with `GetSpecialValueFor("damage")`. The contract: TS never
hardcodes a number KV could own; the spec's numbers table cites where each
value came from. Rename a value key and the TS read returns 0 — silently.
Grep for the key name on both sides after any rename.

## Localization

Every ability/item needs tokens in `addon_english.txt`:

```
"DOTA_Tooltip_ability_my_arrow"              "Piercing Arrow"
"DOTA_Tooltip_ability_my_arrow_Description"  "Fires an arrow that..."
"DOTA_Tooltip_ability_my_arrow_damage"       "DAMAGE:"
```

Missing tokens render literally as `#DOTA_Tooltip_ability_my_arrow` in game —
ugly, and a reliable smoke-test signal. Value-name tokens (prefixed with the
value key) make numbers show in tooltips. Localization files are read from
`game/resource/`; other languages are additional `addon_<language>.txt`
files, English is the fallback.

## The five registrations

Every new ability or item exists five times. Miss one and the failure is
silent:

1. KV block (`npc_abilities_custom.txt` / `npc_items_custom.txt`)
2. TS class with matching name (`@registerAbility`)
3. Import from the entry file (side effect — or the class never registers)
4. Precache for its particles/sounds/models
5. Localization tokens

`/landmine-check` sweeps 1–4; tooltips in a playtest catch 5.

## Hero KV specifics

- Key blocks by base hero name; only deltas — everything unstated inherits.
- Removing right-click: `"AttackCapabilities" "DOTA_UNIT_CAP_NO_ATTACK"` is
  what works; a 1-damage floor alone still lets chip damage through.
- `Ability1..Ability6`: empty string (`""`) clears an inherited slot; the
  slots you do not mention keep the stock hero's spells — usually not what a
  total-conversion wants.
- `herolist.txt` must include every hero you `SetCustomGameForceHero` or
  offer in selection, and each of those must be precached before first spawn.
