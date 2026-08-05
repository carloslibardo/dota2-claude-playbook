#!/usr/bin/env bash
# Control plane for a Windows GPU VM that plays your custom game for you.
#
# Everything is parametrized by environment variable, so this file should not
# need editing:
#
#   PROJECT   GCP project id                       (default: set it, no sensible default)
#   ZONE      GCP zone                             (default: us-central1-a)
#   INSTANCE  VM name                              (default: dota-dev)
#   ADDON     addon name = your package.json name  (default: hello_arena)
#   REPO      git remote to fetch on the VM        (default: derived from `git remote get-url origin`)
#   REF       git ref to test                      (default: main)
#   VM_KEY    ssh private key                      (default: ~/.ssh/dota_vm_key)
#   RVM       checkout path on the VM              (default: C:\dota\repo)
#   RUN_MODE  name of the run; names the result    (default: smoke)
#             file, the MP4, and the artifact dir
#
# ADDON and RUN_MODE reach the VM as a staged run-config.ps1 that vm-run.ps1
# dot-sources — `schtasks /run` executes the task with its REGISTERED
# arguments, so there is no way to pass fresh ones per run. The e2e convar is
# derived VM-side as "<addon>_e2e".
#
# Usage:
#   PROJECT=my-project ./vm.sh create     # one-time: make the VM
#   ./vm.sh start | stop | ip | tunnel | ssh [cmd...]
#   ./vm.sh run                           # the whole loop, end to end
#
# `run` is the interesting one:
#   start VM if stopped -> IAP tunnel -> wait for ssh -> fetch the ref ->
#   rebuild Lua AND panorama on the VM -> stage the runner script ->
#   trigger the scheduled task -> poll for the terminal marker ->
#   scp back result + video + console.log -> print a summary -> STOP THE VM.
#
# That last step is not politeness, it is money. See README.md.
#
# Every gcloud call here can fail with "Reauthentication failed. cannot prompt
# during non-interactive execution" when the credentials expire mid-cycle.
# There is nothing to retry: `gcloud auth login` is interactive-only. Report
# that string verbatim and hand the login back to a human.
set -euo pipefail

PROJECT="${PROJECT:?set PROJECT to your GCP project id}"
ZONE="${ZONE:-us-central1-a}"
INSTANCE="${INSTANCE:-dota-dev}"
ADDON="${ADDON:-hello_arena}"
REF="${REF:-main}"
VM_KEY="${VM_KEY:-$HOME/.ssh/dota_vm_key}"
RVM="${RVM:-C:\\dota\\repo}"
RUN_MODE="${RUN_MODE:-smoke}"
TASK_NAME="${TASK_NAME:-dota_run}"
# How long to wait for the run, in 30s polls. 40 = 20 minutes.
POLL_TICKS="${POLL_TICKS:-40}"

REPO="${REPO:-$(git remote get-url origin 2>/dev/null || true)}"

SSH_OPTS=(-i "$VM_KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p 2222)
RESULT_FILE="C:\\dota-${RUN_MODE}-result.txt"
VIDEO_FILE="C:\\dota-${RUN_MODE}.mp4"

vm_ssh() { ssh "${SSH_OPTS[@]}" builder@localhost "$@"; }

vm_scp() {
  # $1 = remote path, $2 = local dir. Missing files are not an error: a failed
  # run should still hand back whatever evidence it did manage to produce.
  #
  # TWO transport landmines live here, both silent:
  #  1. The IAP tunnel kills any single scp stream at ~59 MB
  #     (ConnectionReconnectTimeout), and retrying the whole file dies at the
  #     same offset. Anything bigger — a full match recording runs ~190 MB —
  #     must be split VM-side into <=40 MB parts (from a STAGED .ps1 file;
  #     inline PowerShell over ssh mangles $ vars), pulled part by part with
  #     per-part size verification, and reassembled locally.
  #  2. scp can TRUNCATE behind a masked exit code: a 61 MB mp4 arrived as
  #     16 MB with exit 0. Size-verify every pull — compare local bytes to
  #     remote, accepting local >= remote (the remote size is sampled while
  #     the writer may still be flushing). "The command returned zero" is not
  #     evidence the artifact arrived, same as it is not evidence the run passed.
  scp -P 2222 -i "$VM_KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    "builder@localhost:$1" "$2" 2>/dev/null || echo "  (not retrieved: $1)"
}

case "${1:-}" in
  create)
    # A T4 is the cheapest GCP GPU that gives Dota a real DX11 device.
    # TERMINATE on maintenance is required for any GPU instance.
    gcloud compute instances create "$INSTANCE" --project="$PROJECT" --zone="$ZONE" \
      --machine-type=n1-standard-8 --accelerator=type=nvidia-tesla-t4,count=1 \
      --image-family=windows-2022 --image-project=windows-cloud \
      --boot-disk-size=200GB --boot-disk-type=pd-ssd \
      --maintenance-policy=TERMINATE \
      --metadata-from-file=windows-startup-script-ps1="$(dirname "$0")/windows-startup.ps1"
    echo
    echo "VM created. Still to do by hand, once:"
    echo "  1. RDP in and install Steam, Dota 2, and the Dota 2 Workshop Tools."
    echo "  2. Clone your repo to $RVM and run 'bun install' there."
    echo "  3. Register the scheduled task (see README.md — it MUST use an"
    echo "     Interactive principal or the GPU never initializes)."
    ;;

  start) gcloud compute instances start "$INSTANCE" --project="$PROJECT" --zone="$ZONE" ;;
  stop)  gcloud compute instances stop  "$INSTANCE" --project="$PROJECT" --zone="$ZONE" ;;
  ip)    gcloud compute instances describe "$INSTANCE" --project="$PROJECT" --zone="$ZONE" \
           --format='get(networkInterfaces[0].accessConfigs[0].natIP)' ;;

  tunnel)
    # IAP tunnel instead of a public IP: nothing listens on the open internet.
    # If this exits immediately, the VM is probably still booting — gcloud's
    # preflight fails before sshd is up. Retry tunnel+ssh together (see `run`).
    exec gcloud compute start-iap-tunnel "$INSTANCE" 22 \
      --local-host-port=localhost:2222 --project="$PROJECT" --zone="$ZONE"
    ;;

  ssh) shift; vm_ssh "$@" ;;

  run)
    STATUS="$(gcloud compute instances describe "$INSTANCE" --project="$PROJECT" --zone="$ZONE" --format='get(status)')"
    if [ "$STATUS" != "RUNNING" ]; then
      # GPU capacity is NOT guaranteed: a T4 start can fail outright with
      # ZONE_RESOURCE_POOL_EXHAUSTED. Routine, not exotic. Wrap this in a retry
      # loop, or fall back to a sibling zone (us-central1-b / -f), before it
      # eats a run.
      echo "starting $INSTANCE..."
      gcloud compute instances start "$INSTANCE" --project="$PROJECT" --zone="$ZONE"
    fi

    # The tunnel and the ssh probe below are ONE unit and must be retried as
    # one. start-iap-tunnel runs its own preflight; against a Windows VM that
    # has booted but not yet started sshd, that preflight dies and the tunnel
    # process exits — after which retrying only the ssh loop can never succeed.
    # A LEFTOVER tunnel from an earlier session keeps localhost:2222 answering
    # and masks this until the next clean run, so kill stale tunnels first.
    gcloud compute start-iap-tunnel "$INSTANCE" 22 \
      --local-host-port=localhost:2222 --project="$PROJECT" --zone="$ZONE" &
    TUNNEL_PID=$!
    trap 'kill "$TUNNEL_PID" 2>/dev/null || true' EXIT

    echo "waiting for ssh..."
    SSH_OK=0
    for _ in $(seq 1 90); do
      if vm_ssh "echo ready" >/dev/null 2>&1; then SSH_OK=1; break; fi
      sleep 2
    done
    if [ "$SSH_OK" != 1 ]; then
      echo "ssh never became ready after 180s; stopping $INSTANCE" >&2
      gcloud compute instances stop "$INSTANCE" --project="$PROJECT" --zone="$ZONE" || true
      exit 1
    fi

    # Sync. The VM has no `gh` and its credential manager cannot prompt over a
    # non-tty ssh session, so a short-lived token is minted HERE. It travels
    # over stdin into git's environment-variable config (GIT_CONFIG_*) on the
    # VM: it never appears in any process command line (argv is visible in the
    # process table and in 4688/script-block logs), is never written to disk
    # VM-side, and dies with the ssh session. stdout AND stderr both pass
    # through the scrub — git's own failure messages are the classic leak path
    # (`fatal: unable to access 'https://x-access-token:...@github.com/...'`).
    echo "syncing $INSTANCE to $REF..."
    if command -v gh >/dev/null 2>&1 && [ -n "$REPO" ]; then
      HTTPS_REPO="$(echo "$REPO" | sed -E "s#^(https://)?(git@)?github.com[:/]#https://github.com/#")"
      B64="$(printf 'x-access-token:%s' "$(gh auth token)" | base64 | tr -d '\n')"
      printf '%s\n' "$B64" | vm_ssh "\$b64 = [Console]::In.ReadLine(); \$env:GIT_CONFIG_COUNT = '1'; \$env:GIT_CONFIG_KEY_0 = 'http.https://github.com/.extraheader'; \$env:GIT_CONFIG_VALUE_0 = 'Authorization: Basic ' + \$b64; cd $RVM; git -c credential.helper= fetch $HTTPS_REPO $REF 2>&1; git reset --hard FETCH_HEAD 2>&1" \
        | { grep -v -i -e 'x-access-token' -e 'authorization:' || true; }
      unset B64 HTTPS_REPO
    else
      vm_ssh "cd $RVM; git fetch origin $REF 2>&1; git reset --hard FETCH_HEAD 2>&1"
    fi

    # Compiled Lua and panorama JS are gitignored build artifacts, so the fetch
    # above syncs SOURCE ONLY. Skip this and the VM cheerfully runs whatever it
    # compiled last week, and you debug a bug you already fixed.
    echo "rebuilding on VM (tstl + tsc)..."
    vm_ssh "cd $RVM; & node_modules\\.bin\\tstl.exe --project src\\vscripts\\tsconfig.json | Select-Object -Last 3; echo (\"TSTL_EXIT=\" + \$LASTEXITCODE)"
    vm_ssh "cd $RVM; & node_modules\\.bin\\tsc.exe --project src\\panorama\\tsconfig.json; echo (\"TSC_EXIT=\" + \$LASTEXITCODE)"

    # The scheduled task points at a fixed path outside the checkout, so
    # refresh that copy from the repo we just synced.
    echo "staging vm-run.ps1..."
    vm_ssh "Copy-Item $RVM\\testrig\\vm-run.ps1 C:\\dota\\vm-run.ps1 -Force"

    # Per-run knobs travel as a config file vm-run.ps1 dot-sources (see the
    # header: `schtasks /run` has no argument channel). Values are safe to
    # single-quote: addon names are `^[a-z][\d_a-z]+$` by construction.
    echo "staging run-config.ps1 (addon=$ADDON mode=$RUN_MODE)..."
    CONFIG_LOCAL="$(mktemp)"
    printf "\$Addon = '%s'\n\$Mode = '%s'\n" "$ADDON" "$RUN_MODE" > "$CONFIG_LOCAL"
    scp -P 2222 -i "$VM_KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
      "$CONFIG_LOCAL" "builder@localhost:C:/dota/run-config.ps1"
    rm -f "$CONFIG_LOCAL"

    echo "triggering scheduled task $TASK_NAME..."
    vm_ssh "schtasks /run /tn $TASK_NAME"

    echo "polling $RESULT_FILE for completion..."
    RUN_DONE=0
    for _ in $(seq 1 "$POLL_TICKS"); do
      sleep 30
      OUT="$(vm_ssh "Get-Content $RESULT_FILE" 2>/dev/null || true)"
      if echo "$OUT" | grep -q "RUN DONE"; then
        echo "run finished."
        RUN_DONE=1
        break
      fi
    done
    if [ "$RUN_DONE" != 1 ]; then
      echo "WARNING: timed out after $((POLL_TICKS * 30))s without RUN DONE — retrieving whatever evidence exists" >&2
    fi

    TS="$(date -u +%Y%m%dT%H%M%SZ)"
    OUTDIR="artifacts/$RUN_MODE/$TS"
    mkdir -p "$OUTDIR"
    echo "retrieving evidence into $OUTDIR ..."
    vm_scp "$RESULT_FILE" "$OUTDIR/"
    vm_scp "$VIDEO_FILE" "$OUTDIR/"
    vm_scp "C:/steamcmd/steamapps/common/dota 2 beta/game/dota/console.log" "$OUTDIR/"
    vm_scp "C:/dota-shots/*.png" "$OUTDIR/"

    echo "--- SUMMARY ---"
    grep -E "RUN RESULT|RUN FAIL|RUN DONE" "$OUTDIR/dota-${RUN_MODE}-result.txt" 2>/dev/null || echo "(no result file retrieved)"
    echo "--- FAILURES ---"
    grep -E "^FAIL" "$OUTDIR/dota-${RUN_MODE}-result.txt" 2>/dev/null || echo "(none)"

    kill "$TUNNEL_PID" 2>/dev/null || true
    trap - EXIT
    echo "stopping $INSTANCE (billing)..."
    gcloud compute instances stop "$INSTANCE" --project="$PROJECT" --zone="$ZONE"
    ;;

  *)
    echo "usage: [PROJECT=... ADDON=... REF=...] $0 {create|start|stop|ip|tunnel|ssh|run}" >&2
    exit 2
    ;;
esac
