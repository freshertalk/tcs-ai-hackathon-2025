"use strict";
// HTTP routes for the account and for trading. Every route is for the superadmin only —
// it is their Zerodha account. Reads always work; every write is refused by the service
// while the trading switch is OFF.

const { TradingError } = require("./service");
const { KiteError } = require("../market/kite");
const { AiError } = require("../ai/client");
const express = require("express");
const { periodRange } = require("./journal");
const { JournalFiles, UploadError } = require("./uploads");

function mountTrading(app, { trading, ai, requireSuper, limiter, capture = null }) {
  const wrap = (fn) => async (req, res) => {
    try {
      res.json(await fn(req, res));
    } catch (err) {
      if (err instanceof TradingError || err instanceof UploadError) return res.status(err.status).json({ error: err.code, message: err.message });
      if (err instanceof AiError) return res.status(err.status || 400).json({ error: err.code, message: err.message });
      if (err instanceof KiteError) return res.status(502).json({ error: "kite_error", message: `Zerodha said: ${err.message}` });
      const timeout = err && (err.name === "TimeoutError" || err.name === "AbortError");
      console.error("[trading]", err && err.message ? err.message : err);
      res.status(502).json({ error: "upstream", message: timeout ? "Zerodha did not answer in time. Check the order book before trying again." : "Could not reach Zerodha." });
    }
  };
  const by = (req) => req.user.email;

  app.get("/api/admin/trading/status", requireSuper, wrap(async () => trading.status()));
  app.get("/api/admin/trading/summary", requireSuper, wrap(async () => trading.summary()));
  app.get("/api/admin/trading/funds", requireSuper, wrap(async () => trading.funds()));
  app.get("/api/admin/trading/positions", requireSuper, wrap(async () => trading.positions()));
  app.get("/api/admin/trading/holdings", requireSuper, wrap(async () => ({ holdings: await trading.holdings() })));
  app.get("/api/admin/trading/orders", requireSuper, wrap(async () => ({ orders: await trading.orders() })));
  app.get("/api/admin/trading/orders/:id/history", requireSuper, wrap(async (req) => ({ history: await trading.orderHistory(req.params.id) })));
  app.get("/api/admin/trading/trades", requireSuper, wrap(async () => ({ trades: await trading.trades() })));
  app.get("/api/admin/trading/audit", requireSuper, wrap(async () => ({ audit: trading.audit(150) })));

  app.put("/api/admin/trading/switch", requireSuper, wrap(async (req) => trading.setSwitch(Boolean((req.body || {}).on), by(req))));
  app.put("/api/admin/trading/limits", requireSuper, wrap(async (req) => trading.setLimits(req.body || {}, by(req))));

  // the pre-trade check: margin and charges by Zerodha's calculator, plus the desk's own rules.
  // It places nothing, and answers with the switch off.
  app.post("/api/admin/trading/preview", requireSuper, limiter(120, 60 * 1000), wrap(async (req) => trading.preview(req.body || {})));

  // writes: rate-limited well above what a person can click, well below a runaway loop
  const writes = limiter(60, 60 * 1000);
  app.post("/api/admin/trading/orders", requireSuper, writes, wrap(async (req) => trading.place(req.body || {}, by(req))));
  app.put("/api/admin/trading/orders/:variety/:id", requireSuper, writes, wrap(async (req) => trading.modify(req.params.variety, req.params.id, req.body || {}, by(req))));
  app.delete("/api/admin/trading/orders/:variety/:id", requireSuper, writes, wrap(async (req) => trading.cancel(req.params.variety, req.params.id, req.body || {}, by(req))));
  app.post("/api/admin/trading/exit", requireSuper, writes, wrap(async (req) => trading.exit(req.body || {}, by(req))));
  app.post("/api/admin/trading/exit-all", requireSuper, writes, wrap(async (req) => trading.exitAll(req.body || {}, by(req))));
  app.post("/api/admin/trading/sell-holding", requireSuper, writes, wrap(async (req) => trading.sellHolding(req.body || {}, by(req))));

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
  app.get("/api/admin/trading/risk", requireSuper, wrap(async () => {
    const st = trading.status();
    if (!st.connected) return { config: st.risk, lock: st.riskLock, standing: null };
    const s = await trading.riskStatus();
    return { config: s.config, lock: s.lock, standing: s };
  }));
  app.put("/api/admin/trading/risk", requireSuper, wrap(async (req) => trading.setRisk(req.body || {}, by(req))));

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
    return { ...view, analytics: trading.journal.analytics(f) };
  }));
  // profit and loss for every period at once, every financial year since the account opened, the month heatmap,
  // where the history comes from (and its gaps), your saved views and the automatic capture
  app.get("/api/admin/trading/journal/periods", requireSuper, wrap(async () => ({ ...trading.journal.periods(nowMs()), capture: capture ? capture.status() : null, snapshots: { days: Object.keys(trading.journal.snapshots().days).length, latestAt: trading.journal.snapshots().latestAt } })));
  app.post("/api/admin/trading/journal/capture", requireSuper, limiter(20, 10 * 60 * 1000), wrap(async () => {
    if (!capture) throw new TradingError("Automatic capture is not running on this server.", "not_configured", 409);
    const r = await capture.tick({ force: true });
    if (!r) throw new TradingError("Zerodha is not connected: log in to Kite first, then today's trades are read.", "not_connected", 409);
    if (r.error) throw new TradingError(r.error, "upstream", 502);
    return { ...r, status: capture.status() };
  }));
  app.get("/api/admin/trading/journal/snapshots", requireSuper, wrap(async () => trading.journal.snapshots()));
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
  app.post("/api/admin/trading/journal/upload/:id/finish", requireSuper, limiter(60, 10 * 60 * 1000), wrap(async (req) => {
    const { name, buf } = files.take(String(req.params.id));
    const id = require("node:crypto").createHash("sha256").update(buf).digest("hex").slice(0, 16);
    const r = trading.journal.importFile(buf, { name, file: id });
    if (r.error) throw new TradingError(`${name}: ${r.error}`);
    const kept = await files.keep({ name, buf, result: { added: r.added, read: r.read, skipped: r.skipped, kind: r.kind, segments: r.segments, fromDay: r.fromDay, toDay: r.toDay } });
    trading.journal.snapshot(nowMs());
    console.log(`[trading] journal upload by ${req.user.email}: ${name} (${r.kind}) — ${r.added} new of ${r.read}${kept.duplicate ? ", file already kept" : ""}`);
    return { ...r, name, file: kept.meta, duplicate: kept.duplicate };
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
  app.get("/api/admin/trading/stream", requireSuper, (req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.write("retry: 3000\n\n");
    let open = true;
    const off = trading.stream((ev) => open && res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`));
    const beat = setInterval(() => open && res.write(": keep-alive\n\n"), 15000);
    req.on("close", () => {
      open = false;
      clearInterval(beat);
      off();
    });
  });
}

module.exports = { mountTrading };
