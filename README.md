# discord-panes

A [BetterDiscord](https://betterdiscord.app) or [Vesktop](https://vesktop.dev)
(Vencord) plugin plus a small
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
  everything is driven by plain keys (`j`/`k`, Enter, `/`, ...). In the main
  window, the friends page and the messages are keyboard-driven too: open links,
  react, reply and more without the mouse.
- The panes copy your Discord theme's colours. On [Omarchy](https://omarchy.org),
  Discord can follow the Omarchy theme instead, live.

## Requirements

- Linux with Hyprland (the helper places and focuses windows with `hyprctl`).
  Developed on Hyprland 0.56 with the Lua config (Omarchy). Classic
  `hyprland.conf` setups are supported by the helper but less tested. Discord's
  workspace can use the dwindle or the scrolling layout, or Discord can float
  (Omarchy's `SUPER L` cycles a workspace through all three).
- Discord with BetterDiscord, **or** Vesktop. Vesktop needs `git` and `node` to
  build Vencord with the plugin (Vencord has no way to load plugins at runtime).
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

### Vesktop

```sh
./install.sh vesktop
```

Vencord only runs plugins compiled into it, so this clones the latest Vencord
release into `~/.local/share/discord-panes/vencord`, adds the plugin as a
userplugin (`vencord/panePopout/`), builds it, and points Vesktop at that build
("Vencord Location"), with PanePopout enabled. Quit Vesktop first (tray > Quit):
it writes its settings back on exit, so the installer only changes them while
it's closed. If it's running, the build still happens and the installer tells
you how to finish by hand.

While Vesktop uses this build, Vencord doesn't update itself: re-run
`./install.sh vesktop` to update it. To go back to Vesktop's own Vencord, reset
Vencord Location in Settings > Vesktop Settings > Developer Options.

Run Discord or Vesktop, not both at once: their plugins share the helper's
message files.

Manual install: put `plugin/PanePopout.plugin.js` in your BetterDiscord plugins
folder, `bin/discord-panes` somewhere on your `PATH`, and bind
`discord-panes toggle` and `discord-panes help` to keys (see `hypr/`).

To start the helper at login (so the in-Discord `split` button works before
you've used a keybind), run `discord-panes daemon` from your Hyprland autostart.

## Keys

| key | does |
| --- | --- |
| `SUPER ALT D` | split Discord into panes / put it back together (opens Discord if it isn't running) |
| `SUPER ALT SHIFT D` | show / hide the help window (`?` in any pane too) |
| your focus keys | move between panes |
| `ALT TAB`, `ALT SHIFT TAB` | next / previous pane, left to right (Lua-config Hyprland) |
| close window | closing any pane puts Discord back together |
| `j` `k`, `g` `G` | move, jump to top / bottom (in panes) |
| Enter, `l` | open the server / channel / DM under the cursor |
| `/` | filter channels or DMs |
| `esc` | back to the chat input |
| `m` `d` `s` | mute, deafen, settings (user pane) |
| `o`, right-click | Discord's own right-click menu for the row under the cursor (in panes) |

Messages in the main window work from the keyboard too. Press `esc` in an empty
chat input to put a cursor on the newest message, then:

| key | does |
| --- | --- |
| `j` `k`, `g` `G` | move between messages, oldest loaded / newest |
| Enter, `l` | open the message's first link or attachment |
| `f` | label every link, image, reaction and button in the message; type a label to click it |
| `r` `e` `+` | reply, edit (your own), add a reaction |
| `o` | Discord's message menu (forward, pin, mark unread, delete, ...) |
| `y` `Y` | copy the text, copy a link to the message |
| `esc`, `i` | back to the chat input (or just start typing) |

If Discord isn't open, `SUPER ALT D` starts it. With both Discord and Vesktop
installed, the first press asks which one to use (through Omarchy's menu, or
walker, fuzzel, rofi or wofi) and remembers the answer in
`~/.config/discord-panes/config.json`. Change it with `discord-panes client`
(asks again) or `discord-panes client discord|vesktop`.

On a Lua-config Hyprland, `install.sh` also replaces Omarchy's `ALT TAB` (see
`hypr/alt-tab.lua`): while a Discord window is focused it goes through the
windows on that workspace by where they are on screen, left to right (top to
bottom within a column); anywhere else it does what Omarchy's does.

The help window lists every key per pane, including the friends page. The
`SUPER ALT ...` binds are only defaults; change them in your Hyprland config.

## Settings

Settings > Plugins > PanePopout:

- **Split on start** (on by default): split Discord into panes as soon as it has
  loaded and its window is showing (if it starts hidden in the tray, once you
  open it). Needs the helper running; `SUPER ALT D` starts the helper and, when
  Discord isn't running, opens it, so one press gets you a split Discord.
- **Follow the Omarchy theme** (on by default), described below.

Discord and the panes take their colours from, in order:

1. **Omarchy**, when it's installed and this is on: the current Omarchy theme's
   colours and monospace font, following theme changes live. With a palette
   theme such as system24 or midnight, the theme's layout stays and only its
   colours change; with any other theme, or none, Discord's own colours are
   replaced.
2. **Your custom theme** (BetterDiscord or Vencord), when Omarchy isn't there or
   this is off.
3. **Discord's own theme** otherwise. The panes then copy Discord's colours.

## How it works

- `plugin/PanePopout.plugin.js` (BetterDiscord) opens the pane windows (as
  Discord popouts), draws them, reads Discord's state through BetterDiscord's
  official Webpack API, and navigates.
- `vencord/panePopout/` is the same plugin for Vesktop: `index.ts` is a port of
  the BetterDiscord file using Vencord's APIs, and `native.ts` runs in Vesktop's
  main process to read and write the helper's message files (Vencord's page code
  can't touch files). It only accepts the fixed paths below.
- `bin/discord-panes` is the Hyprland side: it tiles the panes, sizes them,
  moves focus and answers the keybinds.
- The plugin doesn't run programs or open sockets, so the two exchange
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
- On the scrolling layout the panes and Discord are three columns of the tape
  (nav, channels over user, Discord), sized to fill the screen; when you come back
  to Discord from another window, the helper scrolls the panes back into view.
  Scrolling has to run to the right (the default `scrolling:direction`).
- When Discord's window floats, the panes float too: attached to its left side,
  as tall as it, with the group centred where Discord was. Move or resize Discord
  and the panes follow; docking puts Discord back unless you've moved it. With
  BetterDiscord the floating panes can't be narrower than Discord's popout
  minimum (320px), so nav comes out wide; Vesktop lifts that limit for the panes.
- Switching the workspace's layout while split re-splits Discord for the new one.
- A pane row's right-click menu (`o`) opens in the main window, next to the panes,
  and focus moves there until it closes (it stays there if your choice opened a
  dialog or settings). `j` `k` move through it, `l` opens a submenu or picks the
  item, `h` backs out, `q` or `esc` closes it; the arrow keys and Enter work too. The menu comes from Discord's own sidebar, which stays
  loaded but invisible while split, so rows Discord itself doesn't list (e.g.
  channels you haven't opted into) have no menu.
- Discord changes its internals often; if a pane stops updating, check
  `discord-panes diag` and open an issue.

## About this project

Built with AI assistance (Anthropic's Claude), designed and tested by
[yoboogs](https://github.com/yoboogs). Because of that it isn't submitted to the
official BetterDiscord addon store, whose guidelines require plugins to be
written primarily by their author.

## License

[MIT](LICENSE)
