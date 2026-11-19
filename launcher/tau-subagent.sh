#!/usr/bin/env bash
# tau-subagent.sh — one tmux session is one tau agent.
# Create the session once. Later calls drop a prompt file into it.
# Do not use `tau tmux new` for this. The pane is a shell loop, so a
# second task reuses the same session instead of starting another one.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAU_BIN="${TAU_BIN:-$ROOT/packages/coding-agent/dist/tau}"
STATE="${TAU_SUBAGENT_STATE:-/tmp/tau-agents}"
mkdir -p "$STATE"

usage() {
  cat <<EOF
Usage: tau tmux subagent <cmd> [name]
  open <name> [--cwd dir]     create the session if missing, else no-op
  prompt <name> -- <text>     queue a prompt (or --prompt-file path)
  prompt <name> --prompt-file path
  status [name]               session, pane command, last exit
  log <name>                  print the run log
  close <name>                kill the session
A name maps to tmux session tau-<name>. Prompt text is a file, not argv.
EOF
  exit 1
}

session_of() { printf 'tau-%s' "$1"; }

open_session() {
  local name="$1" cwd="${2:-$ROOT}" sess dir
  sess="$(session_of "$name")"
  dir="$STATE/$name"
  mkdir -p "$dir"
  printf '%s\n' "$cwd" > "$dir/cwd"
  if tmux has-session -t "$sess" 2>/dev/null; then
    printf '{"ok":true,"action":"reuse","session":"%s"}\n' "$sess"
    return 0
  fi
  # Resident shell. Picks up next.prompt, runs tau with @file, writes exit.
  tmux new-session -d -s "$sess" -x 200 -y 50 -c "$cwd" \
    "bash -lc 'cd \"$cwd\" && exec bash $dir/loop.sh'"
  cat > "$dir/loop.sh" << EOF
#!/usr/bin/env bash
set -uo pipefail
DIR="$dir"
TAU="$TAU_BIN"
CWD="$cwd"
cd "\$CWD" || exit 1
while true; do
  if [[ -f "\$DIR/next.prompt" ]]; then
    mv "\$DIR/next.prompt" "\$DIR/current.prompt"
    : > "\$DIR/run.log"
    "\$TAU" -p --auto-approve --approval-mode=yolo --no-session --cwd "\$CWD" "@\$DIR/current.prompt" </dev/null > "\$DIR/run.log" 2>&1
    printf '%s\n' "\$?" > "\$DIR/exit"
    date -Is > "\$DIR/finished"
  fi
  sleep 1
done
EOF
  chmod 755 "$dir/loop.sh"
  printf '{"ok":true,"action":"open","session":"%s"}\n' "$sess"
}

cmd="${1:-}"; shift || true
case "$cmd" in
  open)
    name="${1:-}"; shift || true
    [[ -n "$name" ]] || usage
    cwd="$ROOT"
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --cwd) cwd="$2"; shift 2 ;;
        *) echo "unknown open arg: $1" >&2; exit 1 ;;
      esac
    done
    open_session "$name" "$cwd"
    ;;
  prompt)
    name="${1:-}"; shift || true
    [[ -n "$name" ]] || usage
    file=""
    text=""
    if [[ "${1:-}" == "--prompt-file" ]]; then
      file="$2"
    elif [[ "${1:-}" == "--" ]]; then
      shift
      text="$*"
    else
      usage
    fi
    open_session "$name" "$(cat "$STATE/$name/cwd" 2>/dev/null || echo "$ROOT")" >/dev/null
    dest="$STATE/$name/next.prompt"
    if [[ -n "$file" ]]; then
      cp "$file" "$dest"
    else
      printf '%s\n' "$text" > "$dest"
    fi
    printf '{"ok":true,"action":"queued","session":"%s","prompt":"%s"}\n' "$(session_of "$name")" "$dest"
    ;;
  status)
    name="${1:-}"
    if [[ -z "$name" ]]; then
      tmux ls -F '#{session_name}' 2>/dev/null | grep '^tau-' || true
      exit 0
    fi
    sess="$(session_of "$name")"
    if tmux has-session -t "$sess" 2>/dev/null; then alive=true; else alive=false; fi
    exitc="$(cat "$STATE/$name/exit" 2>/dev/null || echo null)"
    printf '{"ok":true,"session":"%s","alive":%s,"exit":%s}\n' "$sess" "$alive" "$exitc"
    ;;
  log)
    name="${1:-}"; [[ -n "$name" ]] || usage
    cat "$STATE/$name/run.log" 2>/dev/null || echo "no log"
    ;;
  close)
    name="${1:-}"; [[ -n "$name" ]] || usage
    tmux kill-session -t "$(session_of "$name")" 2>/dev/null || true
    printf '{"ok":true,"action":"closed","session":"%s"}\n' "$(session_of "$name")"
    ;;
  *) usage ;;
esac
