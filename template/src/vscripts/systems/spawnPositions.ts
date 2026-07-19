import { ringPosition } from "../lib/spawnRing";

/** Arena center and the radius of the spawn ring, in Hammer units. */
const ARENA_CENTER: readonly [number, number] = [0, 0];
const SPAWN_RADIUS = 3500;

/**
 * Fixed per-team spawn slots on a ring around the arena.
 *
 * A Hammer map ships spawn points for the two STOCK teams only. Heroes on the
 * eight `DotaTeam.CUSTOM_*` teams therefore spawn at the world origin — all of
 * them, in one pile, every respawn. Rather than placing ten spawners in Hammer
 * (a map recompile, Windows-only), this system repositions every real hero on
 * every spawn event to its team's slot on the ring.
 *
 * The geometry itself lives in `lib/spawnRing.ts`, which touches no engine
 * globals and is therefore unit-tested. This file is the thin engine-facing
 * shell around it — the purity split described in playbook chapter 05.
 */
export class SpawnPositions {
    constructor(private readonly ffaTeams: readonly DotaTeam[]) {
        ListenToGameEvent("npc_spawned", event => this.onNpcSpawned(event), undefined);
    }

    private onNpcSpawned(event: NpcSpawnedEvent): void {
        const unit = EntIndexToHScript(event.entindex) as CDOTA_BaseNPC | undefined;
        if (!unit || !unit.IsRealHero()) return;

        const slot = this.ffaTeams.indexOf(unit.GetTeamNumber());
        if (slot < 0) return; // spectator or neutral — leave it where it is

        const [x, y] = ringPosition(ARENA_CENTER, SPAWN_RADIUS, slot, this.ffaTeams.length);
        // Wait one frame: CreateHeroForPlayer / ReplaceHeroWith finish
        // positioning the unit AFTER npc_spawned fires, so a synchronous
        // teleport here would be silently overwritten.
        Timers.CreateTimer(0.03, () => {
            if (unit.IsNull() || !unit.IsAlive()) return;
            FindClearSpaceForUnit(unit, GetGroundPosition(Vector(x, y, 0), unit), true);
            unit.Stop();
        });
    }
}
