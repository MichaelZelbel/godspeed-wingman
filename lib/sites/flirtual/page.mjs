// A Flirtual profile page in the browser, ready for its picture. Flirtual's web app
// (github.com/flirtual/flirtual, apps/frontend/src/components/profile) first shows a grey skeleton
// with pulsing bars, then the profile card: the element with the attribute data-mask, holding the
// pictures (all of them stacked in one square, only the first visible), the name line, bio,
// answers and tags. A few tags (relationship style, languages, platforms) hide behind a "..."
// button at the end.
//
// So before the picture: wait until the card is there with the name in it, no skeleton bar is left
// and every picture on the card has finished loading; open the "..."; lay the other pictures out
// under the card, because the square shows only one; hide for the moment what is pinned to the
// window outside the card (on a profile still in the queue, Flirtual's floating bar of like and
// pass buttons, which in a picture taller than the window would lie across the name); let it
// settle. The picture is then taken of the whole card, and the extra pictures and the hidden bar
// are put back as they were. Nothing here clicks anything but that "...", which only unfolds tags
// on the screen: the card's real buttons (Undo, Unmatch, Block, Report) all carry words, and the
// floating bar is only made invisible, never touched.

export const CARD = "[data-mask]";
const STRIP = "__wingman_more_pictures";
const HIDDEN = "__wingmanHidden";

// The picture: the whole card with a little room, as JPEG (a tall PNG of photos is megabytes).
// Quality 72: the text stays sharp, the file stays small.
export const SHOT_OPTIONS = { selector: CARD, pad: 16, format: "jpeg", quality: 72 };
export const PAGE_OPTIONS = { full: true, format: "jpeg", quality: 72 };

// What the page shows right now, as plain data.
export function probeScript(name) {
  return `(() => {
    const want = ${JSON.stringify(String(name || "").normalize("NFC").toLowerCase().trim())};
    const card = document.querySelector(${JSON.stringify(CARD)});
    const loggedIn = !!document.querySelector("#profile-dropdown-button");
    const where = location.pathname;
    if (!card) return { card: false, loggedIn, where, skeleton: document.querySelectorAll(".animate-pulse").length };
    const text = (card.textContent || "").normalize("NFC").toLowerCase();
    const imgs = [...card.querySelectorAll("img")];
    return {
      card: true, loggedIn, where,
      name: !want || text.includes(want),
      skeleton: card.querySelectorAll(".animate-pulse").length,
      images: imgs.length,
      pending: imgs.filter((i) => !i.complete).length,
      broken: imgs.filter((i) => i.complete && !i.naturalWidth).length,
      text: text.length,
    };
  })()`;
}

// Ready: the card, the name on it, no skeleton bar, no picture still loading. A picture that
// failed to load counts as finished (Flirtual then shows its own "not found" picture or none).
export function isReady(p) {
  return !!(p && p.card && p.name && p.skeleton === 0 && p.pending === 0);
}

// Shown: the card with the name and no skeleton, even if a picture never arrived. Good enough to
// replace a picture that showed nothing, never the standard for a new one.
export function isShown(p) {
  return !!(p && p.card && p.name && p.skeleton === 0);
}

// Asks the page every `everyMs` until it is ready, at most `timeoutMs`. Counted in tries, not by
// the clock, so a test with a pretend sleep finishes. Never throws: a page that does not answer is
// simply not ready.
export async function waitForProfile(driver, name, { wait, timeoutMs = 25000, everyMs = 500, settleMs = 800 } = {}) {
  const tries = Math.max(1, Math.ceil(timeoutMs / everyMs));
  let probe = null;
  for (let i = 0; i < tries; i++) {
    try { probe = await driver.evaluate(probeScript(name), { attempts: 1 }); } catch { probe = null; }
    if (isReady(probe)) {
      await wait(settleMs);
      return { ready: true, shown: true, probe, waitedMs: i * everyMs + settleMs };
    }
    await wait(everyMs);
  }
  return { ready: false, shown: isShown(probe), probe, waitedMs: tries * everyMs };
}

// Opens the "..." and lays out the other pictures under the card. Returns how many it added.
export function prepareScript(imageKeys = []) {
  return `(() => {
    const card = document.querySelector(${JSON.stringify(CARD)});
    if (!card) return { card: false };
    // The "..." under the tags: a button with no class and no words whose one child is Flirtual's
    // ellipsis icon. Nothing else on the card looks like that.
    let unfolded = false;
    for (const b of card.querySelectorAll("button")) {
      const icon = b.children.length === 1 ? b.firstElementChild : null;
      const cls = icon && icon.tagName.toLowerCase() === "svg" ? icon.getAttribute("class") || "" : "";
      if (!b.hasAttribute("class") && !(b.textContent || "").trim() && /\\blucide-(ellipsis|more-horizontal)\\b/.test(cls)) { b.click(); unfolded = true; break; }
    }
    document.getElementById(${JSON.stringify(STRIP)})?.remove();
    // What is pinned to the window outside the card is hidden for the picture; cleanupScript puts
    // each style back exactly as it was.
    const hidden = window[${JSON.stringify(HIDDEN)}] || [];
    for (const el of document.body.querySelectorAll("*")) {
      if (card.contains(el) || el.contains(card) || hidden.some(([h]) => h.contains(el))) continue;
      const cs = getComputedStyle(el);
      if (cs.position !== "fixed" || cs.display === "none" || cs.visibility === "hidden") continue;
      hidden.push([el, el.getAttribute("style")]);
      el.style.setProperty("visibility", "hidden", "important");
    }
    window[${JSON.stringify(HIDDEN)}] = hidden;
    const keys = ${JSON.stringify(imageKeys)};
    const seen = new Set();
    const pics = [];
    for (const i of card.querySelectorAll("img")) {
      const src = i.currentSrc || i.src;
      // The profile's pictures by their ids; without ids, the pictures in the square at the top.
      const theirs = keys.length ? keys.some((k) => src.includes(k)) : !!i.parentElement?.classList.contains("aspect-square");
      if (!src || seen.has(src) || !theirs) continue;
      seen.add(src);
      pics.push({ src, shown: getComputedStyle(i).opacity !== "0" });
    }
    const more = pics.filter((p) => !p.shown);
    if (!more.length) return { card: true, unfolded, added: 0, hidden: hidden.length, pictures: pics.length };
    const box = document.createElement("div");
    box.id = ${JSON.stringify(STRIP)};
    box.style.cssText = "padding:0 32px 32px;display:flex;flex-direction:column;gap:12px;";
    const label = document.createElement("div");
    label.textContent = more.length === 1 ? "1 more picture" : more.length + " more pictures";
    label.style.cssText = "font-size:16px;opacity:.7;";
    const grid = document.createElement("div");
    grid.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px;";
    for (const p of more) {
      const img = document.createElement("img");
      img.src = p.src;
      img.loading = "eager";
      img.alt = "";
      img.style.cssText = "display:block;width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:12px;background:#0002;";
      grid.appendChild(img);
    }
    box.append(label, grid);
    (card.firstElementChild || card).appendChild(box);
    return { card: true, unfolded, added: more.length, hidden: hidden.length, pictures: pics.length };
  })()`;
}

// Whether the pictures laid out under the card have arrived.
export const stripPendingScript = `(() => { const b = document.getElementById(${JSON.stringify(STRIP)}); return b ? [...b.querySelectorAll("img")].filter((i) => !i.complete).length : 0; })()`;

// Takes the extra pictures away and gives back what was hidden. Chrome writes a style changed
// through el.style into the attribute only when it is read, so it is read before it is put back.
export const cleanupScript = `(() => {
  const b = document.getElementById(${JSON.stringify(STRIP)});
  if (b) b.remove();
  const hidden = window[${JSON.stringify(HIDDEN)}] || [];
  for (const [el, css] of hidden) { el.getAttribute("style"); if (css === null) el.removeAttribute("style"); else el.setAttribute("style", css); }
  delete window[${JSON.stringify(HIDDEN)}];
  return { strip: !!b, shown: hidden.length };
})()`;

// The picture of the open profile, once it has finished: the name on the card, no grey loading
// bars, every picture loaded. The "..." under the tags is opened and the other pictures are laid
// out under the card, then the whole card is taken, top to bottom. A page that never finishes is
// still taken, and logged; the worker tries it again later. Returns { data, capture, meta, probe }.
export async function takePicture(driver, profile, { wait, log = () => {}, who = profile?.name } = {}) {
  const w = await waitForProfile(driver, profile?.name, { wait });
  let prep = null;
  let morePending = 0;
  if (w.shown) {
    try { prep = await driver.evaluate(prepareScript(profile?.photoKeys || []), { attempts: 1 }); } catch (e) { log(`could not lay out the page of ${who}: ${e.message}`); }
    if (prep?.added) {
      for (let i = 0; i < 20; i++) {
        let n = 0;
        try { n = await driver.evaluate(stripPendingScript, { attempts: 1 }); } catch { n = 0; }
        morePending = Number(n) || 0;
        if (!morePending) break;
        await wait(500);
      }
    }
    await wait(prep?.unfolded ? 700 : 300);
  }
  let pic = null;
  if (typeof driver.capture === "function") {
    for (const opts of w.shown ? [SHOT_OPTIONS, PAGE_OPTIONS] : [PAGE_OPTIONS]) {
      try { pic = await driver.capture(opts); break; } catch (e) { log(`picture of ${who} (${opts.selector ? "the profile card" : "the whole page"}) failed: ${e.message}`); }
    }
  }
  if (!pic) pic = { data: await driver.screenshot(), capture: "viewport", cut: false };
  if (prep?.added || prep?.hidden) await driver.evaluate(cleanupScript, { attempts: 1 }).catch(() => {});
  const p = w.probe || {};
  const meta = {
    kind: pic.capture, ready: w.ready, shown: w.shown, waitedMs: w.waitedMs, cut: !!pic.cut,
    pictures: prep?.pictures ?? null, unfolded: !!prep?.unfolded, hidden: prep?.hidden ?? 0, morePending,
    loggedIn: p.loggedIn ?? null,
    ...(w.ready ? {} : { unfinished: { card: !!p.card, name: !!p.name, skeleton: p.skeleton ?? null, pending: p.pending ?? null, loggedIn: p.loggedIn ?? null } }),
  };
  if (!w.ready) log(`the page of ${who} had not finished loading after ${Math.round(w.waitedMs / 1000)} s; picture taken anyway (${w.shown ? "the card was there, a picture was still loading" : "the card was not there yet"}), it is taken again later`);
  else if (pic.capture === "viewport") log(`picture of ${who}: only the window, because the browser cannot take a whole page (an older Chrome Agent Bridge; 0.5.0 or newer can)`);
  if (pic.cut) log(`picture of ${who}: the profile is very long and was cut at the height limit`);
  return { data: pic.data, capture: pic.capture, meta, probe: w.probe };
}
