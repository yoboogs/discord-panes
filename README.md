# discord-panes

Splits Discord into Hyprland windows that match the panes of the
[system24](https://github.com/refact0r/system24) theme, so Discord tiles and
navigates like the rest of Omarchy:

```
nav | channels | channel
    |----------|  chat
    | user     |  input
```

- **nav**, **channels** and **user** are their own tiled windows, drawn by the
  plugin from Discord's own data (servers, folders, unread and mention badges,
  categories, joined threads, DMs, presence, mute/deafen).
- The main Discord window stays as channel + chat + input, so Discord's real
  message box, menus and dialogs keep working.
- Colours and font follow the current Omarchy theme (toggle in the plugin's
  settings), and update live when the Omarchy theme changes.
- Everything is keyboard driven; the friends page in the main window is too.

## Install

```sh
./install.sh
```

Then, the first time only, enable **PanePopout** in Discord under
Settings > Plugins. Re-run `./install.sh` after changing anything here.

## Keys

| key | does |
| --- | --- |
| `SUPER ALT D` | split Discord into panes / put it back together |
| `SUPER ALT SHIFT D` | show / hide the help (or `?` in any pane) |
| `SUPER` + arrows | move between panes (Omarchy) |
| `SUPER W` | close a pane, which ends the split |
| `j` `k`, `g` `G`, `enter`, `esc` | move, jump, open, back to chat (in panes) |

The help window lists every key, per pane.

## How it fits together

- `plugin/PanePopout.plugin.js`: the BetterDiscord plugin. It opens the pane
  windows, draws them, reads Discord's stores and navigates.
- `bin/discord-panes`: the Hyprland side. It tiles the panes, resizes them,
  moves focus and handles the keybinds, using `hyprctl`.
- They talk through small JSON files in `$XDG_RUNTIME_DIR/discord-panes/`,
  because BetterDiscord plugins can't run programs or open sockets. Messages
  are fixed actions (open, dock, focus, geometry, help, diag); nothing that
  arrives there is executed as code.
- `discord-panes diag` prints a read-only report from the plugin (which Discord
  internals it found, pane sizes, theme values).

## Things worth knowing

- Discord won't let a popout window render smaller than 320x200, so panes that
  Hyprland tiles narrower are laid out for their real size (the helper sends
  it). The user pane is 200px tall for this reason.
- BetterDiscord disables a plugin whose file is replaced by a rename (how most
  editors save). Write the installed plugin in place, as `install.sh` does.
- Each pane loads Discord's popout page in the background, so the panes cost
  some extra memory.
- The helper isn't started at login. A keybind starts it on first use; to have
  the in-Discord `split` button work before that, add to
  `~/.config/hypr/autostart.lua`:

  ```lua
  o.exec_on_start(os.getenv("HOME") .. "/.local/bin/discord-panes daemon")
  ```
