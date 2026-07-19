/**
 * Convar-gated headless end-to-end harness.
 *
 * This is what lets a machine with no human in front of it prove the game
 * actually works. Launch Dota in tools mode with `+hello_arena_e2e 1`, and the
 * harness seats bots, drives them at each other until someone wins, and prints
 * `[E2E]` markers the VM rig greps out of `console.log` to issue a verdict.
 * See `testrig/` and playbook chapter 06.
 *
 * Convars:
 *   hello_arena_e2e         1 engages the harness (default 0, tools mode only)
 *   hello_arena_e2e_kills   win-threshold override, to keep runs bounded
 *
 * Every code path here is inert in a real match. That matters: the harness must
 * never be able to affect a game a human is playing.
 *
 * TWO WAYS TO SEAT BOTS — pick by mode, and never use `dota_bot_populate`,
 * which hard-crashes the tools client in a laneless FFA map (landmine L4):
 *
 *   - `dota_create_fake_clients` (used here) is CHEAT-GATED. It works in tools
 *     mode, where sv_cheats is on, and is SILENTLY IGNORED on a retail client —
 *     you get a log line, zero joins, and no error.
 *   - `GameRules.AddBotPlayerWithEntityScript` is the cheat-free API for
 *     filling a real lobby. It creates the hero itself, so it is seated at the
 *     horn rather than during setup.
 */
import { heroForPlayer } from "../lib/heroResolve";

const MAX_PLAYER_SLOTS = 24;
const THINK_INTERVAL = 0.5;
const ATTACK_RANGE = 900;

export function e2eEnabled(): boolean {
    return IsInToolsMode() && (Convars.GetInt("hello_arena_e2e") ?? 0) > 0;
}

/** The real win threshold, unless a smaller smoke-run override is set. */
export function e2eKillTarget(fallback: number): number {
    if (!e2eEnabled()) return fallback;
    const override = Convars.GetInt("hello_arena_e2e_kills") ?? 0;
    return override > 0 ? override : fallback;
}

export class E2EHarness {
    private seated = false;
    private started = false;

    /**
     * Seat the fake clients during CUSTOM_GAME_SETUP — before hero selection
     * closes. Seated any later, they are rejected by CreateHeroForPlayer with
     * "bogus player id" and spend the match heroless (landmine L6).
     */
    public seatEarly(): void {
        if (this.seated || !e2eEnabled()) return;
        this.seated = true;
        print("[E2E] seating fake clients during setup");
        SendToServerConsole("dota_create_fake_clients");
    }

    /** Start the think loop once the match is actually live. */
    public start(): void {
        if (this.started || !e2eEnabled()) return;
        this.started = true;
        print("[E2E] harness engaged — driving bots");
        // Perma-day. The day/night cycle renders night rounds near-black, which
        // makes every screenshot the rig captures worthless (landmine L15).
        Timers.CreateTimer(0, () => {
            GameRules.SetTimeOfDay(0.5);
            return 60;
        });
        Timers.CreateTimer(THINK_INTERVAL, () => this.think());
    }

    /** Player ids of the seated fake clients — never a human. */
    private bots(): PlayerID[] {
        const ids: PlayerID[] = [];
        for (let i = 0; i < MAX_PLAYER_SLOTS; i++) {
            const id = i as PlayerID;
            if (!PlayerResource.IsValidPlayerID(id)) continue;
            if (!PlayerResource.IsFakeClient(id)) continue;
            ids.push(id);
        }
        return ids;
    }

    private think(): number {
        for (const id of this.bots()) {
            // NOT PlayerResource.GetSelectedHeroEntity — it returns nil for
            // every bot, because bots get heroes ASSIGNED rather than selected
            // (landmine L5). heroForPlayer() walks all three fallbacks.
            const hero = heroForPlayer(id);
            if (!hero || hero.IsNull() || !hero.IsAlive()) continue;

            const target = this.nearestEnemyHero(hero);
            if (!target) continue;

            const distance = ((target.GetAbsOrigin() - hero.GetAbsOrigin()) as Vector).Length2D();
            const ability = hero.GetAbilityByIndex(0);
            if (ability && distance < ATTACK_RANGE && ability.IsFullyCastable()) {
                ExecuteOrderFromTable({
                    UnitIndex: hero.entindex(),
                    OrderType: UnitOrder.CAST_POSITION,
                    AbilityIndex: ability.entindex(),
                    Position: target.GetAbsOrigin(),
                    Queue: false,
                });
            } else {
                ExecuteOrderFromTable({
                    UnitIndex: hero.entindex(),
                    OrderType: UnitOrder.MOVE_TO_POSITION,
                    Position: target.GetAbsOrigin(),
                    Queue: false,
                });
            }
        }
        return THINK_INTERVAL;
    }

    private nearestEnemyHero(hero: CDOTA_BaseNPC_Hero): CDOTA_BaseNPC_Hero | undefined {
        let best: CDOTA_BaseNPC_Hero | undefined;
        let bestDistance = Number.MAX_SAFE_INTEGER;
        const count = HeroList.GetHeroCount();
        for (let i = 0; i < count; i++) {
            const other = HeroList.GetHero(i);
            if (!other || other.IsNull() || !other.IsAlive()) continue;
            if (other.GetTeamNumber() === hero.GetTeamNumber()) continue;
            const distance = ((other.GetAbsOrigin() - hero.GetAbsOrigin()) as Vector).Length2D();
            if (distance < bestDistance) {
                bestDistance = distance;
                best = other;
            }
        }
        return best;
    }
}
