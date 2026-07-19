/**
 * Custom game events sent between the UI (Panorama) and the server (VScripts).
 *
 * Both `src/vscripts/tsconfig.json` and `src/panorama/tsconfig.json` include
 * `../common/**\/*.d.ts`, so a payload declared here is type-checked identically
 * on both sides. Declaring it once here is the only way to keep them honest.
 *
 * IMPORTANT: the engine mangles event data in transit, so Panorama handlers see
 * `NetworkedData<EventType>`:
 *   - booleans arrive as 0 | 1
 *   - arrays arrive as objects keyed "0", "1", ... — convert them back yourself
 */

// Add an entry here for every event you want to send.
interface CustomGameEventDeclarations {
    /** Server -> client. Fired whenever a player's kill count changes. */
    hello_arena_score_changed: HelloArenaScoreChangedEventData;
}

interface HelloArenaScoreChangedEventData {
    playerId: number;
    kills: number;
}
