"use strict";
// HTTP routes for the AI strategist. Every route needs a signed-in admin, and the
// ones that spend tokens are rate-limited. The API key is write-only: it can be
// set, replaced or removed, but no route ever sends it back.

const { AiError } = require("./client");
const { MarketError, SYMBOL_RE } = require("../market/service");
const { KiteError } = require("../market/kite");

function mountAi(app, { ai, requireAdmin, limiter }) {
  const wrap = (fn) => async (req, res) => {
    try {
      res.json(await fn(req, res));
    } catch (err) {
      if (err instanceof AiError || err instanceof MarketError) return res.status(err.status || 400).json({ error: err.code, message: err.message });
      if (err instanceof KiteError) return res.status(502).json({ error: "kite_error", message: `Zerodha said: ${err.message}` });
      console.error("[ai]", err && err.message ? err.message : err);
      res.status(500).json({ error: "ai_failed", message: err && err.message ? err.message : "The AI request failed." });
    }
  };
  const symbolOf = (req) => {
    const s = String(req.params.symbol || "").trim().toUpperCase();
    if (!SYMBOL_RE.test(s)) throw new AiError("That is not a valid symbol.", "invalid", 400);
    return s;
  };

  app.get("/api/admin/ai/status", requireAdmin, wrap(async () => ai.status()));

  app.put("/api/admin/ai/settings", requireAdmin, limiter(30, 15 * 60 * 1000), wrap(async (req) => {
    const b = req.body || {};
    const out = ai.setSettings({ apiKey: b.apiKey, model: b.model, clear: Boolean(b.clear), live: b.live });
    console.log(`[ai] settings changed by ${req.user.email}${b.apiKey ? " (new key)" : ""}${b.clear ? " (key removed)" : ""}`);
    return out;
  }));

  app.post("/api/admin/ai/test", requireAdmin, limiter(10, 10 * 60 * 1000), wrap(async () => ai.test()));

  // builds one strategy: the only route that reads the market AND calls the model
  app.post("/api/admin/ai/strategy/:symbol", requireAdmin, limiter(30, 60 * 60 * 1000), wrap(async (req) => ai.strategy(symbolOf(req), String((req.body || {}).horizon || "both"))));

  app.get("/api/admin/ai/journal", requireAdmin, wrap(async (req) => {
    const s = String(req.query.symbol || "").trim().toUpperCase();
    return ai.entries({ symbol: s && SYMBOL_RE.test(s) ? s : null, limit: 30 });
  }));

  app.post("/api/admin/ai/review", requireAdmin, limiter(12, 60 * 60 * 1000), wrap(async () => ai.review()));

  // the world brief: read the stored one for free, or build a new one (web search + tokens)
  app.get("/api/admin/ai/world", requireAdmin, wrap(async () => ({ brief: ai.world(), fresh: Boolean(ai.worldSummary()), configured: ai.configured() })));

  app.post("/api/admin/ai/world", requireAdmin, limiter(12, 60 * 60 * 1000), wrap(async (req) => ({ brief: await ai.worldBrief({ refresh: Boolean((req.body || {}).refresh) }), fresh: true, configured: true })));

  // the live co-pilot: reading what it has said is free; a new reading spends tokens, and the
  // service itself enforces the minimum gap and the daily limit
  app.get("/api/admin/ai/live/:symbol", requireAdmin, wrap(async (req) => ai.copilot.view(symbolOf(req))));

  app.post("/api/admin/ai/live/:symbol", requireAdmin, limiter(240, 60 * 60 * 1000), wrap(async (req) => {
    const b = req.body || {};
    return ai.copilot.read(symbolOf(req), { reason: String(b.reason || "manual"), event: String(b.event || "") });
  }));

  // "why is it moving?": the stored news check for free, or a new one (web search + tokens)
  app.get("/api/admin/ai/news/:symbol", requireAdmin, wrap(async (req) => {
    const s = symbolOf(req);
    return { news: ai.newsFor(s), fresh: Boolean(ai.newsSummary(s)), configured: ai.configured() };
  }));

  app.post("/api/admin/ai/news/:symbol", requireAdmin, limiter(20, 60 * 60 * 1000), wrap(async (req) => ({ news: await ai.news(symbolOf(req), { refresh: Boolean((req.body || {}).refresh) }), fresh: true, configured: true })));

  // the day debrief: stored ones are free to read; writing one replays the watchlist and spends tokens
  app.get("/api/admin/ai/debrief", requireAdmin, wrap(async () => ai.debrief.list()));

  app.post("/api/admin/ai/debrief", requireAdmin, limiter(12, 60 * 60 * 1000), wrap(async (req) => {
    const b = req.body || {};
    const debrief = await ai.debrief.build({ refresh: Boolean(b.refresh), costPct: b.cost });
    return { debrief, ...ai.debrief.list() };
  }));

  // a suggested lesson goes into the trading-skills file only when it is accepted here
  app.post("/api/admin/ai/debrief/:id/lesson", requireAdmin, wrap(async (req) => ai.debrief.addLesson(String(req.params.id || ""), Number((req.body || {}).index))));

  app.get("/api/admin/ai/skills", requireAdmin, wrap(async () => ({ text: ai.playbook.read(), lessons: ai.playbook.lessons().length })));

  app.put("/api/admin/ai/skills", requireAdmin, wrap(async (req) => {
    try {
      return { text: ai.playbook.write((req.body || {}).text), lessons: ai.playbook.lessons().length };
    } catch (err) {
      throw new AiError(err.message, "invalid", 400);
    }
  }));

  app.post("/api/admin/ai/skills/reset", requireAdmin, wrap(async () => ({ text: ai.playbook.reset(), lessons: 0 })));
}

module.exports = { mountAi };
