/**
 * The hero a player currently controls — works for BOTH humans and bots.
 *
 * Humans pick through hero selection, so `PlayerResource.GetSelectedHeroEntity`
 * returns their hero. Bots do not: they are seated around hero selection and
 * get their hero from `CreateHeroForPlayer`, which sets the player's ASSIGNED
 * hero but not its SELECTED hero. So the selected accessor is nil for every
 * bot, for the entire match.
 *
 * Worse, for `CreateHeroForPlayer` bots BOTH accessors can return nil while the
 * hero is alive, fighting, and crediting kills. The symptom is a bot driver
 * that logs "driving 0 bots" through a match that visibly plays fine.
 *
 * So: prefer selected, fall back to assigned, and last-resort scan the live
 * hero list for one whose owner is this player. `HeroList` is at most the
 * player count, so the scan is cheap.
 */
export function heroForPlayer(playerId: PlayerID): CDOTA_BaseNPC_Hero | undefined {
    const selected = PlayerResource.GetSelectedHeroEntity(playerId);
    if (selected !== undefined && !selected.IsNull()) return selected;

    const player = PlayerResource.GetPlayer(playerId);
    if (player !== undefined) {
        const assigned = player.GetAssignedHero();
        if (assigned !== undefined && !assigned.IsNull()) return assigned;
    }

    const count = HeroList.GetHeroCount();
    for (let i = 0; i < count; i++) {
        const hero = HeroList.GetHero(i);
        if (hero !== undefined && !hero.IsNull() && hero.GetPlayerOwnerID() === playerId) return hero;
    }
    return undefined;
}
