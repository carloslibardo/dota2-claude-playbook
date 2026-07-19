/**
 * The retail macOS Dota client ships its Lua VM WITHOUT the `debug` library
 * (tools mode and Windows retail keep it). Seen live 2026-07-05: anything
 * touching `debug.*` on a Mac client dies with "attempt to index global
 * 'debug' (a nil value)", masked by the engine as "Script Runtime Error:
 * error in error handling".
 *
 * This shim fills ONLY `debug.traceback` — enough for the error-handler
 * call sites that run unconditionally (lib/timers.lua wires it as an xpcall
 * handler on every tick; lualib_bundle uses it inside error paths). It
 * deliberately does NOT fake `debug.getinfo`: lib/dota_ts_adapter.ts checks
 * for the real getinfo and uses a stack-walk fallback when it is absent —
 * a fake would silently break that detection.
 *
 * MUST be the first import of addon_game_mode.ts so it runs before timers.
 */
if (debug === undefined) {
    // @ts-ignore intentional partial shim — see header comment.
    debug = {
        traceback: (messageOrThread?: unknown, message?: unknown): string => {
            if (typeof messageOrThread === "string") return messageOrThread;
            if (typeof message === "string") return message;
            return "";
        },
    } as never;
}

export {};
