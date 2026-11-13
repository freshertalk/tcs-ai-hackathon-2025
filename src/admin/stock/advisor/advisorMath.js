// Arithmetic for the Advisor: ordering the board, sizing a trade by the money at risk,
// re-pricing a plan when the price has moved, and putting a record into plain words.
// Pure, so it is tested without a page.

const fin = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => Math.round(x * 100) / 100;
const TICK = 0.05;
const onTick = (x) => r2(Math.round(x / TICK) * TICK);

export const GRADE_RANK = { A: 3, B: 2, C: 1 };
export const GRADE_WORD = { A: "Proven", B: "Promising", C: "Unproven" };
export const KIND_LABEL = { swing: "Swing", day: "Day" };
export const SIDE_LABEL = { long: "long", short: "short" };

export const callLabel = (kind, side) => `${KIND_LABEL[kind] || kind} ${SIDE_LABEL[side] || side}`;
export const signedR = (x, d = 2) => (fin(x) ? `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(d)}R` : "—");

/** The reading a row leads with: its best graded call, or null. */
export function headline(row) {
  if (!row || !row.available || !row.best) return null;
  const k = row.kinds[row.best.kind];
  return { kind: row.best.kind, side: row.best.side, rules: k, ...k[row.best.side] };
}

/** The board in the order it should be read: proven calls first, then by the cautious average. */
export function rankRows(rows) {
  const score = (r) => {
    if (!r || !r.available) return [-1, 0];
    const h = headline(r);
    if (!h) return [0, 0];
    return [GRADE_RANK[h.grade] || 0, h.live ? h.live.expRLo : 0];
  };
  return (rows || []).slice().sort((a, b) => {
    const x = score(a);
    const y = score(b);
    return y[0] - x[0] || y[1] - x[1] || String(a.symbol).localeCompare(String(b.symbol));
  });
}

/** Shares for a chosen money risk: the risk divided by the distance to the stop, rounded down. */
export function qtyForRisk(risk, riskPerShare) {
  if (!(risk > 0) || !(riskPerShare > 0)) return 0;
  return Math.floor(risk / riskPerShare + 1e-9);
}

/**
 * The engine's rules applied at a given price. The stored plan was priced when the reading
 * was made; a swing entry is taken at the price now, so its stop and target move with it.
 */
export function planAt(rules, side, ref, atr) {
  if (!rules || !fin(ref) || !fin(atr) || !(ref > 0) || !(atr > 0)) return null;
  const long = side === "long";
  const risk = rules.stopAtr * atr;
  const hasTarget = rules.targetAtr !== null && rules.targetAtr !== undefined;
  return {
    entryRef: onTick(ref),
    stop: onTick(long ? ref - risk : ref + risk),
    target: hasTarget ? onTick(long ? ref + rules.targetAtr * atr : ref - rules.targetAtr * atr) : null,
    riskPerShare: r2(risk),
    rr: hasTarget ? r2(rules.targetAtr / rules.stopAtr) : null,
  };
}

/**
 * How far the price has run from a plan's entry, in R: above zero it has gone the plan's
 * way (the entry is gone), below zero against it. A day reading is measured from the open.
 */
export function driftR(side, plan, last) {
  if (!plan || !fin(last) || !(plan.riskPerShare > 0) || !fin(plan.entryRef)) return null;
  return r2((side === "long" ? last - plan.entryRef : plan.entryRef - last) / plan.riskPerShare);
}

/** Is a day reading still usable at this price? Not once it is past the stop or half an R gone. */
export function dayStillOpen(side, plan, last) {
  const d = driftR(side, plan, last);
  if (d === null) return { ok: true, drift: null, why: "" };
  if (d <= -1) return { ok: false, drift: d, why: "The price is already past this plan's stop." };
  if (d >= 0.5) return { ok: false, drift: d, why: `The price has already moved ${d.toFixed(1)}R from the open; the measured odds were for an entry at the open.` };
  return { ok: true, drift: d, why: "" };
}

/** A walk-forward or forward record in plain words. `rec`: { trades, expR, t } */
export function verdictOf(rec, proof) {
  if (!rec || !rec.trades) return { id: "none", text: "Nothing to judge yet" };
  const t = fin(rec.t) ? rec.t : null;
  if (t !== null && rec.trades >= proof.A.trades && t >= proof.A.t && rec.expR > proof.A.expR) return { id: "proven", text: "Held up" };
  if (t !== null && rec.trades >= proof.B.trades && t >= proof.B.t && rec.expR > 0) return { id: "promising", text: "Positive, not conclusive" };
  if (t !== null && t <= -proof.B.t && rec.expR < 0) return { id: "loses", text: "Lost money after costs" };
  return { id: "unproven", text: "No edge shown" };
}

/**
 * The order ticket a plan turns into: the side, the quantity for the chosen risk, and the
 * stop and target to carry along. A swing long is delivery (CNC); everything else is intraday.
 */
export function ticketFor(symbol, kind, side, plan, risk, source = "") {
  if (!plan) return null;
  const qty = qtyForRisk(risk, plan.riskPerShare);
  return {
    symbol,
    exchange: "NSE",
    side: side === "long" ? "BUY" : "SELL",
    product: kind === "swing" && side === "long" ? "CNC" : "MIS",
    quantity: Math.max(1, qty),
    plan: { stop: plan.stop, target: plan.target, risk: risk > 0 ? risk : null, source },
  };
}

/** Counts for the strip above the board. */
export function tally(rows) {
  const t = { A: 0, B: 0, C: 0, none: 0, pending: 0, warnings: 0, total: (rows || []).length };
  for (const r of rows || []) {
    if (!r.available) {
      if (r.pending || !r.reason) t.pending += 1;
      else t.none += 1;
      continue;
    }
    if (r.warning) t.warnings += 1;
    if (r.best && t[r.best.grade] !== undefined) t[r.best.grade] += 1;
    else t.none += 1;
  }
  return t;
}
