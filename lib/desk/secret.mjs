// The desk's key: a random secret in the private state folder (desk/secret), made once. The page
// is opened with it once (?t=...), then a cookie only this machine's browser holds carries it, so
// another web page, even one on this machine, cannot use the desk.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { ensureDir } from "../core/store.mjs";

export const APP = "godspeed-wingman-desk";

export function secretFile(paths) { return path.join(paths.desk, "secret"); }

export function deskSecret(paths) {
  const f = secretFile(paths);
  const read = () => { try { const s = fs.readFileSync(f, "utf8").trim(); return /^[0-9a-f]{64}$/.test(s) ? s : null; } catch { return null; } };
  const have = read();
  if (have) return have;
  ensureDir(paths.desk);
  const s = crypto.randomBytes(32).toString("hex");
  try {
    fs.writeFileSync(f, `${s}\n`, { mode: 0o600, flag: "wx" });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    const other = read();
    if (other) return other; // another process made it a moment ago
    fs.writeFileSync(f, `${s}\n`, { mode: 0o600 });
  }
  try { fs.chmodSync(f, 0o600); } catch { /* Windows */ }
  return s;
}

export const deskBase = (port) => `http://127.0.0.1:${port}/`;

// The address that opens the desk on this machine, with the key; `page` is the part after #.
export function deskUrl(settings, paths, page = "") {
  return `${deskBase(settings.desk_port)}?t=${deskSecret(paths)}${page ? `#${page}` : ""}`;
}

// Whether a desk answers on this port right now.
export async function deskUp(port, timeoutMs = 800) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    const j = await r.json();
    return j?.app === APP;
  } catch { return false; }
}

// Opens an address in the person's default browser. Never through a shell, so nothing in the
// address is read as a command.
export function openInBrowser(url, { platform = process.platform, spawnImpl = spawn } = {}) {
  const [exe, args] = platform === "win32" ? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]]
    : platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    const c = spawnImpl(exe, args, { detached: true, stdio: "ignore", windowsHide: true });
    c.on?.("error", () => {});
    c.unref?.();
    return true;
  } catch { return false; }
}
