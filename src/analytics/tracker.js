// src/analytics/tracker.js
// Page views and time on the site, kept in the owner's own Sheet.
//
// What is measured
//   • a page view when the address changes
//   • the seconds a person was actually *there*: the tab visible and something
//     done (a tap, a key, a scroll) within the last minute — three minutes
//     inside the reader, where a page of prose is read without touching
//     anything
//   • a chapter opened
//
// What is not
//   • no IP address (the collector cannot see one), no content typed, no
//     fingerprinting, no third-party analytics script
//
// Who is counted, and how
//   • signed in      → by account (the Privacy Policy, accepted at sign-in,
//                      says so)
//   • "Accept"       → by a random id kept in this browser
//   • "Necessary only" → page views only, with no id at all
//   • no choice yet  → nothing is sent until there is one
//
// Everything is batched (every 30 s and when the tab is hidden), kept in
// local storage if it cannot be sent yet, and never allowed to get in the way
// of the page: a failure is silently retried later.

import { REVIEWS } from "../data/books";
import { call } from "../api/collector";
import { getCookieChoice } from "../legal/consent";
import { currentUser } from "../auth/google";
import { meSnapshot } from "../account/me";

const VID_KEY = "vkt.vid.v1";
const SID_KEY = "vkt.sid.v1";
const Q_KEY = "vkt.q.v1";
const FLUSH_MS = 30 * 1000;
const TICK_MS = 5 * 1000;
const MAX_QUEUE = 120;
const MAX_BATCH = 50;
const SESSION_IDLE_MS = 30 * 60 * 1000;

let queue = [];
let cur = null; // { path, secs }
let lastActive = 0;
let lastTick = 0;
let started = false;
let flushing = false;
let failures = 0;
let sentRefFor = "";
let timers = [];

/* ------------------------------------------------------------------ helpers */
const safe = (fn, dflt) => {
  try {
    return fn();
  } catch {
    return dflt;
  }
};

const randomId = () => {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
};

const isBot = () =>
  safe(
    () =>
      /bot|crawl|spider|slurp|headless|lighthouse|prerender|preview/i.test(navigator.userAgent || "") ||
      navigator.webdriver === true,
    false
  );

const deviceClass = () =>
  safe(() => {
    const w = Math.min(window.screen.width || 1200, window.screen.height || 1200);
    const touch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    if (touch && w < 600) return "m";
    if (touch && w < 1100) return "t";
    return "d";
  }, "d");

function visitorId() {
  return safe(() => {
    let id = localStorage.getItem(VID_KEY);
    if (!id) {
      id = randomId();
      localStorage.setItem(VID_KEY, id);
    }
    return id;
  }, "");
}

function sessionId() {
  return safe(() => {
    const now = Date.now();
    const s = JSON.parse(sessionStorage.getItem(SID_KEY) || "null");
    if (s && s.id && now - s.at < SESSION_IDLE_MS) {
      sessionStorage.setItem(SID_KEY, JSON.stringify({ id: s.id, at: now }));
      return s.id;
    }
    const id = randomId().slice(0, 16);
    sessionStorage.setItem(SID_KEY, JSON.stringify({ id, at: now }));
    return id;
  }, "");
}

/** "full" | "views" | "wait" | "off" */
function level() {
  if (!REVIEWS.endpoint || isBot()) return "off";
  const me = meSnapshot();
  if (me && me.role === "admin") return "off"; // the admin's own browsing is not the audience
  const u = currentUser();
  if (u && u.admin) return "off";
  if (u) return "full";
  const c = getCookieChoice();
  if (!c) return "wait";
  return c.choice === "all" ? "full" : "views";
}

function loadQueue() {
  queue = safe(() => JSON.parse(localStorage.getItem(Q_KEY) || "[]"), []);
  if (!Array.isArray(queue)) queue = [];
}

function saveQueue() {
  safe(() => {
    if (queue.length) localStorage.setItem(Q_KEY, JSON.stringify(queue.slice(-MAX_QUEUE)));
    else localStorage.removeItem(Q_KEY);
  });
}

function push(ev) {
  queue.push(ev);
  if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
}

const idleLimit = (path) => (path && path.indexOf("/read/") === 0 ? 180 * 1000 : 60 * 1000);

/* ------------------------------------------------------------ measuring time */
function closeCurrent() {
  if (cur && cur.secs >= 1) {
    push({ k: "t", p: cur.path, s: Math.round(cur.secs), a: Date.now(), d: deviceClass() });
    cur.secs = 0;
  }
}

function tick() {
  const now = Date.now();
  const dt = Math.min(TICK_MS * 2, now - (lastTick || now));
  lastTick = now;
  if (!cur || document.visibilityState !== "visible") return;
  if (now - lastActive > idleLimit(cur.path)) return;
  cur.secs += dt / 1000;
}

/* ----------------------------------------------------------------- sending */
export async function flush({ unload = false } = {}) {
  closeCurrent();
  const lvl = level();
  if (lvl === "off") {
    queue = [];
    saveQueue();
    return;
  }
  if (lvl === "wait" || !queue.length || flushing) {
    saveQueue();
    return;
  }

  let batch = queue.slice(0, MAX_BATCH);
  if (lvl === "views") batch = batch.filter((e) => e.k === "v").map((e) => ({ ...e, r: "" }));
  const taken = Math.min(queue.length, MAX_BATCH);
  queue = queue.slice(taken);
  saveQueue();
  if (!batch.length) return;

  flushing = true;
  try {
    await call(
      "track",
      {
        vid: lvl === "full" ? visitorId() : "",
        sid: lvl === "full" ? sessionId() : "",
        events: batch,
      },
      { auth: lvl === "full" ? "quiet" : "none", keepalive: unload, timeout: 15000 }
    );
    failures = 0;
  } catch {
    // keep them for the next try, but do not grow without bound
    failures += 1;
    if (failures < 6) {
      queue = batch.concat(queue).slice(-MAX_QUEUE);
      saveQueue();
    }
  } finally {
    flushing = false;
  }
}

/* ------------------------------------------------------------------ public */
export function trackView(path) {
  if (!started || !path) return;
  closeCurrent();
  const now = Date.now();
  lastActive = now;
  const ev = { k: "v", p: path, a: now, d: deviceClass() };

  // where a visit came from: once per visit, and only if it was another site
  if (!sentRefFor) {
    sentRefFor = "1";
    safe(() => {
      const ref = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, "") : "";
      if (ref && ref !== window.location.hostname) ev.r = ref.slice(0, 60);
    });
  }
  push(ev);

  // a chapter opened (not the cover page)
  const m = /^\/read\/[^/]+\/([^/]+)$/.exec(path);
  if (m && m[1] !== "cover") push({ k: "c", p: path, a: now, d: deviceClass() });

  cur = { path, secs: 0 };
  saveQueue();
}

export function startTracker() {
  if (started || typeof window === "undefined") return () => {};
  started = true;
  loadQueue();
  lastActive = Date.now();
  lastTick = Date.now();

  const touch = () => {
    lastActive = Date.now();
  };
  const evs = ["pointerdown", "keydown", "wheel", "touchstart", "scroll", "mousemove"];
  evs.forEach((n) => window.addEventListener(n, touch, { passive: true, capture: true }));

  const onHide = () => {
    if (document.visibilityState === "hidden") flush({ unload: true });
  };
  const onPageHide = () => flush({ unload: true });
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", onPageHide);

  timers = [setInterval(tick, TICK_MS), setInterval(() => flush(), FLUSH_MS)];

  // what was left from a previous visit goes out soon, not at the next 30 s
  setTimeout(() => flush(), 4000);

  return () => {
    started = false;
    timers.forEach(clearInterval);
    timers = [];
    evs.forEach((n) => window.removeEventListener(n, touch, { capture: true }));
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("pagehide", onPageHide);
  };
}
