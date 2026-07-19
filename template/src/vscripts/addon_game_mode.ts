// The engine's entry point. Everything the addon runs must be reachable by
// `import` from this file — TSTL only emits Lua for modules that are
// transitively reachable from the entry point (see playbook landmine L8).
//
// The import ORDER on the next two lines is load-bearing:
//   1. debugPolyfill — installs a `debug.traceback` shim BEFORE anything can
//      touch `debug.*`. The retail macOS client ships a Lua VM without the
//      `debug` library and every module dies at load without this (landmine L1).
//   2. timers — the community Timers library wires `debug.traceback` as an
//      xpcall handler on every tick, so it must come after the shim.
import "./lib/debugPolyfill";
import "./lib/timers";
import { GameMode } from "./GameMode";

// Hand the engine the two globals it looks for by name.
Object.assign(getfenv(), {
    Activate: GameMode.Activate,
    Precache: GameMode.Precache,
});

if (GameRules.Addon !== undefined) {
    // Only reached after `script_reload` in tools mode, never at cold start.
    GameRules.Addon.Reload();
}
