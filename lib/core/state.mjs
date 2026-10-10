// The worker's memory (state.json in the state folder): one shared part and one part per site.
// A restart reads it back and continues where it stopped.
import { readJson } from "./store.mjs";

export const FRESH = {
  paused: false, run: null, lastRunDay: null, lastRun: null,
  nextActionAt: 0, waiting: null, practiceLeft: 0, practiceStopped: false, reviewQueue: [],
  replySeq: 0, lastInboxAt: 0, lastPruneDay: null,
  lastError: null, consecutiveErrors: 0, failures: {}, decided: {}, discordTold: {}, collection: null,
  retake: null, disk: null, slimmed: null, sites: {},
  // The one welcome after the terminal setup: asked for, tried, sent.
  welcome: null,
};

// Per site: practice or autopilot (a new site starts in practice even when another one is on
// autopilot), the account it is logged into, the conversations already reported, the people who
// liked the owner already kept, the day the owner was last told about a lost login.
export const FRESH_SITE = { mode: "practice", me: null, reported: {}, likedYouSeen: {}, loggedOutNoticeDay: null, loggedOutAt: null };

export function readState(file) { return { ...FRESH, ...(readJson(file, {}) || {}) }; }

export function siteState(s, id) { return { ...FRESH_SITE, ...((s.sites || {})[id] || {}) }; }

// One key per person on one site: the same id on two sites is two people.
export const keyOf = (site, id) => `${site}:${id}`;
