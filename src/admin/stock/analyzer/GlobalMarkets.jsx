// World markets and the NSE forecast: GIFT Nifty (the successor of SGX Nifty), the US, Europe, Japan,
// Singapore, Hong Kong, Korea and China, the rupee, crude, both VIXes, FII flows, the Nifty option chain
// and the world-news brief — read into where the Nifty may open and which way the day may lean (before
// the open), or the lean for the rest of the day (in the session).
//
// From GET /api/admin/ai/forecast (server/market/premarket.js — arithmetic, no AI is called). Overseas
// indices come from the owner's own Financial Modeling Prep key (typed in here by the owner; kept
// encrypted on the server, never shown again); news and flows from the paid model's web search (the
// world brief, refreshed only by its button). Read-only: nothing here places an order.

import React, { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import { useAuth } from "../../auth";
import { inr, isNum, num, pct } from "./format";
import "./global.css";

const tone = (w) => (w === "up" ? "up" : w === "down" ? "down" : "flat");
const SESSION = { live: "trading now", pre: "opens later today", closed: "closed" };

/** The forecast, re-read every minute before and during the session, every five minutes otherwise. */
export function useForecast(enabled = true) {
  const [s, setS] = useState({ loading: enabled, data: null, error: "" });
  const load = useCallback(
    () =>
      api("/api/admin/ai/forecast")
        .then((d) => setS({ loading: false, data: d, error: "" }))
        .catch((e) => setS((p) => ({ loading: false, data: p.data, error: e.message }))),
    []
  );
  useEffect(() => {
    if (!enabled) return undefined;
    load();
    const id = setInterval(() => document.visibilityState !== "hidden" && load(), 60000);
    return () => clearInterval(id);
  }, [enabled, load]);
  return { ...s, reload: load };
}

/** One line for the market strip: the expected open (before the session) or the lean for the rest of today. */
export function ForecastChip({ f, onClick }) {
  if (!f || !f.available) return null;
  const t = tone(f.lean.firm ? f.lean.word : "");
  return (
    <button type="button" className={`gm-chip gm-chip--${t}`} onClick={onClick} data-tip={`${f.headline}. From GIFT Nifty, the US, Europe, Asia, the rupee, crude, VIX, flows, the Nifty option chain and the world brief. Not a promise.`}>
      <small>{f.phase === "open" ? "Rest of today" : "NSE open"}</small>
      <b>
        {f.phase !== "open" && f.open ? `${f.open.gapPct > 0 ? "▲" : f.open.gapPct < 0 ? "▼" : "◆"} ${pct(f.open.gapPct)}` : f.lean.firm ? `leans ${f.lean.word}` : "no firm lean"}
      </b>
      <small>{f.lean.agreement}% agree</small>
    </button>
  );
}

function FeedSettings({ feed, onSaved }) {
  const { user } = useAuth() || {};
  const owner = Boolean(user && user.role === "superadmin");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (!feed) return null;
  const save = async (body) => {
    setBusy(true);
    setErr("");
    try {
      await api("/api/admin/market/global/key", { method: "PUT", body });
      setKey("");
      onSaved();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => {
    setBusy(true);
    setErr("");
    try {
      await api("/api/admin/market/global/refresh", { method: "POST" });
      onSaved();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="gm-feed" open={!feed.configured && owner}>
      <summary>
        <b>Overseas indices source</b> <small>{feed.configured ? `Financial Modeling Prep · ${feed.callsToday}/${feed.dailyCap} calls today` : "not set up"}</small>
      </summary>
      <p className="ab-dim">
        Zerodha carries GIFT Nifty, the rupee, crude and gold, but no foreign indices. The S&amp;P 500, Nasdaq, Dow, US VIX, FTSE, DAX, CAC, Nikkei, Straits Times, Hang Seng, KOSPI and Shanghai come from your own Financial Modeling Prep (financialmodelingprep.com) API key — what it serves depends on your FMP plan. The key is kept encrypted on the server and never shown again. Calls stop at {feed.dailyCap} a day.
      </p>
      {feed.lastError && <p className="adm-alert adm-alert--info">{feed.lastError}</p>}
      {owner ? (
        <div className="gm-feed__row">
          <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={feed.configured ? "Replace the saved key" : "Your FMP API key"} aria-label="FMP API key" />
          <button type="button" className="adm-btn adm-btn--solid adm-btn--sm" disabled={busy || !key.trim()} onClick={() => save({ key })}>
            Save key
          </button>
          {feed.configured && (
            <>
              <button type="button" className="adm-btn adm-btn--sm" disabled={busy} onClick={refresh}>
                Refresh prices
              </button>
              <button type="button" className="adm-btn adm-btn--danger adm-btn--sm" disabled={busy} onClick={() => save({ remove: true })}>
                Remove key
              </button>
            </>
          )}
        </div>
      ) : (
        <p className="ab-dim">Only the account owner can set the key.</p>
      )}
      {err && <p className="adm-alert adm-alert--error">{err}</p>}
    </details>
  );
}

/** The whole reading: shown at the top of the Desk's "Market & world" panel. */
export default function GlobalMarkets({ fc }) {
  const [feed, setFeed] = useState(null);
  const [newsBusy, setNewsBusy] = useState(false);
  const [newsErr, setNewsErr] = useState("");
  const loadFeed = useCallback(
    () =>
      api("/api/admin/market/global")
        .then((d) => setFeed(d.feed))
        .catch(() => setFeed(null)),
    []
  );
  useEffect(() => {
    loadFeed();
  }, [loadFeed]);
  const f = fc.data;
  const refreshNews = async () => {
    setNewsBusy(true);
    setNewsErr("");
    try {
      await api("/api/admin/ai/world", { method: "POST", body: { refresh: true } });
      fc.reload();
    } catch (e) {
      setNewsErr(e.message);
    } finally {
      setNewsBusy(false);
    }
  };
  if (!f) return <div className="gm">{fc.loading ? <p className="ab-dim">Reading the world…</p> : <p className="adm-alert adm-alert--info">{fc.error || "The world reading is not available."}</p>}</div>;
  const t = tone(f.lean.firm ? f.lean.word : "");
  const m = f.measured && f.measured.us;
  return (
    <div className="gm">
      <div className={`gm-head gm-head--${t}`}>
        <span className="gm-badge">{f.lean.firm ? (f.lean.word === "up" ? "LEANS UP" : f.lean.word === "down" ? "LEANS DOWN" : "SIDEWAYS") : "NO FIRM LEAN"}</span>
        <div>
          <h4>{f.headline}</h4>
          <p>
            For {f.for} · lean {f.lean.score > 0 ? "+" : ""}
            {f.lean.score} · {f.lean.agreement}% of the cues agree · read {new Date(f.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
      </div>

      <div className="gm-tiles">
        {f.open && f.nifty && (
          <div>
            <span>Nifty expected open</span>
            <b>{inr(f.open.expected)}</b>
            <small>
              {pct(f.open.gapPct)} from {inr(f.nifty.prevClose)} · {inr(f.open.low)} – {inr(f.open.high)}
            </small>
            <small className="gm-basis">{f.open.basis}</small>
          </div>
        )}
        {f.range && (
          <div>
            <span>{f.phase === "open" ? "Nifty range for the rest of today" : "Nifty range for the day"}</span>
            <b>
              {inr(f.range.low, 0)} – {inr(f.range.high, 0)}
            </b>
            <small>a normal day spans {num(f.range.typicalPct, 2)}%</small>
          </div>
        )}
        {m && (
          <div>
            <span>Measured: the Nifty and the US</span>
            <b>{m.beta}× the S&amp;P 500</b>
            <small>
              over {m.days} days{isNum(m.r2) ? ` · explains ${Math.round(m.r2 * 100)}% of the opens` : ""}
              {isNum(m.followedPct) ? ` · after a ${m.minMove}%+ US move it opened the same way ${m.followedPct}% of the time` : ""}
            </small>
          </div>
        )}
        {f.options && (
          <div>
            <span>Nifty option chain</span>
            <b>{f.options.label}</b>
            <small>
              PCR {f.options.pcr ?? "—"} · max pain {f.options.maxPain ?? "—"} · walls {f.options.support ?? "—"} / {f.options.resistance ?? "—"}
            </small>
          </div>
        )}
      </div>

      <div className="gm-grid">
        <div>
          <h5>What the cues say</h5>
          <ul className="gm-votes">
            {f.votes.map((v) => (
              <li key={v.id} className={v.vote > 0.1 ? "is-for" : v.vote < -0.1 ? "is-against" : ""}>
                <span className="gm-vote" aria-hidden="true">
                  <i style={{ width: `${Math.abs(v.vote) * 50}%`, [v.vote >= 0 ? "left" : "right"]: "50%" }} />
                </span>
                <span>
                  <b>{v.label}</b> {v.why}
                </span>
              </li>
            ))}
          </ul>
          {f.sectors.length > 0 && (
            <>
              <h5>Sectors in the way</h5>
              <ul className="gm-sectors">
                {f.sectors.map((x) => (
                  <li key={x.sector} className={`is-${x.bias}`}>
                    <b>{x.sector}</b> <em>{x.bias}</em> — {x.why}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div className="gm-tablewrap">
          <h5>World markets</h5>
          <table className="gm-table">
            <thead>
              <tr>
                <th scope="col">Market</th>
                <th scope="col">Last</th>
                <th scope="col">Change</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {f.markets.map((x) => (
                <tr key={x.id}>
                  <th scope="row">
                    {x.name}
                    <small>
                      {x.region} · {x.source}
                    </small>
                  </th>
                  <td>{typeof x.last === "number" ? num(x.last) : x.last || "—"}</td>
                  <td className={isNum(x.changePct) ? (x.changePct > 0 ? "is-up" : x.changePct < 0 ? "is-down" : "") : ""}>{isNum(x.changePct) ? pct(x.changePct) : isNum(x.flowCr) ? `₹${Math.round(x.flowCr).toLocaleString("en-IN")} cr` : "—"}</td>
                  <td>{x.session ? SESSION[x.session] || x.session : x.asOf || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="gm-news">
        <div className="gm-news__head">
          <h5>World news (web search by the paid model)</h5>
          <button type="button" className="adm-btn adm-btn--sm" onClick={refreshNews} disabled={newsBusy} data-tip="Search the web now for the US close and futures, Asia, Europe, GIFT Nifty, FII/DII flows, events and overnight news. Uses your paid AI company's tokens.">
            {newsBusy ? "Searching…" : f.news ? "Refresh world news" : "Read world news"}
          </button>
        </div>
        {newsErr && <p className="adm-alert adm-alert--error">{newsErr}</p>}
        {f.news ? (
          <>
            <p>
              <b>{f.news.headline}</b> {f.news.indiaRead}
            </p>
            {f.news.events.length > 0 && (
              <ul>
                {f.news.events.slice(0, 5).map((e) => (
                  <li key={e}>📅 {e}</li>
                ))}
              </ul>
            )}
            <p className="ab-dim">Gathered {new Date(f.news.at).toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })} — web search can be stale or wrong.</p>
          </>
        ) : (
          <p className="ab-dim">No world brief today yet. It needs a paid AI key (Anthropic, OpenAI or Gemini) for web search.</p>
        )}
      </div>

      {f.cautions.length > 0 && (
        <ul className="gm-cautions">
          {f.cautions.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
      <FeedSettings
        feed={feed}
        onSaved={() => {
          loadFeed();
          fc.reload();
        }}
      />
      <p className="ab-dim">
        SGX Nifty moved to NSE IX in GIFT City in July 2023 and is now GIFT Nifty. {f.rule}
      </p>
    </div>
  );
}
