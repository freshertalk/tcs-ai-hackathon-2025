"use strict";
// The daily goal and profit protection: a target, a stop and a guard against giving profits back.
//
//   daily target   3% of the morning's available margin (configurable): reach it and stop for the day
//   daily stop     1.5% of the same margin (half the target, configurable): reach it and stop
//   protection     once the day has been up by 1% of the margin, at least half of the day's best
//                  must be kept; falling below that — or back into a loss — raises a reminder
//   per position   an open position that was up and has given back half of its best gain raises a
//                  reminder with the price that would keep the other half
//
// Built for one habit the owner named: staying in a winning day for "the next, and the next", until
// the gain is gone and the principal follows. Every reminder says what happened in rupees and what
// to do. Nothing here places, changes or cancels an order — the trader acts. (An optional switch can
// copy the target and the stop into the risk guard, which then refuses NEW trades once either is
// reached; exits always go through.)
//
// Pure functions: the trading service supplies the numbers and keeps the day's record.

const IST = 5.5 * 3600 * 1000;
const istDay = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const num = (x) => typeof x === "number" && Number.isFinite(x);
const r0 = (x) => Math.round(x);
const rs = (x) => `₹${Math.round(Math.abs(x)).toLocaleString("en-IN")}`;
const signed = (x) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${rs(x)}`;

const DISCIPLINE_DEFAULTS = {
  enabled: true,
  targetPct: 3, // of the morning's available margin
  stopPct: 1.5, // of the same margin
  protectFromPct: 1, // protection starts once the day has been up this much
  keepPct: 50, // keep at least this share of the day's best
  posGivebackPct: 50, // a position that gives back this share of its best gain raises a reminder
  posMinGain: 500, // ₹: smaller gains are noise
  repeatMin: 10, // a reminder that still holds is repeated after this many minutes
  notify: true, // send reminders to Telegram / WhatsApp when they are set up
  applyToGuard: false, // copy the target and the stop into the risk guard (it refuses new trades)
};

function cleanDiscipline(c = {}) {
  const f = (x, lo, hi, d) => {
    const v = Number(x);
    return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v * 100) / 100)) : d;
  };
  const D = DISCIPLINE_DEFAULTS;
  return {
    enabled: c.enabled === undefined ? D.enabled : Boolean(c.enabled),
    targetPct: f(c.targetPct, 0.25, 20, D.targetPct),
    stopPct: f(c.stopPct, 0.25, 20, D.stopPct),
    protectFromPct: f(c.protectFromPct, 0.1, 20, D.protectFromPct),
    keepPct: f(c.keepPct, 10, 95, D.keepPct),
    posGivebackPct: f(c.posGivebackPct, 10, 95, D.posGivebackPct),
    posMinGain: f(c.posMinGain, 0, 1e7, D.posMinGain),
    repeatMin: f(c.repeatMin, 2, 120, D.repeatMin),
    notify: c.notify === undefined ? D.notify : Boolean(c.notify),
    applyToGuard: Boolean(c.applyToGuard),
  };
}

/**
 * The morning's available margin: Zerodha's opening balance plus collateral (steady through the
 * day), or the live available margin when the opening balance is not reported.
 */
function baseOf(funds) {
  const e = funds && funds.equity;
  if (!e) return null;
  const a = e.available || {};
  const open = (num(a.opening) ? a.opening : 0) + (num(a.collateral) ? a.collateral : 0);
  if (open > 0) return open;
  return num(e.net) && e.net > 0 ? e.net : null;
}

const posKey = (p) => `${p.exchange}:${p.symbol}:${p.product}`;
const dayPnlOf = (net) => net.reduce((a, p) => a + (num(p.m2m) ? p.m2m : num(p.pnl) ? p.pnl : 0), 0);

/**
 * Today's standing and the reminders it raises.
 * @param a { cfg, day (the stored record for today, or null), now, funds, positions: { net } }
 * @returns { standing, day (the record to store), fresh: [events raised now] }
 */
function assess({ cfg, day, now, funds, positions }) {
  const today = istDay(now);
  const rec = day && day.day === today ? { ...day, pos: { ...(day.pos || {}) }, events: [...(day.events || [])], last: { ...(day.last || {}) } } : { day: today, base: null, peak: 0, trough: 0, pos: {}, events: [], last: {} };
  if (!num(rec.base) || rec.base <= 0) rec.base = baseOf(funds);
  const base = rec.base;
  const net = (positions && positions.net) || [];
  const pnl = dayPnlOf(net);
  const open = net.filter((p) => p.quantity !== 0);
  rec.peak = Math.max(rec.peak || 0, pnl);
  rec.trough = Math.min(rec.trough || 0, pnl);

  if (!num(base) || base <= 0) {
    return { standing: { enabled: cfg.enabled, available: false, reason: "The available margin is not known yet (Zerodha has not reported funds).", pnl: r0(pnl), open: open.length }, day: rec, fresh: [] };
  }
  const target = (base * cfg.targetPct) / 100;
  const stop = (base * cfg.stopPct) / 100;
  const protectFrom = (base * cfg.protectFromPct) / 100;
  const protecting = rec.peak >= protectFrom;
  const floor = protecting ? (rec.peak * cfg.keepPct) / 100 : null;
  const gaveBackPct = rec.peak > 0 ? Math.round(((rec.peak - pnl) / rec.peak) * 100) : 0;

  let state = "ok";
  let level = "info";
  let title = "On plan";
  let text = `Today's target is ${rs(target)} (${cfg.targetPct}% of ${rs(base)}); the daily stop is ${rs(stop)}.`;
  let action = "Trade your plan. When the target is reached, stop.";
  if (pnl <= -stop) {
    state = "stop-hit";
    level = "danger";
    title = "Daily stop reached";
    text = `Today is ${signed(pnl)}: the daily stop of ${rs(stop)} (${cfg.stopPct}% of your margin) is reached.`;
    action = open.length ? "Close what is open and stop trading for today. Tomorrow is a new day." : "Stop trading for today. Tomorrow is a new day.";
  } else if (pnl >= target) {
    state = "target-hit";
    level = "success";
    title = "Target reached — stop here";
    text = `Today is ${signed(pnl)}: the target of ${rs(target)} (${cfg.targetPct}% of your margin) is reached.`;
    action = open.length ? "Book what is open now and stop for the day. More trades now put this gain at risk." : "Stop for the day. Walk away with it.";
  } else if (protecting && pnl <= 0) {
    state = "red-after-green";
    level = "danger";
    title = "A green day has turned red";
    text = `You were up ${rs(rec.peak)} today and are now ${signed(pnl)}.`;
    action = "Stop now. Do not try to win it back today — that is how the principal goes.";
  } else if (protecting && pnl < floor) {
    state = "giveback";
    level = "warning";
    title = `You have given back ${gaveBackPct}% of today's best`;
    text = `Today's best was ${signed(rec.peak)}; now ${signed(pnl)}. Keep at least ${rs(floor)} (${cfg.keepPct}% of the best).`;
    action = open.length ? "Book profits or tighten every stop now. Waiting for more is the habit that costs you." : "No more new trades today: keep what is left.";
  } else if (pnl >= 0.8 * target) {
    state = "near-target";
    level = "warning";
    title = "Close to the target";
    text = `Today is ${signed(pnl)} — ${Math.round((pnl / target) * 100)}% of the ${rs(target)} target.`;
    action = "Trail the stops on what is open; book at the target. Do not add new trades now.";
  } else if (protecting) {
    state = "protect";
    level = "info";
    title = "Protect mode";
    text = `Today's best is ${signed(rec.peak)}. From here, keep at least ${rs(floor)}.`;
    action = `If the day falls to ${rs(floor)}, stop.`;
  }

  // per position: a gain that has been given back by half
  const posAlerts = [];
  for (const p of open) {
    const k = posKey(p);
    const gain = num(p.pnl) ? p.pnl : 0;
    const prev = rec.pos[k] || { peak: 0 };
    const peak = Math.max(prev.peak || 0, gain);
    rec.pos[k] = { peak, at: prev.peak === peak ? prev.at : new Date(now).toISOString() };
    const minGain = Math.max(cfg.posMinGain, 0.1 * target);
    if (peak >= minGain && gain <= peak * (1 - cfg.posGivebackPct / 100)) {
      const qty = Math.abs(p.quantity) * (p.multiplier || 1);
      const keepPx = qty > 0 && num(p.average) ? (p.quantity > 0 ? p.average + (0.5 * peak) / qty : p.average - (0.5 * peak) / qty) : null;
      posAlerts.push({
        key: k,
        symbol: p.symbol,
        side: p.quantity > 0 ? "long" : "short",
        peak: r0(peak),
        now: r0(gain),
        keepPrice: num(keepPx) ? Math.round(keepPx * 20) / 20 : null,
        text: `${p.symbol}: was ${signed(peak)}, now ${signed(gain)}.${num(keepPx) ? ` A stop at ₹${(Math.round(keepPx * 20) / 20).toFixed(2)} keeps half the best gain${gain < 0.5 * peak ? " — it is already below that: book it" : ""}.` : ""}`,
      });
    }
  }
  // positions closed today drop out of the per-position record
  for (const k of Object.keys(rec.pos)) if (!open.some((p) => posKey(p) === k)) delete rec.pos[k];

  // reminders: raised when a state or a position alert first appears, and repeated while it holds
  const fresh = [];
  const iso = new Date(now).toISOString();
  const repeatMs = cfg.repeatMin * 60000;
  const raise = (key, ev) => {
    const lastAt = rec.last[key] ? Date.parse(rec.last[key]) : 0;
    const first = !lastAt;
    if (first || now - lastAt >= repeatMs) {
      rec.last[key] = iso;
      const e = { id: `${today}-${key}-${now}`, at: iso, repeat: !first, ...ev };
      rec.events.unshift(e);
      fresh.push(e);
    }
  };
  if (cfg.enabled) {
    if (["stop-hit", "red-after-green", "giveback"].includes(state)) raise(state, { kind: state, level, title, text: `${text} ${action}` });
    // reaching the target or getting close are told once; they repeat only while positions stay open
    if (state === "target-hit" || state === "near-target") {
      if (!rec.last[state] || open.length) raise(state, { kind: state, level, title, text: `${text} ${action}` });
    }
    for (const a of posAlerts) raise(`pos:${a.key}`, { kind: "position-giveback", level: "warning", title: `${a.symbol} is giving back its gain`, text: a.text, symbol: a.symbol });
    // a condition that cleared may raise again later as if new
    const holding = new Set([state, ...posAlerts.map((a) => `pos:${a.key}`)]);
    for (const k of Object.keys(rec.last)) if (!holding.has(k) && k !== "target-hit" && k !== "stop-hit") delete rec.last[k];
  }
  rec.events = rec.events.slice(0, 30);

  return {
    standing: {
      enabled: cfg.enabled,
      available: true,
      day: today,
      base: r0(base),
      target: r0(target),
      stop: r0(stop),
      pnl: r0(pnl),
      peak: r0(rec.peak),
      trough: r0(rec.trough),
      floor: num(floor) ? r0(floor) : null,
      protectFrom: r0(protectFrom),
      protecting,
      gaveBackPct: protecting ? gaveBackPct : 0,
      progressPct: Math.round((pnl / target) * 100),
      open: open.length,
      state,
      level,
      title,
      text,
      action,
      positions: posAlerts,
      events: rec.events.slice(0, 12),
      config: cfg,
    },
    day: rec,
    fresh,
  };
}

module.exports = { DISCIPLINE_DEFAULTS, cleanDiscipline, baseOf, assess, istDay, dayPnlOf };
