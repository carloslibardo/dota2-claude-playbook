---
name: vm-testrig
description: Use when setting up or running the headless playtest — a GPU VM that plays the game, screenshots it, greps the log against the marker contract and shuts itself off. Also the skill for writing the e2e harness that rig drives
---

# The VM test rig

Dota needs a GPU, a display head, a Steam session and a multi-gigabyte Workshop
Tools install. GitHub-hosted runners have none of those and never will. So the
engine-level test is a remote scheduled playtest instead of CI. Full build
(GCP `vm.sh`, `windows-startup.ps1`, `vm-run.ps1`, `extract-frames.sh`) is the
playbook's chapter 6 and the `testrig/` directory of the repo this template came
from — copy it in rather than reinventing it.

## The harness side (lives in this repo)

`src/vscripts/systems/e2eHarness.ts` is the hook. Two rules govern it:

- **Inert in a real match, structurally.** `IsInToolsMode()` AND a convar check,
  both, at the entry point. The harness must never be able to touch a game a
  human is playing.
- **Bounded.** A kill-threshold override and a wall-clock cap, so a run cannot
  idle for an hour on a billed VM.

Seating bots is where this bites (L4, L5, L6):

- **Never `dota_bot_populate`** — it hard-crashes the tools client in a laneless
  map. The process dies, no traceback.
- Tools mode: `dota_create_fake_clients` (cheat-gated; silently ignored on
  retail). Real matches: `GameRules.AddBotPlayerWithEntityScript`.
- Seat at **`CUSTOM_GAME_SETUP`**, before hero selection closes. Later, and
  `CreateHeroForPlayer` rejects them ("bogus player id") — they spend the match
  heroless.
- Resolve their heroes with `heroForPlayer()`, never `GetSelectedHeroEntity`.
- **Fake clients join TEAMLESS.** A 10-teams-of-one FFA auto-assigns them and
  hides this; anything with two teams leaves them unassigned, so hero selection
  never touches them and they sit out the whole match. Sweep
  `SetCustomTeamAssignment` explicitly in the setup window, and keep a
  `CreateHeroForPlayer` fallback at engage.
- **Fake clients cannot work a toggle ability through the order pipeline.** A
  `CAST_TOGGLE` order is clobbered by the same think's `Queue:false` move/cast
  order, and `ToggleAbility()` is a silent no-op on an `ability_lua` toggle from
  server script. Drive the modifier directly — call the same `apply()` that
  `OnToggle` calls. The toggle *switch* stays a human-playtest item.

Print the markers your contract promised (`/evidence-gate`), with timestamps.

## Standing the rig up

1. **VM**: GPU instance (a T4 is enough), Windows, ~200 GB SSD,
   `--maintenance-policy=TERMINATE` (required for GPUs). Install Dota **plus
   Workshop Tools** once; the disk bills while stopped and that is the point.
2. **Access**: IAP tunnel or equivalent to `localhost:2222`, SSH with a key.
   Nothing listens on the public internet.
3. **The scheduled task — the non-obvious one.** SSH lands in Windows session 0,
   which has no display head, so a datacenter GPU will not initialize a DX11
   device and Dota simply dies (L11). Register a scheduled task with an
   **Interactive** principal once, by hand over RDP; SSH then only triggers it,
   and it runs in session 1 where there is a head.
4. **Sync source AND rebuild on the VM.** Compiled Lua and panorama JS are
   gitignored — syncing the repo alone leaves the VM running the last build it
   made itself (L10). Run both `tstl` and the panorama `tsc` there, then
   `resourcecompiler`.
5. **Credentials never persist VM-side.** Mint the token on your machine, pass
   it over stdin into git's environment config for that one command, scrub
   stdout and stderr.

## Running one

`resourcecompiler` → launch `dota2.exe -tools -condebug +<addon>_e2e 1` →
observe (screenshot every ~20 s, MP4 if ffmpeg is present, click injection for
panorama) → grep `console.log` for required markers and forbidden patterns →
write a result file → retrieve result + log + screenshots + MP4 → **stop the
VM**.

- **The verdict is the marker contract, not an exit code.** Dota does not exit
  non-zero when your game mode is broken. It usually does not exit at all.
- **Every verb that starts the VM ends by stopping it**, including on failure.
  The expensive mistake is not one run; it is a VM left on over a weekend.
- **Retrieve evidence before shutting down, especially on failure** — that run
  is the only record of why.
- **Census pulled `console.log`s with `grep -a`.** Dota's log carries stray
  control bytes; macOS BSD grep calls it binary and returns zero matches with
  exit 1 and no warning, so a green run reads as all-zeros. Never write a
  bare `grep` against a pulled log.

## Modes are one convar plus one contract

smoke (it loads, bots play, someone wins) · match (recorded, watchable) ·
skills (every ability cast in isolation, PASS/FAIL each) · quality gate (every
ability *and* item produces an observable effect — the pre-publish gate worth
stealing) · showcase · play (leave it up for RDP).

~25 minutes and real money per run: this is a per-feature and pre-release gate,
never a per-commit one.
