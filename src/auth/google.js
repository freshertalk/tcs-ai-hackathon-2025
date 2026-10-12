// src/auth/google.js
// "Google से साइन इन" — Google Identity Services, no server of our own.
//
// Signing in happens once. Google hands the browser a signed ID token, but
// that token lives only about an hour. So the first time it arrives, the
// collector (scripts/reviews-apps-script.gs) checks it with Google, checks that
// the acceptance of the policies is on record, and answers with its own
// *session token*, good for 30 days. From then on every request carries that
// session token; Google is not asked again until the session runs out. A
// reader is never put back through sign-in, or the tick-box, just because an
// hour went by.
//
// Whether someone is the admin is decided by the collector, from the verified
// e-mail — never by anything this file says.
//
// With AUTH.googleClientId empty, none of this is active.

import { useEffect, useState } from "react";
import { AUTH } from "../data/books";

const KEY = "vkt.auth.v1";

export const authConfigured = Boolean(AUTH.googleClientId);

/* ------------------------------------------------------------------ state */
function readStored() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    return s && s.email ? s : null;
  } catch {
    return null;
  }
}

// { credential, exp (s), email, name, picture, session: { token, exp (ms) } }
let state = typeof window === "undefined" ? null : readStored();
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn(state));

// Sign-in and sign-out each have a few things that must follow them: the
// acceptance record and session (src/legal), the key to the book (access.js).
const inHooks = new Set();
const outHooks = new Set();
export function onSignIn(fn) {
  inHooks.add(fn);
  return () => inHooks.delete(fn);
}
export function onSignOut(fn) {
  outHooks.add(fn);
  return () => outHooks.delete(fn);
}

function persist() {
  try {
    if (state) localStorage.setItem(KEY, JSON.stringify(state));
    else localStorage.removeItem(KEY);
  } catch {
    /* signed-in state just will not outlive the tab */
  }
}

function decode(jwt) {
  try {
    const part = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(part)
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("")
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** For showing the person's name and picture. Not for deciding anything. */
export function currentUser() {
  if (!state) return null;
  return {
    name: state.name || state.email,
    email: state.email,
    picture: state.picture || "",
    // a hint for the interface only; the collector decides for real
    admin: String(state.email).toLowerCase() === String(AUTH.adminEmail).toLowerCase(),
  };
}

/** Does this browser hold a session the collector gave it, still in date? */
export function sessionValid() {
  return Boolean(state && state.session && state.session.exp > Date.now() + 60 * 1000);
}

// Something that can turn a lapsed Google token into a session (src/legal/consent.js).
let renewer = null;
let renewFailedAt = 0;
let prompting = null; // the one silent Google request in flight, if any
export function registerRenewer(fn) {
  renewer = fn;
}

/** The collector did not recognise the session: forget it, so it is renewed. */
export function dropSession() {
  if (!state || !state.session) return;
  const { session, ...rest } = state;
  state = rest;
  persist();
}

/** Keep the collector's session token (called once acceptance is on record). */
export function setSession(token, expMs) {
  if (!state || !token) return;
  state = { ...state, session: { token, exp: Number(expMs) || Date.now() + 29 * 86400000 } };
  persist();
  emit();
}

/* ------------------------------------------------------------- the library */
let loading = null;
let ready = false;
let waiting = [];

function loadGis() {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.google && window.google.accounts && window.google.accounts.id) return Promise.resolve();
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.defer = true;
      s.onload = resolve;
      s.onerror = () => {
        loading = null;
        reject(new Error("could not load Google sign-in"));
      };
      document.head.appendChild(s);
    });
  }
  return loading;
}

function onCredential(resp) {
  const p = resp && resp.credential ? decode(resp.credential) : null;
  if (!p || !p.email) return;
  // a fresh Google token for the same person does not discard their session
  const keep = state && state.email === p.email ? state.session : undefined;
  state = {
    credential: resp.credential,
    exp: Number(p.exp) || 0,
    email: p.email,
    name: p.name || "",
    picture: p.picture || "",
    session: keep,
  };
  persist();
  emit();
  inHooks.forEach((fn) => {
    try {
      fn(state);
    } catch {
      /* a hook must never break sign-in */
    }
  });
  const w = waiting;
  waiting = [];
  w.forEach((fn) => fn(state.credential));
}

async function init() {
  if (!authConfigured) throw new Error("sign-in is not configured");
  await loadGis();
  if (ready) return;
  window.google.accounts.id.initialize({
    client_id: AUTH.googleClientId,
    callback: onCredential,
    auto_select: true,
    cancel_on_tap_outside: false,
    itp_support: true,
  });
  ready = true;
}

/** Draw Google's own sign-in button into an element. */
export async function renderSignInButton(el, { width = 280 } = {}) {
  await init();
  window.google.accounts.id.renderButton(el, {
    type: "standard",
    theme: "outline",
    size: "large",
    text: "signin_with",
    shape: "pill",
    logo_alignment: "left",
    locale: "hi",
    width,
  });
}

export function signOut() {
  try {
    if (ready) window.google.accounts.id.disableAutoSelect();
  } catch {
    /* nothing to undo */
  }
  state = null;
  persist();
  emit();
  outHooks.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}

/**
 * Something that proves who is asking: the collector's session token if there
 * is one in date (30 days); otherwise a Google token that is still fresh; then
 * the Google token this browser already holds, even if it has lapsed, which the
 * collector will swap — once — for a session; and only as a last resort a new
 * Google token from Google itself. null means the person has to sign in again.
 */
export async function freshCredential() {
  if (!authConfigured) return null;
  if (sessionValid()) return state.session.token;
  if (state && state.exp * 1000 > Date.now() + 90 * 1000) return state.credential;

  // the person is known to this browser; only Google's hour has run out
  if (state && state.credential && renewer && Date.now() - renewFailedAt > 30 * 1000) {
    let ok = false;
    try {
      ok = await renewer(state.credential);
    } catch {
      ok = false;
    }
    if (ok && sessionValid()) return state.session.token;
    if (!ok) renewFailedAt = Date.now();
  }

  try {
    await init();
  } catch {
    return null;
  }
  // several parts of the page ask at once: they share one attempt, not one each
  if (prompting) return prompting;
  const attempt = new Promise((resolve) => {
    const done = (c) => {
      clearTimeout(timer);
      resolve(c || null);
    };
    const timer = setTimeout(() => done(null), 5000);
    waiting.push(done);
    try {
      window.google.accounts.id.prompt((n) => {
        if (n && (n.isNotDisplayed() || n.isSkippedMoment()) && !(state && state.exp * 1000 > Date.now())) {
          // no silent sign-in available: the page offers a one-press "continue"
          done(null);
        }
      });
    } catch {
      done(null);
    }
  });
  prompting = attempt;
  attempt.then(() => {
    if (prompting === attempt) prompting = null;
  });
  return attempt;
}

/**
 * What can vouch for this person right now without asking Google or anyone: a
 * session in date, or a Google token that is still fresh. Never prompts, never
 * calls the collector — for things (page statistics) that must stay out of the
 * way and are happy to go anonymous.
 */
export function quietCredential() {
  if (!authConfigured) return null;
  if (sessionValid()) return state.session.token;
  if (state && state.exp * 1000 > Date.now() + 30 * 1000) return state.credential;
  return null;
}

/* ------------------------------------------------------------------- hook */
export function useAuth() {
  const [user, setUser] = useState(currentUser);
  useEffect(() => {
    const on = () => setUser(currentUser());
    listeners.add(on);
    on();
    return () => listeners.delete(on);
  }, []);
  return { user, configured: authConfigured, signOut };
}
