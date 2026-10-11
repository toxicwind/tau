#!/usr/bin/env bash
# Real-world config latency probe for tau coding-agent
# Compares current config vs yolo vs optimized overlays on a tiny local model.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
FIXTURE="$HERE/fixture"
MODEL="${TAU_BENCH_MODEL:-beellama/exaone-4-0-1-2b-iq4xs}"
TAU="${TAU_BIN:-/home/toxic/.local/bin/tau}"

run_set() {
  local label=$1
  local extra=$2
  echo "=== $label ==="
  for i in 1 2 3 4 5; do
    /usr/bin/time -f "wall:%e" timeout 40 "$TAU" $extra --model "$MODEL" -p --no-session --cwd "$FIXTURE"       "read file$i.txt and tell me the line number content" </dev/null > /tmp/tau-lat-$label-$i.txt 2>&1 || true
    grep wall /tmp/tau-lat-$label-$i.txt | tail -1
  done
}

run_set BASE ""
run_set YOLO "--config $HERE/overlay-yolo.yml"
run_set OPT  "--config $HERE/overlay-opt.yml"

echo "=== bigfile ==="
for label in BASE YOLO OPT; do
  extra=""
  [[ $label == YOLO ]] && extra="--config $HERE/overlay-yolo.yml"
  [[ $label == OPT ]]  && extra="--config $HERE/overlay-opt.yml"
  /usr/bin/time -f "wall:%e" timeout 60 "$TAU" $extra --model "$MODEL" -p --no-session --cwd "$FIXTURE"     "read bigfile.txt and count how many lines start with This" </dev/null > /tmp/tau-lat-big-$label.txt 2>&1 || true
  echo "$label: $(grep wall /tmp/tau-lat-big-$label.txt | tail -1)"
done
