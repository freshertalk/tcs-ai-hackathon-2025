import React, { useEffect, useState } from "react";
import { inr, num } from "./format";

// "How many shares?" — answered from the money you are prepared to lose, not from
// how much you would like to make. Capital and risk % are remembered on this device.

const KEY = "vpt-sizer";
const load = () => {
  try {
    return JSON.parse(window.localStorage.getItem(KEY)) || {};
  } catch (_) {
    return {};
  }
};

/** Pure sizing maths, exported for tests. */
export function sizePosition({ capital, riskPct, entry, stop }) {
  const c = Number(capital);
  const rp = Number(riskPct);
  const e = Number(entry);
  const s = Number(stop);
  if (![c, rp, e, s].every(Number.isFinite) || c <= 0 || rp <= 0 || e <= 0 || s <= 0) return { ok: false, reason: "Fill in capital, risk %, entry and stop." };
  if (s >= e) return { ok: false, reason: "For a long trade the stop must be below the entry." };

  const perShare = e - s;
  const budget = (c * rp) / 100;
  const byRisk = Math.floor(budget / perShare);
  const byCash = Math.floor(c / e);
  const qty = Math.max(0, Math.min(byRisk, byCash));
  return {
    ok: true,
    qty,
    cappedByCash: byCash < byRisk,
    perShare,
    stopPct: (perShare / e) * 100,
    budget,
    risk: qty * perShare,
    value: qty * e,
    valuePct: ((qty * e) / c) * 100,
    targets: [1, 2, 3].map((r) => ({ r, price: e + r * perShare, profit: qty * r * perShare })),
  };
}

export default function PositionSizer({ seed }) {
  const saved = load();
  const [capital, setCapital] = useState(saved.capital ?? "500000");
  const [riskPct, setRiskPct] = useState(saved.riskPct ?? "1");
  const [entry, setEntry] = useState("");
  const [stop, setStop] = useState("");

  // A setup's "Size this trade" button, or a newly selected stock, pre-fills the prices.
  // Keyed on seed.at, not on the object: a live price tick must not wipe what was typed.
  const seedKey = seed ? seed.at : null;
  useEffect(() => {
    if (!seed) return;
    setEntry(seed.entry != null ? String(seed.entry) : "");
    setStop(seed.stop != null ? String(seed.stop) : "");
  }, [seedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify({ capital, riskPct }));
    } catch (_) {
      /* private mode: just not remembered */
    }
  }, [capital, riskPct]);

  const r = sizePosition({ capital, riskPct, entry, stop });
  const field = (id, label, value, set, hint, step = "any") => (
    <div className="adm-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="number" inputMode="decimal" min="0" step={step} value={value} onChange={(e) => set(e.target.value)} />
      {hint && <p className="adm-hint">{hint}</p>}
    </div>
  );

  return (
    <section className="an-card" aria-labelledby="size-h">
      <header className="an-card__head">
        <h3 id="size-h">Position size</h3>
        <p>Decide the stop first. The number of shares follows from how much you are willing to lose if it is hit.</p>
      </header>

      <div className="sizer">
        <div className="sizer__in">
          {field("sz-cap", "Trading capital (₹)", capital, setCapital, "", "1000")}
          {field("sz-risk", "Risk per trade (%)", riskPct, setRiskPct, "Many traders keep this between 0.5% and 2%.", "0.1")}
          {field("sz-entry", "Entry price (₹)", entry, setEntry)}
          {field("sz-stop", "Stop-loss (₹)", stop, setStop)}
        </div>

        <div className="sizer__out" aria-live="polite">
          {!r.ok ? (
            <p className="adm-small">{r.reason}</p>
          ) : (
            <>
              <p className="sizer__qty">
                <b>{r.qty.toLocaleString("en-IN")}</b> shares
              </p>
              <dl>
                <div>
                  <dt>Position value</dt>
                  <dd>
                    {inr(r.value, 0)} <small>({num(r.valuePct, 1)}% of capital)</small>
                  </dd>
                </div>
                <div>
                  <dt>Loss if the stop is hit</dt>
                  <dd className="is-down">
                    {inr(r.risk, 0)} <small>({num((r.risk / Number(capital)) * 100, 2)}% of capital)</small>
                  </dd>
                </div>
                <div>
                  <dt>Stop distance</dt>
                  <dd>
                    {inr(r.perShare)} <small>({num(r.stopPct, 1)}%)</small>
                  </dd>
                </div>
                {r.targets.map((t) => (
                  <div key={t.r}>
                    <dt>
                      At {t.r}R — {inr(t.price)}
                    </dt>
                    <dd className="is-up">+{inr(t.profit, 0)}</dd>
                  </div>
                ))}
              </dl>
              {r.cappedByCash && <p className="adm-alert adm-alert--info">The stop is so tight that the risk budget would buy more than your capital allows; the size is capped at what the capital can buy (no leverage).</p>}
              {Number(riskPct) > 2 && <p className="adm-alert adm-alert--error">Risking more than 2% of capital on one trade means a short losing streak does serious damage.</p>}
              {r.qty === 0 && <p className="adm-alert adm-alert--info">The risk budget does not cover even one share at this stop distance.</p>}
              <p className="adm-small">A gap through the stop can lose more than this. Charges and slippage are not included.</p>
            </>
          )}
        </div>
      </div>

      <details className="an-rules">
        <summary>House rules worth re-reading before every trade</summary>
        <ol>
          <li>Know the exit before the entry: where you are wrong (the stop), and what would make you take profit.</li>
          <li>Risk a small, fixed fraction of capital per trade. Survival comes first; returns follow.</li>
          <li>Trade with the larger trend. Most setups here are switched off below the 200-day average on purpose.</li>
          <li>No setup, no trade. Boredom, tips and “it has fallen a lot” are not setups.</li>
          <li>Cut losers at the stop; never widen it. Let winners run to the rule’s exit.</li>
          <li>Never average down on a losing trade, and never use money you cannot afford to lose.</li>
          <li>Check liquidity and upcoming results or events before entering — indicators cannot see news.</li>
          <li>Keep a journal. The backtest shows how a rule behaved; your journal shows how <i>you</i> behave.</li>
        </ol>
      </details>
    </section>
  );
}
