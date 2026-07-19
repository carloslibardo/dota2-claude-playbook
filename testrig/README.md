# The VM test rig

A Dota 2 custom game cannot be tested in ordinary CI. The game needs a GPU, a
display head, a logged-in Steam session, and a multi-gigabyte Workshop Tools
install. GitHub-hosted runners have none of those, and never will.

So instead of pretending, this rig builds the thing CI cannot be: a **remote,
scheduled, self-scanning playtest**. One command on your laptop starts a
Windows GPU VM, syncs your branch, rebuilds, plays a whole match with bots,
captures screenshots and a video, greps the console log against a marker
contract, ships the evidence back, and turns the VM off.

You go and do something else. Twenty minutes later there is a directory on your
disk containing a PASS or a FAIL and everything needed to argue with it.

## Anatomy

| Piece | File | Role |
|---|---|---|
| **VM definition** | `vm.sh create` | GCP `n1-standard-8` + one `nvidia-tesla-t4`, `windows-2022`, 200 GB SSD, `--maintenance-policy=TERMINATE` (required for GPU instances). |
| **Provisioning** | `windows-startup.ps1` | Chocolatey → git + node. Creates a `builder` admin user, installs OpenSSH Server, injects your public key, makes PowerShell the default SSH shell. |
| **Control plane** | `vm.sh` | `create · start · stop · ip · tunnel · ssh · run`. Everything parametrized by env var (`PROJECT`, `ZONE`, `INSTANCE`, `ADDON`, `REF`, `RUN_MODE`). |
| **Access** | IAP tunnel → `localhost:2222` → `ssh builder@localhost` | Nothing listens on the public internet. No firewall rule for your home IP to keep updating. |
| **Code sync** | inside `vm.sh run` | Token minted **on your laptop** with `gh auth token`, injected one-shot into the fetch URL with `-c credential.helper=` so it is never persisted VM-side, and scrubbed from the echoed output. Then `git reset --hard FETCH_HEAD`. |
| **Rebuild on VM** | inside `vm.sh run` | Runs **both** `tstl` and `tsc --project src/panorama` on the VM. Compiled Lua and panorama JS are gitignored, so syncing source alone leaves the VM running last week's code. |
| **Execution** | `schtasks /run /tn dota_run` | The crux. See below. |
| **The run** | `vm-run.ps1` | `resourcecompiler` → launch `dota2.exe -tools -condebug +<convar> 1` → observe → scan → write a result file. |
| **Observation** | inside `vm-run.ps1` | Full-screen PNG every 20 s via `System.Drawing.CopyFromScreen`. Optional MP4. Real mouse-click injection through `user32.dll` P/Invoke against the `SDL_app` window. |
| **Verdict** | inside `vm-run.ps1` | Greps `console.log` for required positive markers and forbidden error patterns, writes `C:\dota-<mode>-result.txt`. |
| **Retrieval** | `vm.sh run` | Polls the result file for a terminal token, `scp`s result + video + `console.log` + screenshots into `artifacts/<mode>/<UTC timestamp>/`, prints a summary, **stops the VM**. |
| **Frame evidence** | `extract-frames.sh` | ffmpeg, 1 frame per 3 s across the whole run, or 15 fps over one narrow window. |

## The two non-obvious parts

**1. The run must happen in the interactive console session.**

SSH on Windows lands you in session 0, which has no display head. A datacenter
GPU there will not initialize a DX11 device, so Dota simply dies. Launching the
game directly over SSH cannot work, no matter how you shape the command.

The workaround is a **scheduled task with an Interactive principal**, registered
once on the VM. SSH triggers the task; the task runs in session 1, which has a
display head; the GPU comes up. Register it once, by hand, over RDP:

```powershell
$action    = New-ScheduledTaskAction -Execute "powershell.exe" `
             -Argument "-ExecutionPolicy Bypass -File C:\dota\vm-run.ps1"
$principal = New-ScheduledTaskPrincipal -UserId "builder" -LogonType Interactive -RunLevel Highest
Register-ScheduledTask -TaskName "dota_run" -Action $action -Principal $principal
```

`vm.sh run` then only has to `Copy-Item` the current `vm-run.ps1` into
`C:\dota\` and call `schtasks /run /tn dota_run`. The task registration itself
never needs to change again.

**2. The verdict is a marker contract, not an exit code.**

Dota does not exit non-zero when your game mode is broken. It usually does not
exit at all. So the game itself prints agreed strings, and `vm-run.ps1` greps
for them:

```powershell
-RequireMarkers @("\[E2E\] WIN", "\[SHOP\] purchase ok")
-FailPatterns   @("Script Error", "attempt to", "nil value", "stack traceback")
```

Both halves matter. Failure patterns alone prove only that nothing crashed —
which is also true of a game that never started. Required markers are what
prove the thing you cared about actually happened.

Write the contract down before you write the feature. In Archer Wars each spec
carries a `contracts/log-markers.md` naming the exact strings the verifier will
grep, so implementation and verification are agreeing on paper rather than by
accident.

## Costs, honestly

An `n1-standard-8` with a T4 is real money per hour — call it roughly a dollar,
and check current pricing rather than trusting that number. It adds up fast if
you forget the VM is on.

Two habits keep it survivable:

- **Every verb that starts the VM ends by stopping it.** `vm.sh run` stops the
  instance even when the run fails. Do not remove that.
- **Bound every run.** `-Kills 5` and `-RunSeconds 360` exist precisely so a
  run cannot idle for an hour. A smoke test that proves the win path works in
  six minutes is worth more than a full-length match that costs ten times as
  much to learn the same thing.

Also: the boot disk persists while the instance is stopped, and you pay for it.
200 GB of SSD is not free. That is the price of not reinstalling Dota and the
Workshop Tools — several tens of gigabytes — on every run.

## Setup, start to finish

```bash
# 1. Create the VM (once)
PROJECT=my-gcp-project ./vm.sh create

# 2. RDP in and do the manual half (once):
#    - install Steam, log in, satisfy Steam Guard
#    - install Dota 2 AND the Dota 2 Workshop Tools (beta branch)
#    - clone your repo to C:\dota\repo and run `bun install`
#    - register the scheduled task (see above)

# 3. From then on, every run is one command:
PROJECT=my-gcp-project ADDON=hello_arena REF=my-branch ./vm.sh run
```

The manual half is genuinely manual — Steam Guard is not scriptable, and that
is the point of doing it exactly once on a machine that persists.

## Generalizing

Nothing here is really specific to Dota. The reusable primitive is: **GPU VM +
tunnelled SSH + an interactive-session scheduled task + a convar-gated headless
mode + a `[MARKER]` log contract + screenshot capture + fetch-back-and-stop.**
Any application that needs a real display to prove it works can use the same
shape.
