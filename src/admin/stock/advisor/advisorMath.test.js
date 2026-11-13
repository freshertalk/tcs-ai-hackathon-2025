import { callLabel, dayStillOpen, driftR, headline, planAt, qtyForRisk, rankRows, signedR, tally, ticketFor, verdictOf } from "./advisorMath";

const PROOF = { A: { trades: 40, t: 2.5, expR: 0.05 }, B: { trades: 25, t: 1.5 } };
const SWING = { horizon: 10, stopAtr: 1.5, targetAtr: 2.25 };
const DAY = { horizon: 1, stopAtr: 0.6, targetAtr: null };

const side = (grade, expRLo) => ({ grade, live: grade ? { n: 50, winPct: 60, expR: 0.3, expRLo, fires: true } : null, plan: null, oos: {} });
const row = (symbol, grade, expRLo = 0.1, kind = "swing", s = "long") => ({
  symbol,
  available: true,
  best: grade ? { kind, side: s, grade } : null,
  kinds: { swing: { ...SWING, long: side(kind === "swing" && s === "long" ? grade : null, expRLo), short: side(null) }, day: { ...DAY, long: side(kind === "day" && s === "long" ? grade : null, expRLo), short: side(kind === "day" && s === "short" ? grade : null, expRLo) } },
});

test("the board leads with proven calls, then the cautious average, then the alphabet", () => {
  const rows = [row("ZZZ", null), row("CCC", "C", 0.4), row("BBB", "B", 0.05), row("AA2", "A", 0.1), row("AA1", "A", 0.3), { symbol: "NEW", pending: true }, row("AAA", null)];
  expect(rankRows(rows).map((r) => r.symbol)).toEqual(["AA1", "AA2", "BBB", "CCC", "AAA", "ZZZ", "NEW"]);
  expect(rankRows(null)).toEqual([]);
  expect(headline(rows[3]).grade).toBe("A");
  expect(headline(rows[0])).toBeNull();
  expect(headline({ symbol: "X", pending: true })).toBeNull();
  expect(tally(rows)).toEqual({ A: 2, B: 1, C: 1, none: 2, pending: 1, warnings: 0, total: 7 });
});

test("quantity comes from the money at risk and the distance to the stop", () => {
  expect(qtyForRisk(1000, 12.5)).toBe(80);
  expect(qtyForRisk(1000, 12.6)).toBe(79);
  expect(qtyForRisk(1000, 0)).toBe(0);
  expect(qtyForRisk(0, 10)).toBe(0);
  expect(qtyForRisk(500, 800)).toBe(0);
});

test("a plan is priced from the engine's rules at the price now, on the 5-paise tick", () => {
  const long = planAt(SWING, "long", 801.23, 10);
  expect(long).toEqual({ entryRef: 801.25, stop: 786.25, target: 823.75, riskPerShare: 15, rr: 1.5 });
  const short = planAt(DAY, "short", 500, 8);
  expect(short).toEqual({ entryRef: 500, stop: 504.8, target: null, riskPerShare: 4.8, rr: null });
  expect(planAt(SWING, "long", NaN, 10)).toBeNull();
  expect(planAt(SWING, "long", 100, 0)).toBeNull();
  expect(planAt(null, "long", 100, 2)).toBeNull();
});

test("a day reading is dropped once the price has run from the open", () => {
  const plan = planAt(DAY, "long", 100, 5); // risk 3 a share, stop 97
  expect(driftR("long", plan, 101.5)).toBe(0.5);
  expect(driftR("short", plan, 101.5)).toBe(-0.5);
  expect(dayStillOpen("long", plan, 100.6)).toEqual({ ok: true, drift: 0.2, why: "" });
  expect(dayStillOpen("long", plan, 102).ok).toBe(false);
  expect(dayStillOpen("long", plan, 102).why).toMatch(/already moved 0.7R/);
  expect(dayStillOpen("long", plan, 96.9).why).toMatch(/past this plan's stop/);
  expect(dayStillOpen("long", plan, null).ok).toBe(true);
});

test("a record is put into plain words by the same thresholds the grades use", () => {
  expect(verdictOf({ trades: 140, expR: 0.4, t: 4.4 }, PROOF).id).toBe("proven");
  expect(verdictOf({ trades: 140, expR: 0.12, t: 1.8 }, PROOF).id).toBe("promising");
  expect(verdictOf({ trades: 30, expR: 0.6, t: 3 }, PROOF).id).toBe("promising"); // too few trades to call proven
  expect(verdictOf({ trades: 140, expR: -0.1, t: -1.2 }, PROOF).id).toBe("unproven");
  expect(verdictOf({ trades: 300, expR: -0.17, t: -3.1 }, PROOF).id).toBe("loses");
  expect(verdictOf({ trades: 0, expR: null, t: null }, PROOF).id).toBe("none");
  expect(verdictOf(null, PROOF).id).toBe("none");
});

test("a plan becomes a ticket: side, size for the risk, stop and target carried along", () => {
  const plan = planAt(SWING, "long", 800, 10);
  expect(ticketFor("SBIN", "swing", "long", plan, 3000, "Measured odds · grade A")).toEqual({ symbol: "SBIN", exchange: "NSE", side: "BUY", product: "CNC", quantity: 200, plan: { stop: 785, target: 822.5, risk: 3000, source: "Measured odds · grade A" } });
  const short = ticketFor("SBIN", "day", "short", planAt(DAY, "short", 800, 10), 100);
  expect(short.side).toBe("SELL");
  expect(short.product).toBe("MIS");
  expect(short.quantity).toBe(16);
  // a risk too small for one share still opens a one-share ticket: the ticket shows the real risk
  expect(ticketFor("MRF", "swing", "long", planAt(SWING, "long", 120000, 2000), 500).quantity).toBe(1);
  expect(ticketFor("X", "swing", "long", null, 500)).toBeNull();
});

test("labels", () => {
  expect(callLabel("swing", "long")).toBe("Swing long");
  expect(callLabel("day", "short")).toBe("Day short");
  expect(signedR(0.333)).toBe("+0.33R");
  expect(signedR(-0.2)).toBe("−0.20R");
  expect(signedR(0)).toBe("0.00R");
  expect(signedR(null)).toBe("—");
});
