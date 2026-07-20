# How I rebuilt a deleted Dota 2 custom game with Claude Code

*The technical version. If you came from the thread, this is the part with the receipts.*

---

## The loss

Somebody published a Dota 2 custom game called Archer Wars around 2015. Ten players, one arena, every shot a skillshot, first to 20 kills. Then Steam moderation removed the Workshop item and it was gone. Not archived, not forked, not mirrored — gone. No source, no backup, no `.vpk` sitting in anybody's Steam folder.

I wanted it back. On July 4th I started rebuilding it from nothing, with Claude Code doing the typing.

The first problem wasn't code. It was that there was nothing to build *from*. You cannot spec a game you half-remember from a decade ago; you'll get a game that matches your nostalgia and nobody else's. So the first commit in the repo isn't code at all — it's a design spec and a folder of research captures:

> `85d5dd9` — the first commit: a design spec and research captures, not code.

That set the tone for everything after it.

### Archaeology

Four sources, in descending order of trustworthiness:

1. **Wayback Machine snapshots of the dead Workshop page** — title, description, the hero list, the screenshots. Enough to fix the shape of the mode.
2. **A fan wiki** — ability names and rough behaviour, written by players, so: directionally right, numerically unreliable.
3. **A public GitHub mirror of a 2015 dev snapshot.** Somebody had pushed a work-in-progress copy years ago and never touched it again. This is where the real structure came from.
4. **The 2010 Warcraft 3 map it descended from.** Archer Wars was a Dota 2 port of a WC3 arena map. WC3 maps are `.w3x` archives, and the ability data lives in a binary `w3a` table inside. Parse that and you get the *original numbers* — damage, cooldowns, ranges — as the original author typed them.

That last one produced the detail I still like best: one ability's design survived intact from a 2010 Warcraft 3 map, through a 2015 Dota 2 port, into what I shipped in 2026. Sixteen years, three engines, same numbers. I kept them.

The method matters more than the haul, so here it is as a rule: **every recovered fact gets a bracketed source tag** — `[wiki]`, `[workshop 2025]`, `[wc3 w3a]`, `[github <repo>@<sha>]` — and **every gap gets tagged `DESIGN-FRESH`**, meaning "nobody recovered this, I invented it." Unresolved contradictions between sources go in an explicit *Unknowns* list rather than getting quietly resolved by whoever writes the code. And the dossier opens with a clean-room notice: names, rules and numbers were recovered; no code and no assets were reproduced.

Without that discipline the agent will happily paper over a gap with something plausible, and six weeks later you have no idea which of your balance numbers are archaeology and which are hallucination.

One commit is the whole argument for doing the research first:

> `cd9a0de` — `docs+infra: correct archer count 5→4 (leaked source)`

The spec had guessed five archer classes. The recovered source said four. The research overrode the design doc, three hours into the project.

---

## The toolchain, briefly

Dota custom games are Lua. I didn't want to write Lua, and more importantly I didn't want an agent writing untyped Lua against an engine API it half-remembers.

- **TypeScript → Lua** via [TypeScriptToLua](https://typescripttolua.github.io/), with `@moddota/dota-lua-types` for the engine surface. The agent writes TypeScript, gets red squiggles when it invents an API, and `tsc --noEmit` catches the rest in CI.
- **Panorama UI** is separate TypeScript compiled by plain `tsc` (different types, different target, different output dir).
- **`bun` for everything**: `bun run build` (both compilers in parallel), `bun run dev` (both in watch), `bun run test` (vitest), `bun run launch` (starts Dota in tools mode with the addon).
- **A `postinstall` symlink script** moves `game/` and `content/` into `<Steam>/…/dota_addons/<addon>` and junctions them back. It **no-ops silently when Dota isn't installed**, which is the trick that makes the next line possible.
- **CI on GitHub Actions, on Ubuntu, with no Dota anywhere.** Typecheck both projects, build, run the unit tests. You get real continuous integration on a Valve game mod.

The scaffold and the CI gate landed within a minute of each other (`e072a13`, `57bdef3`) — test infrastructure before the first feature. Three hours after the first commit there was a playable loop:

> `6040861` — `feat: FFA core loop — forced archer, linear-projectile arrow, kill scoring, win at 20`

Then reality arrived. The next five commits are all fixes for engine APIs that don't exist:

> `7189bd2` — `fix(modifiers): modifier_eagle_eye — ModifierState.TRUE_SIGHT doesn't exist`

> `4d52282` — `fix(systems): rewrite shopZone.ts to poll — trigger-touch events don't exist`

That second one isn't a typo fix, it's an architecture change forced by an API that only existed in the model's imagination. Call it the plausible-Dota tax. It's real, it's constant, and typed bindings plus a compile gate are how you keep it from reaching the game.

---

## The loop that actually produced the code

Everything in this repo went through the same cycle. I did not "vibe code" a game; I ran a ledger.

```
research      (dossier / a playtest complaint / a reviewer's exact words)
  → spec.md      user stories, Given/When/Then acceptance, explicit non-goals
  → plan.md      architecture + GLOBAL CONSTRAINTS + numbered tasks w/ literal code
  → contracts/   the [MARKER] log contract the verifier will grep for
  → implement    one commit per task, tests green before each
  → evidence     VM run → console markers → frames/video → a written verdict
  → landmine     anything that surprised me becomes a code comment + a CLAUDE.md invariant
```

The last arrow is the one nobody else writes down, and it's the one that compounds.

### A real example: the bot engine

Design spec, 164 lines. Implementation plan, 2,683 lines. The plan is longer than most of the code it produced, and that is the point.

The spec fixed the architecture (a layered FSM: SHOP / HUNT / ENGAGE / RETREAT plus a reflex layer), enumerated the module tree, and pinned the difficulty table — aim error σ of 12° / 7° / 3° / 1°, reaction times of 600 / 400 / 250 / 150 ms, dodge rates of 20 / 45 / 75 / 90% across easy → unfair.

But the plan's *Global Constraints* section is the star. It contained, among others:

- **A purity rule**, naming the exact files forbidden from touching any Dota global — no `Vector`, no `GameRules`, no `PlayerResource`, no `RandomFloat`. Plain `{x, y}` structs in, decisions out. RNG is always an injected `() => number`.
- **A dual-compilation rule**: the same file must compile under tstl *and* run under vitest. Practically that means `Math.*`, `Map`, arrays, interfaces, nothing exotic.
- "Bots never drive human heroes."
- "Difficulty values verbatim from the spec" — no improvising balance mid-implementation.
- "Commit after every task; run `bun run test` first."

Task 1 of the plan is literally *"extend `vitest.config.ts`, write `vec.ts`, write its failing test."* TDD ordering baked into the document the agent executes.

The payoff: `src/vscripts/bots/` is 20 files with 14 test files beside them, and the entire decision layer runs on my Mac in milliseconds with Dota nowhere in sight. The engine-facing layer stays thin — it translates world state into plain data going in, and decisions into orders going out. That's the part you can't unit-test, so you keep it as small as you can and cover it downstream with the VM.

That trick has two halves that have to agree: `src/vscripts/tsconfig.json` has `"exclude": ["**/__tests__/**"]` so test files never become Lua, and `vitest.config.ts` includes exactly those directories. Complementary halves of one idea.

The most-churned files in the whole repo tell the same story. Excluding generated map data and docs, the top three are `systems/e2eBots.ts`, `mapgen/datamodel.py`, and `systems/qualityGate/qualityGate.ts`. The three files I edited most are all **verification infrastructure**, not gameplay.

And the single most-churned document is the bot-engine *plan*, at 5,366 lines of churn. The ledger is a first-class artifact, not paperwork.

---

## The failure museum

Here's the thing I want you to take from this more than anything else: 274 commits on `main`, and **86 of them are `fix`**. Against 104 `feat`. A fix-to-feature ratio of 0.83.

Zero reverts. Nothing was ever backed out wholesale — every correction is a forward fix with a message explaining what was broken.

I'm not embarrassed by that ratio, I think it *is* the deliverable. Every one of those fixes is a landmine that an agent stepped on so you don't have to, and each one has the same shape. Failure on the left, rule on the right:

| The failure | The rule it produced |
|---|---|
| Every module died at load on retail macOS with *"Script Runtime Error: error in error handling"* | tstl emits `__TS__SourceMapTraceBack(debug.getinfo(...))` at the top of every file; retail Dota's Lua VM has **no `debug` library** (tools mode does). Set `sourceMapTraceback: false`, ship a `debugPolyfill.ts` that shims only `debug.traceback`, and import it **first** in `addon_game_mode.ts`. Don't fake `getinfo` — the adapter feature-detects it. |
| The class-select screen showed 11 locked classes and spawned **zero heroes** | Custom heroes are never the map's forced hero, so the engine never precaches them, and `CreateHeroForPlayer` then fails with "unit … is invalid". Loop `PrecacheUnitByNameSync` over every allowed hero in `Precache()`. Same for particles: an un-precached particle renders **nothing**, silently. |
| I picked an archer and got **Invoker** | `SetCustomGameForceHero("npc_dota_hero_windrunner_custom")` fails *silently* — the hero grid appears anyway, unclickable, then the engine random-assigns a stock hero at timeout. Custom hero names do not exist. **Override base heroes in place** (the OAA pattern). Consequence: `GetUnitName()` returns the BASE name forever, so every hero-keyed dispatch table must key base names. |
| The tools client hard-crashed — process dead, no traceback, no log | `dota_bot_populate` cannot handle a laneless FFA map. Seat bots with `dota_create_fake_clients` in **tools mode**, and `GameRules.AddBotPlayerWithEntityScript` for **real matches** (it's cheat-free and creates its own hero). Two modes, two APIs. |
| The bot driver logged *"driving 0 archer(s)"* while nine bots fought a perfectly good match | `PlayerResource.GetSelectedHeroEntity()` returns nil for fake clients — they're seated after selection closes and get heroes *assigned*, not *selected*. For `CreateHeroForPlayer` bots **both** accessors return nil even while the hero is alive and scoring. Resolve through one helper: selected → assigned → last-resort scan of `HeroList` by `GetPlayerOwnerID()`. |
| Nine bots stood in a pile at the centre of the map for an entire match | The eight `DotaTeam.CUSTOM_*` teams have **no Hammer spawn points**, so everyone spawns at world origin. Assign explicit per-team ring slots yourself. |
| The whole game mode failed to load — stock team-select lobby, no custom game, one line in the log about *"loop or previous error loading module"* | TSTL only emits files transitively reachable from the entry point, so every ability must be imported for side-effect registration — **and import order matters**. Importing a variant from inside its base ability module creates a Lua `require` cycle that kills the entire addon load. Import variants *after* their bases, from the entry file. |
| Every ability tooltip in the game was blank | Addon localization must be **UTF-16 LE**, not UTF-8. A missing or unreadable loc key doesn't error — it renders the raw token. |
| Bots issued **39 cast orders per second and released zero arrows** for ten minutes of combat | Re-issuing a move/attack order during the cast windup cancels the cast. Hold orders for the duration of the windup. A whole AI subsystem was firing nothing because it kept interrupting itself. |
| The shop worked, players had gold, purchases did nothing | Buys silently no-op'd (wrong buyer resolution), *and* in a fountain-less arena you must call `GameRules.SetUseUniversalShopMode(true)` or every native-store purchase strands in the stash. |
| I rebuilt, relaunched, and got yesterday's game — repeatedly | The addon dirs are junctions into Steam. If that link is ever lost, `bun run build` writes into your repo while Dota reads the detached copy. Worse: Lua and localization are read **live**, but panorama and maps are served **compiled** — syncing panorama source does nothing until `resourcecompiler` runs. And custom Lua is cached at game load, so a "reload" isn't enough; fully quit the client. |
| The camera wouldn't move on the VM, and the loading screen never updated, no matter what I changed | Compiled Lua and panorama JS are (correctly) gitignored. So `git fetch && git reset --hard` on the remote machine syncs **source only** and runs stale build output. Always run *both* compilers after syncing, remotely. |

There are more — day/night cycle rendering matches near-black while fog-honest bots used night vision radii (nine bots, four minutes, zero kills, fixed with a permanent `SetTimeOfDay(0.5)` timer); `ffmpeg` eating stdin inside a `while read` loop and mangling every output directory name until `-nostdin`; stock engine particles that were renamed years ago and now fail to load in complete silence.

My favourite comedy arc is three commits long, and the joke is that one of them is deliberate. A scout ward was built to spawn *invisible* on purpose (`cca05dd`) — a ward you can't see is the whole point — one commit after a scout hawk had to be fixed into a "**visible** scout hawk" (`eb69475`) because that one's invisibility was an accident. Then a grapple hook that fired and hit but never pulled got fixed *twice* — once by rewriting the pull to run on an interval-think instead of a motion controller, and once more before it became a "real Pudge-style hook reel" (`0a393bb`). The pull existed only in the tooltip for two shipped versions.

And a spawn probe I added *to diagnose* the spawning problem crashed the addon at load, and had to be removed 63 minutes later (`3dad410` → `5c2ca61`). The instrument broke the experiment.

**The practice worth stealing:** every one of these lives as a comment at the site of the fix, dated, and the load-bearing ones are promoted into `CLAUDE.md` under a heading that reads *"Architecture invariants (violating these caused real crashes)"*. That file is the highest-leverage artifact in the repo. An agent that reads it does not re-step on the mine; an agent that doesn't will re-step on it within a day. I know, because three of those invariants exist specifically because it happened twice.

It's also worth documenting your **known-benign** warnings. TSTL emits truthiness warnings in a few files that are expected and correct. Writing that down stops an agent from "fixing" a non-bug at 3am.

---

## The VM that plays the game so I don't have to

Dota custom games cannot be tested in CI. The game needs a GPU, a display head, a logged-in Steam session, and a multi-gigabyte Workshop Tools install. GitHub's runners have none of those and never will.

So: a GPU VM on GCP — `n1-standard-8`, an NVIDIA T4, Windows Server 2022, 200 GB SSD — that plays my game against itself and grades the result.

The pipeline, end to end:

1. `vm.sh start` boots the instance and opens an IAP tunnel to `localhost:2222`. No public SSH.
2. Code syncs by minting a GitHub token **on my Mac** (`gh auth token`), injecting it one-shot into a `git fetch https://x-access-token:$TOKEN@…` with `-c credential.helper=` so it's never written to disk VM-side, and scrubbing it from the echo.
3. The VM runs **both** compilers, because of the landmine above.
4. `resourcecompiler.exe` cooks the addon content.
5. Dota launches with `-tools -condebug -conclearlog -windowed`, a convar that selects the run mode, and `+dota_launch_custom_game <addon> <map>`.
6. Bots play a full 10-player FFA to 20 kills while the VM screenshots itself every 20 seconds and records video.
7. The run's verdict is scraped out of `console.log` against a **marker contract**: `Script Error|attempt to|nil value|stack traceback` for failure, and `[E2E]`, `[QGATE]`, `[PROG]`, `[CS]` markers for positive proof.
8. Results, video and console log get `scp`'d back into `artifacts/<mode>/<timestamp>/`, and the VM **stops itself**. A T4 costs real money per hour; every verb in the control script ends in `instances stop`.

Two details that cost me the most time:

**SSH lands in Windows session 0, which has no display head.** Launch a GPU application there and no DX11 device initializes. The run has to be triggered as a pre-registered **scheduled task with an Interactive principal** so it executes in the console session. The script gets staged to `C:\aw\` over SSH and fired with `schtasks /run`.

**The VM injects real mouse clicks.** P/Invoke into `user32.dll` — `FindWindowW("SDL_app")`, `SetCursorPos`, `mouse_event` — to sweep-click UI panels. That's how a click-through bug in the HUD got diagnosed with no human in front of the screen.

On top of that sits a **quality gate**: before publishing, a staged sweep casts every ability and buys every item, then asserts *effects*, not cooldowns. Did damage actually drop? Was the victim displaced by at least 250 units, or did it gain the pull/stun modifier? Did the scout bird entity actually spawn? The shorthand in my notes is "qgate stays 94/0."

### The incident

And then the agent told me a gameplay video was delivered and verified.

It wasn't. The camera never moved for the entire match. Nine bots fought across the whole arena while the recording stared at an empty patch of map centre. The agent had confirmed the run succeeded — parsed the log, found the markers, counted the kills, saw no script errors — and reported success. Every claim it made about the *logs* was true. It had never looked at a single pixel.

The root cause took two attempts, and getting it wrong the first time is the more useful half of the story. Initial diagnosis: `PlayerResource.SetCameraTarget(0, unit)` looked **inert** for the tools recording host — it returns without complaint and appeared to do nothing — so the camera director moved into Panorama, with the server publishing the hottest fight cluster's centroid to a net table and a client script calling `GameUI.SetCameraPositionFromLateralLookAtPosition(x, y)`. That route *also* left the frames on empty field, in the July 11th showcase run, while the labels cycled cheerfully over nothing. What finally moved the camera was going back to server-side `SetCameraTarget`, locked onto the acting hero. Two plausible fixes, one of them wrong, and the only thing that could tell them apart was looking at the frames.

One piece of the first attempt survived and is worth keeping: frame the *centroid of a cluster*, not one hero's exact position, and re-aim slowly — otherwise the camera snaps onto a lone hero standing in an empty field, which is its own way of filming nothing.

But the fix isn't the lesson. The lesson is the rule that came out of it:

> **Logs are not evidence of anything you can see. Extract the frames and look at them.**

That is now a gate, not a habit. `scripts/extract-frames.sh` pulls one frame every three seconds across a whole recording, and a dense 15fps window over any specific moment that needs proof. For the visual specs, the *acceptance criterion* is frame review — a verdict is only written after somebody reads the pixels.

Two consequences I did not expect. First, coverage became provable: unioning the parsed markers from two real recordings gives 7/7 classes, 13/13 abilities and 20/20 items demonstrated on video, not asserted in a table. Second, one spec has a commit that reads *"slow demo arrows to 0.35× so projectile skins land frames"* — the arrows were flying too fast to be photographed. When your acceptance gate is a camera, you start designing for the camera.

---

## Mining your own transcripts for the true numbers

When I wrote the launch post I opened with "2,585 prompts." I'd been quoting that number for days. It felt right — it matched the sense of how much back-and-forth this took.

Before publishing I asked the agent to verify it. It's wrong.

Claude Code writes every session to JSONL under `~/.claude/projects/<slug>/`. One JSON object per line, `type` of `"user"` or `"assistant"`. The naive count is a trap, because "user" turns include every tool result the agent fed back to itself, plus meta entries, plus slash-command wrappers. Counting `grep -c '"type":"user"'` gives you a number that means nothing.

Here's the classifier that gives you the real one:

```bash
cat ~/.claude/projects/-Users-you-projects-yourrepo*/*.jsonl | python3 -c "
import sys, json
real=0; cmd=0; interrupt=0; toolres=0; meta=0
sessions=set()
for line in sys.stdin:
    try: j=json.loads(line)
    except: continue
    if j.get('type')!='user': continue
    sessions.add(j.get('sessionId'))
    if j.get('isMeta'): meta+=1; continue
    c=j.get('message',{}).get('content')
    if isinstance(c,list) and any(isinstance(b,dict) and b.get('type')=='tool_result' for b in c):
        toolres+=1; continue
    txt = c if isinstance(c,str) else ' '.join(b.get('text','') for b in c if isinstance(b,dict))
    if '<command-name>' in txt or '<local-command' in txt: cmd+=1; continue
    if '[Request interrupted' in txt: interrupt+=1; continue
    real+=1
print(f'real={real} cmd={cmd} interrupt={interrupt} toolres={toolres} meta={meta} sessions={len(sessions)}')"
```

And the agent's side of the ledger:

```bash
cat ~/.claude/projects/-Users-you-projects-yourrepo*/*.jsonl | python3 -c "
import sys, json
a=0; tools=0
for line in sys.stdin:
    try: j=json.loads(line)
    except: continue
    if j.get('type')=='assistant':
        a+=1
        c=j.get('message',{}).get('content')
        if isinstance(c,list):
            tools+=sum(1 for b in c if isinstance(b,dict) and b.get('type')=='tool_use')
print(f'assistant_msgs={a} tool_calls={tools}')"
```

For Archer Wars:

```
real=306  cmd=60  interrupt=0  toolres=2576  meta=70  sessions=33
assistant_msgs=5528  tool_calls=2576
```

Look at `toolres` and `tool_calls`. Identical: **2,576**. My "2,585 prompts" was, within rounding of a number I'd half-remembered, the count of **tool calls the agent made** — every build, every test run, every file edit, every VM launch. Not my prompts at all.

The real number is **306 prompts** across **33 sessions**. And once I saw both numbers next to each other, the true one was obviously the better story: 306 human instructions produced 2,576 machine actions. Roughly one prompt in, eight-and-a-half actions out.

Run the classifier on your own project. The ratio is the most honest description of what working this way actually feels like, and it costs you thirty seconds to get.

---

## An honest note on the numbers

I said "318 commits" in the launch thread. Counting properly afterwards: **274 commits on `main`**, **352 across all refs** (branches, worktrees, unmerged work). 318 was a number from a partial count, sitting between the two real ones. I'm leaving the correction here rather than quietly fixing the post, because a piece arguing "prove it, don't claim it" doesn't get to round its own stats.

Two more corrections in the same spirit:

- The repo's gross diff reads **+625,742 lines**, which is nonsense as a measure of work: a single generated Hammer map seed accounts for 571,739 of it. Excluding that one file — `git log main --numstat -- . ':(exclude)mapgen/seed/seed.vmap.txt'` — the real figure is **+48,586 / −4,170**, and that still includes docs, plans, KV files and tests.
- "About six hours of hands-on time" is my own estimate of time spent typing and reviewing, not an instrumented measurement. Wall-clock was about eight and a half active days across July 4–13. The gap between those two numbers is almost entirely the agent↔VM loop — push, wait for bots to play a full match, watch the recording, feed it back. That's the honest shape of it: the work was fast, the *verification* was slow, and the verification is what made the work trustworthy.

While we're being precise about the shape of the thing: the busiest day was July 5th with **121 commits**, 25 of them in the 04:00 hour alone — that's the bot engine. July 9th is the only heavy-deletion day in the whole history (−1,614), because I playtested the terrain I'd spent two days building and concluded a flat clearing plays better:

> `23c5b56` / `77d416e` — delete the moat, plateau, mounts and ramps.

Building the thing is cheap now. Deciding what to delete is still the job.

---

## What's in the playbook

The code above is a game about archers. The transferable part is everything around it, which is what I've pulled out into [**dota2-claude-playbook**](https://github.com/carloslibardo/dota2-claude-playbook):

- **`dota-ts-arena-template`** — the ~50-file boilerplate, half of which are the near-empty KV and manifest stubs the engine refuses to start without. TypeScript→Lua, Panorama, symlink installer, working CI that runs with no Dota installed, one example ability, one panel, one pure lib with its test, and a convar-gated e2e stub that emits `[E2E]` markers. `bun install && bun run build && bun run test` green on a Mac.
- **A templated `CLAUDE.md`** with the structure that made the difference — Commands / Where code lives / **Architecture invariants (violating these caused real crashes)** / Testing strategy / Conventions — with the Dota-generic invariants pre-filled.
- **The landmines chapter.** Everything in the failure museum above, in full, with the fix and the date it bit me.
- **The SDD loop**, with the three real spec→plan→evidence examples from this project, including the one whose acceptance criterion is *frame review*.
- **`dota-vm-testrig`** — the GPU VM scripts, parametrized: IAP-tunnelled SSH, the interactive-session scheduled task, the convar-gated headless mode, a pluggable `[MARKER]` log contract, screenshot/video capture, scp-back-and-stop.
- **Testing without the engine** — the purity rule and the dual-compilation trick that let a bot FSM be unit-tested on a machine that cannot run the game.
- **Publishing and its ceiling**, including the part where I had the ceiling in the wrong place. Every source I found — Valve's docs, community writeups, and the first draft of my own chapter — says the first publish must go through the Workshop Tools GUI, because only the GUI can create an item. That's wrong: a `.vdf` with `publishedfileid 0` handed to `steamcmd +workshop_build_item` creates the item headless, over SSH, from the same VM that runs the playtests. What's genuinely still manual is a Steam-Guard-approved cached login, accepting the Workshop Legal Agreement, and flipping the item from hidden to public. The `steamcmd` path stays community-validated rather than Valve-documented, so validate one run by hand before you trust it. Knowing where automation stops is worth as much as the parts that automate — and it's worth re-checking, because I'd inherited that claim instead of testing it.

The game itself is at [**github.com/carloslibardo/archer-wars**](https://github.com/carloslibardo/archer-wars) — the full-scale worked example, fixes and all. The Workshop item exists as of July 19th, sitting hidden while I confirm the legal agreement and give it one more pass. When I flip it public, you're invited. 20 kills to win.

If one thing survives from this piece, make it the two-column table. Every surprise you hit is a failure on the left and a rule on the right, and the rule is only worth anything if you write it down where the agent will read it next time.

---

*Commit links: `github.com/carloslibardo/archer-wars/commit/<sha>`. Short hashes are used throughout; GitHub resolves them.*
