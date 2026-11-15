// Research → Intraday research: tomorrow's intraday plan for every stock you pick — your watchlist,
// plus any NSE symbol you type. One row per stock (the decision, the expected open and range, the
// trigger, stop and target, the plan's replayed record), ranked with the clearest plans first; open a
// row for the whole plan. Arithmetic only (server/market/intraplan.js) — no AI, no tokens, no orders.

import React, { useMemo, useState } from "react";
import { api } from "../../api";
import IntradayPlan, { KIND, sessionOf } from "../analyzer/IntradayPlan";
import { inr, num, pct } from "../analyzer/format";
import { formatDate } from "../holidays";
import "../analyzer/intraplan.css";

const SYMBOL_RE = /^[A-Z0-9][A-Z0-9&._-]{0,24}$/;
const MAX = 20;
const RANK = { long: 0, short: 0, orb: 1, wait: 2, avoid: 3 };

function trigger(p) {
  const d = p.decision;
  if (d.kind === "long" || d.kind === "short") {
    const pl = p.plans[d.kind];
    return `${d.kind === "long" ? "above" : "below"} ${inr(pl.entry)} · stop ${inr(pl.stop)} · target ${inr(pl.targets[0])}`;
  }
  if (d.kind === "orb") return "break of the 9:15–9:30 range, either side";
  if (d.kind === "avoid") return d.why;
  if (p.open.expected > p.plans.long.entry || p.open.expected < p.plans.short.entry) return "a gap past yesterday's levels is expected: watch the 9:15–9:30 range";
  return `watch ${inr(p.plans.long.entry)} up / ${inr(p.plans.short.entry)} down after 9:45`;
}

export default function IntradayResearch({ watchlist = [], onOpen = null }) {
  const [picked, setPicked] = useState(() => new Set(watchlist.slice(0, MAX)));
  const [extra, setExtra] = useState([]);
  const [typed, setTyped] = useState("");
  const [rows, setRows] = useState({}); // symbol -> plan | { error }
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, of: 0, current: "" });
  const [open, setOpen] = useState("");
  const [note, setNote] = useState("");

  const all = useMemo(() => [...new Set([...watchlist, ...extra])], [watchlist, extra]);
  const toggle = (s) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(s)) n.delete(s);
      else if (n.size < MAX) n.add(s);
      return n;
    });

  const add = () => {
    const list = typed
      .toUpperCase()
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const bad = list.filter((s) => !SYMBOL_RE.test(s));
    const good = list.filter((s) => SYMBOL_RE.test(s));
    setExtra((e) => [...new Set([...e, ...good])]);
    setPicked((p) => {
      const n = new Set(p);
      for (const s of good) if (n.size < MAX) n.add(s);
      return n;
    });
    setTyped("");
    setNote(bad.length ? `Not an NSE symbol: ${bad.join(", ")}` : "");
  };

  const run = async () => {
    const list = all.filter((s) => picked.has(s));
    if (!list.length) return;
    setBusy(true);
    setOpen("");
    setRows({});
    setProgress({ done: 0, of: list.length, current: list[0] });
    // one stock at a time: each plan reads months of 5-minute bars, and Zerodha limits how fast
    for (let i = 0; i < list.length; i += 1) {
      const s = list[i];
      setProgress({ done: i, of: list.length, current: s });
      try {
        const p = await api(`/api/admin/ai/intraday/${encodeURIComponent(s)}`);
        setRows((r) => ({ ...r, [s]: p }));
      } catch (e) {
        setRows((r) => ({ ...r, [s]: { error: e.message } }));
      }
    }
    setProgress({ done: list.length, of: list.length, current: "" });
    setBusy(false);
  };

  const ranked = Object.entries(rows).sort(([, a], [, b]) => {
    const ra = a.available ? RANK[a.decision.kind] : 9;
    const rb = b.available ? RANK[b.decision.kind] : 9;
    if (ra !== rb) return ra - rb;
    return ((b.available && b.decision.strength) || 0) - ((a.available && a.decision.strength) || 0);
  });
  const anyPlan = ranked.find(([, p]) => p.available);
  const session = anyPlan ? sessionOf(anyPlan[1]) : null;

  return (
    <section className="an-card ir" aria-label="Intraday research">
      <header className="an-card__head">
        <div>
          <h3>Intraday research · next session</h3>
          <p>
            For each stock: where it may open and trade, how it behaves inside a day, and a plan — long or short on a trigger, the opening-range break, wait or avoid — with the record of those exact rules on that stock's past sessions. Arithmetic only: no AI, no tokens. A measurement of the past, not a promise.
          </p>
        </div>
      </header>
      {all.length > 0 && (
        <div className="rs-picks" role="group" aria-label="Stocks for intraday research">
          {all.map((s) => (
            <label key={s} className={`rs-pick ${picked.has(s) ? "is-on" : ""}`}>
              <input type="checkbox" checked={picked.has(s)} onChange={() => toggle(s)} /> {s}
            </label>
          ))}
        </div>
      )}
      <form
        className="ir-add"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Add any NSE stock, e.g. TCS, INFY" aria-label="Add NSE symbols" autoCapitalize="characters" spellCheck="false" />
        <button type="submit" className="adm-btn adm-btn--sm" disabled={!typed.trim()}>
          Add
        </button>
        <button type="button" className="adm-btn adm-btn--solid" disabled={busy || picked.size === 0} onClick={run} data-tip="Build tomorrow's intraday plan for each picked stock. No AI is used.">
          {busy ? `Planning ${progress.current}… (${progress.done + 1} of ${progress.of})` : `Plan ${picked.size} stock${picked.size === 1 ? "" : "s"} for intraday`}
        </button>
      </form>
      {note && <p className="adm-alert adm-alert--info">{note}</p>}
      {picked.size >= MAX && <p className="ab-dim">Up to {MAX} stocks at a time.</p>}

      {ranked.length > 0 && (
        <>
          {session && <p className="ab-dim">Plans for {formatDate(session)}. Clearest plans first; open a row for the whole plan.</p>}
          <div className="ip-tablewrap">
            <table className="ip-table ir-table">
              <thead>
                <tr>
                  <th scope="col">Stock</th>
                  <th scope="col">Plan</th>
                  <th scope="col">Expected open</th>
                  <th scope="col">Expected range</th>
                  <th scope="col">Levels</th>
                  <th scope="col">Record</th>
                  <th scope="col">Strength</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map(([s, p]) => {
                  if (!p.available) {
                    return (
                      <tr key={s}>
                        <th scope="row">{s}</th>
                        <td className="ir-plan" colSpan={6}>
                          {p.error || p.reason || "Not available."}
                        </td>
                      </tr>
                    );
                  }
                  const K = KIND[p.decision.kind] || KIND.wait;
                  const rec = p.record ? (p.decision.kind === "long" || p.decision.kind === "short" ? p.record.lean[p.decision.kind] : p.decision.kind === "orb" ? p.record.orb : null) : null;
                  return (
                    <tr
                      key={s}
                      className={open === s ? "is-open" : ""}
                      onClick={() => setOpen((o) => (o === s ? "" : s))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setOpen((o) => (o === s ? "" : s));
                        }
                      }}
                      tabIndex={0}
                      aria-expanded={open === s}
                    >
                      <th scope="row">{s}</th>
                      <td>
                        <span className={`ir-kind ir-kind--${K.tone}`}>{K.word}</span>
                      </td>
                      <td>
                        {inr(p.open.expected)}
                        {p.open.gapPct ? <small> {pct(p.open.gapPct, 1)}</small> : null}
                      </td>
                      <td>
                        {inr(p.range.low)} – {inr(p.range.high)}
                      </td>
                      <td className="ir-plan">{trigger(p)}</td>
                      <td>{rec && rec.trades ? `${rec.winRate}% of ${rec.trades} · ${rec.avgR > 0 ? "+" : ""}${num(rec.avgR, 2)}R` : "—"}</td>
                      <td>{p.decision.strength ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {open && rows[open] && rows[open].available && (
            <div className="ir-detail">
              <IntradayPlan symbol={open} data={rows[open]} onOpen={onOpen} />
            </div>
          )}
        </>
      )}
    </section>
  );
}
