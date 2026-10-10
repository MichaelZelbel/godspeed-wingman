// Practice and review answers. Each answer is one example the judge reads from then on, whatever
// site it came from (taste does not change per site); each is tagged with its site, because the
// switch to autopilot is per site: a site goes on autopilot once the owner agreed with 9 of its
// last 10 practice verdicts (by default), and a new site starts in practice.
// An answer the owner calls a one-off exception ("only in this case", "as a friend") is kept,
// marked `exception`, and never taught: the judge does not read it and the tally does not count it.
import { appendJsonl, readJsonl, writeText } from "./store.mjs";

const AGREE = /^(y|yes|yep|yeah|ja|jo|ok|okay|agree|agreed|correct|right|stimmt|genau|richtig|passt|sure|👍)(?=$|[\s.,!:;)])/iu;
const DISAGREE = /^(n|no|nope|nein|disagree|wrong|falsch|stimmt nicht|nah|👎)(?=$|[\s.,!:;)])/iu;

// "agree" / "disagree" for a practice or review question. Anything else is not an answer.
export function readAnswer(text) {
  const t = String(text || "").trim();
  // Disagreement first: "stimmt nicht" starts like "stimmt".
  if (DISAGREE.test(t)) return "disagree";
  if (AGREE.test(t)) return "agree";
  return null;
}

// `now` is the worker's clock, so the retention counts from the same day as everything else.
export function record(paths, { site, profile, digest, judge, owner, reason, kind, exception = false, now = new Date() }) {
  const example = {
    at: now.toISOString(), kind, site: site || profile?.site || null, id: profile?.id, name: profile?.name,
    digest, judge, owner, agreed: judge ? judge === owner : null, reason: reason || "",
    ...(exception ? { exception: true } : {}),
  };
  appendJsonl(paths.examples, example);
  return example;
}

// What the judge learns from: every answer except the ones the owner called an exception.
export function examples(paths) { return answers(paths).filter((e) => !e.exception); }

// Every answer, exceptions included (a review answered as an exception is still reviewed).
export function answers(paths) { return readJsonl(paths.examples); }

// The owner says afterwards that an answer was a one-off: their newest answer about that profile
// (by its id, or the name as kept) is marked an exception. Only the worker calls this, so no
// append races it.
export function markException(paths, about) {
  const key = String(about || "").trim();
  if (!key) return null;
  const all = answers(paths);
  const low = key.toLowerCase();
  let i = all.findLastIndex((e) => e.id === key);
  if (i < 0) i = all.findLastIndex((e) => e.id && String(e.name || "").trim().toLowerCase() === low);
  if (i < 0) return null;
  const was = !!all[i].exception;
  all[i] = { ...all[i], exception: true };
  if (!was) writeText(paths.examples, all.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return { ...all[i], was };
}

// How many of the last `of` practice answers on `site` agreed with the judge (every site when no
// site is named).
export function agreement(paths, of = 10, site) {
  const practice = examples(paths).filter((e) => e.kind === "practice" && e.agreed !== null && (!site || e.site === site));
  const last = practice.slice(-of);
  return { agreed: last.filter((e) => e.agreed).length, of: last.length, wanted: of };
}

export function readyForAuto(paths, rule, site) {
  const a = agreement(paths, rule.of, site);
  return a.of >= rule.of && a.agreed >= rule.agree;
}

export const opposite = (v) => (v === "like" ? "pass" : "like");
