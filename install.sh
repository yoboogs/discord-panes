#!/usr/bin/env bash
# Install discord-panes: the BetterDiscord plugin, the Hyprland helper and the keybinds.
# Safe to re-run after changing anything in this repo.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
config="${XDG_CONFIG_HOME:-$HOME/.config}"
plugins="$config/BetterDiscord/plugins"
bindir="$HOME/.local/bin"
bindings="$config/hypr/bindings.lua"
run="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/discord-panes"

mkdir -p "$plugins" "$bindir"

# Overwrite in place rather than copying a new file over the old one: BetterDiscord
# treats a file replaced by rename as removed and disables the plugin.
cat "$here/plugin/PanePopout.plugin.js" > "$plugins/PanePopout.plugin.js"
cat "$here/bin/discord-panes" > "$bindir/discord-panes"
chmod +x "$bindir/discord-panes"
echo "plugin -> $plugins/PanePopout.plugin.js"
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
echo "First install: enable PanePopout in Discord (Settings > Plugins), then press SUPER+ALT+D."
