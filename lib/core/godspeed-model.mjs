// Godspeed owns model selection, authentication and policy. The add-on sends only an isolated
// prompt to its trusted local command. It never reads or copies the host's provider credentials.
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { findProgram } from "./exe.mjs";
import { findMissionControl } from "./paths.mjs";

export function godspeedModelProgram({ env = process.env, platform = process.platform, home = os.homedir(), mcDir } = {}) {
  if (env.GODSPEED_MODEL_COMMAND) return findProgram("godspeed-model", { env: { ...env, PATH: "", Path: "" }, platform, candidates: [env.GODSPEED_MODEL_COMMAND] });
  const workspace = godspeedWorkspace({ mcDir, env });
  const launcher = workspace && path.join(workspace, ".godspeed", "model.mjs");
  if (launcher && fs.existsSync(launcher)) return { exe: process.execPath, args: [launcher] };
  return findProgram("godspeed-model", {
    env, platform,
    candidates: [env.GODSPEED_MODEL_COMMAND, path.join(home, ".godspeed", "bin", platform === "win32" ? "godspeed-model.cmd" : "godspeed-model"), ...(platform === "linux" ? ["/usr/local/bin/godspeed-model"] : [])].filter(Boolean),
  });
}

export function godspeedWorkspace({ mcDir, env = process.env } = {}) {
  return mcDir || findMissionControl({ arg: env.GODSPEED_MODEL_WORKSPACE || env.GODSPEED_WORKSPACE, env });
}

export function parseGodspeedAnswer(text) {
  let result;
  try { result = JSON.parse(text); } catch { throw new Error("Godspeed returned an unreadable model answer"); }
  if (typeof result?.text !== "string" || !result.text.trim() || typeof result.provider !== "string" || !result.provider || typeof result.model !== "string" || !result.model) {
    throw new Error("Godspeed returned no complete model answer");
  }
  return result;
}
