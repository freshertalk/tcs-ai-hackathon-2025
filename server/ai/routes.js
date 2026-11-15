"use strict";
// HTTP routes for the AI strategist. Every route needs a signed-in admin, and the
// ones that spend tokens are rate-limited. The API key is write-only: it can be
// set, replaced or removed, but no route ever sends it back.

const { AiError } = require("./client");
const { MarketError, SYMBOL_RE } = require("../market/service");
const { KiteError } = require("../market/kite");

function mountAi(app, { ai, requireAdmin, requireSuper = requireAdmin, limiter }) {
  const kindOf = (req) => {
    const k = String(req.params.kind || "");
    if (k !== "live" && k !== "research") throw new AiError("Unknown kind: use live or research.", "invalid", 400);
    return k;
  };
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
    const out = ai.setSettings({ provider: b.provider ? String(b.provider) : undefined, apiKey: b.apiKey, model: b.model, clear: Boolean(b.clear), live: b.live, use: b.use });
    // never the key itself; the company and model names only (safe characters, so no forged log lines)
    const safe = (x) => String(x || "").replace(/[^A-Za-z0-9._/-]/g, "").slice(0, 80);
    console.log(`[ai] settings changed: ${safe(out.provider)} / ${safe(out.model)}${b.apiKey ? " (new key)" : ""}${b.clear ? " (key removed)" : ""}`);
    return out;
  }));

  app.post("/api/admin/ai/test", requireAdmin, limiter(10, 10 * 60 * 1000), wrap(async (req) => ai.test((req.body || {}).provider)));

  // reads the models a company offers the saved key (no tokens are spent)
  app.post("/api/admin/ai/models", requireAdmin, limiter(30, 10 * 60 * 1000), wrap(async (req) => ai.refreshModels((req.body || {}).provider)));

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

  // pre- and post-market research: a job the page follows; stored reports are free to read
  app.get("/api/admin/ai/research", requireAdmin, wrap(async () => ai.research.status()));
  app.get("/api/admin/ai/research/:id", requireAdmin, wrap(async (req) => ai.research.report(String(req.params.id || ""))));
  app.post("/api/admin/ai/research", requireAdmin, limiter(12, 60 * 60 * 1000), wrap(async (req) => {
    const b = req.body || {};
    return ai.research.start({ symbols: b.symbols, phase: b.phase, news: Boolean(b.news), world: Boolean(b.world), useAi: b.useAi !== false });
  }));

  // the AI decision: today's live brief weighed against the stock's stored behaviour profile
  app.get("/api/admin/ai/decision/:symbol", requireAdmin, wrap(async (req) => ai.decision.list(symbolOf(req))));
  app.post("/api/admin/ai/decision/:symbol", requireAdmin, limiter(40, 60 * 60 * 1000), wrap(async (req) => ({ decision: await ai.decision.decide(symbolOf(req)), ...ai.decision.list(symbolOf(req)) })));

  /* ---- AI Live and AI Research: the desk's own arithmetic answers first and needs no AI; the
     analysts (free NVIDIA-hosted models, plus one optional paid lead that does the web search)
     are started only by these buttons, for the stock that is open. */
  app.get("/api/admin/ai/pulse/:symbol", requireAdmin, limiter(300, 60 * 1000), wrap(async (req) => ai.ensemble.pulse(symbolOf(req))));

  app.get("/api/admin/ai/outlook/:symbol", requireAdmin, limiter(90, 60 * 1000), wrap(async (req) => {
    const { brief, verdict, sheet, ...rest } = await ai.ensemble.outlook(symbolOf(req));
    void brief;
    void verdict;
    void sheet;
    return rest;
  }));

  // the NSE forecast from the world: GIFT Nifty, the US, Europe, Asia, the rupee, crude, VIX, FII flows,
  // the Nifty option chain and today's world brief — arithmetic only, no AI is called
  app.get("/api/admin/ai/forecast", requireAdmin, limiter(120, 60 * 1000), wrap(async () => ai.ensemble.forecast()));

  // the intraday plan for the next session: arithmetic only (the outlook, the stock's intraday habits,
  // the plan's replayed record, the expected open) — no AI is called
  app.get("/api/admin/ai/intraday/:symbol", requireAdmin, limiter(120, 60 * 1000), wrap(async (req) => ai.ensemble.intraday(symbolOf(req))));

  app.get("/api/admin/ai/ensemble/status", requireAdmin, wrap(async () => {
    await ai.ensemble.score();
    return ai.ensemble.status();
  }));

  app.put("/api/admin/ai/ensemble/settings", requireAdmin, limiter(40, 15 * 60 * 1000), wrap(async (req) => ai.ensemble.setSettings(req.body || {})));

  // one run reads the page's stock with up to eight models at once: a limit keeps a stuck button from spending
  app.post("/api/admin/ai/ensemble/:kind/:symbol", requireAdmin, limiter(30, 10 * 60 * 1000), wrap(async (req) => ai.ensemble.start(kindOf(req), symbolOf(req), { freeOnly: Boolean((req.body || {}).freeOnly) })));

  app.get("/api/admin/ai/ensemble/job/:id", requireAdmin, limiter(600, 60 * 1000), wrap(async (req) => ai.ensemble.job(req.params.id)));

  app.get("/api/admin/ai/ensemble/:kind/:symbol", requireAdmin, wrap(async (req) => ({ last: ai.ensemble.last(kindOf(req), symbolOf(req)) })));

  app.get("/api/admin/ai/skills", requireSuper, wrap(async () => ({ text: ai.playbook.read(), lessons: ai.playbook.lessons().length })));

  app.put("/api/admin/ai/skills", requireSuper, wrap(async (req) => {
    try {
      return { text: ai.playbook.write((req.body || {}).text), lessons: ai.playbook.lessons().length };
    } catch (err) {
      throw new AiError(err.message, "invalid", 400);
    }
  }));

  app.post("/api/admin/ai/skills/reset", requireSuper, wrap(async () => ({ text: ai.playbook.reset(), lessons: 0 })));

  /* ---- AI brains and the AI Engine (superadmin only: the owner's own instructions for the AI) */
  const by = (req) => (req.user && req.user.email) || "";
  const idOf = (req) => {
    const id = String(req.params.id || "");
    if (!/^[a-f0-9]{12}$/.test(id)) throw new AiError("That is not a brain.", "invalid", 400);
    return id;
  };
  app.get("/api/admin/ai/brains", requireSuper, wrap(async () => ai.brains.list()));
  // save (new or edited); with refine, the AI team writes it first (this can take a minute or two)
  app.post("/api/admin/ai/brains", requireSuper, limiter(30, 60 * 60 * 1000), wrap(async (req) => ai.brains.save(req.body || {}, by(req))));
  app.post("/api/admin/ai/brains/:id/revert", requireSuper, limiter(60, 15 * 60 * 1000), wrap(async (req) => ai.brains.revert(idOf(req), req.body || {}, by(req))));
  app.put("/api/admin/ai/brains/:id/enabled", requireSuper, limiter(120, 15 * 60 * 1000), wrap(async (req) => ai.brains.setEnabled(idOf(req), (req.body || {}).enabled)));
  app.post("/api/admin/ai/brains/:id/move", requireSuper, limiter(120, 15 * 60 * 1000), wrap(async (req) => ai.brains.move(idOf(req), (req.body || {}).dir === "up" ? "up" : "down")));
  app.delete("/api/admin/ai/brains/:id", requireSuper, limiter(60, 15 * 60 * 1000), wrap(async (req) => ai.brains.remove(idOf(req))));
  // every feature's real instructions as they are sent now, with the brains that are added to them
  app.get("/api/admin/ai/engine", requireSuper, wrap(async () => ({ features: ai.brains.prompts(), skills: { text: ai.playbook.read(), lessons: ai.playbook.lessons().length }, team: ai.brains.teamStatus(), live: ai.engine.status() })));
  // the engine's live board: what every feature is asking the models now, and today's counts
  app.get("/api/admin/ai/engine/live", requireAdmin, wrap(async () => ai.engine.status()));
}

module.exports = { mountAi };
