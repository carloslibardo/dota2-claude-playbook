/**
 * Engine globals present in the live Dota 2 scripting API but missing from
 * @moddota/dota-lua-types 4.38.2. Every call site MUST nil-guard
 * (`if (Fn !== undefined)`) so an engine build without the global degrades
 * to a no-op instead of a script error.
 */

/**
 * Clamps the given players' cameras inside the [min, max] AABB.
 * Missing from the generated typings; verified against the Valve API dump.
 */
declare function SetCameraBoundsForPlayers(
    playerIds: PlayerID[],
    min: Vector,
    max: Vector,
): void;
