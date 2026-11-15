"use strict";
// HTTP routes for Trade Analysis. The figures are the owner's own profit and loss, so every route
// needs the superadmin (like the Journal and Positions); nothing here can reach an order.

const { AnalysisError } = require("./service");

function mountAnalysis(app, { analysis, requireSuper, limiter }) {
  const wrap = (fn) => async (req, res) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      if (err instanceof AnalysisError) return res.status(err.status || 400).json({ error: err.code, message: err.message });
      if (err && err.code && err.status) return res.status(err.status).json({ error: err.code, message: err.message });
      console.error("[analysis]", err && err.message ? err.message : err);
      res.status(500).json({ error: "analysis_failed", message: err && err.message ? err.message : "Trade Analysis failed." });
    }
  };
  const range = (req) => {
    const ok = (x) => (/^\d{4}-\d{2}-\d{2}$/.test(String(x || "")) ? String(x) : null);
    return { from: ok(req.query.from), to: ok(req.query.to) };
  };

  app.get("/api/admin/analysis/settings", requireSuper, wrap(async () => analysis.settings()));
  app.put("/api/admin/analysis/settings", requireSuper, limiter(30, 15 * 60 * 1000), wrap(async (req) => analysis.setSettings(req.body || {})));
  app.get("/api/admin/analysis/days", requireSuper, wrap(async (req) => ({ days: analysis.list(range(req)), settings: analysis.settings() })));
  app.get("/api/admin/analysis/analytics", requireSuper, limiter(120, 60 * 1000), wrap(async (req) => analysis.analytics(range(req))));
  app.get("/api/admin/analysis/day/:date", requireSuper, wrap(async (req) => analysis.get(req.params.date)));
  // save (or refresh) a day's report now, from the journal and the broker's readings
  app.post("/api/admin/analysis/day/:date", requireSuper, limiter(40, 10 * 60 * 1000), wrap(async (req) => {
    const r = await analysis.capture(req.params.date, { by: "manual", withAi: Boolean((req.body || {}).ai) });
    if (r && r.skipped) throw new AnalysisError("No closed trades were found for that day, so nothing was saved. If you traded it, import that period's tradebook from Zerodha Console on the Journal, then save the day again.", "no_trades", 404);
    return r;
  }));
  // your notes on a day (a note, a rating, lessons, a mood) — the figures are never edited by hand
  app.put("/api/admin/analysis/day/:date", requireSuper, limiter(60, 10 * 60 * 1000), wrap(async (req) => analysis.edit(req.params.date, req.body || {})));
  app.post("/api/admin/analysis/day/:date/ai", requireSuper, limiter(20, 60 * 60 * 1000), wrap(async (req) => analysis.writeAi(req.params.date)));
  app.delete("/api/admin/analysis/day/:date", requireSuper, limiter(30, 10 * 60 * 1000), wrap(async (req) => analysis.remove(req.params.date)));
}

module.exports = { mountAnalysis };
