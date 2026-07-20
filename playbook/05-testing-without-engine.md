# 5. Testing without the engine

You cannot run Dota 2 in CI. It needs a GPU, a display head, a Steam session,
and a multi-gigabyte Workshop Tools install. Nothing about that is going to
change.

The usual conclusion is that a custom game cannot be meaningfully tested, so you
playtest and hope. This chapter is the other conclusion: figure out precisely
which parts *can* be tested without the engine, make that set as large as
possible on purpose, and build separate machinery for the rest.

Four tiers, each answering a question the one below it cannot.

| Tier | Runs on | Answers | Cost |
|---|---|---|---|
| 1. Unit | any laptop, CI | Is the decision logic right? | seconds |
| 2. Headless e2e | Windows GPU VM | Does the game actually run? | ~25 min end to end, real money |
| 3. Manual playtest | your machine + Dota | Is it any good? | your evening |
| 4. Evidence review | frames from tier 2 | Can the player *see* it? | minutes, after tier 2 |

Archer Wars finished at 375 unit tests across 47 files at tier 1. That number is
not an accident of diligence; it is the direct result of one architectural rule.

## The purity rule

**Decision logic lives in files that touch zero Dota globals.**

No `Vector`. No `GameRules`. No `PlayerResource`. No `RandomFloat`. No
`Entities`. Plain structs in, decisions out.

```ts
// bots/aim.ts — pure. Runs on Node in a millisecond.
export function leadTarget(
    shooter: Vec2,
    target: Vec2,
    targetVelocity: Vec2,
    projectileSpeed: number,
    aimErrorDegrees: number,
    rng: () => number,
): Vec2 { /* ... */ }
```

Everything engine-specific has been lifted out to the caller. `Vec2` is
`{ x: number; y: number }`, not Dota's `Vector`. Randomness arrives as an
injected `() => number` rather than `RandomFloat`, so a test can pass
`() => 0.5` and get a deterministic answer.

The engine-facing layer then becomes a translator:

```ts
// bots/botAgent.ts — impure, thin, untested at tier 1.
const aimPoint = leadTarget(
    toVec2(hero.GetAbsOrigin()),
    toVec2(target.GetAbsOrigin()),
    toVec2(target.GetForwardVector() * target.GetIdealSpeed() as Vector),
    ARROW_SPEED,
    difficulty.aimSigmaDegrees,
    () => RandomFloat(0, 1),
);
ExecuteOrderFromTable({ /* ... */ Position: Vector(aimPoint.x, aimPoint.y, 0) });
```

World state in, plain data out, call the pure function, plain data back, orders
out. There is no branching here worth testing, which is the point: the code that
*decides* is testable, and the code that *cannot* be tested does not decide
anything.

This split has to be a **plan-level global constraint**, naming the exact files
it covers. Discovered halfway through, it means rewriting the subsystem. Stated
up front, it costs nothing — you were going to write those functions anyway.

## Dual compilation

The same file must compile under tstl (to Lua, for the game) **and** run under
vitest (on Node, for the tests). That constrains what you can use:

- ✅ `Math.*`, `Map`, `Set`, arrays, plain objects, interfaces, classes
- ✅ `for...of`, destructuring, template literals, optional chaining
- ⚠️ Anything from Node's standard library — Lua has none of it
- ⚠️ Anything from Dota's API — Node has none of it
- ⚠️ Regex beyond the basics, since Lua patterns are not regex

In practice this is not a burden. Decision logic is arithmetic, comparison, and
sorting. If you find yourself wanting something exotic in a pure module, that is
usually a signal the module is doing something that belongs on the other side of
the line.

## The two-config trick

This is the mechanism, and it is two lines in two files.

`src/vscripts/tsconfig.json`:

```jsonc
"exclude": ["**/__tests__/**"]
```

`vitest.config.ts`:

```ts
include: ["src/vscripts/**/__tests__/**/*.test.ts"]
```

Complementary halves of one idea. Test files live *inside* the source tree,
right next to what they test, importing with `../name` — so they are easy to
find and impossible to forget. But tstl never turns them into Lua, so
`vitest`, `describe`, and `expect` never need to exist at runtime, and the
shipped Lua contains no test code.

Colocation matters more than it sounds. A `tests/` directory at the repo root
becomes a place tests go to be forgotten. `lib/__tests__/score.test.ts` sitting
beside `lib/score.ts` is visible in every directory listing, in every review, in
every agent's file tree.

## The exemplar

The smallest complete example of the pattern, shipped in the template.

`src/vscripts/lib/score.ts`:

```ts
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

  getKills(player: number): number { return this.kills.get(player) ?? 0; }

  leader(): { player: number; kills: number } | undefined { /* ... */ }
}
```

Note what is *not* here. No entity handles — players are plain numbers. No
`GameRules.SetGameWinner` — the class reports `hasWon` and lets the caller
decide what winning means. No net table write. The win *condition* is here; the
win *effects* are in `GameMode.ts`.

`src/vscripts/lib/__tests__/score.test.ts`:

```ts
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
```

Off-by-one at the threshold, and the double-win race where two players die in
the same frame. Both are real bugs that would be miserable to reproduce in-game
and take four lines to pin here.

## Tests as executable documentation

A second, less obvious use. When a source comment makes a *claim about
arithmetic*, a test can hold that claim true.

Archer Wars' arena manifest carries a comment asserting that the ruin rings
leave a certain keep-out distance around each spawn. `arenaManifest.test.ts`
recomputes that geometry from the manifest's own constants and asserts the
distances — as its comment puts it, "rather than trusting this comment".

Now a balance change that narrows the ring fails a test instead of producing a
map where two spawns clip a wall. Comments rot; a test that recomputes the claim
does not.

<a id="drift-tests"></a>
## Drift tests

The purity rule gets your *logic* into tier 1. Drift tests get your *data* in,
and they cover a failure class nothing else in this stack can see.

The setup is unavoidable in a Dota addon. The engine reads KV files —
`npc_items_custom.txt`, `shops.txt`, `npc_heroes_custom.txt`,
`addon_english.txt`. Your TypeScript keeps its own tables describing what is in
them: a shop catalog, a bot kit map, an ability-name list. Both are correct the
day they are written. Then somebody adds an item to `shops.txt` and does not add
it to the catalog.

Nothing notices. KV is stringly-typed and unvalidated, so the engine does not
care; TypeScript cannot read the KV file, so the compiler does not care; and the
symptom is that one item, or one class, quietly does nothing — invisible unless
you play that exact class or buy that exact item. Three separate instances of
this shipped in Archer Wars simultaneously, including bots for three of seven
classes that never cast an ability, and a shop restriction that failed open on
the two most expensive items in the game ([chapter 4, L21](04-landmines.md), and
[chapter 11, F17](11-failure-casebook.md#f17)).

**A drift test is a pure Node test that reads the authoritative file and diffs it
against the TypeScript copy.** No engine, no mocks, no fixtures — `readFileSync`,
a small parser, and an assertion.

The parser is the part people flinch at, and it should not be. You do not need a
KV library. You need "quoted key at brace depth 1" and one or two field regexes,
for a file format you control:

```ts
// lib/__tests__/itemCatalogKvDrift.test.ts (abridged)
const SCRIPTS_DIR = join(__dirname, "..", "..", "..", "..", "game", "scripts");

/** Every `"item" "item_x"` line of shops.txt = what a player can actually buy. */
function parseShopItems(): string[] {
    const text = readFileSync(join(SCRIPTS_DIR, "shops.txt"), "utf-8");
    const names: string[] = [];
    for (const rawLine of text.split("\n")) {
        const line = rawLine.trim();
        if (line.startsWith("//")) continue;
        const m = /^"item"\s+"(item_[a-z0-9_]+)"/.exec(line);
        if (m) names.push(m[1]);
    }
    return names;
}

it("every shop item has a catalog entry", () => {
    for (const name of parseShopItems()) {
        expect(findShopItem(name), `${name} is in shops.txt but not SHOP_ITEMS`).toBeDefined();
    }
});

it("catalog cost matches the KV ItemCost", () => {
    for (const item of ALL_PURCHASABLE_ITEMS) {
        expect(kvByName.get(item.internalName)?.cost).toBe(item.cost);
    }
});
```

Twenty lines of parser, and the class of bug is gone permanently.

Three variants are worth knowing, because between them they cover most
registries:

**KV against a table.** The one above. Also: every ability block in
`npc_abilities_custom.txt` has its tooltip tokens in `addon_english.txt` *and*
every translated file, so a new ability cannot ship rendering
`#DOTA_Tooltip_ability_x` in a playtest.

**Source scan against a registry.** When there is no data file to parse, the
source itself is authoritative. Archer Wars' `bots/__tests__/kits.test.ts` reads
every `.ts` file in `bots/kits/`, extracts every `"archer_*"` string literal, and
asserts each one appears in the exported ability list:

```ts
for (const file of readdirSync(kitsDir)) {
    if (!file.endsWith(".ts")) continue;
    const source = readFileSync(join(kitsDir, file), "utf8");
    for (const m of source.matchAll(/"(archer_[a-z_]+)"/g)) referenced.add(m[1]);
}
expect(referenced.size).toBeGreaterThan(0);
for (const name of referenced) expect(ALL_KIT_ABILITY_NAMES).toContain(name);
```

Crude, and it caught three ultimates that no bot could cast.

**Guard the parser.** Every drift test needs one assertion that the parse itself
produced something — `expect(items.length).toBeGreaterThan(10)`. A regex that
silently matches nothing turns the whole test into a green no-op, which is worse
than not having it, and it will happen the first time someone reformats the KV
file.

Two rules on top of the technique.

**Derive before you diff.** A drift test is the fallback for a second copy you
cannot eliminate. Where the copy can simply be computed from the first —
`ALL_KIT_ABILITY_NAMES` from the kit table — do that instead and delete the
question.

**Assert the direction that fails silently.** Both directions are useful, but
they are not equally urgent. An entry in the TypeScript with no KV backing
usually fails loudly the first time you use it. An entry in the KV with no
TypeScript backing is the silent one: a real, purchasable, castable thing your
code does not know exists.

## What tier 1 cannot do

Be honest about the boundary. Unit tests will not tell you:

- whether the ability's particle renders
- whether the hero name resolves
- whether the KV file's `ScriptFile` path is right
- whether the panel is covered by an invisible hittest surface
- whether the game is fun

Nearly every landmine in [chapter 4](04-landmines.md) is invisible to tier 1.
That is not a failure of the tests; it is the reason tiers 2 through 4 exist.

The exceptions are worth knowing precisely, because they mark where the boundary
can be pushed. Drift tests reach L21 — a registry out of step with the KV — by
reading the data file directly, and L17 (the cross-architecture float mismatch)
is a tier-1 contract test on an exported artifact. Both are cases where the
engine's *input* is a file on disk, so a Node process can check it even though a
Node process can never run the engine. Whenever a landmine's cause is data rather
than behaviour, ask whether tier 1 can be made to see it.

The engine-facing files — `GameMode.ts`, the systems, the abilities, the
perception layer — are deliberately left uncovered at tier 1. Testing them would
mean mocking the Dota API, and a mock of an API whose real behavior surprises
you is worse than no test: it encodes your wrong belief and then confirms it.

## Tier 2 — headless e2e

Convar-gated: `+hello_arena_e2e 1` on the launch line engages a harness that
seats bots, drives them, and prints `[E2E]` markers. A scanner greps
`console.log` for those markers and for error patterns. [Chapter 6](06-autonomous-vm-rig.md)
is the whole rig.

The design constraint that makes it safe: **every code path in the harness is
inert in a real match.** `IsInToolsMode()` plus a convar check, both, at the
entry point. The harness must never be able to affect a game a human is playing.

Tier 2 catches all the load-order and resolution failures — the ones tier 1
structurally cannot see. End to end it runs about twenty-five minutes — roughly
three for a cold VM boot, ten to sync and compile, thirteen for the recorded
match — and it costs real money, so it is not a per-commit gate; it is a
per-feature and pre-release gate.

## Tier 4 — evidence review

The unusual one, and the one this project would argue hardest for.

For anything visual, tiers 1 through 3 all fail in the same specific way:

- Tier 1 cannot see pixels at all.
- Tier 2 sees that the code ran. `[ELEM] applied fire to victim 3` proves the
  branch executed. It does not prove anything appeared on screen — an
  un-precached particle renders nothing and reports nothing (L3, L12).
- Tier 3 sees it, but tier 3 is a human who has to be available, and who is
  bad at noticing that an effect is *slightly* wrong.

So the gate becomes: **extract frames from the recording and look at them.**

The mechanics:

1. The VM run records an MP4 alongside its screenshots.
2. `extract-frames.sh` pulls one frame per three seconds across the whole run —
   enough to catch anything that persists.
3. For effects that last about a second — a projectile in flight, a proc, a
   status landing — that sweep will miss them. So compute the windows where
   interesting things happened (from the log markers, which have timestamps)
   and re-extract at 15 fps over each: `extract-frames.sh run.mp4 --window 143 4 out/`.
4. Read the frames. Issue a verdict in writing, citing frame numbers.

This is genuinely not automatable, and the attempt to automate it is how the
invisible-particle class of bug ships. It is also not expensive: the frames
already exist, and reading forty of them takes a couple of minutes.

The discipline that makes it work is writing the **marker contract first**. A
spec's `contracts/` directory names the exact strings the run will print and the
exact windows the reviewer will look at, before any of it is implemented. Then
"the implementation, the verifier, and the reviewer agree" is a property of the
design rather than a coincidence.

## Putting it together

```
every commit         tier 1     seconds, free
every feature        tier 2     ~25 min, GPU VM
anything visual      tier 4     minutes, on top of tier 2
before you believe   tier 3     an evening, a human
  the game is good
```

The rule that governs all of it: **make the testable region as large as you
can, on purpose, and be honest about where it ends.** A codebase with a clean
purity boundary gets 375 fast tests. The same codebase written without that
boundary gets zero, and every one of those 375 assertions becomes something a
human re-checks by playing the game.
