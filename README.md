# discord-panes

A [BetterDiscord](https://betterdiscord.app) plugin plus a small
[Hyprland](https://hypr.land) helper that splits Discord into real tiled windows,
laid out like the panes of the [system24](https://github.com/refact0r/system24)
theme:

```
nav | channels | channel
    |----------|  chat
    | user     |  input
```

- **nav**, **channels** and **user** become their own Hyprland windows, drawn by
  the plugin from Discord's own data: servers and folders, unread and mention
  badges, channel categories, joined threads, DMs with presence, mute and deafen.
- The main Discord window stays as channel + chat + input, so Discord's real
  message box, menus and dialogs keep working.
- Move between panes with your usual Hyprland focus keys; inside a pane,
  everything is driven by plain keys (`j`/`k`, Enter, `/`, ...). The friends page
  in the main window is keyboard-driven too.
- The panes copy your Discord theme's colours. On [Omarchy](https://omarchy.org),
  Discord can follow the Omarchy theme instead, live.

## Requirements

- Linux with Hyprland (the helper places and focuses windows with `hyprctl`).
  Developed on Hyprland 0.56 with the Lua config (Omarchy). Classic
  `hyprland.conf` setups are supported by the helper but less tested.
- Discord with BetterDiscord.
- Python 3 for the helper.
- Optional: the system24 theme (the panes are styled after it, but work
  without it), Omarchy (for theme following), `notify-send`.

## Install

```sh
git clone https://github.com/yoboogs/discord-panes
cd discord-panes
./install.sh
```

`install.sh` copies the plugin into `~/.config/BetterDiscord/plugins/` and the
helper to `~/.local/bin/discord-panes`, adds the keybinds (Lua-config Hyprland)
or prints them for your `hyprland.conf` (classic), and starts the helper.

Then enable **PanePopout** in Discord under Settings > Plugins and press
`SUPER ALT D`.

Manual install: put `plugin/PanePopout.plugin.js` in your BetterDiscord plugins
folder, `bin/discord-panes` somewhere on your `PATH`, and bind
`discord-panes toggle` and `discord-panes help` to keys (see `hypr/`).

To start the helper at login (so the in-Discord `split` button works before
you've used a keybind), run `discord-panes daemon` from your Hyprland autostart.

## Keys

| key | does |
| --- | --- |
| `SUPER ALT D` | split Discord into panes / put it back together |
| `SUPER ALT SHIFT D` | show / hide the help window (`?` in any pane too) |
| your focus keys | move between panes |
| close window | closing any pane puts Discord back together |
| `j` `k`, `g` `G` | move, jump to top / bottom (in panes) |
| Enter, `l` | open the server / channel / DM under the cursor |
| `/` | filter channels or DMs |
| `esc` | back to the chat input |
| `m` `d` `s` | mute, deafen, settings (user pane) |

The help window lists every key per pane, including the friends page. The
`SUPER ALT ...` binds are only defaults; change them in your Hyprland config.

## Settings

Discord > Settings > Plugins > PanePopout: **Follow the Omarchy theme** (on by
default) maps the current Omarchy theme's colours and monospace font onto your
Discord theme. Without Omarchy installed it does nothing.

## How it works

- `plugin/PanePopout.plugin.js` opens the pane windows (as Discord popouts),
  draws them, reads Discord's state through BetterDiscord's official Webpack
  API, and navigates.
- `bin/discord-panes` is the Hyprland side: it tiles the panes, sizes them,
  moves focus and answers the keybinds.
- BetterDiscord plugins can't run programs or open sockets, so the two exchange
  small JSON messages through files in `$XDG_RUNTIME_DIR/discord-panes/`
  (a private, per-user directory). Messages are a fixed set of actions (open,
  dock, focus, geometry, help, diag); nothing received there is run as code.
- `discord-panes diag` prints a read-only health report from the plugin: which
  Discord internals it found, counts, pane sizes and theme values. It contains no
  names, IDs or messages.

The plugin makes no network requests of its own beyond loading server icons and
avatars from Discord's CDN, and stores only its own UI state (collapsed
categories, open folders, the theme setting) via BetterDiscord.

## Known limits

- Discord won't render a popout smaller than 320x200, so narrower or shorter
  tiles are laid out for their real size, and the user pane is 200px tall.
- Each pane loads Discord's popout page, which costs some memory.
- BetterDiscord disables a plugin whose file is replaced by a rename (how most
  editors save). `install.sh` writes the file in place to avoid that.
- Discord changes its internals often; if a pane stops updating, check
  `discord-panes diag` and open an issue.

## About this project

Built with AI assistance (Anthropic's Claude), designed and tested by
[yoboogs](https://github.com/yoboogs). Because of that it isn't submitted to the
official BetterDiscord addon store, whose guidelines require plugins to be
written primarily by their author.

## License

[MIT](LICENSE)
