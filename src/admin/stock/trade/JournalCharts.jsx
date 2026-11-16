// The Journal's analytics, made for anyone to read: a big plain result, a 0–100 health gauge, a win
// ring, the money over time and its falls, each day's result, where the money went and what the costs
// were (rings), the kinds of trade, how long trades were kept, how big each win and loss was, the
// win rate over time, the best days and hours, the best and worst stocks — and the Retrospective:
// what went well, what went wrong, what to keep doing, what to stop, and what to try next.
// Every chart says in one line what it shows; every number is also written, not only drawn.

import React, { useEffect, useState } from "react";
import { principalNote } from "./JournalPro";
import { api } from "../../api";
import { DailyBars, HBars, LineChart, Waterfall, rs, rsSigned, short } from "../analysis/charts";
import "../analysis/analysis.css";
import "./journal-charts.css";

const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const pct = (x) => (isNum(x) ? `${Math.round(x)}%` : "—");
/** A return as a signed percentage, two decimals: +1.23% */
export const sPct = (x) => (isNum(x) ? `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(2)}%` : "—");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayText = (k) => (k ? `${Number(k.slice(8))} ${MONTHS[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}` : "");
const toneOf = (x) => (!isNum(x) || x === 0 ? "" : x > 0 ? "is-up" : "is-down");

/* ------------------------------------------------------------------------------ building blocks */
export function Card({ title, info, children, className = "", action = null, icon = null }) {
  return (
    <section className={`jc-card ${className}`}>
      <header className="jc-card__h">
        <h3>
          {icon && (
            <span className="jc-ic" aria-hidden="true">
              {icon}
            </span>
          )}
          {title}
        </h3>
        {action}
      </header>
      {info && (
        <p className="jc-info">
          <span aria-hidden="true">ⓘ</span> {info}
        </p>
      )}
      {children}
    </section>
  );
}

/** A semicircle gauge 0–100 with the score in the middle. */
function Gauge({ score, label, size = 220 }) {
  const r = size / 2 - 16;
  const cx = size / 2;
  const cy = size / 2;
  const arc = (from, to) => {
    const a0 = Math.PI * (1 - from / 100);
    const a1 = Math.PI * (1 - to / 100);
    const p0 = [cx + r * Math.cos(a0), cy - r * Math.sin(a0)];
    const p1 = [cx + r * Math.cos(a1), cy - r * Math.sin(a1)];
    return `M${p0[0].toFixed(1)} ${p0[1].toFixed(1)} A${r} ${r} 0 0 1 ${p1[0].toFixed(1)} ${p1[1].toFixed(1)}`;
  };
  const cls = score >= 70 ? "is-good" : score >= 50 ? "is-mid" : "is-bad";
  return (
    <svg className="jc-gauge" viewBox={`0 0 ${size} ${size / 2 + 34}`} role="img" aria-label={`Trading health ${score} out of 100: ${label}`}>
      <path d={arc(0, 49.5)} className="jc-gauge__zone is-bad" />
      <path d={arc(50.5, 69.5)} className="jc-gauge__zone is-mid" />
      <path d={arc(70.5, 100)} className="jc-gauge__zone is-good" />
      <path d={arc(0, Math.max(0.5, score))} className={`jc-gauge__val ${cls}`} />
      <text x={cx} y={cy - 6} textAnchor="middle" className="jc-gauge__n">
        {score}
      </text>
      <text x={cx} y={cy + 18} textAnchor="middle" className={`jc-gauge__l ${cls}`}>
        {label}
      </text>
      <text x={16} y={cy + 30} className="jc-gauge__ax">
        0
      </text>
      <text x={size - 16} y={cy + 30} textAnchor="end" className="jc-gauge__ax">
        100
      </text>
    </svg>
  );
}

/** A ring for one share (0–100). */
function Ring({ value, size = 150, cls = "is-up", center, sub }) {
  const r = size / 2 - 12;
  const C = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value || 0));
  return (
    <svg className="jc-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${center} ${sub || ""}`}>
      <circle cx={size / 2} cy={size / 2} r={r} className="jc-ring__bg" />
      <circle cx={size / 2} cy={size / 2} r={r} className={`jc-ring__fg ${cls}`} strokeDasharray={`${(v / 100) * C} ${C}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="48%" textAnchor="middle" className="jc-ring__n">
        {center}
      </text>
      {sub && (
        <text x="50%" y="63%" textAnchor="middle" className="jc-ring__s">
          {sub}
        </text>
      )}
    </svg>
  );
}

/** A donut of parts (≤ 6, categorical colours c1–c6) with its legend: label, amount and share. */
function PieRing({ parts, center, fmt = (x) => rs(x), size = 168, label }) {
  const [hi, setHi] = useState(null);
  const list = parts.filter((p) => p.value > 0);
  const total = list.reduce((s, p) => s + p.value, 0);
  if (!total) return <p className="jc-empty">Nothing to show for this period.</p>;
  const r = size / 2 - 16;
  const C = 2 * Math.PI * r;
  let off = 0;
  return (
    <div className="jc-pie">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label}: ${list.map((p) => `${p.label} ${Math.round((p.value / total) * 100)}%`).join(", ")}`}>
        <circle cx={size / 2} cy={size / 2} r={r} className="jc-pie__bg" />
        {list.map((p, i) => {
          const len = (p.value / total) * C;
          const gap = list.length > 1 ? Math.min(3, len / 2) : 0;
          const seg = (
            <circle key={p.label} cx={size / 2} cy={size / 2} r={r} className={`jc-pie__seg jc-${p.c} ${hi === i ? "is-hi" : ""} ${hi !== null && hi !== i ? "is-dim" : ""}`} strokeDasharray={`${Math.max(0.5, len - gap)} ${C}`} strokeDashoffset={-off} transform={`rotate(-90 ${size / 2} ${size / 2})`} onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)}>
              <title>{`${p.label}: ${fmt(p.value)} (${Math.round((p.value / total) * 100)}%)`}</title>
            </circle>
          );
          off += len;
          return seg;
        })}
        <text x="50%" y="47%" textAnchor="middle" className="jc-pie__t">
          {center[0]}
        </text>
        <text x="50%" y="60%" textAnchor="middle" className="jc-pie__s">
          {center[1]}
        </text>
      </svg>
      <ul className="jc-legend">
        {list.map((p, i) => (
          <li key={p.label} className={hi === i ? "is-hi" : ""} onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)}>
            <i className={`jc-sw jc-${p.c}`} />
            <span>{p.label}</span>
            <b>{fmt(p.value)}</b>
            <small>{Math.round((p.value / total) * 100)}%</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Vertical bars for ordered groups (holding time, size of result): the count, with the money under. */
function Columns({ rows, height = 170, label }) {
  const [hi, setHi] = useState(null);
  if (!rows.length) return <p className="jc-empty">Nothing to show for this period.</p>;
  const max = Math.max(1, ...rows.map((r) => r.trades));
  return (
    <div className="jc-cols" role="img" aria-label={label}>
      <div className="jc-cols__plot" style={{ height }}>
        {rows.map((r, i) => (
          <div key={r.label} className={`jc-col ${hi === i ? "is-hi" : ""}`} onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)} title={`${r.label}: ${r.trades} trades${isNum(r.winRate) ? `, ${r.winRate}% won` : ""}, ${rsSigned(r.net)}`}>
            <span className="jc-col__n">{r.trades}</span>
            <i className={`jc-col__bar ${r.tone ? `is-${r.tone}` : r.net > 0 ? "is-up" : r.net < 0 ? "is-down" : ""}`} style={{ height: `${Math.max(2, (r.trades / max) * (height - 26))}px` }} />
          </div>
        ))}
      </div>
      <div className="jc-cols__x">
        {rows.map((r) => (
          <div key={r.label}>
            <span>{r.label}</span>
            <b className={toneOf(r.net)}>{rsSigned(r.net)}</b>
            {isNum(r.winRate) && <small>{r.winRate}% won</small>}
          </div>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------------- the result */
export function Hero({ s, a, rt = null, label, period, onRetro, busy, onCapital }) {
  const won = s.net > 0;
  const onCap = Boolean(rt && rt.hasCapital && isNum(rt.totalPct));
  const prev = a && a.prev && a.prev.trades ? a.prev : null;
  const diff = prev ? s.net - prev.net : null;
  return (
    <section className={`jc-hero ${won ? "is-up" : "is-down"}`}>
      <div className="jc-hero__main">
        <p className="jc-hero__k">
          {label}
          {period && period.fromDay && period.id !== "custom" ? ` · ${period.fromDay === period.toDay ? dayText(period.toDay) : `${dayText(period.fromDay)} – ${dayText(period.toDay)}`}` : ""}
        </p>
        <p className="jc-hero__say">{won ? "You made" : s.net < 0 ? "You lost" : "You broke even"}</p>
        <p className="jc-hero__n">
          {rs(Math.abs(s.net))}
          {onCap && (
            <span className="jc-hero__pct" data-tip="The result after costs as a share of your principal: the money you put in, from the day you put it in. Profit is not added to the principal.">
              {sPct(rt.totalPct)}
            </span>
          )}
        </p>
        <p className="jc-hero__sub">
          after all costs
          {onCap ? (
            <>
              {" "}
              — <b className={toneOf(rt.totalPct)}>{sPct(rt.totalPct)}</b> {principalNote(rt)}
            </>
          ) : (
            <>
              {" "}
              —{" "}
              <button type="button" className="jr-link" onClick={onCapital}>
                add your capital to see the return in percent
              </button>
            </>
          )}
          , from <b>{s.trades}</b> trade{s.trades === 1 ? "" : "s"} on <b>{s.tradingDays}</b> day{s.tradingDays === 1 ? "" : "s"}
          {diff !== null && (
            <>
              {" "}
              ·{" "}
              <span className={toneOf(diff)}>
                {diff >= 0 ? "▲" : "▼"} {rs(Math.abs(diff))} {diff >= 0 ? "better" : "worse"} than the {Math.round((Date.parse(prev.toDay) - Date.parse(prev.fromDay)) / 86400000) + 1} days before
              </span>
            </>
          )}
        </p>
      </div>
      <ul className="jc-hero__facts">
        <li>
          <span aria-hidden="true">🎯</span>
          <b>
            {s.wins} of {s.trades}
          </b>{" "}
          trades won ({pct(s.winRate)})
        </li>
        <li>
          <span aria-hidden="true">💸</span>
          <b>{rs(s.charges)}</b> paid in brokerage and taxes
        </li>
        {a && a.summary.bestDay && (
          <li>
            <span aria-hidden="true">🌟</span>
            Best day <b className="is-up">{rsSigned(a.summary.bestDay.net)}</b> on {dayText(a.summary.bestDay.day)}
          </li>
        )}
        {a && a.summary.worstDay && (
          <li>
            <span aria-hidden="true">⚠️</span>
            Worst day <b className="is-down">{rsSigned(a.summary.worstDay.net)}</b> on {dayText(a.summary.worstDay.day)}
          </li>
        )}
      </ul>
      <div className="jc-hero__act">
        <button type="button" className={`jc-retro-btn ${busy ? "is-busy" : ""}`} onClick={onRetro} disabled={busy}>
          <span className="jc-retro-btn__icon" aria-hidden="true">
            {/* an arrow turning back round a clock face: looking back over the period */}
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 2.64-6.36" />
              <path d="M3 4v4.5h4.5" />
              <path d="M12 7.5V12l3 2" />
            </svg>
          </span>
          <span className="jc-retro-btn__text">
            <span className="jc-retro-btn__t">{busy ? "Looking at your trades…" : "Retrospective analysis"}</span>
            <span className="jc-retro-btn__s">What went well, what went wrong, what to keep doing</span>
          </span>
          <span className="jc-retro-btn__go" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14" />
              <path d="M13 6l6 6-6 6" />
            </svg>
          </span>
        </button>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------------- the retrospective */
const SECTIONS = [
  ["wentWell", "What went well", "✅", "is-good"],
  ["wentWrong", "What went wrong", "⚠️", "is-bad"],
  ["keepDoing", "Keep doing", "🔁", "is-keep"],
  ["stopDoing", "Stop doing", "🛑", "is-stop"],
  ["tryNext", "Try next", "🎯", "is-try"],
];

export function Retro({ r, onClose, onOpen, list }) {
  const [copied, setCopied] = useState(false);
  if (!r) return null;
  const copy = async () => {
    const text = [`Retrospective — ${r.period.label}${r.period.fromDay ? ` (${dayText(r.period.fromDay)} – ${dayText(r.period.toDay)})` : ""}`, r.headline, ...SECTIONS.flatMap(([k, t]) => (r[k] && r[k].length ? ["", `${t}:`, ...r[k].map((x) => `- ${x.text}`)] : [])), "", r.note].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch (_) {
      /* the browser refused: nothing else to do */
    }
  };
  return (
    <section className={`jc-retro is-${r.verdict}`} aria-label="Retrospective analysis" aria-live="polite">
      <header className="jc-retro__h">
        <div>
          <p className="jc-retro__k">
            Retrospective · {r.period.label}
            {r.period.fromDay ? ` · ${dayText(r.period.fromDay)} – ${dayText(r.period.toDay)}` : ""}
          </p>
          <h3>{r.headline}</h3>
          {r.prev && r.prev.trades > 0 && (
            <p className="jc-retro__cmp">
              Before this period: {rsSigned(r.prev.net)} from {r.prev.trades} trades ({pct(r.prev.winRate)} won). Now: {rsSigned(r.summary.net)} from {r.summary.trades} trades ({pct(r.summary.winRate)} won).
            </p>
          )}
        </div>
        {isNum(r.score) && <Ring value={r.score} size={96} cls={r.score >= 70 ? "is-up" : r.score >= 50 ? "is-warn" : "is-down"} center={String(r.score)} sub="health" />}
      </header>
      <div className="jc-retro__grid">
        {SECTIONS.map(([k, t, ic, cls]) => (
          <div key={k} className={`jc-retro__col ${cls}`}>
            <h4>
              <span aria-hidden="true">{ic}</span> {t}
            </h4>
            {r[k] && r[k].length ? (
              <ul>
                {r[k].map((x, i) => (
                  <li key={i} style={{ animationDelay: `${i * 40}ms` }}>
                    {x.text}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="jc-empty">{k === "wentWell" ? "Nothing stood out as good in this period." : k === "wentWrong" ? "Nothing stood out as a problem." : "—"}</p>
            )}
          </div>
        ))}
      </div>
      <footer className="jc-retro__f">
        <small>{r.note}</small>
        <span className="jc-grow" />
        {list && list.length > 1 && (
          <label className="jc-retro__old">
            <span className="adm-sr">Earlier retrospectives</span>
            <select value="" onChange={(e) => e.target.value && onOpen(e.target.value)}>
              <option value="">Earlier ({list.length - 1}) ▾</option>
              {list
                .filter((x) => x.id !== r.id)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {new Date(x.at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} · {x.period && x.period.label} · {isNum(x.net) ? rsSigned(x.net) : ""}
                  </option>
                ))}
            </select>
          </label>
        )}
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={copy}>
          {copied ? "Copied ✓" : "Copy as text"}
        </button>
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={onClose}>
          Close
        </button>
      </footer>
    </section>
  );
}

/** The Retrospective's button logic: run it for the period shown, keep the earlier ones at hand. */
export function useRetro(sel, filters) {
  const [r, setR] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [list, setList] = useState([]);
  const loadList = () =>
    api("/api/admin/trading/journal/retros")
      .then((d) => setList(Array.isArray(d && d.retros) ? d.retros : []))
      .catch(() => {});
  useEffect(() => {
    setR(null);
  }, [sel.period, sel.from, sel.to, filters.kind, filters.side, filters.setup]);
  const run = async () => {
    setBusy(true);
    setErr("");
    try {
      const d = await api("/api/admin/trading/journal/retro", { method: "POST", body: { period: sel.period, from: sel.from, to: sel.to, ...filters } });
      setR(d);
      loadList();
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  };
  const open = async (id) => {
    try {
      setR(await api(`/api/admin/trading/journal/retros/${encodeURIComponent(id)}`));
    } catch (e) {
      setErr(e.message);
    }
  };
  return { r, busy, err, run, open, list, close: () => setR(null) };
}

/* ------------------------------------------------------------------------------ the dashboard */
const COST_PARTS = [
  ["brokerage", "Brokerage", "c1"],
  ["stt", "STT (securities tax)", "c2"],
  ["gst", "GST", "c3"],
  ["exchange", "Exchange charges", "c4"],
  ["stamp", "Stamp duty", "c5"],
  ["other", "SEBI fee and DP charge", "c6"],
];
const HOURS = (k) => {
  const h = Number(String(k).slice(0, 2));
  const f = (x) => `${((x + 11) % 12) + 1}${x < 12 ? "am" : "pm"}`;
  return `${f(h)}–${f(h + 1)}`;
};

export function Dashboard({ s, a }) {
  const h = a && a.health;
  const days = (a && a.days) || [];
  const curve = (a && a.curve) || [];
  const profit = days.reduce((x, d) => x + d.grossProfit, 0);
  const loss = days.reduce((x, d) => x + d.grossLoss, 0);
  const costs = a ? a.costs : null;
  const costParts = costs ? COST_PARTS.map(([k, l, c]) => ({ label: l, c, value: k === "other" ? (costs.sebi || 0) + (costs.dp || 0) : costs[k] || 0 })) : [];
  const costTotal = costParts.reduce((x, p) => x + p.value, 0);
  const mixC = { intraday: "c1", delivery: "c3", deriv: "c6" };
  const bySym = s.by.symbol || [];
  const top = bySym.filter((x) => x.net > 0).slice(0, 6);
  const bottom = bySym.filter((x) => x.net < 0).slice(-6).reverse();
  return (
    <div className="jc">
      <div className="jc-row jc-row--3">
        {h && (
          <Card title="Trading health" icon="❤️" info="A score from 0 to 100 from six simple checks. Higher is better. It looks back at this period only.">
            <div className="jc-health">
              <Gauge score={h.score} label={h.label} />
              {!h.enough && <p className="jc-note">Only {s.trades} trades — read this score lightly.</p>}
              <ul className="jc-parts">
                {h.parts.map((p) => (
                  <li key={p.key}>
                    <span>{p.label}</span>
                    <span className="jc-parts__bar" aria-hidden="true">
                      <i className={p.score >= 70 ? "is-good" : p.score >= 50 ? "is-mid" : "is-bad"} style={{ width: `${Math.max(3, p.score)}%` }} />
                    </span>
                    <b>{p.score}</b>
                    <small>{p.value}</small>
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        )}
        <Card title="How often you win" icon="🎯" info="The share of your trades that made money after costs.">
          <div className="jc-win">
            <Ring value={s.winRate} cls={s.winRate >= 50 ? "is-up" : "is-down"} center={pct(s.winRate)} sub={`${s.wins} of ${s.trades} won`} size={164} />
            <dl className="jc-mini">
              <div>
                <dt>Average win</dt>
                <dd className="is-up">{rsSigned(s.avgWin)}</dd>
              </div>
              <div>
                <dt>Average loss</dt>
                <dd className="is-down">{rsSigned(s.avgLoss)}</dd>
              </div>
              <div>
                <dt>Won for every ₹1 lost</dt>
                <dd>{s.profitFactor === null ? "no losses" : `₹${s.profitFactor.toFixed(2)}`}</dd>
              </div>
              <div>
                <dt>Longest winning / losing run</dt>
                <dd>
                  <span className="is-up">{s.bestStreak}</span> / <span className="is-down">{s.worstStreak}</span> trades
                </dd>
              </div>
            </dl>
          </div>
        </Card>
        <Card title="Where your money went" icon="🧾" info="What your winning trades made, what the losing ones took, what the costs took, and what is left.">
          <Waterfall profit={profit} loss={loss} charges={s.charges} net={s.net} />
          <p className="jc-note">
            Costs took <b>{profit > 0 ? `${Math.round((s.charges / profit) * 100)}%` : "—"}</b> of what your winning trades made.
          </p>
        </Card>
      </div>

      <div className="jc-row jc-row--2">
        <Card title="Your money over time" icon="📈" info="Your total profit or loss after costs, adding up day by day. Up is good.">
          <LineChart xs={curve.map((c) => c.date)} series={[{ label: "Total so far", values: curve.map((c) => c.equity), c: s.net >= 0 ? "up" : "down", area: true }]} height={230} label="Your total profit or loss over time" />
        </Card>
        <Card title="Falls from your best point" icon="📉" info="How far your total fell below its highest point so far. Smaller falls mean steadier trading.">
          <LineChart xs={curve.map((c) => c.date)} series={[{ label: "Below the best point", values: curve.map((c) => c.drawdown), c: "down", area: true }]} height={230} label="How far the total fell below its best" />
          <p className="jc-note">
            The biggest fall was <b className="is-down">{rs(s.maxDrawdown)}</b>.
          </p>
        </Card>
      </div>

      <Card title="Each day's result" icon="📅" info="Green bars: money your winning trades made that day. Red bars: money the losing trades took. The dot is what was left after costs." className="jc-wide">
        <DailyBars days={days} height={240} />
      </Card>

      <div className="jc-row jc-row--3">
        <Card title="What the costs were" icon="💸" info="Every trade pays brokerage and taxes — win or lose. This is an estimate from Zerodha's rates.">
          <PieRing parts={costParts} center={[short(costTotal), "costs"]} label="Costs by kind" fmt={(x) => rs(x)} />
        </Card>
        <Card title="Kinds of trades" icon="🧩" info="How many of your trades were intraday (closed the same day), delivery (kept overnight) or F&O.">
          {a && a.mix.length === 1 ? (
            <p className="jc-one">
              All <b>{a.mix[0].trades}</b> trades were <b>{a.mix[0].label.toLowerCase()}</b>.
            </p>
          ) : (
            <PieRing parts={(a ? a.mix : []).map((m) => ({ label: m.label, value: m.trades, c: mixC[m.key] }))} center={[String(s.trades), "trades"]} label="Kinds of trades" fmt={(x) => `${x} trades`} />
          )}
          {a && a.mix.length > 0 && (
            <ul className="jc-plain">
              {a.mix.map((m) => (
                <li key={m.key}>
                  {m.label}: <b className={toneOf(m.net)}>{rsSigned(m.net)}</b> <small>({m.trades ? Math.round((m.wins / m.trades) * 100) : 0}% won)</small>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Buy first or sell first" icon="⇅" info="Long = you bought first and sold later. Short = you sold first and bought back later.">
          <HBars rows={(a ? a.sides : []).map((x) => ({ label: x.key === "long" ? "Buy first" : "Sell first", value: x.net, sub: `${x.trades} trades · ${x.trades ? Math.round((x.wins / x.trades) * 100) : 0}% won` }))} empty="No closed trades." />
        </Card>
      </div>

      <div className="jc-row jc-row--2">
        <Card title="How long you kept trades" icon="⏱️" info="Bars show how many trades; under each, the money they made or lost and how many won.">
          <Columns rows={(a ? a.holding : []).map((b) => ({ label: b.label, trades: b.trades, net: b.net, winRate: b.winRate }))} label="Trades by how long they were kept" />
        </Card>
        <Card title="Size of each win and loss" icon="📊" info="How many trades lost or made small, medium and big amounts. Many small losses and a few big wins is healthy; the opposite is not.">
          <Columns rows={(a ? a.spread : []).map((b) => ({ label: b.label, trades: b.trades, net: b.net, tone: b.tone }))} label="Trades by the size of their result" />
        </Card>
      </div>

      <div className="jc-row jc-row--2">
        <Card title="Win rate over time" icon="〰️" info="The share of winning trades among your last 20 trades, at the end of each day. Going up means you are winning more often.">
          <LineChart xs={((a && a.rolling) || []).map((x) => x.date)} series={[{ label: "Won (last 20 trades)", values: ((a && a.rolling) || []).map((x) => x.winRate), c: "a" }]} height={220} fmt={(v) => `${Math.round(v)}%`} valueFmt={(v) => `${v}%`} zero={false} label="Win rate of the last 20 trades over time" />
        </Card>
        <Card title="Best days of the week" icon="🗓️" info="The money made or lost by the day of the week you started the trade.">
          <HBars rows={(s.by.weekday || []).map((x) => ({ label: x.key, value: x.net, sub: `${x.trades} trades · ${Math.round(x.winRate)}% won` }))} />
        </Card>
      </div>

      <div className="jc-row jc-row--2">
        <Card title="Best time of day" icon="🕘" info="The money made or lost by the hour you started the trade.">
          <HBars rows={(s.by.hour || []).map((x) => ({ label: HOURS(x.key), value: x.net, sub: `${x.trades} trades · ${Math.round(x.winRate)}% won` }))} />
        </Card>
        <Card title="Your stocks: best and worst" icon="🏆" info="The stocks that made you the most and lost you the most, after costs.">
          {top.length > 0 && <p className="jc-sub is-up">Made money</p>}
          <HBars rows={top.map((x) => ({ label: x.key, value: x.net, sub: `${x.trades} trades · ${Math.round(x.winRate)}% won` }))} empty="No stock made money in this period." />
          {bottom.length > 0 && <p className="jc-sub is-down">Lost money</p>}
          {bottom.length > 0 && <HBars rows={bottom.map((x) => ({ label: x.key, value: x.net, sub: `${x.trades} trades · ${Math.round(x.winRate)}% won` }))} />}
        </Card>
      </div>

      {(s.by.mistake || []).length > 0 && (
        <Card title="What your mistakes cost" icon="🩹" info="The trades you tagged with each mistake, and what they made or lost." className="jc-wide">
          <HBars rows={s.by.mistake.map((x) => ({ label: x.key, value: x.net, sub: `${x.trades} trades` }))} />
        </Card>
      )}
    </div>
  );
}
