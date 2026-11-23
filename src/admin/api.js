// Thin fetch wrapper for the private API. The X-Requested-With header is the
// server's CSRF check: a cross-site form cannot send it.

// The last good answer to each market read, kept for this visit. A screen that was open a
// moment ago — a stock you come back to, a workspace you switch back to — is drawn at once
// from here while the fresh answer is on its way, instead of starting from "Loading…".
// Account and order data are never kept: those are always read fresh.
import { isLive, resync } from "./live";

const seen = new Map();
const KEEP = 120;
const keeps = (path) => path.startsWith("/api/admin/market/") && !path.includes("/search");

/** The remembered answer to a read, or null when there is none or it is older than maxAgeMs. */
export function peek(path, maxAgeMs = 5 * 60 * 1000) {
  const hit = seen.get(path);
  return hit && Date.now() - hit.at <= maxAgeMs ? hit.data : null;
}

// ---- being a good neighbour when the terminal is open in several tabs
// The web server in front counts requests and open connections per visitor, across every tab. So:
//  · one tab keeps at most MAX_ACTIVE requests in flight; the rest wait their turn (a slow one —
//    an AI answer can take minutes — gives its turn back after SLOW_MS, so it never blocks the page);
//  · a read refused as "too many" (429) or "busy" (503) is tried again after the wait the server
//    asks for (Retry-After), or a short random one, instead of failing on screen; and while one
//    such wait is running, this tab's other reads wait for it too rather than piling on.
// Orders and other writes are never sent twice by this: only GETs are retried.
export const apiTuning = { maxActive: 8, slowMs: 4000, retries: 2, waitMs: 1200, readTimeoutMs: 45000, writeTimeoutMs: 5 * 60000 };
// A signed-in session that ends while a page is open (it expired, the address was taken off the list, or you signed out in
// another tab): the server answers 401, and the app goes back to the sign-in door instead of showing errors everywhere.
export const SIGNED_OUT_EVENT = "drishti:signed-out";
let active = 0;
const queue = [];
let coolUntil = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function acquire() {
  if (active < apiTuning.maxActive) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => queue.push(resolve));
}
function release() {
  const next = queue.shift();
  if (next) next();
  else active = Math.max(0, active - 1);
}

async function send(path, method, body) {
  await acquire();
  let freed = false;
  const free = () => {
    if (freed) return;
    freed = true;
    release();
  };
  const slow = setTimeout(free, apiTuning.slowMs);
  // no request waits for ever: a read gives up after 45 s, a change (an AI run, a training) after 5 minutes
  const ctl = typeof AbortController === "function" ? new AbortController() : null;
  const limit = method === "GET" ? apiTuning.readTimeoutMs : apiTuning.writeTimeoutMs;
  const cut = ctl ? setTimeout(() => ctl.abort(), limit) : null;
  try {
    return await fetch(path, {
      method,
      signal: ctl ? ctl.signal : undefined,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "X-Requested-With": "vpt",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (err && err.name === "AbortError") {
      const e = new Error(method === "GET" ? "The server took too long to answer; this is read again by itself." : "The server took too long to answer. It may still finish: check again in a moment.");
      e.status = 504;
      e.code = "timeout";
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(slow);
    if (cut) clearTimeout(cut);
    free();
  }
}

/** How long the server asks us to wait (Retry-After, in seconds), else a short random wait. */
function waitFor(res, attempt) {
  const h = res.headers && typeof res.headers.get === "function" ? Number(res.headers.get("retry-after")) : NaN;
  const base = Number.isFinite(h) && h > 0 ? Math.min(h, 30) * 1000 : apiTuning.waitMs * (attempt + 1);
  return base + Math.round(Math.random() * apiTuning.waitMs);
}

export async function api(path, { method = "GET", body } = {}) {
  let res;
  for (let attempt = 0; ; attempt += 1) {
    if (method === "GET" && coolUntil > Date.now()) await sleep(coolUntil - Date.now());
    res = await send(path, method, body);
    const busy = res.status === 429 || res.status === 503;
    if (!busy || method !== "GET" || attempt >= apiTuning.retries) break;
    const wait = waitFor(res, attempt);
    coolUntil = Math.max(coolUntil, Date.now() + wait);
    await sleep(wait);
  }

  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    /* empty or non-JSON body */
  }

  // A web page in answer to an API call means the request never reached the server program:
  // the web server in front (or a static host) handed out the site's own page for it. Left
  // alone this looked like "not signed in", and the sign-in link then landed on the home page.
  const type = res.headers && typeof res.headers.get === "function" ? res.headers.get("content-type") || "" : "";
  if (res.ok && data === null && type.toLowerCase().includes("text/html")) {
    const err = new Error("The server is not answering at this address: requests to /api are coming back as the site's own page.");
    err.status = 502;
    err.code = "not_api";
    throw err;
  }

  if (res.status === 401 && !String(path).startsWith("/api/auth/") && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SIGNED_OUT_EVENT, { detail: { path } }));
  }
  if (!res.ok) {
    const err = new Error(
      (data && data.message) ||
        (res.status === 429
          ? "The server is busy with many requests just now (the terminal may be open in several tabs). This fills in by itself in a moment."
          : res.status === 404 || res.status === 502 || res.status === 504
            ? "The server is not reachable."
            : `Request failed (${res.status}).`)
    );
    err.status = res.status;
    err.code = (data && data.error) || (res.status === 429 ? "rate_limited" : undefined);
    err.data = data; // the rest of the server's answer (a pause's seconds, for one)
    throw err;
  }
  if (method === "GET" && data && keeps(path)) {
    seen.delete(path);
    if (seen.size >= KEEP) seen.delete(seen.keys().next().value);
    seen.set(path, { at: Date.now(), data });
  }
  // A change this tab just made reaches every page through the server's live event within milliseconds. Should the live
  // connection be down, every page re-reads once now instead (never waiting for its own timer).
  if (method !== "GET" && typeof window !== "undefined" && !isLive()) resync("local");
  return data;
}
