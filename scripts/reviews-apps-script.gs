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
var LEGAL_VERSION = "2026-10-12.2";

// Bumped whenever this file changes in a way worth being able to see from outside:
// open  <web-app URL>?check=1  in a browser to read it.
var BUILD = "2026-10-12-dashboards";

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
  return !!user && adminEmails_().indexOf(String(user.email).toLowerCase()) >= 0;
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
        name: plain_(r[4]),
        picture: String(r[8] || ""),
        rating: n,
        comment: plain_(text),
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
// Actions that only read do not wait in the queue for the script lock, so a
// dashboard cannot hold up a reader opening a book (and the other way round).
var READ_ONLY_ = {
  session: 1, sync_get: 1, admin_list: 1, admin_stats: 1, admin_users: 1, audit_list: 1,
  coupon_list: 1, coupon_check: 1, coupon_redemptions: 1, me: 1, export_me: 1, team_list: 1,
};

function doPost(e) {
  var lock = null;
  try {
    var d = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    var action = String(d.action || "review");

    // a hidden field a person never fills in: if it has text, it was a robot
    if (d.hp) return json_({ ok: true });

    if (!READ_ONLY_[action]) {
      lock = LockService.getScriptLock();
      lock.waitLock(10000);
      LOCKED_ = true;
    }

    lapsedWhy_ = "";
    // a lapsed Google token is good for two things only (see verifyLapsedGoogle_)
    var lapsedOk = action === "session" || (action === "consent" && String(d.source) === "signin-retry");
    var user = verify_(d.idToken, lapsedOk);
    d.ua = clean_(d.ua, 160);

    // page views and time on page: anyone, signed in or not
    if (action === "track") return track_(d, user);

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

    /* ---- a reader's own account ---- */
    if (action === "me") {
      if (!user) return json_({ ok: false, error: "auth" });
      return meCached_(user);
    }
    if (action === "export_me") {
      if (!user) return json_({ ok: false, error: "auth" });
      audit_(user, "data.export", user.email, "downloaded their data", true, d.ua);
      return json_(meSummary_(user, true));
    }
    if (action === "erase_me") {
      if (!user) return json_({ ok: false, error: "auth" });
      if (String(d.confirm) !== "ERASE") return json_({ ok: false, error: "invalid" });
      return json_({ ok: true, erased: eraseMe_(user, d.ua) });
    }

    /* ---- coupons, for a reader ---- */
    if (action === "coupon_check") {
      if (!user) return json_({ ok: true, valid: false, reason: "signin" });
      if (!allow_("cc_" + user.sub, 30, 600)) return json_({ ok: true, valid: false, reason: "limited" });
      var chk = couponPublic_(couponCheck_(d.code, user, clean_(d.slug, 80), null));
      chk.ok = true;
      return json_(chk);
    }
    if (action === "coupon_redeem") {
      if (!user) return json_({ ok: false, error: "auth" });
      if (!allow_("cc_" + user.sub, 30, 600)) return json_({ ok: true, valid: false, reason: "limited" });
      return couponRedeem_(d, user);
    }

    var slug = String(d.slug || "").slice(0, 80);
    var needsSlug = { book_key: 1, review: 1, sync_get: 1, sync_put: 1, admin_list: 1, admin_set: 1, admin_delete: 1 };
    if (needsSlug[action] && !slug) return json_({ ok: false, error: "invalid" });

    // the key to the book: signed in + accepted the current documents
    if (action === "book_key") return bookKey_(d, user, slug);

    if (action === "review") return review_(d, user, slug);

    // a reader's own place, bookmarks and highlights: only their own token
    if (action === "sync_get" || action === "sync_put") {
      if (!user) return json_({ ok: false, error: "auth" });
      return action === "sync_get" ? syncGet_(user, slug) : syncPut_(user, slug, d.data);
    }

    /* ---- everything else is for an admin alone ---- */
    if (!isAdmin_(user)) {
      audit_(user, "security.denied", action, "admin action refused", false, d.ua);
      return json_({ ok: false, error: "forbidden" });
    }
    if (action === "admin_list") return adminList_(slug);
    if (action === "admin_set") return adminSet_(user, slug, String(d.key || ""), !!d.approved, d.ua);
    if (action === "admin_delete") return adminDelete_(user, slug, String(d.key || ""), d.ua);

    if (action === "admin_stats") {
      if (allow_("av_" + user.sub, 1, 900)) audit_(user, "admin.view", "analytics", clean_((d.all ? "all time" : d.from + " → " + d.to), 60), true, d.ua);
      return adminStats_(d, user);
    }
    if (action === "admin_users") {
      if (allow_("au_" + user.sub, 1, 900)) audit_(user, "admin.view", "readers", "", true, d.ua);
      return adminUsers_(d);
    }
    if (action === "audit_list") return auditList_(d);
    if (action === "coupon_list") return couponList_();
    if (action === "coupon_save") return couponSave_(d, user);
    if (action === "coupon_toggle") return couponToggle_(d, user);
    if (action === "coupon_redemptions") return redemptionList_(d);
    if (action === "team_list") return teamList_();
    if (action === "team_add") return teamSet_(d, user, true);
    if (action === "team_remove") return teamSet_(d, user, false);
    return json_({ ok: false, error: "unknown" });
  } catch (err) {
    console.error("doPost: " + err);
    return json_({ ok: false, error: "server" });
  } finally {
    if (lock) lock.releaseLock();
    LOCKED_ = false;
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
  var comment = safeCell_(String(d.comment || "").trim().slice(0, 600));
  name = safeCell_(name);

  var sh = sheet_();
  var data = sh.getDataRange().getValues();
  var row = [new Date(), slug, key, rating, name, comment, "", email, picture];

  // one voice per account (or device) per book: a returning reader changes their own
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][1]) === slug && String(data[i][2]) === key) {
      var same = plain_(data[i][5]) === plain_(comment);
      row[6] = same ? data[i][6] : ""; // new words need approving again
      // the admin's own words need no one's leave
      if (isAdmin_(user)) row[6] = "Y";
      sh.getRange(i + 1, 1, 1, HEADERS.length).setValues([row]);
      audit_(user, "review.update", slug, "rating " + rating + (comment ? ", with comment" : ""), true, d.ua);
      return json_({ ok: true, pending: !!comment && REQUIRE_APPROVAL && row[6] !== "Y" });
    }
  }
  if (isAdmin_(user)) row[6] = "Y";
  sh.appendRow(row);
  audit_(user, "review.create", slug, "rating " + rating + (comment ? ", with comment" : ""), true, d.ua);
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
      name: plain_(r[4]),
      email: String(r[7] || ""),
      picture: String(r[8] || ""),
      comment: plain_(r[5]),
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

function adminSet_(user, slug, key, approved, device) {
  var sh = sheet_();
  var at = findRow_(sh, slug, key);
  if (!at) return json_({ ok: false, error: "missing" });
  sh.getRange(at, 7).setValue(approved ? "Y" : "");
  audit_(user, approved ? "review.approve" : "review.hide", slug, key, true, device);
  return json_({ ok: true });
}

function adminDelete_(user, slug, key, device) {
  var sh = sheet_();
  var at = findRow_(sh, slug, key);
  if (!at) return json_({ ok: false, error: "missing" });
  sh.deleteRow(at);
  audit_(user, "review.delete", slug, key, true, device);
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
  rng.setValues([safeRow_(row)]);
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
  if (String(d.source || "").indexOf("signin") === 0) touchUser_(user, String(d.source) === "signin");
  audit_(
    user,
    "auth.consent",
    "edition " + String(d.legal || ""),
    "source " + String(d.source || "") + ", cookies " + String(d.cookies || "") + (user.lapsed ? ", token had lapsed" : ""),
    true,
    d.ua
  );
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
      audit_(user, "book.key", slug, "edition " + version, true, d.ua);
      return json_({ ok: true, key: String(rows[i][2]).trim() });
    }
  }
  return json_({ ok: false, error: "nokey" });
}

/* ==========================================================================
 * ANALYTICS, READERS, COUPONS AND THE AUDIT LOG
 *
 * Tabs this part keeps (created on first use):
 *   Events        one row per page view / time-on-page / chapter opened
 *   Users         one row per signed-in account: first and last seen, sign-ins
 *   Coupons       the discount codes the admin has made
 *   Redemptions   each time a code was used (the ledger)
 *   Audit         who did what, when — append-only, shown to admins
 *
 * Everything the browser sends is checked here again. A browser can say what it
 * likes; only a verified Google token or this script's own session decides who
 * it is, and only an admin account can read the figures or the audit log.
 * ========================================================================== */

var EVENTS_SHEET = "Events";
var USERS_SHEET = "Users";
var COUPONS_SHEET = "Coupons";
var REDEEM_SHEET = "Redemptions";
var AUDIT_SHEET = "Audit";

var EVENT_HEADERS = ["time", "visitor", "session", "email", "path", "kind", "seconds", "referrer", "device"];
var USER_HEADERS = ["id", "email", "name", "picture", "first_seen", "last_seen", "signins", "role", "status"];
var COUPON_HEADERS = [
  "code", "type", "value", "max_uses", "per_user", "valid_from", "valid_to",
  "audience", "book", "active", "created_by", "created_at", "note",
];
var REDEEM_HEADERS = ["time", "code", "email", "book", "list_price", "discount", "final", "reference"];
var AUDIT_HEADERS = ["time", "actor", "role", "action", "target", "detail", "device", "result"];

// What a book sells for, as this script trusts it (the browser's copy is only
// for display). Keep the same as BOOK.price in src/data/books.js.
var PRICES = { "do-kulhad-chai": { mrp: 399, selling: 115 } };

var DAY_MS = 86400000;
var LOCKED_ = false; // true while doPost holds the script lock

/* ------------------------------------------------------------ small tools */
function tidy_(s, max) {
  return String(s == null ? "" : s).replace(/[^A-Za-z0-9._:\-]/g, "").slice(0, max || 40);
}

/**
 * A cell must never be a formula. A Google display name, a comment or a note
 * that begins with = + - or @ would be evaluated when the owner opens the
 * Sheet (=IMPORTXML(...) can send its contents away). A leading apostrophe
 * makes Sheets keep it as plain text.
 */
function safeCell_(v) {
  if (typeof v !== "string") return v;
  return /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
}

function safeRow_(row) {
  return row.map(safeCell_);
}

/** The reverse, for reading back: the guard apostrophe is not part of the text. */
function plain_(v) {
  return String(v == null ? "" : v).replace(/^'(?=[=+\-@\t\r])/, "");
}

function whole_(v, lo, hi, dflt) {
  var n = Math.round(Number(v));
  if (!isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}

function ensureTab_(name, headers, textCols) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (sh) return sh;
  sh = ss.insertSheet(name);
  sh.appendRow(headers);
  sh.setFrozenRows(1);
  // ids and codes stay exactly as written (Sheets would round or reformat them)
  (textCols || []).forEach(function (c) {
    sh.getRange(1, c, sh.getMaxRows(), 1).setNumberFormat("@");
  });
  return sh;
}

/** Rows at the bottom of a tab, in one write. */
function appendRows_(sh, rows) {
  if (!rows.length) return;
  var last = sh.getLastRow();
  var need = last + rows.length;
  if (need > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows() + 200);
  sh.getRange(last + 1, 1, rows.length, rows[0].length).setValues(rows.map(safeRow_));
}

function withLock_(fn) {
  if (LOCKED_) return fn();
  var lock = LockService.getScriptLock();
  lock.waitLock(8000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/** A cheap per-key limit: true while under `max` calls in `seconds`. */
function allow_(key, max, seconds) {
  try {
    var cache = CacheService.getScriptCache();
    var n = Number(cache.get(key) || 0) + 1;
    cache.put(key, String(n), seconds);
    return n <= max;
  } catch (err) {
    return true;
  }
}

function clean_(s, max) {
  return String(s == null ? "" : s).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
}

function dateOf_(v) {
  if (v instanceof Date) return v.getTime();
  var t = Date.parse(String(v || ""));
  return isFinite(t) ? t : 0;
}

/* ------------------------------------------------------------- admins */
function adminEmails_() {
  var list = [String(ADMIN_EMAIL).toLowerCase()];
  try {
    var extra = JSON.parse(PropertiesService.getScriptProperties().getProperty("ADMINS") || "[]");
    extra.forEach(function (m) {
      m = String(m || "").toLowerCase();
      if (m && list.indexOf(m) < 0) list.push(m);
    });
  } catch (err) {
    /* the owner alone */
  }
  return list;
}

function isOwner_(user) {
  return !!user && String(user.email).toLowerCase() === String(ADMIN_EMAIL).toLowerCase();
}

/* --------------------------------------------------------------- audit */
/**
 * One line in the Audit tab. Append-only: nothing in this script edits or
 * removes a row. A failure to write it never stops the action itself, but is
 * not silent either: it lands in the script's execution log.
 */
function audit_(actor, action, target, detail, ok, device) {
  try {
    withLock_(function () {
      var sh = ensureTab_(AUDIT_SHEET, AUDIT_HEADERS, []);
      appendRows_(sh, [[
        new Date(),
        actor ? actor.email : "(not signed in)",
        actor ? (isAdmin_(actor) ? "admin" : "reader") : "visitor",
        clean_(action, 40),
        clean_(target, 120),
        clean_(detail, 300),
        clean_(device, 160),
        ok === false ? "denied" : "ok",
      ]]);
    });
  } catch (err) {
    console.error("audit write failed: " + err);
  }
}

function auditList_(d) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(AUDIT_SHEET);
  var out = { ok: true, rows: [], total: 0, actions: [] };
  if (!sh || sh.getLastRow() < 2) return json_(out);
  var data = sh.getRange(2, 1, sh.getLastRow() - 1, AUDIT_HEADERS.length).getValues();
  var from = dateOf_(d.from);
  var to = dateOf_(d.to);
  var who = clean_(d.actor, 120).toLowerCase();
  var act = clean_(d.kind, 40); // d.action is the route itself ("audit_list")
  var q = clean_(d.q, 80).toLowerCase();
  var limit = whole_(d.limit, 1, 500, 200);
  var kinds = {};
  var rows = [];
  for (var i = data.length - 1; i >= 0; i--) {
    var r = data[i];
    var t = dateOf_(r[0]);
    kinds[String(r[3])] = 1;
    if (from && t < from) continue;
    if (to && t >= to) continue;
    if (who && String(r[1]).toLowerCase().indexOf(who) < 0) continue;
    if (act && String(r[3]) !== act) continue;
    if (q && (String(r[4]) + " " + String(r[5])).toLowerCase().indexOf(q) < 0) continue;
    out.total++;
    if (rows.length < limit) {
      rows.push({
        at: new Date(t).toISOString(),
        actor: String(r[1]),
        role: String(r[2]),
        action: String(r[3]),
        target: String(r[4]),
        detail: String(r[5]),
        device: String(r[6]),
        result: String(r[7]),
      });
    }
  }
  out.rows = rows;
  out.actions = Object.keys(kinds).sort();
  return json_(out);
}

/* --------------------------------------------------------------- users */
function userRowOf_(sh, user) {
  if (sh.getLastRow() < 2) return 0;
  var id = "g:" + user.sub;
  var f = sh.getRange(1, 1, sh.getLastRow(), 1).createTextFinder(id).matchEntireCell(true).findNext();
  if (f) return f.getRow();
  var g = sh.getRange(1, 2, sh.getLastRow(), 1).createTextFinder(user.email).matchEntireCell(true).findNext();
  return g ? g.getRow() : 0;
}

/** Note that this account was seen (and, with signedIn, that it just signed in). */
function touchUser_(user, signedIn) {
  if (!user || !user.sub) return;
  try {
    withLock_(function () {
      var sh = ensureTab_(USERS_SHEET, USER_HEADERS, [1]);
      var at = userRowOf_(sh, user);
      var now = new Date();
      var role = isAdmin_(user) ? "admin" : "reader";
      if (!at) {
        appendRows_(sh, [["g:" + user.sub, user.email, user.name, user.picture, now, now, signedIn ? 1 : 0, role, "active"]]);
        return;
      }
      var v = sh.getRange(at, 1, 1, USER_HEADERS.length).getValues()[0];
      v[0] = "g:" + user.sub;
      v[1] = user.email;
      if (v[8] !== "erased") {
        v[2] = user.name || v[2];
        v[3] = user.picture || v[3];
      } else if (signedIn) {
        v[2] = user.name;
        v[3] = user.picture;
        v[8] = "active";
      }
      v[5] = now;
      if (signedIn) v[6] = Number(v[6] || 0) + 1;
      v[7] = role;
      sh.getRange(at, 1, 1, USER_HEADERS.length).setValues([safeRow_(v)]);
    });
  } catch (err) {
    console.error("touchUser failed: " + err);
  }
}

/* ------------------------------------------------------------- tracking */
/**
 * The browser sends its page views and the seconds spent on a page in small
 * batches. Nothing here is trusted: the kinds are a short list, a path must
 * look like one, seconds are capped, a time must be recent.
 */
function track_(d, user) {
  var vid = tidy_(d.vid, 32);
  var sid = tidy_(d.sid, 32);
  var list = d.events && d.events.length ? d.events.slice(0, 60) : [];
  if (!list.length) return json_({ ok: true, n: 0 });
  // one browser cannot flood the Sheet, nor can all of them together
  if (!allow_("trk_" + (vid || "anon"), 80, 600)) return json_({ ok: true, n: 0, limited: true });
  if (!allow_("trk_all", 1500, 600)) return json_({ ok: true, n: 0, limited: true });

  var now = Date.now();
  var email = user ? user.email : "";
  var kinds = { v: 1, t: 1, c: 1, s: 1 };
  var rows = [];
  list.forEach(function (e) {
    if (!e || !kinds[e.k]) return;
    var p = clean_(e.p, 120).split("?")[0].split("#")[0];
    if (p.charAt(0) !== "/") return;
    var at = Number(e.a);
    if (!(at > now - 2 * DAY_MS && at <= now + 5 * 60000)) at = now;
    var secs = e.k === "t" ? whole_(e.s, 0, 1800, 0) : 0;
    if (e.k === "t" && !secs) return;
    var dev = /^[mtd]$/.test(String(e.d)) ? String(e.d) : "d";
    rows.push([new Date(at), vid ? "v:" + vid : "", sid ? "s:" + sid : "", email, p, e.k, secs, tidy_(e.r, 60), dev]);
  });
  if (!rows.length) return json_({ ok: true, n: 0 });

  withLock_(function () {
    appendRows_(ensureTab_(EVENTS_SHEET, EVENT_HEADERS, [2, 3]), rows);
  });
  // the directory entry for a signed-in reader is kept fresh, but not on every batch
  if (user && allow_("seen_" + user.sub, 1, 600)) touchUser_(user, false);
  return json_({ ok: true, n: rows.length });
}

/* ----------------------------------------------------------- statistics */
function accNew_() {
  return { views: 0, anon: 0, secs: 0, chapters: 0, signins: 0, vids: {}, emails: {}, sids: {} };
}

function accAdd_(a, e) {
  if (e.kind === "v") {
    a.views++;
    if (!e.vid) a.anon++;
  } else if (e.kind === "t") {
    a.secs += e.secs;
  } else if (e.kind === "c") {
    a.chapters++;
  } else if (e.kind === "s") {
    a.signins++;
  }
  if (e.vid) a.vids[e.vid] = 1;
  if (e.email) a.emails[e.email] = 1;
  if (e.sid) a.sids[e.sid] = 1;
}

function accOut_(a) {
  return {
    views: a.views,
    anonViews: a.anon,
    visitors: Object.keys(a.vids).length,
    readers: Object.keys(a.emails).length,
    sessions: Object.keys(a.sids).length,
    seconds: a.secs,
    chapters: a.chapters,
    signins: a.signins,
  };
}

function localDay_(ms, tz) {
  return new Date(ms + tz * 60000).toISOString().slice(0, 10);
}

function bucketOf_(ms, tz, bucket) {
  var day = localDay_(ms, tz);
  if (bucket === "month") return day.slice(0, 7);
  if (bucket === "week") {
    var t = new Date(ms + tz * 60000);
    var back = (t.getUTCDay() + 6) % 7; // Monday first
    return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() - back)).toISOString().slice(0, 10);
  }
  return day;
}

function localMidnightOf_(s, tz) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - tz * 60000;
}

function adminStats_(d, user) {
  var tz = whole_(d.tzMin, -840, 840, 0);
  var includeAdmins = !!d.includeAdmins;
  var now = Date.now();
  var todayStart = Math.floor((now + tz * 60000) / DAY_MS) * DAY_MS - tz * 60000;

  var from;
  var to;
  var all = !!d.all;
  if (all) {
    from = 0;
    to = todayStart + DAY_MS;
  } else {
    from = localMidnightOf_(d.from, tz);
    var last = localMidnightOf_(d.to, tz);
    if (from === null || last === null) return json_({ ok: false, error: "invalid" });
    to = last + DAY_MS;
    if (to <= from) return json_({ ok: false, error: "invalid" });
    if (to - from > 800 * DAY_MS) return json_({ ok: false, error: "toolarge" });
  }

  var key = "st_" + [from, to, tz, includeAdmins ? 1 : 0, all ? 1 : 0].join("_");
  var cache = CacheService.getScriptCache();
  var hit = cache.get(key);
  if (hit && !d.fresh) return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);

  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EVENTS_SHEET);
  var rows = sh && sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, EVENT_HEADERS.length).getValues() : [];

  var admins = {};
  if (!includeAdmins) adminEmails_().forEach(function (m) { admins[m] = 1; });

  var span = to - from;
  var prevFrom = from - span;
  var windows = {
    main: accNew_(),
    prev: accNew_(),
    today: accNew_(),
    yesterday: accNew_(),
    week: accNew_(),
    month: accNew_(),
    all: accNew_(),
  };
  var firstSeen = {};
  var firstEvent = 0;
  var bounds = {
    today: [todayStart, todayStart + DAY_MS],
    yesterday: [todayStart - DAY_MS, todayStart],
    week: [todayStart - 6 * DAY_MS, todayStart + DAY_MS],
    month: [todayStart - 29 * DAY_MS, todayStart + DAY_MS],
  };

  // pass 1: when each visitor was first seen, and the earliest event
  var parsed = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var ms = dateOf_(r[0]);
    if (!ms) continue;
    var email = String(r[3] || "").toLowerCase();
    if (email && admins[email]) continue;
    var vid = String(r[1] || "").replace(/^v:/, "");
    if (vid && (firstSeen[vid] === undefined || ms < firstSeen[vid])) firstSeen[vid] = ms;
    if (!firstEvent || ms < firstEvent) firstEvent = ms;
    parsed.push({
      ms: ms,
      vid: vid,
      sid: String(r[2] || "").replace(/^s:/, ""),
      email: email,
      path: String(r[4] || ""),
      kind: String(r[5] || ""),
      secs: Number(r[6]) || 0,
      ref: String(r[7] || ""),
      dev: String(r[8] || "d"),
    });
  }

  if (all) from = firstEvent ? Math.floor((firstEvent + tz * 60000) / DAY_MS) * DAY_MS - tz * 60000 : todayStart;
  span = to - from;
  var spanDays = Math.max(1, Math.round(span / DAY_MS));
  var bucket = spanDays <= 92 ? "day" : spanDays <= 540 ? "week" : "month";

  var series = {};
  var hourly = [];
  for (var h = 0; h < 24; h++) hourly.push(0);
  var pages = {};
  var reads = {};
  var refs = {};
  var devices = { m: 0, t: 0, d: 0 };
  var people = {};
  var split = { signedIn: 0, visitors: 0, reading: 0, other: 0 };

  parsed.forEach(function (e) {
    accAdd_(windows.all, e);
    if (e.ms >= from && e.ms < to) {
      accAdd_(windows.main, e);
      var b = bucketOf_(e.ms, tz, bucket);
      var s = series[b] || (series[b] = accNew_());
      accAdd_(s, e);

      if (e.kind === "v") {
        hourly[new Date(e.ms + tz * 60000).getUTCHours()]++;
        var pg = pages[e.path] || (pages[e.path] = { p: e.path, views: 0, secs: 0, vids: {} });
        pg.views++;
        if (e.vid) pg.vids[e.vid] = 1;
        if (e.ref) refs[e.ref] = (refs[e.ref] || 0) + 1;
        if (devices[e.dev] !== undefined) devices[e.dev]++;
      }
      if (e.kind === "t") {
        var pt = pages[e.path] || (pages[e.path] = { p: e.path, views: 0, secs: 0, vids: {} });
        pt.secs += e.secs;
        if (e.email) split.signedIn += e.secs;
        else split.visitors += e.secs;
        if (e.path.indexOf("/read/") === 0) split.reading += e.secs;
        else split.other += e.secs;
      }
      if (e.kind === "c") {
        var rd = reads[e.path] || (reads[e.path] = { p: e.path, opens: 0, secs: 0 });
        rd.opens++;
      }
      if (e.email) {
        var pe = people[e.email] || (people[e.email] = { email: e.email, secs: 0, views: 0, last: 0 });
        if (e.kind === "t") pe.secs += e.secs;
        if (e.kind === "v") pe.views++;
        if (e.ms > pe.last) pe.last = e.ms;
      }
    }
    if (!all && e.ms >= prevFrom && e.ms < from) accAdd_(windows.prev, e);
    ["today", "yesterday", "week", "month"].forEach(function (k) {
      if (e.ms >= bounds[k][0] && e.ms < bounds[k][1]) accAdd_(windows[k], e);
    });
  });

  // chapter time: seconds spent on each /read/... page
  parsed.forEach(function (e) {
    if (e.kind === "t" && e.ms >= from && e.ms < to && reads[e.path]) reads[e.path].secs += e.secs;
  });

  var main = accOut_(windows.main);
  var newVisitors = 0;
  Object.keys(windows.main.vids).forEach(function (v) {
    if (firstSeen[v] >= from && firstSeen[v] < to) newVisitors++;
  });
  main.newVisitors = newVisitors;
  main.returning = main.visitors - newVisitors;
  main.avgSession = main.sessions ? Math.round(main.seconds / main.sessions) : 0;
  main.avgVisitor = main.visitors ? Math.round(main.seconds / main.visitors) : 0;

  // the series, with empty days kept so a chart has no holes
  var list = [];
  if (bucket === "day") {
    for (var t = from; t < to; t += DAY_MS) {
      var k = localDay_(t, tz);
      var a = series[k] || accNew_();
      var o = accOut_(a);
      list.push({ d: k, views: o.views, visitors: o.visitors, readers: o.readers, seconds: o.seconds, chapters: o.chapters });
    }
  } else {
    Object.keys(series).sort().forEach(function (k2) {
      var o2 = accOut_(series[k2]);
      list.push({ d: k2, views: o2.views, visitors: o2.visitors, readers: o2.readers, seconds: o2.seconds, chapters: o2.chapters });
    });
  }

  var topPages = Object.keys(pages)
    .map(function (p) {
      var x = pages[p];
      return { p: x.p, views: x.views, visitors: Object.keys(x.vids).length, seconds: x.secs };
    })
    .sort(function (a1, b1) { return b1.views - a1.views || b1.seconds - a1.seconds; })
    .slice(0, 20);

  var topReads = Object.keys(reads)
    .map(function (p) { return reads[p]; })
    .sort(function (a2, b2) { return b2.opens - a2.opens; })
    .slice(0, 15);

  var topRefs = Object.keys(refs)
    .map(function (r2) { return { r: r2, n: refs[r2] }; })
    .sort(function (a3, b3) { return b3.n - a3.n; })
    .slice(0, 12);

  // names for the most engaged readers
  var names = {};
  var ush = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(USERS_SHEET);
  var registered = 0;
  var newlyRegistered = 0;
  if (ush && ush.getLastRow() > 1) {
    ush.getRange(2, 1, ush.getLastRow() - 1, USER_HEADERS.length).getValues().forEach(function (u) {
      if (String(u[8]) === "erased") return;
      registered++;
      names[String(u[1]).toLowerCase()] = plain_(u[2]);
      var fs = dateOf_(u[4]);
      if (fs >= from && fs < to) newlyRegistered++;
    });
  }
  var topPeople = Object.keys(people)
    .map(function (m) {
      var p = people[m];
      return { email: m, name: names[m] || "", seconds: p.secs, views: p.views, last: new Date(p.last).toISOString() };
    })
    .sort(function (a4, b4) { return b4.seconds - a4.seconds; })
    .slice(0, 10);

  var snap = {};
  ["today", "yesterday", "week", "month", "all"].forEach(function (k3) {
    snap[k3] = accOut_(windows[k3]);
  });

  var out = {
    ok: true,
    range: { from: localDay_(from, tz), to: localDay_(to - DAY_MS, tz), days: spanDays, bucket: bucket, all: all },
    totals: main,
    prev: all ? null : accOut_(windows.prev),
    snapshot: snap,
    series: list,
    hourly: hourly,
    pages: topPages,
    reads: topReads,
    referrers: topRefs,
    devices: devices,
    split: split,
    people: topPeople,
    users: { registered: registered, newInRange: newlyRegistered },
    scanned: rows.length,
    includeAdmins: includeAdmins,
    at: new Date(now).toISOString(),
  };
  var text = JSON.stringify(out);
  try {
    if (text.length < 90000) cache.put(key, text, 60);
  } catch (err) {
    /* too large to keep: it is simply computed again */
  }
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}

/** Registered readers, newest activity first, with what they have spent. */
function adminUsers_(d) {
  var ush = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(USERS_SHEET);
  var out = { ok: true, rows: [], total: 0 };
  if (!ush || ush.getLastRow() < 2) return json_(out);
  var users = ush.getRange(2, 1, ush.getLastRow() - 1, USER_HEADERS.length).getValues();

  var spent = {};
  var esh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EVENTS_SHEET);
  if (esh && esh.getLastRow() > 1) {
    esh.getRange(2, 4, esh.getLastRow() - 1, 4).getValues().forEach(function (r) {
      // columns D..G: email, path, kind, seconds
      var m = String(r[0] || "").toLowerCase();
      if (!m) return;
      var s = spent[m] || (spent[m] = { secs: 0, views: 0 });
      if (r[2] === "t") s.secs += Number(r[3]) || 0;
      if (r[2] === "v") s.views++;
    });
  }
  var q = clean_(d.q, 60).toLowerCase();
  var rows = [];
  users.forEach(function (u) {
    var email = String(u[1]).toLowerCase();
    if (q && email.indexOf(q) < 0 && String(u[2]).toLowerCase().indexOf(q) < 0) return;
    var sp = spent[email] || { secs: 0, views: 0 };
    rows.push({
      email: email,
      name: plain_(u[2]),
      picture: String(u[3] || ""),
      firstSeen: new Date(dateOf_(u[4])).toISOString(),
      lastSeen: new Date(dateOf_(u[5])).toISOString(),
      signins: Number(u[6]) || 0,
      role: String(u[7] || "reader"),
      status: String(u[8] || "active"),
      seconds: sp.secs,
      views: sp.views,
    });
  });
  rows.sort(function (a, b) { return a.lastSeen < b.lastSeen ? 1 : -1; });
  out.total = rows.length;
  out.rows = rows.slice(0, whole_(d.limit, 1, 500, 300));
  return json_(out);
}

/* -------------------------------------------------------------- coupons */
function readCoupons_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(COUPONS_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  var out = [];
  sh.getRange(2, 1, sh.getLastRow() - 1, COUPON_HEADERS.length).getValues().forEach(function (r, i) {
    var code = String(r[0] || "").trim().toUpperCase();
    if (!code) return;
    out.push({
      row: i + 2,
      code: code,
      type: String(r[1] || "percent"),
      value: Number(r[2]) || 0,
      maxUses: Number(r[3]) || 0,
      perUser: Number(r[4]) || 0,
      from: dateOf_(r[5]),
      to: dateOf_(r[6]),
      audience: plain_(r[7]),
      book: String(r[8] || ""),
      active: String(r[9]).toUpperCase() !== "N",
      createdBy: String(r[10] || ""),
      createdAt: dateOf_(r[11]),
      note: plain_(r[12]),
    });
  });
  return out;
}

/** code -> { total, last, byEmail } from the ledger. */
function redemptionCounts_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REDEEM_SHEET);
  var out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, REDEEM_HEADERS.length).getValues().forEach(function (r) {
    var code = String(r[1] || "").toUpperCase();
    if (!code) return;
    var c = out[code] || (out[code] = { total: 0, last: 0, byEmail: {} });
    c.total++;
    var m = String(r[2] || "").toLowerCase();
    c.byEmail[m] = (c.byEmail[m] || 0) + 1;
    var t = dateOf_(r[0]);
    if (t > c.last) c.last = t;
  });
  return out;
}

function audienceAllows_(audience, email) {
  var tokens = String(audience || "")
    .toLowerCase()
    .split(/[\s,;]+/)
    .filter(function (t) { return t; });
  if (!tokens.length) return true;
  if (!email) return false;
  return tokens.some(function (t) {
    if (t.charAt(0) === "@") return email.length > t.length && email.slice(-t.length) === t;
    return t === email;
  });
}

function couponStatus_(c, counts, now) {
  if (!c.active) return "paused";
  if (c.from && now < c.from) return "scheduled";
  if (c.to && now > c.to) return "expired";
  if (c.maxUses && counts && counts.total >= c.maxUses) return "exhausted";
  return "live";
}

function priceAfter_(c, selling) {
  var f = selling;
  if (c.type === "percent") f = Math.round(selling * (1 - Math.min(100, Math.max(0, c.value)) / 100));
  else if (c.type === "flat") f = selling - c.value;
  else if (c.type === "fixed") f = Math.min(selling, c.value);
  f = Math.max(0, Math.round(f));
  return { final: f, discount: selling - f };
}

/** Is this code good for this account and book, now? Never changes anything. */
function couponCheck_(code, user, slug, counts) {
  code = String(code || "").trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,24}$/.test(code)) return { valid: false, reason: "unknown" };
  var price = PRICES[slug];
  if (!price) return { valid: false, reason: "unknown" };
  var c = null;
  readCoupons_().forEach(function (x) {
    if (x.code === code) c = x;
  });
  if (!c) return { valid: false, reason: "unknown" };
  if (c.book && c.book !== slug) return { valid: false, reason: "wrong_book" };
  var now = Date.now();
  var cnt = (counts || redemptionCounts_())[code] || { total: 0, byEmail: {} };
  var st = couponStatus_(c, cnt, now);
  if (st === "paused") return { valid: false, reason: "inactive" };
  if (st === "scheduled") return { valid: false, reason: "not_started", from: new Date(c.from).toISOString() };
  if (st === "expired") return { valid: false, reason: "expired" };
  if (st === "exhausted") return { valid: false, reason: "exhausted" };
  var email = user ? String(user.email).toLowerCase() : "";
  if (!user) return { valid: false, reason: "signin" };
  if (!audienceAllows_(c.audience, email)) return { valid: false, reason: "not_eligible" };
  if (c.perUser && (cnt.byEmail[email] || 0) >= c.perUser) return { valid: false, reason: "used_by_you" };
  var p = priceAfter_(c, price.selling);
  return {
    valid: true,
    code: code,
    type: c.type,
    value: c.value,
    list: price.selling,
    mrp: price.mrp,
    discount: p.discount,
    final: p.final,
    until: c.to ? new Date(c.to).toISOString() : "",
    coupon: c,
  };
}

function couponPublic_(r) {
  var o = {};
  Object.keys(r).forEach(function (k) {
    if (k !== "coupon") o[k] = r[k];
  });
  return o;
}

function couponRedeem_(d, user) {
  var slug = clean_(d.slug, 80);
  var r = couponCheck_(d.code, user, slug, null);
  if (!r.valid) {
    audit_(user, "coupon.refused", String(d.code || "").toUpperCase(), r.reason, false, d.ua);
    return json_({ ok: true, valid: false, reason: r.reason });
  }
  var ref = "KC-" + Date.now().toString(36).toUpperCase() + "-" + Math.floor(Math.random() * 46656).toString(36).toUpperCase();
  appendRows_(ensureTab_(REDEEM_SHEET, REDEEM_HEADERS, [2, 8]), [[
    new Date(), r.code, user.email, slug, r.list, r.discount, r.final, ref,
  ]]);
  audit_(user, "coupon.redeem", r.code, "book " + slug + ", ₹" + r.list + " → ₹" + r.final + ", ref " + ref, true, d.ua);
  var out = couponPublic_(r);
  out.ok = true;
  out.reference = ref;
  return json_(out);
}

function couponList_() {
  var counts = redemptionCounts_();
  var now = Date.now();
  var rows = readCoupons_().map(function (c) {
    var cnt = counts[c.code] || { total: 0, last: 0, byEmail: {} };
    var price = PRICES[c.book || Object.keys(PRICES)[0]] || { selling: 0 };
    return {
      code: c.code,
      type: c.type,
      value: c.value,
      maxUses: c.maxUses,
      perUser: c.perUser,
      from: c.from ? new Date(c.from).toISOString() : "",
      to: c.to ? new Date(c.to).toISOString() : "",
      audience: c.audience,
      book: c.book,
      active: c.active,
      createdBy: c.createdBy,
      createdAt: c.createdAt ? new Date(c.createdAt).toISOString() : "",
      note: c.note,
      used: cnt.total,
      lastUsed: cnt.last ? new Date(cnt.last).toISOString() : "",
      status: couponStatus_(c, cnt, now),
      sample: priceAfter_(c, price.selling).final,
    };
  });
  rows.sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
  return json_({ ok: true, rows: rows, prices: PRICES });
}

function couponSave_(d, user) {
  var code = String(d.code || "").trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,24}$/.test(code) || !/[A-Z]/.test(code)) return json_({ ok: false, error: "invalid", why: "code" });
  var type = String(d.type || "");
  if (["percent", "flat", "fixed"].indexOf(type) < 0) return json_({ ok: false, error: "invalid", why: "type" });
  var value = Number(d.value);
  if (!isFinite(value) || value < 0) return json_({ ok: false, error: "invalid", why: "value" });
  if (type === "percent" && (value < 1 || value > 100)) return json_({ ok: false, error: "invalid", why: "value" });
  value = Math.round(value);
  var maxUses = whole_(d.maxUses, 0, 1000000, 0);
  var perUser = whole_(d.perUser, 0, 1000, 1);
  var from = d.from ? Date.parse(String(d.from)) : 0;
  var to = d.to ? Date.parse(String(d.to)) : 0;
  if ((d.from && !isFinite(from)) || (d.to && !isFinite(to))) return json_({ ok: false, error: "invalid", why: "dates" });
  if (from && to && to <= from) return json_({ ok: false, error: "invalid", why: "dates" });
  var book = clean_(d.book, 80);
  if (book && !PRICES[book]) return json_({ ok: false, error: "invalid", why: "book" });
  var audience = clean_(d.audience, 600);
  var note = clean_(d.note, 140);
  var active = d.active === false ? "N" : "Y";

  var sh = ensureTab_(COUPONS_SHEET, COUPON_HEADERS, [1]);
  var existing = null;
  readCoupons_().forEach(function (c) {
    if (c.code === code) existing = c;
  });
  var createdBy = existing ? existing.createdBy : user.email;
  var createdAt = existing && existing.createdAt ? new Date(existing.createdAt) : new Date();
  var row = [
    code, type, value, maxUses, perUser,
    from ? new Date(from) : "", to ? new Date(to) : "",
    audience, book, active, createdBy, createdAt, note,
  ];
  if (existing) {
    sh.getRange(existing.row, 1, 1, row.length).setValues([safeRow_(row)]);
    audit_(user, "coupon.update", code, type + " " + value + (audience ? ", for " + audience : "") + (active === "N" ? ", paused" : ""), true, d.ua);
  } else {
    appendRows_(sh, [row]);
    audit_(user, "coupon.create", code, type + " " + value + ", max " + (maxUses || "∞") + ", per user " + (perUser || "∞") + (audience ? ", for " + audience : ""), true, d.ua);
  }
  return json_({ ok: true, code: code, created: !existing });
}

function couponToggle_(d, user) {
  var code = String(d.code || "").trim().toUpperCase();
  var c = null;
  readCoupons_().forEach(function (x) {
    if (x.code === code) c = x;
  });
  if (!c) return json_({ ok: false, error: "missing" });
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(COUPONS_SHEET);
  sh.getRange(c.row, 10).setValue(d.active ? "Y" : "N");
  audit_(user, d.active ? "coupon.resume" : "coupon.pause", code, "", true, d.ua);
  return json_({ ok: true });
}

function redemptionList_(d) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REDEEM_SHEET);
  var out = { ok: true, rows: [] };
  if (!sh || sh.getLastRow() < 2) return json_(out);
  var code = String(d.code || "").trim().toUpperCase();
  sh.getRange(2, 1, sh.getLastRow() - 1, REDEEM_HEADERS.length).getValues().forEach(function (r) {
    if (code && String(r[1]).toUpperCase() !== code) return;
    out.rows.push({
      at: new Date(dateOf_(r[0])).toISOString(),
      code: String(r[1]),
      email: String(r[2]),
      book: String(r[3]),
      list: Number(r[4]) || 0,
      discount: Number(r[5]) || 0,
      final: Number(r[6]) || 0,
      reference: String(r[7]),
    });
  });
  out.rows.reverse();
  out.rows = out.rows.slice(0, 300);
  return json_(out);
}

/* ------------------------------------------------- a reader's own data */
function rowsFor_(sheetName, cols, user) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sh || sh.getLastRow() < 2) return [];
  var me = "g:" + user.sub;
  var mail = String(user.email).toLowerCase();
  var out = [];
  sh.getRange(2, 1, sh.getLastRow() - 1, cols).getValues().forEach(function (r) {
    var who = String(r[1]);
    var email = String(r[2] || "").toLowerCase();
    if (who === me || who === user.sub || (mail && email === mail)) out.push(r);
  });
  return out;
}

function meSummary_(user, full) {
  var ush = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(USERS_SHEET);
  var at = ush ? userRowOf_(ush, user) : 0;
  var urow = at ? ush.getRange(at, 1, 1, USER_HEADERS.length).getValues()[0] : null;

  var consent = rowsFor_(CONSENT_SHEET, 13, user);
  var last = consent.length ? consent[consent.length - 1] : null;

  var reviews = [];
  var rsh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (rsh && rsh.getLastRow() > 1) {
    rsh.getRange(2, 1, rsh.getLastRow() - 1, HEADERS.length).getValues().forEach(function (r) {
      if (String(r[2]) === "google:" + user.sub) {
        reviews.push({
          slug: String(r[1]),
          rating: Number(r[3]) || 0,
          name: plain_(r[4]),
          comment: plain_(r[5]),
          approved: String(r[6]).toUpperCase() === "Y",
          at: new Date(dateOf_(r[0])).toISOString(),
        });
      }
    });
  }

  var reds = [];
  var dsh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REDEEM_SHEET);
  if (dsh && dsh.getLastRow() > 1) {
    dsh.getRange(2, 1, dsh.getLastRow() - 1, REDEEM_HEADERS.length).getValues().forEach(function (r) {
      if (String(r[2]).toLowerCase() === String(user.email).toLowerCase()) {
        reds.push({
          at: new Date(dateOf_(r[0])).toISOString(),
          code: String(r[1]),
          book: String(r[3]),
          list: Number(r[4]) || 0,
          discount: Number(r[5]) || 0,
          final: Number(r[6]) || 0,
          reference: String(r[7]),
        });
      }
    });
  }

  var usage = { seconds: 0, views: 0, chapters: 0, sessions: 0, lastSeen: "" };
  var esh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EVENTS_SHEET);
  var raw = [];
  if (esh && esh.getLastRow() > 1) {
    var sess = {};
    var lastMs = 0;
    var mail = String(user.email).toLowerCase();
    esh.getRange(2, 1, esh.getLastRow() - 1, EVENT_HEADERS.length).getValues().forEach(function (r) {
      if (String(r[3]).toLowerCase() !== mail) return;
      var t = dateOf_(r[0]);
      if (t > lastMs) lastMs = t;
      if (r[2]) sess[r[2]] = 1;
      if (r[5] === "t") usage.seconds += Number(r[6]) || 0;
      if (r[5] === "v") usage.views++;
      if (r[5] === "c") usage.chapters++;
      if (full && raw.length < 2000) raw.push([new Date(t).toISOString(), r[4], r[5], Number(r[6]) || 0]);
    });
    usage.sessions = Object.keys(sess).length;
    usage.lastSeen = lastMs ? new Date(lastMs).toISOString() : "";
  }

  var out = {
    ok: true,
    user: { email: user.email, name: user.name, picture: user.picture },
    role: isAdmin_(user) ? "admin" : "reader",
    owner: isOwner_(user),
    member: urow
      ? {
          since: new Date(dateOf_(urow[4])).toISOString(),
          lastSeen: new Date(dateOf_(urow[5])).toISOString(),
          signins: Number(urow[6]) || 0,
        }
      : null,
    consent: last
      ? { version: textOf_(last[4]), at: new Date(dateOf_(last[0])).toISOString(), source: String(last[7] || ""), count: consent.length }
      : null,
    reviews: reviews,
    coupons: reds,
    usage: usage,
    legal: LEGAL_VERSION,
  };
  if (full) {
    out.events = raw;
    out.consentHistory = consent.map(function (r) {
      return { at: new Date(dateOf_(r[0])).toISOString(), version: textOf_(r[4]), cookies: String(r[5]), source: String(r[7]), page: String(r[10]) };
    });
    out.access = rowsFor_(ACCESS_SHEET, 5, user).map(function (r) {
      return { at: new Date(dateOf_(r[0])).toISOString(), book: String(r[3]), version: textOf_(r[4]) };
    });
    var sync = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SYNC_SHEET);
    out.sync = [];
    if (sync && sync.getLastRow() > 1) {
      sync.getRange(2, 1, sync.getLastRow() - 1, 5).getValues().forEach(function (r) {
        if (String(r[0]) === "google:" + user.sub) {
          var data = null;
          try {
            data = JSON.parse(String(r[4] || "null"));
          } catch (err) {
            data = null;
          }
          out.sync.push({ book: String(r[1]), updated: new Date(dateOf_(r[2])).toISOString(), data: data });
        }
      });
    }
  }
  return out;
}

function meCached_(user) {
  var key = "me_" + user.sub;
  var cache = CacheService.getScriptCache();
  var hit = cache.get(key);
  if (hit) return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);
  var text = JSON.stringify(meSummary_(user, false));
  try {
    cache.put(key, text, 120);
  } catch (err) {
    /* recomputed next time */
  }
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}

/**
 * "Delete my data": what the reader put here goes — their synchronised place,
 * their comment and name, their picture, the e-mail beside their activity.
 * The records the Terms say are kept as evidence (acceptance, access, the audit
 * log) stay; the privacy policy says so.
 */
function eraseMe_(user, device) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var counts = { sync: 0, reviews: 0, events: 0 };

  var sync = ss.getSheetByName(SYNC_SHEET);
  if (sync && sync.getLastRow() > 1) {
    var sv = sync.getRange(2, 1, sync.getLastRow() - 1, 5).getValues();
    for (var i = sv.length - 1; i >= 0; i--) {
      if (String(sv[i][0]) === "google:" + user.sub) {
        sync.deleteRow(i + 2);
        counts.sync++;
      }
    }
  }

  var rsh = ss.getSheetByName(SHEET_NAME);
  if (rsh && rsh.getLastRow() > 1) {
    var rv = rsh.getRange(2, 1, rsh.getLastRow() - 1, HEADERS.length).getValues();
    for (var j = 0; j < rv.length; j++) {
      if (String(rv[j][2]) === "google:" + user.sub) {
        // the rating stays in the tally; the person goes
        rsh.getRange(j + 2, 5, 1, 1).setValue("");
        rsh.getRange(j + 2, 6, 1, 1).setValue("");
        rsh.getRange(j + 2, 7, 1, 1).setValue("");
        rsh.getRange(j + 2, 8, 1, 2).setValues([["", ""]]);
        counts.reviews++;
      }
    }
  }

  var esh = ss.getSheetByName(EVENTS_SHEET);
  if (esh && esh.getLastRow() > 1) {
    var ev = esh.getRange(2, 4, esh.getLastRow() - 1, 1).getValues();
    var mail = String(user.email).toLowerCase();
    var dirty = false;
    for (var k = 0; k < ev.length; k++) {
      if (String(ev[k][0]).toLowerCase() === mail) {
        ev[k][0] = "";
        counts.events++;
        dirty = true;
      }
    }
    if (dirty) esh.getRange(2, 4, ev.length, 1).setValues(ev);
  }

  var ush = ss.getSheetByName(USERS_SHEET);
  if (ush) {
    var at = userRowOf_(ush, user);
    if (at) ush.getRange(at, 3, 1, 2).setValues([["", ""]]);
    if (at) ush.getRange(at, 9).setValue("erased");
  }
  try {
    CacheService.getScriptCache().remove("me_" + user.sub);
  } catch (err) {
    /* ignore */
  }
  audit_(user, "data.erase", user.email, "sync " + counts.sync + ", reviews " + counts.reviews + ", events " + counts.events, true, device);
  return counts;
}

/* ------------------------------------------------------------ admin team */
function teamList_() {
  return json_({ ok: true, owner: String(ADMIN_EMAIL).toLowerCase(), admins: adminEmails_() });
}

function teamSet_(d, user, add) {
  if (!isOwner_(user)) {
    audit_(user, "security.denied", "team", "not the owner", false, d.ua);
    return json_({ ok: false, error: "forbidden" });
  }
  var mail = clean_(d.email, 120).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return json_({ ok: false, error: "invalid" });
  if (mail === String(ADMIN_EMAIL).toLowerCase()) return json_({ ok: false, error: "invalid" });
  var props = PropertiesService.getScriptProperties();
  var list = [];
  try {
    list = JSON.parse(props.getProperty("ADMINS") || "[]");
  } catch (err) {
    list = [];
  }
  var at = list.indexOf(mail);
  if (add && at < 0) list.push(mail);
  if (!add && at >= 0) list.splice(at, 1);
  props.setProperty("ADMINS", JSON.stringify(list));
  audit_(user, add ? "team.add" : "team.remove", mail, "", true, d.ua);
  return teamList_();
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
  out.analytics = true;
  try {
    var all = SpreadsheetApp.getActiveSpreadsheet();
    out.tabs = {
      events: !!all.getSheetByName(EVENTS_SHEET),
      users: !!all.getSheetByName(USERS_SHEET),
      coupons: !!all.getSheetByName(COUPONS_SHEET),
      audit: !!all.getSheetByName(AUDIT_SHEET),
    };
  } catch (err) {
    out.tabs = null;
  }
  return out;
}
