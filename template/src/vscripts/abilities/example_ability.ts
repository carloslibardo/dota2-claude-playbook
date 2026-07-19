import { BaseAbility, registerAbility } from "../lib/dota_ts_adapter";

/**
 * A skillshot: fire a linear projectile at the cursor, damage the first enemy
 * hero it touches. This is the whole shape of a TypeScript-authored ability.
 *
 * Three things have to line up or it will not work:
 *
 *  1. The class name here must EXACTLY match the ability key in
 *     `game/scripts/npc/npc_abilities_custom.txt`, whose `ScriptFile` points at
 *     this module's path relative to `game/scripts/vscripts/`.
 *  2. This module must be imported (for side effects) from `GameMode.ts`, or
 *     TSTL never emits the Lua and the ability silently does not exist.
 *  3. Every particle path used here must be precached in `GameMode.Precache`.
 *     An un-precached particle renders NOTHING, with no error whatsoever.
 *
 * Tunable numbers live in the KV file and are read back with
 * `GetSpecialValueFor`. Keeping them there means a balance change is a KV edit
 * with no recompile, and it is the same value the tooltip shows.
 */
@registerAbility()
export class example_ability extends BaseAbility {
    OnSpellStart(): void {
        const caster = this.GetCaster();
        const origin = caster.GetAbsOrigin();
        const diff = (this.GetCursorPosition() - origin) as Vector;
        diff.z = 0;
        const direction = diff.Normalized();

        ProjectileManager.CreateLinearProjectile({
            Ability: this,
            Source: caster,
            EffectName: "particles/units/heroes/hero_windrunner/windrunner_spell_powershot.vpcf",
            vSpawnOrigin: (origin + direction * 60) as Vector,
            fDistance: this.GetSpecialValueFor("range"),
            fStartRadius: 70,
            fEndRadius: 70,
            vVelocity: (direction * this.GetSpecialValueFor("speed")) as Vector,
            iUnitTargetTeam: UnitTargetTeam.ENEMY,
            iUnitTargetType: UnitTargetType.HERO,
            bProvidesVision: true,
            iVisionRadius: 200,
        });
        caster.EmitSound("Hero_WindRunner.Powershot");
    }

    /** Return true to consume the projectile, false to let it keep flying. */
    OnProjectileHit(target: CDOTA_BaseNPC | undefined, _location: Vector): boolean {
        if (!target) return true; // reached max distance without hitting anyone

        ApplyDamage({
            victim: target,
            attacker: this.GetCaster(),
            damage: this.GetSpecialValueFor("damage"),
            damage_type: DamageTypes.MAGICAL,
            ability: this,
        });
        return true; // the first hero hit stops the arrow
    }
}
