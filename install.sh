#!/usr/bin/env bash
# Install discord-panes: the PanePopout plugin, the Hyprland helper and the keybinds.
#
#   ./install.sh            Discord with BetterDiscord
#   ./install.sh vesktop    Vesktop (builds Vencord with the plugin included)
#
# Safe to re-run after changing anything in this repo (or to update Vencord).
set -euo pipefail

target="${1:-betterdiscord}"
here="$(cd "$(dirname "$0")" && pwd)"
config="${XDG_CONFIG_HOME:-$HOME/.config}"
data="${XDG_DATA_HOME:-$HOME/.local/share}/discord-panes"
bindir="$HOME/.local/bin"
bindings="$config/hypr/bindings.lua"
run="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/discord-panes"

install_betterdiscord() {
  local plugins="$config/BetterDiscord/plugins"
  mkdir -p "$plugins"
  # Overwrite in place rather than copying a new file over the old one: BetterDiscord
  # treats a file replaced by rename as removed and disables the plugin.
  cat "$here/plugin/PanePopout.plugin.js" > "$plugins/PanePopout.plugin.js"
  echo "plugin -> $plugins/PanePopout.plugin.js"
}

# Vencord only loads plugins that are compiled into it, so build Vencord from source with
# PanePopout in src/userplugins/, then point Vesktop at that build ("Vencord Location").
install_vesktop() {
  local vencord="$data/vencord" vesktop="$config/vesktop"
  for cmd in git node; do
    command -v "$cmd" >/dev/null || { echo "vesktop install needs $cmd" >&2; exit 1; }
  done

  local tag
  # (sed reads to the end: `head -1` would close the pipe early, git would die of SIGPIPE
  # and pipefail would end the script without a word)
  tag="$(git ls-remote --tags --refs --sort=-v:refname https://github.com/Vendicated/Vencord.git 'v*' | sed -n '1s#.*refs/tags/##p')"
  [[ -n "$tag" ]] || { echo "couldn't look up the latest Vencord release" >&2; exit 1; }
  if [[ -d "$vencord/.git" ]]; then
    git -C "$vencord" fetch -q --depth 1 origin tag "$tag"
    git -C "$vencord" -c advice.detachedHead=false checkout -q "$tag"
  else
    mkdir -p "$data"
    git -c advice.detachedHead=false clone -q --depth 1 --branch "$tag" https://github.com/Vendicated/Vencord.git "$vencord"
  fi
  echo "vencord $tag -> $vencord"

  rm -rf "$vencord/src/userplugins/panePopout"
  mkdir -p "$vencord/src/userplugins"
  cp -r "$here/vencord/panePopout" "$vencord/src/userplugins/panePopout"
  echo "plugin -> $vencord/src/userplugins/panePopout"

  # Vencord pins its pnpm version in package.json ("packageManager").
  local pnpm=(pnpm)
  if ! command -v pnpm >/dev/null; then
    local want
    want="$(sed -n 's/.*"packageManager": *"\(pnpm@[^"]*\)".*/\1/p' "$vencord/package.json")"
    if command -v corepack >/dev/null; then pnpm=(corepack pnpm)
    else pnpm=(npx -y "${want:-pnpm}"); fi
  fi
  (cd "$vencord" && "${pnpm[@]}" install --frozen-lockfile && "${pnpm[@]}" build)

  local f
  for f in vencordDesktopMain.js vencordDesktopPreload.js vencordDesktopRenderer.js vencordDesktopRenderer.css; do
    [[ -f "$vencord/dist/$f" ]] || { echo "Vencord build is missing dist/$f" >&2; exit 1; }
  done
  echo "vencord built -> $vencord/dist"

  # Vesktop keeps its state and Vencord settings in memory and writes them back on quit,
  # so they can only be edited while it isn't running.
  if pgrep -x vesktop >/dev/null; then
    echo
    echo "Vesktop is running, so it wasn't pointed at the new build. Either:"
    echo "  - quit Vesktop (tray icon > Quit) and run ./install.sh vesktop again, or"
    echo "  - in Vesktop: Settings > Vesktop Settings > Developer Options > Vencord Location,"
    echo "    choose $vencord/dist, restart Vesktop, then enable PanePopout under Settings > Plugins."
  else
    mkdir -p "$vesktop/settings"
    python3 - "$vesktop" "$vencord/dist" <<'EOF'
import json, os, sys
root, dist = sys.argv[1], sys.argv[2]

def update(path, fn):
    try:
        with open(path) as f:
            d = json.load(f)
    except (OSError, ValueError):
        d = {}
    fn(d)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(d, f, indent=4)
    os.replace(tmp, path)

update(os.path.join(root, "state.json"), lambda d: d.__setitem__("vencordDir", dist))
update(os.path.join(root, "settings", "settings.json"),
       lambda d: d.setdefault("plugins", {}).setdefault("PanePopout", {}).__setitem__("enabled", True))
EOF
    echo "vesktop -> uses $vencord/dist, PanePopout enabled"
  fi
}

case "$target" in
  betterdiscord|bd|discord) install_betterdiscord ;;
  vesktop|vencord) install_vesktop ;;
  *) echo "usage: $0 [betterdiscord|vesktop]" >&2; exit 2 ;;
esac

mkdir -p "$bindir"
cat "$here/bin/discord-panes" > "$bindir/discord-panes"
chmod +x "$bindir/discord-panes"
echo "helper -> $bindir/discord-panes"

# Keybinds: on a Lua-config Hyprland (e.g. Omarchy) append them once, after a backup.
# Classic hyprland.conf setups get told what to add instead.
if [[ -f "$bindings" ]] && grep -q "o\.bind" "$bindings"; then
  if ! grep -q "discord-panes toggle" "$bindings"; then
    cp "$bindings" "$bindings.bak.$(date +%s)"
    { echo; cat "$here/hypr/bindings.lua"; } >> "$bindings"
    echo "keybinds added to $bindings"
  fi
elif ! grep -rqs "discord-panes toggle" "$config/hypr/"; then
  echo
  echo "Add these keybinds to your hyprland.conf:"
  grep -v '^#' "$here/hypr/hyprland.conf"
fi
if command -v hyprctl >/dev/null; then
  hyprctl reload >/dev/null
  errors="$(hyprctl configerrors)"
  [[ -n "$errors" ]] && echo "hyprland config errors:" && echo "$errors"
fi

# Restart the helper so the new version runs.
if [[ -f "$run/daemon.pid" ]]; then
  kill "$(cat "$run/daemon.pid")" 2>/dev/null || true
  sleep 0.3
fi
setsid -f "$bindir/discord-panes" daemon >/dev/null 2>&1 </dev/null
echo "helper restarted"

echo
if [[ "$target" == vesktop || "$target" == vencord ]]; then
  echo "Start Vesktop; PanePopout shows under Settings > Plugins. Then press SUPER+ALT+D."
else
  echo "First install: enable PanePopout in Discord (Settings > Plugins), then press SUPER+ALT+D."
fi
