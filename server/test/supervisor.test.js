"use strict";
// The automation supervisor: it runs what is behind, one duty at a time, heavy ones only in quiet hours, and never in a tight loop.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Supervisor } = require("../supervisor");
const { FileDocs } = require("../docs");

const quiet = { log() {}, error() {} };
const IST = 5.5 * 3600 * 1000;
const at = (date, hhmm) => Date.parse(`${date}T${hhmm}:00Z`) - IST;
const mkdocs = () => new FileDocs(fs.mkdtempSync(path.join(os.tmpdir(), "vpt-sup-")));
// Thursday 19 Nov 2026 is a trading day; 20 Nov is taken as a holiday here; 21–22 are the weekend
const cal = (d) => {
  const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
  return wd !== 0 && wd !== 6 && d !== "2026-11-20";
};

test("quiet hours and the last finished session follow the exchange calendar", () => {
  const s = new Supervisor({ isTradingDay: cal, log: quiet });
  assert.equal(s.quiet(at("2026-11-19", "10:00")), false, "in the session");
  assert.equal(s.quiet(at("2026-11-19", "08:00")), true, "before it");
  assert.equal(s.quiet(at("2026-11-19", "15:40")), true, "after it");
  assert.equal(s.quiet(at("2026-11-20", "11:00")), true, "a holiday is quiet all day");
  assert.equal(s.lastSession(at("2026-11-19", "10:00")), "2026-11-18", "today's session is not over yet");
  assert.equal(s.lastSession(at("2026-11-19", "15:40")), "2026-11-19");
  assert.equal(s.lastSession(at("2026-11-20", "18:00")), "2026-11-19", "a holiday has no session");
  assert.equal(s.lastSession(at("2026-11-22", "12:00")), "2026-11-19", "nor has the weekend");
});

test("it runs the first duty that is behind, one at a time; heavy duties wait for quiet hours; a caught-up duty is left alone", async () => {
  let now = at("2026-11-19", "11:00"); // in the session
  const ran = [];
  const state = { light: "2 forecasts not scored", heavy: "3 sessions not learned", fine: "" };
  const duty = (id, extra = {}) => ({ id, name: id, what: id, due: () => state[id], run: async () => { ran.push(id); state[id] = ""; }, ...extra });
  const docs = mkdocs();
  const s = new Supervisor({ docs, isTradingDay: cal, now: () => now, log: quiet, duties: [duty("fine"), duty("heavy", { quietOnly: true }), duty("light")] });
  let st = s.status();
  assert.deepEqual(st.duties.map((d) => d.state), ["ok", "waiting", "behind"]);
  assert.equal(st.behind, 2);
  assert.equal(await s.tick(), "light", "the heavy one waits for the close; the light one runs now");
  assert.deepEqual(ran, ["light"]);
  assert.equal(await s.tick(), null, "nothing else may run in the session");
  now = at("2026-11-19", "15:40");
  assert.equal(await s.tick(), "heavy");
  assert.equal(await s.tick(), null);
  st = s.status();
  assert.equal(st.behind, 0);
  assert.deepEqual(st.events.map((e) => `${e.id}:${e.kind}`).slice(0, 4), ["heavy:done", "heavy:started", "light:done", "light:started"]);
  // what ran is kept across a restart
  const again = new Supervisor({ docs, isTradingDay: cal, now: () => now, log: quiet, duties: [duty("heavy", { quietOnly: true })] });
  assert.equal(again.status().duties[0].runs, 1);
  assert.ok(again.status().duties[0].lastOkAt);
});

test("a duty that fails, or stays behind after running, is tried again with growing pauses — never in a loop", async () => {
  let now = at("2026-11-21", "10:00"); // a Saturday: quiet
  let tries = 0;
  let behind = "the history is not up to date";
  let fail = true;
  const s = new Supervisor({
    docs: mkdocs(),
    isTradingDay: cal,
    now: () => now,
    log: quiet,
    duties: [{ id: "d", name: "d", what: "d", due: () => behind, run: async () => { tries += 1; if (fail) throw new Error("Zerodha did not answer"); } }],
  });
  assert.equal(await s.tick(), "d");
  assert.equal(s.status().duties[0].state, "failed");
  assert.match(s.status().duties[0].lastError, /Zerodha did not answer/);
  assert.equal(await s.tick(), null, "not again straight away");
  now += 29 * 60000;
  assert.equal(await s.tick(), null, "nor after 29 minutes");
  now += 2 * 60000;
  assert.equal(await s.tick(), "d", "after half an hour");
  now += 45 * 60000;
  assert.equal(await s.tick(), null, "the pause has doubled to an hour");
  now += 20 * 60000;
  fail = false;
  assert.equal(await s.tick(), "d", "it ran without an error, but it is still behind: nothing more can be done now");
  assert.equal(s.status().duties[0].state, "behind");
  assert.ok(s.status().duties[0].nextAt, "it says when it will look again");
  assert.equal(tries, 3);
  now += 60 * 60000;
  assert.equal(await s.tick(), null, "the pause keeps growing while nothing changes");
  // once it is caught up the pause is forgotten: the next time it falls behind it is tried at once
  behind = "";
  await s.tick();
  behind = "a new session is stored";
  assert.equal(await s.tick(), "d");
  // a duty whose check itself throws is treated as not behind, and never breaks the others
  const t = new Supervisor({ isTradingDay: cal, now: () => now, log: quiet, duties: [{ id: "x", name: "x", what: "x", due: () => { throw new Error("boom"); }, run: async () => {} }] });
  assert.equal(await t.tick(), null);
  assert.equal(t.status().duties[0].state, "ok");
});
