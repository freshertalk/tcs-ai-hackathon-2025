import React, { useEffect, useState } from "react";
import { api } from "../../api";
import { Alert, Loading } from "../../ui";
import { day, inr, isNum, num, pct, tone } from "./format";

const enc = encodeURIComponent;

function Equity({ equity }) {
  const W = 1000;
  const H = 180;
  const vals = equity.map((p) => p.v);
  const lo = Math.min(...vals, 1);
  const hi = Math.max(...vals, 1);
  const x = (i) => (i / Math.max(1, equity.length - 1)) * W;
  const y = (v) => 8 + ((hi - v) / (hi - lo || 1)) * (H - 16);
  const d = equity.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
  const end = vals[vals.length - 1];
  return (
    <svg className="bt__eq" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Equity curve: ₹1 became ₹${end.toFixed(2)}`} preserveAspectRatio="none">
      <line className="pc__grid" x1="0" x2={W} y1={y(1)} y2={y(1)} />
      <path className={end >= 1 ? "bt__line is-up" : "bt__line is-down"} d={d} />
    </svg>
  );
}

export default function BacktestPanel({ symbol }) {
  const [cost, setCost] = useState("0.3");
  const [all, setAll] = useState({ loading: true });
  const [pick, setPick] = useState(null);
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    let alive = true;
    setAll({ loading: true });
    setPick(null);
    setDetail(null);
    api(`/api/admin/market/backtest/${enc(symbol)}?cost=${enc(cost)}`)
      .then((d) => alive && setAll({ loading: false, data: d }))
      .catch((e) => alive && setAll({ loading: false, error: e.message }));
    return () => {
      alive = false;
    };
  }, [symbol, cost]);

  useEffect(() => {
    if (!pick) return undefined;
    let alive = true;
    setDetail({ loading: true });
    api(`/api/admin/market/backtest/${enc(symbol)}?strategy=${enc(pick)}&cost=${enc(cost)}`)
      .then((d) => alive && setDetail({ loading: false, data: d }))
      .catch((e) => alive && setDetail({ loading: false, error: e.message }));
    return () => {
      alive = false;
    };
  }, [pick, symbol, cost]);

  const rows = all.data ? all.data.rows : [];
  const first = rows.find((r) => r.stats.enoughData);

  return (
    <section className="an-card" aria-labelledby="bt-h">
      <header className="an-card__head">
        <div>
          <h3 id="bt-h">Backtest on this stock</h3>
          <p>
            How each setup would have done on <b>{symbol}</b>’s own history: buy at the next day’s open after a signal, one
            position at a time, no leverage, costs included.
          </p>
        </div>
        <label className="bt__cost">
          Costs per round trip
          <select value={cost} onChange={(e) => setCost(e.target.value)}>
            <option value="0">0% (unrealistic)</option>
            <option value="0.15">0.15%</option>
            <option value="0.3">0.3% (delivery, typical)</option>
            <option value="0.5">0.5%</option>
            <option value="1">1% (illiquid)</option>
          </select>
        </label>
      </header>

      {all.data && all.data.source === "demo" && (
        <p className="adm-alert adm-alert--error">
          <b>Demo series.</b> These prices are generated, not real, so the results below only show how the page works — they say nothing about
          how any rule performs on a real stock.
        </p>
      )}
      {all.loading && <Loading label="Running the backtests…" />}
      <Alert>{all.error}</Alert>

      {first && (
        <>
          <p className="adm-small">
            Tested {day(first.stats.from)} → {day(first.stats.to)} ({first.stats.years} years). Buy &amp; hold over the same period:{" "}
            <b>{pct(first.stats.buyHoldCagrPct, 1)}</b> a year, worst fall −{num(first.stats.buyHoldMaxDrawdownPct, 1)}%.
          </p>
          <div className="bt__scroll">
            <table className="an-table bt__table">
              <thead>
                <tr>
                  <th scope="col">Setup</th>
                  <th scope="col">Trades</th>
                  <th scope="col">Win rate</th>
                  <th scope="col">Avg win / loss</th>
                  <th scope="col">Per trade</th>
                  <th scope="col">Profit factor</th>
                  <th scope="col">Return / yr</th>
                  <th scope="col">Worst fall</th>
                  <th scope="col">In market</th>
                  <th scope="col">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const s = r.stats;
                  return (
                    <tr key={r.id} className={pick === r.id ? "is-picked" : ""}>
                      <th scope="row">
                        <button type="button" className="bt__pick" onClick={() => setPick(pick === r.id ? null : r.id)} aria-expanded={pick === r.id}>
                          {r.name}
                        </button>
                      </th>
                      <td>{s.trades}</td>
                      <td>{isNum(s.winRatePct) ? `${s.winRatePct}%` : "—"}</td>
                      <td>
                        <span className="is-up">{pct(s.avgWinPct, 1)}</span> / <span className="is-down">{pct(s.avgLossPct, 1)}</span>
                      </td>
                      <td className={`is-${tone(s.expectancyPct)}`}>{pct(s.expectancyPct)}</td>
                      <td>{isNum(s.profitFactor) ? num(s.profitFactor) : "—"}</td>
                      <td className={`is-${tone(s.cagrPct)}`}>
                        {pct(s.cagrPct, 1)}
                        <small>{isNum(s.cagrPct) && isNum(s.buyHoldCagrPct) ? (s.cagrPct > s.buyHoldCagrPct ? " beat hold" : " below hold") : ""}</small>
                      </td>
                      <td className="is-down">−{num(s.maxDrawdownPct, 1)}%</td>
                      <td>{num(s.exposurePct, 0)}%</td>
                      <td>
                        <span className={`an-chip ${s.reliability === "reasonable" ? "an-chip--bullish" : "an-chip--neutral"}`}>{s.reliability}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="adm-small">Select a setup’s name to see its equity curve and every trade.</p>
        </>
      )}
      {all.data && !first && <p className="adm-alert adm-alert--info">There is not enough history to backtest this stock (about 200 trading days are needed before the first signal can be judged).</p>}

      {pick && detail && (
        <div className="bt__detail">
          {detail.loading && <Loading label="Loading trades…" />}
          <Alert>{detail.error}</Alert>
          {detail.data && (
            <>
              <h4>{detail.data.strategy.name}</h4>
              {detail.data.equity.length > 1 && <Equity equity={detail.data.equity} />}
              <p className="adm-small">
                ₹1 at the start became ₹{num(detail.data.equity.length ? detail.data.equity[detail.data.equity.length - 1].v : 1)} — worst losing streak{" "}
                {detail.data.stats.worstLosingStreak} trades, average hold {detail.data.stats.avgBars ?? "—"} bars.
              </p>
              {detail.data.open && (
                <p className="adm-alert adm-alert--info">
                  A position is still open: bought {day(detail.data.open.entryDate)} at {inr(detail.data.open.entry)}, stop {inr(detail.data.open.stop)}, currently{" "}
                  {pct(detail.data.open.unrealisedPct)}.
                </p>
              )}
              <div className="bt__scroll">
                <table className="an-table bt__table">
                  <thead>
                    <tr>
                      <th scope="col">Bought</th>
                      <th scope="col">At</th>
                      <th scope="col">Sold</th>
                      <th scope="col">At</th>
                      <th scope="col">Days</th>
                      <th scope="col">Result</th>
                      <th scope="col">R</th>
                      <th scope="col">Why it closed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...detail.data.trades].reverse().map((t) => (
                      <tr key={`${t.entryDate}${t.exitDate}`}>
                        <td>{day(t.entryDate)}</td>
                        <td>{num(t.entry)}</td>
                        <td>{day(t.exitDate)}</td>
                        <td>{num(t.exit)}</td>
                        <td>{t.bars}</td>
                        <td className={`is-${tone(t.returnPct)}`}>{pct(t.returnPct)}</td>
                        <td className={`is-${tone(t.r)}`}>{isNum(t.r) ? `${t.r > 0 ? "+" : ""}${num(t.r, 1)}R` : "—"}</td>
                        <td>{t.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {detail.data.trades.length === 0 && <p className="adm-small">This setup never triggered on this stock in the tested period.</p>}
            </>
          )}
        </div>
      )}

      <div className="an-cautions">
        <h4>Read this before trusting any row</h4>
        <ul>
          <li>The past does not repeat on request. A rule that worked on this stock can stop working.</li>
          <li>Few trades prove little — the “Evidence” column says when there are too few to tell skill from luck.</li>
          <li>Seven rules were tried on one stock: the best row is partly luck (it is the best <i>because</i> you looked at seven).</li>
          <li>Prices are adjusted for splits and bonuses; dividends, taxes and your own slippage are not modelled.</li>
        </ul>
      </div>
    </section>
  );
}
