"use strict";
// The owner's Kundali: his chart and the papers behind it, for superadmins only. No network, no real Google.

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createApp } = require("../app");
const { FileDocs } = require("../docs");
const { Kundali, KundaliError, sniff, chartProblem, NAME } = require("../kundali");
const { SUPERADMIN_EMAIL } = require("../config");

const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1"), Buffer.alloc(4000, 0x20), Buffer.from("\n%%EOF\n")]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]);
// a made-up chart (nobody's): only its shape matters here
const chart = () => ({
  version: 1,
  person: { name: "परीक्षण" },
  birth: { date: "2000-01-01", time: "06:00", place: "कहीं" },
  lagna: { sign: 5, deg: "10°00′" },
  planets: ["su", "mo", "ma", "me", "ju", "ve", "sa", "ra", "ke"].map((id, i) => ({ id, sign: (i % 12) + 1, deg: "01°00′" })),
  analysis: [{ id: "saar", title: "सार", paras: ["यह केवल परीक्षण है।"] }],
});

function fakeGoogle() {
  let lastNonce = "";
  return () => ({
    authUrl: ({ state, nonce }) => {
      lastNonce = nonce;
      return `https://accounts.google.com/fake?state=${state}`;
    },
    exchange: async (code) => ({ email: code, emailVerified: true, name: "Test Person", picture: "", nonce: lastNonce }),
  });
}

async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-kundali-"));
  const made = createApp({ dataDir: dir, buildDir: path.join(dir, "no-build"), env: { SETUP_TOKEN: "setup-token-123" }, google: fakeGoogle(), holidayFetch: async () => { throw new Error("no network in tests"); }, flightWatch: false, liveBook: false });
  const server = await new Promise((res) => {
    const s = made.app.listen(0, "127.0.0.1", () => res(s));
  });
  const port = server.address().port;
  /** body: an object (sent as JSON) or a Buffer (sent as it is, as a file's bytes are). */
  const request = (method, url, { cookie, body, csrf = true } = {}) =>
    new Promise((resolve, reject) => {
      const h = {};
      if (cookie) h.cookie = cookie;
      if (csrf && method !== "GET") h["x-requested-with"] = "vpt";
      let payload;
      if (Buffer.isBuffer(body)) {
        payload = body;
        h["content-type"] = "application/octet-stream";
      } else if (body !== undefined) {
        payload = Buffer.from(JSON.stringify(body));
        h["content-type"] = "application/json";
      }
      if (payload) h["content-length"] = payload.length;
      const r = http.request({ host: "127.0.0.1", port, method, path: url, headers: h }, (res) => {
        const parts = [];
        res.on("data", (c) => parts.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(parts);
          let json = null;
          try {
            json = JSON.parse(raw.toString("utf8"));
          } catch (_) {
            /* not JSON */
          }
          const jar = (res.headers["set-cookie"] || []).map((c) => c.split(";")[0]).filter((c) => !/=$/.test(c)).join("; ");
          resolve({ status: res.statusCode, headers: res.headers, json, raw, jar });
        });
      });
      r.on("error", reject);
      if (payload) r.write(payload);
      r.end();
    });
  const login = async (email) => {
    const start = await request("GET", "/api/auth/google/start");
    const state = new URL(start.headers.location).searchParams.get("state");
    return (await request("GET", `/api/auth/google/callback?state=${state}&code=${encodeURIComponent(email)}`, { cookie: start.jar })).jar;
  };
  await request("POST", "/api/setup", { body: { token: "setup-token-123", googleClientId: "1234567890-abcdefgh.apps.googleusercontent.com", googleClientSecret: "GOCSPX-super-secret-value" } });
  return { dir, made, request, login, close: () => new Promise((r) => server.close(r)) };
}

/* ------------------------------------------------------------------ the rules */

test("a paper is known by its first bytes, and a chart by its shape", () => {
  assert.equal(sniff(PDF), "application/pdf");
  assert.equal(sniff(PNG), "image/png");
  assert.equal(sniff(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)])), "image/jpeg");
  assert.equal(sniff(Buffer.from("<html><script>alert(1)</script></html>")), "");
  assert.equal(sniff(Buffer.from("MZ\x90\x00 an executable, renamed .pdf")), "");
  assert.equal(chartProblem(chart()), "");
  assert.match(chartProblem(null), /not a Kundali chart/);
  assert.match(chartProblem([1, 2]), /not a Kundali chart/);
  assert.match(chartProblem({ ...chart(), birth: undefined }), /no birth details/);
  assert.match(chartProblem({ ...chart(), lagna: { sign: 13 } }), /no ascendant/);
  assert.match(chartProblem({ ...chart(), planets: [] }), /no planets/);
  assert.match(chartProblem({ ...chart(), planets: chart().planets.map((p, i) => (i === 3 ? { id: "me" } : p)) }), /has no sign/);
});

test("the store: the chart is one private record; a paper is checked, kept beside the media and listed without its place on the disk", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-kundali-"));
  const docs = new FileDocs(dir);
  const k = new Kundali({ docs, dir, now: () => Date.parse("2026-11-20T10:00:00Z") });
  assert.deepEqual([k.view().chart, k.view().documents], [null, []]);
  assert.equal(k.chartFile(), null);

  // the chart: as an object, or as the bytes of its file (a byte-order mark and all)
  assert.equal(k.setChart(chart(), "owner@example.com").chart.lagna.sign, 5);
  const viaFile = k.setChart(Buffer.from(`﻿${JSON.stringify({ ...chart(), version: 2 })}`), "owner@example.com");
  assert.deepEqual([viaFile.chart.version, viaFile.chartAt, viaFile.chartBy], [2, "2026-11-20T10:00:00.000Z", "owner@example.com"]);
  assert.throws(() => k.setChart(Buffer.from("not json")), (e) => e instanceof KundaliError && /not JSON/.test(e.message));
  assert.throws(() => k.setChart({ hello: "world" }), /no birth details/);
  assert.throws(() => k.setChart(Buffer.alloc(700 * 1024, 0x20)), /larger than 600 KB/);
  assert.equal(k.view().chart.version, 2, "a refused file leaves the chart that was there");
  const file = k.chartFile();
  assert.equal(file.name, "kundali-chart.json");
  assert.equal(JSON.parse(file.body.toString("utf8")).person.name, "परीक्षण");
  // it is the record store's (so it is in the backup), under its own name
  assert.equal(docs.read(NAME).chart.version, 2);

  // a paper, in two parts
  const id = "a".repeat(16);
  assert.deepEqual(k.part({ id, part: 0, of: 2, name: "Brihat Horoscope (72).pdf", buf: PDF.slice(0, 2000) }, "owner@example.com"), { received: 1, of: 2 });
  const done = k.part({ id, part: 1, of: 2, name: "Brihat Horoscope (72).pdf", buf: PDF.slice(2000) }, "owner@example.com");
  assert.equal(done.done, true);
  assert.deepEqual([done.item.label, done.item.kind, done.item.mime, done.item.size, done.item.by], ["Brihat Horoscope (72)", "pdf", "application/pdf", PDF.length, "owner@example.com"]);
  assert.equal(JSON.stringify(k.view()).includes(dir), false, "the page is never told where the file is");
  assert.equal(done.item.fileName, undefined);
  const kept = k.file(done.item.id);
  assert.deepEqual([kept.mime, kept.name, fs.readFileSync(kept.file).equals(PDF)], ["application/pdf", "Brihat Horoscope (72).pdf", true]);
  assert.match(path.basename(kept.file), /^kundali-[a-f0-9]{12}\.pdf$/);
  assert.equal(path.basename(path.dirname(kept.file)), "media");

  // a Hindi name is kept; a picture is a paper too; a whole file already on this machine can be put in place
  const pngFile = path.join(dir, "scan.png");
  fs.writeFileSync(pngFile, PNG);
  const pic = k.addFile(pngFile, "जन्म पत्रिका (हस्तलिखित).png", "owner@example.com");
  assert.deepEqual([pic.item.label, pic.item.kind], ["जन्म पत्रिका (हस्तलिखित)", "image"]);
  assert.equal(k.rename(pic.item.id, "  दादाजी की लिखी पत्रिका  ").documents[1].label, "दादाजी की लिखी पत्रिका");
  assert.throws(() => k.rename(pic.item.id, "   "), /Give it a name/);
  assert.throws(() => k.rename("nope", "x"), (e) => e.status === 404);

  // what is not a paper is refused before a byte of it is kept
  assert.throws(() => k.part({ id: "b".repeat(16), part: 0, of: 1, name: "page.pdf", buf: Buffer.from("<html><script>alert(1)</script></html>") }), /not a PDF or a picture/);
  assert.throws(() => k.part({ id: "../../etc/passwd", part: 0, of: 1, name: "x.pdf", buf: PDF }), /Missing upload id/);
  assert.throws(() => k.part({ id: "c".repeat(16), part: 1, of: 2, name: "x.pdf", buf: PDF }), /interrupted/);
  assert.throws(() => k.part({ id: "c".repeat(16), part: 0, of: 1, name: "x.pdf", buf: Buffer.alloc(3 * 1024 * 1024, 1) }), /at most 2\.5 MB/);
  assert.equal(fs.readdirSync(path.join(dir, "media")).filter((f) => /\.part$/.test(f)).length, 0, "nothing half-uploaded is left behind");
  assert.equal(k.view().documents.length, 2);

  // removed: gone from the list and from the disk; the chart is untouched
  const after = k.remove(done.item.id);
  assert.deepEqual(after.documents.map((d) => d.label), ["दादाजी की लिखी पत्रिका"]);
  assert.equal(fs.existsSync(kept.file), false);
  assert.equal(k.file(done.item.id), null);
  assert.equal(after.chart.version, 2);
  assert.equal(k.removeChart().chart, null);
  assert.equal(k.view().documents.length, 1);
});

/* ------------------------------------------------------------------ over the wire */

test("the Kundali is for superadmins only: an admin and a visitor are refused on every route; a superadmin the owner made is let in", async (t) => {
  const s = await boot();
  t.after(s.close);
  const owner = await s.login(SUPERADMIN_EMAIL);
  await s.request("POST", "/api/admin/admins", { cookie: owner, body: { email: "helper@example.com", invite: false } });
  await s.request("POST", "/api/admin/admins", { cookie: owner, body: { email: "partner@example.com", role: "superadmin", invite: false } });
  const helper = await s.login("helper@example.com");
  const partner = await s.login("partner@example.com");

  // the owner puts the chart and a paper in place
  let r = await s.request("PUT", "/api/admin/kundali/chart", { cookie: owner, body: Buffer.from(JSON.stringify(chart())) });
  assert.equal(r.status, 200);
  assert.equal(r.json.chart.person.name, "परीक्षण");
  const up = await s.request("POST", `/api/admin/kundali/upload?id=${"d".repeat(16)}&part=0&of=1&name=${encodeURIComponent("Brihat Horoscope (72).pdf")}`, { cookie: owner, body: PDF });
  assert.equal(up.status, 200);
  assert.equal(up.json.done, true);
  const docId = up.json.item.id;

  const routes = [
    ["GET", "/api/admin/kundali"],
    ["PUT", "/api/admin/kundali/chart", Buffer.from(JSON.stringify(chart()))],
    ["DELETE", "/api/admin/kundali/chart"],
    ["GET", "/api/admin/kundali/chart/export"],
    ["POST", `/api/admin/kundali/upload?id=${"e".repeat(16)}&part=0&of=1&name=x.pdf`, PDF],
    ["PUT", `/api/admin/kundali/documents/${docId}`, { label: "x" }],
    ["DELETE", `/api/admin/kundali/documents/${docId}`],
    ["GET", `/api/admin/kundali/documents/${docId}`],
    ["GET", `/api/admin/kundali/documents/${docId}?download=1`],
  ];
  for (const [method, url, body] of routes) {
    assert.equal((await s.request(method, url, { body })).status, 401, `${method} ${url} without a session`);
    const asAdmin = await s.request(method, url, { cookie: helper, body });
    assert.equal(asAdmin.status, 403, `${method} ${url} as an admin`);
    assert.equal(asAdmin.raw.includes("परीक्षण") || asAdmin.raw.includes("%PDF"), false);
  }
  // a change without the request header is refused, as everywhere
  assert.equal((await s.request("DELETE", "/api/admin/kundali/chart", { cookie: owner, csrf: false })).status, 403);

  // nothing was changed by the refused calls
  r = await s.request("GET", "/api/admin/kundali", { cookie: partner });
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.chart.lagna.sign, r.json.documents.length, r.json.documents[0].label], [5, 1, "Brihat Horoscope (72)"]);

  // the paper: shown in the browser, or kept as a file — never cached, never guessed at as another type
  const shown = await s.request("GET", `/api/admin/kundali/documents/${docId}`, { cookie: partner });
  assert.equal(shown.status, 200);
  assert.equal(shown.raw.equals(PDF), true);
  assert.match(shown.headers["content-type"], /^application\/pdf/);
  assert.match(shown.headers["content-disposition"], /^inline; filename="Brihat Horoscope \(72\)\.pdf"/);
  assert.equal(shown.headers["x-content-type-options"], "nosniff");
  assert.match(shown.headers["cache-control"], /no-store/);
  const saved = await s.request("GET", `/api/admin/kundali/documents/${docId}?download=1`, { cookie: owner });
  assert.match(saved.headers["content-disposition"], /^attachment; filename="Brihat Horoscope \(72\)\.pdf"/);
  assert.equal(saved.raw.equals(PDF), true);
  assert.equal((await s.request("GET", "/api/admin/kundali/documents/nope", { cookie: owner })).status, 404);

  // the chart as a file, to carry to another server
  const exported = await s.request("GET", "/api/admin/kundali/chart/export", { cookie: owner });
  assert.match(exported.headers["content-disposition"], /attachment; filename="kundali-chart\.json"/);
  assert.equal(JSON.parse(exported.raw.toString("utf8")).analysis[0].title, "सार");
  // … and what is not a chart is refused in words
  r = await s.request("PUT", "/api/admin/kundali/chart", { cookie: owner, body: Buffer.from('{"hello":"world"}') });
  assert.deepEqual([r.status, r.json.message], [400, "The chart has no birth details."]);
  r = await s.request("POST", `/api/admin/kundali/upload?id=${"f".repeat(16)}&part=0&of=1&name=evil.pdf`, { cookie: owner, body: Buffer.from("<html><script>alert(1)</script></html>") });
  assert.deepEqual([r.status, r.json.message], [400, "That file is not a PDF or a picture (JPEG, PNG or WEBP)."]);

  // renamed, removed; and every step is in the trail
  r = await s.request("PUT", `/api/admin/kundali/documents/${docId}`, { cookie: owner, body: { label: "बृहत् कुंडली" } });
  assert.equal(r.json.documents[0].label, "बृहत् कुंडली");
  const hindi = await s.request("GET", `/api/admin/kundali/documents/${docId}?download=1`, { cookie: owner });
  assert.match(hindi.headers["content-disposition"], /filename\*=UTF-8''%E0%A4%AC/);
  r = await s.request("DELETE", `/api/admin/kundali/documents/${docId}`, { cookie: owner });
  assert.equal(r.json.documents.length, 0);
  assert.equal((await s.request("DELETE", "/api/admin/kundali/chart", { cookie: owner })).json.chart, null);
  assert.equal((await s.request("GET", "/api/admin/kundali/chart/export", { cookie: owner })).status, 404);
  const types = (await s.request("GET", "/api/admin/auth/audit?limit=300", { cookie: owner })).json.entries.map((e) => e.type);
  for (const k of ["kundali_chart_saved", "kundali_paper_added", "kundali_paper_downloaded", "kundali_chart_exported", "kundali_paper_removed", "kundali_chart_removed"]) assert.ok(types.includes(k), k);

  // an admin who is made a superadmin sees it; made an admin again, it closes at once
  await s.request("PUT", "/api/admin/kundali/chart", { cookie: owner, body: Buffer.from(JSON.stringify(chart())) });
  await s.request("PUT", "/api/admin/admins/helper%40example.com", { cookie: owner, body: { role: "superadmin" } });
  assert.equal((await s.request("GET", "/api/admin/kundali", { cookie: helper })).status, 200);
  await s.request("PUT", "/api/admin/admins/helper%40example.com", { cookie: owner, body: { role: "admin" } });
  assert.equal((await s.request("GET", "/api/admin/kundali", { cookie: helper })).status, 403);
});
