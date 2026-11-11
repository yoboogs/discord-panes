/*
 * PanePopout for Vesktop: the main-process half.
 *
 * Vencord's renderer code can't touch files, so everything the plugin exchanges with the
 * `discord-panes` helper goes through here. Every path is fixed: the renderer can post to
 * the helper's inbox, drain its own inbox, write the diag report and read the Omarchy
 * theme, and nothing else. Nothing received is run as code.
 */

import { execFileSync } from "child_process";
import { BrowserWindow, IpcMainInvokeEvent, WebContents } from "electron";
import * as fs from "fs";
import * as path from "path";

const RUN = path.join(process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() ?? 0}`, "discord-panes");
const TO_HYPR = path.join(RUN, "to-hypr");       // messages for the helper (window management)
const TO_DISCORD = path.join(RUN, "to-discord"); // messages for the plugin
const DIAG_FILE = path.join(RUN, "diag.json");
const PIDFILE = path.join(RUN, "daemon.pid");
const HOME = process.env.HOME || "";
const OMARCHY_COLORS = path.join(HOME, ".local/state/omarchy/current/theme/colors.toml");
const OMARCHY_FONTCONF = path.join(HOME, ".config/fontconfig/fonts.conf"); // written by `omarchy font set`

function ensureDirs() {
    for (const d of [RUN, TO_HYPR, TO_DISCORD]) {
        try { fs.mkdirSync(d, { recursive: true, mode: 0o700 }); } catch { }
    }
}

let seq = 0;
export function post(_: IpcMainInvokeEvent, msg: unknown) {
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) return;
    const text = JSON.stringify(msg);
    if (text.length > 4096) return;
    try {
        ensureDirs();
        const name = `${Date.now()}-${String(seq++).padStart(6, "0")}-v.json`;
        const tmp = path.join(TO_HYPR, "." + name);
        fs.writeFileSync(tmp, text);
        fs.renameSync(tmp, path.join(TO_HYPR, name)); // atomic: readers never see half a message
    } catch (e) { console.warn("[PanePopout] post failed", e); }
}

export function takeInbox(_: IpcMainInvokeEvent) {
    let names: string[] = [];
    try { names = fs.readdirSync(TO_DISCORD).filter(n => !n.startsWith(".")).sort(); } catch { return []; }
    const out: unknown[] = [];
    for (const n of names) {
        const p = path.join(TO_DISCORD, n);
        try { const msg = JSON.parse(fs.readFileSync(p, "utf8")); fs.unlinkSync(p); out.push(msg); }
        catch { try { fs.unlinkSync(p); } catch { } }
    }
    return out;
}

export function helperAlive(_: IpcMainInvokeEvent) {
    try {
        const pid = fs.readFileSync(PIDFILE, "utf8").trim();
        return /^\d+$/.test(pid) && fs.existsSync(`/proc/${pid}`);
    } catch { return false; }
}

export function writeDiag(_: IpcMainInvokeEvent, text: unknown) {
    if (typeof text !== "string" || text.length > 65536) return;
    try { ensureDirs(); fs.writeFileSync(DIAG_FILE, text); } catch (e) { console.warn("[PanePopout] diag failed", e); }
}

// Omarchy's current monospace font is whatever fontconfig picks for "monospace" (that's what
// `omarchy font current` reports): `omarchy font set` writes it to fonts.conf, otherwise it's
// the system default. Asked once per change of fonts.conf, not on every 2s theme check.
let fontCache: { stamp: string; font: string | null; } | null = null;
function omarchyFont() {
    let stamp = "none";
    try { stamp = String(fs.statSync(OMARCHY_FONTCONF).mtimeMs); } catch { }
    if (fontCache?.stamp === stamp) return fontCache.font;
    let font: string | null = null;
    try {
        const conf = fs.readFileSync(OMARCHY_FONTCONF, "utf8");
        font = (conf.match(/<edit[^>]*name="family"[^>]*>\s*<string>([^<]+)<\/string>/) || [])[1] || null;
    } catch { }
    if (!font) {
        try {
            const out = execFileSync("fc-match", ["monospace", "-f", "%{family}"], { encoding: "utf8", timeout: 2000 });
            font = out.split(",")[0].trim() || null;
        } catch { }
    }
    fontCache = { stamp, font };
    return font;
}

export function readOmarchy(_: IpcMainInvokeEvent) {
    let colors = "";
    try { colors = fs.readFileSync(OMARCHY_COLORS, "utf8"); } catch { return null; }
    return { colors, font: omarchyFont() };
}

// Vesktop gives popouts a minimum size of 320x180. Tiled windows ignore that, but a floating
// one can't be made smaller, so the narrow panes (nav is 92px) need it lifted. Only for our
// pane windows, found by the title the plugin gives them.
export function freePaneSize(_: IpcMainInvokeEvent, pane: unknown) {
    if (typeof pane !== "string" || !/^(nav|channels|user)$/.test(pane)) return false;
    const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.getTitle() === `Discord · ${pane}`);
    win?.setMinimumSize(1, 1);
    return !!win;
}

// Wake the renderer as soon as the helper drops a message, instead of waiting for its poll.
const watchers = new Map<WebContents, fs.FSWatcher>();
export function watchInbox(e: IpcMainInvokeEvent) {
    const wc = e.sender;
    if (watchers.has(wc)) return true;
    ensureDirs();
    try {
        const w = fs.watch(TO_DISCORD, () => {
            if (wc.isDestroyed()) return;
            wc.executeJavaScript("Vencord.Plugins.plugins.PanePopout?.onInbox?.()").catch(() => { });
        });
        watchers.set(wc, w);
        wc.once("destroyed", () => { w.close(); watchers.delete(wc); });
        return true;
    } catch (err) {
        console.warn("[PanePopout] watch failed", err);
        return false;
    }
}

export function unwatchInbox(e: IpcMainInvokeEvent) {
    watchers.get(e.sender)?.close();
    watchers.delete(e.sender);
}
