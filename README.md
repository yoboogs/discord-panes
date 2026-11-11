# discord-panes

**Discord as tiled Hyprland windows, driven from the keyboard.**

discord-panes splits Discord's sidebar out of its window. The server list, the
channel list and your user panel each become their own Hyprland window, tiled
next to the chat like any other app, and you move between them with your usual
window keys:

```
 nav | channels | chat
     |----------|
     | user     |
```

It's a plugin for [BetterDiscord](https://betterdiscord.app) or
[Vesktop](https://vesktop.dev), plus a small helper that tiles the windows. It
was made for [Omarchy](https://omarchy.org) and works on any
[Hyprland](https://hypr.land) setup.

- **Real windows.** The panes tile, focus, resize and close like any other window.
  The chat stays Discord's own, so the message box, menus and dialogs all work.
- **Keyboard first.** Use `j` `k` and Enter in the panes, and `o` to open
  Discord's own right-click menus. Messages and the friends list work from the
  keyboard too.
- **One key.** `SUPER ALT D` opens Discord and splits it, or puts it back
  together.
- **Looks native.** The panes are styled after the
  [system24](https://github.com/refact0r/system24) theme and use your theme's
  colours. On Omarchy, Discord follows the Omarchy theme live.
- **Any layout.** It works with dwindle and scrolling, and with Discord floating.

## Install

You need Hyprland, Python 3, and Discord with BetterDiscord or Vesktop.

```sh
git clone https://github.com/yoboogs/discord-panes
cd discord-panes
./install.sh            # Discord with BetterDiscord
./install.sh vesktop    # or Vesktop
```

The installer:

- puts the plugin in place;
- installs the helper as `~/.local/bin/discord-panes` and starts it;
- adds the keybindings to `~/.config/hypr/bindings.lua`, or prints them for a
  classic `hyprland.conf`.

Run it again to update.

- **BetterDiscord:** enable **PanePopout** under Settings > Plugins.
- **Vesktop:** quit Vesktop first (tray > Quit). Vencord can't load plugins at
  runtime, so the installer builds the latest Vencord with the plugin included
  (this needs `git` and `node`) and points Vesktop at that build. That build
  doesn't update itself, so re-run the installer to update Vencord. To go back,
  reset Vencord Location under Settings > Vesktop Settings > Developer Options.

Then press `SUPER ALT D`.

## Use

`SUPER ALT D` splits Discord into panes and puts it back together. If Discord
isn't running, it opens it, and it splits as soon as it has loaded. With both
Discord and Vesktop installed, the first press asks which one to use;
`discord-panes client` changes that choice later. Closing any pane also puts
Discord back together.

| key | does |
| --- | --- |
| your focus keys, `ALT TAB` | move between panes (`ALT TAB` goes left to right) |
| `j` `k`, `g` `G` | move, jump to top / bottom |
| Enter, `l` | open the server, channel or DM |
| `o`, right-click | Discord's right-click menu for it (`j` `k` `l` `h` `q` inside the menu) |
| `/` | filter channels or DMs |
| `m` `d` `s` | mute, deafen, settings (user pane) |
| `esc` | back to the chat input |
| `?`, `SUPER ALT SHIFT D` | every key, per pane |

The keys work in the main window too:

- **Messages:** in an empty chat input, `esc` puts a cursor on the newest message.
  Then `j` `k` move, `r` replies, `e` edits, `+` reacts, `f` labels every link and
  button to click, `y` copies, and `o` opens the message menu.
- **Friends page:** `j` `k` move through the list and `o` opens a friend's menu.
  The help window lists the rest.

The `SUPER ALT` keys are only defaults; change them in your Hyprland config.
`ALT TAB` is set up only on Lua-config Hyprland, where it replaces Omarchy's
binding (`hypr/alt-tab.lua`). It goes left to right while Discord is focused
and does what Omarchy's does everywhere else.

## Settings

These are under Settings > Plugins > PanePopout:

- **Split on start** (on): split Discord as soon as it opens.
- **Follow the Omarchy theme** (on): Discord and the panes take the current
  Omarchy theme's colours and font, live. With this off, or without Omarchy,
  they use your BetterDiscord or Vencord theme, or Discord's own.

Split on start needs the helper running. `SUPER ALT D` starts it, but if you
open Discord another way, start it at login instead. On Omarchy, add
`o.launch_on_start(os.getenv("HOME") .. "/.local/bin/discord-panes daemon")` to
`~/.config/hypr/autostart.lua`.

## How it works

The plugin opens each pane as a Discord popout window, then draws it itself
from Discord's own data. The helper (`bin/discord-panes`) is the Hyprland side:
it tiles and sizes the windows, moves focus and handles the keys. The plugin
doesn't run programs or open sockets, so the two talk through small JSON files
in `$XDG_RUNTIME_DIR/discord-panes/`. Those messages are a fixed set of
actions, and nothing in them is run as code.

The plugin makes no network requests of its own beyond Discord's CDN, for icons
and avatars. It only stores its settings and UI state: collapsed categories and
open folders.

## Known limits

- Run Discord or Vesktop, not both at once, because their plugins share the
  helper's message files.
- Discord won't draw a popout smaller than about 320×200, so the user pane is
  200px tall. With BetterDiscord, floating panes can't be narrower than 320px;
  Vesktop lifts that limit.
- The scrolling layout has to scroll to the right (the default).
- A pane's right-click menu opens in the main window, next to the panes. Rows
  that Discord's own sidebar doesn't show, such as channels you haven't opted
  into, have no menu.
- Each pane loads a Discord popout page, which costs some memory.
- Discord changes its internals often. If something stops working, run
  `discord-panes diag`, which prints a health report without names or
  messages, and open an issue.

## About this project

Built with AI assistance (Anthropic's Claude), designed and tested by
[yoboogs](https://github.com/yoboogs). Because of that it isn't submitted to the
official BetterDiscord addon store, whose guidelines require plugins to be
written primarily by their author.

## License

[MIT](LICENSE)
