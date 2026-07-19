# 4. Landmines

Sixteen things that cost real days, with the symptom you will actually see, the
cause, and the fix.

They share a shape. Almost none of them produce an error at the place where the
mistake is. The Dota 2 engine's dominant failure mode is **silence**: a wrong
hero name, a missing precache, an unimported module, a mis-set attribute — all
of them produce a game that starts, runs, and is quietly wrong. Several produce
a *misleading* error somewhere else entirely.

If you are debugging something in this stack and the symptom does not point
anywhere, scan this list before you start bisecting.

---

## L1 — `sourceMapTraceback` kills the addon on retail macOS

**Symptom.** The addon does not load. The console says
`Script Runtime Error: error in error handling` and nothing else. Works fine in
tools mode. Works fine on Windows.

**Cause.** tstl emits `__TS__SourceMapTraceBack(debug.getinfo(...))` at the top
of every output file. The retail macOS Dota client ships a Lua VM **without the
`debug` library** — tools mode and Windows retail both keep it. So every module
dies at load with "attempt to index global 'debug' (a nil value)", and because
this happens inside the error path, the engine can only report that error
handling itself failed.

**Fix.** Both halves:

1. `"sourceMapTraceback": false` in `src/vscripts/tsconfig.json`.
2. `lib/debugPolyfill.ts`, shimming **only** `debug.traceback`, imported first
   in `addon_game_mode.ts` — before `timers`, which wires `debug.traceback` as
   an xpcall handler on every tick.

The shim deliberately does **not** fake `debug.getinfo`. `dota_ts_adapter.ts`
feature-detects the real `getinfo` and falls back to a stack walk when it is
absent; a fake would silently break that detection.

*Observed live 2026-07-05.*

---

## L2 — custom hero names silently do not exist

**Symptom.** You call `SetCustomGameForceHero("npc_dota_hero_windrunner_custom")`.
The hero-selection grid appears anyway, unclickable, with a vestigial 30-second
timer. At timeout the engine assigns a random stock hero. A playtester reports
they got Invoker in your archer game.

**Cause.** A hero name that does not resolve does not raise. `SetCustomGameForceHero`
is best-effort, and the fallback is Dota's normal random assignment.

**Fix.** Override **base heroes in place** in `npc_heroes_custom.txt` — the
pattern Open Angel Arena uses. Your "Assault" archer *is* `npc_dota_hero_windrunner`,
with different stats and abilities.

**Consequence, and it is a big one:** `GetUnitName()` returns the BASE name
forever. Any hero-keyed dispatch table — ability kits, class lookups, portrait
mapping — must key base names. Getting this half right and half wrong produces a
game where some classes work.

*Observed live 2026-07-05 ("Carlos got Invoker").*

---

## L3 — un-precached heroes make hero creation fail

**Symptom.** Eleven players lock in a class. Zero heroes spawn.
`CreateHeroForPlayer` / `ReplaceHeroWith` log "unit ... is invalid".

**Cause.** The engine precaches the map's forced hero and whatever it expects to
need. Your custom heroes are never the forced hero, so it never precaches them,
and creating an un-precached hero fails.

**Fix.** Loop `PrecacheUnitByNameSync` over every hero your game can produce, in
`Precache()`.

**The same applies to particles, and worse.** A non-precached particle path used
as a projectile renders **absolutely nothing** — no projectile, no error, no
warning. The ability fires, the damage lands, the arrow is invisible. Precache
every particle path you reference.

*Observed 2026-07-05 (heroes) and 2026-07-13 (particles).*

---

## L4 — bot seating is mode-dependent, and one API crashes the client

**Symptom (the crash).** `dota_bot_populate` in a laneless FFA map hard-crashes
the tools client. The process dies. No traceback, no minidump, nothing in the
log.

**Symptom (the silent one).** You switch to `dota_create_fake_clients`, it works
perfectly in tools mode, you ship, and in real lobbies the log says "seating
fill bots" and zero bots ever join.

**Cause and fix.** There are two APIs and they are not interchangeable:

| API | Works in | Notes |
|---|---|---|
| `dota_bot_populate` | nowhere, for this | Hard-crashes the tools client in a laneless map |
| `dota_create_fake_clients` | **tools mode only** | Cheat-gated. Silently ignored on retail clients — you get your own log line and no joins |
| `GameRules.AddBotPlayerWithEntityScript` | **real matches** | Cheat-free. Creates the hero itself, so it is seated at the horn |

So a headless e2e harness uses fake clients (seated at `CUSTOM_GAME_SETUP`, see
L6), and real-lobby bot fill uses `AddBotPlayerWithEntityScript` (seated at
`GAME_IN_PROGRESS`). One driver, two entry points.

> This landmine is also a lesson about invariants. Archer Wars' `CLAUDE.md` said
> "always fake clients, never `bot_populate`" — true, but it flattens the
> tools/retail split, which is where the second failure lives. See the end of
> [chapter 3](03-sdd-loop.md).

*Observed live 2026-07-05.*

---

## L5 — bots have neither a selected nor an assigned hero

**Symptom.** Your bot driver logs "driving 0 bots" for an entire match that
visibly plays fine — the bots move, shoot, kill each other, and score.

**Cause.** `PlayerResource.GetSelectedHeroEntity()` returns nil for bots. They
are seated after selection closes and get their hero from `CreateHeroForPlayer`,
which sets the player's **assigned** hero, not its **selected** one. And for
`CreateHeroForPlayer` bots specifically, **both** accessors can return nil while
the hero is alive and crediting kills.

**Fix.** One resolver, used everywhere:

```ts
export function heroForPlayer(playerId: PlayerID): CDOTA_BaseNPC_Hero | undefined {
    const selected = PlayerResource.GetSelectedHeroEntity(playerId);
    if (selected !== undefined && !selected.IsNull()) return selected;

    const player = PlayerResource.GetPlayer(playerId);
    if (player !== undefined) {
        const assigned = player.GetAssignedHero();
        if (assigned !== undefined && !assigned.IsNull()) return assigned;
    }

    // Last resort: scan the hero list for one owned by this player.
    const count = HeroList.GetHeroCount();
    for (let i = 0; i < count; i++) {
        const hero = HeroList.GetHero(i);
        if (hero !== undefined && !hero.IsNull() && hero.GetPlayerOwnerID() === playerId) return hero;
    }
    return undefined;
}
```

`HeroList` is at most the player count, so the scan costs nothing.

*Observed live 2026-07-05.*

---

## L6 — seating order versus game state

**Symptom.** Fake clients seated after hero selection are rejected by
`CreateHeroForPlayer` with "bogus player id" and spend the match heroless.

**Cause.** Player slots are not fully valid for hero creation until setup has
seated them, and hero selection closing changes what the engine will accept.

**Fix.** Timing differs by mode, and it follows from L4:

- **e2e bots** seat at `CUSTOM_GAME_SETUP`, before selection — so
  `SetCustomGameForceHero` assigns each one a hero through the normal path.
- **Real-match fill** seats at `GAME_IN_PROGRESS`, because
  `AddBotPlayerWithEntityScript` creates its own hero and the host's bot-count
  choices are not final until the horn.

---

## L7 — custom FFA teams have no Hammer spawn points

**Symptom.** Nine bots spend the entire match piled on top of each other at map
center, brawling.

**Cause.** A Hammer map ships spawn points for the two **stock** teams. The
eight `DotaTeam.CUSTOM_*` teams have none, so every hero on them spawns at the
world origin — which, in a symmetric arena, is also usually somewhere important.

**Fix.** Reposition heroes in code rather than placing ten spawners in Hammer (a
map recompile, Windows-only). Listen for `npc_spawned`, map the team to a slot
index, and place the hero on a ring:

```ts
const [x, y] = ringPosition(ARENA_CENTER, SPAWN_RADIUS, slot, teams.length);
Timers.CreateTimer(0.03, () => {
    FindClearSpaceForUnit(unit, GetGroundPosition(Vector(x, y, 0), unit), true);
    unit.Stop();
});
```

The 0.03-second delay is itself a small landmine: `CreateHeroForPlayer` and
`ReplaceHeroWith` finish positioning the unit **after** `npc_spawned` fires, so
a synchronous teleport is silently overwritten.

*Observed live 2026-07-05.*

---

## L8 — TSTL only emits what the entry point can reach

**Symptom (a).** You write an ability, register it in the KV file, and it does
not exist at runtime. No Lua file was generated for it.

**Symptom (b).** The whole addon fails to load. You get the stock team-select
lobby and no game mode. The console mentions
"loop or previous error loading module".

**Cause (a).** tstl only emits files transitively reachable from the entry
point. An ability nobody imports is not part of the program.

**Cause (b).** Import order creates Lua `require` cycles. Importing a variant
ability from *inside* its base ability's module is a cycle, and a cycle in the
require graph takes down `addon_game_mode` entirely.

**Fix.** Import every ability, item, and modifier for side effects from
`GameMode.ts`, and import variants **after** their bases, from the entry file —
never from within the base module.

```ts
// Abilities (imported for side-effect registration).
import "./abilities/archer_arrow";
import "./abilities/archer_hook";
// Variants MUST come after their bases, and MUST be imported here rather than
// from inside a base ability module — that creates a require cycle.
import "./abilities/variants";
```

*Observed live 2026-07-05.*

---

## L9 — the detached addon directory trap

**Symptom.** You rebuild. You relaunch. You see yesterday's game. You rebuild
again. Same. Nothing you do has any effect, and the build is definitely
succeeding.

**Cause.** `bun run build` writes into your repo. Dota reads
`<Steam>/…/dota_addons/<addon>`. Normally those are the same directory, because
`install.js` moved yours there and symlinked it back. If that junction is ever
lost — a fresh clone on a machine where the move already happened, a manual
delete, a Steam reinstall — the two are separate directories and you are editing
the one nobody reads.

**Fix.** Re-link, or rsync after each build. And know the three sub-rules,
because they are not symmetric:

- `game/scripts` (Lua) and `game/resource` (localization) are read **live**.
  Copy them across and they take effect.
- **Panorama and maps are served compiled** — `.vxml_c`, `.vcss_c`, `.vjs_c`,
  `.vpk`. Syncing Panorama *source* does nothing until `resourcecompiler` runs.
  So on a Mac, UI changes cannot take effect at all without a Windows box
  compiling them.
- Custom Lua and Panorama are cached at **game load**. A "reload" is not
  enough; you must fully quit the client.

Check for this **first**, every time, when someone says "I rebuilt and it's
still broken". It looks exactly like a code bug and it is not one.

*Observed 2026-07-08.*

---

## L10 — gitignored build artifacts break remote runs

**Symptom.** A fix works locally, you push, the VM runs it, and the VM shows the
old behavior. "The camera won't move." "The loading screen didn't update."

**Cause.** Compiled Lua and Panorama JS are gitignored — correctly, they are
build outputs. So `git fetch && git reset --hard` on the VM syncs **source
only**, and the VM executes whatever it compiled last time.

**Fix.** Always run **both** compilers on the VM after syncing:

```bash
tstl --project src/vscripts/tsconfig.json
tsc  --project src/panorama/tsconfig.json
```

Forgetting the second one is the more common version, because Lua *feels* like
"the code" and Panorama feels like assets.

This is L9's cousin: same root cause — a gap between what you edited and what
runs — different mechanism.

*Observed 2026-07-09.*

---

## L11 — SSH session 0 has no display head

**Symptom.** Dota launched over SSH on a Windows GPU VM dies at startup, or
starts and renders nothing.

**Cause.** An SSH login on Windows lands in session 0. Session 0 has no display
head, so a datacenter GPU will not initialize a DX11 device there.

**Fix.** Register a **scheduled task with an Interactive principal**, and have
SSH trigger the task rather than launch the game:

```powershell
$principal = New-ScheduledTaskPrincipal -UserId "builder" -LogonType Interactive -RunLevel Highest
```

Then `schtasks /run /tn dota_run` from SSH. The task runs in session 1, which
has a display head. See [chapter 6](06-autonomous-vm-rig.md).

---

## L12 — stale and renamed engine particles

**Symptom.** A projectile is invisible. An explosion does not appear. No error.

**Cause.** Particle paths from older Dota versions no longer exist —
`searing_arrows`, `burning_army_explode`, and `overcharge_end` are three that
have gone. A missing particle path is silent, exactly like a missing precache
(L3), which makes the two easy to confuse.

**Fix.** Use paths verified to load in an actual run, precache all of them, and
when you cannot confirm one, substitute a stand-in from a hero you *know* is in
the current build. Then prove it with frames, not logs — the log will happily
tell you the particle was created.

---

## L13 — universal shop mode is mandatory in a fountain-less arena

**Symptom.** Players buy an item. Gold is deducted. The item never appears in
their inventory.

**Cause.** By default Dota delivers purchases to the stash unless the buyer is
near a shop or fountain. An arena map has neither, so every purchase strands
permanently.

**Fix.** `GameRules.SetUseUniversalShopMode(true)`.

If you want a location-restricted shop anyway — buy only inside a marked zone —
enforce it yourself server-side (refund and remove out-of-zone purchases). Do
not try to get the default delivery rules to do it for you.

---

## L14 — `ffmpeg` eats stdin inside a `while read` loop

**Symptom.** A loop that extracts frames per window produces mangled output
directory names, as if lines were being skipped or spliced together.

**Cause.** `ffmpeg` reads stdin by default. Inside `while read line; do ffmpeg …; done`,
it consumes bytes belonging to the *next* iteration's line.

**Fix.** `ffmpeg -nostdin`. Always, in any script.

Not Dota-specific, but it will bite you exactly when you are building the
evidence pipeline, at which point you will be debugging your verifier instead of
your game.

---

## L15 — the day/night cycle blinds both players and bots

**Symptom (players).** Screenshots from four minutes into a match are nearly
black.

**Symptom (bots).** Nine bots roam for four minutes and score zero kills.

**Cause.** Dota's day/night cycle runs by default. Night is genuinely dark for a
player, and it is worse for a bot: fog-honest perception uses **night vision
radii**, which are a fraction of daytime, so bots that look for enemies within
their real vision simply stop finding any.

**Fix.** For an arena mode, pin perma-day:

```ts
Timers.CreateTimer(0, () => {
    GameRules.SetTimeOfDay(0.5);
    return 60;
});
```

A repeating timer rather than a one-shot, because other systems can move the
clock. This matters doubly for a recorded test rig: a night-phase run produces
screenshots you cannot review.

---

## L16 — document your known-benign noise

**Symptom.** An agent "fixes" working code.

**Cause.** tstl emits `Only false and nil evaluate to 'false'` truthiness
warnings in files where the behavior is deliberate and correct. Anyone — human
or agent — who sees a warning and does not know it is expected will try to make
it go away, and some attempts will change behavior.

**Fix.** Write the known-benign warnings down in `CLAUDE.md`, naming the files:

> TSTL truthiness warnings ("Only false and nil evaluate to 'false'") in
> `scout_bird` / `archer_ward` / `burning_arrow` are known and benign.

Documenting what is *not* a bug is a real practice, and it is cheap. Every
warning you leave unexplained is a standing invitation to break something.

---

## The pattern

Fourteen of these sixteen fail silently or report the wrong thing. That is the
single most important fact about this engine, and it has a direct consequence
for how you work:

**You cannot rely on errors to find bugs. You have to look.**

Which is why [chapter 5](05-testing-without-engine.md) ends with frame review as
a genuine tier of testing rather than a nicety, and why
[chapter 6](06-autonomous-vm-rig.md) exists at all.

And when a new one bites you: comment at the site of the fix with the date and
the symptom, invariant in `CLAUDE.md`, before you move on. That is the whole
mechanism by which this list came to exist.
