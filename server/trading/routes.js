"use strict";
// HTTP routes for the account and for trading. Every route is for the superadmin only —
// it is their Zerodha account. Reads always work; every write is refused by the service
// while the trading switch is OFF.

const { TradingError } = require("./service");
const { KiteError } = require("../market/kite");
const { AiError } = require("../ai/client");

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
