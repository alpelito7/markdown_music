#!/bin/bash
# Starts the VS Code the clips are recorded in: a profile of its own, the
# extension from this working tree, a folder holding a copy of demo.mdm (and
# of each clip's document once record.js has put it there), and the DevTools
# port the scripts drive it through.
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
if [ "$(uname)" = Darwin ]; then
  CODE="${MDM_DEMO_CODE:-/Applications/Visual Studio Code.app/Contents/MacOS/Code}"
else
  CODE="${MDM_DEMO_CODE:-/usr/share/code/code}"
fi

# Who holds a TCP port, in a form for the message below: ss on Linux, lsof
# on a Mac, which has no ss.
listening() {
  if [ "$(uname)" = Darwin ]; then
    lsof -nP -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | tail -n +2
  else
    ss -ltnp "sport = :$1" 2>/dev/null | tail -n +2
  fi
}

# A taken port starts VS Code without its DevTools server, which shows only
# later, as a connection refused. The usual holder is what a SIGKILLed VS Code
# left behind; stop.sh clears it.
if [ -n "$(listening "$PORT")" ]; then
  echo "port $PORT is taken:" >&2
  listening "$PORT" >&2
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

# The window's size, which the frame is (rig.js, "the size of the frame"):
# 1440x900 as VS Code opened it on the Linux desktop the takes were first
# recorded on. A Mac opens a first window at a size of its own choosing, so
# the profile is told the last window it had was the size wanted, which is
# the size VS Code gives the first window of a session (windowsState in its
# global storage), and it is told so before every start: VS Code writes the
# size it closed at back over it. On the owner's Mac that is 1358x849 and
# not 1440x900: the screen is 1470x956 points and the menu bar and the Dock
# leave 849 of it, to which VS Code cuts a taller window (asked for 1440x900,
# it opened 1440x849, a page of 1000x589 and not the 1000x625 the takes are
# framed for). 1358x849 is the same shape, and rig.js (zoomFor) zooms it to
# the same page.
#
# On a Mac the rig's window is on the owner's screen, among his own: one
# covered by another stops painting (macOS reports it occluded and Chromium
# stops drawing it), and the camera then gets no frames. The three switches
# keep it drawing and its timers running behind other windows.
EXTRA=()
if [ "$(uname)" = Darwin ]; then
  mkdir -p "$STATE/profile/User/globalStorage"
  /usr/bin/python3 - "$STATE/profile/User/globalStorage/storage.json" <<'PY'
import json, os, sys
path = sys.argv[1]
try:
    with open(path) as f:
        data = json.load(f)
except (OSError, ValueError):
    data = {}
state = data.setdefault("windowsState", {})
state["lastActiveWindow"] = {"uiState": {"mode": 1, "x": 10, "y": 37, "width": 1358, "height": 849}}
state["openedWindows"] = []
with open(path + ".tmp", "w") as f:
    json.dump(data, f, indent=2)
os.replace(path + ".tmp", path)
PY
  EXTRA+=(--disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling)
fi

# --mute-audio: a take plays its score (the player is part of what is
# shown) and the clips have no sound track, so nothing is gained by letting
# it out of the machine's speakers while it is recorded.
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
    --mute-audio \
    ${EXTRA[@]+"${EXTRA[@]}"} \
    --remote-debugging-port="$PORT" \
    "$STATE/workspace"
