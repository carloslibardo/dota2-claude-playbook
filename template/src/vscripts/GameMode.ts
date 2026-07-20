import { reloadable } from "./lib/tstl-utils";
import { ScoreTracker } from "./lib/score";
import { SpawnPositions } from "./systems/spawnPositions";
import { E2EHarness, e2eEnabled, e2eKillTarget } from "./systems/e2eHarness";

// Abilities are imported for their SIDE EFFECT (the @registerAbility decorator
// runs at module load). TSTL only emits Lua for modules reachable from the
// entry point, so an ability you forget to import here simply does not exist
// at runtime — with no error. See playbook landmine L8.
import "./abilities/example_ability";

declare global {
    interface CDOTAGameRules {
        Addon: GameMode;
    }
}

const KILLS_TO_WIN = 10;
const RESPAWN_SECONDS = 5;
/** Ten single-slot teams = free-for-all. Two stock teams + the eight custom ones. */
const FFA_TEAMS = [
    DotaTeam.GOODGUYS, DotaTeam.BADGUYS,
    DotaTeam.CUSTOM_1, DotaTeam.CUSTOM_2, DotaTeam.CUSTOM_3, DotaTeam.CUSTOM_4,
    DotaTeam.CUSTOM_5, DotaTeam.CUSTOM_6, DotaTeam.CUSTOM_7, DotaTeam.CUSTOM_8,
];

@reloadable
export class GameMode {
    private score = new ScoreTracker(e2eKillTarget(KILLS_TO_WIN));
    private e2e = new E2EHarness();

    public static Precache(this: void, context: CScriptPrecacheContext) {
        // Anything you spawn or play at runtime must be precached HERE or it
        // silently fails: an un-precached hero makes CreateHeroForPlayer fail
        // with "unit ... is invalid", and an un-precached particle renders
        // absolutely nothing with no error at all (landmines L3 / L12).
        PrecacheUnitByNameSync("npc_dota_hero_windrunner", context);
        PrecacheResource(
            "particle",
            "particles/units/heroes/hero_windrunner/windrunner_spell_powershot.vpcf",
            context,
        );
    }

    public static Activate(this: void) {
        // Convars must be registered before the GameMode instance is built —
        // the `score` field initializer already reads one of them.
        Convars.RegisterConvar("hello_arena_e2e", "0", "Engage the headless e2e harness (tools only)", ConVarFlags.NONE);
        Convars.RegisterConvar("hello_arena_e2e_kills", "0", "e2e win-threshold override (0 = real KILLS_TO_WIN)", ConVarFlags.NONE);
        GameRules.Addon = new GameMode();
    }

    constructor() {
        this.configure();
        ListenToGameEvent("game_rules_state_change", () => this.onStateChange(), undefined);
        // The eight CUSTOM_* teams have no Hammer spawn points, so without this
        // every hero on them spawns at the world origin, in one pile (L7).
        new SpawnPositions(FFA_TEAMS);
    }

    private configure(): void {
        for (const team of FFA_TEAMS) {
            GameRules.SetCustomGameTeamMaxPlayers(team, 1); // 10 teams x 1 slot = FFA
        }
        GameRules.SetHeroSelectionTime(0);
        GameRules.SetStrategyTime(0);
        GameRules.SetShowcaseTime(0);
        GameRules.SetPreGameTime(5);

        const mode = GameRules.GetGameModeEntity();
        // This MUST be a BASE hero name. A custom name like
        // "npc_dota_hero_windrunner_custom" does not resolve: the hero grid
        // appears anyway (unclickable), and at timeout the engine hands the
        // player a random stock hero. Override base heroes in place in
        // `game/scripts/npc/npc_heroes_custom.txt` instead (landmine L2).
        mode.SetCustomGameForceHero("npc_dota_hero_windrunner");
        mode.SetFixedRespawnTime(RESPAWN_SECONDS);
        mode.SetAnnouncerDisabled(true);
        // Arenas have no fountain, so without universal shop mode every native
        // store purchase strands in the stash forever (landmine L13).
        GameRules.SetUseUniversalShopMode(true);

        ListenToGameEvent("entity_killed", event => this.onEntityKilled(event), undefined);
    }

    private onStateChange(): void {
        const state = GameRules.State_Get();
        if (state === GameState.CUSTOM_GAME_SETUP) {
            // e2e bots must be seated HERE, before hero selection closes —
            // seat them later and CreateHeroForPlayer rejects them with
            // "bogus player id" and they end up heroless (landmine L6).
            this.e2e.seatEarly();
            Timers.CreateTimer(IsInToolsMode() ? 3 : 5, () => GameRules.FinishCustomGameSetup());
        }
        if (state === GameState.GAME_IN_PROGRESS) {
            this.e2e.start();
        }
    }

    private onEntityKilled(event: EntityKilledEvent): void {
        const killed = EntIndexToHScript(event.entindex_killed) as CDOTA_BaseNPC | undefined;
        if (!killed || !killed.IsRealHero()) return;

        const attacker = EntIndexToHScript(event.entindex_attacker) as CDOTA_BaseNPC | undefined;
        const owner = attacker?.GetPlayerOwnerID();
        if (owner === undefined || owner === -1 || owner === killed.GetPlayerOwnerID()) return; // no self-kill credit

        const { total, hasWon } = this.score.recordKill(owner);
        // Post-win kills return total=0 (the tracker freezes at the first
        // winner); writing that to the net table would zero the killer's HUD.
        if (total === 0) return;
        CustomNetTables.SetTableValue("hello_arena_score", tostring(owner), { kills: total });
        if (e2eEnabled()) print(`[E2E] kill credited: player ${owner} -> ${total} kill(s)`);

        if (hasWon && attacker) {
            GameRules.SetGameWinner(attacker.GetTeam());
            // The marker the VM test rig greps for to call the run a PASS.
            if (e2eEnabled()) print(`[E2E] WIN player ${owner} reached ${total} kills`);
        }
    }

    /** Called on `script_reload` in tools mode. */
    public Reload() {
        print("Script reloaded!");
    }
}
