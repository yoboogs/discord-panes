/**
 * @name PanePopout
 * @author yoboogs
 * @authorLink https://github.com/yoboogs
 * @description Splits Discord into tiled Hyprland windows (nav, channels, user) beside the main chat window, keyboard-driven, styled like the system24 theme and optionally following the Omarchy theme. Needs Hyprland and the discord-panes helper from the source repo.
 * @version 1.0.0
 * @source https://github.com/yoboogs/discord-panes
 * @website https://github.com/yoboogs/discord-panes
 */

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
const PANES = ["nav", "channels", "user"]; // the helper tiles them in this order
const RUN = path.join(globalThis.process?.env?.XDG_RUNTIME_DIR || "/tmp", "discord-panes");
const TO_HYPR = path.join(RUN, "to-hypr");       // messages for the helper (window management)
const TO_DISCORD = path.join(RUN, "to-discord"); // messages for this plugin
const DIAG_FILE = path.join(RUN, "diag.json");
const PIDFILE = path.join(RUN, "daemon.pid");
const HOME = globalThis.process?.env?.HOME || "";
const OMARCHY_COLORS = path.join(HOME, ".local/state/omarchy/current/theme/colors.toml");
const OMARCHY_FONTCONF = path.join(HOME, ".config/fontconfig/fonts.conf"); // written by `omarchy font set`

// Theme variables copied from the main window so the panes match system24 (or any theme).
const THEME_VARS = [
  "--bg-1", "--bg-2", "--bg-3", "--bg-4", "--text-0", "--text-1", "--text-2", "--text-3", "--text-4", "--text-5",
  "--hover", "--active", "--border", "--border-light", "--border-hover", "--border-thickness", "--gap",
  "--accent-1", "--accent-2", "--accent-3", "--accent-new", "--online", "--idle", "--dnd", "--offline",
  "--label-color", "--label-hover-color", "--label-font-weight", "--background-base-low", "--background-base-lower",
  "--text-muted", "--text-normal", "--brand-360", "--border-hover-transition", "--list-item-transition", "--red-2",
];

// The cheat sheet shown in the help pane. Keep in sync with onKey() and the Hyprland binds.
const HELP_SECTIONS = [
  ["anywhere (hyprland)", [
    ["super alt d", "split discord into panes / put it back together"],
    ["super alt shift d", "show / hide this help"],
    ["super ← → ↑ ↓", "move between panes"],
    ["super shift ← → ↑ ↓", "swap panes around"],
    ["super w", "close a pane (puts discord back together)"],
  ]],
  ["in any pane", [
    ["j k  ↓ ↑", "move the cursor"],
    ["g G  home end", "jump to top / bottom"],
    ["enter l → space", "open what's under the cursor"],
    ["esc", "back to the chat input"],
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
  ["user", [
    ["m", "mute / unmute"],
    ["d", "deafen / undeafen"],
    ["s", "open discord settings"],
  ]],
];
const HELP_HTML = HELP_SECTIONS.map(([title, keys]) =>
  `<section><h3>${title}</h3>${keys.map(([k, d]) => `<div class="hk"><span class="keys">${k.split("  ").map((g) => `<kbd>${g}</kbd>`).join(" ")}</span><span class="desc">${d}</span></div>`).join("")}</section>`
).join("") + `<p class="foot">esc, q or ? to close</p>`;

const CHANNEL = { TEXT: 0, VOICE: 2, CATEGORY: 4, ANNOUNCEMENT: 5, STAGE: 13, FORUM: 15, MEDIA: 16 };

const ICONS = {
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  dm: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  mic: '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>',
  headphones: '<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  slash: '<line x1="2" y1="2" x2="22" y2="22"/>',
  hangup: '<path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"/><line x1="23" y1="1" x2="1" y2="23"/>',
};
const svg = (name, extra = "") =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}${extra}</svg>`;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safe = (fn, fallback) => { try { const v = fn(); return v === undefined ? fallback : v; } catch (e) { return fallback; } };

// ---------------------------------------------------------------------------
// File-based IPC with the `discord-panes` helper. BetterDiscord plugins can't run
// programs or open sockets, but they can read/write/watch files. Messages are fixed
// actions (open/dock/focus/diag); nothing here executes code it receives.
// ---------------------------------------------------------------------------
let msgSeq = 0;
function post(dir, msg) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const name = `${Date.now()}-${String(msgSeq++).padStart(6, "0")}.json`;
    const tmp = path.join(dir, "." + name);
    fs.writeFileSync(tmp, JSON.stringify(msg));
    fs.renameSync(tmp, path.join(dir, name)); // atomic: readers never see half a message
  } catch (e) { console.warn("[PanePopout] post failed", e); }
}
function takeAll(dir) {
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => !n.startsWith(".")).sort(); } catch (e) { return []; }
  const out = [];
  for (const n of names) {
    const p = path.join(dir, n);
    try { const msg = JSON.parse(fs.readFileSync(p, "utf8")); fs.unlinkSync(p); out.push(msg); }
    catch (e) { try { fs.unlinkSync(p); } catch (_) {} }
  }
  return out;
}
function helperAlive() {
  try { const pid = String(fs.readFileSync(PIDFILE, "utf8")).trim(); return !!pid && fs.existsSync(`/proc/${pid}`); }
  catch (e) { return false; }
}

// ---------------------------------------------------------------------------
// Omarchy theme: map the current theme's colors.toml onto the Discord theme's palette
// variables (system24/midnight names), so Discord and the panes follow Omarchy.
// ---------------------------------------------------------------------------
function readOmarchy() {
  let colorsText = "", fontText = "";
  try { colorsText = String(fs.readFileSync(OMARCHY_COLORS, "utf8")); } catch (e) { return null; }
  try { fontText = String(fs.readFileSync(OMARCHY_FONTCONF, "utf8")); } catch (e) {}
  const c = {};
  for (const line of colorsText.split("\n")) {
    const m = line.match(/^\s*([a-z_]+)\s*=\s*"([^"]*)"/);
    if (m) c[m[1]] = m[2];
  }
  if (!c.background || !c.foreground) return null;
  // omarchy font set writes <edit name="family" ...><string>FONT</string> for monospace
  const font = (fontText.match(/<edit[^>]*name="family"[^>]*>\s*<string>([^<]+)<\/string>/) || [])[1] || null;
  return { c, font, key: colorsText + "\n" + (font || "") };
}

function omarchyCss({ c, font }) {
  const mix = (a, b, pct) => `color-mix(in oklab, ${a}, ${b} ${pct}%)`;
  const bg = c.background, fg = c.foreground, sel = c.selection || mix(bg, fg, 20);
  const accent = c.accent || c.blue, red = c.red, border = c.active_border_color || accent;
  const shades = (base, bright) => [bright || base, base, mix(base, bg, 12), mix(base, bg, 24), mix(base, bg, 36)];
  const ramp = (name, base, bright) => shades(base, bright).map((v, i) => `--${name}-${i + 1}:${v};`).join("");
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
  return `:root:root, html body { ${vars} } html body { font-weight: 400; letter-spacing: normal; }`;
}

module.exports = class PanePopout {
  constructor() {
    this.wins = {};      // pane -> { win, doc, box, list, header, filter }
    this.cursor = {};    // pane -> keyboard cursor index
    this.items = {};     // pane -> actionable rows, in render order
    this.filterText = "";
    this.collapsed = new Set();
    this.openFolders = new Set();
    this.geom = {};      // pane -> {w, h}: the window's real tiled size, from the helper
    this.followOmarchy = true;
  }

  // -------------------------------------------------------------------------
  // lifecycle
  // -------------------------------------------------------------------------
  start() {
    this.collapsed = new Set(BdApi.Data.load("PanePopout", "collapsed") || []);
    this.openFolders = new Set(BdApi.Data.load("PanePopout", "openFolders") || []);
    this.followOmarchy = BdApi.Data.load("PanePopout", "followOmarchy") ?? true;
    this.applyOmarchy(true);
    this.loadModules();
    this.subscribe();
    this.addSplitButton();
    this.onMainKey = (e) => this.friendsKey(e);
    document.addEventListener("keydown", this.onMainKey, true);
    BdApi.DOM.addStyle("PanePopout-friends",
      `[data-pp-cursor]{outline:1px dashed var(--text-3,#bbb)!important;outline-offset:-2px;background:var(--hover)!important}`);
    for (const d of [TO_HYPR, TO_DISCORD]) { try { fs.mkdirSync(d, { recursive: true }); } catch (e) {} }
    takeAll(TO_DISCORD); // drop stale commands from before a reload
    try { this.watcher = fs.watch(TO_DISCORD, {}, () => this.pollInbox()); } catch (e) { console.warn("[PanePopout] watch failed", e); }
    this.poller = setInterval(() => this.pollInbox(), 400);
    this.themeTimer = setInterval(() => { this.applyOmarchy(); this.syncTheme(); }, 2000);
    this.writeDiag();
    const resplitAt = BdApi.Data.load("PanePopout", "resplitAt");
    if (resplitAt) {
      BdApi.Data.delete("PanePopout", "resplitAt");
      if (Date.now() - resplitAt < 10000 && helperAlive()) setTimeout(() => post(TO_HYPR, { action: "split" }), 1500);
    }
  }

  stop() {
    // If the plugin is being reloaded (e.g. after an update) while split, split again on start.
    if (this.isSplit()) BdApi.Data.save("PanePopout", "resplitAt", Date.now());
    this.dockAll();
    post(TO_HYPR, { action: "docked" });
    clearInterval(this.poller);
    clearInterval(this.themeTimer);
    clearTimeout(this.renderTimer); this.renderTimer = null;
    try { this.watcher?.close(); } catch (e) {}
    this.unsubscribe?.();
    this.splitBtn?.remove();
    document.removeEventListener("keydown", this.onMainKey, true);
    BdApi.DOM.removeStyle("PanePopout-friends");
    document.querySelectorAll("[data-pp-cursor]").forEach((el) => el.removeAttribute("data-pp-cursor"));
    BdApi.DOM.removeStyle("PanePopout-omarchy");
    this.omarchyKey = null;
  }

  // Swap the Discord theme's palette for Omarchy's (live: rechecked every 2s).
  applyOmarchy(force) {
    if (!this.followOmarchy) {
      if (this.omarchyKey !== null || force) { BdApi.DOM.removeStyle("PanePopout-omarchy"); this.omarchyKey = null; this.syncTheme(true); }
      return;
    }
    const o = readOmarchy();
    if (!o) return;
    if (!force && o.key === this.omarchyKey) return;
    this.omarchyKey = o.key;
    BdApi.DOM.removeStyle("PanePopout-omarchy");
    BdApi.DOM.addStyle("PanePopout-omarchy", omarchyCss(o));
    this.syncTheme(true);
  }

  getSettingsPanel() {
    const wrap = document.createElement("div");
    wrap.style.cssText = "padding:8px 0;color:var(--text-normal,#ddd);line-height:1.4";
    wrap.innerHTML =
      `<label style="display:flex;gap:10px;align-items:center;cursor:pointer"><input type="checkbox"> Follow the Omarchy theme (colours and font)</label>` +
      `<div style="opacity:.7;margin-top:6px;font-size:13px">Keeps your Discord theme's layout and panel labels but uses the current Omarchy theme's colours and monospace font, and follows Omarchy theme changes live. Turn off to use the Discord theme's own palette.</div>`;
    const cb = wrap.querySelector("input");
    cb.checked = this.followOmarchy;
    cb.onchange = () => { this.followOmarchy = cb.checked; BdApi.Data.save("PanePopout", "followOmarchy", cb.checked); this.applyOmarchy(true); };
    return wrap;
  }

  // -------------------------------------------------------------------------
  // Discord internals
  // -------------------------------------------------------------------------
  loadModules() {
    const W = BdApi.Webpack;
    const st = (n) => safe(() => W.getStore(n), null);
    this.S = {
      Guild: st("GuildStore"), SortedGuild: st("SortedGuildStore"), SelectedGuild: st("SelectedGuildStore"),
      SelectedChannel: st("SelectedChannelStore"), GuildChannel: st("GuildChannelStore"), Channel: st("ChannelStore"),
      ReadState: st("ReadStateStore"), GuildReadState: st("GuildReadStateStore"), User: st("UserStore"),
      PrivateSort: st("PrivateChannelSortStore"), Threads: st("ActiveJoinedThreadsStore"),
      GuildSettings: st("UserGuildSettingsStore"), Presence: st("PresenceStore"), Media: st("MediaEngineStore"),
      RTC: st("RTCConnectionStore"),
    };
    this.transitionTo =
      safe(() => W.getByStrings("transitionTo - Transitioning to", { searchExports: true }), null) ||
      safe(() => W.getModule((m) => typeof m === "function" && String(m).includes("transitionTo - Transitioning to"), { searchExports: true }), null);
  }

  // Read-only health report for `discord-panes diag`: which Discord internals were found,
  // counts, pane sizes and theme values. No names, IDs or message content are recorded.
  writeDiag() {
    const S = this.S;
    const methods = [
      ["SortedGuild", "getGuildFolders"], ["SelectedChannel", "getMostRecentSelectedTextChannelId"],
      ["GuildChannel", "getChannels"], ["PrivateSort", "getPrivateChannelIds"],
      ["Threads", "getActiveJoinedThreadsForGuild"], ["GuildReadState", "getMentionCount"],
      ["Media", "isSelfMute"], ["RTC", "getChannelId"],
    ];
    const cs = getComputedStyle(document.body);
    const diag = {
      version: "1.0.0",
      time: new Date().toISOString(),
      stores: Object.fromEntries(Object.entries(S).map(([k, v]) => [k, !!v])),
      transitionTo: typeof this.transitionTo,
      methods: Object.fromEntries(methods.map(([st, m]) => [`${st}.${m}`, typeof S[st]?.[m]])),
      counts: {
        guilds: safe(() => S.Guild.getGuildCount(), null),
        folders: safe(() => S.SortedGuild.getGuildFolders().length, null),
        privateChannels: this.privateChannelIds().length,
      },
      userPanelButtonsFound: ["mute", "deafen", "settings"].map((n) => [n, !!this.findPanelButton({ mute: /^(un)?mute$/i, deafen: /^(un)?deafen$/i, settings: /user settings/i }[n])]),
      friendsPage: { open: !!document.querySelector('[class*="peopleColumn_"]') },
      split: Object.keys(this.wins),
      panes: Object.fromEntries(Object.entries(this.wins).map(([k, w]) => [k, w.doc ? {
        rows: (this.items[k] || []).length, tile: this.geom[k] || null, page: [w.win.innerWidth, w.win.innerHeight],
        box: w.box ? [w.box.clientWidth, w.box.clientHeight] : null,
      } : { loading: true }])),
      theme: {
        followOmarchy: this.followOmarchy, omarchyFound: !!readOmarchy(),
        vars: Object.fromEntries(["--bg-4", "--text-3", "--accent-2", "--border-hover"].map((v) => [v, cs.getPropertyValue(v).trim()])),
        font: cs.fontFamily,
      },
    };
    try { fs.writeFileSync(DIAG_FILE, JSON.stringify(diag, null, 1)); } catch (e) { console.warn("[PanePopout] diag failed", e); }
  }

  subscribe() {
    const stores = Object.values(this.S).filter((s) => s?.addChangeListener);
    const fn = () => this.scheduleRender();
    for (const s of stores) s.addChangeListener(fn);
    this.unsubscribe = () => { for (const s of stores) s.removeChangeListener(fn); };
  }

  go(p) {
    if (typeof this.transitionTo === "function") return this.transitionTo(p);
    BdApi.UI.showToast("PanePopout: couldn't find Discord's navigation function", { type: "error" });
  }

  // -------------------------------------------------------------------------
  // split / dock
  // -------------------------------------------------------------------------
  isSplit() { return PANES.some((p) => this.wins[p]); }

  // Help: the helper floats and centres it; without the helper it just opens.
  toggleHelp() {
    if (this.wins.help) { try { this.wins.help.win.close(); } catch (e) {} return; }
    if (helperAlive()) post(TO_HYPR, { action: "help" });
    else this.openPane("help");
  }

  // The split button and `discord-panes toggle` both go through the helper so it can
  // tile the windows. Without the helper the panes still open, just untiled.
  requestToggle() {
    if (helperAlive()) return post(TO_HYPR, { action: "toggle" });
    if (this.isSplit()) return this.dockAll();
    BdApi.UI.showToast("PanePopout: the discord-panes helper isn't running, so the panes won't be tiled", { type: "warning" });
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

  openPane(pane) {
    if ((!PANES.includes(pane) && pane !== "help") || this.wins[pane]) return;
    // Discord's main process only allows window.open for frame names starting with
    // DISCORD_ and a same-origin "/popout" URL.
    const win = window.open(`${location.origin}/popout`, `DISCORD_PANES_${pane}`, "popup=yes,width=320,height=600");
    if (!win) return BdApi.UI.showToast(`PanePopout: couldn't open ${pane}`, { type: "error" });
    this.wins[pane] = { win, doc: null };
    const t0 = Date.now();
    const wait = setInterval(() => {
      let ready = false;
      try { ready = win.document?.readyState === "complete" && !!win.document.body; } catch (e) {}
      if (ready || Date.now() - t0 > 10000) {
        clearInterval(wait);
        if (!ready) return BdApi.UI.showToast(`PanePopout: ${pane} never loaded`, { type: "error" });
        setTimeout(() => this.setupPane(pane, win), 300); // let the popout's own bootstrap settle
      }
    }, 50);
    if (PANES.includes(pane)) this.applyMainLayout(true);
  }

  dockAll() {
    this.docking = true;
    this.geom = {};
    for (const [pane, w] of Object.entries(this.wins)) { try { w.win.close(); } catch (e) {} delete this.wins[pane]; }
    this.docking = false;
    this.applyMainLayout(false);
  }

  onPaneClosed(pane) {
    if (!this.wins[pane]) return;
    delete this.wins[pane];
    if (pane === "help") return post(TO_HYPR, { action: "help-closed" });
    if (this.docking) return;
    // Closing any pane (e.g. SUPER+W) ends the split and gives the main window its sidebar back.
    this.dockAll();
    post(TO_HYPR, { action: "docked" });
  }

  // While split, the main window drops its sidebar (nav, channels, user) and becomes
  // channel + chat + input.
  applyMainLayout(split) {
    BdApi.DOM.removeStyle("PanePopout-main");
    if (!split) return;
    const nav = document.querySelector('nav[class*="guilds_"]');
    const sidebar = nav?.parentElement;
    const sidebarCls = [...(sidebar?.classList || [])].find((c) => c.startsWith("sidebar_"));
    const page = [...(sidebar?.parentElement?.children || [])].find((el) => [...el.classList].some((c) => c.startsWith("page_")));
    const pageCls = [...(page?.classList || [])].find((c) => c.startsWith("page_"));
    let css = "#pp-split{display:none!important}"; // the panes have their own controls
    if (sidebarCls) css += `.${sidebarCls}{display:none!important}`;
    if (pageCls) css += `.${pageCls}{grid-column:1/-1!important}`;
    BdApi.DOM.addStyle("PanePopout-main", css);
  }

  // -------------------------------------------------------------------------
  // inbox: fixed commands from the helper
  // -------------------------------------------------------------------------
  pollInbox() {
    for (const msg of takeAll(TO_DISCORD)) {
      try { this.handle(msg); } catch (e) { console.error("[PanePopout] command failed", msg, e); }
    }
  }

  handle(msg) {
    switch (msg?.action) {
      case "open": return this.openPane(msg.pane);
      case "close": try { this.wins[msg.pane]?.win.close(); } catch (e) {} return;
      case "dock": return this.dockAll();
      case "split": for (const p of PANES) this.openPane(p); return;
      case "focus-input": return this.focusChatInput();
      case "diag": return this.writeDiag();
      case "geometry": this.geom[msg.pane] = { w: +msg.w, h: +msg.h }; return this.applyGeometry(msg.pane);
    }
  }

  // -------------------------------------------------------------------------
  // pane windows
  // -------------------------------------------------------------------------
  setupPane(pane, win) {
    if (!this.wins[pane] || this.wins[pane].win !== win) return;
    const doc = win.document;
    // Throw away the popout page's own content/styles; we draw everything ourselves.
    doc.head.querySelectorAll('style, link[rel="stylesheet"]').forEach((el) => el.remove());
    doc.body.replaceChildren();
    doc.body.removeAttribute("class");
    doc.title = `Discord · ${pane}`;

    const themeStyle = doc.createElement("style"); themeStyle.id = "pp-theme"; doc.head.appendChild(themeStyle);
    const base = doc.createElement("style"); base.id = "pp-base"; base.textContent = BASE_CSS; doc.head.appendChild(base);

    const box = doc.createElement("div");
    box.className = `pane pane-${pane}`;
    box.dataset.label = pane;
    box.innerHTML = pane === "channels"
      ? `<div class="head"></div><input class="filter" placeholder="filter…" spellcheck="false"><div class="list" tabindex="0"></div>`
      : pane === "help" ? `<div class="list help" tabindex="0">${HELP_HTML}</div>`
      : `<div class="list" tabindex="0"></div>`;
    doc.body.appendChild(box);

    const w = this.wins[pane];
    Object.assign(w, { doc, box, list: box.querySelector(".list"), header: box.querySelector(".head"), filter: box.querySelector(".filter") });

    win.addEventListener("focus", () => doc.body.classList.add("focused"));
    win.addEventListener("blur", () => doc.body.classList.remove("focused"));
    win.addEventListener("beforeunload", () => this.onPaneClosed(pane));
    doc.addEventListener("keydown", (e) => this.onKey(pane, e));
    w.list.addEventListener("click", (e) => this.onClick(pane, e));
    w.filter?.addEventListener("input", () => { this.filterText = w.filter.value; this.cursor.channels = 0; this.render("channels"); });
    this.syncTheme(true);
    this.applyGeometry(pane);
    this.render(pane);
    setTimeout(() => w.list.focus(), 50);
  }

  // Discord forces popouts to be at least 320x180, so when Hyprland tiles a pane smaller
  // the page keeps rendering at that size and gets cropped from the top-left. Lay the box
  // out for the size Hyprland actually shows.
  applyGeometry(pane) {
    const w = this.wins[pane], g = this.geom[pane];
    if (!w?.doc || !g) return;
    const root = w.doc.documentElement;
    root.style.setProperty("--pp-w", `${g.w}px`);
    root.style.setProperty("--pp-h", `${g.h}px`);
    w.doc.body.classList.add("sized");
  }

  // Copy the active BetterDiscord theme (fonts, @imports) and the main window's resolved
  // colour variables into every pane, so they look like the theme's own panels.
  syncTheme(force) {
    const panes = Object.values(this.wins).filter((w) => w.doc);
    if (!panes.length) return;
    const cs = getComputedStyle(document.body);
    const vars = THEME_VARS.map((v) => [v, cs.getPropertyValue(v).trim()]).filter(([, val]) => val);
    // Only the resolved variables and the font files are copied, not the theme's rules:
    // its broad selectors (e.g. [class*="list"]) would otherwise restyle the panes' own markup.
    const text =
      ":root,html body{" + vars.map(([k, v]) => `${k}:${v};`).join("") +
      `--pp-font:${cs.fontFamily};--pp-weight:${cs.fontWeight};--pp-spacing:${cs.letterSpacing};}`;
    if (!force && text === this.lastTheme) return;
    this.lastTheme = text;
    for (const w of panes) {
      const el = w.doc.getElementById("pp-theme");
      if (el) el.textContent = text;
      // Hand the main window's loaded webfonts (e.g. system24's DM Mono) to the pane.
      for (const f of document.fonts) {
        if (f.status === "loaded") { try { w.doc.fonts.add(f); } catch (e) {} }
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

  render(pane) {
    const w = this.wins[pane];
    if (!w?.doc || pane === "help") return;
    try {
      const rows = pane === "nav" ? this.navRows() : pane === "channels" ? this.channelRows() : this.userRows();
      const actRows = rows.filter((r) => r.act);
      this.items[pane] = actRows.map((r) => r.act);
      if (this.cursor[pane] == null || this.cursor[pane] >= actRows.length) {
        this.cursor[pane] = Math.max(0, actRows.findIndex((r) => r.selected));
      }
      const scroll = w.list.scrollTop;
      let i = 0;
      w.list.innerHTML = rows.map((r) => {
        if (!r.act) return r.html;
        const idx = i++;
        return r.html.replace("<div ", `<div data-i="${idx}" ${idx === this.cursor[pane] ? "data-cursor " : ""}`);
      }).join("");
      w.list.scrollTop = scroll;
      if (w.header) w.header.textContent = this.currentGuildName();
    } catch (e) {
      console.error("[PanePopout] render failed", pane, e);
      w.list.textContent = "render error: " + e.message;
    }
  }

  // ----- nav ---------------------------------------------------------------
  navRows() {
    const { SortedGuild, Guild, GuildReadState, SelectedGuild, GuildSettings, ReadState } = this.S;
    const selected = safe(() => SelectedGuild.getGuildId(), null);
    const rows = [];
    const dmMentions = this.privateChannelIds().reduce((n, id) => n + (safe(() => ReadState.getMentionCount(id), 0) || 0), 0);
    rows.push({
      act: { kind: "dms" }, selected: !selected,
      html: `<div class="srv dms ${!selected ? "sel" : ""}" title="direct messages"><span class="ico">${svg("dm")}</span>${dmMentions ? `<b class="badge">${dmMentions}</b>` : ""}</div>`,
    });
    rows.push({ html: `<div class="sep"></div>` });
    const folders = safe(() => SortedGuild.getGuildFolders(), null) ||
      (safe(() => SortedGuild.getFlattenedGuildIds(), []) || []).map((id) => ({ guildIds: [id] }));
    const guildRow = (id, g) => {
      const muted = safe(() => GuildSettings.isMuted(id), false);
      const unread = !muted && safe(() => GuildReadState.hasUnread(id), false);
      const mentions = safe(() => GuildReadState.getMentionCount(id), 0) || 0;
      return {
        act: { kind: "guild", id }, selected: id === selected,
        html: `<div class="srv ${id === selected ? "sel" : ""} ${unread ? "unread" : ""}" title="${esc(g.name)}">${this.guildIcon(id, g)}${mentions ? `<b class="badge">${mentions}</b>` : ""}</div>`,
      };
    };
    for (const f of folders) {
      const guilds = (f.guildIds || []).map((id) => [id, safe(() => Guild.getGuild(id), null)]).filter(([, g]) => g);
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
      rows.push({ html: `</div>` });
    }
    return rows;
  }

  guildIcon(id, g) {
    return g.icon
      ? `<img src="https://cdn.discordapp.com/icons/${id}/${g.icon}.${g.icon.startsWith("a_") ? "gif" : "webp"}?size=96" alt="">`
      : `<span class="acr">${esc(g.acronym || (g.name || "").split(/\s+/).map((w) => w[0]).join("").slice(0, 3))}</span>`;
  }

  // ----- channels ----------------------------------------------------------
  currentGuildName() {
    const gid = safe(() => this.S.SelectedGuild.getGuildId(), null);
    if (!gid) return "direct messages";
    return safe(() => this.S.Guild.getGuild(gid).name, "") || "";
  }

  privateChannelIds() {
    const { PrivateSort, Channel } = this.S;
    return safe(() => PrivateSort.getPrivateChannelIds(), null) ||
      safe(() => Channel.getSortedPrivateChannels().map((c) => c.id), []) || [];
  }

  channelRows() {
    const gid = safe(() => this.S.SelectedGuild.getGuildId(), null);
    return gid ? this.guildChannelRows(gid) : this.dmRows();
  }

  channelRow(c, { gid, depth = 0, prefix = "#" }) {
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

  guildChannelRows(gid) {
    const { GuildChannel, Threads, SelectedChannel } = this.S;
    const all = safe(() => GuildChannel.getChannels(gid), {}) || {};
    const text = (all.SELECTABLE || []).map((e) => e.channel).filter(Boolean);
    const voice = (all.VOCAL || []).map((e) => e.channel).filter(Boolean);
    const cats = (all[CHANNEL.CATEGORY] || []).map((e) => e.channel).filter((c) => c && c.id !== "null");
    const byPos = (a, b) => (a.position ?? 0) - (b.position ?? 0) || (a.id < b.id ? -1 : 1);
    const selectedId = safe(() => SelectedChannel.getChannelId(), null);
    const prefixFor = (c) => (c.type === CHANNEL.VOICE || c.type === CHANNEL.STAGE ? "♪" : c.type === CHANNEL.FORUM || c.type === CHANNEL.MEDIA ? "≡" : "#");

    // threads you've joined, keyed by parent channel
    const threadsByParent = {};
    const tmap = safe(() => Threads.getActiveJoinedThreadsForGuild(gid), {}) || {};
    for (const [parentId, threads] of Object.entries(tmap)) {
      threadsByParent[parentId] = Object.values(threads || {}).map((t) => t?.channel || t).filter((t) => t?.id);
    }

    const filter = this.filterText.trim().toLowerCase();
    if (filter) {
      const matches = [...text, ...voice, ...Object.values(threadsByParent).flat()].filter((c) => (c.name || "").toLowerCase().includes(filter));
      return matches.length ? matches.map((c) => this.channelRow(c, { gid, prefix: prefixFor(c) })) : [{ html: `<div class="empty">no matches</div>` }];
    }

    const groups = new Map([[null, { cat: null, items: [] }]]);
    for (const cat of cats.sort(byPos)) groups.set(cat.id, { cat, items: [] });
    for (const c of [...text.sort(byPos), ...voice.sort(byPos)]) (groups.get(c.parent_id) || groups.get(null)).items.push(c);

    const rows = [];
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

  dmName(c) {
    if (c.name) return c.name;
    const ids = c.recipients || [];
    const names = ids.map((id) => { const u = safe(() => this.S.User.getUser(id), null); return u ? (u.globalName || u.username) : null; }).filter(Boolean);
    return names.join(", ") || "unknown";
  }

  dmAvatar(c) {
    if (c.icon) return `https://cdn.discordapp.com/channel-icons/${c.id}/${c.icon}.webp?size=64`;
    const id = (c.recipients || [])[0];
    const u = id && safe(() => this.S.User.getUser(id), null);
    return u ? safe(() => u.getAvatarURL(null, 64), null) : null;
  }

  dmRows() {
    const { Channel, ReadState, SelectedChannel, Presence } = this.S;
    const sel = safe(() => SelectedChannel.getChannelId(), null);
    const filter = this.filterText.trim().toLowerCase();
    const rows = [];
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
    if (!rows.length) rows.push({ html: `<div class="empty">no matches</div>` });
    return rows;
  }

  // ----- user --------------------------------------------------------------
  userRows() {
    const { User, Media, Presence, RTC, Channel, Guild } = this.S;
    const me = safe(() => User.getCurrentUser(), null);
    const mute = safe(() => Media.isSelfMute(), false);
    const deaf = safe(() => Media.isSelfDeaf(), false);
    const status = me ? safe(() => Presence.getStatus(me.id), "online") : "online";
    const custom = me ? safe(() => (Presence.getActivities(me.id) || []).find((a) => a.type === 4), null) : null;
    const statusText = (custom && (custom.state || custom.emoji?.name)) ||
      ({ online: "online", idle: "idle", dnd: "do not disturb", invisible: "invisible", offline: "offline" }[status] || status);
    const av = me ? safe(() => me.getAvatarURL(null, 80), null) : null;
    const vcId = safe(() => RTC.getChannelId(), null);
    const vc = vcId ? safe(() => Channel.getChannel(vcId), null) : null;
    const vcWhere = vc?.guild_id ? safe(() => Guild.getGuild(vc.guild_id).name, "") : "";
    const rows = [];
    rows.push({
      html: `<div class="me"><span class="av">${av ? `<img src="${esc(av)}" alt="">` : ""}<i class="st st-${esc(status)}"></i></span>` +
        `<span class="who"><span class="name">${esc(me?.globalName || me?.username || "")}</span>` +
        `<span class="sub">${esc(me?.username || "")}</span><span class="status">${esc(statusText)}</span></span></div>`,
    });
    if (vc) {
      rows.push({ html: `<div class="vc"><span class="vcname">vc: ${esc(vc.name)}${vcWhere ? ` <span class="dim">/ ${esc(vcWhere)}</span>` : ""}</span>` });
      rows.push({ act: { kind: "disconnect" }, html: `<div class="tbtn danger slim" title="disconnect">${svg("hangup")}<span>leave</span></div>` });
      rows.push({ html: `</div>` });
    }
    rows.push({ html: `<div class="btnrow">` });
    rows.push({ act: { kind: "mute" }, html: `<div class="tbtn ${mute ? "danger" : ""}" title="mute (m)">${svg("mic", mute ? ICONS.slash : "")}<span>${mute ? "muted" : "mute"}</span></div>` });
    rows.push({ act: { kind: "deafen" }, html: `<div class="tbtn ${deaf ? "danger" : ""}" title="deafen (d)">${svg("headphones", deaf ? ICONS.slash : "")}<span>${deaf ? "deaf" : "deafen"}</span></div>` });
    rows.push({ act: { kind: "settings" }, html: `<div class="tbtn" title="settings (s)">${svg("gear")}<span>settings</span></div>` });
    rows.push({ html: `</div>` });
    return rows;
  }

  // Click the real (hidden) control in the main window's user panel, so Discord does
  // exactly what it normally does.
  findPanelButton(re) {
    const panel = document.querySelector('section[class*="panels_"]');
    return [...(panel?.querySelectorAll("button, [role=switch], [role=button]") || [])]
      .find((b) => re.test(b.getAttribute("aria-label") || ""));
  }

  clickPanelButton(re) {
    const btn = this.findPanelButton(re);
    if (btn) { btn.click(); return true; }
    BdApi.UI.showToast("PanePopout: couldn't find that button in Discord's user panel", { type: "error" });
    return false;
  }

  // -------------------------------------------------------------------------
  // input
  // -------------------------------------------------------------------------
  activate(pane, item, { fromKeyboard } = {}) {
    if (!item) return;
    switch (item.kind) {
      case "dms":
        this.go("/channels/@me"); this.cursor.channels = null; this.clearFilter();
        if (fromKeyboard) this.focusPane("channels");
        break;
      case "guild": {
        this.openGuild(item.id);
        this.cursor.channels = null; this.clearFilter();
        if (fromKeyboard) this.focusPane("channels");
        break;
      }
      case "folder":
        this.openFolders.has(item.id) ? this.openFolders.delete(item.id) : this.openFolders.add(item.id);
        BdApi.Data.save("PanePopout", "openFolders", [...this.openFolders]);
        this.render("nav");
        break;
      case "friends":
        this.go("/channels/@me");
        if (fromKeyboard) { document.activeElement?.blur?.(); this.focusPane("main"); }
        break;
      case "dm": this.go(`/channels/@me/${item.id}`); this.clearFilter(); this.focusChat(); break;
      case "channel":
        this.go(`/channels/${item.gid}/${item.id}`); this.clearFilter();
        if (!item.voice) this.focusChat();
        break;
      case "category":
        this.collapsed.has(item.id) ? this.collapsed.delete(item.id) : this.collapsed.add(item.id);
        BdApi.Data.save("PanePopout", "collapsed", [...this.collapsed]);
        this.render("channels");
        break;
      case "mute": this.clickPanelButton(/^(un)?mute$/i); break;
      case "deafen": this.clickPanelButton(/^(un)?deafen$/i); break;
      case "settings": this.clickPanelButton(/user settings/i); this.focusPane("main"); break;
      case "disconnect": this.clickPanelButton(/^disconnect$/i); break;
    }
  }

  // Discord ignores "/channels/<guild>" without a channel, so always pick a real one: the last
  // channel you had open there (if it still exists), else the first text channel.
  firstTextChannel(gid) {
    const all = safe(() => this.S.GuildChannel.getChannels(gid), {}) || {};
    const byPos = (a, b) => (a.position ?? 0) - (b.position ?? 0) || (a.id < b.id ? -1 : 1);
    const chans = (all.SELECTABLE || []).map((e) => e.channel).filter(Boolean);
    const text = chans.filter((c) => c.type === CHANNEL.TEXT || c.type === CHANNEL.ANNOUNCEMENT).sort(byPos);
    return (text[0] || chans.sort(byPos)[0])?.id || null;
  }

  openGuild(gid) {
    const { SelectedChannel, Channel, SelectedGuild } = this.S;
    const valid = (id) => !!id && safe(() => Channel.getChannel(id)?.guild_id, null) === gid;
    const recent = safe(() => SelectedChannel.getMostRecentSelectedTextChannelId(gid), null);
    const first = this.firstTextChannel(gid);
    const target = valid(recent) ? recent : first;
    this.go(target ? `/channels/${gid}/${target}` : `/channels/${gid}`);
    // If Discord didn't switch (e.g. the remembered channel can't be opened), fall back once.
    setTimeout(() => {
      if (safe(() => SelectedGuild.getGuildId(), null) === gid) return;
      if (first && first !== target) this.go(`/channels/${gid}/${first}`);
      else BdApi.UI.showToast("PanePopout: Discord didn't open that server", { type: "warning" });
    }, 600);
  }

  // ----- friends page (Discord's own UI in the main window) ------------------
  // Plain keys drive it when it's showing and you're not typing; each key clicks
  // Discord's real control, so behaviour matches clicking.
  friendsKey(e) {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const col = document.querySelector('[class*="peopleColumn_"]');
    if (!col) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) {
      if (e.key === "Escape" && col.contains(t)) setTimeout(() => t.blur(), 0); // leave the search box
      return;
    }
    if (document.querySelector('[role="menu"], [role="dialog"]')) return; // Discord's menus/modals keep their keys

    const rows = [...col.querySelectorAll('[class*="peopleListItem_"]')];
    const cur = rows.findIndex((r) => r.hasAttribute("data-pp-cursor"));
    const setCursor = (i) => {
      if (!rows.length) return;
      i = Math.max(0, Math.min(rows.length - 1, i));
      rows.forEach((r) => r.removeAttribute("data-pp-cursor"));
      rows[i].setAttribute("data-pp-cursor", "");
      rows[i].scrollIntoView({ block: "nearest" });
    };
    const row = rows[cur >= 0 ? cur : 0];
    const press = (re) => {
      const b = row && [...row.querySelectorAll("[aria-label]")].find((el) => re.test(el.getAttribute("aria-label") || ""));
      if (b) b.click();
      return !!b;
    };
    const tabs = (() => {
      const list = [...document.querySelectorAll('[role="tablist"]')].find((l) => l.querySelector('[class*="addFriend_"]'));
      return list ? [...list.querySelectorAll('[role="tab"]')] : [];
    })();
    const tabIdx = tabs.findIndex((t) => t.getAttribute("aria-selected") === "true");
    const tabCur = tabs.findIndex((t) => t.hasAttribute("data-pp-cursor"));
    const inTabs = tabCur >= 0;
    const clearCursors = () => document.querySelectorAll("[data-pp-cursor]").forEach((el) => el.removeAttribute("data-pp-cursor"));
    const isAddFriend = (t) => /addFriend_/.test(t?.className || "");
    const focusAddFriend = () => setTimeout(() => [...document.querySelectorAll("input")].find((i) => /username/i.test(i.placeholder || ""))?.focus(), 150);
    // Tab bar: the dashed cursor sits on the tab, and landing on a tab opens it.
    const markTab = (i) => {
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
    const openTab = (i) => (inTabs ? markTab(i) : (tabs[i] && (tabs[i].click(), setTimeout(clearCursors, 0))));

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

  clearFilter() {
    const f = this.wins.channels?.filter;
    if (f && f.value) { f.value = ""; this.filterText = ""; }
  }

  focusPane(pane) { post(TO_HYPR, { action: "focus", pane }); }
  focusChatInput() { document.querySelector('[role="textbox"][contenteditable="true"]')?.focus(); }
  focusChat() { this.focusChatInput(); this.focusPane("main"); }

  onClick(pane, e) {
    const el = e.target.closest("[data-i]");
    if (!el) return;
    this.cursor[pane] = +el.dataset.i;
    this.activate(pane, this.items[pane][+el.dataset.i]);
    this.render(pane);
  }

  onKey(pane, e) {
    if (e.ctrlKey || e.altKey || e.metaKey) return; // every modifier chord stays with Hyprland/Omarchy
    const w = this.wins[pane];
    if (pane === "help") {
      if (["Escape", "q", "?", "Enter"].includes(e.key)) { e.preventDefault(); try { w.win.close(); } catch (_) {} }
      else if (e.key === "j" || e.key === "ArrowDown") w.list.scrollBy(0, 40);
      else if (e.key === "k" || e.key === "ArrowUp") w.list.scrollBy(0, -40);
      return;
    }
    if (e.key === "?" && !(w.filter && e.target === w.filter)) { e.preventDefault(); return this.toggleHelp(); }
    if (w.filter && e.target === w.filter) {
      if (e.key === "Escape") { w.filter.value = ""; this.filterText = ""; w.list.focus(); this.render(pane); e.preventDefault(); }
      else if (e.key === "Enter") { this.activate(pane, this.items[pane][0], { fromKeyboard: true }); e.preventDefault(); }
      else if (e.key === "ArrowDown") { w.list.focus(); e.preventDefault(); }
      return;
    }
    const n = this.items[pane]?.length || 0;
    const move = (d) => { this.cursor[pane] = Math.min(n - 1, Math.max(0, (this.cursor[pane] || 0) + d)); this.render(pane); this.revealCursor(pane); };
    const k = e.key;
    if (k === "j" || k === "ArrowDown") move(1);
    else if (k === "k" || k === "ArrowUp") move(-1);
    else if (k === "g" || k === "Home") move(-n);
    else if (k === "G" || k === "End") move(n);
    else if (k === "Enter" || k === "l" || k === "ArrowRight" || k === " ") this.activate(pane, this.items[pane][this.cursor[pane]], { fromKeyboard: true });
    else if ((k === "h" || k === "ArrowLeft") && pane === "channels") this.focusPane("nav");
    else if (k === "/" && w.filter) w.filter.focus();
    else if (k === "Escape") this.focusChat();
    else if (pane === "user" && k === "m") this.activate(pane, { kind: "mute" });
    else if (pane === "user" && k === "d") this.activate(pane, { kind: "deafen" });
    else if (pane === "user" && k === "s") this.activate(pane, { kind: "settings" });
    else return;
    e.preventDefault();
  }

  revealCursor(pane) {
    this.wins[pane]?.list.querySelector("[data-cursor]")?.scrollIntoView({ block: "nearest" });
  }
};

// ---------------------------------------------------------------------------
// Pane styling: a system24-style labelled box. Colours and fonts come from the theme vars.
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
.pane:hover, body.focused .pane { border-color: var(--border-hover, #888); }
.pane::after {
  content: attr(data-label); position: absolute; top: -10px; left: 8px; padding: 0 4px; line-height: 18px;
  background: var(--background-base-low, var(--bg-4, #181818)); color: var(--label-color, var(--text-5, #777));
  font-weight: var(--label-font-weight, 500); font-size: 16px; transition: color var(--border-hover-transition, .2s ease);
}
.pane:hover::after, body.focused .pane::after { color: var(--label-hover-color, var(--text-2, #ddd)); }
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
.srv:hover img, .srv.sel img, body.focused .srv[data-cursor] img { opacity: 1; }
/* the cursor sits outside the icon: inside it, the (faded) icon image paints over the outline */
.srv[data-cursor] { outline: 1px dashed var(--text-3, #bbb); outline-offset: 3px; }
.srv:hover { background: var(--hover); color: var(--text-2); }
.srv.sel { background: var(--active); color: var(--text-1); }
.srv::before { content: ""; position: absolute; left: -10px; width: 4px; height: 0; background: var(--text-1, #eee); transition: height var(--list-item-transition, .2s ease); }
.srv.unread::before { height: 8px; }
.srv:hover::before { height: 20px; }
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
body.focused .srv.fold[data-cursor] .mini, .srv.fold:hover .mini { opacity: 1; }

/* channels */
.head { padding: 10px 12px 8px; color: var(--text-2, #ddd); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  border-bottom: 1px solid var(--border-light, var(--border, #333)); }
.filter { display: none; margin: 8px 8px 0; padding: 4px 8px; font: inherit; color: var(--text-2, #ddd); background: var(--bg-3, #222);
  border: 1px solid var(--border, #333); outline: none; }
.filter:focus, .filter:not(:placeholder-shown) { display: block; }
.filter:focus { border-color: var(--border-hover, #888); }
.cat { padding: 12px 12px 4px; color: var(--text-5, #666); font-size: 12px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cat:hover { color: var(--text-3, #bbb); }
.ch { display: flex; align-items: center; gap: 6px; margin: 1px 8px; padding: 3px 8px; padding-left: calc(8px + var(--depth, 0) * 14px);
  color: var(--text-4, #999); cursor: pointer; white-space: nowrap; transition: background var(--list-item-transition, .2s ease), color var(--list-item-transition, .2s ease); }
.ch .pfx { color: var(--text-5, #666); width: 1ch; flex: none; text-align: center; }
.ch .name { overflow: hidden; text-overflow: ellipsis; }
.ch:hover { background: var(--hover); color: var(--text-3, #bbb); }
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
.tbtn:hover { background: var(--hover); color: var(--text-2, #ddd); }
.tbtn.danger { color: var(--accent-new, var(--red-2, #e66)); border-color: var(--accent-new, var(--red-2, #e66)); }
.tbtn.slim { flex: none; padding: 2px 8px; }
`;
