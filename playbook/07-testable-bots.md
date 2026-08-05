# 7. Bots You Can Unit-Test

Every custom game eventually needs bots. Ours needed them more than most: Archer Wars is a
ten-player free-for-all, and there is no way to test a ten-player free-for-all with one human
and a laptop. The bots were not a feature we added for players — they were the thing that made
the game testable at all. Every recorded verification run in this project is a bot match.

That inverts the usual priority. If the bots are the test rig, the bots have to be more
trustworthy than the game, and they have to be debuggable without booting the game. This
chapter is how we got there, and the five pathologies we hit on the way.

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
47 files** by the end of the build, and → **705 across 63** after the adversarial review pass,
running on a Mac with Dota not installed. The bot engine alone landed with 92
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

### Watchdogs must escalate to a different place

The other half of stuck-handling is the rescue itself, and it has a failure mode of its own.
Pudge Wars run 19 (2026-07-28) still showed a residual micro-lock after four rounds of fixes:
bots pinned in place, the stuck watchdog firing correctly, and nothing changing. The watchdog's
rescue action was a `FindClearSpace` nudge — issued at the bot's own current position. Which
is, of course, exactly the state it was rescuing the bot from. The watchdog ran, logged, and
did nothing, forever, at whatever frequency it was set to.

> **A watchdog's rescue action must be provably DIFFERENT from the state it rescues.** If the
> escape can resolve to "where you already are," it is not an escape. Displace by a real
> distance in a chosen direction, or teleport, and assert the delta.

There is a second, harder-earned rule sitting next to it. Every one of those runs was a
behaviour fix, and **four of five Pudge Wars regressions in that arc were introduced by the
previous fix**: a hysteresis change parked bots at the entry HP threshold (run 15); a
survivability stack starved the kill pace (run 16); a re-hook reset the stranded clock forever
and produced a perma-brawl (run 17). Bot behaviour is a coupled system where every constant is
load-bearing for some other subsystem's gate. So: **every behaviour fix is re-judged by the
FULL gate set, not by the gate it was written to turn green.** A fix that lands one marker and
silently breaks another is the normal case, not the surprising one.

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

### Ability points do not spend themselves

The same category, discovered the expensive way on Pudge Wars run 2 (2026-07-26). Nine live
bots converged, moved, fought, and printed exactly zero `[HOOK]` lines. Nothing was broken.
The hook was at **level 0**, and a level-0 ability is uncastable — `IsFullyCastable()` returns
false, the order is discarded, and nothing anywhere says why. A human player spends points
without thinking about it; a fake client never will, because nobody is clicking the plus
buttons.

So every bot-driven e2e needs an explicit leveling loop, and it needs two properties:

**Spread lowest-level-first, not slot order.** Run 4 passed with slot-order leveling and
shipped Rot with literally zero ticks — points went into the first ability until it capped, so
the later abilities never came online and their gates could never see anything. Lowest-first
guarantees every ability reaches level 1 before any reaches level 2, which is what an evidence
run wants even though it is not what a player wants.

**Watch the dilution trap.** The spread is a fixed budget divided by the kit size, so *every
ability you add dilutes it.* Run 18 failed its pace gate purely from this: three new actives
landed, the same XP now bought level 1 across six abilities instead of three, and level-1
combat could not close against level-1 escapes. The fix is not more XP — it is noticing. **Pin
a pace gate (kills inside the window) and re-check it whenever the kit grows.**

The affordance that makes the loop cheap is an XP grant at the horn — Pudge Wars boosts 1300
XP the moment the match starts, which puts the whole kit at level 1 before the first
engagement. Note the arithmetic, because it bit us: the level-3 curve step is 640, so 600 XP
buys *two* points, not three. Compute the boost from the actual curve, log the resulting
levels, and you get a bounded, verifiable window between "match starts" and "kit is online."

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

### The recording host can play the match

The demonstrator mode above solves the HUD problem by giving the recording host a hero. Pudge
Wars pushed it one step further, and the step is small enough to be worth copying: **let the
host's hero be driven by the bot FSM like every other seat.** Include player id 0 in the bot
roster, and skip it in any harness XP or gold boost so it levels on camera at the same rate as
the match it is in.

With `+dota_camera_lock` on that hero, the recording is centred player-POV footage of a real
match — the host hunts, hooks, gets hooked, buys, dies, respawns — with a live HUD, a real
inventory bar, and a camera that cannot wander off the fight because the fight is wherever the
subject is. That is how the Pudge Wars handover video was shot. It costs one line in the
roster and one exclusion in the boost, and it replaces both the "camera never framed the
action" failure and the "HUD is empty because the subject is a bot" failure at once.

(The other camera route — parking an invisible invulnerable host hero mid-arena as a tripod —
frames both sides for the whole match and is better for *layout* evidence. Pick by what the
run has to prove: POV for feel and HUD, tripod for shape.)

### Gate on a mechanism you cannot reach, and you have to build a probe

Pudge Wars had a river that burns anything standing in it. It also had an order filter that
keeps bots out of the water by construction. Both correct — and together they made the hazard
gate **unpassable**: in a healthy run, no bot ever enters the river, so `[RIVER] burn` never
prints, so the gate that proves the hazard works can only ever fail.

The answer is not to delete the gate or to weaken the enforcement that made it unreachable.
It is to have the harness **manufacture the state**: teleport one bot into the water for five
seconds, on camera, then release it. The mechanism gets exercised, the marker fires, and the
frame reviewer gets a visible burn to point at.

> **A gate on a mechanism that healthy behaviour can never reach is a probe, not an
> assertion.** Write the probe deliberately, keep it inside the same tools-mode + convar
> interlock as the rest of the harness, and make it produce frames as well as markers.

One caveat that cost a run: **a probe has to survive the game's own lethality.** A stationary
bot parked in the open, in a meta where hooks kill, is a free kill — the probe died before
completing its five seconds and the gate failed for reasons that had nothing to do with the
mechanism under test. Probes need the same robustness as any other actor: retry on death,
bound the number of attempts, and log which attempt produced the evidence.

## 7.8 A flatlined rate that smells like dice and is actually geometry

The fifth pathology, and the only one in this chapter that was solved with arithmetic on
paper before a line of code changed. Pudge Wars, three consecutive runs (2026-08-02):
**`[DODGE]` fired roughly once per hundred hooks.** The dodge chance in the difficulty table
was 45%. Hundreds of hooks were flying. One in a hundred was being dodged.

Everything about that shape says *random number generator*. A rate that is not zero but is
absurdly low reads as a botched roll, a wrong seed, an injected RNG returning something
degenerate, a threshold comparison flipped. That is where an afternoon goes if you let it.

The cause was in a different subsystem entirely, and it is a coupling worth naming.

**The shooters aim with intercept lead.** Skillshot bots do not fire at where the enemy is;
they solve for where the enemy *will be* when the projectile arrives, and fire there. Against
a strafing target at Pudge hook speed, that predicted point sits up to **~165 units** away
from where the target is standing at the instant of launch.

**The dodgers computed threat against where they were standing.** The threat model took the
hook's flight line and asked for its closest approach to the bot's current position, with a
tolerance of `radius + 60`. A led shot's line passes *through the predicted point* — by
construction, well outside a 60-unit skirt around the present one. So the dodger looked at a
hook aimed precisely at it, computed "passes wide," and did nothing. The 1-in-100 that did
fire were the shots at targets that happened not to be moving.

The fix was one constant: widen the self-radius to 150, covering the lead envelope. It fixed
it in a single run.

Two rules come out of it, and the second is the more useful one.

> **The threat model must mirror the aim model.** Whatever lead the shooter computes, the
> dodger's tolerance has to cover — they are two halves of one geometry, and they are usually
> written weeks apart by different reasoning. Any time you change how the shooter predicts,
> re-derive what the dodger tolerates.

This is the same failure as the Raiju's Longbow speed drift in §7.4, one level up: there the
model held a stale *constant*, here it held a stale *assumption about the opponent's
algorithm*. Both are the bot's world-model diverging from the world.

> **Before blaming variance, compute the expected trigger rate from the geometry.** A
> five-minute calculation — how far does the aim point move, how wide is the tolerance, what
> fraction of shots can therefore ever qualify — predicts ~1% and points straight at the
> constant. Randomness is the most seductive available explanation for a low rate, and it is
> unfalsifiable by inspection, so it will absorb as much debugging time as you give it.

Generalized: when a stochastic-looking system produces a rate you did not expect, derive the
rate you *should* expect from first principles before touching the RNG. If the geometry
already explains the number, the dice were never involved. This is the statistical sibling of
§7.3's counter panel — there you count the pipeline stages to find where events vanish; here
you compute the rate the design implies and compare it to the rate observed. Both replace a
theory with an arithmetic.

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
- [ ] The threat/dodge model's tolerance covers the aim model's full lead envelope.
- [ ] An unexpected rate gets an expected-rate calculation before it gets an RNG hypothesis.
- [ ] The e2e harness levels bot abilities — lowest-level-first — and the spread is re-checked
      against a pace gate whenever the kit grows.
- [ ] Every watchdog's rescue action is provably different from the state it rescues.
- [ ] Every behaviour fix is re-judged against the full gate set, not just its own gate.
- [ ] Any gate on a mechanism healthy behaviour cannot reach has a probe, and the probe
      survives being killed.
- [ ] Every constant that came from an incident has a dated comment saying which one.

**Related:** [chapter 5, testing without the engine](05-testing-without-engine.md) ·
[chapter 6, the VM rig](06-autonomous-vm-rig.md) · the bot failures in full narrative form are
[F5, F6 and F7 in chapter 11](11-failure-casebook.md).
