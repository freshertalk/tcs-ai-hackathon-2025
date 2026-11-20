"use strict";
// The owner's expense ledger: checked on the way in, kept one record per entry, superadmins only. No network.

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createApp } = require("../app");
const { FileDocs, COLLECTIONS } = require("../docs");
const { Expenses, ExpenseError, clean, GROUPS, CATEGORIES, METHODS, NAME } = require("../expenses");
const { SUPERADMIN_EMAIL } = require("../config");

const NOW = Date.parse("2026-11-20T10:00:00Z"); // 3:30 PM on 20 Nov 2026 in India

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-expenses-"));
  const made = createApp({ dataDir: dir, buildDir: path.join(dir, "no-build"), env: { SETUP_TOKEN: "setup-token-123" }, google: fakeGoogle(), holidayFetch: async () => { throw new Error("no network in tests"); }, flightWatch: false, liveBook: false });
  const server = await new Promise((res) => {
    const s = made.app.listen(0, "127.0.0.1", () => res(s));
  });
  const port = server.address().port;
  const request = (method, url, { cookie, body, csrf = true } = {}) =>
    new Promise((resolve, reject) => {
      const h = {};
      if (cookie) h.cookie = cookie;
      if (csrf && method !== "GET") h["x-requested-with"] = "vpt";
      let payload;
      if (body !== undefined) {
        payload = Buffer.from(JSON.stringify(body));
        h["content-type"] = "application/json";
        h["content-length"] = payload.length;
      }
      const r = http.request({ host: "127.0.0.1", port, method, path: url, headers: h }, (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(text);
          } catch (_) {
            /* not JSON */
          }
          const jar = (res.headers["set-cookie"] || []).map((c) => c.split(";")[0]).filter((c) => !/=$/.test(c)).join("; ");
          resolve({ status: res.statusCode, headers: res.headers, json, text, jar });
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

test("the classification: every category belongs to one of the groups, ids are unique, and the collection is a known one", () => {
  const groups = new Set(GROUPS.map((g) => g.id));
  assert.equal(groups.size, GROUPS.length);
  assert.equal(new Set(CATEGORIES.map((c) => c.id)).size, CATEGORIES.length);
  for (const c of CATEGORIES) assert.ok(groups.has(c.group), c.id);
  // eight groups that carry a colour of their own on the page, and "Other" last
  assert.deepEqual(GROUPS.map((g) => g.id), ["home", "dharma", "food", "family", "life", "health", "travel", "money", "other"]);
  for (const g of GROUPS) assert.ok(CATEGORIES.some((c) => c.group === g.id), `${g.id} has a category`);
  assert.ok(METHODS.some((m) => m.id === "upi") && METHODS.some((m) => m.id === "cash"));
  assert.ok(COLLECTIONS.includes(NAME), "kept one record per entry, and in the backup");
});

test("an entry is checked on the way in: a real day, an amount above zero, a category and a way of paying from the lists", () => {
  const ok = clean({ date: "2026-11-18", amount: "1,250.505", category: "grocery", title: "  Vegetables\n and  milk ", method: "cash", note: "weekly" }, NOW);
  assert.deepEqual(ok, { date: "2026-11-18", amount: 1250.51, category: "grocery", title: "Vegetables and milk", method: "cash", note: "weekly" });
  // what is left out takes the plain default: the category's own name, paid by UPI, no note
  assert.deepEqual(clean({ date: "2026-11-18", amount: 80, category: "ride" }, NOW), { date: "2026-11-18", amount: 80, category: "ride", title: "Cab, auto & metro", method: "upi", note: "" });
  assert.equal(clean({ date: "2026-11-18", amount: "₹ 2,00,000", category: "rent" }, NOW).amount, 200000);
  const bad = (b, re) => assert.throws(() => clean(b, NOW), (e) => e instanceof ExpenseError && re.test(e.message), JSON.stringify(b));
  bad({ amount: 10, category: "rent" }, /Choose the day/);
  bad({ date: "2026-02-30", amount: 10, category: "rent" }, /Choose the day/);
  bad({ date: "18/11/2026", amount: 10, category: "rent" }, /Choose the day/);
  bad({ date: "1999-12-31", amount: 10, category: "rent" }, /too far back/);
  bad({ date: "2028-01-01", amount: 10, category: "rent" }, /more than a year ahead/);
  for (const amount of [0, -5, "", "abc", null, undefined, NaN, Infinity]) bad({ date: "2026-11-18", amount, category: "rent" }, /Enter the amount/);
  bad({ date: "2026-11-18", amount: 2e9, category: "rent" }, /too large/);
  bad({ date: "2026-11-18", amount: 10, category: "yacht" }, /Choose a category/);
  bad({ date: "2026-11-18", amount: 10 }, /Choose a category/);
  bad({ date: "2026-11-18", amount: 10, category: "rent", method: "barter" }, /how it was paid/);
  bad(null, /Choose the day/);
  // long words are cut, not refused
  assert.equal(clean({ date: "2026-11-18", amount: 1, category: "other", title: "x".repeat(300), note: "y".repeat(900) }, NOW).title.length, 120);
  assert.equal(clean({ date: "2026-11-18", amount: 1, category: "other", note: "y".repeat(900) }, NOW).note.length, 500);
  // a bill paid ahead may be entered
  assert.equal(clean({ date: "2027-03-01", amount: 500, category: "insurance" }, NOW).date, "2027-03-01");
});

test("the ledger: added, changed and removed one entry at a time; listed newest day first", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-expenses-"));
  let now = NOW;
  const ex = new Expenses({ docs: new FileDocs(dir), now: () => now });
  assert.deepEqual(ex.list(), []);
  assert.equal(ex.meta().today, "2026-11-20");
  const a = ex.add({ date: "2026-11-10", amount: 500, category: "grocery", title: "DMart" }, "owner@example.com");
  now += 1000;
  const b = ex.add({ date: "2026-11-18", amount: 120, category: "ride" }, "owner@example.com");
  now += 1000;
  const c = ex.add({ date: "2026-11-18", amount: 2100, category: "puja", title: "Rudrabhishek" }, "owner@example.com");
  assert.match(a.id, /^e[a-f0-9]{16}$/);
  assert.deepEqual([a.createdAt, a.by], ["2026-11-20T10:00:00.000Z", "owner@example.com"]);
  // newest day first; on one day the latest entry first
  assert.deepEqual(ex.list().map((x) => x.title), ["Rudrabhishek", "Cab, auto & metro", "DMart"]);

  now += 5000;
  const changed = ex.update(b.id, { date: "2026-11-01", amount: 150, category: "ride", title: "Airport cab", method: "card" }, "partner@example.com");
  assert.deepEqual([changed.id, changed.date, changed.amount, changed.title, changed.method, changed.by], [b.id, "2026-11-01", 150, "Airport cab", "card", "partner@example.com"]);
  assert.equal(changed.createdAt, b.createdAt, "when it was first written does not change");
  assert.notEqual(changed.updatedAt, b.updatedAt);
  assert.deepEqual(ex.list().map((x) => x.title), ["Rudrabhishek", "DMart", "Airport cab"]);
  // a change that is not valid changes nothing
  assert.throws(() => ex.update(a.id, { date: "2026-11-10", amount: 0, category: "grocery" }), /Enter the amount/);
  assert.equal(ex.list().find((x) => x.id === a.id).amount, 500);
  assert.throws(() => ex.update("nope", { date: "2026-11-10", amount: 1, category: "rent" }), (e) => e.status === 404);

  assert.equal(ex.remove(c.id).id, c.id);
  assert.throws(() => ex.remove(c.id), (e) => e.status === 404);
  assert.deepEqual(ex.list().map((x) => x.title), ["DMart", "Airport cab"]);
  // it is in the record store, one record per entry
  assert.equal(new FileDocs(dir).items(NAME).length, 2);
});

/* ------------------------------------------------------------------ over the wire */

test("the ledger is for superadmins only; a superadmin the owner made sees and keeps the same ledger", async (t) => {
  const s = await boot();
  t.after(s.close);
  const owner = await s.login(SUPERADMIN_EMAIL);
  await s.request("POST", "/api/admin/admins", { cookie: owner, body: { email: "helper@example.com", invite: false } });
  await s.request("POST", "/api/admin/admins", { cookie: owner, body: { email: "partner@example.com", role: "superadmin", invite: false } });
  const helper = await s.login("helper@example.com");
  const partner = await s.login("partner@example.com");

  let r = await s.request("POST", "/api/admin/expenses", { cookie: owner, body: { date: "2026-11-18", amount: 1250.5, category: "grocery", title: "Vegetables & milk", method: "cash", note: "weekly" } });
  assert.equal(r.status, 201);
  const first = r.json.item;
  assert.deepEqual([first.date, first.amount, first.category, first.title, first.method, first.note, first.by], ["2026-11-18", 1250.5, "grocery", "Vegetables & milk", "cash", "weekly", SUPERADMIN_EMAIL]);

  for (const [method, url, body] of [
    ["GET", "/api/admin/expenses"],
    ["POST", "/api/admin/expenses", { date: "2026-11-18", amount: 5, category: "snacks" }],
    ["PUT", `/api/admin/expenses/${first.id}`, { date: "2026-11-18", amount: 5, category: "snacks" }],
    ["DELETE", `/api/admin/expenses/${first.id}`],
  ]) {
    assert.equal((await s.request(method, url, { body })).status, 401, `${method} ${url} without a session`);
    const asAdmin = await s.request(method, url, { cookie: helper, body });
    assert.equal(asAdmin.status, 403, `${method} ${url} as an admin`);
    assert.equal(asAdmin.text.includes("Vegetables"), false);
  }
  assert.equal((await s.request("DELETE", `/api/admin/expenses/${first.id}`, { cookie: owner, csrf: false })).status, 403, "a change needs the request header");

  // the page's one read: the entries and the lists it classifies by
  r = await s.request("GET", "/api/admin/expenses", { cookie: partner });
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.items.length, r.json.items[0].title], [1, "Vegetables & milk"]);
  assert.deepEqual([r.json.groups.length, r.json.categories.length, r.json.methods.length], [GROUPS.length, CATEGORIES.length, METHODS.length]);
  assert.match(r.json.today, /^\d{4}-\d{2}-\d{2}$/);

  // what is wrong is said in words, and nothing is kept
  r = await s.request("POST", "/api/admin/expenses", { cookie: owner, body: { date: "2026-11-18", amount: -4, category: "grocery" } });
  assert.deepEqual([r.status, r.json.message], [400, "Enter the amount, above zero."]);
  r = await s.request("POST", "/api/admin/expenses", { cookie: owner, body: { date: "2026-11-18", amount: 40, category: "nope" } });
  assert.deepEqual([r.status, r.json.message], [400, "Choose a category."]);

  // changed by the other superadmin, removed by the owner
  r = await s.request("PUT", `/api/admin/expenses/${first.id}`, { cookie: partner, body: { date: "2026-11-17", amount: 1300, category: "grocery", title: "Vegetables, milk & fruit", method: "upi" } });
  assert.deepEqual([r.status, r.json.item.amount, r.json.item.date, r.json.item.by], [200, 1300, "2026-11-17", "partner@example.com"]);
  assert.equal((await s.request("PUT", "/api/admin/expenses/nope", { cookie: owner, body: { date: "2026-11-17", amount: 1, category: "rent" } })).status, 404);
  r = await s.request("DELETE", `/api/admin/expenses/${first.id}`, { cookie: owner });
  assert.deepEqual([r.status, r.json.removed], [200, first.id]);
  assert.equal((await s.request("DELETE", `/api/admin/expenses/${first.id}`, { cookie: owner })).status, 404);
  assert.equal((await s.request("GET", "/api/admin/expenses", { cookie: owner })).json.items.length, 0);
});
