// The Android emulator for dating services that only have an app (experimental): setting it up,
// starting and stopping it, whether it is ready, and two tools for building an Android site
// adapter (what is on the screen, a picture of it).
import fs from "node:fs";
import path from "node:path";

const USAGE = "android setup [--dry-run] [--accept-licenses] [--yes] [--headless] | start [--headless] | stop | status | dump [--all] | screenshot [file] | remove [--yes]";
export const meta = {
  name: "android", summary: "the Android emulator for app-only sites (experimental)", usage: USAGE,
  flags: { bool: ["dry-run", "accept-licenses", "yes", "headless", "no-start", "all"] },
};

// The apps of the person's Android sites: [{ id, name, package, on }].
async function androidSites(ctx) {
  const { listSites } = await import("../sites/index.mjs");
  return listSites({ mcDir: ctx.mcDir }).filter((s) => s.kind === "android" && s.meta?.android?.package && !s.shadowed)
    .map((s) => ({ id: s.id, name: s.name, package: s.meta.android.package, on: ctx.settings.sites.includes(s.id) }));
}

async function tools() {
  const sdk = await import("../android/sdk.mjs");
  const home = sdk.androidHome();
  const parts = sdk.currentSdk();
  const config = sdk.readConfig(home);
  const env = parts ? sdk.toolEnv({ sdk: parts.root, home, java: config?.java, env: process.env }) : process.env;
  return { sdk, home, parts, config, env };
}

export async function run(ctx) {
  const sub = ctx.rest[0] || "status";
  const say = (t) => ctx.print(t);

  if (sub === "setup") {
    const { setup } = await import("../android/setup.mjs");
    const apps = (await androidSites(ctx)).map((a) => `${a.name} (${a.package})`);
    return setup(ctx.flags, {}, { apps });
  }

  const { sdk, home, parts, env } = await tools();
  const em = await import("../android/emulator.mjs");
  if (!parts?.adb && sub !== "remove") { say("Android is not set up on this computer yet: godspeed-wingman android setup (try --dry-run first)."); return 1; }

  if (sub === "start") {
    try {
      const s = await em.startEmulator({ parts, home, env, headless: !!ctx.flags.headless, print: say });
      say(s.started ? `The emulator is running (${s.serial}).` : `The emulator was already running (${s.serial}).`);
      return 0;
    } catch (e) { say(e.message); return 1; }
  }

  if (sub === "stop") {
    const r = await em.stopEmulator({ parts, env });
    say(r.stopped ? `The emulator (${r.serial}) is stopping.` : "The Wingman's emulator is not running.");
    return 0;
  }

  if (sub === "status") {
    let bad = 0;
    const line = (good, text) => { say(`  ${good ? "ok  " : "FAIL"} ${text}`); if (!good) bad++; };
    line(true, `Android SDK at ${parts.root}`);
    const avd = fs.existsSync(path.join(home, "avd", `${sdk.AVD_NAME}.ini`));
    line(avd, avd ? `the virtual phone "${sdk.AVD_NAME}"` : `the virtual phone "${sdk.AVD_NAME}" does not exist: godspeed-wingman android setup`);
    const d = em.adbDriver(parts.adb, env);
    let list = [];
    try { list = await d.devices(); } catch (e) { line(false, `adb: ${e.message}`); }
    say(`  devices: ${list.length ? list.map((x) => `${x.serial} (${x.state})`).join(", ") : "none"}`);
    const w = await em.findWingman(d);
    const up = !!w && w.state === "device" && (await em.booted(d, w.serial));
    line(up, up ? `the emulator runs as ${w.serial}` : w ? `the emulator ${w.serial} is still starting (${w.state})` : "the emulator is not running: godspeed-wingman android start");
    if (ctx.settings.android_device) say(`  NOTE the settings name the device ${ctx.settings.android_device} (android_device); Android sites use that one`);
    const serial = ctx.settings.android_device || w?.serial;
    for (const a of await androidSites(ctx)) {
      if (!up && !ctx.settings.android_device) { say(`  ---- ${a.name} (${a.package}): start the emulator to see whether it is installed`); continue; }
      const r = await d.run(["-s", serial, "shell", "pm", "path", a.package]).catch(() => null);
      const there = !!r && r.code === 0 && /^package:/m.test(String(r.out));
      line(there || !a.on, there ? `${a.name} is installed (${a.package})${a.on ? "" : ", the site is switched off"}` : `${a.name} is not installed${a.on ? "" : " (the site is switched off)"}: open the Play Store in the emulator, install ${a.package} and log in`);
    }
    return bad ? 1 : 0;
  }

  if (sub === "dump") {
    const { createDriver } = await import("../drivers/android.mjs");
    const d = createDriver({ settings: ctx.settings, env });
    try {
      const nodes = await d.dump();
      const c = await d.current().catch(() => ({}));
      say(`What is on the screen${c.package ? ` (${c.package})` : ""}: text, "description", id, kind, where${ctx.flags.all ? "" : " (only nodes with a text, a description or an id; --all for every one)"}`);
      for (const n of nodes) {
        if (!ctx.flags.all && !n.text && !n.desc && !n.id) continue;
        const bits = [n.text ? JSON.stringify(n.text.length > 80 ? `${n.text.slice(0, 80)}...` : n.text) : "", n.desc ? `desc ${JSON.stringify(n.desc)}` : "", n.id ? `id ${n.id.replace(/^.*:id\//, "")}` : "", n.class.replace(/^android\.(widget|view)\./, ""), `[${n.bounds.join(",")}]`, n.clickable ? "clickable" : "", n.scrollable ? "scrollable" : ""].filter(Boolean);
        say(`${"  ".repeat(Math.min(n.depth, 12))}${bits.join("  ")}`);
      }
      say("This is what a real person's profile may show: use it to learn the screen's ids, and never copy it into a test.");
      return 0;
    } catch (e) { say(e.message); return 1; }
  }

  if (sub === "screenshot") {
    const { createDriver } = await import("../drivers/android.mjs");
    const d = createDriver({ settings: ctx.settings, env });
    const file = path.resolve(ctx.rest[1] || path.join(ctx.paths.root, "check", "android-screen.png"));
    try {
      const png = await d.screencap();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, png);
      say(`The screen is in ${file}`);
      return 0;
    } catch (e) { say(e.message); return 1; }
  }

  if (sub === "remove") {
    if (!fs.existsSync(home)) { say(`Nothing to remove: ${home} is not there.`); return 0; }
    let yes = !!ctx.flags.yes;
    if (!yes && process.stdin.isTTY) {
      const readline = await import("node:readline/promises");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      yes = /^y(es)?$/i.test((await rl.question(`Delete ${home}: the Wingman's emulator with the apps and logins in it, and the Android tools and Java the Wingman installed there? [y/N] `)).trim());
      rl.close();
    }
    if (!yes) { say(`Nothing was deleted. To delete ${home}, run: godspeed-wingman android remove --yes`); return 1; }
    if (parts?.adb) await em.stopEmulator({ parts, env }).catch(() => {});
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    say(`Deleted ${home}.${parts && !parts.root.startsWith(home) ? ` The Android SDK at ${parts.root} was there before the Wingman and stays.` : ""}`);
    return 0;
  }

  ctx.fail(`Say: godspeed-wingman ${USAGE}`);
  return 1;
}
