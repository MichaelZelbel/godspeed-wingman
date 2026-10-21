// One text call to a model. Four lanes:
//   claude   Claude Code in print mode, from an empty temporary folder, every hook off, no tools,
//            no MCP servers, our own system prompt.
//   codex    Codex CLI (`codex exec`) in a read-only sandbox, from an empty temporary folder,
//            without the person's Codex settings, with its shell and app tools switched off,
//            asked for the JSON only.
//   openai   any OpenAI-compatible endpoint. The address (GODSPEED_WINGMAN_OPENAI_BASE) and the
//            name of the variable holding the key (GODSPEED_WINGMAN_OPENAI_KEY_ENV, default
//            OPENAI_API_KEY) come from the environment, never from the settings file.
//   command  a program that reads {"system","prompt"} as JSON on stdin and prints the answer. Only
//            the environment chooses it (GODSPEED_WINGMAN_MODEL_CMD): the tests use it, and so can
//            anyone with another model.
// The default is the host-owned Godspeed connection. It performs one isolated inference,
// not a Hermes chat turn: no tools, history, or separate provider credentials in this add-on.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { claudeProgram, codexProgram } from "./exe.mjs";
import { godspeedModelProgram, godspeedWorkspace, parseGodspeedAnswer } from "./godspeed-model.mjs";

export class ModelError extends Error {
  constructor(error) {
    super(error?.message || String(error), { cause: error });
    this.name = "ModelError";
  }
}

function run(exe, args, input, { cwd, env, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn(exe, args, { cwd, env, windowsHide: true, shell: false }); } catch (e) { reject(e); return; }
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`the model took longer than ${Math.round(timeoutMs / 1000)} s`)); }, timeoutMs);
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out, err }); });
    child.stdin.on("error", () => { /* a program that exits early */ });
    child.stdin.end(input);
  });
}

const answered = (r) => {
  if (r.code !== 0 || !r.out.trim()) throw new Error(`the model answered nothing (exit ${r.code}): ${(r.err || r.out).slice(-300)}`);
  return r.out;
};

function tempFolder() { return fs.mkdtempSync(path.join(os.tmpdir(), "godspeed-wingman-")); }

export function laneOf(model = {}, env = process.env) {
  if (env.GODSPEED_WINGMAN_MODEL_CMD) return "command";
  return ["godspeed", "claude", "codex", "openai"].includes(model.lane) ? model.lane : "godspeed";
}

export function claudeArgs(system, name) {
  const args = ["-p", "--output-format", "text", "--settings", '{"disableAllHooks": true}', "--tools", "", "--strict-mcp-config", "--system-prompt", system];
  if (name) args.push("--model", name);
  return args;
}

// Checked against `codex exec --help` (codex-cli 0.155). -c sets a configuration value; a key an
// older Codex does not know is ignored, so switching a tool off never breaks an older version.
export const CODEX_OFF = ["shell_tool", "unified_exec", "apps", "plugins", "multi_agent", "browser_use", "computer_use", "image_generation", "hooks"];
export function codexArgs(cwd, answerFile, name) {
  const args = ["exec", "--sandbox", "read-only", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--color", "never", "-C", cwd];
  for (const f of CODEX_OFF) args.push("-c", `features.${f}=false`);
  args.push("-o", answerFile);
  if (name) args.push("-m", name);
  args.push("-");
  return args;
}

export function codexPrompt(system, prompt) {
  return `${system}\n\nDo not run commands or use tools. Answer from the text below only.\n\n${prompt}`;
}

// Configuration only: never makes an inference call or copies the host's credentials.
export async function describeGodspeed({ mcDir, env = process.env, timeoutMs = 15000 } = {}) {
  const workspace = godspeedWorkspace({ mcDir, env });
  if (!workspace) throw new Error("the Godspeed workspace was not found");
  const prog = godspeedModelProgram({ env, mcDir: workspace });
  if (!prog) throw new Error("Godspeed's shared model command was not found; update Godspeed");
  const result = await run(prog.exe, [...prog.args, "--check", "--workspace", workspace], "", { cwd: workspace, env, timeoutMs });
  const answer = JSON.parse(answered(result));
  if (answer.configured !== true || !answer.provider || !answer.model) throw new Error("Godspeed has no configured model connection");
  return { provider: answer.provider, model: answer.model };
}

// The program to run, the address and the key always come from the worker's own environment.
export async function ask(input, model = {}, options = {}) {
  try { return await askRaw(input, model, options); }
  catch (e) { throw e instanceof ModelError ? e : new ModelError(e); }
}

async function askRaw({ system, prompt }, model = {}, { timeoutMs = 240000, env = process.env, mcDir, onReceipt } = {}) {
  const lane = laneOf(model, env);
  if (lane === "godspeed") {
    const workspace = godspeedWorkspace({ mcDir, env });
    if (!workspace) throw new Error("the Godspeed workspace was not found; run the Wingman inside it or pass --godspeed");
    const prog = godspeedModelProgram({ env, mcDir: workspace });
    if (!prog) throw new Error("Godspeed's shared model command was not found; update Godspeed or set GODSPEED_MODEL_COMMAND to its command");
    const result = await run(prog.exe, [...prog.args, "--workspace", workspace], JSON.stringify({ system, prompt, timeout_ms: timeoutMs }), { cwd: workspace, env, timeoutMs });
    const answer = parseGodspeedAnswer(answered(result));
    onReceipt?.({ provider: answer.provider, model: answer.model });
    return answer.text;
  }
  if (lane === "command") {
    return answered(await run(process.execPath, [env.GODSPEED_WINGMAN_MODEL_CMD], JSON.stringify({ system, prompt }), { env, timeoutMs }));
  }
  if (lane === "openai") {
    const keyEnv = /^[A-Z_][A-Z0-9_]*$/.test(env.GODSPEED_WINGMAN_OPENAI_KEY_ENV || "") ? env.GODSPEED_WINGMAN_OPENAI_KEY_ENV : "OPENAI_API_KEY";
    const key = env[keyEnv] || "";
    if (!key) throw new Error(`no key in ${keyEnv}`);
    if (!model.name) throw new Error("the openai lane needs a model name in the settings");
    const base = String(env.GODSPEED_WINGMAN_OPENAI_BASE || "https://api.openai.com/v1").replace(/\/+$/, "");
    const r = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: model.name, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const j = await r.json().catch(() => ({}));
    const text = j?.choices?.[0]?.message?.content;
    if (!r.ok || !text) throw new Error(`the model answered ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
    return text;
  }
  const cwd = tempFolder();
  try {
    if (lane === "codex") {
      const prog = codexProgram({ env });
      if (!prog) throw new Error("the Codex program was not found (set GODSPEED_WINGMAN_CODEX to it)");
      const answerFile = path.join(cwd, "answer.txt");
      const r = await run(prog.exe, [...prog.args, ...codexArgs(cwd, answerFile, model.name)], codexPrompt(system, prompt), { cwd, env: { ...env, GODSPEED_MACHINE_RUN: "1" }, timeoutMs });
      let text = "";
      try { text = fs.readFileSync(answerFile, "utf8"); } catch { text = ""; }
      if (r.code === 0 && text.trim()) return text;
      return answered(r);
    }
    const prog = claudeProgram({ env });
    if (!prog) throw new Error("the Claude Code program was not found (set GODSPEED_WINGMAN_CLAUDE to it)");
    return answered(await run(prog.exe, [...prog.args, ...claudeArgs(system, model.name)], prompt, { cwd, env: { ...env, GODSPEED_MACHINE_RUN: "1" }, timeoutMs }));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

// The first {...} block in a model's answer, parsed. Models sometimes wrap JSON in prose or fences.
export function firstJson(text) {
  const s = String(text || "");
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}
