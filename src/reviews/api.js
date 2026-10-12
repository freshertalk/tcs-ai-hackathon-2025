// src/reviews/api.js
// Ratings and comments, with no sign-in.
//
// Where they live
//   • REVIEWS.endpoint (src/data/books.js) is the address of a small web app
//     that keeps them in a Google Sheet — see scripts/reviews-apps-script.gs.
//     With it set, everyone sees the same ratings and the approved comments.
//   • Without it, nothing is invented: a reader's own rating is kept in their
//     own browser, and the page says so and offers to e-mail it to the author.
//
// One device, one rating per book: a random id, made on first use and kept in
// the browser, lets a returning reader change what they said instead of
// adding a second voice. It identifies no one.
//
// Google Books: if REVIEWS.googleBooksId is set and Google has a rating for
// that volume, it is shown beside ours, labelled as Google's.

import { REVIEWS } from "../data/books";
import { authConfigured, freshCredential } from "../auth/google";

const DEVICE_KEY = "vkt.reviews.device.v1";
const MINE_KEY = "vkt.reviews.mine.v1";

const empty = () => ({
  configured: Boolean(REVIEWS.endpoint),
  loaded: false,
  count: 0,
  average: 0,
  distribution: [0, 0, 0, 0, 0],
  comments: [],
  signIn: false,
});

/* ------------------------------------------------------------- this device */
function safe(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function deviceId() {
  return safe(() => {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      const bytes = new Uint8Array(12);
      crypto.getRandomValues(bytes);
      id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  }, "anon");
}

export function getMine(slug) {
  return safe(() => {
    const all = JSON.parse(localStorage.getItem(MINE_KEY)) || {};
    return all[slug] || null;
  }, null);
}

function saveMine(slug, review) {
  safe(() => {
    const all = JSON.parse(localStorage.getItem(MINE_KEY)) || {};
    all[slug] = review;
    localStorage.setItem(MINE_KEY, JSON.stringify(all));
  });
}

/* ---------------------------------------------------------------- summary */
const cache = new Map(); // slug -> summary
const inflight = new Map(); // slug -> Promise
const listeners = new Map(); // slug -> Set<fn>

const announce = (slug) => {
  const set = listeners.get(slug);
  if (set) set.forEach((fn) => fn(cache.get(slug)));
};

export function peekSummary(slug) {
  return cache.get(slug) || empty();
}

export function subscribe(slug, fn) {
  if (!listeners.has(slug)) listeners.set(slug, new Set());
  listeners.get(slug).add(fn);
  return () => listeners.get(slug).delete(fn);
}

function normalise(d) {
  const dist = [1, 2, 3, 4, 5].map((n) => Number(d.distribution && d.distribution[n]) || 0);
  const count = Number(d.count) || dist.reduce((a, b) => a + b, 0);
  return {
    configured: true,
    loaded: true,
    signIn: Boolean(d.signIn),
    count,
    average: Number(d.average) || 0,
    distribution: dist,
    comments: Array.isArray(d.comments)
      ? d.comments
          .filter((c) => c && String(c.comment || "").trim())
          .map((c) => ({
            name: String(c.name || "").slice(0, 40),
            picture: /^https:\/\//.test(String(c.picture || "")) ? String(c.picture) : "",
            rating: Number(c.rating) || 0,
            comment: String(c.comment).slice(0, 600),
            at: String(c.at || ""),
          }))
      : [],
  };
}

export function loadSummary(slug, { fresh = false } = {}) {
  if (!REVIEWS.endpoint) {
    const s = { ...empty(), loaded: true };
    cache.set(slug, s);
    return Promise.resolve(s);
  }
  if (!fresh && cache.get(slug) && cache.get(slug).loaded) return Promise.resolve(cache.get(slug));
  if (inflight.has(slug)) return inflight.get(slug);

  const url = `${REVIEWS.endpoint}${REVIEWS.endpoint.includes("?") ? "&" : "?"}slug=${encodeURIComponent(slug)}`;
  const p = fetch(url, { method: "GET", cache: "no-store" })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((d) => {
      if (!d || d.ok === false) throw new Error("bad reply");
      const s = normalise(d);
      cache.set(slug, s);
      return s;
    })
    .catch(() => {
      // the reviews are an extra: failing to reach them must never break a page
      const s = { ...empty(), loaded: true, failed: true };
      if (!cache.get(slug)) cache.set(slug, s);
      return cache.get(slug);
    })
    .finally(() => {
      inflight.delete(slug);
      announce(slug);
    });
  inflight.set(slug, p);
  return p;
}

/* ----------------------------------------------------------------- submit */
/**
 * Send a rating (and an optional name and comment).
 * Resolves { ok, shared, pending }:
 *   shared  — it reached the collector (everyone can count it)
 *   pending — the comment is waiting for the author's approval
 */
export async function submitReview({ slug, rating, name, comment, hp }) {
  const clean = {
    slug,
    rating: Math.min(5, Math.max(1, Math.round(Number(rating)))),
    name: String(name || "").trim().slice(0, 40),
    comment: String(comment || "").trim().slice(0, 600),
  };
  saveMine(slug, { ...clean, at: new Date().toISOString() });

  if (!REVIEWS.endpoint) return { ok: true, shared: false, pending: false };

  // a signed-in reader proves who they are with Google's token
  let idToken = "";
  if (authConfigured) {
    idToken = (await freshCredential()) || "";
    if (!idToken && peekSummary(slug).signIn) throw new Error("signin");
  }

  const res = await fetch(REVIEWS.endpoint, {
    method: "POST",
    // text/plain keeps this a "simple" request: no pre-flight for the collector to answer
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ ...clean, device: deviceId(), idToken, hp: hp || "" }),
  });
  if (!res.ok) throw new Error("send failed");
  let body = {};
  try {
    body = await res.json();
  } catch {
    /* an unreadable reply is still a delivered one */
  }
  if (body && body.ok === false) throw new Error(body.error || "refused");

  // show the new tally without waiting for the next visit
  loadSummary(slug, { fresh: true });
  return { ok: true, shared: true, pending: Boolean(body && body.pending) };
}

/* ------------------------------------------------------------ google books */
const gbCache = new Map();

/** { average, count, link } when Google Books has a rating for the volume; else null. */
export function loadGoogleBooks(volumeId) {
  if (!volumeId) return Promise.resolve(null);
  if (gbCache.has(volumeId)) return gbCache.get(volumeId);
  const p = fetch(`https://www.googleapis.com/books/v1/volumes/${encodeURIComponent(volumeId)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      const v = d && d.volumeInfo;
      if (!v || !v.averageRating || !v.ratingsCount) return null;
      return { average: Number(v.averageRating), count: Number(v.ratingsCount), link: v.infoLink || "" };
    })
    .catch(() => null);
  gbCache.set(volumeId, p);
  return p;
}

/* ------------------------------------------------------------------ admin */
// These only work for the admin account: the collector checks Google's token
// and the e-mail inside it, and refuses everyone else.
async function adminCall(action, extra) {
  if (!REVIEWS.endpoint) throw new Error("no endpoint");
  const idToken = await freshCredential();
  if (!idToken) throw new Error("signin");
  const res = await fetch(REVIEWS.endpoint, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, idToken, ...extra }),
  });
  const d = await res.json();
  if (!d || d.ok === false) throw new Error((d && d.error) || "failed");
  return d;
}

/** Every rating and comment for a book, pending ones included. */
export const adminList = (slug) => adminCall("admin_list", { slug }).then((d) => d.rows || []);
export const adminApprove = (slug, key, approved) => adminCall("admin_set", { slug, key, approved });
export const adminRemove = (slug, key) => adminCall("admin_delete", { slug, key });
