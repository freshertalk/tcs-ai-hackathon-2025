// AI research, shared: the button in the terminal's top bar and the panel behind it.
//
// Every AI answer about a stock — from AI Live, AI Research, the AI decision, the position coach,
// the Live board's exit advisor and its checked exit levels, TradeAI — is kept once on the server
// (server/ai/shared.js) and can be read here from every workspace: the Desk, the Advisor, Positions,
// the Journal, the Execution Lab. What one feature paid for, all of them read; nothing here asks a
// model. The second tab shows what the desk has measured by itself after every close (how often each
// kind of level held or broke — server/learn.js), which is also what TradeAI and the Live board use.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { useAuth } from "../../auth";
import { adminPath } from "../../paths";

const px = (x) => (typeof x === "number" ? x.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");
const FACT = { entry: "entry", stop: "stop", stopLoss: "stop", stop_loss: "stop", target: "target", target1: "target 1", target2: "target 2", exit_price: "exit", exitPrice: "exit", support: "support", resistance: "resistance", invalidation: "invalid below/above" };

function Finding({ f, showSymbol }) {
  const tags = Object.entries(f.tags || {}).filter(([, v]) => v !== "" && v !== null && v !== undefined);
  const facts = Object.entries(f.facts || {}).filter(([, v]) => typeof v === "number");
  return (
    <li className={`shr-f ${f.fresh ? "" : "is-old"}`}>
      <header>
        {showSymbol && f.symbol !== "*" && <b className="shr-f__sym">{f.symbol}</b>}
        <b>{f.source}</b>
        <span>
          {f.by} · {f.clock} ({f.ageMin < 60 ? `${f.ageMin} min ago` : `${Math.round(f.ageMin / 60)} h ago`}){typeof f.last === "number" ? ` · at ₹${px(f.last)}` : ""}
        </span>
        {!f.fresh && <em className="shr-tag">old</em>}
        {f.moved && <em className="shr-tag is-warn">price has moved</em>}
      </header>
      <p>{f.summary}</p>
      {(tags.length > 0 || facts.length > 0) && (
        <p className="shr-f__facts">
          {tags.map(([k, v]) => (
            <span key={k}>
              {k}: <b>{String(v)}</b>
            </span>
          ))}
          {facts.map(([k, v]) => (
            <span key={k}>
              {FACT[k] || k}: <b>₹{px(v)}</b>
            </span>
          ))}
        </p>
      )}
      {f.detail && f.detail.checked && <p className="shr-f__check">✓ {f.detail.checked}</p>}
    </li>
  );
}

function Learned({ symbol, isOwner }) {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const load = useCallback(() => {
    api(`/api/admin/learn${symbol ? `?symbol=${encodeURIComponent(symbol)}` : ""}`)
      .then(setD)
      .catch((e) => setMsg(e.message));
  }, [symbol]);
  useEffect(load, [load]);
  const study = async () => {
    setBusy(true);
    setMsg("");
    try {
      const r = await api("/api/admin/learn/run", { method: "POST", body: {} });
      const done = (r.studied || []).filter((x) => x.symbols > 0);
      setMsg(done.length ? `Studied ${done.map((x) => x.date).join(", ")}.` : "Nothing new to study: the bars need the Zerodha connection, and today is studied after 3:40 PM.");
      load();
    } catch (e) {
      setMsg(e.message);
    }
    setBusy(false);
  };
  if (!d) return <p className="shr-dim">Reading what the desk has measured…</p>;
  return (
    <div className="shr-learn">
      {d.available ? (
        <>
          <p className="shr-dim">
            {d.days} trading day{d.days === 1 ? "" : "s"} ({d.from} to {d.to}) · {d.stocks} stocks · {d.tests.toLocaleString("en-IN")} tests of a level. Studied by itself after every close — no AI model is asked.
          </p>
          <table className="shr-table">
            <caption className="shr-sr">How often each kind of level held when the price tested it</caption>
            <thead>
              <tr>
                <th scope="col">Kind of level</th>
                <th scope="col">Held</th>
                <th scope="col" className="is-num">
                  Tests
                </th>
                {symbol && (
                  <th scope="col" className="is-num">
                    {symbol}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {d.levels.map((r) => (
                <tr key={r.source}>
                  <th scope="row">{r.name}</th>
                  <td>
                    {typeof r.pct === "number" ? (
                      <span className="shr-bar" role="img" aria-label={`held ${r.pct}% of ${r.n} tests`}>
                        <i style={{ width: `${r.pct}%` }} />
                        <em>{r.pct}%</em>
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="is-num">{r.n}</td>
                  {symbol && <td className="is-num">{r.own ? `${r.own.pct}% of ${r.own.n}` : "—"}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="shr-dim">{d.note}</p>
          {d.findings.length > 1 && (
            <>
              <h4>In words (also written into the trading-skills file every AI feature reads)</h4>
              <ul className="shr-lessons">
                {d.findings.slice(1).map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </>
          )}
        </>
      ) : (
        <p className="shr-dim">{d.reason}</p>
      )}
      {d.aiLevels && <p className="shr-dim">The AI’s exit levels, scored after each close: {d.aiLevels.text}</p>}
      <p className="shr-row">
        {isOwner && (
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={study} disabled={busy} data-tip="Study the days not yet studied now (today after 3:40 PM). Arithmetic on Zerodha's 1-minute bars: no AI model, no cost.">
            {busy ? "Studying…" : "Study now"}
          </button>
        )}
        {d.status && d.status.lastRun && <span className="shr-dim">Last study: {new Date(d.status.lastRun.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>}
      </p>
      {msg && <p className="shr-dim" role="status">{msg}</p>}
      <p className="shr-dim">Counts with their sample size — evidence about how levels have behaved, not a promise about the next test.</p>
    </div>
  );
}

function Panel({ symbol, onClose }) {
  const { user } = useAuth() || {};
  const isOwner = Boolean(user && user.role === "superadmin");
  const [tab, setTab] = useState(symbol ? "stock" : "all");
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const box = useRef(null);
  useEffect(() => {
    const out = (e) => box.current && !box.current.contains(e.target) && !(e.target.closest && e.target.closest("[data-research-toggle]")) && onClose();
    const esc = (e) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", out);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", out);
      document.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  useEffect(() => {
    if (tab === "learned") return undefined;
    let on = true;
    const load = () =>
      api(`/api/admin/ai/shared${tab === "stock" && symbol ? `?symbol=${encodeURIComponent(symbol)}` : ""}`)
        .then((x) => on && (setD(x), setErr("")))
        .catch((e) => on && setErr(e.message));
    setD(null);
    load();
    const id = setInterval(load, 20000);
    return () => {
      on = false;
      clearInterval(id);
    };
  }, [tab, symbol]);
  const list = (d && d.findings) || [];
  return (
    <div className="tm-alerts shr" ref={box} role="dialog" aria-label="AI research, shared across the desk">
      <h3>AI research, shared</h3>
      <div className="shr-tabs" role="tablist">
        {symbol && (
          <button type="button" role="tab" aria-selected={tab === "stock"} onClick={() => setTab("stock")}>
            {symbol}
          </button>
        )}
        <button type="button" role="tab" aria-selected={tab === "all"} onClick={() => setTab("all")}>
          All stocks
        </button>
        <button type="button" role="tab" aria-selected={tab === "learned"} onClick={() => setTab("learned")}>
          Learned
        </button>
      </div>
      {tab === "learned" ? (
        <Learned symbol={symbol} isOwner={isOwner} />
      ) : (
        <>
          {err && <p className="shr-dim" role="alert">{err}</p>}
          {!d && !err && <p className="shr-dim">Reading what the AI has already found…</p>}
          {d && list.length === 0 && (
            <p className="shr-dim">
              {tab === "stock" ? `No AI finding on ${symbol} in the last 12 hours.` : "No AI finding in the last 12 hours."} A finding appears here the moment any feature asks the AI about a stock — AI Live, AI Research, the position coach, the Live board, TradeAI — and every other feature reads it instead of asking again.
            </p>
          )}
          {list.length > 0 && (
            <ul className="shr-list">
              {list.map((f) => (
                <Finding key={f.id} f={f} showSymbol={tab === "all"} />
              ))}
            </ul>
          )}
          {d && d.stats && (
            <p className="shr-dim">
              {d.stats.fresh} fresh finding{d.stats.fresh === 1 ? "" : "s"} on {d.stats.stocks} stock{d.stats.stocks === 1 ? "" : "s"}; read {d.stats.readsToday} time{d.stats.readsToday === 1 ? "" : "s"} today by other features instead of a new AI request.
            </p>
          )}
        </>
      )}
      <p className="shr-row">
        <Link className="adm-btn adm-btn--solid adm-btn--sm" to={adminPath("tradeai")} target="_blank" rel="noopener">
          Ask TradeAI{symbol ? ` about ${symbol}` : ""}
        </Link>
        <span className="shr-dim">It starts from these findings — nothing is paid for twice.</span>
      </p>
    </div>
  );
}

/** The top bar's button, with the number of fresh findings on the open stock. */
export default function ResearchButton({ symbol }) {
  const [open, setOpen] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => {
    let on = true;
    const load = () =>
      api(`/api/admin/ai/shared${symbol ? `?symbol=${encodeURIComponent(symbol)}` : ""}`)
        .then((x) => on && setN(((x && x.findings) || []).filter((f) => f.fresh).length))
        .catch(() => {});
    load();
    const id = setInterval(() => document.visibilityState !== "hidden" && load(), 60000);
    return () => {
      on = false;
      clearInterval(id);
    };
  }, [symbol, open]);
  return (
    <span className="tm-bell">
      <button
        type="button"
        className={`tm-icon ${n ? "has-some" : ""}`}
        data-research-toggle
        aria-expanded={open}
        aria-label={`AI research shared across the desk: ${n} fresh finding${n === 1 ? "" : "s"}${symbol ? ` on ${symbol}` : ""}`}
        onClick={() => setOpen((o) => !o)}
        data-tip="What the AI has already found — by any feature — and what the desk has learned by itself. Read here from every workspace; nothing is asked again."
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18h6M10 21h4" />
          <path d="M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.4 1 2.5h6c0-1.1.3-1.8 1-2.5A6 6 0 0 0 12 3z" />
        </svg>
        {n > 0 && <b>{n}</b>}
      </button>
      {open && <Panel symbol={symbol} onClose={() => setOpen(false)} />}
    </span>
  );
}
