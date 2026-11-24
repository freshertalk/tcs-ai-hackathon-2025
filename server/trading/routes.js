"use strict";
// HTTP routes for the account and for trading. Reads always work; every write is refused by the
// service while the trading switch is OFF.
//
// WHOSE ACCOUNT: the account's own routes (status, funds, positions, orders, the switch, the limits,
// the risk guard, the daily goal, placing / changing / cancelling an order, the stream) answer for the
// account of whoever is signed in: the owner's (the site's Zerodha connection), or — for a person the
// owner has switched it on for — that person's OWN Zerodha account (server/accounts.js). The account is
// chosen by `requireTrader` from the session, never from anything the page sends; a person with neither
// gets 403. Everything else here (the journal, the AI coach) is the owner's only.

const { TradingError } = require("./service");
const { KiteError } = require("../market/kite");
const { AiError } = require("../ai/client");
const express = require("express");
const { periodRange, detectKind } = require("./journal");
const { JournalFiles, UploadError } = require("./uploads");

function mountTrading(app, { trading, ai, requireSuper, limiter, capture = null, requireTrader = null }) {
  // without accounts (a test, a tool): only the owner, on the site's own connection
  if (!requireTrader) {
    requireTrader = (req, res, next) =>
      requireSuper(req, res, () => {
        req.trading = trading;
        next();
      });
  }
  /** The trading service of whoever is signed in (set by requireTrader). */
  const T = (req) => req.trading;
  const wrap = (fn) => async (req, res) => {
    try {
      res.json(await fn(req, res));
    } catch (err) {
      if (err instanceof TradingError || err instanceof UploadError) return res.status(err.status).json({ error: err.code, message: err.message });
      if (err instanceof AiError) return res.status(err.status || 400).json({ error: err.code, message: err.message });
      if (err instanceof KiteError) return res.status(502).json({ error: "kite_error", message: `Zerodha said: ${err.message}` });
      // a refusal with its own reason (a journal rule, a bad input): said as it is, never as "could not reach Zerodha"
      if (err && Number.isInteger(err.status) && err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: err.code || "invalid", message: err.message });
      const timeout = err && (err.name === "TimeoutError" || err.name === "AbortError");
      console.error("[trading]", err && err.message ? err.message : err);
      res.status(502).json({ error: "upstream", message: timeout ? "Zerodha did not answer in time. Check the order book before trying again." : "Could not reach Zerodha." });
    }
  };
  const by = (req) => req.user.email;

  app.get("/api/admin/trading/status", requireTrader, wrap(async (req) => T(req).status()));
  app.get("/api/admin/trading/summary", requireTrader, wrap(async (req) => T(req).summary()));
  app.get("/api/admin/trading/funds", requireTrader, wrap(async (req) => T(req).funds()));
  app.get("/api/admin/trading/positions", requireTrader, wrap(async (req) => T(req).positions()));
  app.get("/api/admin/trading/holdings", requireTrader, wrap(async (req) => ({ holdings: await T(req).holdings() })));
  app.get("/api/admin/trading/orders", requireTrader, wrap(async (req) => ({ orders: await T(req).orders() })));
  app.get("/api/admin/trading/orders/:id/history", requireTrader, wrap(async (req) => ({ history: await T(req).orderHistory(req.params.id) })));
  app.get("/api/admin/trading/trades", requireTrader, wrap(async (req) => ({ trades: await T(req).trades() })));
  app.get("/api/admin/trading/audit", requireTrader, wrap(async (req) => ({ audit: T(req).audit(150) })));

  app.put("/api/admin/trading/switch", requireTrader, wrap(async (req) => T(req).setSwitch(Boolean((req.body || {}).on), by(req))));
  app.put("/api/admin/trading/limits", requireTrader, wrap(async (req) => T(req).setLimits(req.body || {}, by(req))));

  // the pre-trade check: margin and charges by Zerodha's calculator, plus the desk's own rules.
  // It places nothing, and answers with the switch off.
  app.post("/api/admin/trading/preview", requireTrader, limiter(120, 60 * 1000), wrap(async (req) => T(req).preview(req.body || {})));

  // writes: rate-limited well above what a person can click, well below a runaway loop
  const writes = limiter(60, 60 * 1000);
  app.post("/api/admin/trading/orders", requireTrader, writes, wrap(async (req) => T(req).place(req.body || {}, by(req))));
  app.put("/api/admin/trading/orders/:variety/:id", requireTrader, writes, wrap(async (req) => T(req).modify(req.params.variety, req.params.id, req.body || {}, by(req))));
  app.delete("/api/admin/trading/orders/:variety/:id", requireTrader, writes, wrap(async (req) => T(req).cancel(req.params.variety, req.params.id, req.body || {}, by(req))));
  app.post("/api/admin/trading/exit", requireTrader, writes, wrap(async (req) => T(req).exit(req.body || {}, by(req))));
  app.post("/api/admin/trading/exit-all", requireTrader, writes, wrap(async (req) => T(req).exitAll(req.body || {}, by(req))));
  app.post("/api/admin/trading/sell-holding", requireTrader, writes, wrap(async (req) => T(req).sellHolding(req.body || {}, by(req))));

  // the position coach: this route reads the account and hands the figures to the AI as plain
  // data. The AI cannot reach the broker itself, and nothing it says is acted on.
  app.get("/api/admin/trading/coach", requireSuper, wrap(async () => (ai && ai.coach ? ai.coach.list() : { configured: false, readings: [] })));
  app.post("/api/admin/trading/coach", requireSuper, limiter(30, 60 * 60 * 1000), wrap(async (req) => {
    if (!ai || !ai.coach) throw new TradingError("The AI is not available on this server.", "not_configured", 409);
    const account = await trading.summary();
    if (!account.positions && !account.holdings) throw new TradingError("Could not read the positions from Zerodha.", "no_data", 502);
    return { reading: await ai.coach.read(account, { holdings: (req.body || {}).holdings !== false }), ...ai.coach.list() };
  }));

  /* ---- risk guard */
  app.get("/api/admin/trading/risk", requireTrader, wrap(async (req) => {
    const st = T(req).status();
    if (!st.connected) return { config: st.risk, lock: st.riskLock, standing: null };
    const s = await T(req).riskStatus();
    return { config: s.config, lock: s.lock, standing: s };
  }));
  app.put("/api/admin/trading/risk", requireTrader, wrap(async (req) => T(req).setRisk(req.body || {}, by(req))));

  /* ---- the daily goal: target, stop and profit protection (reminders only; it never trades) */
  app.get("/api/admin/trading/discipline", requireTrader, wrap(async (req) => {
    const st = T(req).status();
    if (!st.connected) return { available: false, enabled: T(req)._discipline().enabled, config: T(req)._discipline(), reason: "Connect Zerodha to see today's target and stop: they come from your available margin." };
    return T(req).disciplineStatus();
  }));
  app.put("/api/admin/trading/discipline", requireTrader, wrap(async (req) => ({ config: T(req).setDiscipline(req.body || {}, by(req)) })));

  /* ---- journal: every fill from Zerodha (Kite each day, Console tradebooks for the history) */
  const DAY = 86400000;
  const OLD = { "1w": 7, "1m": 31, "3m": 92, "6m": 183, "1y": 366 }; // the earlier page's ranges, still understood
  const nowMs = () => (typeof trading.now === "function" ? trading.now() : Date.now()); // the server's clock, like the capture
  const filtersOf = (q) => {
    const now = nowMs();
    let from = null;
    let to = null;
    let period = null;
    const p = periodRange(String(q.period || ""), now, { from: q.from, to: q.to, firstAt: trading.journal.firstAt() });
    if (p) {
      from = p.from;
      to = p.to;
      period = { id: p.id, label: p.label, fromDay: p.fromDay, toDay: p.toDay };
    } else if (OLD[q.range]) from = now - OLD[q.range] * DAY;
    else if (q.range === "ytd") from = Date.parse(`${new Date(now + 5.5 * 3600000).toISOString().slice(0, 4)}-01-01T00:00:00+05:30`);
    else if (q.period === "custom") throw new TradingError("Pick a valid date range: the first day on or before the last.");
    const sym = String(q.symbol || "").toUpperCase();
    return {
      from,
      to,
      period,
      symbol: /^[A-Z0-9&._-]{1,40}$/.test(sym) ? sym : "",
      side: ["long", "short"].includes(q.side) ? q.side : "",
      kind: ["intraday", "delivery"].includes(q.kind) ? q.kind : "",
      setup: String(q.setup || "").slice(0, 60),
    };
  };
  // the journal for one period (today, yesterday, week … a financial year, all, or a custom range), with its deeper figures
  app.get("/api/admin/trading/journal", requireSuper, wrap(async (req) => {
    const f = filtersOf(req.query || {});
    const view = await trading.journalView(f);
    return { ...view, analytics: trading.journal.analytics(f), returns: trading.journal.returns(f, nowMs()), capital: trading.journal.capital() };
  }));
  // day by day for the P&L grid (Zerodha Console's green/red days): the last 12 months by default, each day with its trades
  app.get("/api/admin/trading/journal/days", requireSuper, wrap(async (req) => {
    const q = req.query || {};
    const today = new Date(nowMs() + 5.5 * 3600000).toISOString().slice(0, 10);
    const okDay = (x) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(x || "")) && !Number.isNaN(Date.parse(`${x}T00:00:00Z`));
    const [ty, tm] = today.split("-").map(Number);
    const yearAgo = new Date(Date.UTC(ty, tm - 12, 1)).toISOString().slice(0, 10); // the 1st of the month, 11 months back
    const fromDay = okDay(q.from) ? String(q.from) : yearAgo;
    let toDay = okDay(q.to) ? String(q.to) : today;
    if (toDay > today) toDay = today;
    if (fromDay > toDay) throw new TradingError("Pick a valid date range: the first day on or before the last.");
    if ((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / DAY > 3 * 366) throw new TradingError("Pick a range of three years or less.");
    const f = filtersOf({ side: q.side, kind: q.kind, setup: q.setup, symbol: q.symbol });
    return { today, ...trading.journal.days({ fromDay, toDay, side: f.side, kind: f.kind, setup: f.setup, symbol: f.symbol }) };
  }));
  // profit and loss for every period at once, every financial year since the account opened, the month heatmap,
  // where the history comes from (and its gaps), your saved views and the automatic capture
  // the capital ledger: the money put in (and taken out), which every percentage return is measured on
  app.get("/api/admin/trading/journal/capital", requireSuper, wrap(async () => ({ capital: trading.journal.capital() })));
  // days entered by hand (23 Nov 2026): only days with no Zerodha trades; Zerodha's own days are never changed here
  const dayOf = (req) => String(req.params.date || "").slice(0, 10);
  app.put("/api/admin/trading/journal/manual/:date", requireSuper, limiter(120, 10 * 60 * 1000), wrap(async (req) => ({ day: trading.journal.setManualDay(dayOf(req), req.body || {}, req.user && req.user.email, nowMs()) })));
  app.delete("/api/admin/trading/journal/manual/:date", requireSuper, limiter(120, 10 * 60 * 1000), wrap(async (req) => {
    if (trading.journal.zerodhaDay(dayOf(req))) throw Object.assign(new Error("This day comes from Zerodha and cannot be removed here."), { status: 409, code: "zerodha_day" });
    return { removed: trading.journal.removeManualDay(dayOf(req)) };
  }));
  app.post("/api/admin/trading/journal/capital", requireSuper, limiter(60, 10 * 60 * 1000), wrap(async (req) => {
    const r = trading.journal.addCapital(req.body || {}, nowMs());
    if (r.error) throw new TradingError(r.error);
    return r;
  }));
  app.delete("/api/admin/trading/journal/capital/:id", requireSuper, limiter(60, 10 * 60 * 1000), wrap(async (req) => {
    const r = trading.journal.removeCapital(String(req.params.id || "").slice(0, 20));
    if (r.error) throw new TradingError(r.error);
    return r;
  }));
  // other credits & debits (24 Nov 2026): DP charges billed separately, AMC, interest, dividends… — by hand or from the Console ledger file
  app.get("/api/admin/trading/journal/other", requireSuper, wrap(async (req) => {
    const q = req.query || {};
    const ok = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d || "")) ? String(d) : "");
    return trading.journal.others({ fromDay: ok(q.fromDay), toDay: ok(q.toDay) });
  }));
  app.post("/api/admin/trading/journal/other", requireSuper, limiter(120, 10 * 60 * 1000), wrap(async (req) => {
    const before = trading.journal.otherDays();
    const r = trading.journal.addOther(req.body || {}, nowMs());
    if (r.error) throw new TradingError(r.error);
    trading.journal.snapshot(nowMs());
    recapture([...before, ...trading.journal.otherDays()]);
    return r;
  }));
  app.delete("/api/admin/trading/journal/other/:id", requireSuper, limiter(120, 10 * 60 * 1000), wrap(async (req) => {
    const before = trading.journal.otherDays();
    const r = trading.journal.removeOther(String(req.params.id || "").slice(0, 20));
    if (r.error) throw new TradingError(r.error);
    trading.journal.snapshot(nowMs());
    recapture([...before, ...trading.journal.otherDays()]);
    return r;
  }));
  app.get("/api/admin/trading/journal/periods", requireSuper, wrap(async () => ({ ...trading.journal.periods(nowMs()), capture: capture ? capture.status() : null, snapshots: { days: Object.keys(trading.journal.snapshots().days).length, latestAt: trading.journal.snapshots().latestAt } })));
  app.post("/api/admin/trading/journal/capture", requireSuper, limiter(20, 10 * 60 * 1000), wrap(async () => {
    if (!capture) throw new TradingError("Automatic capture is not running on this server.", "not_configured", 409);
    const r = await capture.tick({ force: true });
    if (!r) throw new TradingError("Zerodha is not connected: log in to Kite first, then today's trades are read.", "not_connected", 409);
    if (r.error) throw new TradingError(r.error, "upstream", 502);
    return { ...r, status: capture.status() };
  }));
  app.get("/api/admin/trading/journal/snapshots", requireSuper, wrap(async () => trading.journal.snapshots()));
  // the Retrospective: what went well, what went wrong, what to keep, stop and try — for the period shown (saved)
  app.post("/api/admin/trading/journal/retro", requireSuper, limiter(60, 10 * 60 * 1000), wrap(async (req) => trading.journal.retrospective(filtersOf(req.body || {}), nowMs())));
  app.get("/api/admin/trading/journal/retros", requireSuper, wrap(async () => ({ retros: trading.journal.retros() })));
  app.get("/api/admin/trading/journal/retros/:id", requireSuper, wrap(async (req) => {
    const r = trading.journal.retro(String(req.params.id));
    if (!r) throw new TradingError("That retrospective is not kept any more.", "not_found", 404);
    return r;
  }));
  app.delete("/api/admin/trading/journal/retros/:id", requireSuper, wrap(async (req) => ({ retros: trading.journal.removeRetro(String(req.params.id)) })));
  app.put("/api/admin/trading/journal/account-since", requireSuper, wrap(async (req) => {
    const r = trading.journal.setAccountSince((req.body || {}).date);
    if (r.error) throw new TradingError(r.error);
    trading.journal.snapshot(nowMs());
    return r;
  }));
  app.post("/api/admin/trading/journal/views", requireSuper, limiter(60, 10 * 60 * 1000), wrap(async (req) => {
    const r = trading.journal.saveView(req.body || {}, nowMs());
    if (r.error) throw new TradingError(r.error);
    return r;
  }));
  app.delete("/api/admin/trading/journal/views/:id", requireSuper, wrap(async (req) => trading.journal.removeView(String(req.params.id || "").slice(0, 20))));
  /* ---- tradebook files (.csv or .xlsx from Zerodha Console): uploaded in parts, read, and kept as they came */
  const files = new JournalFiles(trading.journal.docs, { now: nowMs });
  const fileName = (n) => String(n || "tradebook").replace(/[^A-Za-z0-9 ._()-]/g, "_").slice(0, 100);
  app.post("/api/admin/trading/journal/upload", requireSuper, limiter(60, 10 * 60 * 1000), wrap(async (req) => files.start(req.body || {})));
  app.put("/api/admin/trading/journal/upload/:id/:index", requireSuper, limiter(400, 10 * 60 * 1000), express.raw({ type: () => true, limit: "3mb" }), wrap(async (req) => files.part(String(req.params.id), Number(req.params.index), req.body)));
  // the Day book re-reads the days whose figures a change touched (a correction, other credits & debits)
  const recapture = (days) => {
    const list = [...new Set(days)].filter(Boolean);
    if (list.length && typeof trading.onJournalMatch === "function") Promise.resolve().then(() => trading.onJournalMatch(list)).catch(() => {});
  };
  // one tradebook, read and kept (shared by the plain upload and the smart one)
  const finishTradebook = async (req, name, buf) => {
    const id = require("node:crypto").createHash("sha256").update(buf).digest("hex").slice(0, 16);
    const r = trading.journal.importFile(buf, { name, file: id });
    if (r.error) throw new TradingError(`${name}: ${r.error}`);
    const kept = await files.keep({ name, buf, result: { added: r.added, read: r.read, skipped: r.skipped, kind: r.kind, segments: r.segments, fromDay: r.fromDay, toDay: r.toDay } });
    trading.journal.snapshot(nowMs());
    console.log(`[trading] journal upload by ${req.user.email}: ${name} (${r.kind}) — ${r.added} new of ${r.read}${kept.duplicate ? ", file already kept" : ""}`);
    // LISTENER: new trades in the journal — the Day book saves their days and the lab replays them at once
    if (r.added && typeof trading.onJournalImport === "function") Promise.resolve().then(() => trading.onJournalImport(r)).catch(() => {});
    return { ...r, name, file: kept.meta, duplicate: kept.duplicate };
  };
  // a ledger, read, and every day that differs a little made to match it; the Day book re-reads the days that changed
  const finishLedger = (req, name, buf) => {
    const r = trading.journal.importLedger(buf, { name }, nowMs());
    if (r.error) throw new TradingError(`${name}: ${r.error}`);
    const m = trading.journal.applyMatch({}, nowMs());
    recapture([...m.corrected, ...trading.journal.otherDays()]);
    trading.journal.snapshot(nowMs());
    console.log(`[trading] ledger upload by ${req.user.email}: ${name} (${r.kind}) — ${r.added} new of ${r.read} other credits & debits, ${r.settledDays} days, ${m.corrected.length} corrected`);
    return { ...r, name, matched: m.corrected, counts: m.reconcile.counts };
  };
  // Console's P&L statement: kept as the reference for its period, and compared with the journal's period
  const finishPnl = (req, name, buf) => {
    const r = trading.journal.importPnl(buf, { name }, nowMs());
    if (r.error) throw new TradingError(`${name}: ${r.error}`);
    // Console's statement is the truth for its period: the charges are set to its figures at once (undo is one press)
    const m = trading.journal.applyPnlMatch(r.key, nowMs());
    trading.journal.snapshot(nowMs());
    console.log(`[trading] P&L statement upload by ${req.user.email}: ${name} (${r.from} to ${r.to}) — ${r.added} other entries, ${m.error ? "no correction (" + m.error + ")" : m.days.length + " days corrected"}`);
    recapture([...(m.days || []), ...trading.journal.otherDays()]);
    return { name, ...r, corrected: m.error ? 0 : m.days.length, compare: trading.journal.pnlCompare().find((c) => c.key === r.key) || null };
  };
  app.post("/api/admin/trading/journal/upload/:id/finish", requireSuper, limiter(60, 10 * 60 * 1000), wrap(async (req) => {
    const { name, buf } = files.take(String(req.params.id));
    return finishTradebook(req, name, buf);
  }));
  // SMART: whatever Zerodha Console file was uploaded — its own headers say what it is (a tradebook or a ledger)
  app.post("/api/admin/trading/journal/upload/:id/finish-console", requireSuper, limiter(60, 10 * 60 * 1000), wrap(async (req) => {
    const { name, buf } = files.take(String(req.params.id));
    const kind = detectKind(buf);
    if (kind === "tradebook") return { type: "tradebook", ...(await finishTradebook(req, name, buf)) };
    if (kind === "ledger") return { type: "ledger", ...finishLedger(req, name, buf) };
    if (kind === "pnl") return { type: "pnl", ...finishPnl(req, name, buf) };
    throw new TradingError(`${name}: this is not a Zerodha Console tradebook or ledger. Use Console → Reports → Tradebook, or Funds → Statement (the ledger), as .xlsx or .csv.`);
  }));
  // Zerodha's own charges per order (its virtual contract note): how far they reach, and a read of the ones still to come
  app.get("/api/admin/trading/journal/charges", requireSuper, wrap(async () => ({ ...trading.journal.chargesStatus(), connected: Boolean(trading.market && trading.market.kiteAuth && trading.market.kiteAuth()) })));
  app.post("/api/admin/trading/journal/charges/refresh", requireSuper, limiter(20, 10 * 60 * 1000), wrap(async () => {
    let total = 0;
    let last = { done: 0, left: 0, error: "" };
    for (let i = 0; i < 8; i += 1) {
      last = await trading.refreshCharges({ limit: 100 });
      total += last.done;
      if (last.error || !last.left || !last.done) break;
    }
    trading.journal.snapshot(nowMs());
    return { done: total, left: last.left, error: last.error, ...trading.journal.chargesStatus() };
  }));
  app.get("/api/admin/trading/journal/pnl", requireSuper, wrap(async () => ({ statements: trading.journal.pnlCompare() })));
  app.post("/api/admin/trading/journal/pnl/:key/apply", requireSuper, limiter(60, 10 * 60 * 1000), wrap(async (req) => {
    const r = trading.journal.applyPnlMatch(String(req.params.key || "").slice(0, 30), nowMs());
    if (r.error) throw new TradingError(r.error);
    trading.journal.snapshot(nowMs());
    if (typeof trading.onJournalMatch === "function") Promise.resolve().then(() => trading.onJournalMatch(r.days)).catch(() => {});
    return { statements: r.compare, days: r.days };
  }));
  app.delete("/api/admin/trading/journal/pnl/:key/apply", requireSuper, limiter(60, 10 * 60 * 1000), wrap(async (req) => {
    const r = trading.journal.removePnlMatch(String(req.params.key || "").slice(0, 30));
    if (r.error) throw new TradingError(r.error);
    trading.journal.snapshot(nowMs());
    if (typeof trading.onJournalMatch === "function") Promise.resolve().then(() => trading.onJournalMatch(r.days)).catch(() => {});
    return { statements: r.compare, days: r.days };
  }));
  // the ledger against the journal, day by day, and the corrections
  app.get("/api/admin/trading/journal/reconcile", requireSuper, wrap(async () => trading.journal.reconcile()));
  app.post("/api/admin/trading/journal/reconcile/apply", requireSuper, limiter(60, 10 * 60 * 1000), wrap(async (req) => {
    const b = req.body || {};
    const m = trading.journal.applyMatch({ days: Array.isArray(b.days) ? b.days.slice(0, 400).map((x) => String(x).slice(0, 10)) : null }, nowMs());
    trading.journal.snapshot(nowMs());
    if (m.corrected.length && typeof trading.onJournalMatch === "function") Promise.resolve().then(() => trading.onJournalMatch(m.corrected)).catch(() => {});
    return m;
  }));
  app.delete("/api/admin/trading/journal/reconcile/:date", requireSuper, limiter(60, 10 * 60 * 1000), wrap(async (req) => {
    const day = String(req.params.date || "").slice(0, 10);
    const r = trading.journal.removeMatch(day);
    if (r.error) throw new TradingError(r.error);
    trading.journal.snapshot(nowMs());
    if (typeof trading.onJournalMatch === "function") Promise.resolve().then(() => trading.onJournalMatch([day])).catch(() => {});
    return r;
  }));
  app.get("/api/admin/trading/journal/files", requireSuper, wrap(async () => ({ files: await files.list(), store: files.col ? "MongoDB (collection journal_files)" : "server files (data/journal-files)" })));
  app.get("/api/admin/trading/journal/files/:id", requireSuper, async (req, res) => {
    try {
      const f = await files.get(String(req.params.id));
      if (!f) return res.status(404).json({ error: "not_found", message: "That file is not kept any more." });
      res.setHeader("Content-Type", f.meta.type === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName(f.meta.name)}"`);
      res.setHeader("Cache-Control", "no-store");
      return res.send(f.buf);
    } catch (err) {
      return res.status(500).json({ error: "failed", message: err.message });
    }
  });
  // read a kept file again (repeats are ignored, so only trades the journal lacks are added)
  app.post("/api/admin/trading/journal/files/:id/reimport", requireSuper, limiter(30, 10 * 60 * 1000), wrap(async (req) => {
    const f = await files.get(String(req.params.id));
    if (!f) throw new TradingError("That file is not kept any more.", "not_found", 404);
    const r = trading.journal.importFile(f.buf, { name: f.meta.name, file: f.meta.id });
    if (r.error) throw new TradingError(r.error);
    trading.journal.snapshot(nowMs());
    return { ...r, name: f.meta.name };
  }));
  app.delete("/api/admin/trading/journal/files/:id", requireSuper, wrap(async (req) => ({ removed: await files.remove(String(req.params.id)), files: await files.list() })));
  // the earlier one-request import of a CSV (still works for small files)
  app.post(
    "/api/admin/trading/journal/import",
    requireSuper,
    express.text({ type: ["text/csv", "text/plain", "application/octet-stream"], limit: "8mb" }),
    wrap(async (req) => {
      const text = typeof req.body === "string" ? req.body : "";
      if (!text.trim()) throw new TradingError("The file was empty.");
      const r = trading.journal.importCsv(text);
      if (r.error) throw new TradingError(r.error);
      trading.journal.snapshot(nowMs());
      console.log(`[trading] journal import by ${req.user.email}: ${r.added} new of ${r.read} (${r.skipped} skipped)`);
      return r;
    })
  );
  app.put("/api/admin/trading/journal/tags", requireSuper, wrap(async (req) => {
    const b = req.body || {};
    if (!/^[A-Z]{2,4}:[A-Z0-9&._-]{1,40}:\d{10,14}$/.test(String(b.key || ""))) throw new TradingError("That is not a journal trade.");
    return { tags: trading.journal.setTags(String(b.key), b) };
  }));
  app.post("/api/admin/trading/journal/excursions", requireSuper, limiter(20, 60 * 60 * 1000), wrap(async (req) => trading.excursions({ limit: Number((req.body || {}).limit) || 25 })));

  /* ---- AI review of the journal (plain figures in; the AI never reaches the broker) */
  app.get("/api/admin/trading/journal/reviews", requireSuper, wrap(async () => (ai && ai.journalReview ? ai.journalReview.list() : { configured: false, reviews: [] })));
  app.post("/api/admin/trading/journal/review", requireSuper, limiter(20, 60 * 60 * 1000), wrap(async (req) => {
    if (!ai || !ai.journalReview) throw new TradingError("The AI is not available on this server.", "not_configured", 409);
    const f = filtersOf(req.body || {});
    const view = trading.journal.view(f);
    if (view.stats.trades < 5) throw new TradingError("The journal needs at least 5 closed trades in this range for a review.", "no_data", 409);
    const trips = trading.journal.trips(f).filter((t) => !t.open);
    return { review: await ai.journalReview.build({ stats: view.stats, trips, range: f.period ? f.period.label : String((req.body || {}).range || "all") }), ...ai.journalReview.list() };
  }));
  app.post("/api/admin/trading/journal/review/:id/rule", requireSuper, wrap(async (req) => {
    if (!ai || !ai.journalReview) throw new TradingError("The AI is not available on this server.", "not_configured", 409);
    return ai.journalReview.addRule(String(req.params.id || ""), Number((req.body || {}).index));
  }));

  // order updates from Zerodha's stream, as they arrive
  app.get("/api/admin/trading/stream", requireTrader, (req, res) => {
    const trading = T(req); // this person's account for the life of the connection (the owner's has the live book too)
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.write("retry: 3000\n\n");
    let open = true;
    const off = trading.stream((ev) => open && res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`));
    // the same connection carries the live book (positions at streamed prices) and the daily goal's
    // standing as they change: one stream per page for everything about the account
    const offBook = trading.liveBook ? trading.liveBook.watch((v) => open && res.write(`event: book\ndata: ${JSON.stringify(v)}\n\n`)) : () => {};
    const offGoal = typeof trading.watchGoal === "function" ? trading.watchGoal((g) => open && res.write(`event: goal\ndata: ${JSON.stringify(g)}\n\n`)) : () => {};
    // status changes (the switch, the Zerodha session, the guard) and notices (the exit coach's warnings)
    const offPush = typeof trading.watchPush === "function" ? trading.watchPush((ev) => open && res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`)) : () => {};
    const beat = setInterval(() => open && res.write(": keep-alive\n\n"), 15000);
    req.on("close", () => {
      open = false;
      clearInterval(beat);
      off();
      offBook();
      offGoal();
      offPush();
    });
  });
}

module.exports = { mountTrading };
