#!/bin/bash
# Stops the VS Code launch.sh started, and what it leaves holding the
# DevTools port.
#
# SIGTERM first, so VS Code quits and takes its children with it. If it is
# still up after ten seconds (a save dialog on an edited document keeps it
# waiting), SIGKILL. A VS Code killed that way leaves its `gsettings monitor`
# child running, and that child inherited the listening DevTools socket, so
# the port stays taken until the child is stopped too; the next launch then
# comes up without its DevTools server.
set -uo pipefail
STATE="${MDM_DEMO_STATE:-$HOME/.cache/mdm-demo-clips}"
PORT="${MDM_DEMO_PORT:-9333}"
# The bracket keeps pkill from matching a shell whose own command line
# contains the path.
PATTERN="user-data-dir=$STATE/profil[e]"

pkill -TERM -f "$PATTERN" 2>/dev/null
for _ in $(seq 1 10); do pgrep -f "$PATTERN" >/dev/null || break; sleep 1; done
if pgrep -f "$PATTERN" >/dev/null; then
  echo "VS Code did not quit on SIGTERM; killing it" >&2
  pkill -KILL -f "$PATTERN"
  sleep 1
fi
for pid in $(ss -ltnp "sport = :$PORT" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u); do
  echo "port $PORT was held by: $(ps -o cmd= -p "$pid")" >&2
  kill "$pid" 2>/dev/null
done
