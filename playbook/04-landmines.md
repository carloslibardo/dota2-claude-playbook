# 4. Landmines

Thirty-three things that cost real days, with the symptom you will actually see,
the cause, and the fix.

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

**Symptom.** Your bot driver logs `[E2E] driving 0 archer(s)` — or whatever your
equivalent marker is — for an entire match that visibly plays fine: the bots
move, shoot, kill each other, and score.

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

## L17 — your drift gate will fail on floating-point, across architectures

**Symptom.** A committed generated artifact — ours was `arena.json`, exported
from a TypeScript constant and checked by CI for drift — passes locally and
fails in CI on every single run. Regenerating it locally produces a file
identical to the one already committed. The CI diff is one digit, in the last
place:

```
-1456.2305898749055     (committed, generated on the dev machine)
-1456.2305898749057     (regenerated in CI)
```

CI stayed red from July 12 to July 19 on this alone.

**Cause.** The dev machine is ARM and the CI runner is x64, and their `libm`
trig functions differ by **1 ULP** on some inputs. The arena's spawn ring is
computed with `sin`/`cos`, so the exported coordinates land one unit-in-the-last-place
apart depending on which CPU family ran the exporter. Neither result is wrong.
IEEE 754 does not require `sin` and `cos` to be correctly rounded, so it does
not require two platforms to agree.

**Fix.** Round at the export boundary, and — the part that matters — make the
exporter and the test that checks it share **one** rounding function:

```ts
/**
 * 4-decimal round shared by the arena.json exporter and its contract test.
 * Ring-slot trig differs by 1 ULP between ARM libm (where arena.json gets
 * committed) and CI's x64 libm — enough to trip the drift gate on values
 * like -1456.2305898749055 vs ...057.
 */
export function roundForExport(value: number): number {
    return Math.round(value * 1e4) / 1e4;
}
```

Pick a precision far below any tolerance that matters — 0.0001 Hammer units is
nothing geometrically — and export through it everywhere.

Two traps inside the fix. If the exporter rounds and the test recomputes from
raw constants, you have moved the mismatch rather than removed it, so the
rounder must be imported by both. And rounding *display* while committing raw
values does nothing at all; the round has to happen before serialization.

**The general rule.** Any CI gate that compares a regenerated artifact against a
committed one is implicitly asserting that generation is deterministic across
every machine that will ever run it. The moment floating-point maths is
involved, that assertion is false unless you make it true. Quantize
deterministically at the boundary — this is the same class of problem as
checksums over serialized floats, and the same fix.

*Observed live 2026-07-12 through 07-19 (archer-wars PR #21).*

---

## Interlude — where L18 through L25 came from

L1–L17 were bought with playtests, crashes and rejected deliverables: a human
saw something wrong and we dug until we found why.

L18–L25 came from somewhere else. On 2026-07-20, three agents read the whole
Archer Wars repository adversarially — one on core systems and `lib/`, one on
the bot engine, one on content, KV, Panorama and tooling — with no brief other
than "find what is wrong". They returned 71 ranked findings; the fixes landed as
archer-wars PR #24.

That provenance matters when you read the symptoms below. Where the record shows
a human reported the behaviour, it says so. Everywhere else the symptom is
**traced from the code, not observed** — this is what the branch does, read by
hand, and in several cases nobody had played the affected class since the code
was written. That is itself the finding: eight defects of this severity survived
in a codebase with 600+ passing unit tests, a headless e2e rig and a frame-review
gate, because none of them produce an error and most require playing one specific
class or standing in one specific place to see.

---

## L18 — a wire value of `0` is `true` in Lua

**Symptom.** A player opens the bot panel, sets **Fill bots: Off**, starts the
match, and gets a full lobby of bots. The "on" path and the "off" path both turn
bots on. Nothing is logged, because from the server's point of view nothing
unusual happened.

**Cause.** The classic Lua truthiness trap, in the one place it is hardest to
see. Panorama's `CustomGameEvent` payloads type a flag as `boolean | 0 | 1`, and
the engine's networking turns a wire `false` into `0` server-side. The handler
did what looks like the careful thing:

```ts
Convars.SetInt("archer_wars_fill_bots", enabled ? 1 : 0);
```

That is correct TypeScript and broken Lua. `enabled` arrives as `0`, `0` is
truthy in Lua, so the ternary takes the `1` branch and writes `1` for an explicit
off. Note what makes this the most instructive member of the truthiness family:
the code is not sloppy, it is *defensive* — it explicitly normalizes to 1/0 —
and the comment above it correctly described the wire protocol. Both the author
and every reviewer read the ternary as the fix rather than as the bug. Whatever
tstl printed for this line, nobody connected it to a toggle that appeared to be
handling its two states explicitly.

**Fix.** Never let a wire value reach a conditional. One pure normalizer,
`src/vscripts/lib/wireFlags.ts`, applied at every boundary:

```ts
export function normalizeFlag(value: boolean | 0 | 1 | undefined): 0 | 1 {
    if (value === undefined) return 0;
    if (value === false) return 0;
    if (value === 0) return 0;
    return 1;
}
```

Three explicit comparisons, no truthiness anywhere, and — because it is pure —
a unit test can assert the exact failing input (`0`) on a laptop. `botSelect.ts`
now calls it; the raw ternary is banned.

**The general rule.** Anywhere a value crosses a boundary you did not write —
client to server, KV to TypeScript, convar to code — it can arrive in a
representation your conditional was not written for. Convert it explicitly, in a
named function, at the boundary. This is the same shape as L1 and L17: a
translation layer you did not know was translating.

*archer-wars PR #24 (2026-07-20); `systems/botSelect.ts`, `lib/wireFlags.ts`.*

---

## L19 — modifier parameters are server-only, and the client predicts zero

**Symptom.** A slow debuff rubber-bands. The victim keeps running at full speed
for a fraction of a second, then snaps backwards. An armor debuff never moves the
number in the victim's HUD. No error, and — this is the part that costs the day —
**nothing in any log is wrong**, because on the server every value is correct.

**Cause.** `OnCreated(params)` runs on both realms, but the `params` table is
populated server-side only. Dota's client runs the same modifier code to
*predict* movement, and it evaluates the functions declared in
`DeclareFunctions()` locally. So a magnitude captured into a field in
`OnCreated`:

```ts
OnCreated(params: { slowPct: number }): void {
    this.slowPct = params.slowPct;   // server: 50. client: 0.
}
GetModifierMoveSpeedBonus_Percentage(): number {
    return -this.slowPct;            // server applies -50%. client predicts 0%.
}
```

...produces a client that believes the hero is at full speed and a server that
disagrees. What the player sees is the correction, which reads as lag.

**Fix, when the modifier's own ability owns the value.** Read it off
`this.GetAbility().GetSpecialValueFor(...)` — ability KV is replicated, so both
realms get the same number.

**Fix, when it does not.** In Archer Wars these debuffs are applied by
`lib/arrowHitPipeline.ts` with the *arrow* ability as the source; the *bow item*
is only the value donor. `GetAbility()` therefore returns `archer_arrow`, which
has no `slow_pct` value to read. The channel that does work is the **stack
count**, which is networked:

```ts
OnCreated(params: { slowPct: number }): void {
    if (!IsServer()) return;
    this.SetStackCount(Math.floor(params.slowPct ?? 0));
}
GetModifierMoveSpeedBonus_Percentage(): number {
    return -this.GetStackCount();    // both realms read the same number
}
```

It costs you fractional magnitudes (stack counts are integers) and it consumes
the stack display, which is a real trade. Take it anyway: a magnitude the client
cannot see is a magnitude the player experiences as netcode failure.

*archer-wars PR #24; `modifiers/modifier_frost_arrow.ts`,
`modifiers/modifier_lightning_arrow.ts`.*

---

## L20 — a recipe has already combined by the time you hear about the purchase

**Symptom.** A shop rule that refunds and removes out-of-zone purchases works
perfectly for plain items, and hands out free upgrades for recipe items. Buy the
recipe from anywhere on the map: you get the gold back **and** you keep the
built item. Repeatable: the 600-gold recipe cost comes back and the 1200- or
1800-gold weapon it just built stays in the inventory.

**Cause.** The guard did the obvious thing — take the item name from
`dota_item_purchased`, find it in the buyer's inventory, remove it, refund the
cost:

```ts
const item = findInInventory(hero, event.itemname);   // undefined for a recipe
if (item) hero.RemoveItem(item);
PlayerResource.ModifyGold(playerId, cost, true, ...);  // runs regardless
```

For `item_recipe_marksmans_luck_2`, `findInInventory` returns nothing. The engine
combined the recipe with its components and placed the *built* item in the
inventory **before** the event fired. So the removal is a no-op, the refund is
not, and the player is up one item.

Two smaller traps inside the same event: the name you receive is the recipe's,
not the product's, and the recipe cost is not the item cost — components were
purchased separately, and (in this design) refunded separately by the same guard.

**Fix.** Decide what to remove from the purchased name, in a pure function that
can be unit-tested at both branches:

```ts
const removeItemName = purchasedName.startsWith("item_recipe_")
    ? resolved.item.internalName   // the BUILT item
    : purchasedName;
```

And structurally: a compensating action must not run when its paired action
failed. `refundGold` and `removeItemName` are returned together by one decision
function, so a future edit cannot separate them.

**The general rule.** When you react to an engine event, ask what the engine
already did before it told you. Purchase, combine, level-up, death — these are
notifications of a completed transaction, not requests for permission. Anything
you "undo" in the handler must be undone against the state as it is *now*.

*archer-wars PR #24; `systems/shopPurchaseGuard.ts`, `lib/shopRefund.ts`.*

---

## L21 — hand-maintained registries drift from the KV, silently

**Symptom.** Three, in one codebase, none of them producing so much as a warning:

- Bots piloting three of the seven classes never cast a single ability. They
  moved, aimed and right-clicked for a full match. The bot kit table
  (`bots/kits/kitAdvisor.ts`) keyed four hero names; the game shipped seven.
- Three ultimates were never castable by any bot. The bot's ability-probe list
  was a hand-written array of ability names, and
  `archer_grapple_volley`, `archer_spread_shot_volley` and
  `archer_sniper_shot_deadeye` were not in it, so nothing ever asked the engine
  whether they were ready.
- The two most expensive items in the game were buyable from anywhere on the
  map, bypassing the shop-zone restriction entirely.
  `item_marksmans_luck_2`/`_3` existed in `game/scripts/shops.txt` at 1200 and
  1800 gold with no matching entry in `lib/itemCatalog.ts`, so the zone guard's
  `resolvePurchasedShopItem` returned `undefined` and the guard declined to act.

**Cause.** The same shape every time. The engine reads one file (KV, `shops.txt`,
`npc_heroes_custom.txt`); the TypeScript keeps its own table of what it believes
is in there. Both are correct when written. Then one side gains an entry.

There is no mechanism in this stack that notices. KV is stringly-typed and
unvalidated, TypeScript cannot see into it, and every one of these failures
manifests as *nothing happening* for one class, one item, or one bot — which
requires playing that exact class or buying that exact item to observe. The bot
kit gap survived the headless e2e rig for the simple reason that the rig's bots
were spawning the four classes that had kits.

**Fix. Drift tests.** A pure Node test that reads the KV file with
`readFileSync`, scans it with a small hand-rolled parser, and diffs it against
the TypeScript table. No engine, no mocks, milliseconds. Archer Wars now carries
three:

| Test | Asserts |
|---|---|
| `lib/__tests__/itemCatalogKvDrift.test.ts` | every `"item" "item_x"` in `shops.txt` has a `SHOP_ITEMS` entry, and its cost matches `npc_items_custom.txt` |
| `lib/__tests__/locFiles.test.ts` | every ability/item block in the KV has its localization tokens in `addon_english.txt` and `addon_brazilian.txt` |
| `bots/__tests__/kits.test.ts` | every `"archer_*"` string appearing in any `bots/kits/*.ts` source file is present in `ALL_KIT_ABILITY_NAMES` |

The third is worth a second look: it does not parse KV at all, it **scans its own
sibling source files** for ability-name literals and asserts the registry
contains them. Any hand-maintained list can be checked against whatever the
authoritative source happens to be, including source code.

The better structural fix, where it is available, is to not have the second copy:
`ALL_KIT_ABILITY_NAMES` is now *derived* from the kit table rather than written
beside it. Derive first; drift-test what you cannot derive.

[Chapter 5](05-testing-without-engine.md#drift-tests) has the technique in full,
with the parser.

*archer-wars PR #24; the three tests above.*

---

## L22 — `DestroyParticle` without `ReleaseParticleIndex` leaks

**Symptom.** None, for a while. Then a long match gets choppy on the server.
There is no error at any point and no single call site looks wrong.

**Cause.** Particle indices are a pooled resource with a two-call teardown.
`DestroyParticle` stops the effect; `ReleaseParticleIndex` returns the handle.
Skip the second and the index is held for the life of the match.

Two flavours found in one review pass:

- **Per-cast accumulation.** `abilities/archer_detonate.ts` created one
  explosion particle per planted charge and released none. Every Detonate cast
  leaked one index per charge, for every Demolitionist, all match.
- **Never torn down at all.** `systems/shopZone.ts` created ground-ring marker
  particles with `CUSTOMORIGIN` — no parent entity, so nothing destroys them when
  the system stops. `stop()` freed the shop structures and left the rings.

The second one is the general hazard: a particle attached to a unit is cleaned up
when the unit dies, so most of your particles appear to manage themselves and you
form the belief that they do. The ones with no parent do not.

**Fix.** Both calls, always, paired at the same site:

```ts
ParticleManager.DestroyParticle(pfx, false);
ParticleManager.ReleaseParticleIndex(pfx);
```

For a fire-and-forget effect whose control points are all set at creation, you
can release immediately — the effect still plays. That is what `archer_detonate`
does now, and it is the pattern to prefer, because it removes the possibility of
a teardown path that never runs.

*archer-wars PR #24; `abilities/archer_detonate.ts`, `systems/shopZone.ts`,
matching the correct pattern already in `abilities/archer_holy_arrow.ts`.*

---

## L23 — a written rule with no automated check decays

**Symptom.** The Shadow class's signature ability — a hook, the thing the class
is built around — renders nothing at all. The projectile flies, the target is
pulled, the damage lands. There is no rope, no chain, no visual. No error.

**Cause.** `abilities/archer_hook.ts` fires its projectile with
`EffectName: "particles/units/heroes/hero_pudge/pudge_meathook.vpcf"`. Pudge is
not in this game's hero roster, so the engine never precaches his particles, so
the path resolves to nothing and renders nothing. That is L3 and L12, exactly,
with no new mechanism.

**The actual finding is not the mechanism.** This repository already knew this
rule. It is written in `CLAUDE.md`. It is L3 in this chapter. The `Precache()`
function in `GameMode.ts` is a long, careful, commented list of particle paths
demonstrating that whoever wrote it understood the rule completely. And the
game's signature ability shipped invisible anyway, because between "the rule is
written down" and "this specific path is in the list" there was nothing but human
attention.

**Fix.** The precache line, and then the check that makes the line unnecessary to
remember: a drift test (L21) that greps every `particles/*.vpcf` string literal
in `src/vscripts/**` and asserts each one appears in the `Precache()` body.

That test does not exist in Archer Wars yet — the fix that landed was the missing
precache lines (meathook, the grapple stun overhead effect, the frost nova
explosion, and two runtime-spawned units). We are noting the check as the
inference it is: the same source-scan pattern as `kits.test.ts` applies directly.

**The general rule.** A rule in `CLAUDE.md` reduces the rate of a mistake; it
does not take the rate to zero, and it decays as the file grows and the codebase
grows past what anyone re-reads. For any invariant you have written down twice,
ask what would fail if it were violated. If the honest answer is "someone would
have to notice", you have a convention, not an invariant.

*archer-wars PR #24; `GameMode.ts` `Precache()` versus
`abilities/archer_hook.ts`.*

---

## L24 — entity-index keys do not survive hero replacement

**Symptom.** An "every 3rd arrow hits harder" item resets its progress when the
player switches class, and — occasionally, later in the match — fires early,
having inherited a stranger's count.

**Cause.** The counters were keyed on `caster.entindex()`. A class swap calls
`ReplaceHeroWith`, which destroys the old hero entity and creates a new one: the
same player is now a different entity index. The old key is orphaned in the map
for the rest of the match, and because Source 2 **recycles entity indices**, a
later entity can be handed that exact index and inherit the stale count.

This generalizes past class swaps. Any per-player state keyed on an entity
handle or index — cooldown bookkeeping, aggro tables, progress toward a threshold,
per-hero UI state — breaks on every path that recreates a hero: class change,
`ReplaceHeroWith`, a respawn implemented as recreation, an illusion mistaken for
its owner.

**Fix.** Key on `GetPlayerOwnerID()`. It is stable for the whole match across
every path that can hand a player a new body:

```ts
// Every-Nth counters are keyed by the caster's PLAYER id, not its entity index:
// a class swap (ClassSelect's ReplaceHeroWith) gives the same player a brand-new
// hero entity, which reset the progress and leaked/recycled the old entindex key.
const counterKey = caster.GetPlayerOwnerID();
```

Guard the negative case while you are there: `GetPlayerOwnerID()` returns `-1`
for owner-less units (illusions, spawned wards, summons). The same review found
a shop-zone occupancy set writing player `-1` into a net table and granting shop
access to a non-player.

*archer-wars PR #24; `lib/arrowHitPipeline.ts`, `lib/arrowHitCounters.ts`.*

---

## L25 — velocity estimated from position deltas explodes on teleports

**Symptom.** For one tick after any blink, hook or position swap, every bot in
the game aims at a point far outside the arena. In a mode where the burst window
*is* the blink, that is precisely the tick you needed them to hit.

**Cause.** The bot perception layer estimated each tracked hero's velocity the
obvious way:

```ts
const vel = scale(sub(pos, prev.pos), 1 / (now - prev.time));
```

Sound for running. But a hook, blink or swap relocates a hero several hundred
units between two consecutive samples, and dividing that by one tick's worth of
time yields thousands of units per second — an order of magnitude above the
fastest achievable move speed in Dota, which is 550. That number goes straight
into the lead-aim solver, which faithfully aims where a hero travelling that fast
would be.

Nothing here is an error. The estimator is correct, the aim solver is correct,
its unit tests pass, and the composition is nonsense for exactly one tick per
teleport.

**Fix.** Reject the physically impossible sample rather than smoothing it:

```ts
/**
 * Per-tick displacement above this implies a teleport/hook/swap, not running:
 * the fastest achievable hero move speed in Dota is 550 u/s, so 700 leaves
 * headroom for a haste burst while still rejecting a blink-sized jump.
 */
const MAX_TRACK_SPEED = 700;

if (dist(pos, prev.pos) <= MAX_TRACK_SPEED * dt) vel = scale(delta, 1 / dt);
// else: leave velocity at zero for this tick — aim at where they are.
```

Dropping the sample beats clamping it, because a clamped velocity is a
confident wrong direction and zero is an honest "aim at the current position".

**The general rule.** Any quantity you derive from a difference between samples
assumes the underlying value is continuous. Game worlds are not continuous —
teleports, respawns and camera cuts are discontinuities by design. Bound the
derived value by what is physically possible in your world, and pick the bound
from a real engine limit (550 u/s here) rather than from a number that looked
large.

*archer-wars PR #24; `bots/perception.ts`.*

---

## L26 — a Lua modifier cannot shadow a stock hero's modifier name

**Symptom.** You re-kit Pudge, register `modifier_pudge_rot` with
`LinkLuaModifier`, apply it, and nothing happens. `HasModifier("modifier_pudge_rot")`
returns **true**. Not one of your Lua callbacks ever runs — no `OnCreated`, no
interval think, no damage, no declared-modifier value. There is no error.

**Cause.** `modifier_pudge_rot` is already registered by the engine as the stock
ability's C++ modifier. `LinkLuaModifier` does not replace it and does not
complain: every application path resolves to the inert built-in, and you get a
modifier with that name — which is exactly the question `HasModifier` answers.

Four different application mechanisms were tried on this and all four
"succeeded". What finally proved it was a lifecycle probe — a print in
`OnCreated` and `OnDestroy` that never fired once, showing the Lua class was
never instantiated at all.

**Fix.** Never reuse a stock kit's modifier names on a re-kitted hero. Pudge Wars
puts a `_wars_` infix on every one of them (`modifier_pudge_wars_rot`), so no
custom name can collide with a base-hero name.

**The general rule.** This trap is *guaranteed* by the base-hero-override
doctrine (L2). The moment your Assault archer **is** Windrunner, the engine
already owns every modifier name in her stock kit, and the most natural name for
your replacement is the one name you cannot have. Namespace the whole custom kit
before you write it; renaming afterwards means touching KV, TypeScript and every
`HasModifier` call site at once.

*Observed live in pudge-wars 2026-07-27.*

---

## L27 — a particle is networked only to clients connected at creation

**Symptom.** Persistent world visuals — shop pads, zone rings, boundary markers —
render for nobody. Every server-side marker is green: the system logged that it
built them, the particle indices came back valid, no error anywhere. The frames
show clean ground.

**Cause.** A particle is networked to the clients connected **at the instant it
is created**. World FX created in `Activate` or in GameMode construction run
while the server is still in `INIT`, roughly 15 seconds before the first client
connects. The create goes out to an empty room, and nothing back-fills it when
players arrive.

**Fix.** Create persistent world visuals at `GAME_IN_PROGRESS`, not at
construction, and print a draw marker at the creation site so the rig can prove
the *timing* and not merely the intent.

**The general rule.** "The system ran" and "a player saw it" are different
claims, and this engine will let you collect a full set of green markers for the
first while the second is false all match.

*Observed live in pudge-wars 2026-08-03 (shop pads: every `[SHOP]` marker green,
zero pad FX on any frame).*

---

## L28 — some vanilla particles cannot be driven from script at all

**Symptom.** You point a tether at `pudge_meathook.vpcf`, precache it, set CP0
and CP1 every tick, and see nothing. You switch to `rattletrap_hookshot.vpcf`
and see nothing. No error in either direction.

**Cause.** Those two assets need engine-internal state that no script API
provides. Precaching is necessary and **not sufficient**: raw
`SetParticleControl` and entity-anchored control points both fail, silently, on
a correctly spelled and correctly precached path.

**This corrects L23.** L23 covers only the precache half — meathook draws nothing
when it is not precached — and implies that adding the precache line fixes it. It
does not. Pudge Wars precached meathook and it still never rendered.

**Fix.** Use a particle known to render as a plain CP0→CP1 beam. Panel-verified
on screen: `wisp_tether.vpcf`, `razor_static_link_beam.vpcf`, and
`batrider_flaming_lasso.vpcf` (which adds a droop arc). And never swap a tether
particle blind: spawn every candidate at once in an on-screen FX candidate
panel, read one frame, and keep the panel in the tree — the next swap then costs
one run instead of one theory per run.

*Observed live in pudge-wars 2026-07-29.*

---

## L29 — cheat-gated launch convars are accepted and ignored

**Symptom.** You add `+dota_camera_distance` to the launch line for a recording
run. The client starts. The convar reads back the value you set. The frames are
pixel-identical to the un-zoomed run.

**Cause.** The convar is cheat-gated. Setting it from the launch line stores the
value without the engine ever honouring it, so every check available from
outside the client says it worked.

**Fix.** Zoom from the server instead:

```ts
GameRules.GetGameModeEntity().SetCameraDistanceOverride(1600);
```

For a follow-cam, `+dota_camera_lock` on the recording host's hero is the only
route that works — the server-side `SetCameraTarget` leaves the tools client's
camera parked where it already was.

**The general rule.** A convar that reads back its own value has told you nothing
about whether the engine applied it. For anything visual the readback is not the
evidence; the frame is.

*Observed live in pudge-wars 2026-07-29.*

---

## L30 — the order pipeline enforces geography, not physics

Three truths, learned separately, all following from one fact: the order filter
only ever sees **orders**.

**(a) A filtered boundary is not a wall.** Pudge Wars' uncrossable river is
walkable water tiles plus a `SetExecuteOrderFilter` that clamps every move target
to the mover's own bank. Nobody can *order* a crossing. But a unit MOVED across
the line by a motion controller — hook-dragged — walks straight home through the
water on its next order, which the filter allows, because the destination is on
its own side. Run 13: 198 completed drags, zero kills, every catch walked out.
Any design that assumes a caught victim is trapped must trap it explicitly.

**(b) `CAST_POSITION` bypasses the filter and walks the caster into range.** An
out-of-range scripted cast is not rejected; the unit sets off toward the point
until the ability becomes castable, which in a bot harness reads as a bot
wandering away from the fight. Range-gate every scripted cast yourself before
issuing it.

**(c) Fake clients cannot reach a toggle ability through the pipeline.** A
`CAST_TOGGLE` order is clobbered by any other order issued on the same think,
and `ToggleAbility()` called on an `ability_lua` from server script is a silent
no-op. Drive the modifier directly rather than ordering the toggle. (One more
entry in the fake-client family — L4, L5, L6.)

*Observed live in pudge-wars 2026-07-27/28.*

---

## L31 — the FFA→two-team seam reaches all the way into bot seating

**Symptom.** You convert a 10-team FFA template to two teams. Nine bots seat,
one hero stands on the map, the match scores zero kills. The bots are in the
game — they just never got a hero.

**Cause.** The seam is wider than it looks: team count lives in `addoninfo.txt`,
the team list, the spawn logic, the net tables and the HUD. Past all of those,
`dota_create_fake_clients` seats clients with **no team at all**. On an FFA game
that goes unnoticed, because the seating code assigns a custom team anyway; on a
two-team game the unassigned bots sit out hero selection entirely and
`SetCustomGameForceHero` never touches them.

**Fix.** An explicit balanced `SetCustomTeamAssignment` sweep over every seated
fake client inside the setup window (L6), plus a `CreateHeroForPlayer` fallback
for any bot still heroless at the horn.

Cross-reference L7: the teams you assign here are the same teams that have no
Hammer spawn points.

*Observed live in pudge-wars 2026-07-26.*

---

## L32 — a motion-controller modifier is a four-callback contract

**Symptom.** A hook drag works perfectly until the victim is displaced mid-drag —
a respawn, a force staff, a second hook. Then the victim freezes in mid-air, or
lands fine and can never be hooked again for the rest of the match.

**Cause.** Declaring `LuaModifierMotionType.HORIZONTAL` is the declaration, not
the contract. A unit has one horizontal motion controller, it has an owner, and
it is only ever handed to the next claimant if the current owner gives it back.

**Fix.** All four callbacks, every time:

| Callback | Job |
|---|---|
| `ApplyHorizontalMotionController(parent)` | start — claim the controller when the modifier is created |
| `UpdateHorizontalMotion` | move the unit, every tick |
| `OnHorizontalMotionInterrupted` | something else took the controller — end your effect cleanly |
| `OnDestroy` | release the controller, on every exit path |

Skip the last two and you get exactly the two symptoms above: no interrupt
handler leaves a victim frozen mid-flight, and no release leaves a dead
controller blocking the next hook.

The war story for the same ability is [chapter 11](11-failure-casebook.md), F8,
which covers the declaration half; this is the lifecycle half.

*Observed live in pudge-wars 2026-07-26 (the hook drag).*

---

## L33 — the minimap overview pipeline has three silent traps

**Symptom.** A custom map renders a **white** minimap. You ship an overview
material and it renders a solid grey one — while resourcecompiler reports
"OK: compiled".

**Cause.** Three separate traps, and exactly one of them produces a log line:

1. The registration txt, `game/resource/overviews/<map>.txt`, needs the **full**
   `materials/overviews/<map>.vmat` path, extension included. Extensionless logs
   `FixupResourceName: Illegal path` — the one loud clue in the whole pipeline.
2. The vmat's texture parameter is `Texture`, **not** `TextureColor`.
   resourcecompiler binds any UNKNOWN parameter to
   `materials/default/default_tga` — the solid grey — and still reports a
   successful compile.
3. The authoritative template is not online, it is on your disk: Valve's conquest
   addon, `content/dota_addons/conquest/materials/overviews/`, which ships the
   vmat plus a texture sidecar txt setting `clampu`/`clampv`/`nocompress`/
   `nomip`. Copy it rather than inventing one. PNG input works; TGA is not
   required.

**Fix.** The three above, and then verify the compile instead of believing it:
extract strings from the emitted `vmat_c` and confirm it references
`<map>_png_<hash>.vtex` and not `default_tga`.

**The general rule.** A compiler that treats an unknown parameter as a default
binding rather than an error will report success on a material that draws
nothing you wrote. This one cost three VM cycles; the string check on the
`vmat_c` costs one command.

*Observed live in pudge-wars 2026-08-02.*

---

## The pattern

Thirty of these thirty-three fail silently or report the wrong thing. That is the
single most important fact about this engine, and it has a direct consequence
for how you work:

**You cannot rely on errors to find bugs. You have to look.**

Which is why [chapter 5](05-testing-without-engine.md) ends with frame review as
a genuine tier of testing rather than a nicety, and why
[chapter 6](06-autonomous-vm-rig.md) exists at all.

And when a new one bites you: comment at the site of the fix with the date and
the symptom, invariant in `CLAUDE.md`, before you move on. That is the whole
mechanism by which this list came to exist.
