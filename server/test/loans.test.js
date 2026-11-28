"use strict";
// The loan book (server/loans.js): monthly rows made by themselves, "Is paid?" taking the EMI off the outstanding, terms
// changed without rewriting the past, soft removal, and the routes being the superadmins' only. Made-up figures.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const { createApp } = require("../app");
const { FileDocs } = require("../docs");
const { SUPERADMIN_EMAIL } = require("../config");
const { Loans, LoanError, cleanLoan, payoff, dateIn, NAME, AUTO } = require("../loans");

const AT = Date.parse("2026-11-28T10:00:00+05:30");
const terms = (extra = {}) => ({ name: "Test car loan", kind: "car", openingDate: "2026-08-20", totalAmount: "5,00,000", rate: "9", emiAmount: 12000, firstEmiDate: "2026-09-05", ...extra });
const make = (clock = { now: AT }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-loans-"));
  return { dir, clock, loans: new Loans({ docs: new FileDocs(dir), now: () => clock.now, log: { error() {} } }) };
};
const only = (v) => v.loans[0];

test("what is typed is checked, in words", () => {
  const bad = [
    [{ name: "" }, /name/],
    [{ openingDate: "2026-02-30" }, /opened/],
    [{ totalAmount: "" }, /total loan amount/],
    [{ totalAmount: -5 }, /total loan amount/],
    [{ rate: 120 }, /rate/],
    [{ rate: "" }, /rate/],
    [{ emiAmount: 0 }, /EMI amount/],
    [{ firstEmiDate: "2026-08-01" }, /before the day/],
    [{ emiDay: 40 }, /1 to 31/],
    [{ method: "nope" }, /how a paid EMI/],
  ];
  for (const [change, words] of bad) assert.throws(() => cleanLoan(terms(change), AT), (e) => e instanceof LoanError && words.test(e.message), JSON.stringify(change));
  const ok = cleanLoan(terms(), AT);
  assert.deepEqual([ok.totalAmount, ok.startBalance, ok.emiDay, ok.method, ok.rate], [500000, 500000, 5, "principal", 9]);
});

test("a short month takes its last day, and interest alone is never paid off", () => {
  assert.equal(dateIn("2027-02", 31), "2027-02-28");
  assert.equal(dateIn("2028-02", 30), "2028-02-29");
  assert.equal(payoff(100000, 12, 1000), null, "the EMI only covers the month's interest");
  assert.equal(payoff(1000, 0, 500).count, 2);
});

test("each month's row is made by itself up to the running month, with the loan's latest figures", () => {
  const { loans, clock } = make();
  loans.add(terms(), "me@example.com");
  let l = only(loans.view());
  assert.deepEqual(l.rows.map((r) => [r.month, r.date, r.emi, r.rate, r.paid, r.outstanding]), [
    ["2026-09", "2026-09-05", 12000, 9, false, 500000],
    ["2026-10", "2026-10-05", 12000, 9, false, 500000],
    ["2026-11", "2026-11-05", 12000, 9, false, 500000],
  ]);
  assert.equal(l.summary.overdueCount, 3);
  // a new month begins: its row appears without anybody doing anything, and is kept in the database
  clock.now = Date.parse("2026-12-01T00:05:00+05:30");
  assert.equal(loans.catchUp(), 1);
  assert.equal(loans.catchUp(), 0, "only once");
  l = only(loans.view());
  assert.equal(l.rows.length, 4);
  assert.equal(l.rows[3].month, "2026-12");
  assert.equal(l.history[0].by, AUTO);
  assert.equal(loans.docs.items(NAME)[0].months.length, 4);
});

test("with the whole-EMI rule chosen, ticking Is paid? takes the EMI off the outstanding, unticking puts it back, and the save is stamped", () => {
  const { loans, clock } = make();
  const id = loans.add(terms({ method: "emi" }), "me@example.com");
  clock.now += 60000;
  loans.setMonth(id, "2026-10", { paid: true }, "me@example.com");
  let v = loans.view();
  assert.deepEqual(only(v).rows.map((r) => r.outstanding), [500000, 488000, 488000]);
  assert.equal(only(v).summary.outstanding, 488000);
  assert.equal(v.totals.outstanding, 488000);
  assert.equal(v.saved.last.what, "Oct 2026: EMI marked paid");
  assert.equal(v.saved.last.by, "me@example.com");
  assert.equal(v.saved.last.at, new Date(clock.now).toISOString());
  assert.equal(only(v).rows[1].paidAt, v.saved.last.at);
  loans.setMonth(id, "2026-10", { paid: false }, "me@example.com");
  v = loans.view();
  assert.equal(only(v).summary.outstanding, 500000);
  assert.equal(only(v).rows[1].paidAt, null);
});

test("principal only takes the EMI less a month's interest; a part-payment and the bank's figure are honoured", () => {
  const { loans } = make();
  const id = loans.add(terms({ method: "principal" }), "me@example.com");
  loans.setMonth(id, "2026-09", { paid: true }, "me");
  assert.equal(only(loans.view()).summary.outstanding, 500000 - (12000 - 3750));
  loans.setMonth(id, "2026-10", { paid: true, extra: "10000" }, "me");
  const after = only(loans.view()).rows[1].outstanding;
  assert.equal(after, Math.round((491750 - (12000 - (491750 * 9) / 1200) - 10000) * 100) / 100);
  loans.setMonth(id, "2026-10", { bankBalance: 470000 }, "me");
  assert.deepEqual(only(loans.view()).rows.slice(1).map((r) => r.outstanding), [470000, 470000]);
  loans.setMonth(id, "2026-10", { bankBalance: "" }, "me");
  assert.equal(only(loans.view()).rows[1].outstanding, after, "cleared: worked out again");
});

test("new terms reach this month onwards; paid and earlier months keep theirs", () => {
  const { loans, clock } = make();
  const id = loans.add(terms(), "me");
  loans.setMonth(id, "2026-09", { paid: true }, "me");
  loans.update(id, terms({ rate: 8.5, emiAmount: 12500, emiDay: 10, remarks: "rate cut" }), "me");
  let l = only(loans.view());
  assert.deepEqual(l.rows.map((r) => [r.emi, r.rate, r.date]), [
    [12000, 9, "2026-09-05"],
    [12000, 9, "2026-10-05"],
    [12500, 8.5, "2026-11-10"],
  ]);
  clock.now = Date.parse("2026-12-02T09:00:00+05:30");
  l = only(loans.view());
  assert.deepEqual([l.rows[3].emi, l.rows[3].rate, l.rows[3].date], [12500, 8.5, "2026-12-10"]);
  assert.throws(() => loans.update(id, terms({ firstEmiDate: "2026-10-05" }), "me"), /marked paid/);
});

test("paid up to a month; no rows once nothing is owed; the totals and the month", () => {
  const { loans, clock } = make();
  const id = loans.add(terms({ totalAmount: 30000, emiAmount: 12000, rate: 0, method: "emi" }), "me");
  assert.equal(loans.paidUpTo(id, "2026-11", "me"), 3);
  let v = loans.view();
  assert.deepEqual(only(v).rows.map((r) => [r.reduced, r.outstanding]), [[12000, 18000], [12000, 6000], [6000, 0]]);
  assert.equal(only(v).summary.closed, true);
  assert.equal(v.totals.active, 0);
  clock.now = Date.parse("2027-02-01T09:00:00+05:30");
  assert.equal(only(loans.view()).rows.length, 3, "a cleared loan gains no rows");
  assert.throws(() => loans.paidUpTo(id, "2027-02", "me"), /already marked paid/);

  const other = make();
  other.loans.add(terms(), "me");
  other.loans.add(terms({ name: "Second", totalAmount: 100000, emiAmount: 5000, firstEmiDate: "2026-11-30", openingDate: "2026-11-01" }), "me");
  v = other.loans.view();
  assert.deepEqual([v.totals.month.count, v.totals.month.amount, v.totals.emiPerMonth, v.totals.overdueCount, v.totals.borrowed], [2, 17000, 17000, 3, 600000]);
  assert.equal(v.totals.next.date, "2026-09-05", "the oldest unpaid is the next to pay");
});

test("a removed loan leaves the page but stays in the database, and can come back", () => {
  const { loans } = make();
  const id = loans.add(terms(), "me");
  loans.remove(id, "me");
  let v = loans.view();
  assert.deepEqual([v.loans.length, v.removed.length, v.totals.outstanding, v.saved.last.what], [0, 1, 0, "Loan removed"]);
  assert.equal(loans.docs.items(NAME).length, 1);
  assert.throws(() => loans.setMonth(id, "2026-10", { paid: true }, "me"), /no longer there/);
  loans.restore(id, "me");
  assert.equal(loans.view().loans.length, 1);
});

test("the routes are the superadmins' only, need the request header, and answer with the whole book", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-loans-app-"));
  let nonce = "";
  const made = createApp({ dataDir: dir, buildDir: path.join(dir, "no-build"), env: { SETUP_TOKEN: "setup-token-123" }, google: () => ({ authUrl: ({ state, nonce: n }) => ((nonce = n), `https://google.test/?state=${state}`), exchange: async (code) => ({ email: code, emailVerified: true, name: "Test", picture: "", nonce }) }), holidayFetch: async () => { throw new Error("no network in tests"); }, flightWatch: false, liveBook: false, loanWatch: false, now: () => AT });
  const server = await new Promise((res) => {
    const s = made.app.listen(0, "127.0.0.1", () => res(s));
  });
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
      const r = http.request({ host: "127.0.0.1", port: server.address().port, method, path: url, headers: h }, (res) => {
        let txt = "";
        res.on("data", (c) => (txt += c));
        res.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(txt);
          } catch (_) {
            /* not JSON */
          }
          resolve({ status: res.statusCode, json, text: txt, jar: (res.headers["set-cookie"] || []).map((c) => c.split(";")[0]).filter((c) => !/=$/.test(c)).join("; "), location: res.headers.location });
        });
      });
      r.on("error", reject);
      r.end(payload);
    });
  const login = async (email) => {
    const start = await request("GET", "/api/auth/google/start");
    const state = new URL(start.location).searchParams.get("state");
    return (await request("GET", `/api/auth/google/callback?state=${state}&code=${encodeURIComponent(email)}`, { cookie: start.jar })).jar;
  };
  await request("POST", "/api/setup", { body: { token: "setup-token-123", googleClientId: "1234567890-abcdefgh.apps.googleusercontent.com", googleClientSecret: "GOCSPX-test-only-value" } });
  try {
    const owner = await login(SUPERADMIN_EMAIL);
    await request("POST", "/api/admin/admins", { cookie: owner, body: { email: "helper@example.com", invite: false } });
    const helper = await login("helper@example.com");
    let r = await request("POST", "/api/admin/loans", { cookie: owner, body: terms({ name: "Private loan", method: "emi" }) });
    assert.equal(r.status, 201, r.text);
    const id = r.json.id;
    assert.equal(r.json.loans[0].rows.length, 3);
    for (const [method, url, body] of [["GET", "/api/admin/loans"], ["POST", "/api/admin/loans", terms()], ["PUT", `/api/admin/loans/${id}`, terms()], ["PUT", `/api/admin/loans/${id}/months/2026-10`, { paid: true }], ["POST", `/api/admin/loans/${id}/paid-upto`, { month: "2026-10" }], ["DELETE", `/api/admin/loans/${id}`], ["POST", `/api/admin/loans/${id}/restore`]]) {
      assert.equal((await request(method, url, { body })).status, 401, `${method} ${url} signed out`);
      const asAdmin = await request(method, url, { cookie: helper, body });
      assert.equal(asAdmin.status, 403, `${method} ${url} as an admin`);
      assert.equal(asAdmin.text.includes("Private loan"), false);
    }
    assert.equal((await request("PUT", `/api/admin/loans/${id}/months/2026-10`, { cookie: owner, body: { paid: true }, csrf: false })).status, 403);
    r = await request("PUT", `/api/admin/loans/${id}/months/2026-10`, { cookie: owner, body: { paid: true } });
    assert.deepEqual([r.status, r.json.totals.outstanding, r.json.saved.last.what], [200, 488000, "Oct 2026: EMI marked paid"]);
    r = await request("PUT", `/api/admin/loans/${id}/months/2020-01`, { cookie: owner, body: { paid: true } });
    assert.deepEqual([r.status, r.json.message], [404, "There is no row for that month."]);
    r = await request("POST", "/api/admin/loans", { cookie: owner, body: terms({ rate: -1 }) });
    assert.deepEqual([r.status, r.json.message], [400, "Enter the yearly interest rate, from 0 to 100."]);
  } finally {
    server.close();
    if (made.live && made.live.stop) made.live.stop();
  }
});
