"use strict";
// HTTP routes for the paper robot (Trade Analysis → Robot). Everything here is paper money and the
// trader's own records, so every route needs the superadmin (like Trade Analysis). There is no route
// that can reach an order: the robot cannot place one.

const { RobotError } = require("./service");

function mountRobot(app, { robot, requireSuper, limiter }) {
  const wrap = (fn) => async (req, res) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      if (err instanceof RobotError || (err && err.code && err.status)) return res.status(err.status || 400).json({ error: err.code || "invalid", message: err.message });
      console.error("[robot]", err && err.message ? err.message : err);
      res.status(500).json({ error: "robot_failed", message: err && err.message ? err.message : "The paper robot failed." });
    }
  };
  const date = (req) => String(req.params.date || "");

  app.get("/api/admin/robot", requireSuper, limiter(240, 60 * 1000), wrap(async () => robot.board()));
  app.get("/api/admin/robot/settings", requireSuper, wrap(async () => robot.settings()));
  app.put("/api/admin/robot/settings", requireSuper, limiter(30, 10 * 60 * 1000), wrap(async (req) => robot.setSettings(req.body || {})));
  app.get("/api/admin/robot/days", requireSuper, limiter(120, 60 * 1000), wrap(async () => ({ days: robot.days(), summary: robot.comparisons() })));
  app.get("/api/admin/robot/day/:date", requireSuper, limiter(60, 60 * 1000), wrap(async (req) => robot.day(date(req))));
  app.get("/api/admin/robot/compare/:date", requireSuper, limiter(60, 60 * 1000), wrap(async (req) => robot.comparison(date(req), { refresh: req.query.refresh === "1" })));
  app.get("/api/admin/robot/learning", requireSuper, limiter(120, 60 * 1000), wrap(async () => robot.learning()));
  app.get("/api/admin/robot/levels", requireSuper, limiter(120, 60 * 1000), wrap(async (req) => robot.levels({ symbol: String(req.query.symbol || "").slice(0, 25) || null })));
  // the robot's own corrections, now (it makes them by itself after every close)
  app.post("/api/admin/robot/improve", requireSuper, limiter(10, 60 * 60 * 1000), wrap(async (req) => {
    const d = String((req.body || {}).date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new RobotError("Say which session to review (YYYY-MM-DD).");
    return { result: await robot.improveDay(d, { by: "manual" }), learning: robot.learning() };
  }));
  // the one-year history, the predictor and its learning points: kept current by the robot itself (no button needed)
  app.get("/api/admin/robot/history", requireSuper, limiter(120, 60 * 1000), wrap(async () => robot.historyView()));
  app.get("/api/admin/robot/predictor", requireSuper, limiter(120, 60 * 1000), wrap(async () => robot.predictor()));
  app.post("/api/admin/robot/learn", requireSuper, limiter(10, 60 * 60 * 1000), wrap(async () => robot.learnNow()));
  app.post("/api/admin/robot/study", requireSuper, limiter(6, 60 * 60 * 1000), wrap(async () => {
    const p = robot.study({ trigger: "manual" });
    p.catch(() => {}); // the page follows the job; a failure is on it
    return { started: true, job: robot.learning().job };
  }));
  app.post("/api/admin/robot/reset-rules", requireSuper, limiter(10, 60 * 60 * 1000), wrap(async () => ({ rules: robot.resetRules() })));
}

module.exports = { mountRobot };
