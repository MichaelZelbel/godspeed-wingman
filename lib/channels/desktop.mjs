// Notifications on this computer: a short note that a question or a match waits, and a click
// opens the desk page. Windows: a toast through Windows PowerShell and the WinRT
// ToastNotificationManager (no modules to install), opened by protocol activation; macOS:
// osascript's display notification; Linux: notify-send.
//
// A notification is discreet on purpose: it never shows a stranger's name, words or picture,
// because it can appear on a lock screen or a shared screen. The desk shows the rest.
//
// While the desk page is open and visible, no notification is shown: the person already sees the
// question there. A notification that fails is logged and never stops anything.
import { spawn } from "node:child_process";
import path from "node:path";
import { findProgram } from "../core/exe.mjs";
import { readJson } from "../core/store.mjs";
import { deskUrl } from "../desk/secret.mjs";

export const TITLE = "Your Wingman";
// The app id Windows shows the toast under: Windows PowerShell's own, which every Windows has
// registered, so nothing is written to the registry.
export const WINDOWS_APP_ID = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";
const SEEN_MS = 30000;

export function windowsPowerShell(env = process.env) {
  const root = env.SystemRoot || env.SYSTEMROOT || env.windir || "C:\\Windows";
  return path.win32.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

// Whether this computer can show one, and how.
export function available({ platform = process.platform, env = process.env } = {}) {
  if (platform === "win32") return { ok: true, how: "Windows notifications" };
  if (platform === "darwin") return { ok: true, how: "macOS notifications" };
  if (!(env.DISPLAY || env.WAYLAND_DISPLAY || env.DBUS_SESSION_BUS_ADDRESS)) return { ok: false, how: "no desktop session on this machine" };
  return findProgram("notify-send", { env, platform }) ? { ok: true, how: "notify-send" } : { ok: false, how: "notify-send is not installed (package libnotify-bin or libnotify)" };
}

// What a message is about, in a few words, and which page of the desk answers it.
export function summary(text) {
  const t = String(text || "").replace(/^From your Wingman:\s*/, "");
  if (/^still open from/.test(t)) return { body: "A question from an earlier day still waits for your answer.", page: "practice" };
  if (/^practice\b/.test(t)) return { body: "A practice question waits for your answer.", page: "practice" };
  if (/^review\b/.test(t)) return { body: "A review question waits for your answer.", page: "practice" };
  if (/is on your watch list/.test(t)) return { body: "Someone on your watch list came up. Nothing happens until you decide.", page: "practice" };
  if (/^new match with/.test(t)) return { body: "A new match. Three ways to open wait for you.", page: "matches" };
  if (/\bwrote: "/.test(t) || /Three replies:/.test(t)) return { body: "A new message. Three reply ideas wait for you.", page: "matches" };
  if (/logged me out/.test(t)) return { body: "A dating site logged the Wingman out. Log in again when you have a minute.", page: "status" };
  if (/Discord/.test(t)) return { body: "Someone you liked gave their Discord name.", page: "status" };
  return { body: "Something new waits on your desk.", page: "status" };
}

const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export function toastXml({ title = TITLE, body, url }) {
  const launch = url ? ` activationType="protocol" launch="${xml(url)}"` : "";
  const action = url ? `<actions><action content="Open the desk" activationType="protocol" arguments="${xml(url)}"/></actions>` : "";
  return `<toast${launch}><visual><binding template="ToastGeneric"><text>${xml(title)}</text><text>${xml(body)}</text></binding></visual>${action}</toast>`;
}

// The PowerShell script that shows the toast. The XML goes in a single-quoted string, where only
// a quote needs doubling.
export function windowsScript(opts) {
  const ps = (s) => `'${String(s).replace(/'/g, "''")}'`;
  return [
    "$ErrorActionPreference = 'Stop'",
    "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null",
    "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null",
    "$x = New-Object Windows.Data.Xml.Dom.XmlDocument",
    `$x.LoadXml(${ps(toastXml(opts))})`,
    "$t = New-Object Windows.UI.Notifications.ToastNotification $x",
    `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier(${ps(WINDOWS_APP_ID)}).Show($t)`,
  ].join("\n");
}

const appleString = (s) => `"${String(s).replace(/[\r\n]+/g, " ").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

// The program and its arguments for this platform. No shell is ever involved.
export function notifyCommand({ platform = process.platform, env = process.env, title = TITLE, body, url }) {
  if (platform === "win32") {
    const encoded = Buffer.from(windowsScript({ title, body, url }), "utf16le").toString("base64");
    return { exe: windowsPowerShell(env), args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-EncodedCommand", encoded] };
  }
  if (platform === "darwin") {
    return { exe: "/usr/bin/osascript", args: ["-e", `display notification ${appleString(body)} with title ${appleString(title)}`] };
  }
  const where = url ? `\n${url.replace(/\?t=[0-9a-f]+/, "")}` : "";
  return { exe: findProgram("notify-send", { env, platform })?.exe || "notify-send", args: ["--app-name=Godspeed Wingman", "--icon=dialog-information", title, `${body}${where}`] };
}

// Shows one notification. True when the system took it.
export function notify({ title = TITLE, body, url, platform = process.platform, env = process.env, spawnImpl = spawn, timeoutMs = 20000 } = {}) {
  const { exe, args } = notifyCommand({ platform, env, title, body, url });
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawnImpl(exe, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true }); } catch (e) { reject(e); return; }
    let err = "";
    const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } reject(new Error(`the notification took longer than ${Math.round(timeoutMs / 1000)} s`)); }, timeoutMs);
    child.stderr?.on("data", (d) => { err += d; });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(true);
      else reject(new Error(`${path.basename(exe)} said no (exit ${code})${err.trim() ? `: ${err.trim().split(/\r?\n/).slice(-1)[0].slice(0, 200)}` : ""}`));
    });
  });
}

// The desk page writes desk/seen.json while it is open and visible.
export function deskSeen(paths, now = Date.now()) {
  const s = readJson(path.join(paths.desk, "seen.json"), null);
  return !!s?.at && now - new Date(s.at).getTime() < SEEN_MS;
}

// The channel. Failure is logged by the fan-out and never fatal.
export async function send({ text, settings, paths, log = () => {}, deps = {} }) {
  if (paths && deskSeen(paths)) return true;
  const { body, page } = summary(text);
  let url = "";
  try { if (paths && settings?.talk?.includes("desk")) url = deskUrl(settings, paths, page); } catch { url = ""; }
  return (deps.notify || notify)({ body, url, log });
}

export function ready({ platform = process.platform, env = process.env } = {}) {
  const a = available({ platform, env });
  return { ok: a.ok, why: a.how };
}
