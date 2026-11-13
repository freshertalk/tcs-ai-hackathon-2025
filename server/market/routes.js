"use strict";
// HTTP routes for the Analyzer. Every route needs a signed-in admin.
// There is no route that places, modifies or cancels an order — by design.

const { MarketError, SYMBOL_RE } = require("./service");
const { KiteError } = require("./kite");

function mountMarket(app, deps) {
  const { market, requireAdmin, limiter, currentUser, adminBase, helpers } = deps;
  const { cookie, parseCookies, sign, verify, safeEqual, randomToken, sessionKey, isSecure } = helpers;

  const STATE_COOKIE = "vpt_kite";
  const STATE_PATH = "/api/admin/market/kite";
  const page = `${adminBase}/stock-report`;

  // one place that turns any failure into a calm JSON answer
  const wrap = (fn) => async (req, res) => {
    try {
      res.json(await fn(req, res));
    } catch (err) {
      if (err instanceof MarketError) return res.status(err.status).json({ error: err.code, message: err.message });
      if (err instanceof KiteError) {
        return res.status(502).json({ error: "kite_error", message: `Zerodha said: ${err.message}` });
      }
      const timeout = err && (err.name === "TimeoutError" || err.name === "AbortError");
      console.error("[market]", err);
      res.status(502).json({
        error: "upstream",
        message: timeout ? "Zerodha did not answer in time. Try again in a moment." : "Could not reach the market data source.",
      });
    }
  };

  const symbolOf = (req) => {
    const s = String(req.params.symbol || "").trim().toUpperCase();
    if (!SYMBOL_RE.test(s)) throw new MarketError("That is not a valid symbol.", "invalid");
    return s;
  };

  /* -------------------------------------------------------------- status */
  app.get("/api/admin/market/status", requireAdmin, wrap(async (req) => ({
    ...market.status(),
    redirectUrl: `${deps.origin(req)}${STATE_PATH}/callback`,
    watchlist: market.watchlist(),
  })));

  app.get("/api/admin/market/strategies", requireAdmin, wrap(async () => ({ strategies: market.strategies() })));

  /* ------------------------------------------------- Zerodha connection */
  app.put("/api/admin/market/kite", requireAdmin, wrap(async (req) => {
    const b = req.body || {};
    market.setKiteCredentials(b.apiKey, b.apiSecret);
    console.log(`[market] Kite API credentials updated by ${req.user.email}`);
    return market.status();
  }));

  // Step 1 of the daily login: send the browser to Zerodha's own login page.
  // (The password and 2FA are typed on kite.zerodha.com — never on this site.)
  app.get(`${STATE_PATH}/login`, limiter(20, 15 * 60 * 1000), (req, res) => {
    if (!currentUser(req)) return res.redirect(adminBase);
    try {
      const state = randomToken(18);
      res.append("Set-Cookie", cookie(STATE_COOKIE, sign({ state }, sessionKey, 600), { maxAge: 600, path: STATE_PATH, secure: isSecure(req) }));
      res.redirect(market.loginUrl(state));
    } catch (err) {
      res.redirect(`${page}?kite=error&reason=${encodeURIComponent(err.message)}`);
    }
  });

  // Step 2: Zerodha sends the browser back here with a one-time request_token.
  app.get(`${STATE_PATH}/callback`, async (req, res) => {
    const clear = cookie(STATE_COOKIE, "", { maxAge: 0, path: STATE_PATH, secure: isSecure(req) });
    const fail = (reason) => {
      res.append("Set-Cookie", clear);
      res.redirect(`${page}?kite=error&reason=${encodeURIComponent(reason)}`);
    };
    if (!currentUser(req)) return res.redirect(adminBase);

    const pending = verify(parseCookies(req.headers.cookie)[STATE_COOKIE], sessionKey);
    if (!pending || typeof req.query.state !== "string" || !safeEqual(req.query.state, pending.state)) {
      return fail("That login attempt expired or did not start here. Please try again.");
    }
    if (req.query.status && req.query.status !== "success") return fail("The Kite login was cancelled.");
    try {
      await market.completeLogin(req.query.request_token);
      res.append("Set-Cookie", clear);
      res.redirect(`${page}?kite=connected`);
    } catch (err) {
      console.error("[market] Kite login failed:", err.message);
      fail(err instanceof KiteError ? `Zerodha said: ${err.message}` : err.message || "The Kite login could not be completed.");
    }
  });

  app.post(`${STATE_PATH}/disconnect`, requireAdmin, wrap(async () => {
    market.disconnect();
    return market.status();
  }));

  app.put("/api/admin/market/demo", requireAdmin, wrap(async (req) => {
    market.setDemo(Boolean((req.body || {}).on));
    return { ...market.status(), watchlist: market.watchlist() };
  }));

  /* ---------------------------------------------------- symbols and lists */
  app.get("/api/admin/market/search", requireAdmin, wrap(async (req) => ({ results: await market.search(String(req.query.q || "").slice(0, 30)) })));

  app.get("/api/admin/market/watchlist", requireAdmin, wrap(async () => ({ watchlist: market.watchlist() })));

  app.put("/api/admin/market/watchlist", requireAdmin, wrap(async (req) => ({ watchlist: market.setWatchlist((req.body || {}).symbols) })));

  app.get("/api/admin/market/quotes", requireAdmin, wrap(async (req) => {
    const extra = String(req.query.symbols || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    return market.quotes([...market.watchlist(), ...extra]);
  }));

  app.get("/api/admin/market/scan", requireAdmin, wrap(async () => market.scan()));

  /* --------------------------------------------------------------- screener */
  // Every NSE stock by RSI. The first use downloads a year of daily closes for each stock
  // (in the background, a few minutes); after that a search takes a few seconds.
  app.get("/api/admin/market/screener/status", requireAdmin, wrap(async () => market.screenerStatus()));

  app.post("/api/admin/market/screener/sync", requireAdmin, limiter(20, 60 * 60 * 1000), wrap(async (req) => market.screenerStart({ force: Boolean((req.body || {}).force) })));

  app.post("/api/admin/market/screener/stop", requireAdmin, wrap(async () => market.screenerStop()));

  app.get("/api/admin/market/screener/rsi", requireAdmin, limiter(120, 60 * 1000), wrap(async (req) => market.screenerRsi(req.query)));

  app.get("/api/admin/market/context", requireAdmin, wrap(async () => market.context()));

  // Live ticks, pushed to the page as Server-Sent Events: one long-lived response per open page.
  // Ticks are forwarded as they arrive, batched to at most ten messages a second per symbol.
  app.get("/api/admin/market/stream", requireAdmin, async (req, res) => {
    const symbols = String(req.query.symbols || "").split(",").map((s) => s.trim().toUpperCase()).filter((s) => SYMBOL_RE.test(s)).slice(0, 80);
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform keeps proxies and compression middleware from buffering the stream
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 3000\n\n");
    let open = true;
    let timer = null;
    let handle = { close() {} };
    const pending = new Map();
    const write = (event, data) => {
      if (open) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const flush = () => {
      timer = null;
      for (const [s, t] of pending) write("tick", { s, ...t });
      pending.clear();
    };
    const send = (ev) => {
      if (ev.type === "tick") {
        pending.set(ev.symbol, ev.tick);
        if (!timer) timer = setTimeout(flush, 100);
      } else write("status", { state: ev.state, reason: ev.reason || "" });
    };
    const beat = setInterval(() => open && res.write(": keep-alive\n\n"), 15000);
    req.on("close", () => {
      open = false;
      clearInterval(beat);
      clearTimeout(timer);
      handle.close();
    });
    try {
      handle = await market.stream(symbols, send, { focus: String(req.query.focus || "").trim().toUpperCase() });
      if (!open) handle.close();
    } catch (err) {
      write("status", { state: "off", reason: err && err.message ? err.message : "The live stream could not start." });
    }
  });

  /* -------------------------------------------------------- one symbol */
  // behaviour memory: a stock's measured habits over the past year, stored in the database
  app.get("/api/admin/market/behaviour", requireAdmin, wrap(async () => ({ profiles: market.behaviourList() })));
  app.post("/api/admin/market/behaviour/learn", requireAdmin, limiter(10, 10 * 60 * 1000), wrap(async () => market.learnWatchlist({ refresh: true })));
  app.get("/api/admin/market/behaviour/:symbol", requireAdmin, wrap(async (req) => market.behaviour(symbolOf(req), { refresh: req.query.refresh === "1" })));

  app.get("/api/admin/market/analysis/:symbol", requireAdmin, wrap(async (req) => market.analysis(symbolOf(req), { chartBars: req.query.bars })));

  app.get("/api/admin/market/verdict/:symbol", requireAdmin, wrap(async (req) => market.verdict(symbolOf(req))));

  // the day replayed through the live call: one stock, or the whole watchlist as a scorecard
  app.get("/api/admin/market/replay/:symbol", requireAdmin, wrap(async (req) => market.replay(symbolOf(req), { costPct: req.query.cost })));
  app.get("/api/admin/market/scorecard", requireAdmin, wrap(async (req) => market.scorecard({ costPct: req.query.cost })));

  // the intraday tape for the chart: ?interval=1 (1-minute, with a quick read of it) or 5
  app.get("/api/admin/market/tape/:symbol", requireAdmin, wrap(async (req) => market.tape(symbolOf(req), req.query.interval)));

  app.get("/api/admin/market/intraday/:symbol", requireAdmin, wrap(async (req) => market.intraday(symbolOf(req))));

  app.get("/api/admin/market/backtest/:symbol", requireAdmin, limiter(120, 60 * 1000), wrap(async (req) => {
    const symbol = symbolOf(req);
    const cost = req.query.cost;
    return req.query.strategy ? market.backtest(symbol, String(req.query.strategy), { costPct: cost }) : market.backtestAll(symbol, { costPct: cost });
  }));
}

module.exports = { mountMarket };
