#!/bin/bash
# Starts the VS Code the clips are recorded in: a profile of its own, the
# extension from this working tree, a copy of demo.mdm as the only file in its
# folder, and the DevTools port the scripts drive it through.
#
# The environment is rebuilt from nothing because this is usually run from a
# terminal inside VS Code, whose extension host exports ELECTRON_RUN_AS_NODE=1
# and a set of VSCODE_* variables. Inherited, the first makes the Electron
# binary start as node ("bad option: --user-data-dir") and the others make the
# `code` wrapper hand the arguments to the running instance instead of
# starting a new one.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
STATE="${MDM_DEMO_STATE:-$HOME/.cache/mdm-demo-clips}"
PORT="${MDM_DEMO_PORT:-9333}"
CODE="${MDM_DEMO_CODE:-/usr/share/code/code}"

# A taken port starts VS Code without its DevTools server, which shows only
# later, as a connection refused. The usual holder is what a SIGKILLed VS Code
# left behind; stop.sh clears it.
if ss -ltn "sport = :$PORT" 2>/dev/null | grep -q LISTEN; then
  echo "port $PORT is taken:" >&2
  ss -ltnp "sport = :$PORT" >&2 || true
  echo "run stop.sh first" >&2
  exit 1
fi

# --disable-lcd-text, below: Chromium draws text with subpixel (LCD) or with
# greyscale antialiasing depending on how it composites the layer, and a theme
# switch repainted the page from one to the other in the middle of a take. A
# take that switched theme ended with its text antialiased differently from
# how it began, blue and orange LCD fringes against the grey of its first
# frame, and the seam check (rig.js) caught it at 0.21% of the frame.
# Greyscale throughout is also the better picture for a video: yuv420p halves
# the colour resolution and smears subpixel fringes into colour.
mkdir -p "$STATE/profile/User" "$STATE/extensions" "$STATE/workspace"
# VS Code opens a copy; record.js puts it back from demo.mdm before every take.
cp "$HERE/demo.mdm" "$STATE/workspace/demo.mdm"
# A buffer left edited by a killed session is backed up here and restored at
# the next start; the profile is disposable, so is its backup.
rm -rf "$STATE/profile/Backups"
# A link and not a copy, so every take exercises the working tree as it is
# rather than a snapshot of it that goes stale between two takes.
ln -sfn "$REPO/vscode-mdm" "$STATE/extensions/alpelito7.mdm-editor-dev"
# record.js rewrites this before every take; seeding it opens the window at the
# zoom the takes are framed for, instead of resizing it under the first one.
if [ ! -f "$STATE/profile/User/settings.json" ]; then
  printf '{\n  "window.zoomLevel": 2,\n  "workbench.startupEditor": "none"\n}\n' \
    > "$STATE/profile/User/settings.json"
fi

exec env -i \
  HOME="$HOME" PATH="/usr/local/bin:/usr/bin:/bin" \
  DISPLAY="${DISPLAY:-:0}" XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}" \
  XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}" \
  DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-}" \
  LANG="${LANG:-en_US.UTF-8}" DONT_PROMPT_WSL_INSTALL=1 \
  "$CODE" \
    --user-data-dir="$STATE/profile" \
    --extensions-dir="$STATE/extensions" \
    --new-window --disable-workspace-trust --skip-welcome --skip-release-notes \
    --disable-gpu-sandbox \
    --disable-lcd-text \
    --remote-debugging-port="$PORT" \
    "$STATE/workspace"
