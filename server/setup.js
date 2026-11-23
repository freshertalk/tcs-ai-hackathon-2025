"use strict";
// The trade setup, as a service (23 Nov 2026): the fifteen readings of the morning "trade setup" every Indian desk reads — kept
// up to date BY ITSELF from Zerodha and NSE's public files, with no AI, no button and no refresh. The arithmetic is in
// market/setup.js.
//
//   FROM ZERODHA   NIFTY 50 and NIFTY BANK daily candles (the pivots), the NIFTY and BANKNIFTY option chains (walls, OI added
//                  and shed, PCR, max pain), India VIX, and every F&O stock's near-month future: its price and open interest
//                  now, and its daily open interest from Kite's history (once a day) — so build-ups are measured against the
//                  last session's close, as the exchanges' own reports do.
//   FROM NSE       the F&O ban list (nsearchives, every morning) and the FII/DII cash-market report (www.nseindia.com's public
//                  report, after the close); delivery comes from the desk's delivery files (market/delivery.js).
//   WHEN           every 30 seconds it looks at what is due: during the session the futures board and the option chains every
//                  two minutes and VIX every minute; the ban list from 8 AM until today's is out; the funds flow every half
//                  hour outside the session; the futures' daily OI once a day. A failed read keeps the last good one and says so.
//   THE LEAN       worked out from all of it (market/setup.js setupLean) and RECORDED: the morning's lean at 9:14 is scored after
//                  the close against NIFTY's day, so the screen and the AI can say how often it has been right.
//   WHO READS IT   the Trade setup workspace, the consensus forecast's refiner (each stock's build-up and the market's lean, as
//                  inputs that must prove themselves), TradeAI and the deep research (free data keys), and the trading-skills
//                  file every AI feature reads.
//
// It reads only. It cannot place, change or cancel an order, and it never asks an AI model.

const S = require("./market/setup");
const { deadline } = require("./heal");

const IST = 5.5 * 3600 * 1000;
const DOC = "market/trade-setup.json";
const FUTPREV = "market/setup-futprev.json";
const LEDGER = "market/setup-ledger.json";
const SECTION = "## Today's trade setup (automatic: levels, options, flows, PCR, VIX, build-ups, delivery, F&O ban)";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const BAN_URL = "https://nsearchives.nseindia.com/content/fo/fo_secban.csv";
const FLOW_URL = "https://www.nseindia.com/api/fiidiiTradeReact";
const MIN = 60000;

const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const iso = (ms) => new Date(ms).toISOString();
const istDate = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const minuteOf = (ms) => {
  const d = new Date(ms + IST);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const weekday = (date) => {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d !== 0 && d !== 6;
};
const tick = () => new Promise((r) => setImmediate(r));

class TradeSetup {
  /**
   * @param market    the MarketService (daily, optionChain, context, futuresBoard, futureDaily, mode) — reads only
   * @param delivery  the DeliveryStore (high delivery) — optional
   * @param fetchImpl fetch for NSE's public files (tests give a fake)
   */
  constructor({ market, delivery = null, docs, playbook = null, fetchImpl = null, now = () => Date.now(), log = console, isTradingDay = weekday }) {
    this.market = market;
    this.delivery = delivery;
    this.docs = docs;
    this.playbook = playbook;
    this.fetch = fetchImpl || ((...a) => globalThis.fetch(...a));
    this.now = now;
    this.log = log;
    this.isTradingDay = isTradingDay;
    this.state = (docs && docs.read(DOC, null)) || {};
    this.due = {};
    this._busy = null;
    this.timer = null;
    this.errors = {};
  }

  _connected() {
    return typeof this.market.mode === "function" && this.market.mode() === "kite";
  }
  _save() {
    this.state.at = iso(this.now());
    if (this.docs) this.docs.write(DOC, this.state);
  }
  _ok(part, value) {
    this.state[part] = value;
    this.state.times = { ...(this.state.times || {}), [part]: iso(this.now()) };
    delete this.errors[part];
  }
  _fail(part, err) {
    this.errors[part] = (err && err.message) || String(err);
  }
  /** Is `part` due again? `every` in ms. */
  _isDue(part, every) {
    const last = this.due[part] || 0;
    if (this.now() - last < every) return false;
    this.due[part] = this.now();
    return true;
  }

  /* --------------------------------------------------------------------------- the readings */
  async _indexLevels() {
    const now = this.now();
    const today = istDate(now);
    const done = minuteOf(now) >= 15 * 60 + 30 || !this.isTradingDay(today);
    const one = async (sym, name) => {
      const d = await this.market.daily(sym);
      const c = (d && d.candles) || [];
      const base = [...c].reverse().find((x) => (done ? x.t <= today : x.t < today));
      return base ? { name, basedOn: base.t, prev: { h: base.h, l: base.l, c: base.c } } : null;
    };
    const [n, b] = await Promise.all([one("NIFTY 50", "NIFTY 50"), one("NIFTY BANK", "NIFTY BANK")]);
    this._ok("indexPrev", { nifty: n, bank: b, forNext: done });
  }

  async _chains() {
    const [n, b] = await Promise.all([this.market.optionChain("NIFTY", { strikes: 20 }).catch((e) => ({ available: false, reason: e.message })), this.market.optionChain("BANKNIFTY", { strikes: 20 }).catch((e) => ({ available: false, reason: e.message }))]);
    // only what the setup shows is kept (the full chain is the option chain page's)
    const slim = (c) => (c && c.available ? { available: true, expiry: c.expiry, daysToExpiry: c.daysToExpiry, spot: c.spot, lot: c.lot, pcr: c.pcr, pcrVol: c.pcrVol, maxPain: c.maxPain, support: c.support, resistance: c.resistance, callWalls: c.callWalls, putWalls: c.putWalls, freshWriting: c.freshWriting, future: c.future, bias: c.bias, oiChangeSince: c.oiChangeSince, rows: (c.rows || []).map((r) => ({ strike: r.strike, ce: r.ce ? { oi: r.ce.oi, oiChange: r.ce.oiChange, last: r.ce.last } : null, pe: r.pe ? { oi: r.pe.oi, oiChange: r.pe.oiChange, last: r.pe.last } : null })) } : { available: false, reason: (c && c.reason) || "No option chain." });
    this._ok("chains", { nifty: slim(n), bank: slim(b) });
  }

  async _vix() {
    const ctx = await this.market.context();
    const items = (ctx && ctx.items) || [];
    const v = items.find((x) => x.id === "vix");
    const n = items.find((x) => x.id === "nifty");
    const bk = items.find((x) => x.id === "bank");
    this._ok("vix", v && v.available ? { last: v.last, changePct: v.changePct } : null);
    this._ok("spot", { nifty: n && n.available ? n.last : null, bank: bk && bk.available ? bk.last : null });
  }

  async _board() {
    const b = await this.market.futuresBoard();
    if (!b || !b.available) throw new Error((b && b.reason) || "No futures board.");
    this._ok("board", { at: b.at, expiry: b.expiry, rows: b.rows.map((r) => ({ symbol: r.symbol, future: r.future, token: r.token, last: r.last, prevClose: r.prevClose, oi: r.oi })) });
  }

  /** Once a day: every future's daily open interest (Kite history), for "against the last session" and the last session's own build-ups. */
  async _futPrev() {
    const today = istDate(this.now());
    const have = (this.docs && this.docs.read(FUTPREV, null)) || null;
    if (have && have.date === today && Object.keys(have.rows || {}).length) {
      this._ok("futPrev", have);
      return;
    }
    const board = this.state.board;
    if (!board || !Array.isArray(board.rows) || !board.rows.length) throw new Error("The futures board is not read yet.");
    const rows = {};
    for (const r of board.rows) {
      try {
        const c = (await this.market.futureDaily(r.token, { days: 12 })).filter((x) => x.t < today && num(x.oi));
        const a = c[c.length - 1];
        const b = c[c.length - 2];
        if (a) rows[r.symbol] = { date: a.t, close: a.c, oi: a.oi, prevDate: b ? b.t : null, prevClose: b ? b.c : null, prevOi: b ? b.oi : null };
      } catch (err) {
        if (/session has expired|not connected/i.test(err.message || "")) throw err;
      }
      await tick();
    }
    const rec = { date: today, rows, at: iso(this.now()) };
    if (this.docs) this.docs.write(FUTPREV, rec);
    this._ok("futPrev", rec);
  }

  async _ban() {
    const today = istDate(this.now());
    if (this.state.ban && this.state.ban.date === today) return;
    const res = await this.fetch(BAN_URL, { headers: { "User-Agent": UA, Accept: "text/csv,*/*" }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`NSE answered HTTP ${res.status} for the ban list`);
    const b = S.banOf(await res.text());
    if (!b) throw new Error("The ban list had an unexpected format");
    this._ok("ban", b);
  }

  async _flows() {
    const res = await this.fetch(FLOW_URL, { headers: { "User-Agent": UA, Accept: "application/json, text/plain, */*", "Accept-Language": "en-US,en;q=0.9", Referer: "https://www.nseindia.com/" }, redirect: "follow", signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`NSE answered HTTP ${res.status} for the FII/DII report`);
    const f = S.flowsOf(await res.json());
    if (!f) throw new Error("The FII/DII report had an unexpected format");
    this._ok("flows", f);
  }

  _deliveryTop() {
    if (!this.delivery || typeof this.delivery.highDelivery !== "function") return;
    const fno = this.state.board && Array.isArray(this.state.board.rows) ? this.state.board.rows.map((r) => r.symbol) : null;
    const d = this.delivery.highDelivery({ symbols: fno, limit: 15 });
    if (d) this._ok("delivery", d);
  }

  /* --------------------------------------------------------------------------- the view */
  /** The build-ups now (against the last session's close OI) and the last session's own. */
  _builds() {
    const board = this.state.board;
    const fp = this.state.futPrev;
    let live = null;
    let prev = null;
    if (board && fp && fp.rows) {
      const rows = board.rows.map((r) => {
        const p = fp.rows[r.symbol];
        return p ? { symbol: r.symbol, last: r.last, prevClose: num(r.prevClose) ? r.prevClose : p.close, oi: r.oi, prevOi: p.oi } : null;
      }).filter(Boolean);
      live = S.buildups(rows);
    }
    if (fp && fp.rows) prev = S.buildups(Object.entries(fp.rows).map(([symbol, p]) => ({ symbol, last: p.close, prevClose: p.prevClose, oi: p.oi, prevOi: p.prevOi })));
    return { live: live && live.known ? live : null, prev: prev && prev.known ? prev : null };
  }

  /** Everything the setup shows now. */
  view() {
    const st = this.state;
    const ip = st.indexPrev || {};
    const ch = st.chains || {};
    const spot = st.spot || {};
    const nifty = ip.nifty ? S.keyLevels({ name: "NIFTY 50", prev: ip.nifty.prev, spot: spot.nifty || (ch.nifty && ch.nifty.spot), chain: ch.nifty }) : null;
    const bank = ip.bank ? S.keyLevels({ name: "NIFTY BANK", prev: ip.bank.prev, spot: spot.bank || (ch.bank && ch.bank.spot), chain: ch.bank }) : null;
    if (nifty && ip.nifty) nifty.basedOn = ip.nifty.basedOn;
    if (bank && ip.bank) bank.basedOn = ip.bank.basedOn;
    const { live, prev } = this._builds();
    const sessionOn = this._inSession(this.now());
    const build = sessionOn ? live : null;
    const lean = S.setupLean({ nifty, bank, chain: ch.nifty, vix: st.vix, flows: st.flows, build: build || prev || live });
    const options = {
      niftyCalls: S.optionSide(ch.nifty, "ce"),
      niftyPuts: S.optionSide(ch.nifty, "pe"),
      bankCalls: S.optionSide(ch.bank, "ce"),
      bankPuts: S.optionSide(ch.bank, "pe"),
    };
    const out = {
      available: Boolean(nifty || st.ban || st.flows || live || prev),
      asOf: st.at || null,
      connected: this._connected(),
      sessionOn,
      nifty,
      bank,
      options,
      pcr: { nifty: ch.nifty && ch.nifty.available ? ch.nifty.pcr : null, bank: ch.bank && ch.bank.available ? ch.bank.pcr : null, niftyVol: ch.nifty && ch.nifty.available ? ch.nifty.pcrVol : null, expiry: ch.nifty && ch.nifty.available ? ch.nifty.expiry : null },
      maxPain: { nifty: ch.nifty && ch.nifty.available ? ch.nifty.maxPain : null, bank: ch.bank && ch.bank.available ? ch.bank.maxPain : null },
      vix: st.vix || null,
      flows: st.flows || null,
      build,
      prevBuild: prev,
      buildBasis: build ? `now, against each future's open interest at the last close (${(st.futPrev && Object.values(st.futPrev.rows || {})[0] || {}).date || "the last session"})` : prev ? "the last finished session against the one before" : null,
      delivery: (st.delivery && st.delivery.list) || [],
      deliveryAsOf: st.delivery ? st.delivery.asOf : null,
      ban: st.ban || null,
      lean,
      record: this.record(),
      times: st.times || {},
      errors: { ...this.errors },
      rule: "Pivots: P = (H+L+C)/3, R1 = 2P−L, S1 = 2P−H, R2 = P+(H−L), S2 = P−(H−L), R3 = H+2(P−L), S3 = L−2(H−P) from the last finished session. Build-ups: a future's price change against its open-interest change since the last close — long build-up (up, OI up), short build-up (down, OI up), short covering (up, OI down), long unwinding (down, OI down). PCR = puts' OI ÷ calls' OI over the 41 strikes around the money, nearest expiry. High delivery: delivered share of the last session's volume at least 1.3× the stock's 20-session average. The lean weighs NIFTY against its pivot 1.2, the option chain 1.5, the build-up breadth 1.3, the funds flow 0.9, VIX 0.8 and BANKNIFTY against its pivot 0.6 — a lean with its reasons and its measured record, never a promise.",
    };
    return out;
  }

  /** A compact copy for the AI (free data). */
  brief() {
    const v = this.view();
    const lists = (b) => (b ? Object.fromEntries(Object.entries(b.lists).map(([k, l]) => [k, l.slice(0, 8).map((x) => `${x.symbol} ${x.changePct >= 0 ? "+" : ""}${x.changePct}% OI ${x.oiChangePct >= 0 ? "+" : ""}${x.oiChangePct}%`)])) : null);
    return {
      asOf: v.asOf,
      lean: { label: v.lean.label, score: v.lean.score, agreement: v.lean.agreement, reasons: v.lean.votes.map((x) => x.why) },
      record: v.record,
      nifty: v.nifty && v.nifty.available ? { pivot: v.nifty.pivot, supports: v.nifty.supports, resistances: v.nifty.resistances, walls: v.nifty.walls } : null,
      bank: v.bank && v.bank.available ? { pivot: v.bank.pivot, supports: v.bank.supports, resistances: v.bank.resistances, walls: v.bank.walls } : null,
      options: Object.fromEntries(Object.entries(v.options).map(([k, x]) => [k, x ? x.read : null])),
      pcr: v.pcr,
      maxPain: v.maxPain,
      vix: v.vix,
      flows: v.flows,
      buildNow: v.build ? { counts: v.build.counts, breadth: v.build.breadth, top: lists(v.build) } : null,
      buildLastSession: v.prevBuild ? { counts: v.prevBuild.counts, breadth: v.prevBuild.breadth, top: lists(v.prevBuild) } : null,
      highDelivery: v.delivery.slice(0, 10).map((x) => `${x.symbol} ${x.delivPct}% (${x.vsAvg}× avg, ${x.changePct >= 0 ? "+" : ""}${x.changePct}%)`),
      fnoBan: v.ban ? v.ban.symbols : null,
    };
  }

  /** One stock's tags (its build-up now and last session, the ban, high delivery). */
  forStock(symbol) {
    const { live, prev } = this._builds();
    return S.stockTags(symbol, { build: this._inSession(this.now()) ? live : null, prevBuild: prev, ban: this.state.ban, delivery: (this.state.delivery && this.state.delivery.list) || [] });
  }

  /** The market's lean now, −1…+1 (the refiner's input). */
  leanNow() {
    return this.view().lean.lean || 0;
  }

  fingerprint() {
    const st = this.state;
    return [st.at, Object.keys(this.errors).join(",")].join("|");
  }

  /* --------------------------------------------------------------------------- the record */
  _ledger() {
    return (this.docs && this.docs.read(LEDGER, null)) || { days: [] };
  }
  /** At 9:14 the morning's lean is written down; after the close it is scored against NIFTY's day. */
  async _recordLean() {
    const now = this.now();
    const today = istDate(now);
    const min = minuteOf(now);
    const L = this._ledger();
    let day = L.days.find((d) => d.date === today);
    if (!day && min >= 9 * 60 + 5 && min < 9 * 60 + 30) {
      const v = this.view();
      day = { date: today, score: v.lean.score, label: v.lean.label, agreement: v.lean.agreement, at: iso(now) };
      L.days = [...L.days, day].slice(-250);
      if (this.docs) this.docs.write(LEDGER, L);
    }
    if (day && day.right === undefined && min >= 15 * 60 + 35) {
      const d = await this.market.daily("NIFTY 50");
      const c = (d && d.candles) || [];
      const i = c.findIndex((x) => x.t === today);
      if (i > 0) {
        day.niftyPrevClose = c[i - 1].c;
        day.niftyClose = c[i].c;
        day.changePct = r2(((c[i].c - c[i - 1].c) / c[i - 1].c) * 100);
        day.right = Math.abs(day.score) >= 12 ? Math.sign(day.score) === Math.sign(day.changePct) : null;
        if (this.docs) this.docs.write(LEDGER, L);
      }
    }
  }
  record() {
    const days = this._ledger().days.filter((d) => typeof d.right === "boolean");
    const right = days.filter((d) => d.right).length;
    return { called: days.length, right, hitRate: days.length ? r2(right / days.length) : null, last: this._ledger().days.slice(-10).reverse(), rule: "The lean written down at 9:14 (Neutral when between −12 and +12) is right when NIFTY closed on its side of the previous close." };
  }

  /* --------------------------------------------------------------------------- the schedule */
  _inSession(ms) {
    const m = minuteOf(ms);
    return this.isTradingDay(istDate(ms)) && m >= 9 * 60 + 15 && m < 15 * 60 + 30;
  }

  async tickOnce() {
    if (this._busy) return this._busy;
    // a round that hangs (a network call that never answers) is let go after five minutes, so the next round runs (server/heal.js)
    this._busy = deadline((async () => {
      const now = this.now();
      const min = minuteOf(now);
      const on = this._inSession(now);
      const kite = this._connected();
      const tasks = [];
      const run = async (part, fn) => {
        try {
          await fn();
        } catch (err) {
          this._fail(part, err);
        }
      };
      if (kite && this._isDue("index", on ? 5 * MIN : 60 * MIN)) tasks.push(run("indexPrev", () => this._indexLevels()));
      if (kite && this._isDue("vix", on ? MIN : 30 * MIN)) tasks.push(run("vix", () => this._vix()));
      if (kite && this._isDue("chains", on ? 2 * MIN : 60 * MIN)) tasks.push(run("chains", () => this._chains()));
      if (kite && this._isDue("board", on ? 2 * MIN : 60 * MIN)) tasks.push(run("board", () => this._board()));
      if (min >= 8 * 60 && this._isDue("ban", (this.state.ban && this.state.ban.date === istDate(now)) ? 120 * MIN : 15 * MIN)) tasks.push(run("ban", () => this._ban()));
      if (this._isDue("flows", on ? 120 * MIN : 30 * MIN)) tasks.push(run("flows", () => this._flows()));
      await Promise.all(tasks);
      // the futures' daily OI needs the board first (once a day; it takes a minute or two at Kite's history pace)
      if (kite && this.state.board && (!this.state.futPrev || this.state.futPrev.date !== istDate(now)) && this._isDue("futPrev", 20 * MIN)) await run("futPrev", () => this._futPrev());
      let more = false;
      if (this._isDue("delivery", 30 * MIN)) {
        await run("delivery", async () => this._deliveryTop());
        more = true;
      }
      if (tasks.length || more) this._save();
      await run("ledger", () => this._recordLean());
      if (this._isDue("teach", 30 * MIN)) this.teach();
    })(), 5 * 60000, "the trade setup's round")
      .catch((err) => this.log.error(`[setup] ${err.message}`))
      .finally(() => {
        this._busy = null;
      });
    return this._busy;
  }

  teach() {
    if (!this.playbook || typeof this.playbook.setSection !== "function") return false;
    const lines = S.linesOf(this.view()).map((l) => `- ${l}`);
    const r = this.record();
    lines.push(`- The setup lean's record: ${r.called ? `right on ${r.right} of ${r.called} called sessions (${Math.round(r.hitRate * 100)}%)` : "not scored yet"}. Weigh it as one input; a stock's own build-up (long build-up/short covering supportive, short build-up/long unwinding weak) matters more for that stock; never trade a stock in the F&O ban in derivatives.`);
    try {
      this.playbook.setSection(SECTION, lines.join("\n"));
      return true;
    } catch (_) {
      return false;
    }
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tickOnce(), 30000);
    if (this.timer.unref) this.timer.unref();
    setTimeout(() => this.tickOnce(), 5000).unref?.();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { TradeSetup, DOC, FUTPREV, LEDGER, SECTION, BAN_URL, FLOW_URL };
