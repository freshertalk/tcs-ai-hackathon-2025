"use strict";
// HTTP routes for the Journal's Day book (the daily reports). The figures are the owner's own profit
// and loss, so every route needs the superadmin (like the Journal and Positions); nothing here can
// reach an order. There is no route to save a day by hand: every day is saved by itself (3:45 PM, and
// the hourly sweep for missed days).

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
  // your notes on a day (a note, a rating, lessons, a mood) — the figures are never edited by hand
  app.put("/api/admin/analysis/day/:date", requireSuper, limiter(60, 10 * 60 * 1000), wrap(async (req) => analysis.edit(req.params.date, req.body || {})));
  // the Execution Lab (Trade Analysis): one day replayed, and a period added up
  app.get("/api/admin/analysis/lab/:date", requireSuper, limiter(60, 60 * 1000), wrap(async (req) => analysis.lab(req.params.date, { refresh: req.query.refresh === "1" })));
  app.get("/api/admin/analysis/compare/:date", requireSuper, limiter(60, 60 * 1000), wrap(async (req) => analysis.compare(req.params.date)));
  app.get("/api/admin/analysis/lab", requireSuper, limiter(120, 60 * 1000), wrap(async (req) => analysis.labRange(range(req))));
  // the day's snapshot (the timeline with its timestamps), the outcomes table and the register of learnings
  app.get("/api/admin/analysis/snapshot/:date", requireSuper, limiter(60, 60 * 1000), wrap(async (req) => analysis.snapshot(req.params.date, { refresh: req.query.refresh === "1" })));
  app.get("/api/admin/analysis/snapshots", requireSuper, limiter(120, 60 * 1000), wrap(async (req) => ({ days: analysis.snapshots(range(req)) })));
  app.get("/api/admin/analysis/outcomes", requireSuper, limiter(120, 60 * 1000), wrap(async (req) => analysis.outcomes({ ...range(req), outcome: String(req.query.outcome || "").slice(0, 30) || null, symbol: String(req.query.symbol || "").toUpperCase().slice(0, 30) || null })));
  app.get("/api/admin/analysis/learnings", requireSuper, limiter(120, 60 * 1000), wrap(async () => analysis.learnings()));
  app.post("/api/admin/analysis/learnings", requireSuper, limiter(60, 10 * 60 * 1000), wrap(async (req) => analysis.addLearning(req.body || {})));
  app.put("/api/admin/analysis/learnings/:id", requireSuper, limiter(120, 10 * 60 * 1000), wrap(async (req) => analysis.setLearning(req.params.id, req.body || {})));
  app.delete("/api/admin/analysis/learnings/:id", requireSuper, limiter(60, 10 * 60 * 1000), wrap(async (req) => analysis.removeLearning(req.params.id)));
  app.post("/api/admin/analysis/day/:date/ai", requireSuper, limiter(20, 60 * 60 * 1000), wrap(async (req) => analysis.writeAi(req.params.date)));
  app.delete("/api/admin/analysis/day/:date", requireSuper, limiter(30, 10 * 60 * 1000), wrap(async (req) => analysis.remove(req.params.date)));
}

module.exports = { mountAnalysis };
