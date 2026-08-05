# 6. The autonomous VM rig

The problem in one sentence: an agent can write a Dota custom game but cannot
play it, and the only honest way to know whether a change works is to play it.

This chapter is the machinery that closes that loop without a human in the
chair. Working code is in [`testrig/`](../testrig/).

## What it does

One command on your laptop:

```bash
PROJECT=my-gcp-project ADDON=hello_arena REF=my-branch ./vm.sh run
```

Then:

1. Starts a Windows GPU VM if it is stopped.
2. Opens an IAP tunnel and waits for SSH.
3. Fetches your branch onto the VM.
4. Rebuilds Lua **and** Panorama there.
5. Triggers a scheduled task that runs the game in the interactive session.
6. The game cooks resources, launches with the e2e convar, plays a full match
   with bots, screenshots every twenty seconds, and records video.
7. Greps `console.log` against a marker contract and writes a verdict file.
8. Polls for the terminal marker, `scp`s back result + video + log +
   screenshots into `artifacts/<mode>/<timestamp>/`.
9. Prints a summary.
10. **Stops the VM.**

You get a PASS or a FAIL and the evidence to argue with it. About twenty-five
minutes end to end — three for a cold boot, ten to sync and compile, thirteen
for the match itself — and roughly a dollar.

## Why a VM at all

Four things Dota needs that a CI runner does not have:

- **A GPU.** Not optional; the client will not start without a rendering
  device.
- **A display head.** A GPU alone is not enough — see L11 below.
- **A logged-in Steam session.** With Steam Guard satisfied. Not scriptable,
  by design.
- **The Workshop Tools.** Several tens of gigabytes, a separate download on the
  Dota beta branch.

The first two are why it is a GPU VM rather than a container. The last two are
why it is a **persistent** VM you stop and start rather than one you create per
run: you do the manual half exactly once, on a disk that survives.

## The pieces

| Piece | Where | Role |
|---|---|---|
| VM definition | `vm.sh create` | `n1-standard-8` + one `nvidia-tesla-t4`, `windows-2022`, 200 GB SSD, `--maintenance-policy=TERMINATE` |
| Provisioning | `windows-startup.ps1` | Chocolatey → git + node; `builder` admin user; OpenSSH Server; your public key; PowerShell as the SSH shell |
| Control plane | `vm.sh` | `create · start · stop · ip · tunnel · ssh · run` |
| Access | IAP tunnel → `localhost:2222` | No public SSH |
| The run | `vm-run.ps1` | cook → launch → observe → scan → verdict |
| Frames | `extract-frames.sh` | ffmpeg, sweep or dense window |

`--maintenance-policy=TERMINATE` is required for GPU instances: GCP cannot live
migrate a machine with an attached accelerator.

## The six things that are not obvious

### 1. SSH cannot launch the game

An SSH login on Windows lands in **session 0**, which has no display head. A
datacenter GPU there will not initialize a DX11 device, so Dota dies at startup
regardless of how you shape the command. This is landmine L11 and it is the
single most likely thing to stop you cold.

The workaround: register a **scheduled task with an Interactive principal**,
once, by hand over RDP:

```powershell
$action    = New-ScheduledTaskAction -Execute "powershell.exe" `
             -Argument "-ExecutionPolicy Bypass -File C:\dota\vm-run.ps1"
$principal = New-ScheduledTaskPrincipal -UserId "builder" -LogonType Interactive -RunLevel Highest
Register-ScheduledTask -TaskName "dota_run" -Action $action -Principal $principal
```

SSH then only triggers it: `schtasks /run /tn dota_run`. The task executes in
session 1, which has a display head, and the GPU comes up.

Because the task points at a fixed path, `vm.sh run` copies the current
`vm-run.ps1` to `C:\dota\` before triggering. The registration itself never
changes again.

### 2. Syncing source is not syncing code

Compiled Lua and Panorama JS are gitignored, correctly — they are build
outputs. So `git fetch && git reset --hard` on the VM syncs **source only**, and
the run executes whatever the VM compiled last time.

This was a multi-day bug in Archer Wars, and it presents as a fix that "didn't
take": the camera still will not move, the loading screen still shows the old
art. Both compilers run on the VM after every sync:

```bash
tstl --project src/vscripts/tsconfig.json
tsc  --project src/panorama/tsconfig.json
```

Two separate invocations, deliberately: `run-p` (npm-run-all), which your
`bun run build` uses on a laptop, does not work on this Windows VM. It resolves
its child scripts through a shell that is not the one PowerShell hands it, and
you get a build that reports success having compiled nothing — the same silent
class as the stale-artifacts bug it is supposed to prevent. On the VM, call the
two scripts one at a time (`bun run build:vscripts`, then
`bun run build:panorama`) and check each exit code.

Forgetting the second is the common version, because Lua feels like "the code"
and Panorama feels like assets. It is landmine L10.

### 3. The credential dance

The VM has no `gh`, and Windows' Git Credential Manager cannot prompt over a
non-tty SSH session. So the token is minted **on your laptop**, injected
one-shot into the fetch URL, and never stored:

```bash
TOKEN="$(gh auth token)"
vm_ssh "cd $RVM; git -c credential.helper= fetch \
        \"https://x-access-token:${TOKEN}@github.com/you/repo.git\" $REF; \
        git reset --hard FETCH_HEAD" | grep -v x-access-token
unset TOKEN
```

Three defenses in one line: `-c credential.helper=` stops git from persisting it
VM-side, `grep -v` scrubs it from anything echoed back, and `unset` drops it
locally. The token lives in the VM's process memory for the duration of one
fetch and nowhere else.

### 4. The verdict is a marker contract

Dota does not exit non-zero when your game mode is broken. It usually does not
exit at all. So the game prints agreed strings and the runner greps for them:

```powershell
-RequireMarkers @("\[E2E\] WIN")
-FailPatterns   @("Script Error", "attempt to", "nil value", "stack traceback")
```

**Both halves are necessary.** Error patterns alone prove nothing crashed —
which is also true of a game that never started. Required markers are what prove
the thing you cared about actually happened. A run with zero errors and no
`[E2E] WIN` marker is a failure, and it is exactly the failure a naive
"scan for errors" check reports as green.

Write the contract before the feature. When a spec's `contracts/` directory
names the strings up front, the implementation and the verifier are agreeing on
paper instead of by luck.

### 5. Getting onto the box is its own failure surface

Three things about `gcloud` that will each cost you a run before you learn them.

**The tunnel and the SSH probe are one unit, and must be retried as one.**
`gcloud compute start-iap-tunnel` runs its own preflight against the instance,
and against a Windows VM that has booted but not yet started `sshd` that
preflight dies — so the tunnel process exits and every subsequent SSH attempt
fails against a port nothing is listening on. Retrying only the SSH loop cannot
recover from that. Worse, a *leftover* tunnel from an earlier session keeps
`localhost:2222` answering, which masks the failure until the next clean run.
Kill any old tunnel, then retry `(start tunnel → probe ssh)` together as a pair,
several times.

**GPU capacity is not guaranteed.** `ZONE_RESOURCE_POOL_EXHAUSTED` on a T4 in
`us-central1-a` is routine, not exotic — the start simply fails and the whole
run with it. Either retry the start on a loop, or fall back to a sibling zone
(`-b`, `-f`). Decide which before it happens at 2 a.m.

**`gcloud` auth expires mid-cycle, and reauth is interactive-only.** Halfway
through a run you get:

```
Reauthentication failed. cannot prompt during non-interactive execution
```

There is nothing to retry. `gcloud auth login` opens a browser and requires a
human; no flag makes it headless. An agent that hits this must report the error
string **verbatim** and hand the `gcloud auth login` step back to the person —
that is [chapter 10](10-working-with-claude.md)'s "hand back the un-automatable
part with instructions" rule applied to infrastructure. Guessing at it, or
silently retrying until the poll times out, converts a thirty-second human
action into a wasted run and a misleading FAIL.

### 6. The launch line eats two tokens

`+dota_launch_custom_game` consumes the **next two** arguments — the addon,
then the map:

```powershell
"+dota_launch_custom_game", $Addon, $Map     # the triple. Nothing goes inside it.
```

Splice a convar in between and the convar's name becomes the addon name. The
client starts, loads nothing, prints no complaint, and the run fails on a
missing `[E2E] WIN` marker twenty minutes later with a console log that gives
no hint why. Put every `+convar value` pair *before* the triple, and treat the
triple as atomic.

## Observation

**Screenshots.** A full-screen PNG every twenty seconds, via
`System.Drawing.CopyFromScreen`. This needs the interactive session too — the
same reason the whole script does.

Screenshots catch what logs cannot: a particle that renders nothing, a panel
covering the world, an arena that is black because the day/night cycle ran (L15).

**Video.** An MP4 of the run, so [chapter 5](05-testing-without-engine.md)'s
frame-review tier has something to extract from.

**Mouse input.** This is the surprising one. `vm-run.ps1` P/Invokes `user32.dll`
to find the Dota window (class `SDL_app`), bring it forward, move the real
cursor, and click:

```powershell
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] public static extern void mouse_event(uint f, ...);
[DllImport("user32.dll")] public static extern IntPtr FindWindowW(string cls, string title);
```

It sweeps clicks across where a panel should be. The console log then
discriminates between three cases that look identical from outside:

- the panel logged a click → the panel got the hit
- the game logged a world-order at those coordinates → the click fell *through*
  the panel
- neither → input never reached the window at all

That is how a Panorama click-through bug got diagnosed with nobody present. It
is not a general-purpose UI test framework and does not need to be; it needs to
distinguish three hypotheses.

## Evidence survives failure

One structural detail in `vm-run.ps1` worth copying: the terminal marker and all
evidence are written **before** the hard failure.

```powershell
"RUN RESULT: FAIL ($($failures.Count) failure(s))" | Add-Content $result
"RUN DONE" | Add-Content $result
if ($failures) { throw ($failures -join "; ") }
```

Two reasons. The control plane polls for `RUN DONE`, so a run that dies without
writing it hangs the poller for its full timeout. And a failing run is precisely
when you want the log, the screenshots, and the video most — a rig that only
produces evidence on success is a rig that produces evidence you did not need.

## Retrieval is not free

Producing the evidence and *having* the evidence are two different problems, and
the second one is where a green run turns into a phantom failure. Three rules,
all learned the expensive way.

**The tunnel kills a single `scp` stream at about 59 MB.** Not a flaky link — a
ceiling. A large artifact (a match recording is easily 190 MB) transfers happily
and then dies with `ConnectionReconnectTimeout`, and retrying the whole file
dies at the same offset every time. The fix is to never ask for that much in one
stream:

1. On the VM, split the file into parts of 40 MB or less. Stage this as a real
   `.ps1` **file** and run it — inline PowerShell over SSH mangles `$` variables
   through two layers of quoting, and you will spend longer debugging the
   one-liner than writing the script.
2. `scp` each part on its own, verifying that part's byte size and retrying just
   that part on mismatch.
3. Reassemble locally, then verify the total.

**Verify the size of every pull, because `scp` truncates behind a masked exit
code.** A 61 MB recording arrived as 16 MB with exit status 0. Nothing anywhere
said so; the video simply ended in the middle of the match, which reads exactly
like a crash you then go hunting for. This is the same rule as §4, applied one
leg further out: *the verdict is a marker contract, not an exit code* — and a
retrieved artifact is not retrieved because the transfer command returned zero.
Compare bytes. Accept local ≥ remote: the remote size is sampled while the
writer may still be flushing, so a locally-larger file is normal and a
locally-smaller one is a truncation.

**Scan pulled logs with `grep -a`.** Dota's `console.log` carries stray control
bytes. macOS BSD `grep` decides it is binary, reports zero matches and exits 1,
and says nothing about why — with `-c` there is not even a "binary file matches"
line to notice. A perfectly green run then censuses as all zeros and you go
debugging a game that was working. Every marker census on a pulled log uses
`grep -a`. Make it the only form that appears in your scripts, so nobody has to
remember.

## Modes

The same shape covers more than a smoke test. Archer Wars ran six variants off
one convar family:

| Mode | What it proves |
|---|---|
| smoke | The game loads, bots play, someone wins |
| match | A real engine-driven bot match, recorded, watchable |
| skills | Every ability of every class cast in isolation, PASS/FAIL each |
| quality gate | Every ability *and* every item produce an observable effect |
| showcase | Labelled per-class demo with a camera on the caster |
| play | Sync and build, then leave the VM up for hands-on RDP testing |

Each is a convar plus a different marker contract. The quality gate is the one
worth stealing: "before publishing, prove every ability and every item actually
does something" turned into an executable, video-recorded gate whose pass
criterion the team could say out loud — 94 checks, 0 failures.

## Costs, honestly

An `n1-standard-8` with a T4 is roughly a dollar an hour. Check current pricing;
do not trust that number. The 200 GB SSD bills while the instance is *stopped*
too — that is the price of not reinstalling Dota and the Workshop Tools on
every run, and it is worth paying.

Two habits keep it survivable:

**Every verb that starts the VM ends by stopping it.** `vm.sh run` stops the
instance even when the run fails. Do not remove that, and do not add a verb
that leaves it up without saying so in its name.

**Bound every run.** `-Kills 5` and `-RunSeconds 360` exist so a run cannot idle
for an hour. A bounded run that proves the win path in six minutes is worth more
than a full-length match that costs ten times as much to learn the same thing.

The failure mode is not one expensive run. It is forgetting a VM is on over a
weekend.

## Generalizing

Nothing here is deeply Dota-specific. The reusable primitive:

> GPU VM + tunnelled SSH + an interactive-session scheduled task + a
> convar-gated headless mode + a `[MARKER]` log contract + screenshot capture +
> fetch-back-and-stop.

Any application that needs a real display to prove it works — a game, a
renderer, a desktop app, anything CI cannot host — can use the same shape. The
game-specific parts are the convar name, the marker strings, and the
assertions. Everything else is plumbing you can copy.
