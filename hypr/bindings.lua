-- Discord panes (PanePopout plugin + discord-panes helper).
-- install.sh appends these to ~/.config/hypr/bindings.lua if they aren't there yet.
o.bind("SUPER + ALT + D", "Discord panes", os.getenv("HOME") .. "/.local/bin/discord-panes toggle")
o.bind("SUPER + ALT + SHIFT + D", "Discord panes help", os.getenv("HOME") .. "/.local/bin/discord-panes help")
