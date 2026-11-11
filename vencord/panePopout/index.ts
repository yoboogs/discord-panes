/*
 * PanePopout for Vesktop (Vencord userplugin).
 *
 * Splits Discord into tiled Hyprland windows (nav, channels, user) beside the main chat
 * window, keyboard-driven, styled like the system24 theme and optionally following the
 * Omarchy theme. Needs Hyprland and the discord-panes helper from
 * https://github.com/yoboogs/discord-panes.
 *
 * This is the Vencord port of plugin/PanePopout.plugin.js (BetterDiscord). The pane drawing
 * and keys are the same; what differs is the plumbing: Discord internals come from Vencord's
 * webpack helpers, settings from Vencord's plugin settings, and file access (the helper's
 * message files, the Omarchy theme) goes through native.ts in the main process.
 */

import { definePluginSettings, Settings as VencordSettings } from "@api/Settings";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { findStore } from "@webpack";
import { FluxDispatcher, NavigationRouter, showToast } from "@webpack/common";

const Native = VencordNative.pluginHelpers.PanePopout as PluginNative<typeof import("./native")>;

const VERSION = "1.2.1";
const PANES = ["nav", "channels", "user"]; // the helper tiles them in this order

const settings = definePluginSettings({
    followOmarchy: {
        type: OptionType.BOOLEAN,
        description: "Follow the Omarchy theme: recolour Discord (and the panes) with the current Omarchy theme's colours and monospace font, live, over any Vencord theme's colours. Without Omarchy, your Vencord theme or Discord's own is used.",
        default: true,
        onChange: () => panes?.applyOmarchy(true),
    },
    splitOnStart: {
        type: OptionType.BOOLEAN,
        description: "Split into panes when Discord starts, once it has loaded and its window is showing. Needs the discord-panes helper running (SUPER+ALT+D starts it, and opens Vesktop if it isn't running).",
        default: true,
    },
    // UI state, not shown in the settings page
    collapsed: { type: OptionType.CUSTOM, default: [] as string[] },
    openFolders: { type: OptionType.CUSTOM, default: [] as string[] },
    resplitAt: { type: OptionType.CUSTOM, default: 0 },
});

// Theme variables copied from the main window so the panes match system24 (or any theme).
const THEME_VARS = [
    "--bg-1", "--bg-2", "--bg-3", "--bg-4", "--text-0", "--text-1", "--text-2", "--text-3", "--text-4", "--text-5",
    "--hover", "--active", "--border", "--border-light", "--border-hover", "--border-thickness", "--gap",
    "--accent-1", "--accent-2", "--accent-3", "--accent-new", "--online", "--idle", "--dnd", "--offline",
    "--label-color", "--label-hover-color", "--label-font-weight", "--background-base-low", "--background-base-lower",
    "--text-muted", "--text-normal", "--brand-360", "--border-hover-transition", "--list-item-transition", "--red-2",
];

// Without a palette theme (system24, midnight, ...) the palette variables above don't exist,
// so the panes take Discord's own colours instead: first variable found wins.
const NATIVE_FALLBACK: Record<string, string[]> = {
    "--bg-4": ["--background-base-low", "--background-primary"],
    "--bg-3": ["--background-base-lowest", "--background-tertiary"],
    "--bg-2": ["--background-mod-normal", "--background-secondary"],
    "--bg-1": ["--background-mod-strong", "--background-modifier-selected"],
    "--text-0": ["--badge-text-default", "--white"],
    "--text-1": ["--text-strong", "--header-primary"],
    "--text-2": ["--text-strong", "--header-primary"],
    "--text-3": ["--text-default", "--text-normal"],
    "--text-4": ["--channels-default", "--interactive-normal", "--text-subtle"],
    "--text-5": ["--text-muted"],
    "--hover": ["--background-mod-subtle", "--background-modifier-hover"],
    "--active": ["--background-mod-normal", "--background-modifier-selected"],
    "--border": ["--border-subtle", "--border-normal"],
    "--border-light": ["--border-muted", "--border-subtle"],
    "--border-hover": ["--border-strong", "--text-muted"],
    "--accent-1": ["--text-brand", "--brand-500"],
    "--accent-2": ["--text-brand", "--brand-500"],
    "--accent-3": ["--text-brand", "--brand-500"],
    "--accent-new": ["--status-danger", "--red-400"],
    "--online": ["--status-online", "--green-360"],
    "--idle": ["--status-warning", "--yellow-300"],
    "--dnd": ["--status-danger", "--red-400"],
    "--offline": ["--text-muted"],
};

// Discord's own colour variables, expressed in the palette. Following Omarchy without a palette
// theme, this is what recolours the main window (a palette theme does this mapping itself).
const NATIVE_MAP: [string, string][] = [
    // surfaces
    ["--background-base-lowest", "var(--bg-4)"], ["--background-base-lower", "var(--bg-4)"], ["--background-base-low", "var(--bg-4)"],
    ["--background-primary", "var(--bg-4)"], ["--background-secondary", "var(--bg-4)"], ["--background-tertiary", "var(--bg-4)"],
    ["--background-secondary-alt", "var(--bg-3)"], ["--background-accent", "var(--bg-2)"], ["--background-floating", "var(--bg-3)"],
    ["--background-surface-high", "var(--bg-3)"], ["--background-surface-higher", "var(--bg-3)"], ["--background-surface-highest", "var(--bg-3)"],
    ["--bg-surface-raised", "var(--bg-3)"], ["--bg-surface-overlay", "var(--bg-3)"], ["--card-background-default", "var(--bg-3)"],
    ["--chat-background-default", "var(--bg-4)"], ["--home-background", "var(--bg-4)"], ["--background-code", "var(--bg-3)"],
    ["--app-frame-background", "var(--bg-3)"], ["--app-frame-border", "var(--border)"],
    ["--modal-background", "var(--bg-4)"], ["--modal-footer-background", "var(--bg-3)"],
    ["--background-mod-subtle", "var(--hover)"], ["--background-mod-muted", "var(--hover)"],
    ["--background-mod-normal", "var(--bg-2)"], ["--background-mod-strong", "var(--bg-1)"],
    ["--background-modifier-hover", "var(--hover)"], ["--background-modifier-selected", "var(--active)"],
    ["--background-modifier-active", "var(--active)"], ["--background-modifier-accent", "var(--border-light)"],
    ["--interactive-background-hover", "var(--hover)"], ["--interactive-background-active", "var(--active)"],
    ["--interactive-background-selected", "var(--active)"],
    ["--message-background-hover", "var(--message-hover)"], ["--background-message-hover", "var(--message-hover)"],
    ["--user-profile-overlay-background", "var(--bg-4)"], ["--user-profile-toolbar-background", "var(--bg-3)"],
    ["--user-profile-border", "var(--border)"],
    // input
    ["--channeltextarea-background", "var(--bg-3)"], ["--input-background-default", "var(--bg-3)"],
    ["--input-border-default", "var(--border-light)"], ["--input-border-hover", "var(--border)"], ["--input-border-active", "var(--accent-2)"],
    ["--input-text-default", "var(--text-3)"], ["--input-placeholder-text-default", "var(--text-5)"],
    ["--channel-text-area-placeholder", "var(--text-5)"],
    ["--scrollbar-auto-thumb", "var(--bg-1)"], ["--scrollbar-auto-track", "transparent"],
    ["--scrollbar-thin-thumb", "var(--bg-1)"], ["--scrollbar-thin-track", "transparent"],
    // borders
    ["--border-subtle", "var(--border)"], ["--border-normal", "var(--border)"], ["--border-strong", "var(--border)"],
    ["--border-muted", "var(--border-light)"], ["--border-focus", "var(--border-hover)"],
    // text and icons
    ["--text-default", "var(--text-3)"], ["--text-normal", "var(--text-3)"], ["--text-strong", "var(--text-2)"],
    ["--header-primary", "var(--text-2)"], ["--header-secondary", "var(--text-4)"], ["--text-subtle", "var(--text-4)"],
    ["--text-muted", "var(--text-5)"], ["--chat-text-muted", "var(--text-5)"], ["--text-link", "var(--accent-1)"],
    ["--text-brand", "var(--accent-1)"], ["--channels-default", "var(--text-4)"], ["--channel-icon", "var(--text-4)"],
    ["--textbox-markdown-syntax", "var(--text-4)"],
    ["--text-feedback-critical", "var(--red-1)"], ["--text-feedback-positive", "var(--green-1)"],
    ["--text-feedback-warning", "var(--yellow-1)"], ["--text-feedback-info", "var(--accent-1)"],
    ["--icon-default", "var(--text-4)"], ["--icon-strong", "var(--text-3)"], ["--icon-subtle", "var(--text-4)"],
    ["--icon-muted", "var(--text-5)"], ["--icon-link", "var(--text-4)"],
    ["--interactive-normal", "var(--text-4)"], ["--interactive-hover", "var(--text-3)"],
    ["--interactive-active", "var(--text-2)"], ["--interactive-muted", "var(--text-5)"],
    ["--interactive-icon-default", "var(--text-4)"], ["--interactive-icon-hover", "var(--text-3)"], ["--interactive-icon-active", "var(--text-3)"],
    ["--interactive-text-default", "var(--text-4)"], ["--interactive-text-hover", "var(--text-3)"], ["--interactive-text-active", "var(--text-2)"],
    // accent, buttons, badges
    ["--brand-260", "var(--accent-1)"], ["--brand-360", "var(--accent-2)"], ["--brand-500", "var(--accent-2)"],
    ["--background-brand", "var(--accent-2)"], ["--control-brand-foreground", "var(--accent-2)"],
    ["--control-primary-background-default", "var(--accent-3)"], ["--control-primary-background-hover", "var(--accent-4)"],
    ["--control-primary-background-active", "var(--accent-5)"],
    ["--control-primary-text-default", "var(--text-0)"], ["--control-primary-text-hover", "var(--text-0)"], ["--control-primary-text-active", "var(--text-0)"],
    ["--control-primary-icon-default", "var(--text-0)"], ["--control-primary-icon-hover", "var(--text-0)"], ["--control-primary-icon-active", "var(--text-0)"],
    ["--control-secondary-background-default", "var(--bg-2)"], ["--control-secondary-background-hover", "var(--bg-1)"],
    ["--control-secondary-background-active", "var(--bg-1)"],
    ["--control-secondary-text-default", "var(--text-3)"], ["--control-secondary-text-hover", "var(--text-2)"], ["--control-secondary-text-active", "var(--text-2)"],
    ["--control-secondary-icon-default", "var(--text-3)"], ["--control-secondary-icon-hover", "var(--text-2)"], ["--control-secondary-icon-active", "var(--text-2)"],
    ["--badge-background-default", "var(--accent-2)"], ["--badge-notification-background", "var(--accent-new)"],
    ["--badge-text-default", "var(--text-0)"], ["--background-feedback-notification", "var(--accent-new)"],
    ["--mention-background", "color-mix(in oklab, var(--accent-2), transparent 85%)"], ["--mention-foreground", "var(--accent-1)"],
    ["--message-mentioned-background-default", "color-mix(in oklab, var(--accent-2), transparent 92%)"],
    ["--message-mentioned-background-hover", "color-mix(in oklab, var(--accent-2), transparent 88%)"],
    ["--message-highlight-background-default", "color-mix(in oklab, var(--text-3), transparent 92%)"],
    ["--message-highlight-background-hover", "color-mix(in oklab, var(--text-3), transparent 88%)"],
    ["--reaction-background-default", "var(--hover)"], ["--reaction-background-hover", "var(--active)"],
    ["--reaction-background-reacted-default", "color-mix(in oklab, var(--accent-2), transparent 80%)"],
    ["--reaction-border-reacted-default", "var(--accent-2)"], ["--reaction-text-default", "var(--text-3)"],
    ["--switch-background-default", "var(--bg-2)"], ["--switch-background-selected-default", "var(--accent-2)"],
    ["--checkbox-background-selected-default", "var(--accent-2)"], ["--radio-background-selected-default", "var(--accent-2)"],
    // status
    ["--status-online", "var(--online)"], ["--status-positive", "var(--green-2)"], ["--status-speaking", "var(--green-2)"],
    ["--status-danger", "var(--red-2)"], ["--status-warning", "var(--yellow-2)"],
    ["--icon-status-online", "var(--online)"], ["--icon-status-idle", "var(--idle)"], ["--icon-status-dnd", "var(--dnd)"],
    ["--icon-status-offline", "var(--offline)"], ["--text-status-online", "var(--online)"], ["--text-status-idle", "var(--idle)"],
    ["--text-status-dnd", "var(--dnd)"], ["--text-status-offline", "var(--offline)"], ["--icon-voice-muted", "var(--accent-new)"],
    ["--red-400", "var(--red-2)"], ["--red-500", "var(--red-3)"], ["--green-360", "var(--green-2)"], ["--yellow-300", "var(--yellow-2)"],
    // fonts
    ["--font-primary", "var(--font), 'gg sans', 'Noto Sans', sans-serif"], ["--font-display", "var(--font), 'gg sans', 'Noto Sans', sans-serif"],
    ["--font-code", "var(--code-font), 'gg mono', monospace"],
];
// Discord redefines its colours on nested elements that carry a theme class (layers, popouts),
// so the mapping has to land on those too.
const NATIVE_SELECTOR = ":root:root:root, :root :is(.theme-dark, .theme-darker, .theme-midnight, .theme-light):not(.custom-user-profile-theme)";

// The cheat sheet shown in the help pane. Keep in sync with onKey() and the Hyprland binds.
const HELP_SECTIONS: [string, [string, string][]][] = [
    ["anywhere (hyprland)", [
        ["super alt d", "split discord into panes / put it back together"],
        ["super alt shift d", "show / hide this help"],
        ["super ← → ↑ ↓", "move between panes"],
        ["super shift ← → ↑ ↓", "swap panes around"],
        ["super w", "close a pane (puts discord back together)"],
        ["alt tab  alt shift tab", "next / previous pane, left to right"],
    ]],
    ["in any pane", [
        ["j k  ↓ ↑", "move the cursor"],
        ["g G  home end", "jump to top / bottom"],
        ["enter l → space", "open what's under the cursor"],
        ["esc", "back to the chat input"],
        ["o  right-click", "discord's own right-click menu for what's under the cursor"],
        ["j k l h  q", "in that menu (or any discord menu): move, open / pick, back, close"],
        ["?", "show / hide this help"],
    ]],
    ["nav", [
        ["enter", "open server, then move to channels"],
        ["enter on folder", "open / close the folder"],
        ["click", "open server (focus stays in nav)"],
    ]],
    ["channels", [
        ["enter", "open channel or dm, then type in chat"],
        ["enter on friends", "open the friends page and move to it"],
        ["enter on category", "collapse / expand it"],
        ["/", "filter channels or dms (enter opens first match, esc clears)"],
        ["h ←", "back to nav"],
    ]],
    ["friends page (main window)", [
        ["j k  ↓ ↑", "move between friends; k at the top goes to the tab bar"],
        ["h l  ← →", "in the tab bar: cycle tabs (j or enter drops back to the list)"],
        ["enter l", "message the friend under the cursor"],
        ["o", "more options (discord's menu)"],
        ["y n", "accept / ignore a friend request"],
        ["[ ]  1-7", "previous / next tab, or jump to a tab"],
        ["a", "add friend"],
        ["/", "search friends (esc leaves the search)"],
        ["h ←", "back to the channels pane"],
    ]],
    ["messages (main window)", [
        ["esc", "in an empty chat input: put a cursor on the newest message"],
        ["j k  ↓ ↑", "move between messages"],
        ["g G", "oldest loaded / newest (jumps back to the present)"],
        ["enter l", "open the message's first link or attachment"],
        ["f", "label every link, image, reaction and button in the message; press a label to click it"],
        ["r", "reply"],
        ["e", "edit (your own messages)"],
        ["+", "add a reaction"],
        ["o", "more options (discord's menu: forward, pin, mark unread, delete, ...)"],
        ["y Y", "copy the message's text / a link to it"],
        ["esc i", "back to the chat input (or just start typing)"],
        ["h ←", "back to the channels pane"],
    ]],
    ["user", [
        ["m", "mute / unmute"],
        ["d", "deafen / undeafen"],
        ["s", "open discord settings"],
        ["enter on your name", "discord's profile menu: status, edit profile, switch accounts, ..."],
    ]],
];
const HELP_HTML = HELP_SECTIONS.map(([title, keys]) =>
    `<section><h3>${title}</h3>${keys.map(([k, d]) => `<div class="hk"><span class="keys">${k.split("  ").map(g => `<kbd>${g}</kbd>`).join(" ")}</span><span class="desc">${d}</span></div>`).join("")}</section>`
).join("") + "<p class=\"foot\">esc, q or ? to close</p>";

const CHANNEL = { TEXT: 0, VOICE: 2, CATEGORY: 4, ANNOUNCEMENT: 5, STAGE: 13, FORUM: 15, MEDIA: 16 };

const ICONS: Record<string, string> = {
    folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    dm: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    mic: '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>',
    headphones: '<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    slash: '<line x1="2" y1="2" x2="22" y2="22"/>',
    hangup: '<path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"/><line x1="23" y1="1" x2="1" y2="23"/>',
};
const svg = (name: string, extra = "") =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}${extra}</svg>`;

const esc = (s: any) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
function safe<T>(fn: () => T, fallback: T): T { try { const v = fn(); return v === undefined ? fallback : v; } catch { return fallback; } }

// ---------------------------------------------------------------------------
// small stand-ins for the BetterDiscord APIs the original uses
// ---------------------------------------------------------------------------
function addStyle(id: string, css: string) {
    removeStyle(id);
    const el = document.createElement("style");
    el.id = `pp-style-${id}`;
    el.textContent = css;
    document.head.appendChild(el);
}
function removeStyle(id: string) { document.getElementById(`pp-style-${id}`)?.remove(); }
function toast(text: string, variant: "default" | "success" | "critical" = "default") {
    try { showToast({ text: `PanePopout: ${text}`, variant }); } catch { console.warn("[PanePopout]", text); }
}
const post = (msg: Record<string, unknown>) => { Native.post(msg).catch(() => { }); };
const copyText = (text: string): Promise<void> => {
    const native = (window as any).DiscordNative?.clipboard;
    return native?.copy ? Promise.resolve(native.copy(text)) : navigator.clipboard.writeText(text);
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Omarchy theme: map the current theme's colors.toml onto the Discord theme's palette
// variables (system24/midnight names), so Discord and the panes follow Omarchy.
// ---------------------------------------------------------------------------
type Omarchy = { c: Record<string, string>; font: string | null; key: string; };
async function readOmarchy(): Promise<Omarchy | null> {
    const raw = await Native.readOmarchy().catch(() => null);
    if (!raw) return null;
    const c: Record<string, string> = {};
    for (const line of raw.colors.split("\n")) {
        const m = line.match(/^\s*([a-z_]+)\s*=\s*"([^"]*)"/);
        if (m) c[m[1]] = m[2];
    }
    if (!c.background || !c.foreground) return null;
    const { font } = raw; // Omarchy's monospace font, worked out in native.ts
    return { c, font, key: raw.colors + "\n" + (font || "") };
}

function omarchyCss({ c, font }: Omarchy, native: boolean) {
    const mix = (a: string, b: string, pct: number) => `color-mix(in oklab, ${a}, ${b} ${pct}%)`;
    const bg = c.background, fg = c.foreground, sel = c.selection || mix(bg, fg, 20);
    const accent = c.accent || c.blue, red = c.red, border = c.active_border_color || accent;
    const shades = (base: string, bright?: string) => [bright || base, base, mix(base, bg, 12), mix(base, bg, 24), mix(base, bg, 36)];
    const ramp = (name: string, base: string, bright?: string) => shades(base, bright).map((v, i) => `--${name}-${i + 1}:${v};`).join("");
    const fam = font ? `"${font.replace(/"/g, "")}", monospace` : "monospace";
    const vars =
        `--bg-4:${bg};--bg-3:${c.dark_background || mix(bg, "black", 20)};--bg-2:${mix(bg, fg, 8)};--bg-1:${sel};` +
        `--hover:${mix(sel, "transparent", 45)};--active:${sel};--active-2:${mix(sel, fg, 10)};--message-hover:var(--hover);` +
        `--text-0:${bg};--text-1:${fg};--text-2:${fg};--text-3:${mix(fg, bg, 15)};--text-4:${mix(fg, bg, 35)};--text-5:${c.muted || mix(fg, bg, 55)};` +
        `--accent-1:${accent};--accent-2:${accent};--accent-3:${accent};--accent-4:${mix(accent, fg, 15)};--accent-5:${mix(accent, bg, 15)};--accent-new:${red};` +
        `--online:${c.green};--idle:${c.yellow};--dnd:${red};--offline:${c.muted || mix(fg, bg, 55)};--streaming:${c.magenta};` +
        `--border-light:${mix(sel, "transparent", 50)};--border:${sel};--border-hover:${border};--button-border:${mix(fg, "transparent", 88)};` +
        ramp("red", red, c.bright_red) + ramp("green", c.green, c.bright_green) + ramp("blue", c.blue, c.bright_blue) +
        ramp("yellow", c.yellow, c.bright_yellow) + ramp("purple", c.magenta, c.bright_magenta) +
        `--font:${fam};--code-font:${fam};`;
    // :root:root / html body outrank the theme's own :root / body declarations.
    return `:root:root, html body { ${vars} } html body { font-weight: 400; letter-spacing: normal; }` +
        (native ? `${NATIVE_SELECTOR} { ${NATIVE_MAP.map(([k, v]) => `${k}:${v};`).join("")} }` : "");
}

// Which Vencord themes are on; when this changes the theme CSS changes too.
const themeSig = () => JSON.stringify([VencordSettings.enabledThemes, VencordSettings.themeLinks, VencordSettings.useQuickCss]);

let panes: Panes | null = null;

export default definePlugin({
    name: "PanePopout",
    description: "Splits Discord into tiled Hyprland windows (nav, channels, user) beside the main chat window, keyboard-driven, styled like the system24 theme and optionally following the Omarchy theme. Needs Hyprland and the discord-panes helper.",
    authors: [{ name: "yoboogs", id: 0n }],
    settings,

    start() {
        panes = new Panes();
        panes.start();
    },
    stop() {
        panes?.stop();
        panes = null;
    },
    // called from native.ts when the helper drops a message in the inbox
    onInbox() { panes?.pollInbox(); },
});

type PaneWin = { win: Window; doc: Document | null; box?: HTMLElement; list?: HTMLElement; header?: HTMLElement | null; filter?: HTMLInputElement | null; };

class Panes {
    wins: Record<string, PaneWin> = {};
    cursor: Record<string, number | null> = {};
    items: Record<string, any[]> = {};
    filterText = "";
    collapsed = new Set<string>();
    openFolders = new Set<string>();
    geom: Record<string, { w: number; h: number; }> = {}; // the window's real tiled size, from the helper
    S: Record<string, any> = {};
    omarchyKey: string | null = null;
    lastTheme = "";
    docking = false;
    stopped = false;
    polling = false;
    pollAgain = false;
    poller: any; themeTimer: any; renderTimer: any = null;
    paletteTheme = false; // the active theme defines the palette (system24, midnight, ...) and maps it onto Discord
    seenThemeSig: string | null = null;
    themeChecks: any[] = [];
    unsubscribe?: () => void;
    splitBtn?: HTMLElement;
    chat: Record<string, any> = {}; // stores for the message keys (kept out of S: pane renders don't need them)
    msgCursor: string | null = null; // DOM id of the message under the cursor: chat-messages-<channel>-<message>
    hovered: HTMLElement | null = null;
    hints: { els: HTMLElement[]; box: HTMLElement; } | null = null;
    menuWatch: any = null; // paneMenu: waits for Discord's menu to close
    menuBusy = false;
    autoTimer: any = null; // autoSplit: waits for Discord to be ready
    onMainMove = (e: MouseEvent) => { if (e.movementX || e.movementY) this.mouseIdle(false); };
    onMainWake = () => this.mouseIdle(false);
    onMainKey = (e: KeyboardEvent) => {
        this.mouseIdle(true);
        if (this.menuKey(e) || this.popoutKey(e)) return;
        if (document.querySelector('[class*="peopleColumn_"]')) return this.friendsKey(e);
        this.messagesKey(e);
    };
    onMainFocus = (e: FocusEvent) => {
        // typing again (chat input, an edit box) ends the message cursor
        if ((e.target as HTMLElement)?.matches?.('[role="textbox"]')) this.exitMessages();
    };
    onMainMouse = (e: MouseEvent) => {
        this.cancelHints();
        if (!(e.target as HTMLElement)?.closest?.('[class*="layerContainer_"]')) this.exitMessages();
    };

    // -------------------------------------------------------------------------
    // lifecycle
    // -------------------------------------------------------------------------
    start() {
        this.collapsed = new Set(settings.store.collapsed || []);
        this.openFolders = new Set(settings.store.openFolders || []);
        this.applyOmarchy(true);
        this.loadModules();
        this.subscribe();
        this.addSplitButton();
        document.addEventListener("keydown", this.onMainKey, true);
        document.addEventListener("focusin", this.onMainFocus, true);
        document.addEventListener("mousedown", this.onMainMouse, true);
        window.addEventListener("mousemove", this.onMainMove, true);
        window.addEventListener("mousedown", this.onMainWake, true);
        window.addEventListener("wheel", this.onMainWake, { capture: true, passive: true });
        addStyle("mouse", MOUSE_IDLE_CSS);
        this.mouseIdle(true);
        addStyle("friends", MAIN_CURSOR_CSS);
        // drop stale commands from before a reload, then listen
        Native.takeInbox().catch(() => { }).finally(() => {
            if (this.stopped) return;
            Native.watchInbox().catch(() => { });
            this.poller = setInterval(() => this.pollInbox(), 400);
        });
        this.themeTimer = setInterval(() => { this.applyOmarchy(); this.syncTheme(); }, 2000);
        this.writeDiag();
        // Split on start (the setting), or again after a reload of the plugin while it was split.
        const { resplitAt } = settings.store;
        if (resplitAt) settings.store.resplitAt = 0;
        if (settings.store.splitOnStart || (resplitAt && Date.now() - resplitAt < 10000)) this.autoSplit();
    }

    stop() {
        this.stopped = true;
        // If the plugin is being reloaded (e.g. after an update) while split, split again on start.
        if (this.isSplit()) settings.store.resplitAt = Date.now();
        this.dockAll();
        post({ action: "docked" });
        clearInterval(this.poller);
        clearInterval(this.themeTimer);
        clearInterval(this.menuWatch);
        clearTimeout(this.autoTimer);
        this.themeChecks.forEach(clearTimeout);
        clearTimeout(this.renderTimer); this.renderTimer = null;
        Native.unwatchInbox().catch(() => { });
        this.unsubscribe?.();
        this.splitBtn?.remove();
        document.removeEventListener("keydown", this.onMainKey, true);
        document.removeEventListener("focusin", this.onMainFocus, true);
        document.removeEventListener("mousedown", this.onMainMouse, true);
        window.removeEventListener("mousemove", this.onMainMove, true);
        window.removeEventListener("mousedown", this.onMainWake, true);
        window.removeEventListener("wheel", this.onMainWake, true);
        this.mouseIdle(false);
        removeStyle("mouse");
        this.exitMessages();
        removeStyle("friends");
        document.querySelectorAll("[data-pp-cursor]").forEach(el => el.removeAttribute("data-pp-cursor"));
        removeStyle("omarchy");
        removeStyle("main");
        this.omarchyKey = null;
    }

    // Split as soon as Discord is ready: its sidebar is drawn, its window is showing (not hidden
    // in the tray) and the helper is running (the helper does the tiling). Waits as long as the
    // window stays hidden; gives up if there's no helper within two minutes.
    autoSplit() {
        const t0 = Date.now();
        const tick = async () => {
            this.autoTimer = null;
            if (this.stopped || this.isSplit()) return;
            const alive = await Native.helperAlive().catch(() => false);
            if (this.stopped) return;
            if (alive && document.querySelector('nav[class*="guilds_"]') && document.visibilityState === "visible") {
                this.autoTimer = setTimeout(() => { if (!this.stopped && !this.isSplit()) post({ action: "split" }); }, 800); // let the window settle
                return;
            }
            if (alive || Date.now() - t0 < 120000) this.autoTimer = setTimeout(tick, 500);
        };
        this.autoTimer = setTimeout(tick, 500);
    }

    // Theme order: Omarchy (when found and the setting is on), else the custom Vencord theme,
    // else Discord's own. Following Omarchy sets the palette variables; unless the active theme
    // maps that palette onto Discord itself, Discord's own colour variables are set as well, so
    // the main window follows Omarchy with any theme or none. Live: rechecked every 2s.
    async applyOmarchy(force?: boolean) {
        this.checkThemes();
        const o = settings.store.followOmarchy ? await readOmarchy() : null;
        if (this.stopped) return;
        if (!o || !settings.store.followOmarchy) {
            if (this.omarchyKey !== null || force) { removeStyle("omarchy"); this.omarchyKey = null; this.syncTheme(true); }
            return;
        }
        const key = `${o.key}\n${this.paletteTheme}`;
        if (!force && key === this.omarchyKey) return;
        this.omarchyKey = key;
        addStyle("omarchy", omarchyCss(o, !this.paletteTheme));
        this.syncTheme(true);
    }

    // Does the active theme itself (not our Omarchy style) define the palette variables? Checked
    // with our style switched off for a moment, only when the enabled themes change, and again
    // a few times after since themes load their @imports late.
    detectPaletteTheme() {
        const el = document.getElementById("pp-style-omarchy") as HTMLStyleElement | null;
        if (el) el.disabled = true;
        const found = !!getComputedStyle(document.body).getPropertyValue("--bg-4").trim();
        if (el) el.disabled = false;
        return found;
    }

    checkThemes() {
        const sig = safe(themeSig, "");
        if (sig === this.seenThemeSig) return;
        this.seenThemeSig = sig;
        this.paletteTheme = this.detectPaletteTheme();
        this.themeChecks.forEach(clearTimeout);
        this.themeChecks = [1500, 5000, 15000].map(ms => setTimeout(() => {
            const found = this.detectPaletteTheme();
            if (found === this.paletteTheme) return;
            this.paletteTheme = found;
            this.applyOmarchy();
        }, ms));
    }

    themeMode() {
        if (this.omarchyKey !== null) return "omarchy";
        const cs = getComputedStyle(document.body);
        const custom = safe(() => VencordSettings.enabledThemes.length + VencordSettings.themeLinks.length, 0) > 0;
        return custom || cs.getPropertyValue("--bg-4").trim() ? "custom theme" : "discord";
    }

    // -------------------------------------------------------------------------
    // Discord internals
    // -------------------------------------------------------------------------
    loadModules() {
        const st = (n: string) => safe(() => findStore(n), null);
        this.S = {
            Guild: st("GuildStore"), SortedGuild: st("SortedGuildStore"), SelectedGuild: st("SelectedGuildStore"),
            SelectedChannel: st("SelectedChannelStore"), GuildChannel: st("GuildChannelStore"), Channel: st("ChannelStore"),
            ReadState: st("ReadStateStore"), GuildReadState: st("GuildReadStateStore"), User: st("UserStore"),
            PrivateSort: st("PrivateChannelSortStore"), Threads: st("ActiveJoinedThreadsStore"),
            GuildSettings: st("UserGuildSettingsStore"), Presence: st("PresenceStore"), Media: st("MediaEngineStore"),
            RTC: st("RTCConnectionStore"),
            ExpandedFolders: st("ExpandedGuildFolderStore"), CategoryCollapse: st("CategoryCollapseStore"),
        };
        this.chat = { Message: st("MessageStore"), PendingReply: st("PendingReplyStore") };
    }

    // Read-only health report for `discord-panes diag`: which Discord internals were found,
    // counts, pane sizes and theme values. No names, IDs or message content are recorded.
    async writeDiag() {
        const { S } = this;
        const methods = [
            ["SortedGuild", "getGuildFolders"], ["SelectedChannel", "getMostRecentSelectedTextChannelId"],
            ["GuildChannel", "getChannels"], ["PrivateSort", "getPrivateChannelIds"],
            ["Threads", "getActiveJoinedThreadsForGuild"], ["GuildReadState", "getMentionCount"],
            ["Media", "isSelfMute"], ["RTC", "getChannelId"],
        ];
        const cs = getComputedStyle(document.body);
        const diag = {
            version: VERSION,
            client: "vesktop",
            time: new Date().toISOString(),
            stores: Object.fromEntries(Object.entries(S).map(([k, v]) => [k, !!v])),
            transitionTo: typeof safe(() => NavigationRouter.transitionTo, null),
            methods: Object.fromEntries(methods.map(([st, m]) => [`${st}.${m}`, typeof S[st]?.[m]])),
            counts: {
                guilds: safe(() => S.Guild.getGuildCount(), null),
                folders: safe(() => S.SortedGuild.getGuildFolders().length, null),
                privateChannels: this.privateChannelIds().length,
            },
            userPanelButtonsFound: ["mute", "deafen", "settings"].map(n => [n, !!this.findPanelButton({ mute: /^(un)?mute$/i, deafen: /^(un)?deafen$/i, settings: /user settings/i }[n]!)]),
            friendsPage: { open: !!document.querySelector('[class*="peopleColumn_"]') },
            messages: await this.messageProbe(),
            split: Object.keys(this.wins),
            panes: Object.fromEntries(Object.entries(this.wins).map(([k, w]) => [k, w.doc ? {
                rows: (this.items[k] || []).length, tile: this.geom[k] || null, page: [w.win.innerWidth, w.win.innerHeight],
                box: w.box ? [w.box.clientWidth, w.box.clientHeight] : null,
            } : { loading: true }])),
            theme: {
                followOmarchy: settings.store.followOmarchy, omarchyFound: !!(await readOmarchy()),
                mode: this.themeMode(), paletteTheme: this.paletteTheme,
                discordVars: Object.fromEntries(["--background-base-low", "--background-base-lowest", "--text-default", "--app-frame-background", "--font-primary"].map(v => [v, cs.getPropertyValue(v).trim()])),
                vars: Object.fromEntries(["--bg-4", "--text-3", "--accent-2", "--border-hover"].map(v => [v, cs.getPropertyValue(v).trim()])),
                font: cs.fontFamily,
            },
        };
        Native.writeDiag(JSON.stringify(diag, null, 1)).catch(() => { });
    }

    subscribe() {
        const stores = Object.values(this.S).filter(s => s?.addChangeListener);
        const fn = () => this.scheduleRender();
        for (const s of stores) s.addChangeListener(fn);
        this.unsubscribe = () => { for (const s of stores) s.removeChangeListener(fn); };
    }

    go(p: string) {
        const t = safe(() => NavigationRouter.transitionTo, null);
        if (typeof t === "function") return t(p);
        toast("couldn't find Discord's navigation function", "critical");
    }

    // -------------------------------------------------------------------------
    // split / dock
    // -------------------------------------------------------------------------
    isSplit() { return PANES.some(p => this.wins[p]); }

    // Help: the helper floats and centres it; without the helper it just opens.
    async toggleHelp() {
        if (this.wins.help) { try { this.wins.help.win.close(); } catch { } return; }
        if (await Native.helperAlive().catch(() => false)) post({ action: "help" });
        else this.openPane("help");
    }

    // The split button and `discord-panes toggle` both go through the helper so it can
    // tile the windows. Without the helper the panes still open, just untiled.
    async requestToggle() {
        if (await Native.helperAlive().catch(() => false)) return post({ action: "toggle" });
        if (this.isSplit()) return this.dockAll();
        toast("the discord-panes helper isn't running, so the panes won't be tiled");
        for (const p of PANES) this.openPane(p);
    }

    addSplitButton() {
        const b = document.createElement("button");
        b.id = "pp-split";
        b.textContent = "split";
        b.title = "Split Discord into Hyprland panes (discord-panes toggle)";
        b.style.cssText = "position:fixed;bottom:4px;right:6px;z-index:99999;font:inherit;font-size:11px;padding:0 6px;" +
            "background:transparent;color:var(--text-5,#888);border:1px solid var(--border,#444);cursor:pointer;opacity:.6";
        b.onclick = () => this.requestToggle();
        document.body.appendChild(b);
        this.splitBtn = b;
    }

    openPane(pane: string) {
        if ((!PANES.includes(pane) && pane !== "help") || this.wins[pane]) return;
        // Vesktop (like Discord) only allows window.open for frame names starting with
        // DISCORD_ and a same-origin "/popout" URL.
        const win = window.open(`${location.origin}/popout`, `DISCORD_PANES_${pane}`, "width=320,height=600");
        if (!win) return toast(`couldn't open ${pane}`, "critical");
        this.wins[pane] = { win, doc: null };
        const t0 = Date.now();
        const wait = setInterval(() => {
            let ready = false;
            try { ready = win.document?.readyState === "complete" && !!win.document.body; } catch { }
            if (ready || Date.now() - t0 > 10000) {
                clearInterval(wait);
                if (!ready) return toast(`${pane} never loaded`, "critical");
                setTimeout(() => this.setupPane(pane, win), 300); // let the popout's own bootstrap settle
            }
        }, 50);
        if (PANES.includes(pane)) this.applyMainLayout(true);
    }

    dockAll() {
        this.docking = true;
        this.geom = {};
        for (const [pane, w] of Object.entries(this.wins)) { try { w.win.close(); } catch { } delete this.wins[pane]; }
        this.docking = false;
        this.applyMainLayout(false);
    }

    onPaneClosed(pane: string) {
        if (!this.wins[pane]) return;
        delete this.wins[pane];
        if (pane === "help") return post({ action: "help-closed" });
        if (this.docking) return;
        // Closing any pane (e.g. SUPER+W) ends the split and gives the main window its sidebar back.
        this.dockAll();
        post({ action: "docked" });
    }

    // While split, the main window drops its sidebar (nav, channels, user) and becomes
    // channel + chat + input.
    applyMainLayout(split: boolean) {
        removeStyle("main");
        if (!split) return;
        const nav = document.querySelector('nav[class*="guilds_"]');
        const sidebar = nav?.parentElement;
        const sidebarCls = [...(sidebar?.classList || [])].find(c => c.startsWith("sidebar_"));
        const page = [...(sidebar?.parentElement?.children || [])].find(el => [...el.classList].some(c => c.startsWith("page_")));
        const pageCls = [...(page?.classList || [])].find(c => c.startsWith("page_"));
        let css = "#pp-split{display:none!important}"; // the panes have their own controls
        // hidden, not display:none: Discord's lists keep rendering, so pane rows can open
        // their menus from there (paneMenu)
        const sw = sidebar?.offsetWidth || 360;
        if (sidebarCls) css += `.${sidebarCls}{position:fixed!important;left:0!important;top:0!important;height:100vh!important;` +
          `width:${sw}px!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important;z-index:-1!important}`;
        if (pageCls) css += `.${pageCls}{grid-column:1/-1!important}`;
        addStyle("main", css);
    }

    // -------------------------------------------------------------------------
    // inbox: fixed commands from the helper
    // -------------------------------------------------------------------------
    async pollInbox() {
        if (this.stopped) return;
        if (this.polling) { this.pollAgain = true; return; }
        this.polling = true;
        try {
            do {
                this.pollAgain = false;
                const msgs = await Native.takeInbox().catch(() => []);
                for (const msg of msgs) {
                    if (this.stopped) return;
                    try { this.handle(msg); } catch (e) { console.error("[PanePopout] command failed", msg, e); }
                }
            } while (this.pollAgain);
        } finally { this.polling = false; }
    }

    handle(msg: any) {
        switch (msg?.action) {
            case "open": return this.openPane(msg.pane);
            case "close": try { this.wins[msg.pane]?.win.close(); } catch { } return;
            case "dock": return this.dockAll();
            case "split": for (const p of PANES) this.openPane(p); return;
            case "focus-input": return this.focusChatInput();
            case "diag": return void this.writeDiag();
            case "geometry": this.geom[msg.pane] = { w: +msg.w, h: +msg.h }; return this.applyGeometry(msg.pane);
        }
    }

    // -------------------------------------------------------------------------
    // pane windows
    // -------------------------------------------------------------------------
    setupPane(pane: string, win: Window) {
        if (!this.wins[pane] || this.wins[pane].win !== win) return;
        const doc = win.document;
        // Throw away the popout page's own content/styles; we draw everything ourselves.
        doc.head.querySelectorAll('style, link[rel="stylesheet"]').forEach(el => el.remove());
        doc.body.replaceChildren();
        doc.body.removeAttribute("class");
        doc.title = `Discord · ${pane}`;
        // let the window be smaller than a popout's usual minimum (matters when it floats);
        // the title reaches the main process a moment later, so retry briefly
        const freeSize = (tries: number) => Native.freePaneSize(pane).then(ok => {
            if (!ok && tries > 0 && !this.stopped) setTimeout(() => freeSize(tries - 1), 200);
        }).catch(() => { });
        if (pane !== "help") freeSize(10);

        const themeStyle = doc.createElement("style"); themeStyle.id = "pp-theme"; doc.head.appendChild(themeStyle);
        const base = doc.createElement("style"); base.id = "pp-base"; base.textContent = BASE_CSS; doc.head.appendChild(base);

        const box = doc.createElement("div");
        box.className = `pane pane-${pane}`;
        box.dataset.label = pane;
        box.innerHTML = pane === "channels"
            ? '<div class="head"></div><input class="filter" placeholder="filter…" spellcheck="false"><div class="list" tabindex="0"></div>'
            : pane === "help" ? `<div class="list help" tabindex="0">${HELP_HTML}</div>`
                : '<div class="list" tabindex="0"></div>';
        doc.body.appendChild(box);

        const w = this.wins[pane];
        Object.assign(w, { doc, box, list: box.querySelector(".list"), header: box.querySelector(".head"), filter: box.querySelector(".filter") });

        win.addEventListener("focus", () => doc.body.classList.add("focused"));
        win.addEventListener("blur", () => doc.body.classList.remove("focused"));
        win.addEventListener("beforeunload", () => this.onPaneClosed(pane));
        // The mouse starts out inactive: Omarchy hides the pointer on a key press but leaves it
        // where it was, so hover highlights would follow an invisible pointer. Hover styles
        // (body.mouse) only apply once the pointer really moves, and stop at the next key.
        const mouse = (on: boolean) => doc.body.classList.toggle("mouse", on);
        doc.addEventListener("mousemove", e => { if (e.movementX || e.movementY) mouse(true); });
        doc.addEventListener("mousedown", () => mouse(true), true);
        doc.addEventListener("keydown", () => mouse(false), true);
        doc.documentElement.addEventListener("mouseleave", () => mouse(false));
        doc.addEventListener("keydown", e => this.onKey(pane, e));
        w.list!.addEventListener("click", e => this.onClick(pane, e));
        w.list!.addEventListener("contextmenu", e => this.onRightClick(pane, e));
        w.filter?.addEventListener("input", () => { this.filterText = w.filter!.value; this.cursor.channels = 0; this.render("channels"); });
        this.syncTheme(true);
        this.applyGeometry(pane);
        this.render(pane);
        setTimeout(() => w.list!.focus(), 50);
    }

    // Discord forces popouts to be at least 320x180, so when Hyprland tiles a pane smaller
    // the page keeps rendering at that size and gets cropped from the top-left. Lay the box
    // out for the size Hyprland actually shows.
    applyGeometry(pane: string) {
        const w = this.wins[pane], g = this.geom[pane];
        if (!w?.doc || !g) return;
        const root = w.doc.documentElement;
        root.style.setProperty("--pp-w", `${g.w}px`);
        root.style.setProperty("--pp-h", `${g.h}px`);
        w.doc.body.classList.add("sized");
    }

    // Copy the active theme's resolved colour variables and loaded fonts from the main window
    // into every pane, so they look like the theme's own panels. Without a palette theme the
    // colours come from Discord's own variables (NATIVE_FALLBACK).
    syncTheme(force?: boolean) {
        const panes = Object.values(this.wins).filter(w => w.doc);
        if (!panes.length) return;
        const cs = getComputedStyle(document.body);
        const get = (v: string) => cs.getPropertyValue(v).trim();
        const vars = THEME_VARS.map(v => [v, get(v) || (NATIVE_FALLBACK[v] || []).map(get).find(Boolean) || ""]).filter(([, val]) => val);
        // Only the resolved variables and the font files are copied, not the theme's rules:
        // its broad selectors (e.g. [class*="list"]) would otherwise restyle the panes' own markup.
        const text =
            ":root,html body{" + vars.map(([k, v]) => `${k}:${v};`).join("") +
            `--pp-font:${cs.fontFamily};--pp-weight:${cs.fontWeight};--pp-spacing:${cs.letterSpacing};}`;
        if (!force && text === this.lastTheme) return;
        this.lastTheme = text;
        for (const w of panes) {
            const el = w.doc!.getElementById("pp-theme");
            if (el) el.textContent = text;
            // Hand the main window's loaded webfonts (e.g. system24's DM Mono) to the pane.
            for (const f of document.fonts as any) {
                if (f.status === "loaded") { try { (w.doc!.fonts as any).add(f); } catch { } }
            }
        }
    }

    scheduleRender() {
        if (this.renderTimer) return;
        this.renderTimer = setTimeout(() => {
            this.renderTimer = null;
            for (const p of Object.keys(this.wins)) this.render(p);
        }, 40);
    }

    render(pane: string) {
        const w = this.wins[pane];
        if (!w?.doc || !w.list || pane === "help") return;
        try {
            const rows = pane === "nav" ? this.navRows() : pane === "channels" ? this.channelRows() : this.userRows();
            const actRows = rows.filter(r => r.act);
            this.items[pane] = actRows.map(r => r.act);
            if (this.cursor[pane] == null || this.cursor[pane]! >= actRows.length) {
                this.cursor[pane] = Math.max(0, actRows.findIndex(r => r.selected));
            }
            const scroll = w.list.scrollTop;
            let i = 0;
            w.list.innerHTML = rows.map(r => {
                if (!r.act) return r.html;
                const idx = i++;
                return r.html.replace("<div ", `<div data-i="${idx}" ${idx === this.cursor[pane] ? "data-cursor " : ""}`);
            }).join("");
            w.list.scrollTop = scroll;
            if (w.header) w.header.textContent = this.currentGuildName();
        } catch (e: any) {
            console.error("[PanePopout] render failed", pane, e);
            w.list.textContent = "render error: " + e.message;
        }
    }

    // ----- nav ---------------------------------------------------------------
    navRows() {
        const { SortedGuild, Guild, GuildReadState, SelectedGuild, GuildSettings, ReadState } = this.S;
        const selected = safe(() => SelectedGuild.getGuildId(), null);
        const rows: Row[] = [];
        const dmMentions = this.privateChannelIds().reduce((n, id) => n + (safe(() => ReadState.getMentionCount(id), 0) || 0), 0);
        rows.push({
            act: { kind: "dms" }, selected: !selected,
            html: `<div class="srv dms ${!selected ? "sel" : ""}" title="direct messages"><span class="ico">${svg("dm")}</span>${dmMentions ? `<b class="badge">${dmMentions}</b>` : ""}</div>`,
        });
        rows.push({ html: '<div class="sep"></div>' });
        const folders: any[] = safe(() => SortedGuild.getGuildFolders(), null) ||
            (safe(() => SortedGuild.getFlattenedGuildIds(), []) || []).map((id: string) => ({ guildIds: [id] }));
        const guildRow = (id: string, g: any): Row => {
            const muted = safe(() => GuildSettings.isMuted(id), false);
            const unread = !muted && safe(() => GuildReadState.hasUnread(id), false);
            const mentions = safe(() => GuildReadState.getMentionCount(id), 0) || 0;
            return {
                act: { kind: "guild", id }, selected: id === selected,
                html: `<div class="srv ${id === selected ? "sel" : ""} ${unread ? "unread" : ""}" title="${esc(g.name)}">${this.guildIcon(id, g)}${mentions ? `<b class="badge">${mentions}</b>` : ""}</div>`,
            };
        };
        for (const f of folders) {
            const guilds: [string, any][] = (f.guildIds || []).map((id: string) => [id, safe(() => Guild.getGuild(id), null)]).filter(([, g]) => g);
            if (!guilds.length) continue;
            if (f.folderId == null) { for (const [id, g] of guilds) rows.push(guildRow(id, g)); continue; }

            // A real folder: closed it's one tile (2x2 preview + combined badges), open it's a framed group.
            const fid = String(f.folderId);
            const color = f.folderColor ? "#" + f.folderColor.toString(16).padStart(6, "0") : "var(--border-hover, #888)";
            const name = f.folderName || guilds.map(([, g]) => g.name).slice(0, 3).join(", ");
            const holdsSelected = guilds.some(([id]) => id === selected);
            const open = this.openFolders.has(fid);
            const mentions = guilds.reduce((n, [id]) => n + (safe(() => GuildReadState.getMentionCount(id), 0) || 0), 0);
            const unread = guilds.some(([id]) => !safe(() => GuildSettings.isMuted(id), false) && safe(() => GuildReadState.hasUnread(id), false));
            if (!open) {
                const minis = guilds.slice(0, 4).map(([id, g]) => g.icon
                    ? `<img class="mini" src="https://cdn.discordapp.com/icons/${id}/${g.icon}.webp?size=32" alt="">`
                    : `<span class="mini acr">${esc((g.name || "?")[0])}</span>`).join("");
                rows.push({
                    act: { kind: "folder", id: fid }, selected: holdsSelected,
                    html: `<div class="srv fold ${holdsSelected ? "sel" : ""} ${unread ? "unread" : ""}" style="--fc:${color}" title="${esc(name)} (${guilds.length})">${minis}${mentions ? `<b class="badge">${mentions}</b>` : ""}</div>`,
                });
                continue;
            }
            rows.push({ html: `<div class="folder" style="--fc:${color}">` });
            rows.push({ act: { kind: "folder", id: fid }, html: `<div class="srv fhead" title="${esc(name)}">${svg("folder")}</div>` });
            for (const [id, g] of guilds) rows.push(guildRow(id, g));
            rows.push({ html: "</div>" });
        }
        return rows;
    }

    guildIcon(id: string, g: any) {
        return g.icon
            ? `<img src="https://cdn.discordapp.com/icons/${id}/${g.icon}.${g.icon.startsWith("a_") ? "gif" : "webp"}?size=96" alt="">`
            : `<span class="acr">${esc(g.acronym || (g.name || "").split(/\s+/).map((w: string) => w[0]).join("").slice(0, 3))}</span>`;
    }

    // ----- channels ----------------------------------------------------------
    currentGuildName() {
        const gid = safe(() => this.S.SelectedGuild.getGuildId(), null);
        if (!gid) return "direct messages";
        return safe(() => this.S.Guild.getGuild(gid).name, "") || "";
    }

    privateChannelIds(): string[] {
        const { PrivateSort, Channel } = this.S;
        return safe(() => PrivateSort.getPrivateChannelIds(), null) ||
            safe(() => Channel.getSortedPrivateChannels().map((c: any) => c.id), []) || [];
    }

    channelRows() {
        const gid = safe(() => this.S.SelectedGuild.getGuildId(), null);
        return gid ? this.guildChannelRows(gid) : this.dmRows();
    }

    channelRow(c: any, { gid, depth = 0, prefix = "#" }: { gid: string; depth?: number; prefix?: string; }): Row {
        const { ReadState, SelectedChannel, GuildSettings } = this.S;
        const sel = safe(() => SelectedChannel.getChannelId(), null) === c.id;
        const muted = !!gid && safe(() => GuildSettings.isChannelMuted(gid, c.id), false);
        const unread = !muted && safe(() => ReadState.hasUnread(c.id), false);
        const mentions = safe(() => ReadState.getMentionCount(c.id), 0) || 0;
        return {
            act: { kind: "channel", id: c.id, gid, voice: c.type === CHANNEL.VOICE || c.type === CHANNEL.STAGE }, selected: sel,
            html: `<div class="ch ${sel ? "sel" : ""} ${unread ? "unread" : ""} ${muted ? "muted" : ""}" style="--depth:${depth}">` +
                `<span class="pfx">${prefix}</span><span class="name">${esc(c.name)}</span>${mentions ? `<b class="badge">${mentions}</b>` : ""}</div>`,
        };
    }

    guildChannelRows(gid: string) {
        const { GuildChannel, Threads, SelectedChannel } = this.S;
        const all = safe(() => GuildChannel.getChannels(gid), {}) || {};
        const text: any[] = (all.SELECTABLE || []).map((e: any) => e.channel).filter(Boolean);
        const voice: any[] = (all.VOCAL || []).map((e: any) => e.channel).filter(Boolean);
        const cats: any[] = (all[CHANNEL.CATEGORY] || []).map((e: any) => e.channel).filter((c: any) => c && c.id !== "null");
        const byPos = (a: any, b: any) => (a.position ?? 0) - (b.position ?? 0) || (a.id < b.id ? -1 : 1);
        const selectedId = safe(() => SelectedChannel.getChannelId(), null);
        const prefixFor = (c: any) => (c.type === CHANNEL.VOICE || c.type === CHANNEL.STAGE ? "♪" : c.type === CHANNEL.FORUM || c.type === CHANNEL.MEDIA ? "≡" : "#");

        // threads you've joined, keyed by parent channel
        const threadsByParent: Record<string, any[]> = {};
        const tmap = safe(() => Threads.getActiveJoinedThreadsForGuild(gid), {}) || {};
        for (const [parentId, threads] of Object.entries<any>(tmap)) {
            threadsByParent[parentId] = Object.values<any>(threads || {}).map(t => t?.channel || t).filter(t => t?.id);
        }

        const filter = this.filterText.trim().toLowerCase();
        if (filter) {
            const matches = [...text, ...voice, ...Object.values(threadsByParent).flat()].filter(c => (c.name || "").toLowerCase().includes(filter));
            return matches.length ? matches.map(c => this.channelRow(c, { gid, prefix: prefixFor(c) })) : [{ html: '<div class="empty">no matches</div>' } as Row];
        }

        const groups = new Map<string | null, { cat: any; items: any[]; }>([[null, { cat: null, items: [] }]]);
        for (const cat of cats.sort(byPos)) groups.set(cat.id, { cat, items: [] });
        for (const c of [...text.sort(byPos), ...voice.sort(byPos)]) (groups.get(c.parent_id) || groups.get(null)!).items.push(c);

        const rows: Row[] = [];
        for (const { cat, items } of groups.values()) {
            if (cat) {
                const collapsed = this.collapsed.has(cat.id);
                rows.push({ act: { kind: "category", id: cat.id }, html: `<div class="cat">${collapsed ? "+" : "-"} ${esc((cat.name || "").toLowerCase())}</div>` });
                if (collapsed) {
                    for (const c of items) if (c.id === selectedId) rows.push(this.channelRow(c, { gid, prefix: prefixFor(c) }));
                    continue;
                }
            }
            for (const c of items) {
                rows.push(this.channelRow(c, { gid, prefix: prefixFor(c) }));
                for (const t of threadsByParent[c.id] || []) rows.push(this.channelRow(t, { gid, depth: 1, prefix: "└" }));
            }
        }
        return rows;
    }

    dmName(c: any) {
        if (c.name) return c.name;
        const ids: string[] = c.recipients || [];
        const names = ids.map(id => { const u = safe(() => this.S.User.getUser(id), null); return u ? (u.globalName || u.username) : null; }).filter(Boolean);
        return names.join(", ") || "unknown";
    }

    dmAvatar(c: any) {
        if (c.icon) return `https://cdn.discordapp.com/channel-icons/${c.id}/${c.icon}.webp?size=64`;
        const id = (c.recipients || [])[0];
        const u = id && safe(() => this.S.User.getUser(id), null);
        return u ? safe(() => u.getAvatarURL(null, 64), null) : null;
    }

    dmRows() {
        const { Channel, ReadState, SelectedChannel, Presence } = this.S;
        const sel = safe(() => SelectedChannel.getChannelId(), null);
        const filter = this.filterText.trim().toLowerCase();
        const rows: Row[] = [];
        if (!filter) rows.push({ act: { kind: "friends" }, selected: !sel, html: `<div class="ch friends ${!sel ? "sel" : ""}"><span class="pfx">@</span><span class="name">friends</span></div>` });
        for (const id of this.privateChannelIds()) {
            const c = safe(() => Channel.getChannel(id), null);
            if (!c) continue;
            const name = this.dmName(c);
            if (filter && !name.toLowerCase().includes(filter)) continue;
            const unread = safe(() => ReadState.hasUnread(id), false);
            const mentions = safe(() => ReadState.getMentionCount(id), 0) || 0;
            const av = this.dmAvatar(c);
            const status = (c.recipients || []).length === 1 ? safe(() => Presence.getStatus(c.recipients[0]), "offline") : null;
            rows.push({
                act: { kind: "dm", id }, selected: sel === id,
                html: `<div class="ch dm ${sel === id ? "sel" : ""} ${unread ? "unread" : ""}">` +
                    `<span class="av">${av ? `<img src="${esc(av)}" alt="">` : ""}${status ? `<i class="st st-${esc(status)}"></i>` : ""}</span>` +
                    `<span class="name">${esc(name)}</span>${mentions ? `<b class="badge">${mentions}</b>` : ""}</div>`,
            });
        }
        if (!rows.length) rows.push({ html: '<div class="empty">no matches</div>' });
        return rows;
    }

    // ----- user --------------------------------------------------------------
    userRows() {
        const { User, Media, Presence, RTC, Channel, Guild } = this.S;
        const me = safe(() => User.getCurrentUser(), null);
        const mute = safe(() => Media.isSelfMute(), false);
        const deaf = safe(() => Media.isSelfDeaf(), false);
        const status = me ? safe(() => Presence.getStatus(me.id), "online") : "online";
        const custom = me ? safe(() => (Presence.getActivities(me.id) || []).find((a: any) => a.type === 4), null) : null;
        const statusText = (custom && (custom.state || custom.emoji?.name)) ||
            ({ online: "online", idle: "idle", dnd: "do not disturb", invisible: "invisible", offline: "offline" }[status as string] || status);
        const av = me ? safe(() => me.getAvatarURL(null, 80), null) : null;
        const vcId = safe(() => RTC.getChannelId(), null);
        const vc = vcId ? safe(() => Channel.getChannel(vcId), null) : null;
        const vcWhere = vc?.guild_id ? safe(() => Guild.getGuild(vc.guild_id).name, "") : "";
        const rows: Row[] = [];
        rows.push({
            act: { kind: "profile" },
            html: `<div class="me" title="profile and status (enter)"><span class="av">${av ? `<img src="${esc(av)}" alt="">` : ""}<i class="st st-${esc(status)}"></i></span>` +
                `<span class="who"><span class="name">${esc(me?.globalName || me?.username || "")}</span>` +
                `<span class="sub">${esc(me?.username || "")}</span><span class="status">${esc(statusText)}</span></span></div>`,
        });
        if (vc) {
            rows.push({ html: `<div class="vc"><span class="vcname">vc: ${esc(vc.name)}${vcWhere ? ` <span class="dim">/ ${esc(vcWhere)}</span>` : ""}</span>` });
            rows.push({ act: { kind: "disconnect" }, html: `<div class="tbtn danger slim" title="disconnect">${svg("hangup")}<span>leave</span></div>` });
            rows.push({ html: "</div>" });
        }
        rows.push({ html: '<div class="btnrow">' });
        rows.push({ act: { kind: "mute" }, html: `<div class="tbtn ${mute ? "danger" : ""}" title="mute (m)">${svg("mic", mute ? ICONS.slash : "")}<span>${mute ? "muted" : "mute"}</span></div>` });
        rows.push({ act: { kind: "deafen" }, html: `<div class="tbtn ${deaf ? "danger" : ""}" title="deafen (d)">${svg("headphones", deaf ? ICONS.slash : "")}<span>${deaf ? "deaf" : "deafen"}</span></div>` });
        rows.push({ act: { kind: "settings" }, html: `<div class="tbtn" title="settings (s)">${svg("gear")}<span>settings</span></div>` });
        rows.push({ html: "</div>" });
        return rows;
    }

    // Click the real (hidden) control in the main window's user panel, so Discord does
    // exactly what it normally does.
    findPanelButton(re: RegExp) {
        const panel = document.querySelector('section[class*="panels_"]');
        return [...(panel?.querySelectorAll<HTMLElement>("button, [role=switch], [role=button]") || [])]
            .find(b => re.test(b.getAttribute("aria-label") || ""));
    }

    clickPanelButton(re: RegExp) {
        const btn = this.findPanelButton(re);
        if (btn) { btn.click(); return true; }
        toast("couldn't find that button in Discord's user panel", "critical");
        return false;
    }

    // -------------------------------------------------------------------------
    // input
    // -------------------------------------------------------------------------
    activate(pane: string, item: any, { fromKeyboard = false } = {}) {
        if (!item) return;
        switch (item.kind) {
            case "dms":
                this.go("/channels/@me"); this.cursor.channels = null; this.clearFilter();
                if (fromKeyboard) this.focusPane("channels");
                break;
            case "guild":
                this.openGuild(item.id);
                this.cursor.channels = null; this.clearFilter();
                if (fromKeyboard) this.focusPane("channels");
                break;
            case "folder":
                this.openFolders.has(item.id) ? this.openFolders.delete(item.id) : this.openFolders.add(item.id);
                settings.store.openFolders = [...this.openFolders];
                this.render("nav");
                break;
            case "friends":
                this.go("/channels/@me");
                if (fromKeyboard) { (document.activeElement as HTMLElement | null)?.blur?.(); this.focusPane("main"); }
                break;
            case "dm": this.go(`/channels/@me/${item.id}`); this.clearFilter(); this.focusChat(); break;
            case "channel":
                this.go(`/channels/${item.gid}/${item.id}`); this.clearFilter();
                if (!item.voice) this.focusChat();
                break;
            case "category":
                this.collapsed.has(item.id) ? this.collapsed.delete(item.id) : this.collapsed.add(item.id);
                settings.store.collapsed = [...this.collapsed];
                this.render("channels");
                break;
            case "mute": this.clickPanelButton(/^(un)?mute$/i); break;
            case "deafen": this.clickPanelButton(/^(un)?deafen$/i); break;
            case "settings": this.clickPanelButton(/user settings/i); this.focusPane("main"); break;
            case "profile": this.openProfile(pane); break;
            case "disconnect": this.clickPanelButton(/^disconnect$/i); break;
        }
    }

    // Discord ignores "/channels/<guild>" without a channel, so always pick a real one: the last
    // channel you had open there (if it still exists), else the first text channel.
    firstTextChannel(gid: string) {
        const all = safe(() => this.S.GuildChannel.getChannels(gid), {}) || {};
        const byPos = (a: any, b: any) => (a.position ?? 0) - (b.position ?? 0) || (a.id < b.id ? -1 : 1);
        const chans: any[] = (all.SELECTABLE || []).map((e: any) => e.channel).filter(Boolean);
        const text = chans.filter(c => c.type === CHANNEL.TEXT || c.type === CHANNEL.ANNOUNCEMENT).sort(byPos);
        return (text[0] || chans.sort(byPos)[0])?.id || null;
    }

    openGuild(gid: string) {
        const { SelectedChannel, Channel, SelectedGuild } = this.S;
        const valid = (id: string | null) => !!id && safe(() => Channel.getChannel(id)?.guild_id, null) === gid;
        const recent = safe(() => SelectedChannel.getMostRecentSelectedTextChannelId(gid), null);
        const first = this.firstTextChannel(gid);
        const target = valid(recent) ? recent : first;
        this.go(target ? `/channels/${gid}/${target}` : `/channels/${gid}`);
        // If Discord didn't switch (e.g. the remembered channel can't be opened), fall back once.
        setTimeout(() => {
            if (safe(() => SelectedGuild.getGuildId(), null) === gid) return;
            if (first && first !== target) this.go(`/channels/${gid}/${first}`);
            else toast("Discord didn't open that server");
        }, 600);
    }

    // ----- friends page (Discord's own UI in the main window) ------------------
    // Plain keys drive it when it's showing and you're not typing; each key clicks
    // Discord's real control, so behaviour matches clicking.
    friendsKey(e: KeyboardEvent) {
        if (e.ctrlKey || e.altKey || e.metaKey) return;
        const col = document.querySelector('[class*="peopleColumn_"]');
        if (!col) return;
        const t = e.target as HTMLElement | null;
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) {
            if (e.key === "Escape" && col.contains(t)) setTimeout(() => t.blur(), 0); // leave the search box
            return;
        }
        if (document.querySelector('[role="menu"], [role="dialog"]')) return; // Discord's menus/modals keep their keys

        const rows = [...col.querySelectorAll<HTMLElement>('[class*="peopleListItem_"]')];
        const cur = rows.findIndex(r => r.hasAttribute("data-pp-cursor"));
        const setCursor = (i: number) => {
            if (!rows.length) return;
            i = Math.max(0, Math.min(rows.length - 1, i));
            rows.forEach(r => r.removeAttribute("data-pp-cursor"));
            rows[i].setAttribute("data-pp-cursor", "");
            rows[i].scrollIntoView({ block: "nearest" });
        };
        const row = rows[cur >= 0 ? cur : 0];
        const press = (re: RegExp) => {
            const b = row && [...row.querySelectorAll<HTMLElement>("[aria-label]")].find(el => re.test(el.getAttribute("aria-label") || ""));
            if (b) b.click();
            return !!b;
        };
        const tabs = (() => {
            const list = [...document.querySelectorAll('[role="tablist"]')].find(l => l.querySelector('[class*="addFriend_"]'));
            return list ? [...list.querySelectorAll<HTMLElement>('[role="tab"]')] : [];
        })();
        const tabIdx = tabs.findIndex(t => t.getAttribute("aria-selected") === "true");
        const tabCur = tabs.findIndex(t => t.hasAttribute("data-pp-cursor"));
        const inTabs = tabCur >= 0;
        const clearCursors = () => document.querySelectorAll("[data-pp-cursor]").forEach(el => el.removeAttribute("data-pp-cursor"));
        const isAddFriend = (t?: HTMLElement) => /addFriend_/.test(t?.className || "");
        const focusAddFriend = () => setTimeout(() => [...document.querySelectorAll("input")].find(i => /username/i.test(i.placeholder || ""))?.focus(), 150);
        // Tab bar: the dashed cursor sits on the tab, and landing on a tab opens it.
        const markTab = (i: number) => {
            if (!tabs.length) return;
            i = ((i % tabs.length) + tabs.length) % tabs.length;
            clearCursors();
            tabs[i].click();
            tabs[i].setAttribute("data-pp-cursor", "");
        };
        const leaveTabs = () => {
            const t = tabs[inTabs ? tabCur : tabIdx];
            clearCursors();
            if (isAddFriend(t)) return focusAddFriend();
            // the list re-renders after a tab switch, so look the rows up again
            setTimeout(() => {
                const fresh = [...(document.querySelector('[class*="peopleColumn_"]')?.querySelectorAll('[class*="peopleListItem_"]') || [])];
                if (fresh[0]) { fresh[0].setAttribute("data-pp-cursor", ""); fresh[0].scrollIntoView({ block: "nearest" }); }
            }, 0);
        };
        const openTab = (i: number) => (inTabs ? markTab(i) : (tabs[i] && (tabs[i].click(), setTimeout(clearCursors, 0))));

        const k = e.key;
        if (inTabs) {
            if (k === "h" || k === "ArrowLeft") markTab(tabCur - 1);
            else if (k === "l" || k === "ArrowRight") markTab(tabCur + 1);
            else if (k === "j" || k === "ArrowDown" || k === "Enter" || k === "Escape") leaveTabs();
            else if (k === "k" || k === "ArrowUp") { /* already at the top */ }
            else if (k === "]") markTab(tabCur + 1);
            else if (k === "[") markTab(tabCur - 1);
            else if (/^[1-9]$/.test(k)) markTab(+k - 1);
            else if (k === "a") { markTab(tabs.findIndex(isAddFriend)); clearCursors(); focusAddFriend(); }
            else if (k === "/") { clearCursors(); col.querySelector("input")?.focus(); }
            else if (k === "?") this.toggleHelp();
            else return;
        }
        else if (k === "j" || k === "ArrowDown") setCursor(cur + 1);
        else if (k === "k" || k === "ArrowUp") {
            if (cur <= 0 && tabs.length) { clearCursors(); tabs[Math.max(0, tabIdx)].setAttribute("data-pp-cursor", ""); }
            else setCursor(cur - 1);
        }
        else if (k === "g" || k === "Home") setCursor(0);
        else if (k === "G" || k === "End") setCursor(rows.length - 1);
        else if (k === "Enter" || k === "l" || k === "ArrowRight") {
            if (press(/^Message /) || press(/^Open conversation/)) setTimeout(() => this.focusChatInput(), 200);
        }
        else if (k === "o") press(/^More options/);
        else if (k === "y") press(/^Accept/i);
        else if (k === "n") press(/^(Ignore|Decline|Cancel)/i);
        else if (k === "]") openTab(Math.min(tabs.length - 1, tabIdx + 1));
        else if (k === "[") openTab(Math.max(0, tabIdx - 1));
        else if (/^[1-9]$/.test(k)) openTab(+k - 1);
        else if (k === "a") { openTab(tabs.findIndex(isAddFriend)); focusAddFriend(); }
        else if (k === "/") col.querySelector("input")?.focus();
        else if (k === "h" || k === "ArrowLeft") this.focusPane("channels");
        else if (k === "?") this.toggleHelp();
        else return;
        e.preventDefault();
        e.stopPropagation();
    }

    // ----- messages (Discord's own chat in the main window) ---------------------
    // Esc in an empty chat input puts a cursor on the newest message; plain keys then move
    // it and act on that message. Actions press Discord's own controls (or make the same
    // dispatch its buttons make), so they behave like clicking.
    msgPrefix() {
        const cid = safe(() => this.S.SelectedChannel.getChannelId(), null);
        return cid ? `chat-messages-${cid}-` : null;
    }
    messageEls() {
        const p = this.msgPrefix();
        if (!p) return [];
        return [...document.querySelectorAll<HTMLElement>(`[id^="${p}"]`)].filter(el => /^\d+$/.test(el.id.slice(p.length)));
    }
    messageOf(el: HTMLElement) {
        const p = this.msgPrefix();
        if (!p || !el.id.startsWith(p)) return null;
        const cid = p.slice("chat-messages-".length, -1);
        const msg = safe(() => this.chat.Message.getMessage(cid, el.id.slice(p.length)), null);
        const channel = safe(() => this.S.Channel.getChannel(cid), null);
        return msg && channel ? { msg, channel } : null;
    }
    setMsgCursor(el: HTMLElement | null | undefined) {
        document.querySelectorAll("[data-pp-msg]").forEach(e => e.removeAttribute("data-pp-msg"));
        this.unhover();
        this.msgCursor = el?.id || null;
        if (el) { el.setAttribute("data-pp-msg", ""); el.scrollIntoView({ block: "nearest" }); }
    }
    enterMessages() {
        const els = this.messageEls();
        if (!els.length) return;
        (document.activeElement as HTMLElement | null)?.blur?.();
        this.setMsgCursor(els[els.length - 1]);
    }
    exitMessages(focusInput = false) {
        this.cancelHints();
        if (this.msgCursor || document.querySelector("[data-pp-msg]")) this.setMsgCursor(null);
        if (focusInput) this.focusChatInput();
    }
    // Esc in the chat input only moves to the messages when it has nothing else to do there
    inputIdle(box: HTMLElement) {
        if ((box.textContent || "").replace(/[​﻿]/g, "").trim()) return false;
        if (safe(() => this.chat.PendingReply.getPendingReply(this.S.SelectedChannel.getChannelId()), null)) return false; // Esc cancels the reply
        return !document.querySelector('[class*="autocomplete_"], [role="menu"], [role="dialog"]');
    }

    messagesKey(e: KeyboardEvent) {
        if (this.hints) return this.hintKey(e);
        if (e.ctrlKey || e.altKey || e.metaKey) return;
        const t = e.target as HTMLElement | null;
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) {
            // Discord sees this Esc too (it marks the channel read); the cursor appears after it
            if (e.key === "Escape" && !e.shiftKey && t === this.mainTextbox() && this.inputIdle(t)) setTimeout(() => this.enterMessages(), 0);
            return;
        }
        if (!this.msgCursor) return;
        if (document.querySelector('[role="menu"], [role="dialog"]')) return; // Discord's menus/pickers keep their keys

        const els = this.messageEls();
        if (!els.length) return this.exitMessages();
        let i = els.findIndex(el => el.id === this.msgCursor);
        if (i < 0) this.setMsgCursor(els[i = els.length - 1]); // the channel changed, or the message was unloaded
        else if (!els[i].hasAttribute("data-pp-msg")) els[i].setAttribute("data-pp-msg", ""); // re-rendered
        const el = els[i];
        const k = e.key;
        if (k === "j" || k === "ArrowDown") this.setMsgCursor(els[Math.min(els.length - 1, i + 1)]);
        else if (k === "k" || k === "ArrowUp") this.setMsgCursor(els[Math.max(0, i - 1)]); // at the top, Discord loads older ones
        else if (k === "g" || k === "Home") this.setMsgCursor(els[0]);
        else if (k === "G" || k === "End") this.jumpToPresent();
        else if (k === "Enter" || k === "l" || k === "ArrowRight") this.openPrimary(el);
        else if (k === "f") this.showHints(el);
        else if (k === "o") this.messageMenu(el);
        else if (k === "r") this.reply(el);
        else if (k === "e") this.edit(el);
        else if (k === "+" || k === "=") this.react(el);
        else if (k === "y" || k === "Y") this.copyMessage(el, k === "Y");
        else if (k === "Escape" || k === "i") this.exitMessages(true);
        else if (k === "h" || k === "ArrowLeft") this.focusPane("channels");
        else if (k === "?") this.toggleHelp();
        else {
            // any other character: back to typing, and the key lands in the chat input
            if (k.length === 1) { this.exitMessages(true); e.stopPropagation(); }
            return;
        }
        e.preventDefault();
        e.stopPropagation();
    }

    jumpToPresent() {
        const bar = document.querySelector<HTMLElement>('[class*="jumpToPresentBar_"]');
        const btn = [...(bar || document).querySelectorAll<HTMLElement>('button, [role="button"]')].find(b => /jump to present/i.test(b.textContent || ""))
            || bar?.querySelector<HTMLElement>("button");
        const last = () => { const els = this.messageEls(); this.setMsgCursor(els[els.length - 1]); };
        if (btn) { btn.click(); setTimeout(last, 600); } else last();
    }

    // Everything clickable in a message that is actually on screen (the element at its centre
    // belongs to it, so covered and scrolled-away ones are skipped). Not Discord's hover toolbar.
    clickables(el: HTMLElement) {
        const out: HTMLElement[] = [];
        for (const c of el.querySelectorAll<HTMLElement>('a[href], button, [role="button"], [role="link"]')) {
            if (c.closest('[class*="buttonContainer_"], [class*="hoverBar"]')) continue;
            const r = c.getClientRects()[0];
            if (!r || r.width < 2 || r.height < 2) continue;
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            if (hit && c.contains(hit)) out.push(c);
        }
        return out;
    }
    openPrimary(el: HTMLElement) {
        const c = this.clickables(el).find(c => c.closest('[id^="message-content-"], [id^="message-accessories-"]') && !c.closest('[class*="reaction"]'));
        if (c) c.click(); else toast("no link or attachment in this message");
    }
    showHints(el: HTMLElement) {
        const els = this.clickables(el).slice(0, HINT_KEYS.length);
        if (!els.length) return toast("nothing to click in this message");
        const box = document.createElement("div");
        box.id = "pp-hints";
        els.forEach((c, n) => {
            const r = c.getClientRects()[0];
            const h = document.createElement("span");
            h.textContent = HINT_KEYS[n];
            h.style.left = `${Math.max(0, r.left - 6)}px`;
            h.style.top = `${Math.max(0, r.top - 6)}px`;
            box.appendChild(h);
        });
        document.body.appendChild(box);
        this.hints = { els, box };
    }
    hintKey(e: KeyboardEvent) {
        if (["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(e.key)) return;
        const { els } = this.hints!;
        this.cancelHints();
        e.preventDefault();
        e.stopPropagation();
        const c = els[HINT_KEYS.indexOf(e.key)];
        if (c?.isConnected) c.click();
    }
    cancelHints() { this.hints?.box.remove(); this.hints = null; }

    // Discord draws a message's toolbar (reply, react, edit, ...) on hover; fake the hover.
    hover(el: HTMLElement) {
        const t = el.querySelector<HTMLElement>('[role="article"]') || el;
        if (this.hovered === t) return;
        this.unhover();
        t.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: null }));
        t.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
        this.hovered = t;
    }
    unhover() {
        const t = this.hovered;
        this.hovered = null;
        if (t?.isConnected) t.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: null }));
    }
    async messageButton(el: HTMLElement, re: RegExp) {
        const find = () => [...el.querySelectorAll<HTMLElement>("[aria-label]")]
            .find(b => re.test(b.getAttribute("aria-label") || "") && (b.tagName === "BUTTON" || b.getAttribute("role") === "button")) || null;
        let b = find();
        for (const wait of [50, 150]) {
            if (b) break;
            this.hover(el);
            await sleep(wait);
            b = find();
        }
        return b;
    }
    messageMenu(el: HTMLElement) {
        const t = el.querySelector<HTMLElement>('[role="article"]') || el;
        const r = t.getBoundingClientRect();
        const y = Math.min(Math.max(r.top + 16, 16), innerHeight - 16);
        t.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: r.left + 80, clientY: y }));
    }
    async react(el: HTMLElement) {
        const b = await this.messageButton(el, /^add reaction$/i);
        if (b) return b.click();
        toast("couldn't find Discord's reaction button, so here's the message menu");
        this.messageMenu(el);
    }
    async reply(el: HTMLElement) {
        const m = this.messageOf(el);
        if (!m) return toast("can't reply to that");
        const b = await this.messageButton(el, /^reply$/i);
        if (b) b.click();
        else {
            const me = safe(() => this.S.User.getCurrentUser().id, null);
            FluxDispatcher.dispatch({
                type: "CREATE_PENDING_REPLY", channel: m.channel, message: m.msg, shouldMention: true,
                showMentionToggle: m.channel.guild_id != null && m.msg.author?.id !== me,
            } as any);
        }
        this.exitMessages(true);
    }
    async edit(el: HTMLElement) {
        const m = this.messageOf(el);
        const me = safe(() => this.S.User.getCurrentUser().id, null);
        if (!m || !me || m.msg.author?.id !== me) return toast("you can only edit your own messages");
        const b = await this.messageButton(el, /^edit$/i);
        if (b) b.click();
        else FluxDispatcher.dispatch({ type: "MESSAGE_START_EDIT", channelId: m.channel.id, messageId: m.msg.id, content: m.msg.content } as any);
        const id = el.id;
        this.exitMessages();
        setTimeout(() => document.getElementById(id)?.querySelector<HTMLElement>('[role="textbox"][contenteditable="true"]')?.focus(), 150);
    }
    copyMessage(el: HTMLElement, link: boolean) {
        const m = this.messageOf(el);
        if (!m) return toast("can't copy that");
        const text = link ? `https://discord.com/channels/${m.channel.guild_id ?? "@me"}/${m.channel.id}/${m.msg.id}` : m.msg.content;
        if (!text) return toast("this message has no text");
        copyText(text).then(() => toast(link ? "copied a link to the message" : "copied the message text", "success"), () => toast("couldn't copy", "critical"));
    }

    // for the diag report: whether the message keys can find what they need (counts only)
    async messageProbe() {
        const els = this.messageEls();
        const last = els[els.length - 1];
        const probe: Record<string, any> = {
            channel: !!this.msgPrefix(), items: els.length, tags: [...new Set(els.map(e => e.tagName.toLowerCase()))],
            articles: els.filter(e => e.querySelector('[role="article"]')).length,
            content: document.querySelectorAll('[id^="message-content-"]').length,
            textbox: !!this.mainTextbox(), dialogs: document.querySelectorAll('[role="dialog"]').length,
            menus: document.querySelectorAll('[role="menu"]').length,
            stores: Object.fromEntries(Object.entries(this.chat).map(([k, v]) => [k, !!v])),
            dispatch: typeof safe(() => FluxDispatcher.dispatch, null),
            lastResolves: !!(last && this.messageOf(last)), lastClickables: last ? this.clickables(last).length : 0,
            cursor: !!this.msgCursor,
        };
        if (last && !this.msgCursor) {
            const labels = ["Add Reaction", "Reply", "Edit", "Forward", "More"];
            const had = this.hovered;
            this.hover(last);
            await sleep(150);
            probe.toolbarInMessage = labels.filter(l => last.querySelector(`[aria-label="${l}"]`));
            probe.toolbarAnywhere = labels.filter(l => document.querySelector(`[aria-label="${l}"]`));
            if (!had) this.unhover();
        }
        return probe;
    }

    clearFilter() {
        const f = this.wins.channels?.filter;
        if (f && f.value) { f.value = ""; this.filterText = ""; }
    }

    mouseIdle(on: boolean) { document.documentElement.toggleAttribute("data-pp-mouse-idle", on); } // (an attribute: Discord rewrites html's classes)

    focusPane(pane: string) { post({ action: "focus", pane }); }
    // the channel's chat input (edit boxes are textboxes too, but sit inside a message)
    mainTextbox() {
        return [...document.querySelectorAll<HTMLElement>('[role="textbox"][contenteditable="true"]')]
            .find(el => !el.closest('[id^="chat-messages-"]')) || null;
    }
    focusChatInput() { this.mainTextbox()?.focus(); }
    focusChat() { this.focusChatInput(); this.focusPane("main"); }

    // ----- Discord's own right-click menus for pane rows --------------------------
    // The panes are drawn by this plugin, so they have no menus of their own. Discord's real
    // sidebar is still in the main window, only invisible (see applyMainLayout), so `o` or a
    // right-click on a pane row right-clicks the same row there: Discord opens its own menu in
    // the main window, next to the panes, and focus moves to it until it closes.
    async paneMenu(pane: string, idx: number | null | undefined) {
        const item = idx == null ? null : this.items[pane]?.[idx];
        const w = this.wins[pane];
        if (!item || !w?.doc || this.menuBusy) return;
        if (item.kind === "profile") return this.openProfile(pane); // its "menu" is the profile popout
        this.menuBusy = true;
        const restore: (() => void)[] = []; // undo anything opened up in the hidden sidebar to reach the row
        try {
            if (["dms", "friends", "disconnect"].includes(item.kind)) return toast("Discord has no right-click menu for that");
            const target = await this.sidebarTarget(item, restore);
            if (!target) return toast("couldn't find that in Discord's own list, so there's no menu for it");
            // line the menu up with the row: from the top for nav and channels, from the bottom for user
            const r = w.list!.querySelector(`[data-i="${idx}"]`)?.getBoundingClientRect();
            let y = r ? (pane === "user" ? innerHeight - (w.win.innerHeight - r.top) : r.top) : innerHeight / 3;
            y = Math.round(Math.min(Math.max(y, 8), innerHeight - 8));
            target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, buttons: 2, clientX: 8, clientY: y, view: window }));
            let menu: Element | null = null;
            for (let t = 0; t < 30 && !menu; t++) { await sleep(50); menu = document.querySelector('[role="menu"]'); } // some menus load lazily
            if (!menu) return toast("Discord didn't open a menu for that");
            this.focusPane("main");
            this.watchMenu(pane, restore.splice(0));
        } catch (e) {
            console.error("[PanePopout] menu failed", e);
        } finally {
            restore.forEach(f => safe(f, undefined));
            this.menuBusy = false;
        }
    }

    // The row's element in Discord's hidden sidebar (or the user panel button), rendering it
    // first if it has to: opening its folder or category for a moment, or scrolling the list.
    async sidebarTarget(item: any, restore: (() => void)[]): Promise<Element | null> {
        const { S } = this;
        const sidebar = document.querySelector('nav[class*="guilds_"]')?.parentElement as HTMLElement | undefined;
        if (!sidebar) return null;
        const dispatch = (a: any) => FluxDispatcher.dispatch(a);
        switch (item.kind) {
            case "mute": return this.findPanelButton(/^(un)?mute$/i) ?? null;   // input device and volume
            case "deafen": return this.findPanelButton(/^(un)?deafen$/i) ?? null; // output device and volume
            case "settings": return this.findPanelButton(/user settings/i) ?? null;
            case "folder": return this.findRow(sidebar, "guildsnav___", item.id, restore);
            case "guild": {
                const folder = safe(() => S.SortedGuild.getGuildFolders().find((f: any) => f.folderId && f.guildIds.includes(item.id)), null);
                if (folder && S.ExpandedFolders && !S.ExpandedFolders.isFolderExpanded(folder.folderId)) {
                    dispatch({ type: "TOGGLE_GUILD_FOLDER_EXPAND", folderId: folder.folderId });
                    restore.push(() => dispatch({ type: "TOGGLE_GUILD_FOLDER_EXPAND", folderId: folder.folderId }));
                }
                return this.findRow(sidebar, "guildsnav___", item.id, restore);
            }
            case "channel": case "category": {
                // a channel (or thread) in a category that's collapsed in Discord's own list
                let c = safe(() => S.Channel.getChannel(item.id), null);
                if (c && [10, 11, 12].includes(c.type)) c = safe(() => S.Channel.getChannel(c.parent_id), null);
                const cat = item.kind === "channel" ? c?.parent_id : null;
                if (cat && S.CategoryCollapse?.isCollapsed(cat)) {
                    dispatch({ type: "CATEGORY_EXPAND", id: cat });
                    restore.push(() => dispatch({ type: "CATEGORY_COLLAPSE", id: cat }));
                }
                return this.findRow(sidebar, "channels___", item.id, restore);
            }
            case "dm": return this.findRow(sidebar, "private-channels", item.id, restore);
        }
        return null;
    }

    // Discord's lists only render the rows in view, so scroll the hidden list until it's there.
    async findRow(sidebar: HTMLElement, family: string, id: string, restore: (() => void)[]): Promise<Element | null> {
        const get = () => sidebar.querySelector(`[data-list-item-id^="${family}"][data-list-item-id$="___${id}"]`);
        for (let t = 0; t < 4 && !get(); t++) await sleep(50); // (just opened up: give it a moment)
        if (get()) return get();
        const any = sidebar.querySelector(`[data-list-item-id^="${family}"]`);
        let sc = any?.parentElement as HTMLElement | null | undefined;
        while (sc && !(sc.scrollHeight > sc.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
        if (!sc) return null;
        const keep = sc.scrollTop;
        restore.push(() => { sc.scrollTop = keep; });
        for (let top = 0; top <= sc.scrollHeight; top += Math.max(100, sc.clientHeight * 0.8)) {
            sc.scrollTop = top;
            await sleep(60);
            if (get()) return get();
        }
        return null;
    }

    // When the menu closes, undo what was opened up to reach the row and give focus back to the
    // pane, unless the choice opened something in the main window (a dialog, settings).
    watchMenu(pane: string, restore: (() => void)[], selector = '[role="menu"]') {
        clearInterval(this.menuWatch);
        const t0 = Date.now();
        this.menuWatch = setInterval(() => {
            if (document.querySelector(selector) && Date.now() - t0 < 120000) return;
            clearInterval(this.menuWatch); this.menuWatch = null;
            restore.forEach(f => safe(f, undefined));
            setTimeout(() => {
                const busy = document.querySelector('[role="dialog"], [class*="standardSidebarView_"]');
                if (!busy && document.hasFocus() && this.wins[pane]) this.focusPane(pane);
            }, 150);
        }, 100);
    }

    // While one of Discord's menus is open, drive it with the pane keys: j k move, l opens a
    // submenu (or picks the item, like enter), h backs out of a submenu, q closes. Discord's
    // menus only know the arrow keys, so these are passed on as those. Keys pressed in a pane
    // (before focus has reached the main window) go to the menu too, arrows and enter included.
    menuKey(e: KeyboardEvent) {
        if (e.ctrlKey || e.altKey || e.metaKey) return false;
        const open = document.querySelector('[role="menu"]');
        const t = e.target as HTMLElement | null;
        if (!open || t?.isContentEditable || /^(INPUT|TEXTAREA)$/.test(t?.tagName || "")) return false; // e.g. a search box in the menu
        const active = (document.activeElement?.closest?.('[role="menu"]') ? document.activeElement : open) as HTMLElement;
        const menu = active.closest('[role="menu"]') || open;
        const item = document.getElementById(menu.getAttribute("aria-activedescendant") || "");
        const fromPane = t?.ownerDocument !== document;
        let key = ({ j: "ArrowDown", k: "ArrowUp", h: "ArrowLeft", q: "Escape", l: item?.getAttribute("aria-haspopup") === "true" ? "ArrowRight" : "Enter" } as Record<string, string>)[e.key];
        if (!key && fromPane && ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Enter", "Escape", " "].includes(e.key)) key = e.key === " " ? "Enter" : e.key;
        if (!key) return false;
        e.preventDefault();
        e.stopPropagation();
        const code = ({ ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Enter: 13, Escape: 27 } as Record<string, number>)[key];
        active.dispatchEvent(new KeyboardEvent("keydown", { key, code: key, keyCode: code, which: code, bubbles: true, cancelable: true }));
        if (fromPane) this.focusPane("main");
        return true;
    }

    // The profile row opens Discord's own account popout (status, edit profile, switch
    // accounts, ...) from the hidden user panel. It shows in the main window next to the user
    // pane; focus moves to it and comes back when it closes. Its items are plain buttons, not a
    // menu, so popoutKey gives it the menu keys.
    async openProfile(pane: string) {
        const btn = document.querySelector<HTMLElement>('section[class*="panels_"] [class*="accountPopoutButton_"]');
        if (!btn) return toast("couldn't find Discord's profile button");
        if (!document.querySelector(PROFILE_POPOUT)) btn.click();
        let pop: Element | null = null;
        for (let t = 0; t < 20 && !pop; t++) { await sleep(50); pop = document.querySelector(PROFILE_POPOUT); }
        if (!pop) return toast("Discord didn't open the profile menu");
        pop.querySelector<HTMLElement>('[class*="menuItemContent_"]')?.focus();
        this.focusPane("main");
        this.watchMenu(pane, [], PROFILE_POPOUT);
    }

    // Keys for the profile popout: j k move between its items, l or enter picks one (status
    // opens Discord's status menu, which menuKey then drives), h or q closes it. Like menuKey,
    // keys pressed in a pane go to it too.
    popoutKey(e: KeyboardEvent) {
        if (e.ctrlKey || e.altKey || e.metaKey || document.querySelector('[role="menu"]')) return false; // a submenu: menuKey's
        const pop = document.querySelector(PROFILE_POPOUT);
        const t = e.target as HTMLElement | null;
        if (!pop || t?.isContentEditable || /^(INPUT|TEXTAREA)$/.test(t?.tagName || "")) return false;
        const fromPane = t?.ownerDocument !== document;
        const items = [...pop.querySelectorAll<HTMLElement>('[class*="menuItemContent_"]')];
        const ae = document.activeElement;
        const i = items.findIndex(el => el === ae || el.contains(ae));
        const k = e.key;
        if (k === "j" || k === "ArrowDown") items[Math.min(items.length - 1, i + 1)]?.focus();
        else if (k === "k" || k === "ArrowUp") items[Math.max(0, i - 1)]?.focus();
        else if (k === "g" || k === "Home") items[0]?.focus();
        else if (k === "G" || k === "End") items[items.length - 1]?.focus();
        else if ((k === "l" || k === "Enter" || k === " " || k === "ArrowRight") && i >= 0) items[i].click();
        else if (k === "q" || k === "h" || k === "ArrowLeft" || (fromPane && k === "Escape"))
            (ae || document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true }));
        else return false;
        e.preventDefault();
        e.stopPropagation();
        if (fromPane) this.focusPane("main");
        return true;
    }

    onRightClick(pane: string, e: MouseEvent) {
        e.preventDefault();
        const el = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
        if (!el) return;
        this.cursor[pane] = +el.dataset.i!;
        this.render(pane);
        this.paneMenu(pane, +el.dataset.i!);
    }

    onClick(pane: string, e: MouseEvent) {
        const el = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
        if (!el) return;
        this.cursor[pane] = +el.dataset.i!;
        this.activate(pane, this.items[pane][+el.dataset.i!]);
        this.render(pane);
    }

    onKey(pane: string, e: KeyboardEvent) {
        if (e.ctrlKey || e.altKey || e.metaKey) return; // every modifier chord stays with Hyprland/Omarchy
        if (pane !== "help" && (this.menuKey(e) || this.popoutKey(e))) return;
        const w = this.wins[pane];
        if (!w?.list) return;
        if (pane === "help") {
            if (["Escape", "q", "?", "Enter"].includes(e.key)) { e.preventDefault(); try { w.win.close(); } catch { } }
            else if (e.key === "j" || e.key === "ArrowDown") w.list.scrollBy(0, 40);
            else if (e.key === "k" || e.key === "ArrowUp") w.list.scrollBy(0, -40);
            return;
        }
        if (e.key === "?" && !(w.filter && e.target === w.filter)) { e.preventDefault(); this.toggleHelp(); return; }
        if (w.filter && e.target === w.filter) {
            if (e.key === "Escape") { w.filter.value = ""; this.filterText = ""; w.list.focus(); this.render(pane); e.preventDefault(); }
            else if (e.key === "Enter") { this.activate(pane, this.items[pane][0], { fromKeyboard: true }); e.preventDefault(); }
            else if (e.key === "ArrowDown") { w.list.focus(); e.preventDefault(); }
            return;
        }
        const n = this.items[pane]?.length || 0;
        const move = (d: number) => { this.cursor[pane] = Math.min(n - 1, Math.max(0, (this.cursor[pane] || 0) + d)); this.render(pane); this.revealCursor(pane); };
        const k = e.key;
        if (k === "j" || k === "ArrowDown") move(1);
        else if (k === "k" || k === "ArrowUp") move(-1);
        else if (k === "g" || k === "Home") move(-n);
        else if (k === "G" || k === "End") move(n);
        else if (k === "Enter" || k === "l" || k === "ArrowRight" || k === " ") this.activate(pane, this.items[pane][this.cursor[pane]!], { fromKeyboard: true });
        else if ((k === "h" || k === "ArrowLeft") && pane === "channels") this.focusPane("nav");
        else if (k === "/" && w.filter) w.filter.focus();
        else if (k === "Escape") this.focusChat();
        else if (pane === "user" && k === "m") this.activate(pane, { kind: "mute" });
        else if (pane === "user" && k === "d") this.activate(pane, { kind: "deafen" });
        else if (pane === "user" && k === "s") this.activate(pane, { kind: "settings" });
        else if (k === "o" || k === "ContextMenu" || (k === "F10" && e.shiftKey)) this.paneMenu(pane, this.cursor[pane]);
        else return;
        e.preventDefault();
    }

    revealCursor(pane: string) {
        this.wins[pane]?.list?.querySelector("[data-cursor]")?.scrollIntoView({ block: "nearest" });
    }
}

type Row = { html: string; act?: any; selected?: boolean; };

// Main-window cursors (friends list, messages) and the link hints.
// Main window, mouse inactive: Discord's page ignores the pointer, so the pointer Omarchy hides
// on a key press (but leaves where it was) can't hover anything. Real movement, a click or the
// wheel wakes it up again; any key puts it back to sleep. Starts asleep.
const MOUSE_IDLE_CSS = "html[data-pp-mouse-idle] #app-mount { pointer-events: none !important; }";
// Discord's account popout (the user panel's profile and status menu)
const PROFILE_POPOUT = '[class*="accountPopout_"]';
const HINT_KEYS = "asdfghjklqwertyuiopzxcvbnm";
const MAIN_CURSOR_CSS = `
[data-pp-cursor], [data-pp-msg] { outline: 1px dashed var(--text-3, var(--text-muted, #bbb)) !important; outline-offset: -2px;
  background: var(--hover, var(--background-modifier-hover, rgba(128, 128, 128, .12))) !important; }
#pp-hints { position: fixed; inset: 0; pointer-events: none; z-index: 100000; }
#pp-hints span { position: absolute; padding: 0 4px; font: 600 12px/16px var(--font-code, monospace); text-transform: uppercase;
  background: var(--accent-2, var(--brand-500, #5865f2)); color: var(--bg-4, #fff); border: 1px solid var(--bg-4, #000); }
`;

// ---------------------------------------------------------------------------
// Pane styling: a system24-style labelled box. Colours and fonts come from the theme vars.
// Same as plugin/PanePopout.plugin.js.
// ---------------------------------------------------------------------------
const BASE_CSS = `
html, body { margin: 0; height: 100%; overflow: hidden; }
body {
  background: var(--bg-3, #222); color: var(--text-3, #bbb);
  font-family: var(--pp-font, monospace); font-weight: var(--pp-weight, 400); letter-spacing: var(--pp-spacing, normal);
  font-size: 14px; user-select: none; -webkit-font-smoothing: antialiased;
}
* { box-sizing: border-box; }
img { display: block; }
.pane {
  position: absolute; inset: var(--gap, 12px);
  background: var(--bg-4, #181818);
  border: var(--border-thickness, 2px) solid var(--border, #333);
  display: flex; flex-direction: column; min-height: 0;
  transition: border-color var(--border-hover-transition, .2s ease);
}
body.sized .pane {
  inset: auto; left: var(--gap, 12px); top: var(--gap, 12px);
  width: calc(var(--pp-w) - 2 * var(--gap, 12px)); height: calc(var(--pp-h) - 2 * var(--gap, 12px));
}
body.mouse .pane:hover, body.focused .pane { border-color: var(--border-hover, #888); }
.pane::after {
  content: attr(data-label); position: absolute; top: -10px; left: 8px; padding: 0 4px; line-height: 18px;
  background: var(--background-base-low, var(--bg-4, #181818)); color: var(--label-color, var(--text-5, #777));
  font-weight: var(--label-font-weight, 500); font-size: 16px; transition: color var(--border-hover-transition, .2s ease);
}
body.mouse .pane:hover::after, body.focused .pane::after { color: var(--label-hover-color, var(--text-2, #ddd)); }
.list { flex: 1; overflow-y: auto; overflow-x: hidden; outline: none; padding: 8px 0; scrollbar-width: thin; scrollbar-color: var(--bg-1, #444) transparent; }
[data-cursor] { outline: 1px dashed var(--text-5, #666); outline-offset: -1px; }
body:not(.focused) [data-cursor] { outline: none; }
.badge { margin-left: auto; min-width: 16px; padding: 0 4px; font-size: 11px; line-height: 16px; text-align: center; font-weight: 500;
  background: var(--accent-new, var(--red-2, #e66)); color: var(--text-0, #111); }
.empty { padding: 4px 12px; color: var(--text-5, #666); }

/* nav */
.pane-nav .list { padding: 10px 0; display: flex; flex-direction: column; align-items: center; gap: 8px; scrollbar-width: none; }
.srv { position: relative; width: 40px; height: 40px; flex: none; cursor: pointer; display: grid; place-items: center;
  background: var(--bg-3, #222); color: var(--text-4, #999); transition: background var(--list-item-transition, .2s ease); }
.srv img { width: 40px; height: 40px; object-fit: cover; opacity: .75; transition: opacity var(--list-item-transition, .2s ease); }
body.mouse .srv:hover img, .srv.sel img, body.focused .srv[data-cursor] img { opacity: 1; }
/* the cursor sits outside the icon: inside it, the (faded) icon image paints over the outline */
.srv[data-cursor] { outline: 1px dashed var(--text-3, #bbb); outline-offset: 3px; }
body.mouse .srv:hover { background: var(--hover); color: var(--text-2); }
.srv.sel { background: var(--active); color: var(--text-1); }
.srv::before { content: ""; position: absolute; left: -10px; width: 4px; height: 0; background: var(--text-1, #eee); transition: height var(--list-item-transition, .2s ease); }
.srv.unread::before { height: 8px; }
body.mouse .srv:hover::before { height: 20px; }
.srv.sel::before { height: 32px; }
.srv .ico svg { width: 22px; height: 22px; }
.srv .acr { font-size: 12px; }
.srv .badge { position: absolute; right: -4px; bottom: -4px; margin: 0; }
.sep { width: 24px; height: 2px; flex: none; background: var(--border, #333); }
.folder { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 6px 0; width: 54px; flex: none;
  border: 1px solid color-mix(in oklch, var(--fc) 70%, transparent); background: color-mix(in oklch, var(--fc) 10%, transparent); }
.srv.fhead { background: transparent; color: var(--fc); }
.srv.fhead svg { width: 22px; height: 22px; }
.srv.fold { display: grid; grid-template-columns: 1fr 1fr; gap: 2px; padding: 3px; place-items: stretch;
  background: color-mix(in oklch, var(--fc) 22%, var(--bg-3, #222)); }
.srv.fold .mini { width: 16px; height: 16px; object-fit: cover; opacity: .85; }
.srv.fold .mini.acr { display: grid; place-items: center; font-size: 9px; background: var(--bg-2, #333); color: var(--text-3, #bbb); }
body.focused .srv.fold[data-cursor] .mini, body.mouse .srv.fold:hover .mini { opacity: 1; }

/* channels */
.head { padding: 10px 12px 8px; color: var(--text-2, #ddd); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  border-bottom: 1px solid var(--border-light, var(--border, #333)); }
.filter { display: none; margin: 8px 8px 0; padding: 4px 8px; font: inherit; color: var(--text-2, #ddd); background: var(--bg-3, #222);
  border: 1px solid var(--border, #333); outline: none; }
.filter:focus, .filter:not(:placeholder-shown) { display: block; }
.filter:focus { border-color: var(--border-hover, #888); }
.cat { padding: 12px 12px 4px; color: var(--text-5, #666); font-size: 12px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
body.mouse .cat:hover { color: var(--text-3, #bbb); }
.ch { display: flex; align-items: center; gap: 6px; margin: 1px 8px; padding: 3px 8px; padding-left: calc(8px + var(--depth, 0) * 14px);
  color: var(--text-4, #999); cursor: pointer; white-space: nowrap; transition: background var(--list-item-transition, .2s ease), color var(--list-item-transition, .2s ease); }
.ch .pfx { color: var(--text-5, #666); width: 1ch; flex: none; text-align: center; }
.ch .name { overflow: hidden; text-overflow: ellipsis; }
body.mouse .ch:hover { background: var(--hover); color: var(--text-3, #bbb); }
.ch.unread { color: var(--text-1, #eee); font-weight: 500; }
.ch.muted { color: var(--text-5, #666); }
.ch.sel { background: var(--active); color: var(--text-1, #eee); }
.ch.dm { padding-top: 4px; padding-bottom: 4px; }
.av { position: relative; width: 24px; height: 24px; flex: none; background: var(--bg-2, #333); }
.av img { width: 100%; height: 100%; object-fit: cover; }
.st { position: absolute; right: -3px; bottom: -3px; width: 8px; height: 8px; border: 2px solid var(--bg-4, #181818); background: var(--offline, #777); }
.st-online { background: var(--online, #4a8); } .st-idle { background: var(--idle, #cb5); } .st-dnd { background: var(--dnd, #e66); }

/* help */
.list.help { padding: 6px 16px 12px; user-select: text; }
.help section { margin-top: 10px; }
.help h3 { margin: 6px 0 6px; font-size: 12px; font-weight: 500; color: var(--text-5, #666); text-transform: lowercase; }
.hk { display: flex; gap: 12px; align-items: baseline; padding: 3px 0; }
.hk .keys { flex: none; width: 190px; display: flex; flex-wrap: wrap; gap: 4px; }
.hk .desc { color: var(--text-3, #bbb); }
kbd { font: inherit; font-size: 12px; padding: 0 6px; color: var(--text-1, #eee); background: var(--bg-2, #333);
  border: 1px solid var(--border, #444); white-space: nowrap; }
.help .foot { margin: 14px 0 0; color: var(--text-5, #666); font-size: 12px; }

/* user */
.pane-user .list { padding: 10px 12px; display: flex; flex-direction: column; justify-content: center; gap: 10px; overflow: hidden; }
.me { display: flex; align-items: center; gap: 12px; }
.me .av { width: 44px; height: 44px; }
.me { cursor: pointer; }
body.mouse .me:hover { background: var(--hover); }
.who { display: flex; flex-direction: column; min-width: 0; flex: 1; line-height: 1.25; }
.who > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.who .name { color: var(--text-2, #ddd); }
.who .sub { color: var(--text-5, #666); font-size: 12px; }
.who .status { color: var(--text-4, #999); font-size: 12px; }
.vc { display: flex; align-items: center; gap: 8px; color: var(--online, #4a8); font-size: 12px; }
.vc .vcname { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vc .dim { color: var(--text-5, #666); }
.btnrow { display: flex; gap: 6px; }
.tbtn { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 5px 0; font-size: 12px;
  border: 1px solid var(--border, #333); color: var(--text-4, #999); cursor: pointer;
  transition: background var(--list-item-transition, .2s ease), color var(--list-item-transition, .2s ease); }
.tbtn svg { width: 15px; height: 15px; flex: none; }
body.mouse .tbtn:hover { background: var(--hover); color: var(--text-2, #ddd); }
.tbtn.danger { color: var(--accent-new, var(--red-2, #e66)); border-color: var(--accent-new, var(--red-2, #e66)); }
.tbtn.slim { flex: none; padding: 2px 8px; }
`;
