// src/api/collector.js
// One way to talk to the collector (scripts/reviews-apps-script.gs).
//
//   call("admin_stats", { from, to })            signed in, or it throws "signin"
//   call("track", { events }, { auth: "quiet" }) uses a credential only if one is
//                                                already at hand; never prompts
//
// Every failure is a CollectorError with a short `code` the interface can map
// to a sentence: signin | forbidden | network | unavailable | invalid | …
// `why` carries the collector's detail where it gives one.
//
// A session the collector no longer recognises (its secret was changed) is
// dropped and the call is made once more, so the reader is not left holding a
// dead token.

import { REVIEWS } from "../data/books";
import { dropSession, freshCredential, quietCredential } from "../auth/google";

export class CollectorError extends Error {
  constructor(code, why) {
    super(code);
    this.code = code;
    this.why = why || "";
  }
}

export const collectorAvailable = () => Boolean(REVIEWS.endpoint);

const device = () => {
  try {
    return String(navigator.userAgent || "").slice(0, 160);
  } catch {
    return "";
  }
};

async function send(body, { timeout, keepalive }) {
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeout) : 0;
  let res;
  try {
    res = await fetch(REVIEWS.endpoint, {
      method: "POST",
      // text/plain keeps this a "simple" request: no pre-flight for the collector to answer
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
      signal: ctl ? ctl.signal : undefined,
      keepalive: Boolean(keepalive),
    });
  } catch {
    throw new CollectorError("network");
  } finally {
    clearTimeout(timer);
  }
  let d = null;
  try {
    d = await res.json();
  } catch {
    throw new CollectorError("network");
  }
  return d;
}

export async function call(action, payload = {}, opts = {}) {
  const { auth = "required", timeout = 25000, keepalive = false } = opts;
  if (!REVIEWS.endpoint) throw new CollectorError("unavailable");

  let idToken = "";
  if (auth === "required") {
    idToken = (await freshCredential()) || "";
    if (!idToken) throw new CollectorError("signin");
  } else if (auth === "quiet") {
    idToken = quietCredential() || "";
  }

  const body = () => ({ ...payload, action, idToken, ua: device() });
  let d = await send(body(), { timeout, keepalive });

  // our own session was refused: forget it and try once more with a fresh proof
  if (d && d.ok === false && d.error === "auth" && String(idToken).startsWith("s1.") && auth === "required") {
    dropSession();
    idToken = (await freshCredential()) || "";
    if (!idToken) throw new CollectorError("signin");
    d = await send(body(), { timeout, keepalive });
  }

  if (!d || d.ok === false) {
    const code = (d && d.error) || "failed";
    throw new CollectorError(code === "auth" ? "signin" : code, d && d.why);
  }
  return d;
}

/** A sentence for the interface (Hindi first, as the site is). */
export function explain(e) {
  const c = e && e.code;
  if (c === "signin") return "साइन-इन की अवधि पूरी हो गई — फिर से साइन इन कीजिए।";
  if (c === "forbidden") return "इस खाते को यह देखने का अधिकार नहीं है।";
  if (c === "network") return "सर्वर तक पहुँचा नहीं जा सका — इंटरनेट देखकर फिर कोशिश कीजिए।";
  if (c === "unavailable") return "यह सुविधा अभी जुड़ी नहीं है।";
  if (c === "toolarge") return "अवधि बहुत लंबी है — छोटी अवधि चुनिए।";
  if (c === "invalid") return "भरी हुई जानकारी सही नहीं है।";
  if (c === "missing") return "यह अब मौजूद नहीं है।";
  // an older script does not know the newer actions and answers "invalid" or "unknown"
  if (c === "unknown") return "सर्वर की स्क्रिप्ट इस साइट से पुरानी है — नया संस्करण डिप्लॉय कीजिए।";
  return "कुछ गड़बड़ हो गई — थोड़ी देर बाद फिर कोशिश कीजिए।";
}
