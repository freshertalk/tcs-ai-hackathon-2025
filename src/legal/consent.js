// src/legal/consent.js
// The record of what a visitor was shown and agreed to — and the session that
// follows it.
//
//   • On a first visit the cookie notice asks for a choice; it is kept in this
//     browser together with the edition of the documents it referred to.
//   • To sign in, a person must tick that they agree to the Terms of Use,
//     Privacy Policy and Refund Policy. When Google then returns a signed
//     token, the acceptance is sent to the collector, which verifies the token
//     and writes a permanent row to the "Consent" tab of the Sheet (time,
//     account, e-mail, edition, cookie choice, browser, page). The collector
//     answers with a 30-day session token (see src/auth/google.js), so that
//     is the last time the person is asked anything.
//   • A returning person whose Google token has merely expired (not their
//     acceptance) gets a session by a plain exchange — no tick-box.
//   • The key that unlocks the book is released by the collector only to an
//     account whose latest consent row is for the current edition.

import { useEffect, useState } from "react";
import { REVIEWS } from "../data/books";
import { LEGAL } from "../data/legal";
import { authConfigured, currentUser, onSignIn, onSignOut, registerRenewer, sessionValid, setSession, signOut } from "../auth/google";

const COOKIE_KEY = "vkt.consent.v1";
const TERMS_KEY = "vkt.terms.v1";
const PENDING_KEY = "vkt.terms.pending";

/* ---------------------------------------------------------- cookie notice */
const cookieListeners = new Set();

export function getCookieChoice() {
  try {
    const c = JSON.parse(localStorage.getItem(COOKIE_KEY));
    return c && c.version === LEGAL.version ? c : null;
  } catch {
    return null;
  }
}

export function saveCookieChoice(choice) {
  const rec = { version: LEGAL.version, choice, at: new Date().toISOString() };
  try {
    localStorage.setItem(COOKIE_KEY, JSON.stringify(rec));
  } catch {
    /* the choice just will not outlive the tab */
  }
  cookieListeners.forEach((fn) => fn(rec));
  return rec;
}

export function reopenCookieNotice() {
  try {
    localStorage.removeItem(COOKIE_KEY);
  } catch {
    /* ignore */
  }
  cookieListeners.forEach((fn) => fn(null));
}

export function useCookieChoice() {
  const [c, setC] = useState(getCookieChoice);
  useEffect(() => {
    cookieListeners.add(setC);
    return () => cookieListeners.delete(setC);
  }, []);
  return c;
}

/* ---------------------------------------------------- acceptance at sign-in */
export function markTermsPending(on) {
  try {
    if (on) sessionStorage.setItem(PENDING_KEY, new Date().toISOString());
    else sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* without session storage the acceptance cannot be carried across the sign-in */
  }
}

const pending = () => {
  try {
    return sessionStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
};

function localRecord() {
  try {
    const t = JSON.parse(localStorage.getItem(TERMS_KEY));
    return t && t.version === LEGAL.version ? t : null;
  } catch {
    return null;
  }
}

/** Has this person, on this browser, accepted the current edition? */
export function localTermsAccepted(email) {
  const t = localRecord();
  return Boolean(t && (!email || t.email === email));
}

function rememberLocally(email, at) {
  try {
    localStorage.setItem(TERMS_KEY, JSON.stringify({ version: LEGAL.version, at: at || new Date().toISOString(), email }));
  } catch {
    /* the server's record is the one that counts */
  }
}

let inflight = null;

/* what went wrong the last time a sign-in step failed, so the page can say */
let issue = null;
const issueListeners = new Set();
function setIssue(code, why) {
  issue = code ? { code: String(code), why: why ? String(why) : "", at: Date.now() } : null;
  issueListeners.forEach((fn) => fn(issue));
  if (code) {
    // eslint-disable-next-line no-console
    console.warn("[login] a sign-in step did not complete:", code, why || "");
  }
}
onSignOut(() => setIssue(null));

/** For other parts of the login (the key request) to say what went wrong. */
export function reportIssue(code, why) {
  setIssue(code, why);
}

export function useLoginIssue() {
  const [v, setV] = useState(issue);
  useEffect(() => {
    issueListeners.add(setV);
    return () => issueListeners.delete(setV);
  }, []);
  return v;
}

/** Resolves when any acceptance or session exchange being written has landed. */
export function consentSettled() {
  return inflight || Promise.resolve();
}

/** The edition the collector answered with, when it is not this site's. */
function skew(d) {
  return d && d.legal && String(d.legal) !== LEGAL.version ? String(d.legal) : "";
}

async function post(body) {
  const res = await fetch(REVIEWS.endpoint, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
  });
  const d = await res.json();
  if (!d || d.ok === false) {
    const e = new Error((d && d.error) || "failed");
    e.code = d && d.error;
    e.why = d && d.why;
    throw e;
  }
  return d;
}

function consentBody(idToken, source, clientTime) {
  const c = getCookieChoice();
  return {
    action: "consent",
    idToken,
    legal: LEGAL.version,
    cookies: c ? c.choice : "not-chosen",
    accepted: { terms: true, privacy: true, refund: true },
    source,
    ua: navigator.userAgent,
    lang: navigator.language,
    page: window.location.href,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    clientTime: clientTime || new Date().toISOString(),
  };
}

/**
 * The server did not have this person's acceptance, but this browser does (they
 * ticked the box at login and the first write was lost). Send it again, with the
 * moment they actually accepted. Returns true when the record is in place.
 */
export async function retryAcceptance(idToken) {
  const t = localRecord();
  const u = currentUser();
  if (!t || !u || t.email !== u.email || !idToken) return false;
  inflight = post(consentBody(idToken, "signin-retry", t.at))
    .then((d) => {
      // it wrote the acceptance — but for an edition it does not recognise as
      // the current one, so the key will not be released: tell them why
      const s = skew(d);
      if (s) {
        setIssue("edition-skew", s);
        return false;
      }
      if (d.session) setSession(d.session, d.exp);
      setIssue(null);
      return true;
    })
    .catch((e) => {
      setIssue((e && e.code) || "network");
      return false;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * This browser knows the person (and holds their acceptance) but has no session,
 * and the Google token it has has lapsed — typically a login made before
 * sessions existed. The collector accepts such a token, once, for exactly this
 * exchange. Returns true when a session is now held.
 */
let renewing = null;
async function renewSession(idToken) {
  if (!REVIEWS.endpoint || !idToken) return false;
  if (renewing) return renewing;
  renewing = (async () => {
    try {
      await consentSettled();
      if (sessionValid()) return true;
      try {
        const d = await post({ action: "session", idToken });
        if (d.session) {
          setSession(d.session, d.exp);
          setIssue(null);
          return true;
        }
        return false;
      } catch (e) {
        const code = (e && e.code) || "network";
        // the server lacks the row this browser knows exists: write it again
        if (code === "consent" && (await retryAcceptance(idToken))) return true;
        // the server would not vouch for the lapsed token: say why on the card
        setIssue(code === "auth" ? "renew-auth" : code, e && e.why);
        return false;
      }
    } finally {
      renewing = null;
    }
  })();
  return renewing;
}
registerRenewer(renewSession);

// The moment Google hands back a token:
//   • if the person has just ticked the box → write down what was agreed
//   • otherwise, if there is no session yet → exchange the token for one
//   • otherwise (a silent refresh of Google's token) → nothing to do
onSignIn((s) => {
  if (!REVIEWS.endpoint) return;
  const accepting = Boolean(pending());
  if (!accepting && sessionValid()) return;

  if (accepting) rememberLocally(s.email);

  const body = accepting ? consentBody(s.credential, "signin") : { action: "session", idToken: s.credential };

  inflight = post(body)
    .then((d) => {
      if (d.session) setSession(d.session, d.exp);
      const s = skew(d);
      if (s) setIssue("edition-skew", s);
      else setIssue(null);
      if (accepting) {
        try {
          sessionStorage.removeItem(PENDING_KEY);
        } catch {
          /* ignore */
        }
      }
    })
    .catch((e) => {
      // not fatal by itself — the key request repairs a missing acceptance —
      // but remembered, so a card that stays can say why
      setIssue((e && e.code) || "network");
    })
    .finally(() => {
      inflight = null;
    });
});

// A session opened before acceptance was recorded, or under an older edition
// of the documents, is not carried on silently: it is closed so the person
// meets the one place acceptance is given — the sign-in.
if (typeof window !== "undefined" && authConfigured) {
  const u = currentUser();
  if (u && !localTermsAccepted(u.email)) signOut();
}
