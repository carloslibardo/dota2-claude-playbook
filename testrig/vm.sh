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
#   RUN_MODE  name of the run; picks the convar,   (default: smoke)
#             the result file, and the artifact dir
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
    exec gcloud compute start-iap-tunnel "$INSTANCE" 22 \
      --local-host-port=localhost:2222 --project="$PROJECT" --zone="$ZONE"
    ;;

  ssh) shift; vm_ssh "$@" ;;

  run)
    STATUS="$(gcloud compute instances describe "$INSTANCE" --project="$PROJECT" --zone="$ZONE" --format='get(status)')"
    if [ "$STATUS" != "RUNNING" ]; then
      echo "starting $INSTANCE..."
      gcloud compute instances start "$INSTANCE" --project="$PROJECT" --zone="$ZONE"
    fi

    gcloud compute start-iap-tunnel "$INSTANCE" 22 \
      --local-host-port=localhost:2222 --project="$PROJECT" --zone="$ZONE" &
    TUNNEL_PID=$!
    trap 'kill "$TUNNEL_PID" 2>/dev/null || true' EXIT

    echo "waiting for ssh..."
    for _ in $(seq 1 90); do
      vm_ssh "echo ready" >/dev/null 2>&1 && break
      sleep 2
    done

    # Sync. The VM has no `gh` and its credential manager cannot prompt over a
    # non-tty ssh session, so the token is minted HERE and passed one-shot into
    # the fetch URL. `-c credential.helper=` keeps it out of the VM's stored
    # credentials; the grep scrubs it from the echoed output. It is never
    # written to disk on the VM.
    echo "syncing $INSTANCE to $REF..."
    if command -v gh >/dev/null 2>&1 && [ -n "$REPO" ]; then
      TOKEN="$(gh auth token)"
      AUTH_REPO="$(echo "$REPO" | sed -E "s#^(https://)?(git@)?github.com[:/]#https://x-access-token:${TOKEN}@github.com/#")"
      vm_ssh "cd $RVM; git -c credential.helper= fetch \"$AUTH_REPO\" $REF; git reset --hard FETCH_HEAD" | grep -v x-access-token
      unset TOKEN AUTH_REPO
    else
      vm_ssh "cd $RVM; git fetch origin $REF; git reset --hard FETCH_HEAD"
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

    echo "triggering scheduled task $TASK_NAME..."
    vm_ssh "schtasks /run /tn $TASK_NAME"

    echo "polling $RESULT_FILE for completion..."
    for _ in $(seq 1 "$POLL_TICKS"); do
      sleep 30
      OUT="$(vm_ssh "Get-Content $RESULT_FILE" 2>/dev/null || true)"
      if echo "$OUT" | grep -q "RUN DONE"; then
        echo "run finished."
        break
      fi
    done

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
