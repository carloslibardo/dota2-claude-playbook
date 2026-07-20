#!/usr/bin/env bash
# Extracts review frames from a run recording.
#
#   testrig/extract-frames.sh <recording.mp4> [outdir]
#   testrig/extract-frames.sh <recording.mp4> --window <startSec> <durSec> <outdir>
#
# Default mode: 1 frame every 3 seconds into <outdir|<mp4 dir>/frames>/frame_%04d.png.
# Frame N is roughly (N-1)*3 s into the video. Good for sweeping a whole run.
#
# --window mode: 15 fps over one narrow window, into <outdir>/dense_%04d.png.
# Use it when the thing you need to see lasts about a second — a projectile in
# flight, a proc firing, a status effect landing. A 1-per-3s sweep will miss it.
#
# These frames ARE the acceptance gate for anything visual. A log line proves
# code ran; only a frame proves the player would have seen it.
set -euo pipefail

MP4="${1:-}"
if [ -z "$MP4" ] || [ ! -f "$MP4" ]; then
  echo "usage: testrig/extract-frames.sh <recording.mp4> [outdir]" >&2
  echo "       testrig/extract-frames.sh <recording.mp4> --window <startSec> <durSec> <outdir>" >&2
  exit 2
fi

if [ "${2:-}" = "--window" ]; then
  START="${3:-}"
  DUR="${4:-}"
  OUTDIR="${5:-}"
  if [ -z "$START" ] || [ -z "$DUR" ] || [ -z "$OUTDIR" ]; then
    echo "usage: testrig/extract-frames.sh <recording.mp4> --window <startSec> <durSec> <outdir>" >&2
    exit 2
  fi
  mkdir -p "$OUTDIR"
  # -nostdin: when this script is called from a loop that feeds stdin (the
  # archer-wars review harness read window specs line-by-line), ffmpeg eats
  # stdin bytes meant for the NEXT line — run 20260713T014504Z mangled dir
  # names into "otnar_warbow" exactly this way.
  ffmpeg -nostdin -hide_banner -loglevel error -ss "$START" -t "$DUR" -i "$MP4" -vf fps=15 "$OUTDIR/dense_%04d.png"
  COUNT="$(find "$OUTDIR" -maxdepth 1 -name 'dense_*.png' | wc -l | tr -d ' ')"
  echo "extracted $COUNT dense frames (15 fps, t=${START}s +${DUR}s) -> $OUTDIR"
  exit 0
fi

OUTDIR="${2:-$(dirname "$MP4")/frames}"
mkdir -p "$OUTDIR"

ffmpeg -nostdin -hide_banner -loglevel error -i "$MP4" -vf fps=1/3 "$OUTDIR/frame_%04d.png"

COUNT="$(find "$OUTDIR" -maxdepth 1 -name 'frame_*.png' | wc -l | tr -d ' ')"
echo "extracted $COUNT frames (1 per 3s) -> $OUTDIR"
