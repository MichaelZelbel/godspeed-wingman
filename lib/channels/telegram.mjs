// Messages to the person on their assistant's own Telegram bot, so they arrive in the chat the
// person already uses. The Hermes gateway owns the bot; the Wingman only sends (sendMessage,
// sendPhoto), and the person's replies reach the assistant, which runs the godspeed-wingman command
// the recipe names. The token and the chat id are read from the Hermes home's .env file, never
// copied anywhere.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { imageSize } from "../core/image.mjs";
import { validTelegramEnv } from "../core/settings.mjs";

function readEnv(file) {
  const out = {};
  let text = "";
  try { text = fs.readFileSync(file, "utf8"); } catch { return out; }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

export function credentials(file) {
  if (!file) return null;
  const env = readEnv(file);
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN || "";
  // The home channel first; else the one allowed user (their private chat with the bot).
  const allowed = String(env.TELEGRAM_ALLOWED_USERS || "").split(/[,\s]+/).filter(Boolean);
  const chat = env.TELEGRAM_HOME_CHANNEL || env.TELEGRAM_CHAT_ID || env.CHAT_ID || (allowed.length === 1 ? allowed[0] : "");
  return token && chat ? { token, chat: String(chat) } : null;
}

// The Hermes .env files to look in, most likely first: HERMES_HOME, Godspeed's Windows Hermes,
// Hermes' own Windows home, ~/.hermes and its profiles.
export function envCandidates({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  const out = [];
  if (env.HERMES_HOME) out.push(path.join(env.HERMES_HOME, ".env"));
  if (platform === "win32") {
    const local = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    out.push(path.join(local, "Godspeed Mission Control Full Alpha State", "hermes-profile", ".env"));
    out.push(path.join(local, "hermes", ".env"));
  }
  const dot = path.join(home, ".hermes");
  out.push(path.join(dot, ".env"));
  try { for (const p of fs.readdirSync(path.join(dot, "profiles")).sort()) out.push(path.join(dot, "profiles", p, ".env")); } catch { /* no profiles */ }
  return [...new Set(out)];
}

// The .env the Wingman sends through: the one in the settings, else the first Hermes .env that
// holds a bot token and a chat.
export function resolveEnvFile(configured, opts) {
  if (configured && validTelegramEnv(configured)) return configured;
  return envCandidates(opts).find((f) => validTelegramEnv(f) && credentials(f)) || null;
}

function apiBase() {
  if (process.env.GODSPEED_WINGMAN_TELEGRAM_API) {
    if (process.env.GODSPEED_WINGMAN_TEST !== "1") throw new Error("a fake Telegram address is only honoured in test mode");
    return process.env.GODSPEED_WINGMAN_TELEGRAM_API.replace(/\/+$/, "");
  }
  return "https://api.telegram.org";
}

async function call(creds, method, body, isForm = false) {
  const base = apiBase(); // a wrong address fails at once, it does not get better by waiting
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`${base}/bot${creds.token}/${method}`, {
        method: "POST",
        headers: isForm ? undefined : { "content-type": "application/json" },
        body: isForm ? body : JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
      const j = await r.json().catch(() => ({}));
      if (j.ok === true) return j.result;
      last = new Error(`Telegram ${method} refused: ${j.description || r.status}`);
      if (r.status === 400) break; // a bad request does not get better by repeating it
    } catch (e) { last = e; }
    await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
  }
  throw last;
}

export async function sendText(creds, text) {
  const parts = [];
  let rest = String(text);
  while (rest.length > 4000) {
    const cut = rest.lastIndexOf("\n", 4000) > 1000 ? rest.lastIndexOf("\n", 4000) : 4000;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, "");
  }
  parts.push(rest);
  let last;
  for (const p of parts) last = await call(creds, "sendMessage", { chat_id: creds.chat, text: p, disable_web_page_preview: true });
  return last?.message_id;
}

// Telegram takes a photo only up to 10 MB, with width and height together at most 10000 pixels
// and one side at most 20 times the other. A picture of a very long profile can be more; it goes
// as a file then, which Telegram keeps at full size.
export function sendsAsPhoto(buf) {
  if (!buf || buf.length > 10 * 1024 * 1024) return false;
  const size = imageSize(buf);
  if (!size) return true;
  const { width: w, height: h } = size;
  return w + h <= 10000 && Math.max(w, h) <= 20 * Math.max(1, Math.min(w, h));
}

// A picture with the message as its caption. Telegram allows 1024 characters there, so a longer
// message goes out as the picture with its first line, then the full text.
export async function sendPhoto(creds, picturePath, text) {
  if (!picturePath || !fs.existsSync(picturePath)) return sendText(creds, text);
  const buf = fs.readFileSync(picturePath);
  const asPhoto = sendsAsPhoto(buf);
  const form = new FormData();
  form.append("chat_id", creds.chat);
  const long = String(text).length > 1000;
  form.append("caption", long ? String(text).split("\n")[0].slice(0, 1000) : String(text));
  const name = picturePath.split(/[\\/]/).pop();
  form.append(asPhoto ? "photo" : "document", new Blob([buf]), name);
  try {
    const r = await call(creds, asPhoto ? "sendPhoto" : "sendDocument", form, true);
    if (long) return sendText(creds, text);
    return r?.message_id;
  } catch {
    return sendText(creds, text);
  }
}

// The channel: true when Telegram took the message.
export async function send({ text, picture, settings }) {
  const creds = credentials(resolveEnvFile(settings.telegram_env));
  if (!creds) throw new Error("no Telegram bot token and chat in a Hermes .env (telegram_env)");
  return !!(picture ? await sendPhoto(creds, picture, text) : await sendText(creds, text));
}

export function ready({ settings }) {
  const file = resolveEnvFile(settings.telegram_env);
  if (!file) return { ok: false, why: "no Hermes .env with a Telegram bot token and chat was found; set telegram_env in the settings" };
  return credentials(file) ? { ok: true, why: `Telegram bot from ${file}` } : { ok: false, why: `no bot token and chat in ${file}` };
}
