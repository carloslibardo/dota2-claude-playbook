# 0. Ten Rules

This is the front door. Everything else in the playbook is an expansion of one of the ten
rules below.

They are not principles we thought up before starting. Every one of them is the scar tissue
left by a specific failure during the Archer Wars build — a Dota 2 custom game we rebuilt
from nothing with Claude Code between July 4 and July 14, 2026. When a rule sounds obvious,
assume we learned it the expensive way anyway. The failure that produced each rule is told
in full in [chapter 11, the failure casebook](11-failure-casebook.md).

If you read nothing else, read these ten and then read chapter 11.

---

### 1. Verify at the effect level, never the call level

"The cooldown started" is not "the hook pulled." Our grapple ability shipped broken twice
because the only assertion in the smoke test was `GetCooldownTimeRemaining() > 0` — which is
true whenever the ability *casts*, including when it does absolutely nothing afterward. The
assertion you want is the one about the world: HP dropped, the unit moved 250 units toward
the caster, the modifier is present on the victim.

> Expanded in: [chapter 5 (testing without the engine)](05-testing-without-engine.md)
> and [chapter 11, F8](11-failure-casebook.md#f8).

### 2. Watch the frames

For anything visual, logs are a hypothesis and pixels are the evidence. The single most
expensive lesson of the project was an agent reporting a gameplay video as "verified" while
the camera had not moved for the entire match — the logs said `shown=42/42`, the video showed
empty terrain. Extract frames with ffmpeg, open them, look at them. Then write frame review
into your acceptance criteria as a written requirement, so it survives the next agent and the
next week.

> Expanded in: [chapter 1](01-why-this-is-hard.md) and [chapter 11, F11](11-failure-casebook.md#f11).

### 3. When a deliverable is rejected twice for the same reason, fix the evidence pipeline, not the deliverable

Three consecutive evidence deliverables were rejected for the same class of failure: the logs
said pass while the frames showed nothing. The fix was not a fourth attempt at the
deliverable. It was a whole spec — spec 003 — about *how things get proven*: a host
demonstrator so the HUD renders, a live victim in frame for every cast, a hang detector. If
you are re-cutting the same video a fourth time, you are working on the wrong artifact.

> Expanded in: [chapter 3 (the SDD loop)](03-sdd-loop.md) and [chapter 11, F12](11-failure-casebook.md#f12).

### 4. Seed your new test harness with known-broken features

A brand-new quality gate that reports green tells you nothing, because you have not yet
established that it *can* report red. When we built the publish quality gate we deliberately
pointed it at two features we knew were broken — the grapple pull and the ice bow's frost
proc — and wrote into the spec: *"they are real bugs, and Phase A/B assertions must reproduce
them or the assertions are wrong."* Test the test before you trust the test.

> Expanded in: [chapter 6 (the autonomous VM rig)](06-autonomous-vm-rig.md).

### 5. Detect liveness — a hung run must FAIL, not silently pass

One attempted fix hung the engine and produced zero evidence, which a naive harness happily
reports as "no errors found." Our answer became a functional requirement in spec 003: if the
game clock stops advancing while the wall clock keeps going, the run is a FAIL. Any long
autonomous run needs a heartbeat that distinguishes "finished quietly" from "died quietly."

> Expanded in: [chapter 6](06-autonomous-vm-rig.md) and [chapter 11, F12](11-failure-casebook.md#f12).

### 6. Keep the fast lane fast

Pure logic goes in a `lib/` that unit-tests on your laptop in seconds with no game engine
present; the expensive rig is reserved for what only the rig can prove. We ended the build at
375 tests across 47 files running on a Mac with Dota not even installed — 705 across 63 after
the review pass — covering bot decisions, arena geometry, shop eligibility and hysteresis
bands. A recorded VM run took thirteen minutes.
Everything you can move from the second lane to the first lane you should.

That includes your **data**, not just your logic. Every hand-maintained table
that mirrors something the engine owns — a shop catalog beside `shops.txt`, a bot
kit map beside the hero KV, an ability-name list beside the ability files — will
drift, and the drift is silent: the item is simply unbuyable, the class simply
never casts. Three of those shipped in Archer Wars at once. A *drift test* — pure
Node, `readFileSync` the authoritative file, twenty lines of parser, diff it
against the TypeScript — costs an hour and closes the class permanently. Derive
the second copy if you can; diff it if you cannot.

> Expanded in: [chapter 5](05-testing-without-engine.md) and [chapter 7 (testable bots)](07-testable-bots.md);
> the failure is [chapter 11, F17](11-failure-casebook.md#f17).

### 7. Encode every root cause as a dated comment next to the constant it produced

Roughly forty comments in the Archer Wars source carry a date and an incident. The constant
`CAST_HOLD_SECONDS = 0.9` sits directly beneath a comment explaining that the 2026-07-07
smoke run produced ~39 cast orders per second, zero arrows released and zero kills in ten
minutes. Future agents read *why*, not just *what* — which is what stops a "cleanup" from
re-landing a bug you already paid for.

> Expanded in: [chapter 10 (working with Claude)](10-working-with-claude.md).

### 8. Structured console markers are the API between the game and the harness

Pick a marker contract — `[TAG] EVENT k=v` — emit it from the game, and parse it with a
committed script. Ours included `[E2E] driving N archer(s)`, `[QGATE] MARK <phase>/<subject>
t=<GameTime>`, `[SHOWCASE] COVERAGE shown=42/42`. Because the QGATE marks carried a game
timestamp, every FAIL mapped to a chapter index next to the video, so a failure was a
timestamp you could scrub to rather than a mystery.

> Expanded in: [chapter 6](06-autonomous-vm-rig.md).

### 9. Silent no-op engine APIs are the top hazard in game work

Game engines are full of calls that fail by doing nothing at all. `MoveToPosition` to an
unpathable point: no error, no log, bots stand still for six minutes. An unregistered convar:
reads as `0`, harness runs the wrong mode while printing right-shaped logs. `override_hero`
in the hero KV: precache succeeds, KV is valid, docs say it registers a spawnable name, and
the engine disagrees. Wrap each one in a predicate you can unit-test, and log the resolved
value at boot.

> Expanded in: [chapter 4, the landmine catalog](04-landmines.md) and [chapter 1](01-why-this-is-hard.md).

### 10. Your CI platform is not your player's platform

The quality gate ran green on a Windows GPU VM while the same build produced 193 modifier
errors on the author's retail macOS client, because retail macOS Dota ships a Lua VM without
the `debug` library. An entire class of bugs lived in that gap. Name the gap explicitly in
your spec and keep a short honest manual checklist for the platform your gate cannot reach.
A scoped green beats a false green.

> Expanded in: [chapter 4, L1](04-landmines.md) and [chapter 11, F9](11-failure-casebook.md#f9).

---

## The meta-rule

If you look at how the human's requests escalated over eleven days, there is a ladder:

```
build X  →  test X  →  record X  →  did you *watch* the recording of X?  →  spec how X will be proven
```

The failure rate collapsed at the last rung. The lesson underneath all ten rules is that the
human out-engineered the agent by attacking its **evidence**, not its code. Chapter 10 is the
operating manual for doing that deliberately.
