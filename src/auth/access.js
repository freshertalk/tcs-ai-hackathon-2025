// src/auth/access.js
// The key to the book.
//
// Chapter files on the server are encrypted (AES-256-GCM) with a key that is
// not in the site's code and not on the web server. It lives only in the
// collector's Sheet, and the collector hands it out only to a request that
//   • carries a Google token it can verify, and
//   • comes from an account whose latest consent record is for the current
//     edition of the Terms, Privacy Policy and Refund Policy.
// Without both, the chapter files are noise — so "you must be signed in to
// read" holds for anyone who fetches the files directly, too.
//
// Once it has been released to a signed-in reader the key stays on that
// device, for that account and that edition of the documents — so the person
// is not sent back to the collector, or to Google, every time they open a
// chapter. Signing out removes it, as does a new edition of the documents.

import { REVIEWS } from "../data/books";
import { LEGAL } from "../data/legal";
import { authConfigured, currentUser, dropSession, freshCredential, onSignOut } from "./google";

export class AccessError extends Error {
  constructor(code) {
    super(code);
    this.code = code; // signin | consent | nokey | network
  }
}

const keys = new Map(); // `${slug}:${version}` -> Promise<CryptoKey>
const skey = (b) => `vkt.bk.${b.slug}.${b.version}`;

/* the key as kept on this device: { k, e: account, l: edition of the documents } */
function heldKey(book) {
  const u = currentUser();
  if (!u) return null;
  try {
    const r = JSON.parse(localStorage.getItem(skey(book)));
    if (r && r.k && r.e === u.email && r.l === LEGAL.version) return r.k;
  } catch {
    /* nothing held */
  }
  return null;
}

function holdKey(book, hex) {
  const u = currentUser();
  if (!u) return;
  try {
    localStorage.setItem(skey(book), JSON.stringify({ k: hex, e: u.email, l: LEGAL.version }));
  } catch {
    /* held in memory only */
  }
}

/** Is reading behind sign-in for this book? */
export function accessRequired(book) {
  return Boolean(authConfigured && REVIEWS.endpoint && book && book.enc);
}

const hexToBytes = (hex) => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

async function askForKey(book, credential) {
  let res;
  try {
    res = await fetch(REVIEWS.endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "book_key",
        idToken: credential,
        slug: book.slug,
        version: book.version,
        legal: LEGAL.version,
      }),
    });
  } catch {
    throw new AccessError("network");
  }
  let d = null;
  try {
    d = await res.json();
  } catch {
    throw new AccessError("network");
  }
  if (d && d.ok && d.key) return d.key;
  const code = d && d.error;
  if (code === "auth") throw new AccessError("signin");
  if (code === "consent") throw new AccessError("consent");
  if (code === "nokey") throw new AccessError("nokey");
  throw new AccessError("network");
}

async function fetchKey(book) {
  // an acceptance or session exchange still being written must land first
  const { consentSettled, retryAcceptance, reportIssue } = await import("../legal/consent");
  await consentSettled();

  // a session, or — renewed quietly if need be — a Google token
  let credential = await freshCredential();
  if (!credential) throw new AccessError("signin");

  try {
    try {
      return await askForKey(book, credential);
    } catch (e) {
      // a session this collector no longer recognises: drop it, renew, ask again
      if (e instanceof AccessError && e.code === "signin" && String(credential).startsWith("s1.")) {
        dropSession();
        const next = await freshCredential();
        if (next && next !== credential) {
          credential = next;
          return await askForKey(book, credential);
        }
      }
      throw e;
    }
  } catch (e) {
    // This browser holds the person's acceptance (they ticked the box at login)
    // but the first write to the record did not land: send it again, once,
    // rather than put them through sign-in a second time.
    if (e instanceof AccessError && e.code === "consent" && (await retryAcceptance(credential))) {
      const again = (await freshCredential()) || credential;
      try {
        return await askForKey(book, again);
      } catch (e2) {
        // written down, and still not found: the record there does not match
        if (e2 instanceof AccessError && e2.code === "consent") reportIssue("consent-record");
        throw e2;
      }
    }
    throw e;
  }
}

/** The AES key for this edition, fetched once per session. */
export function ensureAccess(book) {
  const id = `${book.slug}:${book.version}`;
  if (keys.has(id)) return keys.get(id);

  const p = (async () => {
    let hex = heldKey(book);
    if (!hex) {
      hex = await fetchKey(book);
      holdKey(book, hex);
    }
    return crypto.subtle.importKey("raw", hexToBytes(hex), "AES-GCM", false, ["decrypt"]);
  })();

  // a failure must not be remembered: the reader will try again after signing in
  p.catch(() => keys.delete(id));
  keys.set(id, p);
  return p;
}

/** base64( iv[12] | ciphertext | tag[16] ) → text. */
export async function decryptChapter(book, id, b64) {
  const key = await ensureAccess(book);
  const bin = atob(b64.trim());
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const plain = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: bytes.slice(0, 12),
      additionalData: new TextEncoder().encode(`${book.slug}:${book.version}:${id}`),
    },
    key,
    bytes.slice(12)
  );
  return new TextDecoder().decode(plain);
}

/** Forget every key (sign-out). */
export function forgetKeys() {
  keys.clear();
  for (const store of ["localStorage", "sessionStorage"]) {
    try {
      const s = window[store];
      const gone = [];
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (k && k.startsWith("vkt.bk.")) gone.push(k);
      }
      gone.forEach((k) => s.removeItem(k));
    } catch {
      /* nothing to forget */
    }
  }
}

onSignOut(forgetKeys);
