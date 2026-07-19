// Root bootstrap for the "Hud" CustomUIElement (layout/custom_game/hud.xml).
//
// Panorama has no module system: every included .js file shares one global
// scope, so each file wraps its logic in an IIFE to avoid name collisions.
// The compiled output of this file is included by hud.xml's <scripts> block.
(function () {
    $.Msg("[UI] Hud loaded");

    const rows = $("#ScoreRows");
    const title = $("#ScoreTitle") as LabelPanel;

    function refresh(): void {
        const table = CustomNetTables.GetAllTableValues("hello_arena_score");
        rows.RemoveAndDeleteChildren();
        let total = 0;
        for (const entry of table) {
            const playerId = Number(entry.key) as PlayerID;
            const kills = entry.value.kills;
            total += kills;
            const label = $.CreatePanel("Label", rows, `ScoreRow${playerId}`);
            label.AddClass("Score__Row");
            label.text = `${Players.GetPlayerName(playerId)}  ${kills}`;
        }
        title.text = total > 0 ? "SCORE" : "SCORE — no kills yet";
    }

    // Net tables hold STATE, not one-shot events, so a UI that finishes loading
    // late can still read the current value. Subscribe, then read once now.
    CustomNetTables.SubscribeNetTableListener("hello_arena_score", () => refresh());
    refresh();
})();
