/**
 * Evenly spaced spawn slots on a ring around the arena center — each player
 * owns a fixed rim spawn and fights converge inward. Slot 0 is due east; slots
 * advance counter-clockwise.
 *
 * This function touches no Dota globals: plain numbers in, plain numbers out.
 * That is deliberate, and it is the whole point — it means `__tests__/spawnRing.test.ts`
 * can run it on Node in a millisecond, on a laptop with no game installed,
 * while `systems/spawnPositions.ts` stays a thin shell that only translates
 * between the engine and this. See playbook chapter 05.
 */
export function ringPosition(
    center: readonly [number, number],
    radius: number,
    slot: number,
    slots: number,
): [number, number] {
    const angle = (2 * Math.PI * slot) / slots;
    return [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)];
}
