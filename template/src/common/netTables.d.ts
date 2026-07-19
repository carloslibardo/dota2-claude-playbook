/**
 * Custom net table contracts — the server writes them, the Panorama UI reads
 * them. Declared once so both `tsc` programs check against the same shape.
 *
 * A table also has to be listed by NAME in `game/scripts/custom_net_tables.txt`
 * or the engine silently refuses the write. Keep the two in sync.
 *
 * Prefer a net table over a fire-once event for anything that is STATE: a
 * client whose UI loads late still reads the current value, whereas an event
 * fired before the panel existed is gone forever.
 */
interface CustomNetTableDeclarations {
    /** Player id (stringified) -> running kill count. Written by `GameMode.onEntityKilled`. */
    hello_arena_score: Record<string, { kills: number }>;
}
