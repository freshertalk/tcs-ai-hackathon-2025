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
 *   Buyer      (signed in, and has paid — or been given a copy) is handed the
 *              key to the book. Payment is taken by Razorpay; see "SELLING THE
 *              BOOK" below for the three things to fill in.
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
var LEGAL_VERSION = "2026-10-12.5";

// Bumped whenever this file changes in a way worth being able to see from outside:
// open  <web-app URL>?check=1  in a browser to read it.
var BUILD = "2026-10-12-shop-upi";

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
  shop_quote: 1, shop_orders: 1, shop_receipt: 1, orders_list: 1,
};

function doPost(e) {
  var lock = null;
  try {
    var d = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    var action = String(d.action || (d.event && d.payload ? "webhook" : "review"));

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

    // Razorpay telling us a payment happened: nothing in it is believed, the
    // order is looked up and Razorpay is asked (see shopWebhook_)
    if (action === "webhook") return shopWebhook_(d);

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

    /* ---- buying the book ---- */
    if (action.indexOf("shop_") === 0) {
      if (!user) return json_({ ok: false, error: "auth" });
      if (action === "shop_quote") return shopQuote_(d, user);
      if (action === "shop_orders") return shopOrders_(user);
      if (action === "shop_receipt") return shopReceipt_(d, user);
      if (action === "shop_verify") return shopVerify_(d, user);
      if (action === "shop_resume") return shopResume_(d, user);
      if (action === "shop_resend") return shopResend_(d, user);
      if (action === "shop_claim") return shopClaim_(d, user);
      if (action === "shop_order") {
        // an order is a contract: the current edition of the documents must be on record
        if (String(d.legal || "") !== LEGAL_VERSION || !hasConsent_(user)) return json_({ ok: false, error: "consent" });
        return shopOrder_(d, user);
      }
      return json_({ ok: false, error: "unknown" });
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
    if (action === "orders_list") return ordersList_(d);
    if (action === "order_grant") return orderGrant_(d, user);
    if (action === "order_refund") return orderRefund_(d, user);
    if (action === "order_confirm") return orderConfirm_(d, user);
    if (action === "order_reject") return orderReject_(d, user);
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
  // signed in, accepted the documents — and has paid (or was given a copy)
  if (!entitled_(user, slug)) {
    audit_(user, "book.locked", slug, "no purchase on record", false, d.ua);
    return json_({ ok: false, error: "purchase" });
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
var PRICES = {
  "do-kulhad-chai": { mrp: 399, selling: 115, title: "दो कुल्हड़ चाय", author: "विनय कुमार तिवारी" },
};

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
    purchases: myOrders_(user)
      .map(summaryOf_)
      .sort(function (a, b) { return a.at < b.at ? 1 : -1; }),
    access: {},
  };
  Object.keys(PRICES).forEach(function (k) {
    out.access[k] = entitled_(user, k);
  });
  if (full) {
    out.events = raw;
    out.orders = myOrders_(user).map(function (o) {
      return publicSnap_(o.snap);
    });
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

/* ==========================================================================
 * SELLING THE BOOK  —  cart → checkout → confirm → pay → access
 *
 * Tabs this part keeps (created on first use):
 *   Orders        one row per order: amounts, status, payment, invoice number,
 *                 and the receipt exactly as it was issued (the last column)
 *   Entitlements  who may read which book — written when a payment is verified
 *                 (or a free order completes, or the admin grants a copy)
 *
 * How a purchase goes
 *   1. shop_quote   the price for this account, with a coupon if one is given.
 *                   Every figure comes from PRICES, the coupon table and GST
 *                   above — the browser only ever asks, it never says a price.
 *   2. shop_order   "Confirm": the order and its receipt are written, and a
 *                   Razorpay order is created for exactly that amount.
 *   3. Razorpay Checkout takes the payment (card / UPI / net banking / wallet —
 *      the buyer's card or UPI details never reach this site or this Sheet).
 *   4. shop_verify  the browser hands back Razorpay's signature; it is checked
 *                   here with the key secret, and the payment is read back from
 *                   Razorpay (amount, order, status) before anything is granted.
 *   5. Access is written, an invoice number is issued and the receipt is mailed.
 *   If the browser is closed after paying, shop_resume (on the next visit) and
 *   Razorpay's webhook find the payment by asking Razorpay, and finish it.
 *
 * Keys: Project Settings ▸ Script properties ▸ RAZORPAY_KEY_ID and
 * RAZORPAY_KEY_SECRET. They are read only here, never sent to the browser
 * (the key id is public by design; the secret is not).
 * ========================================================================== */

var SITE_URL = "https://vinaytiwari.org";

// true: the book is released only to an account that owns it (paid, a free
// order, or a copy the admin granted). false: any signed-in, consented account
// may read — useful while testing, or if the book is made free again.
var PAYWALL = true;

// Who is selling, as it appears on every receipt. Fill address, state and (if
// you are registered for GST) the GSTIN.
var SELLER = {
  brand: "दो कुल्हड़ चाय",
  name: "विनय कुमार तिवारी",
  address: "",
  state: "", // as in the GST state list, e.g. "Delhi"
  gstin: "", // 15 characters; leave empty if you are not registered
  email: ADMIN_EMAIL,
};

// Tax on the price. `inclusive: true` means the price shown (₹115) already
// contains the tax, so the buyer pays exactly that; the receipt splits it out.
// If you are NOT registered for GST you may not charge it: set enabled to false
// and receipts say that GST is not applicable. `sac` is the service code of an
// e-book (confirm it with your accountant).
var GST = { enabled: true, rate: 18, inclusive: true, sac: "998431" };

// How payment is taken.
//   "upi"       the reader pays YOUR UPI ID with Google Pay (or any UPI app),
//               then writes down the 12-digit UPI transaction number. You see
//               it in Admin ▸ Sales and press Confirm once the money is in your
//               account — only then is the book opened and the receipt mailed.
//               No gateway, no fee, no account to open.
//   "razorpay"  automatic, through Razorpay (keys in Script properties).
// Put your UPI ID below (or in the script property UPI_ID).
var PAYMENT_PROVIDER = "upi";
var UPI = {
  vpa: "vinaytiwari.iist-2@okhdfcbank", // the UPI ID readers pay
  name: "Vinay Kumar Tiwari", // shown in the UPI app when the reader pays (plain letters are safest)
};
var CLAIMS_MAX = 5; // wrong transaction numbers one order may be given

var ORDERS_SHEET = "Orders";
var ENT_SHEET = "Entitlements";
var ORDER_HEADERS = [
  "id", "time", "email", "sub", "name", "phone", "state", "book", "title", "coupon",
  "mrp", "list", "discount", "taxable", "cgst", "sgst", "igst", "tax", "total",
  "status", "rzp_order", "rzp_payment", "method", "detail", "paid_at", "invoice", "mailed", "receipt",
];
var ORDER_TEXT = [1, 4, 6, 21, 22, 26];
var ENT_HEADERS = ["time", "sub", "email", "book", "source", "order", "status", "note"];
var ENT_TEXT = [2, 6];

var STATES = [
  "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chandigarh",
  "Chhattisgarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa", "Gujarat", "Haryana",
  "Himachal Pradesh", "Jammu and Kashmir", "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep",
  "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Puducherry",
  "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand",
  "West Bengal",
];

function prop_(k) {
  return PropertiesService.getScriptProperties().getProperty(k) || "";
}

function provider_() {
  return PAYMENT_PROVIDER === "razorpay" ? "razorpay" : "upi";
}

function upiId_() {
  return String(prop_("UPI_ID") || UPI.vpa || "").trim();
}

function validVpa_(v) {
  return /^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9.-]{1,30}$/.test(String(v || ""));
}

function razorpayKeys_() {
  return !!(prop_("RAZORPAY_KEY_ID") && prop_("RAZORPAY_KEY_SECRET"));
}

function paymentsReady_() {
  return provider_() === "upi" ? validVpa_(upiId_()) : razorpayKeys_();
}

function paymentsMode_() {
  if (provider_() === "upi") return paymentsReady_() ? "upi" : "";
  var id = prop_("RAZORPAY_KEY_ID");
  if (!id) return "";
  return id.indexOf("rzp_live_") === 0 ? "live" : "test";
}

/* ------------------------------------------------------------- the price */
function stateOf_(v) {
  var s = String(v || "").trim().toLowerCase();
  if (!s) return "";
  for (var i = 0; i < STATES.length; i++) {
    if (STATES[i].toLowerCase() === s) return STATES[i];
  }
  return null; // given, but not a state
}

/** Whole paise to rupees with two decimals. */
function rupees_(p) {
  return Math.round(p) / 100;
}

/**
 * The amounts for one book, coupon and place of supply. Everything is worked in
 * whole paise so the parts always add up to the total.
 */
function amountsFor_(slug, couponDiscountRs, couponCode, buyerState) {
  var price = PRICES[slug];
  var mrpP = Math.round(price.mrp * 100);
  var listP = Math.round(price.selling * 100);
  var discP = Math.min(listP, Math.max(0, Math.round(couponDiscountRs * 100)));
  var netP = listP - discP;

  var taxP = 0;
  var taxable = netP;
  var total = netP;
  var intra = true;
  var cgst = 0;
  var sgst = 0;
  var igst = 0;
  if (GST.enabled && netP > 0) {
    if (GST.inclusive) {
      taxable = Math.round(netP / (1 + GST.rate / 100));
      taxP = netP - taxable;
    } else {
      taxP = Math.round((netP * GST.rate) / 100);
      total = netP + taxP;
    }
    var sellerState = String(SELLER.state || "").toLowerCase();
    var place = String(buyerState || SELLER.state || "").toLowerCase();
    intra = !sellerState || place === sellerState;
    if (intra) {
      cgst = Math.floor(taxP / 2);
      sgst = taxP - cgst;
    } else {
      igst = taxP;
    }
  }
  return {
    currency: "INR",
    mrp: rupees_(mrpP),
    list: rupees_(listP),
    coupon: couponCode || "",
    discount: rupees_(discP),
    net: rupees_(netP),
    taxable: rupees_(taxable),
    tax: {
      enabled: !!GST.enabled,
      rate: GST.enabled ? GST.rate : 0,
      inclusive: !!GST.inclusive,
      intra: intra,
      cgst: rupees_(cgst),
      sgst: rupees_(sgst),
      igst: rupees_(igst),
      total: rupees_(taxP),
    },
    total: rupees_(total),
    totalPaise: total,
    saved: rupees_(mrpP - netP),
  };
}

/** The quote for this account: price, coupon (and why not, if it fails), state. */
function quote_(slug, code, user, buyerState) {
  var cres = null;
  var disc = 0;
  var applied = "";
  if (code) {
    cres = couponCheck_(code, user, slug, null);
    if (cres.valid) {
      disc = cres.discount;
      applied = cres.code;
    }
  }
  var a = amountsFor_(slug, disc, applied, buyerState);
  return {
    amounts: a,
    coupon: code ? { code: String(code).toUpperCase(), valid: !!(cres && cres.valid), reason: cres && !cres.valid ? cres.reason : "" } : null,
  };
}

/* ----------------------------------------------------- who owns what */
function entRows_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ENT_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, ENT_HEADERS.length).getValues();
}

function entMatch_(r, user, slug) {
  if (String(r[3]) !== slug) return false;
  if (String(r[6]) === "revoked") return false;
  var who = String(r[1]);
  var mail = String(user.email || "").toLowerCase();
  return who === "g:" + user.sub || who === user.sub || (mail && String(r[2]).toLowerCase() === mail);
}

/** Does this account own the book — by a row in Entitlements (admins aside)? */
function owns_(user, slug) {
  if (!user) return false;
  var rows = entRows_();
  for (var i = 0; i < rows.length; i++) {
    if (entMatch_(rows[i], user, slug)) return true;
  }
  return false;
}

/** May this account read? The admin team always may; everyone else must own it. */
function entitled_(user, slug) {
  if (!user) return false;
  if (!PAYWALL || !PRICES[slug]) return true;
  return isAdmin_(user) || owns_(user, slug);
}

function grant_(user, email, sub, slug, source, orderId, note) {
  appendText_(tab_(ENT_SHEET, ENT_HEADERS), [new Date(), sub ? "g:" + sub : "", String(email).toLowerCase(), slug, source, orderId || "", "active", note || ""]);
  try {
    if (sub) CacheService.getScriptCache().remove("me_" + sub);
  } catch (err) {
    /* recomputed within two minutes anyway */
  }
}

/* ----------------------------------------------------------- orders */
function ordersTab_() {
  return ensureTab_(ORDERS_SHEET, ORDER_HEADERS, ORDER_TEXT);
}

function readOrders_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ORDERS_SHEET);
  var out = [];
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, ORDER_HEADERS.length).getValues().forEach(function (r, i) {
    var snap = null;
    try {
      snap = JSON.parse(String(r[27] || "null"));
    } catch (err) {
      snap = null;
    }
    if (!snap) return;
    out.push({
      row: i + 2,
      id: String(r[0]),
      sub: String(r[3]).replace(/^g:/, ""),
      email: String(r[2]).toLowerCase(),
      status: String(r[19]),
      rzpOrder: String(r[20]),
      rzpPayment: String(r[21]),
      snap: snap,
    });
  });
  return out;
}

function findOrder_(id) {
  var all = readOrders_();
  for (var i = 0; i < all.length; i++) {
    if (all[i].id === id) return all[i];
  }
  return null;
}

function findOrderByRzp_(rzpOrder) {
  var all = readOrders_();
  for (var i = 0; i < all.length; i++) {
    if (all[i].rzpOrder === rzpOrder) return all[i];
  }
  return null;
}

function orderCells_(s, sub) {
  var a = s.amounts;
  var t = a.tax;
  return [
    s.id, new Date(s.createdAt), s.buyer.email, "g:" + sub, s.buyer.name, String(s.buyer.phone || "").replace(/^\+/, ""), s.buyer.state,
    s.item.slug, s.item.title, a.coupon, a.mrp, a.list, a.discount, a.taxable, t.cgst, t.sgst, t.igst, t.total, a.total,
    s.status, s.gateway.orderId, s.gateway.paymentId, s.payment.method, s.payment.detail,
    s.paidAt ? new Date(s.paidAt) : "", s.invoice, s.mailed, JSON.stringify(s),
  ];
}

function saveOrder_(o) {
  o.snap.status = o.status;
  var cells = orderCells_(o.snap, o.sub);
  if (o.row) {
    ordersTab_().getRange(o.row, 1, 1, cells.length).setValues([safeRow_(cells)]);
  } else {
    var sh = ordersTab_();
    appendRows_(sh, [cells]);
    o.row = sh.getLastRow();
  }
}

function newOrderId_() {
  return "KO-" + Date.now().toString(36).toUpperCase() + "-" + Math.floor(Math.random() * 1679616).toString(36).toUpperCase();
}

/** KC/2627/000012 — numbered in sequence within each financial year (Apr–Mar, IST). */
function nextInvoice_() {
  var ist = new Date(Date.now() + 330 * 60000);
  var y = ist.getUTCFullYear();
  var fy = ist.getUTCMonth() + 1 >= 4 ? y : y - 1;
  var tag = String(fy).slice(2) + String(fy + 1).slice(2);
  var props = PropertiesService.getScriptProperties();
  var n = Number(props.getProperty("INV_" + tag) || 0) + 1;
  props.setProperty("INV_" + tag, String(n));
  return "KC/" + tag + "/" + ("000000" + n).slice(-6);
}

function publicSnap_(s) {
  var o = {};
  Object.keys(s).forEach(function (k) {
    o[k] = s[k];
  });
  return o;
}

function summaryOf_(o) {
  var s = o.snap;
  return {
    id: o.id,
    status: o.status,
    at: new Date(s.createdAt).toISOString(),
    paidAt: s.paidAt ? new Date(s.paidAt).toISOString() : "",
    invoice: s.invoice || "",
    title: s.item.title,
    slug: s.item.slug,
    coupon: s.amounts.coupon,
    mrp: s.amounts.mrp,
    list: s.amounts.list,
    discount: s.amounts.discount,
    tax: s.amounts.tax.total,
    total: s.amounts.total,
    method: s.payment.method,
    email: s.buyer.email,
    name: s.buyer.name,
    mailed: s.mailed || "",
    utr: s.claim && s.claim.utr ? s.claim.utr : "",
    claimedAt: s.claim && s.claim.at ? new Date(s.claim.at).toISOString() : "",
    rejected: s.claim && s.claim.rejected ? s.claim.rejected : "",
  };
}

/* ------------------------------------------------------------- Razorpay */
function rzp_(method, path, body) {
  var id = prop_("RAZORPAY_KEY_ID");
  var secret = prop_("RAZORPAY_KEY_SECRET");
  if (!id || !secret) return { ok: false, status: 0, data: {} };
  var opt = {
    method: method,
    muteHttpExceptions: true,
    headers: { Authorization: "Basic " + Utilities.base64Encode(id + ":" + secret) },
    contentType: "application/json",
  };
  if (body) opt.payload = JSON.stringify(body);
  try {
    var res = UrlFetchApp.fetch("https://api.razorpay.com/v1" + path, opt);
    var code = res.getResponseCode();
    var data = {};
    try {
      data = JSON.parse(res.getContentText());
    } catch (err) {
      data = {};
    }
    return { ok: code >= 200 && code < 300, status: code, data: data };
  } catch (err2) {
    return { ok: false, status: 0, data: {} };
  }
}

function hmacHex_(message, secret) {
  return bytesToHex_(Utilities.computeHmacSha256Signature(message, secret));
}

/** Equal without stopping at the first difference. */
function sameText_(a, b) {
  a = String(a);
  b = String(b);
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function maskVpa_(v) {
  var m = /^([^@]+)@(.+)$/.exec(String(v || ""));
  if (!m) return "";
  return m[1].slice(0, 2) + "••••@" + m[2];
}

/** How the buyer paid, as a method name and a short detail — never a full number. */
function paymentLook_(p) {
  var method = String(p.method || "");
  var detail = "";
  if (method === "upi") {
    detail = p.__detail || maskVpa_(p.vpa);
    method = "UPI";
  } else if (method === "card") {
    var c = p.card || {};
    var kind = c.type === "credit" ? "Credit card" : c.type === "debit" ? "Debit card" : "Card";
    detail = (c.network ? c.network + " " : "") + (c.last4 ? "•••• " + c.last4 : "");
    method = kind;
  } else if (method === "netbanking") {
    detail = String(p.bank || "");
    method = "Net banking";
  } else if (method === "wallet") {
    detail = String(p.wallet || "");
    method = "Wallet";
  } else if (method) {
    method = method.charAt(0).toUpperCase() + method.slice(1);
  }
  return { method: method, detail: clean_(detail, 60) };
}

/* ---------------------------------------------------------- shop actions */
function shopQuote_(d, user) {
  var slug = clean_(d.slug, 80);
  if (!PRICES[slug]) return json_({ ok: false, error: "invalid" });
  var st = stateOf_(d.state);
  if (st === null) return json_({ ok: false, error: "invalid", why: "state" });
  if (d.code && !allow_("cc_" + user.sub, 30, 600)) return json_({ ok: false, error: "limited" });
  var q = quote_(slug, d.code, user, st);
  // an order already paid and waiting for the owner: the page goes back to it
  var waiting = "";
  readOrders_().forEach(function (o) {
    if (o.status === "pending" && o.sub === user.sub && o.snap.item.slug === slug) waiting = o.id;
  });
  return json_({
    ok: true,
    pendingOrder: waiting,
    slug: slug,
    title: PRICES[slug].title,
    amounts: q.amounts,
    coupon: q.coupon,
    owned: owns_(user, slug),
    team: isAdmin_(user),
    payments: { ready: paymentsReady_(), mode: paymentsMode_(), provider: provider_() },
    seller: { state: SELLER.state, gstin: !!SELLER.gstin },
    states: STATES,
  });
}

function snapshotFor_(id, user, slug, buyer, amounts, rzpOrderId) {
  var price = PRICES[slug];
  return {
    v: 1,
    id: id,
    status: "created",
    createdAt: Date.now(),
    paidAt: 0,
    invoice: "",
    buyer: buyer,
    seller: {
      brand: SELLER.brand,
      name: SELLER.name,
      address: SELLER.address,
      state: SELLER.state,
      gstin: SELLER.gstin,
      email: SELLER.email,
    },
    item: {
      slug: slug,
      title: price.title,
      author: price.author,
      sac: GST.enabled ? GST.sac : "",
      qty: 1,
      note: "ई-बुक · डिजिटल संस्करण · आजीवन पहुँच",
    },
    amounts: amounts,
    payment: { method: "", detail: "", status: "" },
    gateway: {
      name: amounts.totalPaise > 0 ? (provider_() === "upi" ? "UPI" : "Razorpay") : "",
      orderId: rzpOrderId || "",
      paymentId: "",
      mode: paymentsMode_(),
    },
    claim: null,
    accepted: LEGAL_VERSION,
    mailed: "",
  };
}

function shopOrder_(d, user) {
  var slug = clean_(d.slug, 80);
  if (!PRICES[slug]) return json_({ ok: false, error: "invalid" });
  if (!allow_("so_" + user.sub, 12, 600)) return json_({ ok: false, error: "limited" });
  if (owns_(user, slug)) return json_({ ok: true, owned: true });
  if (d.accept !== true) return json_({ ok: false, error: "invalid", why: "accept" });

  var name = clean_(d.name, 60) || clean_(user.name, 60);
  if (name.length < 2) return json_({ ok: false, error: "invalid", why: "name" });
  var phone = String(d.phone || "").replace(/[^0-9+]/g, "").slice(0, 15);
  if (phone && phone.replace(/\D/g, "").length < 8) return json_({ ok: false, error: "invalid", why: "phone" });
  var state = stateOf_(d.state);
  if (state === null) return json_({ ok: false, error: "invalid", why: "state" });
  if (GST.enabled && SELLER.state && !state) return json_({ ok: false, error: "invalid", why: "state" });

  var q = quote_(slug, d.code, user, state);
  if (d.code && !(q.coupon && q.coupon.valid)) {
    audit_(user, "coupon.refused", String(d.code).toUpperCase(), q.coupon ? q.coupon.reason : "unknown", false, d.ua);
    return json_({ ok: true, valid: false, reason: q.coupon ? q.coupon.reason : "unknown" });
  }
  var a = q.amounts;
  var buyer = { name: name, email: user.email, phone: phone, state: state || "" };

  if (a.totalPaise > 0 && !paymentsReady_()) return json_({ ok: false, error: "payments_off" });

  // an order whose payment the owner has not yet confirmed: that is the order
  var mine = readOrders_();
  for (var p = mine.length - 1; p >= 0; p--) {
    if (mine[p].status === "pending" && mine[p].sub === user.sub && mine[p].snap.item.slug === slug) {
      return json_({ ok: true, order: publicSnap_(mine[p].snap), checkout: checkoutFor_(mine[p], user), pending: true });
    }
  }

  // the same order, still open: hand it back rather than leave a second one at the gateway
  for (var i = mine.length - 1; i >= 0; i--) {
    var m = mine[i];
    if (
      m.status === "created" && m.sub === user.sub && m.snap.item.slug === slug &&
      (provider_() === "upi" ? m.snap.gateway.name === "UPI" : !!m.rzpOrder) &&
      m.snap.amounts.totalPaise === a.totalPaise && m.snap.amounts.coupon === a.coupon &&
      Date.now() - m.snap.createdAt < 25 * 60000
    ) {
      m.snap.buyer = buyer;
      saveOrder_(m);
      return json_({ ok: true, order: publicSnap_(m.snap), checkout: checkoutFor_(m, user) });
    }
  }

  var id = newOrderId_();
  var rzpId = "";
  if (a.totalPaise > 0 && provider_() === "razorpay") {
    var made = rzp_("POST", "/orders", {
      amount: a.totalPaise,
      currency: "INR",
      receipt: id,
      notes: { order: id, book: slug, email: user.email },
    });
    if (!made.ok || !made.data.id) {
      console.error("razorpay order failed: " + made.status + " " + JSON.stringify(made.data));
      audit_(user, "order.error", id, "gateway refused to create the order (" + made.status + ")", false, d.ua);
      return json_({ ok: false, error: "gateway" });
    }
    rzpId = String(made.data.id);
  }

  var o = { row: 0, id: id, sub: user.sub, email: user.email, status: "created", rzpOrder: rzpId, rzpPayment: "", snap: snapshotFor_(id, user, slug, buyer, a, rzpId) };
  saveOrder_(o);
  audit_(user, "order.create", id, slug + ", ₹" + a.total + (a.coupon ? ", coupon " + a.coupon : ""), true, d.ua);

  if (a.totalPaise === 0) {
    var done = completeOrder_(o, "", "free", user, d.ua);
    return json_({ ok: true, order: publicSnap_(done.snap), free: true });
  }
  return json_({ ok: true, order: publicSnap_(o.snap), checkout: checkoutFor_(o, user) });
}

/** A UPI payment link: opens Google Pay (or any UPI app) with the amount filled in. */
function upiCheckoutFor_(s) {
  var vpa = upiId_();
  var amount = s.amounts.total.toFixed(2);
  var note = "DoKulhadChai " + s.id;
  var q =
    "pa=" + encodeURIComponent(vpa) +
    "&pn=" + encodeURIComponent(UPI.name || "Vinay Kumar Tiwari") +
    "&am=" + amount +
    "&cu=INR&tn=" + encodeURIComponent(note);
  return {
    provider: "upi",
    mode: "upi",
    receipt: s.id,
    amount: s.amounts.totalPaise,
    currency: "INR",
    upi: {
      vpa: vpa,
      name: UPI.name,
      amount: s.amounts.total,
      note: note,
      link: "upi://pay?" + q,
      // Google Pay on Android and on iPhone; any other UPI app uses "link"
      android: "intent://pay?" + q + "#Intent;scheme=upi;package=com.google.android.apps.nbu.paisa.user;end",
      ios: "gpay://upi/pay?" + q,
    },
    claim: s.claim || null,
  };
}

function checkoutFor_(o, user) {
  var s = o.snap;
  if (s.gateway.name === "UPI") return upiCheckoutFor_(s);
  return {
    provider: "razorpay",
    keyId: prop_("RAZORPAY_KEY_ID"),
    mode: paymentsMode_(),
    rzpOrderId: o.rzpOrder,
    amount: s.amounts.totalPaise,
    currency: "INR",
    name: SELLER.brand,
    description: s.item.title + " · ई-बुक",
    prefill: { name: s.buyer.name, email: s.buyer.email, contact: s.buyer.phone },
    receipt: s.id,
  };
}

/**
 * The payment is real: write the access, issue the invoice number, record the
 * coupon use, send the receipt. Safe to call twice — the second finds it done.
 */
function completeOrder_(o, paymentId, via, actor, device, pay) {
  return withLock_(function () {
    var fresh = findOrder_(o.id) || o;
    if (fresh.status === "paid" || fresh.status === "free") return fresh;
    o = fresh;
    var s = o.snap;
    var look = pay ? paymentLook_(pay) : { method: "", detail: "" };
    s.paidAt = Date.now();
    s.invoice = nextInvoice_();
    s.gateway.paymentId = paymentId || "";
    s.payment = {
      method: paymentId ? look.method : "Free (coupon)",
      detail: look.detail,
      status: paymentId ? "captured" : "not required",
    };
    o.status = paymentId ? "paid" : "free";
    o.rzpPayment = paymentId || "";
    saveOrder_(o);

    if (!owns_({ sub: o.sub, email: o.email }, s.item.slug)) {
      grant_(null, o.email, o.sub, s.item.slug, paymentId ? "paid" : "free", o.id, "invoice " + s.invoice);
    }
    if (s.amounts.coupon) {
      appendRows_(ensureTab_(REDEEM_SHEET, REDEEM_HEADERS, [2, 8]), [[
        new Date(), s.amounts.coupon, o.email, s.item.slug, s.amounts.list, s.amounts.discount, s.amounts.total, o.id,
      ]]);
    }
    audit_(
      actor || { email: o.email, sub: o.sub },
      "order.paid",
      o.id,
      "₹" + s.amounts.total + ", " + (s.payment.method || "free") + (paymentId ? ", " + paymentId : "") + ", via " + via + ", " + s.invoice,
      true,
      device
    );

    s.mailed = mailReceipt_(s, "paid");
    saveOrder_(o);
    return o;
  });
}

/** Ask Razorpay about a payment; settle it if (and only if) it is really paid. */
function settle_(o, paymentId, via, actor, device) {
  var p = rzp_("GET", "/payments/" + encodeURIComponent(paymentId));
  var pay = p.ok ? p.data : null;
  if (pay) {
    if (String(pay.order_id) !== o.rzpOrder || Number(pay.amount) !== o.snap.amounts.totalPaise || String(pay.currency) !== "INR") {
      audit_(actor, "order.mismatch", o.id, "payment " + paymentId + " does not match the order", false, device);
      return { ok: false, error: "mismatch" };
    }
    if (pay.status === "authorized") {
      var cap = rzp_("POST", "/payments/" + encodeURIComponent(paymentId) + "/capture", {
        amount: o.snap.amounts.totalPaise,
        currency: "INR",
      });
      if (!cap.ok) return { ok: false, error: "pending" };
      pay = cap.data;
    }
    if (pay.status !== "captured") return { ok: false, error: pay.status === "failed" ? "failed" : "pending" };
  }
  // Two open orders for the same book, both paid: the account already owns it by
  // the first, so this payment is a duplicate. Give it back rather than keep it.
  if (paymentId && o.snap.amounts.totalPaise > 0 && owns_({ sub: o.sub, email: o.email }, o.snap.item.slug)) {
    return { ok: true, order: refundDuplicate_(o, paymentId, actor, device), duplicate: true };
  }
  var done = completeOrder_(o, paymentId, via, actor, device, pay);
  return { ok: true, order: done };
}

function refundDuplicate_(o, paymentId, actor, device) {
  return withLock_(function () {
    var fresh = findOrder_(o.id) || o;
    if (fresh.status === "refunded" || fresh.status === "duplicate") return fresh;
    o = fresh;
    var r = rzp_("POST", "/payments/" + encodeURIComponent(paymentId) + "/refund", {
      amount: o.snap.amounts.totalPaise,
      notes: { order: o.id, why: "duplicate payment" },
    });
    o.snap.gateway.paymentId = paymentId;
    o.rzpPayment = paymentId;
    o.snap.paidAt = Date.now();
    o.snap.payment = { method: "", detail: "", status: r.ok ? "refunded (duplicate)" : "duplicate — refund pending" };
    o.status = r.ok ? "refunded" : "duplicate";
    saveOrder_(o);
    audit_(actor || { email: o.email, sub: o.sub }, "order.duplicate", o.id, "₹" + o.snap.amounts.total + " " + paymentId + (r.ok ? ", refunded" : ", refund FAILED — refund it from the Razorpay dashboard"), r.ok, device);
    if (r.ok) {
      sendMail_(
        o.email,
        o.snap.seller.brand + " — दोहरा भुगतान लौटाया गया",
        "<p>नमस्ते " + esc_(o.snap.buyer.name) + ",</p><p><b>" + esc_(o.snap.item.title) + "</b> पहले से आपके खाते में है, इसलिए ऑर्डर <b>" + esc_(o.id) +
          "</b> का ₹" + o.snap.amounts.total.toFixed(2) + " का दूसरा भुगतान लौटा दिया गया है। राशि आमतौर पर 5–7 कार्य-दिवस में आपके भुगतान के साधन में लौट आती है।</p><p>— " + esc_(o.snap.seller.brand) + "</p>",
        "नमस्ते " + o.snap.buyer.name + ",\n\n" + o.snap.item.title + " पहले से आपके खाते में है, इसलिए ऑर्डर " + o.id + " का ₹" + o.snap.amounts.total.toFixed(2) +
          " का दूसरा भुगतान लौटा दिया गया है। राशि आमतौर पर 5–7 कार्य-दिवस में लौट आती है।\n\n— " + o.snap.seller.brand
      );
    }
    return o;
  });
}

function shopVerify_(d, user) {
  if (!allow_("sv_" + user.sub, 20, 600)) return json_({ ok: false, error: "limited" });
  var o = findOrder_(tidy_(d.orderId, 40));
  if (!o || o.sub !== user.sub) return json_({ ok: false, error: "missing" });
  if (o.status === "paid" || o.status === "free" || o.status === "refunded" || o.status === "duplicate") {
    return json_({ ok: true, order: publicSnap_(o.snap) });
  }

  var payId = tidy_(d.paymentId, 60);
  var rzpOrder = tidy_(d.rzpOrderId, 60);
  var sig = String(d.signature || "").toLowerCase();
  var secret = prop_("RAZORPAY_KEY_SECRET");
  if (!secret || !payId || !o.rzpOrder || rzpOrder !== o.rzpOrder) return json_({ ok: false, error: "invalid" });
  if (!sameText_(hmacHex_(rzpOrder + "|" + payId, secret), sig)) {
    audit_(user, "order.bad-signature", o.id, "payment " + payId, false, d.ua);
    return json_({ ok: false, error: "signature" });
  }
  var r = settle_(o, payId, "checkout", user, d.ua);
  if (!r.ok) return json_({ ok: false, error: r.error });
  return json_({ ok: true, order: publicSnap_(r.order.snap), duplicate: !!r.duplicate });
}

/** Look for a payment on an open order by asking Razorpay (browser closed, webhook, return visit). */
function reconcile_(o, via, actor, device) {
  if (!o.rzpOrder || o.status !== "created") return null;
  var list = rzp_("GET", "/orders/" + encodeURIComponent(o.rzpOrder) + "/payments");
  var items = (list.ok && list.data.items) || [];
  for (var i = 0; i < items.length; i++) {
    var st = items[i].status;
    if (st === "captured" || st === "authorized") {
      var r = settle_(o, String(items[i].id), via, actor, device);
      if (r.ok) return r.order;
    }
  }
  return null;
}

function shopResume_(d, user) {
  if (!allow_("sr_" + user.sub, 12, 600)) return json_({ ok: true, settled: 0 });
  var want = d.orderId ? tidy_(d.orderId, 40) : "";
  var cutoff = Date.now() - 7 * DAY_MS;
  var open = readOrders_().filter(function (o) {
    return o.sub === user.sub && o.status === "created" && o.rzpOrder && o.snap.createdAt > cutoff && (!want || o.id === want);
  });
  var settled = [];
  open.slice(-3).forEach(function (o) {
    var done = reconcile_(o, "resume", user, d.ua);
    if (done) settled.push(publicSnap_(done.snap));
  });
  return json_({ ok: true, settled: settled.length, orders: settled, owned: owns_(user, clean_(d.slug, 80)) });
}

function shopWebhook_(d) {
  var ent = d.payload && d.payload.payment && d.payload.payment.entity;
  var rzpOrder = ent ? tidy_(ent.order_id, 60) : "";
  if (!rzpOrder || !allow_("wh_all", 300, 60)) return json_({ ok: true });
  // nothing in the notification is believed: the order is looked up, and Razorpay is asked
  var o = findOrderByRzp_(rzpOrder);
  if (o && o.status === "created") reconcile_(o, "webhook", null, "razorpay");
  return json_({ ok: true });
}

function myOrders_(user) {
  return readOrders_().filter(function (o) {
    return o.sub === user.sub || o.email === String(user.email).toLowerCase();
  });
}

function shopOrders_(user) {
  var rows = myOrders_(user).map(summaryOf_);
  rows.sort(function (a, b) { return a.at < b.at ? 1 : -1; });
  return json_({ ok: true, rows: rows.slice(0, 50) });
}

function shopReceipt_(d, user) {
  var o = findOrder_(tidy_(d.orderId, 40));
  if (!o || (o.sub !== user.sub && o.email !== String(user.email).toLowerCase() && !isAdmin_(user))) {
    return json_({ ok: false, error: "missing" });
  }
  var out = { ok: true, order: publicSnap_(o.snap) };
  // an open order the buyer returns to (a reload, another device): everything the
  // payment window needs, so they are not asked for their details again
  if ((o.status === "created" || o.status === "pending") && o.sub === user.sub && paymentsReady_()) {
    if (o.snap.gateway.name === "UPI" || o.rzpOrder) out.checkout = checkoutFor_(o, user);
  }
  return json_(out);
}

/**
 * UPI: the reader has paid and writes down the 12-digit transaction number from
 * their app. Nothing is opened yet — the order waits for the owner's Confirm.
 */
function shopClaim_(d, user) {
  if (provider_() !== "upi") return json_({ ok: false, error: "invalid" });
  if (!allow_("sc_" + user.sub, 10, 600)) return json_({ ok: false, error: "limited" });
  var o = findOrder_(tidy_(d.orderId, 40));
  if (!o || o.sub !== user.sub) return json_({ ok: false, error: "missing" });
  if (o.status === "paid" || o.status === "free") return json_({ ok: true, order: publicSnap_(o.snap) });
  if (o.status !== "created" || o.snap.gateway.name !== "UPI") return json_({ ok: false, error: "invalid" });
  var utr = String(d.utr || "").replace(/\s+/g, "");
  if (!/^\d{12}$/.test(utr)) return json_({ ok: false, error: "invalid", why: "utr" });
  var attempts = (o.snap.claim && o.snap.claim.attempts) || 0;
  if (attempts >= CLAIMS_MAX) return json_({ ok: false, error: "limited" });
  // one transaction number settles one order
  var all = readOrders_();
  for (var i = 0; i < all.length; i++) {
    if (all[i].id !== o.id && all[i].snap.claim && all[i].snap.claim.utr === utr && all[i].status !== "created") {
      audit_(user, "order.utr-reused", o.id, "number already on " + all[i].id, false, d.ua);
      return json_({ ok: false, error: "utr_used" });
    }
  }
  o.snap.claim = { utr: utr, at: Date.now(), attempts: attempts + 1, rejected: "" };
  o.snap.payment = { method: "UPI", detail: "UTR " + utr, status: "awaiting confirmation" };
  o.status = "pending";
  saveOrder_(o);
  audit_(user, "order.claim", o.id, "₹" + o.snap.amounts.total + ", UTR " + utr, true, d.ua);
  sendMail_(
    ADMIN_EMAIL,
    "पुष्टि चाहिए: ₹" + o.snap.amounts.total.toFixed(2) + " — " + o.snap.buyer.name,
    "<p><b>" + esc_(o.snap.buyer.name) + "</b> (" + esc_(o.email) + ") ने ₹" + o.snap.amounts.total.toFixed(2) +
      " का UPI भुगतान बताया है।</p><p>UPI लेन-देन संख्या: <b>" + esc_(utr) + "</b><br>ऑर्डर: " + esc_(o.id) +
      "</p><p>अपने खाते में रकम देखकर <a href=\"" + SITE_URL + "/admin#sales\">Admin → Sales</a> में Confirm कीजिए।</p>",
    "ऑर्डर " + o.id + "\n" + o.snap.buyer.name + " (" + o.email + ")\n₹" + o.snap.amounts.total.toFixed(2) + "\nUTR: " + utr +
      "\n\n" + SITE_URL + "/admin#sales"
  );
  return json_({ ok: true, order: publicSnap_(o.snap), checkout: upiCheckoutFor_(o.snap) });
}

/** The owner has seen the money: open the book and send the receipt. */
function orderConfirm_(d, user) {
  var o = findOrder_(tidy_(d.orderId, 40));
  if (!o) return json_({ ok: false, error: "missing" });
  if (o.status === "paid") return json_({ ok: true, order: publicSnap_(o.snap) });
  if (o.status !== "pending" || !o.snap.claim) return json_({ ok: false, error: "invalid" });
  if (owns_({ sub: o.sub, email: o.email }, o.snap.item.slug)) {
    // they already had the book (a copy given, or another order paid): flag it
    o.status = "duplicate";
    o.snap.payment.status = "duplicate — refund by hand";
    saveOrder_(o);
    audit_(user, "order.duplicate", o.id, "already owned; refund the UPI payment by hand", false, d.ua);
    return json_({ ok: false, error: "duplicate" });
  }
  var done = completeOrder_(o, o.snap.claim.utr, "owner-confirm", user, d.ua, { method: "upi", __detail: "UTR " + o.snap.claim.utr });
  return json_({ ok: true, order: publicSnap_(done.snap) });
}

/** The number does not match anything in the account: the reader may try again. */
function orderReject_(d, user) {
  var o = findOrder_(tidy_(d.orderId, 40));
  if (!o) return json_({ ok: false, error: "missing" });
  if (o.status !== "pending" || !o.snap.claim) return json_({ ok: false, error: "invalid" });
  var why = clean_(d.reason, 140) || "यह लेन-देन संख्या हमारे खाते में नहीं मिली।";
  o.snap.claim.rejected = why;
  o.snap.payment = { method: "UPI", detail: "", status: "claim not confirmed" };
  o.status = "created";
  saveOrder_(o);
  audit_(user, "order.reject", o.id, "UTR " + o.snap.claim.utr + ": " + why, true, d.ua);
  sendMail_(
    o.email,
    o.snap.seller.brand + " — भुगतान की पुष्टि नहीं हो पाई (" + o.id + ")",
    "<p>नमस्ते " + esc_(o.snap.buyer.name) + ",</p><p>आपके दिए UPI लेन-देन (" + esc_(o.snap.claim.utr) + ") की पुष्टि नहीं हो पाई: " + esc_(why) +
      "</p><p>कृपया <a href=\"" + SITE_URL + "/checkout?order=" + encodeURIComponent(o.id) + "\">इस पन्ने</a> पर सही संख्या फिर से लिखिए, या इसी ई-मेल का उत्तर दीजिए।</p><p>— " + esc_(o.snap.seller.brand) + "</p>",
    "नमस्ते " + o.snap.buyer.name + ",\n\nआपके दिए UPI लेन-देन (" + o.snap.claim.utr + ") की पुष्टि नहीं हो पाई: " + why +
      "\nकृपया सही संख्या फिर से लिखिए: " + SITE_URL + "/checkout?order=" + o.id + "\n\n— " + o.snap.seller.brand
  );
  return json_({ ok: true });
}

function shopResend_(d, user) {
  var o = findOrder_(tidy_(d.orderId, 40));
  if (!o || (o.sub !== user.sub && !isAdmin_(user))) return json_({ ok: false, error: "missing" });
  if (o.status !== "paid" && o.status !== "free") return json_({ ok: false, error: "invalid" });
  if (!allow_("rs_" + o.id, 3, 86400)) return json_({ ok: false, error: "limited" });
  o.snap.mailed = mailReceipt_(o.snap, "resend");
  saveOrder_(o);
  audit_(user, "order.resend", o.id, o.snap.mailed, o.snap.mailed === "sent", d.ua);
  return json_({ ok: true, mailed: o.snap.mailed });
}

/* ------------------------------------------------------------ admin side */
function ordersList_(d) {
  var tz = whole_(d.tzMin, -840, 840, 0);
  var now = Date.now();
  var todayStart = Math.floor((now + tz * 60000) / DAY_MS) * DAY_MS - tz * 60000;
  var q = clean_(d.q, 80).toLowerCase();
  var status = clean_(d.status, 20);
  var k = { orders: 0, paid: 0, free: 0, open: 0, refunded: 0, revenue: 0, tax: 0, discount: 0, today: 0, week: 0, month: 0, todayCount: 0, weekCount: 0, monthCount: 0, saved: 0 };
  var rows = [];
  readOrders_().forEach(function (o) {
    var s = o.snap;
    k.orders++;
    var paid = o.status === "paid" || o.status === "free";
    if (o.status === "paid") k.paid++;
    else if (o.status === "free") k.free++;
    else if (o.status === "refunded") k.refunded++;
    else if (o.status === "duplicate") k.duplicates = (k.duplicates || 0) + 1;
    else if (o.status === "pending") k.pending = (k.pending || 0) + 1;
    else k.open++;
    if (o.status === "paid") {
      k.revenue += s.amounts.total;
      k.tax += s.amounts.tax.total;
      var t = s.paidAt || s.createdAt;
      if (t >= todayStart) { k.today += s.amounts.total; k.todayCount++; }
      if (t >= todayStart - 6 * DAY_MS) { k.week += s.amounts.total; k.weekCount++; }
      if (t >= todayStart - 29 * DAY_MS) { k.month += s.amounts.total; k.monthCount++; }
    }
    if (paid) k.discount += s.amounts.discount;
    if (status && o.status !== status) return;
    if (q && (o.email + " " + o.id + " " + s.invoice + " " + s.buyer.name + " " + s.amounts.coupon).toLowerCase().indexOf(q) < 0) return;
    rows.push(summaryOf_(o));
  });
  rows.sort(function (a, b) { return a.at < b.at ? 1 : -1; });
  ["revenue", "tax", "discount", "today", "week", "month"].forEach(function (f) {
    k[f] = Math.round(k[f] * 100) / 100;
  });
  var owners = {};
  entRows_().forEach(function (r) {
    if (String(r[6]) !== "revoked") owners[String(r[2]).toLowerCase() || String(r[1])] = 1;
  });
  return json_({
    ok: true,
    kpi: k,
    owners: Object.keys(owners).length,
    rows: rows.slice(0, whole_(d.limit, 1, 500, 200)),
    total: rows.length,
    payments: {
      ready: paymentsReady_(),
      mode: paymentsMode_(),
      paywall: PAYWALL,
      gst: !!GST.enabled,
      gstin: !!SELLER.gstin,
      address: !!SELLER.address,
      mail: mailReady_(),
      provider: provider_(),
      upi: validVpa_(upiId_()),
    },
  });
}

function orderGrant_(d, user) {
  var mail = clean_(d.email, 120).toLowerCase();
  var slug = clean_(d.slug, 80);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail) || !PRICES[slug]) return json_({ ok: false, error: "invalid" });
  var note = clean_(d.note, 100);
  if (d.revoke) {
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ENT_SHEET);
    var n = 0;
    if (sh && sh.getLastRow() > 1) {
      var v = sh.getRange(2, 1, sh.getLastRow() - 1, ENT_HEADERS.length).getValues();
      v.forEach(function (r, i) {
        if (String(r[2]).toLowerCase() === mail && String(r[3]) === slug && String(r[6]) !== "revoked") {
          sh.getRange(i + 2, 7).setValue("revoked");
          n++;
        }
      });
    }
    audit_(user, "access.revoke", mail, slug + (note ? ", " + note : ""), true, d.ua);
    return json_({ ok: true, revoked: n });
  }
  var existing = false;
  entRows_().forEach(function (r) {
    if (String(r[2]).toLowerCase() === mail && String(r[3]) === slug && String(r[6]) !== "revoked") existing = true;
  });
  if (!existing) grant_(user, mail, "", slug, "grant", "", note || "granted by " + user.email);
  audit_(user, "access.grant", mail, slug + (note ? ", " + note : ""), true, d.ua);
  return json_({ ok: true, granted: !existing });
}

function orderRefund_(d, user) {
  var o = findOrder_(tidy_(d.orderId, 40));
  if (!o) return json_({ ok: false, error: "missing" });
  if (o.status !== "paid" && o.status !== "free") return json_({ ok: false, error: "invalid" });
  if (o.status === "paid") {
    var r = rzp_("POST", "/payments/" + encodeURIComponent(o.rzpPayment) + "/refund", {
      amount: o.snap.amounts.totalPaise,
      notes: { order: o.id, by: user.email },
    });
    if (!r.ok) {
      audit_(user, "order.refund", o.id, "gateway refused (" + r.status + ")", false, d.ua);
      return json_({ ok: false, error: "gateway", why: String((r.data && r.data.error && r.data.error.description) || "").slice(0, 160) });
    }
    o.snap.payment.status = "refunded";
  }
  o.status = "refunded";
  saveOrder_(o);
  // the copy goes with the money
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ENT_SHEET);
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, ENT_HEADERS.length).getValues().forEach(function (row, i) {
      if (String(row[5]) === o.id) sh.getRange(i + 2, 7).setValue("revoked");
    });
  }
  try {
    CacheService.getScriptCache().remove("me_" + o.sub);
  } catch (err) {
    /* two minutes at most */
  }
  audit_(user, "order.refund", o.id, "₹" + o.snap.amounts.total + (d.reason ? ", " + clean_(d.reason, 80) : ""), true, d.ua);
  sendMail_(
    o.email,
    SELLER.brand + " — रिफ़ंड शुरू हो गया (" + (o.snap.invoice || o.id) + ")",
    "<p>नमस्ते " + esc_(o.snap.buyer.name) + ",</p><p>आपके ऑर्डर <b>" + esc_(o.id) + "</b> का ₹" + o.snap.amounts.total.toFixed(2) +
      " का रिफ़ंड शुरू कर दिया गया है। राशि आपके भुगतान के साधन में आमतौर पर 5–7 कार्य-दिवस में लौट आती है। इस ऑर्डर की किताब तक पहुँच अब बंद है।</p><p>— " + esc_(SELLER.brand) + "</p>",
    "नमस्ते " + o.snap.buyer.name + ",\n\nआपके ऑर्डर " + o.id + " का ₹" + o.snap.amounts.total.toFixed(2) + " का रिफ़ंड शुरू कर दिया गया है। राशि आमतौर पर 5–7 कार्य-दिवस में लौट आती है। इस ऑर्डर की किताब तक पहुँच अब बंद है।\n\n— " + SELLER.brand
  );
  return json_({ ok: true });
}

/* --------------------------------------------------------------- e-mail */
function esc_(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 1234.5 → ₹1,234.50 (lakh grouping). */
function inr_(n) {
  var s = (Math.round(Number(n) * 100) / 100).toFixed(2);
  var parts = s.split(".");
  var whole = parts[0];
  var tail = whole.slice(-3);
  var head = whole.slice(0, -3);
  if (head) tail = head.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + tail;
  return "₹" + tail + "." + parts[1];
}

var MONTHS_HI = ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"];

function istStamp_(ms) {
  var t = new Date(Number(ms) + 330 * 60000);
  var h = t.getUTCHours();
  var ap = h >= 12 ? "PM" : "AM";
  var h12 = h % 12 === 0 ? 12 : h % 12;
  return (
    t.getUTCDate() + " " + MONTHS_HI[t.getUTCMonth()] + " " + t.getUTCFullYear() + ", " +
    ("0" + h12).slice(-2) + ":" + ("0" + t.getUTCMinutes()).slice(-2) + " " + ap + " IST"
  );
}

/** The lines of the money table, shared by the HTML and the plain-text e-mail. */
function receiptLines_(s) {
  var a = s.amounts;
  var t = a.tax;
  var L = [];
  L.push(["मूल्य (MRP)", inr_(a.mrp), "strike"]);
  L.push(["विशेष मूल्य", inr_(a.list), ""]);
  if (a.discount > 0) L.push(["कूपन छूट" + (a.coupon ? " (" + a.coupon + ")" : ""), "− " + inr_(a.discount), "good"]);
  if (t.enabled) {
    L.push(["कर-योग्य मूल्य", inr_(a.taxable), ""]);
    if (t.intra) {
      L.push(["CGST " + t.rate / 2 + "%", inr_(t.cgst), ""]);
      L.push(["SGST " + t.rate / 2 + "%", inr_(t.sgst), ""]);
    } else {
      L.push(["IGST " + t.rate + "%", inr_(t.igst), ""]);
    }
  } else if (a.net > 0) {
    L.push(["GST", "लागू नहीं", ""]);
  }
  L.push([s.status === "paid" || s.status === "free" ? "कुल भुगतान" : "कुल देय", inr_(a.total), "total"]);
  return L;
}

function receiptTitle_(s) {
  return GST.enabled && s.seller.gstin ? "टैक्स इनवॉइस · Tax Invoice" : "रसीद · Receipt";
}

function receiptEmail_(s, kind) {
  var a = s.amounts;
  var lines = receiptLines_(s);
  var rows = lines
    .map(function (l) {
      var style = "padding:7px 0;border-bottom:1px solid #eadfcb;font-size:14px;color:#3a2a1f;";
      var val = "padding:7px 0;border-bottom:1px solid #eadfcb;font-size:14px;text-align:right;color:#1f1611;";
      if (l[2] === "strike") val += "text-decoration:line-through;color:#8a7a6a;";
      if (l[2] === "good") val += "color:#1c6b43;";
      if (l[2] === "total") {
        style += "font-weight:700;font-size:16px;border-bottom:0;padding-top:12px;";
        val += "font-weight:700;font-size:18px;border-bottom:0;padding-top:12px;";
      }
      return "<tr><td style=\"" + style + "\">" + esc_(l[0]) + "</td><td style=\"" + val + "\">" + esc_(l[1]) + "</td></tr>";
    })
    .join("");

  var taxNote = a.tax.enabled
    ? a.tax.inclusive
      ? "मूल्य में GST शामिल है।"
      : "GST अतिरिक्त जोड़ा गया है।"
    : "";
  var pay = s.payment.method
    ? esc_(s.payment.method) + (s.payment.detail ? " · " + esc_(s.payment.detail) : "")
    : "—";
  var readUrl = SITE_URL + "/read/" + s.item.slug;
  var recUrl = SITE_URL + "/receipt/" + s.id;
  var sellerLine = [s.seller.name, s.seller.address, s.seller.state ? s.seller.state : "", s.seller.gstin ? "GSTIN: " + s.seller.gstin : ""]
    .filter(function (x) { return x; })
    .map(esc_)
    .join("<br>");

  var html =
    "<!doctype html><html><body style=\"margin:0;padding:0;background:#f4ead7;\">" +
    "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:#f4ead7;padding:24px 12px;\"><tr><td align=\"center\">" +
    "<table role=\"presentation\" width=\"560\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:560px;width:100%;background:#fffaf0;border:1px solid #e6d8bd;border-radius:14px;font-family:'Noto Sans Devanagari','Segoe UI',Arial,sans-serif;\">" +
    "<tr><td style=\"padding:26px 28px 6px;\">" +
    "<div style=\"font-size:13px;letter-spacing:.08em;color:#8a5a2b;\">" + esc_(s.seller.brand) + "</div>" +
    "<h1 style=\"margin:8px 0 6px;font-size:22px;line-height:1.35;color:#1f1611;\">" +
    (kind === "resend" ? "आपकी रसीद" : "भुगतान सफल रहा — धन्यवाद, " + esc_(s.buyer.name)) + "</h1>" +
    "<p style=\"margin:0;font-size:15px;line-height:1.7;color:#3a2a1f;\">" +
    (a.total > 0 ? "आपका भुगतान मिल गया है। " : "आपका ऑर्डर पूरा हो गया है। ") +
    "<b>" + esc_(s.item.title) + "</b> अब आपके खाते (" + esc_(s.buyer.email) + ") में हमेशा के लिए खुल गई है — कोई और शुल्क नहीं।</p>" +
    "<p style=\"margin:18px 0 6px;\"><a href=\"" + esc_(readUrl) + "\" style=\"display:inline-block;background:#1f1611;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-size:15px;font-weight:600;\">किताब पढ़िए</a></p>" +
    "</td></tr>" +
    "<tr><td style=\"padding:14px 28px 4px;\">" +
    "<div style=\"font-size:12px;letter-spacing:.06em;color:#8a5a2b;text-transform:uppercase;\">" + esc_(receiptTitle_(s)) + "</div>" +
    "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin-top:8px;font-size:13px;color:#3a2a1f;\">" +
    "<tr><td style=\"padding:3px 0;\">इनवॉइस संख्या</td><td style=\"text-align:right;\"><b>" + esc_(s.invoice || "—") + "</b></td></tr>" +
    "<tr><td style=\"padding:3px 0;\">ऑर्डर संख्या</td><td style=\"text-align:right;\">" + esc_(s.id) + "</td></tr>" +
    "<tr><td style=\"padding:3px 0;\">तारीख</td><td style=\"text-align:right;\">" + esc_(istStamp_(s.paidAt || s.createdAt)) + "</td></tr>" +
    "</table></td></tr>" +
    "<tr><td style=\"padding:10px 28px 0;\">" +
    "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"border-top:2px solid #1f1611;margin-top:6px;\">" +
    "<tr><td colspan=\"2\" style=\"padding:12px 0 6px;font-size:15px;color:#1f1611;\"><b>" + esc_(s.item.title) + "</b><br><span style=\"font-size:12px;color:#6b5a49;\">" +
    esc_(s.item.author) + " · " + esc_(s.item.note) + (s.item.sac ? " · SAC " + esc_(s.item.sac) : "") + "</span></td></tr>" +
    rows +
    "</table>" +
    (taxNote ? "<p style=\"margin:6px 0 0;font-size:12px;color:#6b5a49;\">" + esc_(taxNote) + "</p>" : "") +
    (a.saved > 0 ? "<p style=\"margin:10px 0 0;font-size:13px;color:#1c6b43;\">MRP के मुकाबले आपकी बचत: <b>" + inr_(a.saved) + "</b></p>" : "") +
    "</td></tr>" +
    "<tr><td style=\"padding:16px 28px 0;\"><div style=\"background:#f8efdc;border-radius:10px;padding:12px 14px;font-size:13px;line-height:1.7;color:#3a2a1f;\">" +
    "<b>भुगतान का ब्योरा</b><br>साधन: " + pay +
    (s.gateway.paymentId ? "<br>भुगतान संख्या: " + esc_(s.gateway.paymentId) : "") +
    (s.gateway.name ? "<br>गेटवे: " + esc_(s.gateway.name) : "") +
    "<br>स्थिति: " + (s.status === "refunded" ? "रिफ़ंड" : "सफल") + "</div></td></tr>" +
    "<tr><td style=\"padding:16px 28px 0;font-size:12px;line-height:1.7;color:#5b4a3a;\">" +
    "<b>विक्रेता</b><br>" + sellerLine + "<br><br>" +
    "<b>खरीदार</b><br>" + [s.buyer.name, s.buyer.email, s.buyer.phone, s.buyer.state].filter(function (x) { return x; }).map(esc_).join("<br>") +
    "</td></tr>" +
    "<tr><td style=\"padding:18px 28px 26px;font-size:12px;line-height:1.7;color:#6b5a49;\">" +
    "यह कंप्यूटर से बनी रसीद है, हस्ताक्षर की आवश्यकता नहीं। इसे कभी भी देखने के लिए: <a href=\"" + esc_(recUrl) + "\" style=\"color:#8a3b12;\">" + esc_(recUrl) + "</a><br>" +
    "कोई सवाल हो तो इसी ई-मेल का उत्तर दीजिए, या " + esc_(s.seller.email) + " पर लिखिए." +
    "</td></tr></table></td></tr></table></body></html>";

  var text = [
    s.seller.brand,
    kind === "resend" ? "आपकी रसीद" : "भुगतान सफल रहा — धन्यवाद, " + s.buyer.name,
    "",
    s.item.title + " अब आपके खाते (" + s.buyer.email + ") में हमेशा के लिए खुल गई है — कोई और शुल्क नहीं।",
    "पढ़िए: " + readUrl,
    "",
    receiptTitle_(s),
    "इनवॉइस संख्या: " + (s.invoice || "—"),
    "ऑर्डर संख्या: " + s.id,
    "तारीख: " + istStamp_(s.paidAt || s.createdAt),
    "",
  ]
    .concat(
      lines.map(function (l) {
        return l[0] + ": " + l[1];
      })
    )
    .concat([
      taxNote,
      "",
      "भुगतान: " + (s.payment.method ? s.payment.method + (s.payment.detail ? " · " + s.payment.detail : "") : "—"),
      s.gateway.paymentId ? "भुगतान संख्या: " + s.gateway.paymentId : "",
      "",
      "विक्रेता: " + [s.seller.name, s.seller.address, s.seller.state, s.seller.gstin ? "GSTIN " + s.seller.gstin : ""].filter(function (x) { return x; }).join(", "),
      "रसीद देखिए: " + recUrl,
    ])
    .join("\n");

  var subject =
    (kind === "resend" ? "आपकी रसीद" : "आपकी रसीद और किताब") + " — " + s.item.title + (s.invoice ? " (" + s.invoice + ")" : "");
  return { subject: subject, html: html, text: text };
}

/** Has this script been allowed to send mail, and is there quota left today? */
function mailReady_() {
  try {
    return MailApp.getRemainingDailyQuota() > 0;
  } catch (err) {
    return false;
  }
}

function sendMail_(to, subject, html, text) {
  try {
    if (MailApp.getRemainingDailyQuota() < 1) return "quota";
    MailApp.sendEmail({ to: to, subject: subject, htmlBody: html, body: text, name: SELLER.brand, replyTo: SELLER.email });
    return "sent";
  } catch (err) {
    console.error("mail failed: " + err);
    return "failed";
  }
}

function mailReceipt_(s, kind) {
  var m = receiptEmail_(s, kind);
  return sendMail_(s.buyer.email, m.subject, m.html, m.text);
}

/**
 * Run this once from the editor (function list ▸ setupPayments ▸ Run). It asks
 * for the permission to send mail, checks the Razorpay keys and sends you a test
 * receipt — nothing is charged.
 */
function setupPayments() {
  var out = [];
  out.push("INFO  payment provider: " + provider_());
  if (provider_() === "upi") {
    out.push((validVpa_(upiId_()) ? "OK    " : "FIX   ") + "your UPI ID is set (UPI.vpa in the script, or the script property UPI_ID)" + (upiId_() ? ": " + upiId_() : ""));
  } else {
    out.push((prop_("RAZORPAY_KEY_ID") ? "OK    " : "FIX   ") + "script property RAZORPAY_KEY_ID is set" + (paymentsMode_() ? " (" + paymentsMode_() + " mode)" : ""));
    out.push((prop_("RAZORPAY_KEY_SECRET") ? "OK    " : "FIX   ") + "script property RAZORPAY_KEY_SECRET is set");
    if (paymentsReady_()) {
      var r = rzp_("GET", "/orders?count=1");
      out.push((r.ok ? "OK    " : "FIX   ") + "Razorpay accepts these keys (HTTP " + r.status + ")");
    }
  }
  out.push((SELLER.address ? "OK    " : "FIX   ") + "SELLER.address is filled in (it is printed on every receipt)");
  out.push(!GST.enabled || SELLER.gstin ? "OK    GSTIN / GST setting" : "FIX   GST is on but SELLER.gstin is empty — add your GSTIN, or set GST.enabled = false if you are not registered");
  var test = {
    id: "KO-TEST", status: "paid", createdAt: Date.now(), paidAt: Date.now(), invoice: "KC/TEST/000000",
    buyer: { name: "Test", email: ADMIN_EMAIL, phone: "", state: SELLER.state },
    seller: { brand: SELLER.brand, name: SELLER.name, address: SELLER.address, state: SELLER.state, gstin: SELLER.gstin, email: SELLER.email },
    item: { slug: Object.keys(PRICES)[0], title: PRICES[Object.keys(PRICES)[0]].title, author: PRICES[Object.keys(PRICES)[0]].author, sac: GST.sac, qty: 1, note: "ई-बुक · डिजिटल संस्करण · आजीवन पहुँच" },
    amounts: amountsFor_(Object.keys(PRICES)[0], 0, "", SELLER.state),
    payment: { method: "UPI", detail: "te••••@upi", status: "captured" },
    gateway: { name: "Razorpay", orderId: "order_TEST", paymentId: "pay_TEST", mode: paymentsMode_() },
  };
  var res = mailReceipt_(test, "paid");
  out.push((res === "sent" ? "OK    " : "FIX   ") + "a test receipt was mailed to " + ADMIN_EMAIL + " (" + res + ")");
  Logger.log("\n" + out.join("\n"));
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
  out.shop = {
    paywall: PAYWALL,
    payments: paymentsReady_(),
    mode: paymentsMode_(),
    provider: provider_(),
    gst: !!GST.enabled,
    gstin: !!SELLER.gstin,
    address: !!SELLER.address,
  };
  try {
    out.shop.mail = MailApp.getRemainingDailyQuota() > 0;
  } catch (err) {
    out.shop.mail = false; // mail permission not given yet: run setupPayments once
  }
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
