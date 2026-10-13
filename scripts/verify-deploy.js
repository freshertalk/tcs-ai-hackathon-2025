// Checks a deployed copy of the site against the build folder it should be.
//
//   node scripts/verify-deploy.js                       # https://vinaytiwari.org
//   node scripts/verify-deploy.js https://example.org
//
// It changes nothing and sends nothing private: it only reads public files.
// Exit code 1 when a check fails (warnings do not fail).

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const BUILD = path.join(ROOT, "build");
const base = (process.argv[2] || "https://vinaytiwari.org").replace(/\/+$/, "");
const SLUG = "do-kulhad-chai";

const out = [];
let failed = 0;
const pass = (m) => out.push(`PASS  ${m}`);
const warn = (m) => out.push(`WARN  ${m}`);
const fail = (m) => {
  failed++;
  out.push(`FAIL  ${m}`);
};

async function get(url, opts) {
  try {
    const res = await fetch(url, { redirect: "manual", ...opts });
    return { res, text: opts && opts.binary ? null : await res.text() };
  } catch (e) {
    return { res: null, text: "", error: e.message };
  }
}

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);

(async () => {
  if (!fs.existsSync(path.join(BUILD, "index.html"))) {
    console.log("No build folder here. Run `npm run build` first.");
    process.exit(1);
  }
  const localHtml = fs.readFileSync(path.join(BUILD, "index.html"), "utf8");
  const localMain = (/static\/js\/(main\.[a-f0-9]+\.js)/.exec(localHtml) || [])[1];
  const localBook = JSON.parse(fs.readFileSync(path.join(BUILD, "content", SLUG, "book.json"), "utf8"));

  console.log(`Checking ${base}\n`);

  /* 1. is it this build? */
  const home = await get(base + "/");
  if (!home.res) return done(`could not reach ${base}: ${home.error}`);
  const liveMain = (/static\/js\/(main\.[a-f0-9]+\.js)/.exec(home.text) || [])[1];
  if (liveMain && liveMain === localMain) pass(`serving this build (${localMain})`);
  else fail(`serving ${liveMain || "an unknown page"}, the build here is ${localMain} — upload the whole build/ folder`);

  /* 2. the encrypted edition */
  const bk = await get(`${base}/content/${SLUG}/book.json`);
  let liveBook = null;
  try {
    liveBook = JSON.parse(bk.text);
  } catch {
    /* not JSON */
  }
  if (!liveBook) fail(`/content/${SLUG}/book.json is not there (the server answers with a web page) — the content/ folder was not uploaded`);
  else {
    if (liveBook.version === localBook.version) pass(`book edition ${liveBook.version} matches the build`);
    else fail(`book edition on the server is ${liveBook.version}, the build is ${localBook.version}`);
    if (liveBook.enc) pass("chapters are marked encrypted");
    else fail("book.json has no `enc` marker: plain chapters are being served");
  }

  /* 3. one chapter, byte for byte, and not readable */
  const localCh = fs.readFileSync(path.join(BUILD, "content", SLUG, "chapters", "ch01.dat"), "utf8");
  const ch = await get(`${base}/content/${SLUG}/chapters/ch01.dat?v=${localBook.version}`);
  if (ch.res && ch.res.status === 200 && ch.text === localCh) pass("chapter ch01 is identical to the build");
  else if (ch.res && /<!doctype html/i.test(ch.text || "")) fail("ch01.dat is answered with a web page, not the chapter file");
  else fail("ch01.dat differs from the build");
  if (ch.text && !/<!doctype html/i.test(ch.text) && /[ऀ-ॿ]/.test(ch.text)) fail("a chapter file contains readable Hindi — it is not encrypted");

  /* 4. pages */
  for (const p of [`/read/${SLUG}/cover`, `/read/${SLUG}/ch09`, "/terms", "/privacy", "/refund", `/books/${SLUG}`]) {
    const r = await get(base + p);
    const ok = r.res && r.res.status === 200 && /<div id="root"/.test(r.text || "");
    if (ok) pass(`${p} opens`);
    else fail(`${p} → ${r.res ? r.res.status : "unreachable"} (the single-page fallback is missing?)`);
  }

  /* 5. caching: nginx ignores public/_headers, so these come from its own config */
  const cc = home.res.headers.get("cache-control");
  if (cc && /no-cache|max-age=0|no-store|must-revalidate/i.test(cc)) pass(`index.html is revalidated (${cc})`);
  else warn("index.html has no revalidation header: a browser may keep an old page for days after an upload (see deploy/nginx.example.conf)");
  const st = liveMain ? await get(`${base}/static/js/${liveMain}`, { method: "HEAD" }) : null;
  if (st && st.res && /immutable|max-age=\d{6,}/.test(st.res.headers.get("cache-control") || "")) pass("hashed assets are cached long");
  else warn("hashed files under /static are not cached long (harmless, only slower)");

  /* 6. the collector */
  const books = fs.readFileSync(path.join(ROOT, "src", "data", "books.js"), "utf8");
  const ep = (/https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec/.exec(books) || [])[0];
  if (ep) {
    const h = await get(ep + "?check=1", { redirect: "follow" }); // Apps Script answers via a redirect
    let j = null;
    try {
      j = JSON.parse(h.text);
    } catch {
      /* not JSON */
    }
    if (j && j.build) {
      pass(`collector script is "${j.build}" (V8 ${j.v8 ? "on" : "OFF"}, Keys tab ${j.keysTab ? "ok" : "MISSING"}, signature check ${j.signatureCheck ? "ok" : "FAILED"})`);
      if (!j.v8 || !j.keysTab || !j.signatureCheck) fail("the collector reports a problem — see the line above");
      if (!j.analytics) fail("the collector script predates the dashboards (no statistics, coupons or audit log): paste the newest scripts/reviews-apps-script.gs and deploy it as a New version");
      if (j.analytics && !j.shop) fail("the collector script predates the shop (cart, orders, receipts): paste the newest scripts/reviews-apps-script.gs and deploy it as a New version");
      if (j.shop) {
        if (j.shop.paywall && !j.shop.payments) warn("the paywall is on but the Razorpay keys are not set in the script properties: nobody can buy yet (Project Settings → Script properties: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET)");
        else if (j.shop.payments) pass(`payments are set up (${j.shop.mode} mode)${j.shop.mode === "test" ? " — remember to swap in the live keys" : ""}`);
        if (!j.shop.paywall) warn("PAYWALL is off in the script: any signed-in reader can read without buying");
        if (j.shop.payments && !j.shop.mail) warn("the script cannot send mail yet: run setupPayments once in the editor and accept the permission, or receipts will not be e-mailed");
        if (j.shop.gst && !j.shop.gstin) warn("GST is on in the script but SELLER.gstin is empty: add your GSTIN, or set GST.enabled = false if you are not registered");
        if (!j.shop.address) warn("SELLER.address is empty in the script: receipts print without a seller address");
      }
      const want = (fs.readFileSync(path.join(ROOT, "src", "data", "legal.js"), "utf8").match(/version: "([^"]+)"/) || [])[1];
      if (want && j.legal && j.legal !== want) fail(`documents edition in the script is ${j.legal} but the site has ${want}: set LEGAL_VERSION in the script to ${want}`);
      else if (want) pass(`documents edition ${want} agrees between the site and the script`);
    } else fail("the collector has no ?check=1 answer: deploy the newest scripts/reviews-apps-script.gs as a New version");
  } else warn("no collector address found in src/data/books.js");

  /* 7. Google sign-in origin: Google gives no reliable way to ask, so this is a reminder */
  out.push(
    `NOTE  Google: ${new URL(base).origin} must be listed under Authorised JavaScript origins of your Web client ID (cannot be checked from here)`
  );

  /* 8. www and the plain address are two different origins for sign-in */
  const u = new URL(base);
  if (u.hostname === "vinaytiwari.org") {
    const w = await get("https://www.vinaytiwari.org/");
    if (w.res && w.res.status >= 300 && w.res.status < 400) pass("www redirects to the plain address (one sign-in origin)");
    else if (w.res && w.res.status === 200) warn("www serves the site itself: a reader there signs in separately, and https://www.vinaytiwari.org must also be an Authorised JavaScript origin (or redirect www to the plain address)");
  }

  done();

  function done(extra) {
    if (extra) fail(extra);
    console.log(out.join("\n"));
    console.log(`\n${failed ? failed + " check(s) FAILED" : "All checks passed"}${out.some((l) => l.startsWith("WARN")) ? " (with warnings)" : ""}.`);
    process.exit(failed ? 1 : 0);
  }
})();
