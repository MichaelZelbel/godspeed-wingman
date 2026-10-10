// The pretend adb's device and screens for the tests (the program is fake-adb.mjs next to this
// file). Everyone on the pretend screens is invented.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fake-adb.mjs");
export const PNG_1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const attrs = (o) => Object.entries({ index: "0", text: "", "resource-id": "", class: "android.view.View", package: "com.example.dating", "content-desc": "", clickable: "false", scrollable: "false", enabled: "true", ...o }).map(([k, v]) => `${k}="${v}"`).join(" ");
export const CARD = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">`
  + `<node ${attrs({ class: "android.widget.FrameLayout", bounds: "[0,0][1080,2400]" })}>`
  + `<node ${attrs({ text: "Mara, 27", "resource-id": "com.example.dating:id/card_name", class: "android.widget.TextView", bounds: "[40,1500][700,1580]" })} />`
  + `<node ${attrs({ text: "Loves hiking &amp; board games &#10;and &quot;bad&quot; puns", "resource-id": "com.example.dating:id/card_bio", class: "android.widget.TextView", bounds: "[40,1600][1040,1800]" })} />`
  + `<node ${attrs({ "resource-id": "com.example.dating:id/pass_button", class: "android.widget.FrameLayout", clickable: "true", bounds: "[180,2100][380,2300]" })}>`
  + `<node ${attrs({ "content-desc": "Pass", class: "android.widget.ImageView", bounds: "[220,2140][340,2260]" })} />`
  + `</node>`
  + `<node ${attrs({ "resource-id": "com.example.dating:id/like_button", class: "android.widget.ImageButton", "content-desc": "Like", clickable: "true", bounds: "[700,2100][900,2300]" })} />`
  + `<node ${attrs({ text: "Messages", "resource-id": "com.example.dating:id/tab_messages", clickable: "true", bounds: "[0,2300][540,2400]" })} />`
  + `</node></hierarchy>`;
export const BLANK = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0"><node ${attrs({ bounds: "[0,0][1080,2400]" })} /></hierarchy>`;

export function fakeAdb(state = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wingman-adb-"));
  const file = path.join(dir, "device.json");
  fs.writeFileSync(file, JSON.stringify({ devices: [["emulator-5554", "device"]], png: PNG_1x1, screens: [CARD], packages: ["com.example.dating"], ...state }));
  const calls = () => { try { return fs.readFileSync(`${file}.log`, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
  return { adb: { exe: process.execPath, args: [FAKE] }, env: { ...process.env, FAKE_ADB: file }, calls, file };
}
