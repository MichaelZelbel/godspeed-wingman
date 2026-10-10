// The browser for the browser sites: the Wingman's own Chrome or Edge on this machine (local), or a
// browser on another machine through a Chrome Agent Bridge (bridge). Both have the same methods.
import { Bridge } from "./bridge.mjs";
import { ChromeDriver } from "./chrome.mjs";

export function createDriver(settings, { paths, log = () => {}, tab = "shared", keepOpen = true } = {}) {
  if (settings.browser === "bridge") return new Bridge(settings.bridge);
  return new ChromeDriver({ profileDir: paths.browser, headless: settings.browser_headless, log, tab, keepOpen });
}

export { Bridge, ChromeDriver };
