"use strict";
// HTTP routes for the account and for trading. Every route is for the superadmin only —
// it is their Zerodha account. Reads always work; every write is refused by the service
// while the trading switch is OFF.

const { TradingError } = require("./service");
const { KiteError } = require("../market/kite");
const { AiError } = require("../ai/client");
const express = require("express");

function mountTrading(app, { trading, ai, requireSuper, limiter }) {
  const wrap = (fn) => async (req, res) => {
    try {
      res.json(await fn(req, res));
    } catch (err) {
      if (err instanceof TradingError) return res.status(err.status).json({ error: err.code, message: err.message });
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

  /* ---- journal */
  const DAY = 86400000;
  const RANGES = { "1w": 7, "1m": 31, "3m": 92, "6m": 183, "1y": 366 };
  const filtersOf = (q) => {
    const now = Date.now();
    let from = null;
    if (RANGES[q.range]) from = now - RANGES[q.range] * DAY;
    if (q.range === "ytd") from = Date.parse(`${new Date(now + 5.5 * 3600000).toISOString().slice(0, 4)}-01-01T00:00:00+05:30`);
    const sym = String(q.symbol || "").toUpperCase();
    return {
      from,
      symbol: /^[A-Z0-9&._-]{1,40}$/.test(sym) ? sym : "",
      side: ["long", "short"].includes(q.side) ? q.side : "",
      kind: ["intraday", "delivery"].includes(q.kind) ? q.kind : "",
      setup: String(q.setup || "").slice(0, 60),
    };
  };
  app.get("/api/admin/trading/journal", requireSuper, wrap(async (req) => trading.journalView(filtersOf(req.query || {}))));
  app.post(
    "/api/admin/trading/journal/import",
    requireSuper,
    express.text({ type: ["text/csv", "text/plain", "application/octet-stream"], limit: "8mb" }),
    wrap(async (req) => {
      const text = typeof req.body === "string" ? req.body : "";
      if (!text.trim()) throw new TradingError("The file was empty.");
      const r = trading.journal.importCsv(text);
      if (r.error) throw new TradingError(r.error);
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
    return { review: await ai.journalReview.build({ stats: view.stats, trips, range: String((req.body || {}).range || "all") }), ...ai.journalReview.list() };
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
