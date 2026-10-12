// src/sync/sync.js
// Keep a signed-in reader's place, bookmarks and highlights in step across
// their devices.
//
// Where it is kept: a row per reader per book in the "Sync" tab of the same
// Google Sheet that holds the ratings (scripts/reviews-apps-script.gs). The
// reader's Google token is the key; nothing is kept for anyone who has not
// signed in, and signing in is optional.
//
// What is merged, and how
//   bookmarks, highlights  union; the newer edit of a highlight wins; a removal
//                          travels as a tombstone (see reader/annotations.js)
//   chapters finished      union
//   place in the book      on a device with no place yet, adopted at once;
//                          otherwise a newer place on another device is
//                          *offered* ("वहाँ चलें"), never forced
//
// Reading itself never waits for any of this: every call is best-effort and a
// failure only changes the small status line in the account panel.

import { useEffect, useState } from "react";
import { BOOK, REVIEWS } from "../data/books";
import { authConfigured, currentUser, freshCredential } from "../auth/google";
import { getProgress, onProgressChange, replaceProgress } from "../library/progress";
import { mergeMarks, onMarksChange, readBook, sameMarks, writeBook } from "../reader/annotations";

const PUSH_DELAY = 4000;
const MAX_JSON = 44000; // a spreadsheet cell holds 50,000 characters

/* ------------------------------------------------------------------ state */
let status = authConfigured && REVIEWS.endpoint ? "idle" : "off"; // off | idle | syncing | ok | error | expired
let lastAt = 0;
const suggestions = new Map(); // slug -> { chapter, pos, overall, at }
const slugs = new Set([BOOK.slug]);
const listeners = new Set();
let applying = false;
let pushTimer = 0;
let active = false;

const emit = () => listeners.forEach((fn) => fn());
const setStatus = (s) => {
  status = s;
  if (s === "ok") lastAt = Date.now();
  emit();
};

export function syncAvailable() {
  return authConfigured && Boolean(REVIEWS.endpoint);
}

/** Ask the sync to look after another book too (the reader does this). */
export function watchBook(slug) {
  if (!slug || slugs.has(slug)) return;
  slugs.add(slug);
  if (active) pull(slug);
}

/* -------------------------------------------------------------- transport */
async function call(action, payload) {
  const idToken = await freshCredential();
  if (!idToken) {
    const e = new Error("signin");
    e.code = "signin";
    throw e;
  }
  const res = await fetch(REVIEWS.endpoint, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, idToken, ...payload }),
  });
  if (!res.ok) throw new Error("http");
  const d = await res.json();
  if (!d || d.ok === false) {
    const e = new Error((d && d.error) || "failed");
    e.code = d && d.error;
    throw e;
  }
  return d;
}

function snapshot(slug) {
  const p = getProgress(slug);
  const m = readBook(slug);
  const marks = m.marks.map((x) => ({ ...x, text: String(x.text || "").slice(0, 160) }));
  return {
    v: 1,
    progress: p
      ? { chapter: p.chapter, pos: p.pos, overall: p.overall, at: p.at, done: p.done || {} }
      : null,
    bookmarks: m.bookmarks,
    marks,
    tomb: m.tomb,
  };
}

function trim(data) {
  // very old tombstones are the first thing to let go if the row would not fit
  let json = JSON.stringify(data);
  if (json.length <= MAX_JSON) return data;
  const entries = Object.entries(data.tomb || {}).sort((a, b) => a[1] - b[1]);
  const tomb = { ...data.tomb };
  while (entries.length && JSON.stringify({ ...data, tomb }).length > MAX_JSON) {
    delete tomb[entries.shift()[0]];
  }
  return { ...data, tomb };
}

/* ------------------------------------------------------------------- pull */
export async function pull(slug) {
  if (!active) return;
  setStatus("syncing");
  try {
    const d = await call("sync_get", { slug });
    const remote = d.data && typeof d.data === "object" ? d.data : null;
    let needPush = !remote;

    if (remote) {
      /* marks */
      const local = readBook(slug);
      const merged = mergeMarks(local, remote);
      if (!sameMarks(local, merged)) {
        applying = true;
        try {
          writeBook(slug, merged);
        } finally {
          applying = false;
        }
      }
      if (!sameMarks(remote, merged)) needPush = true;

      /* place and chapters finished */
      const lp = getProgress(slug);
      const rp = remote.progress;
      if (rp && rp.chapter) {
        const done = { ...((lp && lp.done) || {}), ...(rp.done || {}) };
        const doneGrew = Object.keys(done).length !== Object.keys((lp && lp.done) || {}).length;

        if (!lp || !lp.chapter) {
          applying = true;
          try {
            replaceProgress(slug, { ...rp, done });
          } finally {
            applying = false;
          }
        } else {
          if (doneGrew) {
            applying = true;
            try {
              replaceProgress(slug, { ...lp, done });
            } finally {
              applying = false;
            }
          }
          const ahead =
            (rp.at || 0) > (lp.at || 0) + 5000 &&
            (rp.chapter !== lp.chapter || Math.abs((rp.pos || 0) - (lp.pos || 0)) > 0.04);
          if (ahead) suggestions.set(slug, { chapter: rp.chapter, pos: rp.pos || 0, overall: rp.overall || 0, at: rp.at });
          else suggestions.delete(slug);
          if ((lp.at || 0) > (rp.at || 0)) needPush = true;
        }
      } else if (getProgress(slug)) {
        needPush = true;
      }
    }

    if (needPush) await push(slug, true);
    setStatus("ok");
  } catch (e) {
    setStatus(e && e.code === "signin" ? "expired" : "error");
  }
}

/* ------------------------------------------------------------------ push */
export async function push(slug, quiet = false) {
  if (!active) return;
  if (!quiet) setStatus("syncing");
  try {
    const data = trim(snapshot(slug));
    await call("sync_put", { slug, data });
    if (!quiet) setStatus("ok");
  } catch (e) {
    if (!quiet) setStatus(e && e.code === "signin" ? "expired" : "error");
    else throw e;
  }
}

function schedulePush() {
  if (!active || applying) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    slugs.forEach((s) => push(s));
  }, PUSH_DELAY);
}

/* ---------------------------------------------------------------- control */
let offProgress = null;
let offMarks = null;
let onVisible = null;
let lastPull = 0;

export function startSync() {
  if (active || !syncAvailable() || !currentUser()) return;
  active = true;
  setStatus("idle");

  offProgress = onProgressChange(schedulePush);
  offMarks = onMarksChange(schedulePush);

  slugs.forEach((s) => pull(s));
  lastPull = Date.now();

  onVisible = () => {
    if (document.visibilityState !== "visible") {
      // leaving: push what is waiting rather than lose it
      clearTimeout(pushTimer);
      slugs.forEach((s) => push(s, true).catch(() => {}));
      return;
    }
    if (Date.now() - lastPull > 60 * 1000) {
      lastPull = Date.now();
      slugs.forEach((s) => pull(s));
    }
  };
  document.addEventListener("visibilitychange", onVisible);
}

export function stopSync() {
  if (!active) {
    status = syncAvailable() ? "idle" : "off";
    return;
  }
  active = false;
  clearTimeout(pushTimer);
  if (offProgress) offProgress();
  if (offMarks) offMarks();
  if (onVisible) document.removeEventListener("visibilitychange", onVisible);
  suggestions.clear();
  status = syncAvailable() ? "idle" : "off";
  emit();
}

/** Take the offered place: returns it and clears the offer. */
export function takeSuggestion(slug) {
  const s = suggestions.get(slug) || null;
  suggestions.delete(slug);
  emit();
  return s;
}

export function dismissSuggestion(slug) {
  suggestions.delete(slug);
  emit();
}

/* ------------------------------------------------------------------ hooks */
export function useSyncStatus() {
  const [, tick] = useState(0);
  useEffect(() => {
    const on = () => tick((n) => n + 1);
    listeners.add(on);
    return () => listeners.delete(on);
  }, []);
  return { status, lastAt, available: syncAvailable() };
}

/** A newer place on another device, if there is one to offer. */
export function useSuggestion(slug) {
  const [, tick] = useState(0);
  useEffect(() => {
    const on = () => tick((n) => n + 1);
    listeners.add(on);
    return () => listeners.delete(on);
  }, []);
  const s = suggestions.get(slug) || null;
  // if this device has read past it since, the offer is stale
  if (s) {
    const lp = getProgress(slug);
    if (lp && (lp.at || 0) >= s.at) return null;
  }
  return s;
}
