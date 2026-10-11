# config-latency bench

Real-world wall-clock probes for tau coding-agent config knobs (yolo vs optimized vs baseline).

Uses a tiny local model (default beellama/exaone-4-0-1-2b-iq4xs via openai-compatible at :25100).

## Contents
- overlay-yolo.yml / overlay-opt.yml - config overlays
- fixture/ - small files + 200-line bigfile.txt
- run-latency.sh - sequential runner

## Run
cd packages/coding-agent/bench/config-latency
./run-latency.sh

Results in /tmp/tau-lat-*.txt. Micro-tasks show ~1.2-1.5s with no clear winner on the 1.2B model; heavier loads (LSP, subagents, vision, hindsight) are where the knobs matter.
