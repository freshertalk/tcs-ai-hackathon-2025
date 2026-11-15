// Social Media — the desk's aggregator, on its own page (opened from the /me tile in a new tab).
//
//   - A floating ticker of the latest market-related headlines and posts, and the LIVE FEED beside
//     it: news sites, Google News searches, X accounts, YouTube channels, Reddit communities and NSE's
//     announcements, newest first, new items sliding in as they arrive (read every 20 seconds).
//   - ORGANIZED FOR TRADING: what the desk's rules (and, only where needed, the AI model) made of it —
//     the brief (the rules' own, or the AI's on request), the news mood, the stocks being talked
//     about, the sectors in the news, the high-impact alerts and the events. The same picture feeds
//     the NSE forecast, the Intraday plans and TradeAI.
//   - LIVE: the server pushes a note the moment new items are kept (a Server-Sent Events stream), and
//     the page reads them at once; without the stream it reads every 20 seconds.
//   - SOURCES & SETTINGS (superadmin): add or remove sources (or one-click suggestions), choose the
//     sectors, keywords and stocks to track, the AI's hourly budget, and the X API token.
//
// Access is official only: RSS feeds, and X through its API with the owner's own token. There is no
// username/password login to any platform (they forbid it, and it risks the account). Nothing here
// posts anything or places an order.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { adminPath } from "../paths";
import { useAuth } from "../auth";
import { useDialog } from "../dialog/DialogProvider";
import Shell from "../Shell";
import { Alert } from "../ui";
import "./social.css";

const FEED_EVERY = 20000;
const DIGEST_EVERY = 60000;
const KIND = { rss: "News", google: "Google News", youtube: "YouTube", reddit: "Reddit", x: "X" };
const GROUPS = [
  { id: "all", label: "All" },
  { id: "news", label: "News", types: ["rss", "google"] },
  { id: "x", label: "X", types: ["x"] },
  { id: "reddit", label: "Reddit", types: ["reddit"] },
  { id: "youtube", label: "YouTube", types: ["youtube"] },
];
const EVENT = { results: "Results", order: "Orders & deals", rating: "Ratings", corporate: "Corporate", regulatory: "Regulatory", policy: "Policy", macro: "Macro", global: "Global", market: "Market", other: "Other" };
const MIN_EVERY = { rss: 5, google: 10, youtube: 15, reddit: 10, x: 15 };

const tone = (v) => (v >= 0.2 ? "up" : v <= -0.2 ? "down" : "flat");
const TONE = { up: "Bullish", down: "Bearish", flat: "Neutral" };
const ICON = { up: "▲", down: "▼", flat: "●" };
function ago(at, now) {
  const t = Date.parse(at || "");
  if (!Number.isFinite(t)) return "";
  const m = Math.max(0, Math.round((now - t) / 60000));
  if (m < 1) return "now";
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h`;
  return `${Math.round(h / 24)} d`;
}
const reduced = () => typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function Tone({ v, label }) {
  const t = tone(v);
  return (
    <span className={`soc-tone is-${t}`}>
      <i aria-hidden="true">{ICON[t]}</i>
      {label || TONE[t]}
    </span>
  );
}

/* ------------------------------------------------------------------------------ the ticker */
function Ticker({ items }) {
  const list = items.slice(0, 14);
  if (!list.length) return null;
  const row = (k) =>
    list.map((it) => (
      <a key={`${k}-${it.id}`} href={it.link || undefined} target="_blank" rel="noopener noreferrer" className="soc-tick__it" tabIndex={k ? -1 : 0} aria-hidden={k ? "true" : undefined}>
        <Tone v={it.reading.sentiment} label={" "} />
        <b>{it.sourceLabel.split(" · ")[0]}</b> {it.reading.summary || it.title}
      </a>
    ));
  return (
    <div className="soc-tick" role="region" aria-label="Latest market headlines and posts">
      <span className="soc-tick__live">
        <i aria-hidden="true" /> LIVE
      </span>
      <div className="soc-tick__view">
        <div className={`soc-tick__track ${reduced() ? "is-still" : ""}`} style={{ "--soc-dur": `${Math.max(40, list.length * 9)}s` }}>
          {row(0)}
          {!reduced() && row(1)}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------ one item */
function Item({ it, now, fresh, onSymbol }) {
  const r = it.reading;
  const t = tone(r.sentiment);
  return (
    <li className={`soc-item is-${t} ${fresh ? "is-new" : ""} ${r.relevant ? "" : "is-quiet"}`}>
      <div className="soc-item__top">
        <span className={`soc-kind soc-kind--${it.type}`}>{KIND[it.type] || it.type}</span>
        <span className="soc-item__src">{it.sourceLabel}</span>
        {it.author && it.type !== "rss" && <span className="soc-item__by">{it.author}</span>}
        <time dateTime={it.at} title={new Date(it.at).toLocaleString("en-IN")}>
          {ago(it.at, now)}
        </time>
      </div>
      <a className="soc-item__title" href={it.link || undefined} target="_blank" rel="noopener noreferrer">
        {it.title}
      </a>
      {r.summary && r.summary !== it.title ? <p className="soc-item__sum">{r.summary}</p> : it.text ? <p className="soc-item__sum is-raw">{it.text.slice(0, 240)}</p> : null}
      <div className="soc-item__tags">
        {r.relevant ? <Tone v={r.sentiment} /> : <span className="soc-chip is-dim">Not market-related</span>}
        {r.relevant && <span className={`soc-impact is-${r.impact}`}>{r.impact} impact</span>}
        {r.event && r.event !== "other" && r.relevant && <span className="soc-chip">{EVENT[r.event] || r.event}</span>}
        {r.symbols.map((s) => (
          <button type="button" key={s} className="soc-sym" onClick={() => onSymbol(s)} data-tip={`Show only ${s}`}>
            {s}
          </button>
        ))}
        {r.sectors.slice(0, 3).map((s) => (
          <span key={s} className="soc-chip">
            {s}
          </span>
        ))}
        {it.metrics && (it.metrics.likes || it.metrics.reposts) ? (
          <span className="soc-chip is-dim">
            ♥ {it.metrics.likes || 0} · ↻ {it.metrics.reposts || 0}
          </span>
        ) : null}
        <span className={`soc-by ${r.by === "ai" ? "is-ai" : ""}`} data-tip={r.by === "ai" ? `Organised by the AI model${it.ai && it.ai.by ? ` (${it.ai.by})` : ""}` : "Organised by the desk's rules (the AI has not read it yet)"}>
          {r.by === "ai" ? "AI" : "rules"}
        </span>
      </div>
    </li>
  );
}

/* --------------------------------------------------------------------- organised for trading */
function Mood({ mood, items, aiRead }) {
  const s = mood ? mood.score : 0;
  const pos = 50 + Math.max(-100, Math.min(100, s)) / 2;
  return (
    <section className="soc-card soc-mood" aria-labelledby="soc-mood-h">
      <h3 id="soc-mood-h">News mood · 24 h</h3>
      <p className={`soc-mood__v is-${tone(s / 100)}`}>
        <b>{mood ? mood.label : "—"}</b> <span>{s > 0 ? "+" : ""}{s}</span>
      </p>
      <div className="soc-gauge" role="img" aria-label={`Mood ${s} on a scale from −100 (bearish) to +100 (bullish)`}>
        <i style={{ left: `${pos}%` }} />
      </div>
      <p className="soc-gauge__k">
        <span>−100 bearish</span>
        <span>+100 bullish</span>
      </p>
      <p className="soc-dim">
        {items} market item{items === 1 ? "" : "s"}
        {aiRead ? `, ${aiRead} read by the AI` : ""}. Newer and higher-impact items weigh more.
      </p>
    </section>
  );
}

function Brief({ ai, desk, busy, onRefresh, canRun, now }) {
  const b = ai || desk;
  return (
    <section className={`soc-card soc-brief ${ai ? "is-ai" : ""}`} aria-labelledby="soc-brief-h">
      <header>
        <h3 id="soc-brief-h">{ai ? "AI brief" : "Desk brief"}</h3>
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={onRefresh} disabled={busy || !canRun} data-tip={canRun ? "The AI model reads the last six hours' organised items and writes what matters now — one paid request; the desk's own brief is free and always here." : "Needs the AI model: save its key on the AI page."}>
          {busy ? "Writing…" : ai ? "Rewrite with AI" : "Ask the AI"}
        </button>
      </header>
      {!b ? (
        <p className="soc-dim">No market items in the last six hours yet.</p>
      ) : (
        <>
          <p className={`soc-brief__head is-${b.mood === "risk_on" ? "up" : b.mood === "risk_off" ? "down" : "flat"}`}>
            <span className="soc-brief__mood">{b.mood === "risk_on" ? "Risk-on" : b.mood === "risk_off" ? "Risk-off" : "Mixed"}</span> {b.headline}
          </p>
          {b.themes.length > 0 && (
            <ul className="soc-themes">
              {b.themes.map((t) => (
                <li key={t.title}>
                  <b>{t.title}</b> — {t.detail}
                </li>
              ))}
            </ul>
          )}
          {b.watch.length > 0 && (
            <>
              <h4>Stocks to watch</h4>
              <ul className="soc-watch">
                {b.watch.map((w) => (
                  <li key={w.symbol}>
                    <span className={`soc-dir is-${w.direction === "up" ? "up" : w.direction === "down" ? "down" : "flat"}`}>
                      {w.direction === "up" ? "▲" : w.direction === "down" ? "▼" : "●"} {w.symbol}
                    </span>{" "}
                    {w.why}
                  </li>
                ))}
              </ul>
            </>
          )}
          {b.sectors.length > 0 && (
            <>
              <h4>Sectors</h4>
              <ul className="soc-secs">
                {b.sectors.map((x) => (
                  <li key={x.sector}>
                    <span className={`soc-chip is-${x.bias === "tailwind" ? "up" : x.bias === "headwind" ? "down" : "flat"}`}>
                      {x.bias === "tailwind" ? "▲ tailwind" : x.bias === "headwind" ? "▼ headwind" : "● watch"}
                    </span>{" "}
                    <b>{x.sector}</b> — {x.why}
                  </li>
                ))}
              </ul>
            </>
          )}
          {(b.risks.length > 0 || b.checklist.length > 0) && (
            <div className="soc-brief__two">
              {b.risks.length > 0 && (
                <div>
                  <h4>Risks</h4>
                  <ul>
                    {b.risks.map((x) => (
                      <li key={x}>⚠️ {x}</li>
                    ))}
                  </ul>
                </div>
              )}
              {b.checklist.length > 0 && (
                <div>
                  <h4>Checklist</h4>
                  <ul>
                    {b.checklist.map((x) => (
                      <li key={x}>☐ {x}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          <p className="soc-dim">
            {ai ? `By ${b.by} · ${ago(b.at, now) === "now" ? "just now" : `${ago(b.at, now)} ago`}` : "Written by the desk’s rules — no AI, no cost"} · from {b.items} items. Social posts are unverified; a summary of what was published, not advice.
          </p>
        </>
      )}
    </section>
  );
}

function Radar({ rows, onSymbol, now }) {
  return (
    <section className="soc-card" aria-labelledby="soc-radar-h">
      <h3 id="soc-radar-h">Stock radar</h3>
      {!rows.length ? (
        <p className="soc-dim">No NSE stock named in the last day’s market items yet.</p>
      ) : (
        <div className="soc-scroll">
          <table className="soc-table">
            <thead>
              <tr>
                <th scope="col">Stock</th>
                <th scope="col" className="is-num">
                  Items
                </th>
                <th scope="col">Tone</th>
                <th scope="col">Latest</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 12).map((r) => (
                <tr key={r.symbol}>
                  <th scope="row">
                    <button type="button" className="soc-sym" onClick={() => onSymbol(r.symbol)} data-tip={`Show only ${r.symbol} in the feed`}>
                      {r.symbol}
                    </button>
                    {r.watched && <small className="soc-star" title="A stock you track">★</small>}
                  </th>
                  <td className="is-num">{r.mentions}</td>
                  <td>
                    <Tone v={r.sentiment} />
                  </td>
                  <td className="soc-table__t">
                    {r.top ? (
                      <a href={r.top.link || undefined} target="_blank" rel="noopener noreferrer">
                        {r.top.summary || r.top.title}
                      </a>
                    ) : (
                      "—"
                    )}
                    {r.last && <small> · {ago(r.last, now)}</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Sectors({ rows, onSector, picked }) {
  return (
    <section className="soc-card" aria-labelledby="soc-sec-h">
      <h3 id="soc-sec-h">Sectors in the news</h3>
      {!rows.length ? (
        <p className="soc-dim">No sector named yet.</p>
      ) : (
        <div className="soc-heat">
          {rows.slice(0, 16).map((x) => (
            <button type="button" key={x.id} className={`soc-heat__it is-${tone(x.sentiment)} ${picked === x.id ? "is-picked" : ""}`} onClick={() => onSector(picked === x.id ? "" : x.id)} aria-pressed={picked === x.id} data-tip={`${x.mentions} items · net ${x.sentiment > 0 ? "+" : ""}${x.sentiment} — click to filter the feed`}>
              <span>{x.name}</span>
              <small>
                {ICON[tone(x.sentiment)]} {x.mentions}
              </small>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function Alerts({ rows, events, now }) {
  const counts = {};
  for (const e of events) counts[e.event] = (counts[e.event] || 0) + 1;
  return (
    <section className="soc-card" aria-labelledby="soc-al-h">
      <h3 id="soc-al-h">High-impact alerts</h3>
      {Object.keys(counts).length > 0 && (
        <p className="soc-evts">
          {Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .map(([k, n]) => (
              <span key={k} className="soc-chip">
                {EVENT[k] || k} · {n}
              </span>
            ))}
        </p>
      )}
      {!rows.length ? (
        <p className="soc-dim">Nothing high-impact in the last day.</p>
      ) : (
        <ul className="soc-alerts">
          {rows.map((a) => (
            <li key={a.id} className={`is-${tone(a.sentiment)}`}>
              <Tone v={a.sentiment} label={" "} />
              <span>
                <a href={a.link || undefined} target="_blank" rel="noopener noreferrer">
                  {a.summary || a.title}
                </a>
                <small>
                  {a.source}
                  {a.sources > 1 ? ` + ${a.sources - 1} more source${a.sources > 2 ? "s" : ""}` : ""} · {ago(a.at, now)} · {a.why}
                  {a.symbols.length ? ` · ${a.symbols.join(", ")}` : ""}
                </small>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------------- sources & settings */
function SettingsPanel({ cfg, onSaved, onClose }) {
  const ask = useDialog();
  const s = cfg.settings;
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState("");
  const [add, setAdd] = useState({ type: "rss", value: "", label: "", everyMin: "" });
  const [kw, setKw] = useState(s.keywords.join(", "));
  const [watch, setWatch] = useState(s.watch.join(", "));
  const [perHour, setPerHour] = useState(String(s.aiPerHour));
  const aiMode = s.aiMode || (s.aiOn ? "smart" : "off");
  const [xToken, setXToken] = useState("");

  const call = async (what, url, opts, okText) => {
    setBusy(what);
    setErr("");
    setOk("");
    try {
      const d = await api(url, opts);
      onSaved(d.settings);
      if (okText) setOk(okText);
      return d;
    } catch (e) {
      setErr(e.message);
      return null;
    } finally {
      setBusy("");
    }
  };
  const put = (body, okText) => call("settings", "/api/admin/social/settings", { method: "PUT", body }, okText);
  const addSource = async (e) => {
    e.preventDefault();
    const d = await call("add", "/api/admin/social/sources", { method: "POST", body: { type: add.type, value: add.value, label: add.label, everyMin: add.everyMin ? Number(add.everyMin) : undefined } }, "Added. It is read within a minute.");
    if (d) setAdd({ type: add.type, value: "", label: "", everyMin: "" });
  };
  const remove = async (x) => {
    const yes = await ask({ tone: "danger", title: "Remove this source?", body: `“${x.label}” is taken off the list. Items already read stay in the feed until they age out.`, confirmText: "Remove it", cancelText: "Keep it" });
    if (yes) call(`rm-${x.id}`, `/api/admin/social/sources/${encodeURIComponent(x.id)}`, { method: "DELETE" }, "Removed.");
  };
  const saveToken = async (e) => {
    e.preventDefault();
    const d = await call("x", "/api/admin/social/creds", { method: "PUT", body: { xToken } }, "The X token is saved (encrypted). X accounts are read from the next round.");
    if (d) setXToken("");
  };
  const toggleSector = (id) => put({ sectors: s.sectors.includes(id) ? s.sectors.filter((x) => x !== id) : [...s.sectors, id] });

  return (
    <section className="soc-card soc-set" aria-labelledby="soc-set-h">
      <header>
        <h3 id="soc-set-h">Sources &amp; settings</h3>
        <button type="button" className="soc-x" onClick={onClose} aria-label="Close the settings">
          ×
        </button>
      </header>
      <Alert kind="ok">{ok}</Alert>
      <Alert>{err}</Alert>

      <h4>Sources ({s.sources.filter((x) => x.enabled).length} on)</h4>
      <ul className="soc-srcs">
        {s.sources.map((x) => (
          <li key={x.id} className={x.enabled ? "" : "is-off"}>
            <label className="soc-switch" data-tip={x.enabled ? "On: read every few minutes" : "Off: not read"}>
              <input type="checkbox" checked={x.enabled} disabled={Boolean(busy)} onChange={(e) => call(`on-${x.id}`, `/api/admin/social/sources/${encodeURIComponent(x.id)}`, { method: "PUT", body: { enabled: e.target.checked } })} />
              <span aria-hidden="true" />
              <span className="soc-vh">{x.label}</span>
            </label>
            <span className="soc-srcs__n">
              <b>{x.label}</b>
              <small>
                <span className={`soc-kind soc-kind--${x.type}`}>{KIND[x.type]}</span> every {x.everyMin} min · {x.count} items
                {x.error ? <em className="soc-bad"> · {x.error}</em> : x.lastOk ? " · working" : x.enabled ? " · not read yet" : ""}
                {x.needsKey && !x.error ? <em className="soc-bad"> · needs the X token below</em> : null}
              </small>
            </span>
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={Boolean(busy)} onClick={() => remove(x)} aria-label={`Remove ${x.label}`}>
              Remove
            </button>
          </li>
        ))}
      </ul>

      <form className="soc-add" onSubmit={addSource}>
        <label>
          <span>Kind</span>
          <select value={add.type} onChange={(e) => setAdd({ ...add, type: e.target.value })}>
            {Object.entries(s.kinds).map(([id, k]) => (
              <option key={id} value={id}>
                {k.name}
              </option>
            ))}
          </select>
        </label>
        <label className="soc-add__v">
          <span>{add.type === "rss" ? "Feed address" : add.type === "google" ? "Search words" : add.type === "x" ? "X handle" : add.type === "reddit" ? "Community" : "Channel"}</span>
          <input value={add.value} onChange={(e) => setAdd({ ...add, value: e.target.value })} placeholder={s.kinds[add.type] ? s.kinds[add.type].hint : ""} spellCheck="false" autoComplete="off" required />
        </label>
        <label>
          <span>Name (optional)</span>
          <input value={add.label} onChange={(e) => setAdd({ ...add, label: e.target.value })} placeholder="Shown in the feed" />
        </label>
        <label className="soc-add__n">
          <span>Every (min)</span>
          <input type="number" min={MIN_EVERY[add.type]} max="240" value={add.everyMin} onChange={(e) => setAdd({ ...add, everyMin: e.target.value })} placeholder={String(MIN_EVERY[add.type])} />
        </label>
        <button className="adm-btn adm-btn--solid adm-btn--sm" disabled={Boolean(busy) || !add.value.trim()}>
          {busy === "add" ? "Adding…" : "Add source"}
        </button>
      </form>

      {s.presets.length > 0 && (
        <>
          <h4>Suggestions — one click to add</h4>
          <div className="soc-presets">
            {s.presets.map((p) => (
              <button type="button" key={`${p.type}|${p.value}`} className="soc-preset" disabled={Boolean(busy)} onClick={() => call("preset", "/api/admin/social/sources", { method: "POST", body: p }, `Added ${p.label}.`)}>
                + {p.label}
              </button>
            ))}
          </div>
        </>
      )}

      <h4>What to track</h4>
      <div className="soc-sectors" role="group" aria-label="Sectors to track">
        {s.sectorList.map((x) => (
          <label key={x.id} className={`soc-pick ${s.sectors.includes(x.id) ? "is-on" : ""}`}>
            <input type="checkbox" checked={s.sectors.includes(x.id)} disabled={Boolean(busy)} onChange={() => toggleSector(x.id)} /> {x.name}
          </label>
        ))}
      </div>
      <div className="soc-row2">
        <label>
          <span>Keywords (comma-separated) — an item with one counts as market-related</span>
          <input value={kw} onChange={(e) => setKw(e.target.value)} onBlur={() => kw !== s.keywords.join(", ") && put({ keywords: kw }, "Keywords saved.")} placeholder="e.g. capex, buyback, block deal" />
        </label>
        <label>
          <span>Stocks you track (NSE symbols) — their items become alerts</span>
          <input value={watch} onChange={(e) => setWatch(e.target.value.toUpperCase())} onBlur={() => watch !== s.watch.join(", ") && put({ watch }, "Stocks saved.")} placeholder="e.g. SBIN, RELIANCE, INFY" spellCheck="false" />
        </label>
      </div>

      <h4>The AI model</h4>
      <div className="soc-ai">
        <label className="soc-add__n soc-ai__mode">
          <span>When the AI reads an item</span>
          <select value={aiMode} disabled={Boolean(busy)} onChange={(e) => put({ aiMode: e.target.value }, { smart: "The AI reads an item only when the rules cannot settle it and it matters to you.", all: "The AI reads every market-related item (uses the most credits).", off: "The AI is off here: the desk's rules alone organise the feed." }[e.target.value])}>
            <option value="smart">Only when needed (recommended)</option>
            <option value="all">Every market-related item</option>
            <option value="off">Never — the rules only</option>
          </select>
        </label>
        <label className="soc-add__n">
          <span>Batches an hour</span>
          <input type="number" min="0" max="200" value={perHour} onChange={(e) => setPerHour(e.target.value)} onBlur={() => perHour !== String(s.aiPerHour) && put({ aiPerHour: Number(perHour) }, "Saved.")} />
        </label>
        <p className="soc-dim">
          {cfg.status.model ? `${cfg.status.model} — the default model, picked on ` : "No AI key is saved — set it on "}
          <a href={adminPath("/ai")}>the AI page</a>. The desk’s rules organise every item for free; “Only when needed” sends the AI just the items that matter to you (open positions, tracked stocks, high impact) and that the rules cannot settle — an unclear tone, a market-wide event with no stock named, a social post about a stock. A batch is up to eight such items in one paid request (the headline and a short excerpt — nothing about you). AI batches today: {cfg.status.aiToday || 0}.
        </p>
        <label className="soc-pick">
          <input type="checkbox" checked={Boolean(s.aiBriefAuto)} disabled={Boolean(busy)} onChange={(e) => put({ aiBriefAuto: e.target.checked }, e.target.checked ? "The AI rewrites the brief by itself every half hour when new items come in." : "The AI brief is written only when you ask; the desk's brief is always there.")} /> Let the AI rewrite the brief by itself (every half hour, when new items came in)
        </label>
      </div>

      <h4>Alerts</h4>
      <label className="soc-pick">
        <input type="checkbox" checked={s.alertMe !== false} disabled={Boolean(busy)} onChange={(e) => put({ alertMe: e.target.checked }, e.target.checked ? "News alerts on: high-impact news on your stocks goes to Telegram / WhatsApp." : "News alerts off.")} /> Alert me on Telegram / WhatsApp about high-impact news on my open positions and tracked stocks (at most one per stock every 30 minutes, 12 a day)
      </label>

      <h4>Accounts &amp; keys</h4>
      <form className="soc-key" onSubmit={saveToken}>
        <label>
          <span>X API Bearer Token {s.creds.x ? "— saved" : "— needed for X accounts"}</span>
          <input type="password" value={xToken} onChange={(e) => setXToken(e.target.value)} placeholder={s.creds.x ? "Paste a new token to replace it" : "From developer.x.com → your app → Keys and tokens"} autoComplete="off" spellCheck="false" />
        </label>
        <button className="adm-btn adm-btn--solid adm-btn--sm" disabled={Boolean(busy) || !xToken.trim()}>
          {busy === "x" ? "Saving…" : "Save token"}
        </button>
        {s.creds.x && (
          <button type="button" className="adm-btn adm-btn--danger adm-btn--sm" disabled={Boolean(busy)} onClick={() => call("x", "/api/admin/social/creds", { method: "PUT", body: { remove: "x" } }, "The X token was removed.")}>
            Remove
          </button>
        )}
      </form>
      <p className="soc-note">
        <b>Why no usernames and passwords?</b> X, Facebook, Instagram, LinkedIn and the others forbid automated logins with a password, and an account used that way can be locked. So sources are read the official way: news sites, Google News, YouTube, Reddit and NSE through their public RSS feeds (free), and X through its API with your own token (X sells API access by plan). Facebook, Instagram and LinkedIn offer no reading API without an app review: follow their news through a Google News search or the publisher’s RSS instead. The token is encrypted on the server and never shown again.
      </p>
    </section>
  );
}

/* -------------------------------------------------------------------------------- the page */
export default function Social() {
  const { user } = useAuth() || {};
  const isOwner = Boolean(user && user.role === "superadmin");
  const [cfg, setCfg] = useState(null);
  const [feed, setFeed] = useState(null);
  const [digest, setDigest] = useState(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [group, setGroup] = useState("all");
  const [onlyMarket, setOnlyMarket] = useState(true);
  const [sector, setSector] = useState("");
  const [symbol, setSymbol] = useState("");
  const [q, setQ] = useState("");
  const [showSet, setShowSet] = useState(false);
  const [fresh, setFresh] = useState(() => new Set());
  const [now, setNow] = useState(Date.now());
  const [live, setLive] = useState(false); // the server's live stream is connected
  const seen = useRef(null);

  const loadCfg = useCallback(() => api("/api/admin/social").then(setCfg), []);
  const loadFeed = useCallback(
    () =>
      api(`/api/admin/social/feed?limit=150${onlyMarket ? "&relevant=1" : ""}`).then((d) => {
        // the items that arrived since the last read slide in, highlighted for a while
        if (seen.current) {
          const add = d.items.filter((x) => !seen.current.has(x.id)).map((x) => x.id);
          if (add.length) {
            setFresh(new Set(add));
            setTimeout(() => setFresh(new Set()), 12000);
          }
        }
        seen.current = new Set(d.items.map((x) => x.id));
        setFeed(d);
        // "how long ago" is counted on the server's clock, so a device whose clock is off still reads right
        setNow(Date.parse(d.at) || Date.now());
      }),
    [onlyMarket]
  );
  const loadDigest = useCallback(() => api("/api/admin/social/digest?hours=24").then(setDigest), []);

  useEffect(() => {
    loadCfg().catch((e) => setErr(e.message));
    loadDigest().catch(() => {});
  }, [loadCfg, loadDigest]);
  useEffect(() => {
    seen.current = null;
    loadFeed().catch((e) => setErr(e.message));
  }, [loadFeed]);
  // live: the server pushes a note the moment new items are kept or organised
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.EventSource !== "function") return undefined;
    let es;
    try {
      es = new window.EventSource("/api/admin/social/stream");
    } catch (_) {
      return undefined;
    }
    const fresh = () => {
      loadFeed().catch(() => {});
      loadDigest().catch(() => {});
    };
    es.addEventListener("hello", () => setLive(true));
    es.addEventListener("items", fresh);
    es.addEventListener("organised", fresh);
    es.onerror = () => setLive(false);
    return () => es.close();
  }, [loadFeed, loadDigest]);
  // and the page reads by itself as well: every 20 s without the stream, every 2 minutes with it
  useEffect(() => {
    const a = setInterval(() => document.visibilityState !== "hidden" && loadFeed().catch(() => {}), live ? 120000 : FEED_EVERY);
    const b = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      loadDigest().catch(() => {});
      loadCfg().catch(() => {});
    }, DIGEST_EVERY);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, [loadFeed, loadDigest, loadCfg, live]);

  const refresh = async () => {
    setBusy("refresh");
    setMsg("");
    try {
      const d = await api("/api/admin/social/refresh", { method: "POST" });
      setCfg((c) => ({ ...c, settings: d.settings, status: d.status }));
      setMsg(`Read ${d.polled.read} source${d.polled.read === 1 ? "" : "s"}: ${d.polled.added} new item${d.polled.added === 1 ? "" : "s"}${d.ai.read ? `, ${d.ai.read} organised by the AI` : ""}.`);
      await Promise.all([loadFeed(), loadDigest()]);
    } catch (e) {
      setMsg(e.message);
    }
    setBusy("");
  };
  const writeBrief = async () => {
    setBusy("brief");
    setMsg("");
    try {
      await api("/api/admin/social/brief", { method: "POST" });
      await loadDigest();
    } catch (e) {
      setMsg(e.message);
    }
    setBusy("");
  };

  const items = useMemo(() => {
    if (!feed) return [];
    const g = GROUPS.find((x) => x.id === group);
    const needle = q.trim().toLowerCase();
    return feed.items.filter((it) => {
      if (g && g.types && !g.types.includes(it.type)) return false;
      if (sector && !it.reading.sectors.includes(sector)) return false;
      if (symbol && !it.reading.symbols.includes(symbol)) return false;
      if (needle && !`${it.title} ${it.text} ${it.reading.summary} ${it.sourceLabel}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [feed, group, sector, symbol, q]);
  const tickerItems = useMemo(() => (feed ? feed.items.filter((x) => x.reading.relevant).slice(0, 14) : []), [feed]);

  const st = cfg && cfg.status;
  const pickSymbol = (s) => {
    setSymbol(s);
    setGroup("all");
    window.scrollTo({ top: 0, behavior: reduced() ? "auto" : "smooth" });
  };

  return (
    <Shell crumb="Social Media" wide>
      <div className="soc">
        <header className="soc-head">
          <div>
            <h1 className="adm-h1">Social Media</h1>
            <p className="soc-lead">Live news and posts that can move NSE and BSE stocks — read from your sources, organised for trading by the desk’s rules and the AI model, and passed to the forecast, the Intraday plans and TradeAI.</p>
          </div>
          <div className="soc-head__act">
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={refresh} disabled={Boolean(busy)} data-tip="Read every source now (they are read by themselves every few minutes).">
              {busy === "refresh" ? "Reading…" : "↻ Read now"}
            </button>
            {isOwner && (
              <button type="button" className="adm-btn adm-btn--solid adm-btn--sm" onClick={() => setShowSet((x) => !x)} aria-expanded={showSet}>
                ⚙ Sources &amp; settings
              </button>
            )}
          </div>
        </header>

        {st && (
          <p className="soc-status" role="status">
            <span className={`soc-dot ${st.on ? "is-on" : ""}`} aria-hidden="true" />
            <b>{st.on}</b> source{st.on === 1 ? "" : "s"} on{st.failing ? <em className="soc-bad"> · {st.failing} failing</em> : null} · <b>{st.items}</b> items kept · read {st.polledAt ? (ago(st.polledAt, now) === "now" ? "just now" : `${ago(st.polledAt, now)} ago`) : "not yet"} · {live ? <b className="soc-live">● live</b> : "updates every 20 s"} · AI {st.aiOn && st.aiReady ? (
              <>
                <b>{st.aiMode === "all" ? "on every market item" : "only when needed"}</b> ({st.model}, {st.aiToday || 0} batch{st.aiToday === 1 ? "" : "es"} today)
              </>
            ) : st.aiOn ? "waiting for a key (AI page)" : "off — the rules only"}
          </p>
        )}
        <Alert>{err}</Alert>
        {msg && <p className="soc-msg">{msg}</p>}

        {showSet && cfg && isOwner && <SettingsPanel cfg={cfg} onClose={() => setShowSet(false)} onSaved={(s) => setCfg((c) => ({ ...c, settings: s }))} />}

        <Ticker items={tickerItems} />

        <div className="soc-grid">
          <section className="soc-feed" aria-labelledby="soc-feed-h">
            <header className="soc-feed__head">
              <h2 id="soc-feed-h">
                Live feed <small>{feed ? `${items.length} shown` : ""}</small>
              </h2>
              <div className="soc-filters">
                <div className="soc-seg" role="group" aria-label="Kind of source">
                  {GROUPS.map((g) => (
                    <button key={g.id} type="button" aria-pressed={group === g.id} onClick={() => setGroup(g.id)}>
                      {g.label}
                    </button>
                  ))}
                </div>
                <label className="soc-pick is-on soc-only">
                  <input type="checkbox" checked={onlyMarket} onChange={(e) => setOnlyMarket(e.target.checked)} /> Market-related only
                </label>
                <input className="soc-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the feed" aria-label="Search the feed" />
              </div>
              {(symbol || sector) && (
                <p className="soc-active">
                  Showing only{" "}
                  {symbol && (
                    <button type="button" className="soc-sym" onClick={() => setSymbol("")} aria-label={`Clear the ${symbol} filter`}>
                      {symbol} ×
                    </button>
                  )}{" "}
                  {sector && (
                    <button type="button" className="soc-chip" onClick={() => setSector("")} aria-label="Clear the sector filter">
                      {(cfg && (cfg.settings.sectorList.find((x) => x.id === sector) || {}).name) || sector} ×
                    </button>
                  )}
                </p>
              )}
            </header>
            {!feed ? (
              <p className="soc-dim">Loading the feed…</p>
            ) : !items.length ? (
              <p className="soc-empty">{feed.items.length ? "Nothing matches these filters." : "No items yet. Sources are read within a minute of the server starting; press “Read now” to read them at once."}</p>
            ) : (
              <ul className="soc-list" aria-live="polite">
                {items.map((it) => (
                  <Item key={it.id} it={it} now={now} fresh={fresh.has(it.id)} onSymbol={pickSymbol} />
                ))}
              </ul>
            )}
          </section>

          <aside className="soc-org" aria-labelledby="soc-org-h">
            <h2 id="soc-org-h">Organized for trading</h2>
            {!digest ? (
              <p className="soc-dim">Loading…</p>
            ) : (
              <>
                <Brief ai={digest.brief} desk={digest.deskBrief} busy={busy === "brief"} onRefresh={writeBrief} canRun={Boolean(st && st.aiReady)} now={now} />
                <Mood mood={digest.mood} items={digest.items} aiRead={digest.aiRead} />
                <Radar rows={digest.radar} onSymbol={pickSymbol} now={now} />
                <Sectors rows={digest.sectors} onSector={setSector} picked={sector} />
                <Alerts rows={digest.alerts} events={digest.events} now={now} />
                <p className="soc-dim soc-foot">
                  The desk’s rules read and organise every item, instantly and for free; the AI model reads only the items that need it, within its hourly budget. This picture is one input to the <a href={adminPath("/stock-report")}>forecast and plans</a> — not a call, and never a reason on its own to trade.
                </p>
              </>
            )}
          </aside>
        </div>
      </div>
    </Shell>
  );
}
