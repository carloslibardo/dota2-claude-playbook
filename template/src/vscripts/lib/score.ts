export class ScoreTracker {
  private kills = new Map<number, number>();
  public winner: number | undefined;

  constructor(private killsToWin: number) {}

  recordKill(killer: number): { total: number; hasWon: boolean } {
    if (this.winner !== undefined) return { total: 0, hasWon: false };
    const total = (this.kills.get(killer) ?? 0) + 1;
    this.kills.set(killer, total);
    const hasWon = total >= this.killsToWin;
    if (hasWon) this.winner = killer;
    return { total, hasWon };
  }

  getKills(player: number): number {
    return this.kills.get(player) ?? 0;
  }

  leader(): { player: number; kills: number } | undefined {
    let best: { player: number; kills: number } | undefined;
    for (const [player, kills] of this.kills) {
      if (!best || kills > best.kills) best = { player, kills };
    }
    return best;
  }
}
