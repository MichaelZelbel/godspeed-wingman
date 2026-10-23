// The worker's memory (state.json in the state folder): one shared part and one part per site.
// A restart reads it back and continues where it stopped.
import { readJson } from "./store.mjs";

export const FRESH = {
  paused: false, run: null, lastRunDay: null, lastRun: null,
  nextActionAt: 0, waiting: null, practiceLeft: 0, practiceStopped: false, reviewQueue: [],
  replySeq: 0, lastInboxAt: 0, lastPruneDay: null,
  lastError: null, consecutiveErrors: 0, failures: {}, decided: {}, discordTold: {}, collection: null,
  retake: null, disk: null, slimmed: null, sites: {}, modelIncident: null, lastModel: null,
  // The one welcome after the terminal setup: asked for, tried, sent.
  welcome: null,
  // The last like or pass, for "nothing was liked or passed after 18:42".
  lastActionAt: null,
  // When the next conversation partner lined up for keeping may be opened (keepStep).
  keepNextAt: 0,
  // The last session that five errors in a row ended: { day, at, cause (plain words, never the raw
  // error), retryAt, retrySites, retryEndsAt, retryStartedAt (the one fresh session after the first
  // such end on a day), final (no fresh session follows; the person hears it), retriedAt, notice:
  // { text, triedAt, sentAt } }. failedNoticeDay is the day the person was told, at most once a day.
  failure: null, failedNoticeDay: null,
};

// Per site: practice or autopilot (a new site starts in practice even when another one is on
// autopilot), the account it is logged into, the conversations already reported, the people who
// liked the owner already kept, the day the owner was last told about a lost login, and the
// conversation partners lined up to be kept ([{ id, name, source, match }], a few at a time).
export const FRESH_SITE = { mode: "practice", me: null, reported: {}, likedYouSeen: {}, loggedOutNoticeDay: null, loggedOutAt: null, keep: [] };

export function readState(file) { return { ...FRESH, ...(readJson(file, {}) || {}) }; }

export function siteState(s, id) { return { ...FRESH_SITE, ...((s.sites || {})[id] || {}) }; }

// One key per person on one site: the same id on two sites is two people.
export const keyOf = (site, id) => `${site}:${id}`;
