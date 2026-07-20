---
name: panorama-ui
description: Use when building or changing any UI under src/panorama/ or content/panorama/ — Panorama's serving model, the server→client data paths, and the layout/style traps
---

# Panorama UI

Panorama is Valve's HTML-ish UI layer: XML layouts, a CSS dialect, and
TypeScript compiled to JS. It looks like the web and then punishes you for
believing that.

## The serving model (trap #1)

**Panorama is served COMPILED, even in tools mode.** Lua reloads live;
panorama does not. Your `.js` changes reach the client only after
`resourcecompiler` runs (the VM rig's cook step, or Workshop Tools' compile
on load). Symptom of forgetting: "my UI change does nothing" while the game
happily runs week-old JS. The layout/style/script trio:

```
content/panorama/layout/custom_game/hud.xml
content/panorama/styles/custom_game/hud.css
content/panorama/scripts/custom_game/hud.js   <- compiled from src/panorama/
```

`custom_ui_manifest.xml` declares which layouts load and when.

## Server → client data

Two channels; pick deliberately:

- **NetTables** — state. `CustomNetTables.SetTableValue(table, key, value)`
  server-side; `CustomNetTables.SubscribeNetTableListener` + an initial
  `GetTableValue` read client-side (subscribe alone misses values set before
  the panel loaded — always read current state on init). Table names are
  declared in `game/scripts/custom_net_tables.txt`; type the payloads once in
  `src/common/netTables.d.ts` and import from BOTH sides, so a shape change
  is a compile error instead of a silent `undefined` in the HUD.
- **Custom game events** — moments. `CustomGameEventManager.Send_ServerToAllClients`
  / `Send_ServerToPlayer`; client `GameEvents.Subscribe`. Payloads: plain
  tables only — no entity handles (send `entindex` numbers). Declare payload
  types in `src/common/` too.

Client → server: `GameEvents.SendCustomGameEventToServer` — validate
EVERYTHING server-side; the client is the player's machine.

## hittest (trap #2)

Panels default to `hittest="true"`. One full-screen container with default
hittest silently swallows every mouseover in the game — native tooltips die,
clicks feel wrong, nothing errors. Rule: `hittest="false"` on every panel in
the tree except the exact elements that take clicks.

## Layout & style dialect

- It is NOT CSS: no `z-index` (use XML order + `overscroll`/`depth` tricks),
  flow via `flow-children="right|down"`, alignment via `align`/`margin`,
  `width`/`height` in `px` or `%`. Many web properties simply don't exist —
  when a style is ignored, check the property exists in Panorama at all
  before debugging your selector.
- Selectors: classes and IDs only, no descendant combinators like the web —
  keep styling flat.
- `$.Msg(...)` is your `console.log`; output lands in the client console —
  which means the VM rig's console.log scan can assert on UI-side markers
  too.
- Animations: `transition:` works for many properties and is cheap; prefer
  it over JS-driven per-frame updates.

## Structure

- One panel = one layout + one script + one style file, same basename.
- Script side is event-driven: subscribe in the layout's script load, keep
  handlers small, derive all display state from nettables (re-renderable
  from scratch) rather than accumulating client-only state — panorama panels
  reload at odd times (rejoin, resolution change) and only nettable-derived
  UI survives that correctly.
- Shared types in `src/common/`, never duplicated string literals for table
  and event names — a drifted name fails silently (see the rename checklist
  in the template README).

## Testing UI without eyes

The click-sweep in the VM rig exists for panorama: inject real clicks at
panel coordinates, print `[UI]` markers from the click handlers, and the log
tells you whether the panel got the hit, the click fell through to the world,
or input never arrived. For anything visual beyond hit-testing: screenshots
or frames, reviewed — a log line cannot prove a panel rendered.
