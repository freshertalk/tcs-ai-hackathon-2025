// The custom scanner on the Screener: put conditions together (RSI, price against an average, an
// average crossing another, the change over N days, near the 52-week high or low, a streak of up or
// down days, today's change) and find every Nifty 500 stock that passes them all — on daily closes
// with today's live price as the newest bar. Ready-made presets, and scans you save.

import React, { useEffect, useState } from "react";
import { api } from "../../api";
import { Alert } from "../../ui";
import { compact, isNum, num, when } from "./format";

const NEW = {
  rsi: { type: "rsi", period: 14, op: "above", a: 60, b: 70 },
  ma: { type: "ma", kind: "sma", period: 200, op: "above" },
  cross: { type: "cross", kind: "sma", fast: 50, slow: 200, dir: "above", within: 5 },
  change: { type: "change", days: 20, op: "above", value: 5 },
  high52: { type: "high52", within: 3 },
  low52: { type: "low52", within: 3 },
  streak: { type: "streak", dir: "up", days: 3 },
  today: { type: "today", op: "above", value: 2 },
};
const LABEL = { rsi: "RSI", ma: "Price vs average", cross: "Average crossing", change: "Change over days", high52: "Near 52-week high", low52: "Near 52-week low", streak: "Up/down streak", today: "Today’s change" };

export const PRESETS = [
  { name: "Golden cross this week", conditions: [NEW.cross] },
  { name: "Pullback in an uptrend", conditions: [{ ...NEW.ma, period: 200, op: "above" }, { type: "ma", kind: "ema", period: 20, op: "below" }, { type: "rsi", period: 14, op: "below", a: 45 }] },
  { name: "Strong near the 52-week high", conditions: [{ type: "high52", within: 3 }, { type: "rsi", period: 14, op: "above", a: 60 }] },
  { name: "Sharp dip in an uptrend (RSI-2)", conditions: [{ ...NEW.ma, period: 200, op: "above" }, { type: "rsi", period: 2, op: "below", a: 10 }] },
  { name: "Five up days in a row", conditions: [{ type: "streak", dir: "up", days: 5 }] },
  { name: "Momentum: up 10% in a month", conditions: [{ type: "change", days: 21, op: "above", value: 10 }, { ...NEW.ma, period: 50, op: "above" }] },
  { name: "Weak: below 200-day, near 52-week low", conditions: [{ ...NEW.ma, period: 200, op: "below" }, { type: "low52", within: 5 }] },
];

const n = (v) => (v === "" ? "" : Number(v));

function Cond({ c, onChange, onRemove }) {
  const set = (k) => (e) => onChange({ ...c, [k]: e.target.type === "number" ? n(e.target.value) : e.target.value });
  const small = (k, w = 64, step = 1) => <input type="number" step={step} value={c[k]} onChange={set(k)} style={{ width: w }} aria-label={k} />;
  const sel = (k, opts) => (
    <select value={c[k]} onChange={set(k)} aria-label={k}>
      {opts.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
  let body = null;
  if (c.type === "rsi")
    body = (
      <>
        RSI({small("period", 52)}) {sel("op", [["above", "at least"], ["below", "at most"], ["between", "between"]])} {small("a", 60, 0.5)}
        {c.op === "between" && <> and {small("b", 60, 0.5)}</>}
      </>
    );
  else if (c.type === "ma") body = <>price {sel("op", [["above", "above"], ["below", "below"]])} its {small("period", 60)}-day {sel("kind", [["sma", "SMA"], ["ema", "EMA"]])}</>;
  else if (c.type === "cross")
    body = (
      <>
        {small("fast", 56)}-day {sel("kind", [["sma", "SMA"], ["ema", "EMA"]])} crossed {sel("dir", [["above", "above"], ["below", "below"]])} the {small("slow", 60)}-day in the last {small("within", 52)} sessions
      </>
    );
  else if (c.type === "change") body = <>{small("days", 56)}-day change {sel("op", [["above", "at least"], ["below", "at most"]])} {small("value", 64, 0.5)}%</>;
  else if (c.type === "high52") body = <>within {small("within", 56, 0.5)}% of the 52-week high</>;
  else if (c.type === "low52") body = <>within {small("within", 56, 0.5)}% of the 52-week low</>;
  else if (c.type === "streak") body = <>closed {sel("dir", [["up", "up"], ["down", "down"]])} {small("days", 52)} days in a row</>;
  else body = <>today’s change {sel("op", [["above", "at least"], ["below", "at most"]])} {small("value", 64, 0.5)}%</>;
  return (
    <li className="cs-cond">
      <span className="cs-cond__k">{LABEL[c.type]}</span>
      <span className="cs-cond__b">{body}</span>
      <button type="button" className="cs-x" onClick={onRemove} aria-label="Remove this condition">
        ×
      </button>
    </li>
  );
}

export default function CustomScan({ onOpen }) {
  const [conds, setConds] = useState(PRESETS[1].conditions);
  const [liquid, setLiquid] = useState(5);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState([]);
  const [name, setName] = useState("");
  useEffect(() => {
    api("/api/admin/market/scans").then((d) => setSaved(d.scans || [])).catch(() => {});
  }, []);
  const run = async (list = conds) => {
    setBusy(true);
    setErr("");
    try {
      setRes(await api("/api/admin/market/screener/custom", { method: "POST", body: { conditions: list, minTurnover: liquid } }));
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  };
  const load = (list) => {
    setConds(list.map((c) => ({ ...c })));
    setRes(null);
  };
  const save = async () => {
    try {
      const d = await api("/api/admin/market/scans", { method: "POST", body: { name, conditions: conds } });
      setSaved(d.scans);
      setName("");
    } catch (e) {
      setErr(e.message);
    }
  };
  const drop = async (id) => {
    const d = await api(`/api/admin/market/scans/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
    if (d) setSaved(d.scans);
  };
  return (
    <section className="an-card cs" aria-labelledby="cs-h">
      <header className="an-card__head">
        <div>
          <h3 id="cs-h">Custom scanner · NIFTY 500</h3>
          <p>Put conditions together and find every Nifty 500 stock that passes all of them — on daily closes, with today’s live price as the newest bar. Start from a preset or one of your saved scans.</p>
        </div>
      </header>
      <div className="cs-presets" role="group" aria-label="Presets and saved scans">
        {PRESETS.map((p) => (
          <button key={p.name} type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => load(p.conditions)}>
            {p.name}
          </button>
        ))}
        {saved.map((sv) => (
          <span key={sv.id} className="cs-saved">
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => load(sv.conditions)} data-tip="Your saved scan">
              ★ {sv.name}
            </button>
            <button type="button" className="cs-x" onClick={() => drop(sv.id)} aria-label={`Delete the saved scan ${sv.name}`}>
              ×
            </button>
          </span>
        ))}
      </div>
      <ol className="cs-conds">
        {conds.map((c, i) => (
          <Cond key={i} c={c} onChange={(x) => setConds(conds.map((y, k) => (k === i ? x : y)))} onRemove={() => setConds(conds.filter((_, k) => k !== i))} />
        ))}
      </ol>
      <div className="cs-bar">
        <select value="" onChange={(e) => e.target.value && setConds([...conds, { ...NEW[e.target.value] }])} disabled={conds.length >= 6} aria-label="Add a condition">
          <option value="">+ Add a condition…</option>
          {Object.keys(NEW).map((k) => (
            <option key={k} value={k}>
              {LABEL[k]}
            </option>
          ))}
        </select>
        <label className="cs-liq">
          Traded value at least
          <select value={liquid} onChange={(e) => setLiquid(Number(e.target.value))}>
            {[0, 1, 5, 25, 100].map((v) => (
              <option key={v} value={v}>
                {v ? `₹${v} Cr a day` : "any"}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="adm-btn adm-btn--solid adm-btn--sm" onClick={() => run()} disabled={busy || !conds.length}>
          {busy ? "Scanning…" : "Scan"}
        </button>
        <input className="cs-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Name to save this scan" aria-label="Name of the scan" />
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={save} disabled={!name.trim() || !conds.length}>
          Save scan
        </button>
      </div>
      <Alert>{err}</Alert>
      {res && !res.ready && <p className="vd-note">The stock list has not been downloaded yet — press “Download the Nifty 500” in the RSI search below first.</p>}
      {res && res.ready && (
        <>
          <p className="vd-note">
            <b>{res.matched}</b> of {res.considered} stocks pass: {res.conditions.join(" · ")}. {res.live ? "Live prices" : `Closes of ${res.session}`} · {when(res.at)}
            {res.skipped.outOfDate ? ` · ${res.skipped.outOfDate} left out (history being refreshed)` : ""}
            {res.truncated ? " · showing the first 600" : ""}
          </p>
          {res.rows.length > 0 && (
            <div className="bt__scroll">
              <table className="an-table cs-table">
                <thead>
                  <tr>
                    <th scope="col">Stock</th>
                    <th scope="col" className="is-num">Price</th>
                    <th scope="col" className="is-num">Today</th>
                    <th scope="col" className="is-num">RSI (14)</th>
                    <th scope="col" className="is-num">Volume</th>
                    <th scope="col" className="is-num">Avg traded value</th>
                  </tr>
                </thead>
                <tbody>
                  {res.rows.map((r) => (
                    <tr key={r.symbol}>
                      <th scope="row">
                        <button type="button" className="bt__pick" onClick={() => onOpen && onOpen(r.symbol)}>
                          {r.symbol}
                        </button>{" "}
                        <small>{r.name}</small>
                      </th>
                      <td className="is-num">₹{num(r.last, 2)}</td>
                      <td className={`is-num ${r.changePct > 0 ? "is-up" : r.changePct < 0 ? "is-down" : ""}`}>{isNum(r.changePct) ? `${r.changePct > 0 ? "+" : ""}${num(r.changePct, 2)}%` : "—"}</td>
                      <td className="is-num">{isNum(r.rsi) ? num(r.rsi, 1) : "—"}</td>
                      <td className="is-num">{compact(r.volume)}</td>
                      <td className="is-num">{isNum(r.avgTurnoverCr) ? `₹${num(r.avgTurnoverCr, r.avgTurnoverCr < 10 ? 1 : 0)} Cr` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="adm-small">A scan finds stocks that fit a description; it does not say they will move. Open one on the desk for its full reading. Not investment advice.</p>
        </>
      )}
    </section>
  );
}
