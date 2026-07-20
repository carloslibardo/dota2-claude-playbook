import { describe, expect, it } from "vitest";
import { ringPosition } from "../spawnRing";

describe("ringPosition", () => {
    it("puts slot 0 due east of the center", () => {
        const [x, y] = ringPosition([0, 0], 1000, 0, 4);
        expect(x).toBeCloseTo(1000);
        expect(y).toBeCloseTo(0);
    });

    it("spaces slots evenly counter-clockwise", () => {
        const [x, y] = ringPosition([0, 0], 1000, 1, 4);
        expect(x).toBeCloseTo(0);
        expect(y).toBeCloseTo(1000);
    });

    it("is relative to the arena center", () => {
        const [x, y] = ringPosition([500, -200], 1000, 2, 4);
        expect(x).toBeCloseTo(-500);
        expect(y).toBeCloseTo(-200);
    });

    it("keeps every slot on the ring", () => {
        for (let slot = 0; slot < 10; slot++) {
            const [x, y] = ringPosition([0, 0], 3500, slot, 10);
            expect(Math.hypot(x, y)).toBeCloseTo(3500);
        }
    });
});
