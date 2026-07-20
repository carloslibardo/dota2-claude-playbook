---
name: tstl-lua-gotchas
description: Use when writing or reviewing any src/vscripts TypeScript — the places where TypeScriptToLua's output behaves differently from real TypeScript, and the Lua-side practices that keep a 10-player server tick smooth
---

# TSTL and Lua gotchas

The code you write is TypeScript; the code that runs is Lua 5.1 inside Source 2.
Most of TS maps over cleanly. These are the seams.

## Semantics that silently differ

- **Truthiness.** In Lua only `false` and `nil` are falsy — `0`, `""`, and
  `NaN` are TRUE. `if (count)` passes when count is 0. tstl emits a warning
  ("Only false and nil evaluate to 'false'") every time you test a
  number/string — heed it: write `if (count > 0)`, `if (name !== "")`,
  `if (x !== undefined)`. Never boolean-test a numeric.
- **`undefined` IS `nil`.** One value, two names. `null` also compiles to
  `nil` — do not build logic that distinguishes them. Engine APIs return nil
  for "no entity"; type them `X | undefined` and guard.
- **Array indexing is translated, but interop is 1-based.** TS arrays work as
  expected (`arr[0]` is translated). But a Lua table arriving FROM the engine
  (`FindUnitsInRadius`, KV tables, event payloads) is 1-based and may have
  holes — iterate engine tables with `for..of` or the translated helpers,
  never with manual index math you carried over from the TS side.
- **`Map`/`Set`/object iteration order is undefined.** Lua `pairs` order is
  arbitrary and can differ run-to-run. Never let game logic depend on
  iteration order; sort explicitly when order matters (bot target selection,
  UI lists, anything compared in tests).
- **`array.sort` is Lua `table.sort`: NOT stable, and a comparator that
  returns true for equal elements ("invalid order function") can error or
  corrupt the sort.** Comparators must be strict-less-than. Tiebreak
  explicitly (e.g. by entity index) if stability matters.
- **No `async/await`, no Promises, no `setTimeout`.** Timing goes through
  `Timers.CreateTimer`. Long operations block the server tick — there is no
  event loop to yield to.
- **`Date.now()`/`performance.now()` don't exist** — use `GameRules.GetGameTime()`
  (pauses with the game) or `Time()` (wall clock).
- **JSON:** use the engine's `json.encode/decode` equivalents or write KV;
  `JSON.stringify` is polyfilled by tstl's lualib but verify before trusting
  it on engine userdata (it cannot serialize entity handles).
- **`===` vs `==`:** both compile to Lua `==`. Type-confused comparisons that
  TS would flag can slip through `any` — keep `any` out of vscripts.
- **Multi-returns:** engine functions documented as returning multiple values
  arrive as tuples via declarations; destructure them, don't index.

## Engine-handle hygiene

- Entity handles outlive their entities. Before EVERY use of a stored handle:
  `if (!unit || unit.IsNull()) return;`. `IsNull` first, then `IsAlive` if you
  need liveness — calling methods on a null handle is a script error at
  runtime, and "attempt to index" errors in a think function kill that think
  silently forever after.
- Never store handles across long timers without re-validating. Prefer
  storing `entindex` + `EntIndexToHScript` re-resolution for anything held
  longer than a tick.

## Performance on the server tick

10 players + bots + projectiles share one Lua state and one GC.

- **Do not allocate in per-tick thinks.** Every `[]`, `{}`, closure, or
  string concat inside a 0.1 s think is GC pressure × entities × ticks.
  Hoist arrays and reuse them; precompute strings.
- **`FindUnitsInRadius` is expensive.** One scan per think per bot, shared
  and cached in a perception layer — not one per decision that needs
  neighbors.
- **Think intervals:** 0.1–0.25 s for combat decisions, 0.5–1 s for strategy.
  Returning the interval from the timer callback re-arms it; returning
  `undefined` stops it — a think that accidentally returns nothing dies
  silently.
- **`print` is not free** in hot paths, and console.log grows unbounded with
  `-condebug`. Gate diagnostic prints behind a convar.

## Structure rules (see also /sdd-feature)

- Pure decision logic in `lib/` — zero engine globals — tested with vitest on
  any machine. Engine-facing files stay thin translators.
- Every ability/modifier module is imported from `GameMode.ts` for its
  decorator side effect; variants AFTER bases, from the entry file, or you
  manufacture a `require` cycle that kills the addon load.
- Compiled Lua is a build output. Never edit it, never commit it, never
  "quickly patch" it on a VM — it evaporates on the next build.
