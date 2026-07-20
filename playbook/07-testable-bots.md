# 7. Bots You Can Unit-Test

Every custom game eventually needs bots. Ours needed them more than most: Archer Wars is a
ten-player free-for-all, and there is no way to test a ten-player free-for-all with one human
and a laptop. The bots were not a feature we added for players — they were the thing that made
the game testable at all. Every recorded verification run in this project is a bot match.

That inverts the usual priority. If the bots are the test rig, the bots have to be more
trustworthy than the game, and they have to be debuggable without booting the game. This
chapter is how we got there, and the four pathologies we hit on the way.

The short version: **the decision logic must be pure enough to run on a laptop in
milliseconds, and the tick loop must issue commitments rather than recomputations.** Almost
everything below follows from those two sentences.

---

## 7.1 The layered architecture

The bot subsystem ended up as four layers with strictly one-way data flow:

```
 world (Dota engine)
        │
        ▼
  ┌───────────────┐   turns engine state into plain data
  │  perception   │   { x, y }, numbers, arrays — no engine handles leak out
  └───────────────┘
        │  WorldSnapshot (plain structs)
        ▼
  ┌───────────────┐   SHOP / HUNT / ENGAGE / RETREAT + a reflex layer
  │   agent FSM   │   pure: snapshot in, Intent out
  └───────────────┘
        │  Intent  { kind: 'engage', target, aimPoint }
        ▼
  ┌───────────────┐   per-class advice: which ability, which item, which lead
  │ kit advisors  │   pure, keyed by hero name
  └───────────────┘
        │  Order  { type: 'cast', ability, point }
        ▼
  ┌───────────────┐   the only layer allowed to touch the engine
  │   executor    │   ExecuteOrderFromTable, MoveToPosition, …
  └───────────────┘
        │
        ▼
 world (Dota engine)
```

Twenty files, fourteen test files sitting beside them. The layers matter less than
the line between them: **perception and executor are the only two layers that know Dota
exists.** Everything in the middle is a function from plain data to plain data.

The reason to draw the line there and not somewhere else is that the middle is where all the
interesting bugs live. Aim leading, target selection, retreat thresholds, shop timing, dodge
geometry — these are the parts that are wrong in subtle, gameplay-visible ways, and they are
exactly the parts you want to iterate on a hundred times an hour. If they can only be
exercised inside a thirteen-minute VM run, you will iterate on them four times a day instead.

## 7.2 The purity rule

We wrote this into the implementation plan as a global constraint before any code existed —
not as a style preference, but as a named rule with a list of files it applied to:

> **Purity rule.** These files touch **zero** Dota globals. No `Vector`, no `GameRules`, no
> `PlayerResource`, no `RandomFloat`, no `Entities`. Plain `{x, y}` structs in, decisions out.

Three mechanical consequences make it real:

**Randomness is injected.** Every function that needs a random number takes a `() => number`
parameter. Tests pass a fixed sequence; production passes the engine's RNG. Aim error is
gaussian noise around the true lead point, and being able to feed that a deterministic
sequence is the difference between a test suite and a coin flip.

**The same file compiles twice.** We called this the dual-compilation rule. Each pure module
must compile under TypeScriptToLua (into the game) *and* run under vitest (into node). In
practice that constrains you to `Math.*`, `Map`, arrays, plain interfaces — a small, boring
subset. That is fine. Decision logic doesn't need anything else.

**Test files never become Lua.** `src/vscripts/tsconfig.json` carries
`"exclude": ["**/__tests__/**"]`, and `vitest.config.ts` includes exactly those directories.
The two configs are complementary halves of one trick; without the exclusion your test files
compile into the addon and your addon load breaks. See
[chapter 5](05-testing-without-engine.md) for the full setup.

The payoff, measured: the project's unit suite went 30 → 141 → 192 → 314 → **375 tests across
47 files**, running on a Mac with Dota not installed. The bot engine alone landed with 92
tests green, then 109, then 117 after integration. Every one of those runs in seconds, in CI,
on every push.

A useful way to decide whether a piece of logic belongs in the pure zone: ask what would have
to be true for it to be wrong. If the answer is "the numbers are wrong" or "the state machine
took the wrong branch," it's pure logic and it belongs in the fast lane. If the answer is
"the engine ignored the order," it's engine-facing and it belongs in the VM lane.

## 7.3 The think tick is a commitment, not a recomputation

This is the most important single idea in the chapter, and it arrived as a disaster.

On July 7 we ran a ten-minute headless combat smoke. The bots moved. The bots aimed. The
bots issued cast orders — approximately **thirty-nine cast orders per second**. And they
released **zero arrows** and scored **zero kills in ten minutes**.

The diagnostic line that cracked it was `arrowBlocked=0`: no arrow had ever been blocked,
because no arrow had ever *launched*, because the cooldown had never started. Thirty-nine
casts a second, none of which happened.

The cause is a shape you will meet in any agent loop over any engine. The bot's think tick
ran every 0.25 seconds. Each tick recomputed the world from scratch and re-issued the full
intent: orbit-move to maintain spacing, then cast at the lead point. But a Dota cast has a
turn time plus a cast point — call it 0.2 to 0.4 seconds of windup — and issuing a *new*
order cancels whatever is winding up. So every tick, the bot cancelled its own cast a
fraction of the way through the windup and started a fresh one. Forever.

The fix is four lines and a constant:

```ts
/* … re-issuing orbit-move + cast every tick cancels the windup forever — the
 * 2026-07-07 EngineDrive smoke: ~39 cast orders/s, zero arrows released,
 * zero kills in 10 min (arrowBlocked=0 proved the cooldown never started). */
const CAST_HOLD_SECONDS = 0.9;
```

After issuing a cast, the agent holds — it suppresses all new orders until the hold expires.
The expiry does double duty as a stuck-cast timeout: if 0.9 seconds pass and nothing
happened, the bot is unstuck and free to act again.

Generalize it past Dota, because it generalizes cleanly:

> **An agent loop that re-issues its full intent every tick will starve any action with a
> windup.** Design ticks as commitments, not as recomputations.

Anywhere a downstream system has a multi-tick execution phase — animations, network requests,
physics settles, tool calls — a controller that recomputes-and-reissues at a frequency higher
than the action's completion time produces exactly this pathology: maximum activity, zero
throughput, and logs that look busy and healthy.

It was locked in with a regression test whose name is the whole story:

```
"holds engage orders while a cast is winding up (no windup-cancel loop)"
```

Name tests after the incident. Six months later that name explains itself; `test cast hold`
does not.

### The real lesson: build the counter panel before the theory

We want to be precise about *how* that bug was found, because it is more transferable than
the bug.

It was not found by reading `botAgent.ts`. Several passes of reading the code had already
happened, and the code looked right — because it *was* right, line by line. It was found by
building a small diagnostic module, `combatDiag.ts`, that counted things per second and
printed them:

- cast orders issued per second: **~39**
- arrows launched: **0**
- arrows blocked: **0**
- kills: **0**

Put those four numbers side by side and the bug is not a hypothesis, it is arithmetic.
Thirty-nine orders and zero launches means the orders aren't completing. Zero blocks means
the cooldown never started, which means the cast never fired, which means each order is being
superseded. There is nothing left to guess.

> **When an autonomous system is doing something wrong and you can't see why, build a counter
> panel before you build a theory.** Count the events at each stage of the pipeline. The stage
> where the count collapses is the bug. This costs twenty minutes and replaces an afternoon
> of hypothesizing.

This applies with double force when an agent is doing the debugging, because an agent's
failure mode is generating plausible theories quickly. Give it numbers and the theories stop
being necessary.

## 7.4 Silent no-ops need injectable predicates

The second pathology: **nine bots stood idle for six or more minutes with zero kills.**

Not thrashing. Not fighting badly. Standing perfectly still, in a playtest, while the human
watched.

The cause was `MoveToPosition` called with an unpathable destination — a point past the arena
rim wall, or otherwise outside the navigable box. The engine's response to an unpathable move
order is to do nothing, silently. No error, no return value, no log.

The naive fix is to clamp destinations to the arena bounds. That works until the map changes,
and it doesn't help you test anything. What we did instead was inject the pathability check
as a predicate at the engine boundary:

```ts
// huntNav.ts — pure. canPath is injected.
export function nextWaypoint(
  state: HuntState,
  canPath: (from: Vec2, to: Vec2) => boolean,
): Vec2 | null
```

In production, `canPath` is a thin wrapper over `GridNav.CanFindPath`. In tests, it is a
function you write in three lines that says "everything inside this rectangle is pathable."
And suddenly waypoint rolling, stuck detection and last-sighting pursuit — the parts that
were actually subtly wrong — are ordinary pure functions with ordinary unit tests.

The comment that now sits above the fix:

```ts
/* MoveToPosition to an unpathable point … silently no-ops — 9 bots stood
 * idle for 6+ minutes with 0 kills in the 2026-07-05 playtest. */
```

The general rule (rule 9, and the reason [chapter 4](04-landmines.md) exists) is: **for every
engine API that can fail silently, define a predicate that answers "would this work?", inject
it, and unit-test the logic that depends on it.** You get testability and an explicit failure
signal in the same move — because now the bot can log `no pathable waypoint found` instead of
standing still and saying nothing.

There is a related instance worth naming, because it isn't about pathing at all. Bots dodged
incoming arrows using a threat registry that recorded each arrow's launch position and speed —
but the registry recorded the *base* arrow speed, while an item (Raiju's Longbow) boosted the
real speed. So the bots dodged arrows that had already passed them. The fix was an optional
`speed` override on `trackArrowLaunch`, and the note in the commit is the right framing:
*"threat model stays honest."* Any model the bot keeps of the world will drift from the world
the moment a feature changes one of its inputs. Make the model take the real value as a
parameter rather than assuming a constant.

## 7.5 Hysteresis bands, not boolean gates

The third pathology: **funded bots never bought anything.** They accumulated gold all match
and completed zero purchases.

The shop logic said, in effect:

```ts
const canShop = enemies.length === 0 || insideShopZone;
```

Read that on a whiteboard and it is obviously reasonable: go shopping when nothing is trying
to kill you. Now run it in a hot-centre free-for-all where an enemy is visible almost all the
time, on a loop that re-evaluates several times per second. On tick N there are no enemies in
range, so the bot heads for the shop. On tick N+1 someone walks into vision, so it aborts and
engages. On tick N+2 they walk out again. The bot oscillates between two states forever and
completes neither.

The fix was to stop asking a boolean question and start asking a banded one:

```
engage radius        900
sniper radius       1400
SAFE_SHOP_BAND      1500   ← commit to shopping only when the nearest enemy is beyond this
```

The shop band sits deliberately *above* both combat radii. When the bot decides to shop, it is
committing from a position where the decision will remain valid for a while, rather than from
the knife-edge where a single step flips it back.

> **Boolean state gates in a hot loop produce oscillation. Use hysteresis bands.**

If you have written a state machine that flickers, the question is never "which branch is
wrong" — both branches are right — it is "how far apart are the enter and exit thresholds."
The generalization of both this and the cast-hold fix is the same: a decision made at high
frequency must include a reason to *stay* decided.

Note also that this bug is only visible with money in the world. Which brings us to a small
practical thing that mattered more than it should have: a `-gold` chat command that grants
20,000 gold on demand, added because the human asked for a testing affordance rather than
enduring the friction:

> `give me 20k of money to allow test it witout fricction` [sic]

Ten minutes of work, used for the rest of the project. Build the affordance.

## 7.6 Difficulty is a table, not an algorithm

Four difficulty tiers ship: easy, medium, hard, unfair. They are not four bot implementations,
or four behaviour trees. They are one bot reading four rows of a table:

| Tier | Aim error σ | Reaction time | Dodge chance |
|---|---|---|---|
| easy | 12° | 600 ms | 20% |
| medium | 7° | 400 ms | 45% |
| hard | 3° | 250 ms | 75% |
| unfair | 1° | 150 ms | 90% |

That is the entire difficulty system, and the design is deliberate. Because arrows are
skillshots, the interesting axis of skill in this game is *aim* and *timing*, so difficulty
lives in the noise applied to the lead point and in how long the bot waits before responding
to a stimulus. It is not in "hard bots know a secret combo."

Three things this buys you:

**It's testable.** Aim error is gaussian noise around a computed intercept point, with the
RNG injected — so a test can assert that at σ=1° the shots cluster within a bound and at
σ=12° they don't, deterministically.

**It's tunable without code.** Difficulty is exposed as a convar (`archer_wars_bot_difficulty`,
0–3) and as an all-chat command the host can type pre-horn (`-difficulty easy|medium|hard|unfair`).
Changing the feel of the game does not require a rebuild.

**The numbers are traceable.** The table appears verbatim in the design spec, and the
implementation plan carried a global constraint reading "difficulty values verbatim from
spec." When a number in the code disagrees with a number in the spec, that is a bug in one of
them, and you can tell which.

The broader pattern: **push behavioural variation into data, keep exactly one code path.** An
agent asked to "make the bots harder" will otherwise happily add branches, and you will end up
with four subtly divergent bots and no idea which one your recordings actually exercised.

## 7.7 A bot is also an evidence-production tool

One last reframing, because it changes design decisions.

Once the bots were the test rig, we started needing things from them that a player-facing bot
never needs:

- **A director camera** that finds the hottest fight and frames the centroid of the cluster,
  so the recording contains combat rather than empty field.
- **A demonstrator mode** where one hero is owned by the recording host — because the engine
  hides a bot's HUD from a spectator, so item purchases were being recorded as a caption over
  an empty inventory bar.
- **A live victim**, deliberately positioned in frame, for each of the 42 class×slot casts —
  because a skill clip showing only the caster proves nothing about whether the skill connects.
- **Spawn pathability probes**, after the star of a fifteen-minute showmatch spent the entire
  match sealed inside a tree pocket at spawn slot 0, casting into nothing.

None of those improve the bot as an opponent. All of them improve the bot as a camera
operator and stunt double. If your bots are going to carry your verification, budget for that
second job explicitly — it is a real chunk of work and it does not look like AI programming.

---

## Checklist

- [ ] Perception and executor are the only layers that touch engine globals.
- [ ] Every decision module is pure, with RNG injected, and has tests next to it.
- [ ] Test directories are excluded from the Lua emit and included in vitest.
- [ ] The think tick holds after issuing any action with a windup.
- [ ] Every silently-failing engine call is behind an injectable predicate.
- [ ] State transitions in the hot loop use bands with separate enter/exit thresholds.
- [ ] Difficulty (and any behavioural variation) is a table, not a branch.
- [ ] There is a counter module that reports per-second event counts at each pipeline stage.
- [ ] Every constant that came from an incident has a dated comment saying which one.

**Related:** [chapter 5, testing without the engine](05-testing-without-engine.md) ·
[chapter 6, the VM rig](06-autonomous-vm-rig.md) · the bot failures in full narrative form are
[F5, F6 and F7 in chapter 11](11-failure-casebook.md).
