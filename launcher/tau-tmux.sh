#!/usr/bin/env bash
# tau tmux — manage tmux sessions for Tau experiments.
# Sessions survive the launching shell (setsid when starting a fresh server).
set -uo pipefail

SOCKETS=("" "-L tauhyperfix")   # default socket, then the hyperfix experiment socket

usage() {
  cat <<'EOF'
Usage: tau tmux <cmd> [args]
  find [pattern]        list tmux sessions (and windows) matching pattern
  ls                    list all sessions on known sockets
  new <name> -- <cmd>   create detached session running <cmd>
  run <session> <cmd>   send a command to a session's active pane
  capture <s>[:w]       dump a session/window pane
  kill <name>           kill a session
EOF
  exit 1
}

# run tmux against every known socket, prefixing output with the socket
each_socket() {
  for s in "${SOCKETS[@]}"; do
    # shellcheck disable=SC2086
    if tmux $s ls >/dev/null 2>&1; then
      # shellcheck disable=SC2086
      tmux $s "$@" 2>/dev/null | sed "s/^/[${s:--L default}] /"
    fi
  done
}

# resolve "name" to "-L sock -t name" for commands needing one socket
resolve() {
  local name="$1"
  for s in "${SOCKETS[@]}"; do
    # shellcheck disable=SC2086
    if tmux $s has-session -t "$name" 2>/dev/null; then echo "$s"; return 0; fi
  done
  return 1
}

cmd="${1:-}"; shift || true
case "$cmd" in
  find)
    pat="${1:-}"
    each_socket list-sessions -F '#S: #{session_windows} windows (created #{session_created_string})' 2>/dev/null | { grep -i "$pat" || true; }
    each_socket list-windows -a -F '#S:#I #W [#{window_panes} panes]' 2>/dev/null | { grep -i "$pat" || true; }
    ;;
  ls)
    each_socket list-sessions -F '#S: #{session_windows} windows'
    ;;
  new)
    name="${1:-}"; shift || true
    [ -n "$name" ] || { echo "usage: tau tmux new <name> -- <cmd>"; exit 1; }
    [ "${1:-}" = "--" ] && shift
    [ $# -gt 0 ] || { echo "usage: tau tmux new <name> -- <cmd>"; exit 1; }
    # If no server on the default socket, start one detached so it
    # survives this shell (bare `tmux new -d` as a child of a
    # short-lived exec session gets reaped with it).
    if ! tmux ls >/dev/null 2>&1; then
      setsid tmux new-session -d -s "$name" -x 200 -y 50 "$@" >/dev/null 2>&1 < /dev/null
    else
      tmux new-session -d -s "$name" -x 200 -y 50 "$@"
    fi
    echo "session $name created"
    ;;
  run)
    name="${1:-}"; shift || true
    [ -n "$name" ] && [ $# -gt 0 ] || { echo "usage: tau tmux run <session> <cmd...>"; exit 1; }
    sock="$(resolve "$name")" || { echo "no such session: $name"; exit 1; }
    # shellcheck disable=SC2086
    tmux $sock send-keys -t "$name" "$*" Enter
    ;;
  capture)
    target="${1:-}"; [ -n "$target" ] || { echo "usage: tau tmux capture <session>[:window]"; exit 1; }
    name="${target%%:*}"
    sock="$(resolve "$name")" || { echo "no such session: $name"; exit 1; }
    # shellcheck disable=SC2086
    tmux $sock capture-pane -t "$target" -p
    ;;
  kill)
    name="${1:-}"; [ -n "$name" ] || { echo "usage: tau tmux kill <name>"; exit 1; }
    sock="$(resolve "$name")" || { echo "no such session: $name"; exit 1; }
    # shellcheck disable=SC2086
    tmux $sock kill-session -t "$name" && echo "killed $name"
    ;;
  *) usage ;;
esac
