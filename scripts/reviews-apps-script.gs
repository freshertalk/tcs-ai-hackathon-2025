/**
 * दो कुल्हड़ चाय — पाठकों की राय
 * Ratings and comments, kept in a Google Sheet, with "Sign in with Google" for
 * readers and for you (the admin). No server and no database of your own.
 *
 * SET-UP
 *   1. A Google Sheet  ▸  Extensions ▸ Apps Script  ▸  paste this file.
 *   2. Fill in CLIENT_ID below (see "GOOGLE SIGN-IN"). Leave it empty to keep
 *      the site anonymous — readers then need no account at all.
 *   3. Deploy ▸ New deployment ▸ Web app
 *        Execute as:      Me
 *        Who has access:  Anyone
 *      Copy the "Web app" URL into REVIEWS.endpoint in src/data/books.js.
 *   4. After changing this file: Deploy ▸ Manage deployments ▸ ✏ ▸
 *      Version: New version ▸ Deploy. The URL stays the same.
 *
 * GOOGLE SIGN-IN (about ten minutes, once)
 *   a. console.cloud.google.com ▸ create a project (any name).
 *   b. APIs & Services ▸ OAuth consent screen ▸ External ▸ app name, your
 *      e-mail ▸ Save. Then "Publish app" so any reader may sign in.
 *      (Only the basic scopes — name, e-mail, picture — are used, so Google
 *      does not ask for a review.)
 *   c. APIs & Services ▸ Credentials ▸ Create credentials ▸ OAuth client ID ▸
 *      Web application. Under "Authorized JavaScript origins" add
 *        https://vinaytiwari.org   (and any other address the site is on,
 *        and http://localhost:3000 while you are testing).
 *      Create. Copy the Client ID (ends in .apps.googleusercontent.com).
 *   d. Paste it as CLIENT_ID below AND as AUTH.googleClientId in
 *      src/data/books.js. It is not a secret.
 *
 * WHO CAN DO WHAT
 *   Anyone     reads the tally and the approved comments.
 *   Signed in  also keeps their place, bookmarks and highlights in step
 *              across devices (the "Sync" tab, one row per reader per book —
 *              only that reader's own Google token can read or write it).
 *   A reader   (signed in with Google) rates once, writes one comment, and
 *              may change or take back their own.
 *   ADMIN      (the e-mail below, verified by Google) sees every comment on
 *              the site, approves or hides it, and deletes any.
 *   The site only ever sends a Google-signed token; this script verifies it
 *   with Google and decides. The browser cannot grant itself admin rights.
 */

var CLIENT_ID = "886670255024-mhd165asnk3l9m3oio6limie2n9h7cff.apps.googleusercontent.com";
var ADMIN_EMAIL = "author.vinaytiwari1@gmail.com";
var REQUIRE_GOOGLE = true; // with a CLIENT_ID set, an anonymous post is refused
var REQUIRE_APPROVAL = true; // a comment shows only after it is approved
var MAX_COMMENTS = 40;

// The edition of the legal documents (src/data/legal.js, LEGAL.version). A
// reader's key is released only if their latest acceptance is for this
// edition — change both together, and everyone is asked to accept again.
var LEGAL_VERSION = "2026-10-12";

// Bumped whenever this file changes in a way worth being able to see from outside:
// open  <web-app URL>?check=1  in a browser to read it.
var BUILD = "2026-10-12-text-cells";

var SHEET_NAME = "Reviews";
var CONSENT_SHEET = "Consent"; // the owner's permanent record of acceptance
var KEYS_SHEET = "Keys"; // slug | version | key   — paste from book-keys-for-sheet.tsv
var ACCESS_SHEET = "Access"; // when a key was released, and to whom
var SYNC_SHEET = "Sync";
var MAX_SYNC_JSON = 45000; // a cell holds 50,000 characters
// A..G are as before; H and I are new (e-mail never leaves this sheet)
var HEADERS = ["time", "slug", "device", "rating", "name", "comment", "approved", "email", "picture"];

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
  } else if (String(sh.getRange(1, 8).getValue()) !== "email") {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]); // an older sheet: add H, I
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

/* ------------------------------------------------------- who is asking */
/**
 * Who is asking? Either a session token this script issued earlier (30 days,
 * "s1.…") or a Google ID token. Returns { sub, email, name, picture } or null.
 */
function verify_(idToken, allowLapsed) {
  if (!idToken) return null;
  if (String(idToken).indexOf("s1.") === 0) return verifySession_(idToken);
  var u = verifyGoogle_(idToken);
  if (!u && allowLapsed) u = verifyLapsedGoogle_(idToken);
  return u;
}

/* ---- sessions: signed by this script, so Google is asked only once ---- */
var SESSION_DAYS = 30;

function secret_() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty("SESSION_SECRET");
  if (!s) {
    s = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid();
    props.setProperty("SESSION_SECRET", s);
  }
  return s;
}

function b64u_(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, "");
}

function makeSession_(user) {
  var payload = {
    sub: user.sub,
    email: user.email,
    name: user.name,
    picture: user.picture,
    exp: Date.now() + SESSION_DAYS * 86400000,
  };
  var body = b64u_(Utilities.newBlob(JSON.stringify(payload)).getBytes());
  var sig = b64u_(Utilities.computeHmacSha256Signature(body, secret_()));
  return { token: "s1." + body + "." + sig, exp: payload.exp };
}

function verifySession_(token) {
  var m = /^s1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(token || ""));
  if (!m) return null;
  var sig = b64u_(Utilities.computeHmacSha256Signature(m[1], secret_()));
  if (sig !== m[2]) return null;
  try {
    var pad = m[1] + "===".slice((m[1].length + 3) % 4);
    var p = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(pad)).getDataAsString());
    if (!p || Number(p.exp) < Date.now()) return null;
    return { sub: String(p.sub), email: String(p.email), name: String(p.name || ""), picture: String(p.picture || "") };
  } catch (err) {
    return null;
  }
}

/**
 * Google rotates its signing keys. A token can only be checked later against the
 * key that signed it, so note the keys now and then: the website asks for the
 * tally on every visit, so this is done there, at most once an hour.
 */
function rememberGoogleKeys_() {
  try {
    var cache = CacheService.getScriptCache();
    if (cache.get("keys_noted")) return;
    cache.put("keys_noted", "1", 3600);
    googleKey_("-"); // an id nobody has: fetches the list and merges it in
  } catch (err) {
    /* never let this break a page */
  }
}

/** Verify a Google ID token. Returns { sub, email, name, picture } or null. */
function verifyGoogle_(idToken) {
  if (!CLIENT_ID || !idToken) return null;
  var cache = CacheService.getScriptCache();
  var key =
    "t_" +
    Utilities.base64EncodeWebSafe(
      Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(idToken))
    ).slice(0, 40);
  var hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  var res = UrlFetchApp.fetch(
    "https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken),
    { muteHttpExceptions: true }
  );
  if (res.getResponseCode() !== 200) return null;
  var t = JSON.parse(res.getContentText());
  if (t.aud !== CLIENT_ID) return null; // minted for someone else's app
  if (String(t.email_verified) !== "true") return null;
  if (Number(t.exp) * 1000 < Date.now()) return null;

  var u = {
    sub: String(t.sub),
    email: String(t.email || "").toLowerCase(),
    name: String(t.name || ""),
    picture: String(t.picture || ""),
  };
  cache.put(key, JSON.stringify(u), 300);
  return u;
}

/* ---- a Google token that has lapsed (they live about an hour) -----------
 * A reader who signed in before sessions existed holds a token Google itself no
 * longer vouches for. Its signature is still Google's, though, so it can be
 * checked here against Google's published keys. It is accepted ONLY to issue a
 * session (action "session") or to write down an acceptance the browser already
 * holds (action "consent", source "signin-retry"), and only for LAPSED_DAYS.
 * Everything else still needs a live Google token or a session. Needs the V8
 * runtime (BigInt), which is the default for new Apps Script projects.
 */
var LAPSED_DAYS = 30;
var GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

function pad64_(s) {
  s = String(s || "");
  return s + "===".slice((s.length + 3) % 4);
}

function bytesToHex_(bytes) {
  var out = "";
  for (var i = 0; i < bytes.length; i++) {
    var h = (bytes[i] & 255).toString(16);
    out += h.length === 1 ? "0" + h : h;
  }
  return out;
}

/** RSASSA-PKCS1-v1_5 / SHA-256, the way Google signs ID tokens. */
function rsaSha256Verify_(signingInput, sigB64u, nB64u, eB64u) {
  if (typeof BigInt !== "function") return false;
  var zero = BigInt(0);
  var one = BigInt(1);
  var two = BigInt(2);
  var n = BigInt("0x" + bytesToHex_(Utilities.base64DecodeWebSafe(pad64_(nB64u))));
  var e = BigInt("0x" + bytesToHex_(Utilities.base64DecodeWebSafe(pad64_(eB64u))));
  var sigHex = bytesToHex_(Utilities.base64DecodeWebSafe(pad64_(sigB64u)));
  if (!sigHex) return false;
  var sig = BigInt("0x" + sigHex);
  if (sig >= n) return false;

  var result = one;
  var base = sig % n;
  var exp = e;
  while (exp > zero) {
    if (exp % two === one) result = (result * base) % n;
    base = (base * base) % n;
    exp = exp / two;
  }

  var k = Math.ceil(n.toString(16).length / 2); // bytes in the modulus
  var em = result.toString(16);
  while (em.length < k * 2) em = "0" + em;

  var digest = bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, signingInput));
  var prefix = "3031300d060960864801650304020105000420"; // DigestInfo for SHA-256
  var padLen = k - 3 - prefix.length / 2 - 32;
  if (padLen < 8) return false;
  var ff = "";
  for (var i = 0; i < padLen; i++) ff += "ff";
  return em === "0001" + ff + "00" + prefix + digest;
}

/** Google's signing keys, remembered by id so an older token's key is not lost. */
function googleKey_(kid) {
  var props = PropertiesService.getScriptProperties();
  var held = {};
  try {
    held = JSON.parse(props.getProperty("GOOGLE_KEYS") || "{}");
  } catch (err) {
    held = {};
  }
  if (held[kid]) return held[kid];

  var res = UrlFetchApp.fetch(GOOGLE_JWKS_URL, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  var list = (JSON.parse(res.getContentText()).keys || []).filter(function (k) {
    return k.kty === "RSA" && k.kid && k.n && k.e;
  });
  // newest last, and as many as one script property (9 KB) holds
  var order = Object.keys(held);
  list.forEach(function (k) {
    if (!held[k.kid]) order.push(k.kid);
    held[k.kid] = { n: k.n, e: k.e };
  });
  while (order.length > 16) delete held[order.shift()];
  props.setProperty("GOOGLE_KEYS", JSON.stringify(held));
  return held[kid] || null;
}

var lapsedWhy_ = ""; // why the last lapsed token was refused (answered to the browser)
function lapsed_(why) {
  lapsedWhy_ = why;
  return null;
}

function verifyLapsedGoogle_(idToken) {
  try {
    if (!CLIENT_ID) return lapsed_("no-client-id");
    var parts = String(idToken).split(".");
    if (parts.length !== 3) return lapsed_("not-a-token");
    var head = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(pad64_(parts[0]))).getDataAsString());
    var p = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(pad64_(parts[1]))).getDataAsString());
    if (!head || head.alg !== "RS256" || !head.kid) return lapsed_("not-a-token");
    if (p.iss !== "accounts.google.com" && p.iss !== "https://accounts.google.com") return lapsed_("issuer");
    if (p.aud !== CLIENT_ID) return lapsed_("other-app");
    if (String(p.email_verified) !== "true") return lapsed_("email-unverified");
    var expMs = Number(p.exp) * 1000;
    var now = Date.now();
    if (!(expMs > now - LAPSED_DAYS * 86400000)) return lapsed_("too-old"); // older than this allows
    if (Number(p.iat) * 1000 > now + 5 * 60000) return lapsed_("from-the-future");

    var key = googleKey_(head.kid);
    if (!key) return lapsed_("key-unknown"); // Google no longer lists the key that signed it
    if (!rsaSha256Verify_(parts[0] + "." + parts[1], parts[2], key.n, key.e)) return lapsed_("bad-signature");
    lapsedWhy_ = "";

    return {
      sub: String(p.sub),
      email: String(p.email || "").toLowerCase(),
      name: String(p.name || ""),
      picture: String(p.picture || ""),
      lapsed: true,
    };
  } catch (err) {
    return lapsed_("error");
  }
}

function isAdmin_(user) {
  return !!user && user.email === String(ADMIN_EMAIL).toLowerCase();
}

/* --------------------------------------------------------------- reading */
/** The tally and the approved comments for one book. Public. */
function doGet(e) {
  if (e && e.parameter && e.parameter.check) return json_(health_());
  var slug = String((e && e.parameter && e.parameter.slug) || "");
  rememberGoogleKeys_();
  var rows = sheet_().getDataRange().getValues().slice(1);
  var dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  var sum = 0;
  var count = 0;
  var comments = [];

  rows.forEach(function (r) {
    if (String(r[1]) !== slug) return;
    var n = Number(r[3]);
    if (!(n >= 1 && n <= 5)) return;
    dist[n] += 1;
    sum += n;
    count += 1;
    var text = String(r[5] || "").trim();
    var ok = !REQUIRE_APPROVAL || String(r[6]).toUpperCase() === "Y";
    if (text && ok) {
      comments.push({
        name: String(r[4] || ""),
        picture: String(r[8] || ""),
        rating: n,
        comment: text,
        at: new Date(r[0]).toISOString(),
      });
    }
  });

  comments.sort(function (a, b) {
    return a.at < b.at ? 1 : -1;
  });

  return json_({
    ok: true,
    slug: slug,
    signIn: !!CLIENT_ID && REQUIRE_GOOGLE,
    count: count,
    average: count ? Math.round((sum / count) * 10) / 10 : 0,
    distribution: dist,
    comments: comments.slice(0, MAX_COMMENTS),
  });
}

/* --------------------------------------------------------------- writing */
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var d = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    var action = String(d.action || "review");

    // a hidden field a person never fills in: if it has text, it was a robot
    if (d.hp) return json_({ ok: true });

    lapsedWhy_ = "";
    // a lapsed Google token is good for two things only (see verifyLapsedGoogle_)
    var lapsedOk = action === "session" || (action === "consent" && String(d.source) === "signin-retry");
    var user = verify_(d.idToken, lapsedOk);

    // the permanent record that a person accepted the documents
    if (action === "consent") {
      if (!user) return json_({ ok: false, error: "auth", why: lapsedWhy_ });
      return consent_(d, user);
    }

    // a returning person whose Google token lapsed: a new session, provided
    // their acceptance of the current edition is on record
    if (action === "session") {
      if (!user) return json_({ ok: false, error: "auth", why: lapsedWhy_ });
      if (!hasConsent_(user)) return json_({ ok: false, error: "consent" });
      var s = makeSession_(user);
      return json_({ ok: true, session: s.token, exp: s.exp });
    }

    var slug = String(d.slug || "").slice(0, 80);
    if (!slug) return json_({ ok: false, error: "invalid" });

    // the key to the book: signed in + accepted the current documents
    if (action === "book_key") return bookKey_(d, user, slug);

    if (action === "review") return review_(d, user, slug);

    // a reader's own place, bookmarks and highlights: only their own token
    if (action === "sync_get" || action === "sync_put") {
      if (!user) return json_({ ok: false, error: "auth" });
      return action === "sync_get" ? syncGet_(user, slug) : syncPut_(user, slug, d.data);
    }

    // everything else is for the admin alone
    if (!isAdmin_(user)) return json_({ ok: false, error: "forbidden" });
    if (action === "admin_list") return adminList_(slug);
    if (action === "admin_set") return adminSet_(slug, String(d.key || ""), !!d.approved);
    if (action === "admin_delete") return adminDelete_(slug, String(d.key || ""));
    return json_({ ok: false, error: "unknown" });
  } catch (err) {
    return json_({ ok: false, error: "server" });
  } finally {
    lock.releaseLock();
  }
}

function review_(d, user, slug) {
  var rating = Math.round(Number(d.rating));
  if (!(rating >= 1 && rating <= 5)) return json_({ ok: false, error: "invalid" });

  var key;
  var name = String(d.name || "").trim().slice(0, 40);
  var email = "";
  var picture = "";

  if (CLIENT_ID && REQUIRE_GOOGLE) {
    if (!user) return json_({ ok: false, error: "auth" });
    key = "google:" + user.sub;
    email = user.email;
    picture = user.picture;
    if (!name) name = user.name;
  } else {
    key = String(d.device || "").slice(0, 64);
    if (!key) return json_({ ok: false, error: "invalid" });
    if (user) {
      email = user.email;
      picture = user.picture;
    }
  }
  var comment = String(d.comment || "").trim().slice(0, 600);

  var sh = sheet_();
  var data = sh.getDataRange().getValues();
  var row = [new Date(), slug, key, rating, name, comment, "", email, picture];

  // one voice per account (or device) per book: a returning reader changes their own
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][1]) === slug && String(data[i][2]) === key) {
      var same = String(data[i][5]) === comment;
      row[6] = same ? data[i][6] : ""; // new words need approving again
      // the admin's own words need no one's leave
      if (isAdmin_(user)) row[6] = "Y";
      sh.getRange(i + 1, 1, 1, HEADERS.length).setValues([row]);
      return json_({ ok: true, pending: !!comment && REQUIRE_APPROVAL && row[6] !== "Y" });
    }
  }
  if (isAdmin_(user)) row[6] = "Y";
  sh.appendRow(row);
  return json_({ ok: true, pending: !!comment && REQUIRE_APPROVAL && row[6] !== "Y" });
}

/* ----------------------------------------------------------------- admin */
function adminList_(slug) {
  var rows = sheet_().getDataRange().getValues().slice(1);
  var out = [];
  rows.forEach(function (r) {
    if (String(r[1]) !== slug) return;
    out.push({
      key: String(r[2]),
      rating: Number(r[3]),
      name: String(r[4] || ""),
      email: String(r[7] || ""),
      picture: String(r[8] || ""),
      comment: String(r[5] || ""),
      approved: String(r[6]).toUpperCase() === "Y",
      at: new Date(r[0]).toISOString(),
    });
  });
  out.sort(function (a, b) {
    return a.at < b.at ? 1 : -1;
  });
  return json_({ ok: true, rows: out });
}

function findRow_(sh, slug, key) {
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][1]) === slug && String(data[i][2]) === key) return i + 1;
  }
  return 0;
}

function adminSet_(slug, key, approved) {
  var sh = sheet_();
  var at = findRow_(sh, slug, key);
  if (!at) return json_({ ok: false, error: "missing" });
  sh.getRange(at, 7).setValue(approved ? "Y" : "");
  return json_({ ok: true });
}

function adminDelete_(slug, key) {
  var sh = sheet_();
  var at = findRow_(sh, slug, key);
  if (!at) return json_({ ok: false, error: "missing" });
  sh.deleteRow(at);
  return json_({ ok: true });
}

/* ------------------------------------------------------------------ sync */
function syncSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SYNC_SHEET);
  if (!sh) {
    sh = ss.insertSheet(SYNC_SHEET);
    sh.appendRow(["key", "slug", "updated", "email", "json"]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function syncRow_(sh, key, slug) {
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === key && String(data[i][1]) === slug) return i + 1;
  }
  return 0;
}

function syncGet_(user, slug) {
  var sh = syncSheet_();
  var at = syncRow_(sh, "google:" + user.sub, slug);
  if (!at) return json_({ ok: true, data: null });
  var row = sh.getRange(at, 1, 1, 5).getValues()[0];
  var data = null;
  try {
    data = JSON.parse(String(row[4] || "null"));
  } catch (err) {
    data = null;
  }
  return json_({ ok: true, data: data, updated: new Date(row[2]).toISOString() });
}

function syncPut_(user, slug, data) {
  var text = JSON.stringify(data || null);
  if (!data || typeof data !== "object") return json_({ ok: false, error: "invalid" });
  if (text.length > MAX_SYNC_JSON) return json_({ ok: false, error: "toolarge" });
  var sh = syncSheet_();
  var key = "google:" + user.sub;
  var at = syncRow_(sh, key, slug);
  var row = [key, slug, new Date(), user.email, text];
  if (at) sh.getRange(at, 1, 1, 5).setValues([row]);
  else sh.appendRow(row);
  return json_({ ok: true });
}

/* ----------------------------------------------- consent, and the key */
function tab_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  }
  return sh;
}

/**
 * Write a row with its text kept as text. Left alone, Google Sheets "helpfully"
 * turns a 21-digit account id into a rounded number and "2026-10-12" into a
 * date — and then nothing written there ever compares equal again.
 */
function appendText_(sh, row) {
  var at = sh.getLastRow() + 1;
  var rng = sh.getRange(at, 1, 1, row.length);
  rng.setNumberFormats([
    row.map(function (v) {
      return v instanceof Date ? "yyyy-mm-dd hh:mm:ss" : "@";
    }),
  ]);
  rng.setValues([row]);
}

/** A cell as the text it was meant to be (rows written before appendText_ hold dates). */
function textOf_(v) {
  if (v instanceof Date) {
    var tz = "";
    try {
      tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
    } catch (err) {
      tz = "";
    }
    return Utilities.formatDate(v, tz || "UTC", "yyyy-MM-dd");
  }
  return String(v);
}

/** Append-only: every acceptance is a new row and none is ever edited. */
function consent_(d, user) {
  var sh = tab_(CONSENT_SHEET, [
    "time", "sub", "email", "name", "legal_version", "cookies", "accepted",
    "source", "user_agent", "language", "page", "timezone", "client_time",
  ]);
  appendText_(sh, [
    new Date(),
    "g:" + user.sub,
    user.email,
    user.name,
    String(d.legal || ""),
    String(d.cookies || ""),
    JSON.stringify(d.accepted || {}),
    String(d.source || "") + (user.lapsed ? " (token had lapsed)" : ""),
    String(d.ua || "").slice(0, 400),
    String(d.lang || "").slice(0, 40),
    String(d.page || "").slice(0, 400),
    String(d.tz || "").slice(0, 60),
    String(d.clientTime || "").slice(0, 40),
  ]);
  var s = makeSession_(user);
  return json_({ ok: true, legal: LEGAL_VERSION, session: s.token, exp: s.exp });
}

/** Has this account accepted the current edition? (latest row wins) */
function hasConsent_(user) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONSENT_SHEET);
  if (!sh) return false;
  var data = sh.getDataRange().getValues();
  var me = "g:" + user.sub;
  var mail = String(user.email || "").toLowerCase();
  for (var i = data.length - 1; i >= 1; i--) {
    var who = String(data[i][1]);
    // new rows carry "g:<id>"; rows written before that hold a rounded number
    // for the id, so the e-mail beside it (exact, and verified by Google) counts
    if (who === me || who === user.sub || (mail && String(data[i][2]).toLowerCase() === mail)) {
      return textOf_(data[i][4]) === LEGAL_VERSION;
    }
  }
  return false;
}

function bookKey_(d, user, slug) {
  if (!user) return json_({ ok: false, error: "auth" });
  if (String(d.legal || "") !== LEGAL_VERSION || !hasConsent_(user)) {
    return json_({ ok: false, error: "consent" });
  }
  var version = String(d.version || "");
  var keys = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(KEYS_SHEET);
  if (!keys) return json_({ ok: false, error: "nokey" });
  var rows = keys.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === slug && textOf_(rows[i][1]) === version) {
      appendText_(tab_(ACCESS_SHEET, ["time", "sub", "email", "slug", "version"]), [
        new Date(), "g:" + user.sub, user.email, slug, version,
      ]);
      return json_({ ok: true, key: String(rows[i][2]).trim() });
    }
  }
  return json_({ ok: false, error: "nokey" });
}

/* ------------------------------------------------------------- self-check */
/**
 * Pick "checkSetup" in the function list above the editor and press Run. It
 * prints what it finds in the Execution log and changes nothing in your Sheet.
 * Handy after pasting a new version.
 *
 * (Do not worry if running doGet or doPost from the editor shows an "unknown
 * error": those are made to be called by the website, not by the Run button.)
 */
function checkSetup() {
  var lines = [];
  function say(ok, text) {
    lines.push((ok ? "OK    " : "FIX   ") + text);
  }
  var ss = null;
  try {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  } catch (err) {
    ss = null;
  }
  say(!!ss, "script is attached to your Sheet (open it from Extensions > Apps Script inside the Sheet)");
  say(!!CLIENT_ID, "CLIENT_ID is filled in");
  say(typeof BigInt === "function", "V8 runtime is on (Project Settings > tick Enable Chrome V8 runtime; needed for the lapsed-login renewal)");
  if (ss) {
    var keys = ss.getSheetByName(KEYS_SHEET);
    say(!!keys && keys.getLastRow() >= 2, "the Keys tab has the book row (slug | version | key)");
    var consent = ss.getSheetByName(CONSENT_SHEET);
    say(!!consent && consent.getLastRow() >= 2, "the Consent tab exists and has at least one acceptance (appears after the first sign-in)");
  }
  try {
    var r = UrlFetchApp.fetch(GOOGLE_JWKS_URL, { muteHttpExceptions: true });
    say(r.getResponseCode() === 200, "can reach the list of Google signing keys");
  } catch (err) {
    say(false, "could not reach the list of Google signing keys: " + err);
  }
  say(selfTestRsa_(), "signature check works on this runtime (accepts a real signature, rejects a changed message)");
  Logger.log("\n" + lines.join("\n"));
}

/** A known signature: true if it is accepted and a changed message is refused. */
function selfTestRsa_() {
  try {
    var n = "0PGATPlpJETz6PKrW4fnkXg1F3g6f90SVW8EjtanTHYXe23-FCVVSUHJDUbt792OMJONH2WaaxzdIW4Bl667SCsIF0cLKtHkiu6BXDJOsg7VIjpcpmxXb72yRbZ9ikQJ5DxjW_0AdKpRO9k063QSO9BHpE1lE86D__6qMog_DyHW4LG4VZg61MjM3BQeIrL_D0kNyA6gRkM5e5gNZSTAcBI4aWU5MdOzwBefQx8eqzDogFW4e9B4f8-mcwVIhRGli7FKmeTtXU5DD447N1Ekv1zNo2hgLi6AEYWAZb349WNUF19f9YxCVh0X3FmKVNEu9ZHEE1WI7VLSFjl-u_mjtQ";
    var e = "AQAB";
    var sig = "KEhrpIS8tm-1jwJNxMN2UapNZrMd9Ier5rkP59myJKhgvuvl0jFFE_0qwYNIl7BseE-xF-LbWfz8XSoPUgnPK_NYw86riynSPTlcTEYKTyzeK1i1B4WhHxDWZVAhEjIJ07jMT0tcLu1gBGSsL4WtDhwEfJnBiXJi0WRCPKPnax1hMV1RJmA2Xer_YbMRtwCBo3x81akOWXMssKyxJ18mUFo7QjocUbN9lsaS4niHeYBATyfDget4T7yoTFjMlqCMH63kiF2XY1Uozx_kWmSLHrlfjU7afsdQeIBGInNF8pm4PHycHYJEZeLWdI2hHURo5JddUhAoWfMEipiXKtDVhw";
    return rsaSha256Verify_("vkt.self-test", sig, n, e) === true && rsaSha256Verify_("another message", sig, n, e) === false;
  } catch (err) {
    return false;
  }
}

/**
 * What  <web-app URL>?check=1  returns. Only yes/no answers and the build
 * name — no names, e-mails, keys or counts — so it is safe to be public.
 */
function health_() {
  var out = { ok: true, build: BUILD, v8: typeof BigInt === "function", clientId: !!CLIENT_ID, legal: LEGAL_VERSION };
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var keys = ss.getSheetByName(KEYS_SHEET);
    out.keysTab = !!keys && keys.getLastRow() >= 2;
    var consent = ss.getSheetByName(CONSENT_SHEET);
    out.consentTab = !!consent && consent.getLastRow() >= 2;
  } catch (err) {
    out.sheet = false;
  }
  out.signatureCheck = selfTestRsa_();
  return out;
}
