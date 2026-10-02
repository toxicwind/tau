#!/usr/bin/env bash
# roboomp container entrypoint. No per-boot pip installs — everything is baked
# into the image; we only sanity-check the runtime mount and create state dirs.
#
# Used by both the orchestrator (CMD: `python -m robtau serve`) and the
# sibling gh-proxy (compose command: `python -m robtau.proxy serve`). The
# proxy role does NOT need a $PI_ROOT pi checkout — it never runs tau.
set -euo pipefail

# Shared git metadata under /data/workspaces/_pool is intentionally group
# writable by the `tau` group so interrupted work can resume on a different
# slot user. Keep new files and directories compatible with that model.
umask 0002

# Detect the proxy role by inspecting the command. Compose passes `command:`
# as $@ here (after tini --), so $1=python, $2=-m, $3=robtau.proxy is the
# canonical shape; we also accept a single concatenated arg for safety.
is_proxy_role=0
if [ "${1:-}" = "python" ] && [ "${2:-}" = "-m" ] && [[ "${3:-}" == robtau.proxy* ]]; then
    is_proxy_role=1
elif [[ "${1:-}" == *"robtau.proxy"* ]]; then
    is_proxy_role=1
fi

/usr/sbin/groupadd -f -g 2000 tau
max_slots="${ROBTAU_MAX_CONCURRENCY:-8}"
for i in $(seq 1 "$max_slots"); do
    user="tau-$i"
    slot_group="tau-$i"
    slot_id=$((2000 + i))
    /usr/sbin/groupadd -f -g "$slot_id" "$slot_group"
    id -u "$user" >/dev/null 2>&1 || /usr/sbin/useradd -u "$slot_id" -g "$slot_group" -G tau -M -N -s /usr/sbin/nologin "$user"
    /usr/sbin/usermod -g "$slot_group" -a -G tau "$user"
done

if [ "$is_proxy_role" -eq 1 ]; then
    exec "$@"
fi

: "${PI_ROOT:=/work/pi}"
if [ ! -d "$PI_ROOT/packages/coding-agent" ]; then
    echo "roboomp: PI_ROOT=$PI_ROOT does not look like a pi checkout (no packages/coding-agent/)" >&2
    exit 1
fi

mkdir -p /data/workspaces /data/workspaces/_pool /data/logs
# Persistent build caches under the /data volume. CARGO_HOME,
# CARGO_TARGET_DIR, and RUSTUP_HOME are pinned to these paths in the image ENV
# so every per-issue worktree shares one cargo target/toolchain. Bun install
# cache is workspace-private; a shared cache is unsafe across slot users
# because bun may chmod/chown its cache root to the first writer.
mkdir -p /data/cache/cargo /data/cache/cargo-target /data/cache/rustup /data/cache/tau-natives
chown -R root:tau /data/cache /data/workspaces/_pool
find /data/cache /data/workspaces/_pool -type d -exec chmod 2770 {} +
find /data/cache /data/workspaces/_pool -type f -perm /111 -exec chmod 0770 {} +
find /data/cache /data/workspaces/_pool -type f ! -perm /111 -exec chmod 0660 {} +
chmod 0700 /data/logs


rm -rf /srv/agent-home/.agent /srv/agent-home/.tau/agent
mkdir -p /srv/agent-home/.agent /srv/agent-home/.tau/agent
if [ -e /srv/agent-home-stage/.agent ]; then
    cp -a /srv/agent-home-stage/.agent/. /srv/agent-home/.agent/
fi
if [ -e /srv/agent-home-stage/.tau/agent ]; then
    cp -a /srv/agent-home-stage/.tau/agent/. /srv/agent-home/.tau/agent/
fi
chown -R root:root /srv/agent-home || true
find /srv/agent-home -type d -exec chmod 0755 {} +
find /srv/agent-home -type f -exec chmod 0644 {} +

# tau registers daemon project presence under ~/.tau/run at startup, nesting
# per-project dirs (daemons/<hash>/clients) that any slot user must be able to
# create and enter regardless of which slot first made them: setgid + group
# tau keeps the whole tree group-writable (entrypoint umask 0002 carries into
# slot processes, so new entries stay group-writable too).
mkdir -p /srv/agent-home/.tau/run
chgrp -R tau /srv/agent-home/.tau/run
chmod -R g+rwX /srv/agent-home/.tau/run
find /srv/agent-home/.tau/run -type d -exec chmod g+s {} +
chmod 2770 /srv/agent-home/.tau/run

touch /data/robtau.sqlite
chown root:root /data/robtau.sqlite
chmod 0600 /data/robtau.sqlite
for db_file in /data/robtau.sqlite-wal /data/robtau.sqlite-shm; do
    if [ -e "$db_file" ]; then
        chown root:root "$db_file"
        chmod 0600 "$db_file"
    fi
done

exec "$@"
