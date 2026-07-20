import { describe, expect, it } from "vitest";
import { ScoreTracker } from "../score";

describe("ScoreTracker", () => {
    it("counts kills per player", () => {
        const s = new ScoreTracker(20);
        s.recordKill(3);
        expect(s.recordKill(3)).toEqual({ total: 2, hasWon: false });
        expect(s.getKills(3)).toBe(2);
        expect(s.getKills(7)).toBe(0);
    });

    it("declares winner at exactly killsToWin", () => {
        const s = new ScoreTracker(3);
        s.recordKill(1); s.recordKill(1);
        expect(s.recordKill(1)).toEqual({ total: 3, hasWon: true });
        expect(s.winner).toBe(1);
    });

    it("ignores kills after game is won", () => {
        const s = new ScoreTracker(1);
        s.recordKill(1);
        expect(s.recordKill(2)).toEqual({ total: 0, hasWon: false });
        expect(s.winner).toBe(1);
    });

    it("tracks the leader", () => {
        const s = new ScoreTracker(20);
        expect(s.leader()).toBeUndefined();
        s.recordKill(4); s.recordKill(4); s.recordKill(9);
        expect(s.leader()).toEqual({ player: 4, kills: 2 });
    });
});
