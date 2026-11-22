"use strict";
// Link previews: every private-area address gets its own title, description and picture in the HTML
// (crawlers do not run JavaScript); the public site keeps its own tags; nothing private leaks.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const { PAGES, VIEW_PAGE, previewFor, previewTags, injectPreview, START, END } = require("../previews");
const { createApp } = require("../app");

const tag = (html, attr, name) => {
  const m = new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`).exec(html);
  return m ? m[1] : null;
};

test("each address maps to its page; the desk's workspaces by ?view=; unknown addresses fall back to the dashboard", () => {
  assert.equal(previewFor("/me").key, "dashboard");
  assert.equal(previewFor("/me/").key, "dashboard");
  assert.equal(previewFor("/me/stock-report").key, "stockReport");
  assert.equal(previewFor("/me/stock-report", { view: "journal" }).key, "journal");
  assert.equal(previewFor("/me/stock-report", { view: "analysis" }).name, "Trade Analysis");
  assert.equal(previewFor("/me/stock-report", { view: "account" }).name, "Positions");
  assert.equal(previewFor("/me/stock-report", { view: "nonsense" }).key, "stockReport");
  assert.equal(previewFor("/me/tradeai").name, "TradeAI");
  assert.equal(previewFor("/me/social").name, "Social Media");
  assert.equal(previewFor("/me/ai").name, "AI Model");
  assert.equal(previewFor("/me/no-such-page").key, "dashboard");
  const c = previewFor("/me/chart/sbin");
  assert.equal(c.name, "SBIN — Pro Chart");
  assert.equal(c.path, "/me/chart/SBIN");
  assert.equal(previewFor("/me/chart/%3Cscript%3E").name, "Pro Chart", "a symbol that is not a symbol is left out");
  assert.equal(previewFor("/me/stock-report", { view: "journal", s: "SBIN", token: "x" }).path, "/me/stock-report?view=journal", "nothing else from the query reaches the preview");
  for (const k of Object.values(VIEW_PAGE)) assert.ok(PAGES[k], k);
});

test("the tags: title, description, canonical, Open Graph with a 1200×630 picture, the large X card, noindex — all escaped", () => {
  const t = previewTags(previewFor("/me/stock-report", { view: "journal" }), "https://example.org");
  assert.match(t, /<title>Journal — DrishtiAI<\/title>/);
  assert.equal(tag(t, "property", "og:title"), "Journal — DrishtiAI");
  assert.equal(tag(t, "property", "og:url"), "https://example.org/me/stock-report?view=journal");
  assert.equal(tag(t, "property", "og:image"), "https://example.org/img/og/journal.png");
  assert.equal(tag(t, "property", "og:image:width"), "1200");
  assert.equal(tag(t, "property", "og:image:height"), "630");
  assert.equal(tag(t, "property", "og:site_name"), "DrishtiAI");
  assert.equal(tag(t, "name", "twitter:card"), "summary_large_image");
  assert.equal(tag(t, "name", "robots"), "noindex, nofollow, noarchive");
  assert.match(t, /<link rel="canonical" href="https:\/\/example\.org\/me\/stock-report\?view=journal" \/>/);
  const evil = previewTags({ ...previewFor("/me"), title: 'x"><script>alert(1)</script>' }, "https://example.org");
  assert.ok(!evil.includes("<script>"), "values are escaped");
  for (const p of Object.values(PAGES)) assert.ok(p.description.length <= 200 && p.card.length >= 1, p.name);
});

test("injection swaps the marked block; an older shell without markers gets its title replaced", () => {
  const shell = `<html><head><meta charset="utf-8"/>${START}<title>old</title>${END}</head><body></body></html>`;
  const out = injectPreview(shell, "<title>new</title>");
  assert.match(out, /<title>new<\/title>/);
  assert.ok(!out.includes("old"));
  const older = '<html><head><title>DrishtiAI</title><meta name="robots" content="noindex" /></head></html>';
  const out2 = injectPreview(older, '<title>Desk — DrishtiAI</title>\n<meta name="robots" content="noindex, nofollow, noarchive" />');
  assert.match(out2, /<title>Desk — DrishtiAI<\/title>/);
  assert.equal((out2.match(/name="robots"/g) || []).length, 1, "no duplicated robots tag");
});

test("every page has its picture: a 1200×630 PNG under 300 KB", () => {
  const dir = path.join(__dirname, "..", "..", "public", "img", "og");
  for (const p of Object.values(PAGES)) {
    const f = path.join(dir, `${p.image}.png`);
    assert.ok(fs.existsSync(f), `missing ${p.image}.png`);
    const b = fs.readFileSync(f);
    assert.equal(b.toString("ascii", 1, 4), "PNG", p.image);
    assert.equal(b.readUInt32BE(16), 1200, p.image);
    assert.equal(b.readUInt32BE(20), 630, p.image);
    assert.ok(b.length < 300 * 1024, `${p.image}.png is ${Math.round(b.length / 1024)} KB`);
  }
});

test("served: each /me address carries its own preview with the private headers; / keeps the public site's tags", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-og-"));
  const build = path.join(dir, "build");
  fs.mkdirSync(build);
  fs.writeFileSync(path.join(build, "index.html"), '<!doctype html><html><head><title>Vinay Kumar Tiwari</title><meta property="og:title" content="Vinay Kumar Tiwari — public" /></head><body><div id="root"></div></body></html>');
  fs.writeFileSync(path.join(build, "admin.html"), `<!doctype html><html><head><meta charset="utf-8"/>${START}\n<title>DrishtiAI</title>\n<meta name="robots" content="noindex, nofollow, noarchive" />\n${END}\n</head><body><div id="root"></div></body></html>`);
  const made = createApp({ dataDir: dir, buildDir: build, env: {}, alertWatch: false, socialWatch: false, holidayFetch: async () => { throw new Error("no network in tests"); } });
  const server = await new Promise((r) => {
    const s = made.app.listen(0, "127.0.0.1", () => r(s));
  });
  t.after(() => new Promise((r) => server.close(r)));
  const get = (p, headers = {}) =>
    new Promise((resolve, reject) => {
      http
        .get({ host: "127.0.0.1", port: server.address().port, path: p, headers }, (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
        })
        .on("error", reject);
    });

  let r = await get("/me/stock-report?view=journal", { host: "trade.example.org" });
  assert.equal(r.status, 200);
  assert.match(r.headers["content-type"], /text\/html/);
  assert.equal(r.headers["x-robots-tag"], "noindex, nofollow, noarchive");
  assert.equal(r.headers["cache-control"], "no-store");
  assert.match(r.body, /<title>Journal — DrishtiAI<\/title>/);
  assert.equal(tag(r.body, "property", "og:image"), "https://trade.example.org/img/og/journal.png", "https for a public host, even behind plain-http nginx");
  assert.equal((r.body.match(/<title>/g) || []).length, 1);

  r = await get("/me/social");
  assert.equal(tag(r.body, "property", "og:title"), "Social Media — DrishtiAI");
  assert.match(tag(r.body, "property", "og:image"), /^http:\/\/127\.0\.0\.1:\d+\/img\/og\/social\.png$/, "a development machine keeps http");

  r = await get("/me/somewhere/else");
  assert.equal(tag(r.body, "property", "og:title"), "DrishtiAI");

  r = await get('/me/stock-report?view="><script>x</script>', { host: 'evil"><script>.example' });
  assert.ok(!r.body.includes("<script>x") && !r.body.includes('evil"'), "neither the query nor the Host header can write into the page");
  assert.equal(tag(r.body, "property", "og:title"), "Stock Report — DrishtiAI");

  r = await get("/");
  assert.match(r.body, /<title>Vinay Kumar Tiwari<\/title>/);
  assert.equal(tag(r.body, "property", "og:title"), "Vinay Kumar Tiwari — public", "the public site keeps its own tags");
  assert.ok(!r.body.includes("DrishtiAI"));
});
