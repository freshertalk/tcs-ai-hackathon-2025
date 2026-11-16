// The desk's knowledge base (server/market/knowledge.js and server/market/kb/): the Indian market and its
// rules, orders, costs and taxes, every major indicator, price action and patterns, volume and open
// interest, strategies, risk, psychology, testing, macro and sectors, fundamentals, and the documented
// methods of well-known traders and investors. Every AI feature is given the part that matters to its
// job with each request; TradeAI searches it for each question. Here it can be read and searched —
// with the same search the AI uses.

import React, { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import "./knowledge.css";

export function KnowledgeBase() {
  const [all, setAll] = useState(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [found, setFound] = useState(null);
  const [open, setOpen] = useState(() => new Set());
  const timer = useRef(null);

  useEffect(() => {
    let alive = true;
    api("/api/admin/knowledge")
      .then((d) => alive && setAll(d))
      .catch((e) => alive && setErr(e.message));
    return () => {
      alive = false;
    };
  }, []);

  // the same search the AI uses, a moment after typing stops
  useEffect(() => {
    clearTimeout(timer.current);
    const text = q.trim();
    if (text.length < 2) {
      setFound(null);
      return undefined;
    }
    timer.current = setTimeout(() => {
      api(`/api/admin/knowledge?q=${encodeURIComponent(text)}`)
        .then((d) => setFound(d.results || []))
        .catch((e) => setErr(e.message));
    }, 300);
    return () => clearTimeout(timer.current);
  }, [q]);

  const toggle = (area) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(area)) n.delete(area);
      else n.add(area);
      return n;
    });

  return (
    <section className="kb" aria-label="The desk's knowledge base">
      <header className="kb-head">
        <div>
          <h2>The knowledge base</h2>
          <p>
            {all ? `${all.count} topics in ${all.areas.length} areas` : "Loading…"} — the Indian market and its rules, orders, costs and taxes, every major indicator, price action and patterns, volume and open interest, strategies, risk, psychology, testing, macro and sectors, fundamentals, and the documented methods of well-known traders and investors.
          </p>
          <p className="kb-dim">
            Every AI feature is given the part that matters to its job with each request; TradeAI searches it for each question and answers questions like &ldquo;what is open interest?&rdquo; straight from it, free. Written from widely published practice, the exchanges&rsquo; and SEBI&rsquo;s rules and the authors&rsquo; own books; rules and rates change — check the exchange or broker before relying on a figure. Where the desk&rsquo;s own measured records differ, the measurement wins.
          </p>
        </div>
        <label className="kb-search">
          <span className="adm-sr">Search the knowledge base</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search — e.g. open interest, T+1, VWAP, Livermore, F&O ban" spellCheck="false" autoComplete="off" />
        </label>
      </header>
      {err && <p className="adm-alert">{err}</p>}

      {found && (
        <div className="kb-results" aria-live="polite">
          {found.length === 0 ? (
            <p className="kb-dim">Nothing in the knowledge base matches &ldquo;{q.trim()}&rdquo;.</p>
          ) : (
            found.map((t, i) => (
              <article key={t.id} className={`kb-topic ${i === 0 ? "is-best" : ""}`}>
                <h3>
                  {t.title} <small>{t.area}</small>
                </h3>
                <ul>
                  {t.rules.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </article>
            ))
          )}
        </div>
      )}

      {!found && all && (
        <div className="kb-areas">
          {all.areas.map((a) => (
            <div key={a.area} className={`kb-area ${open.has(a.area) ? "is-open" : ""}`}>
              <button type="button" className="kb-area__head" aria-expanded={open.has(a.area)} onClick={() => toggle(a.area)}>
                <b>{a.area}</b>
                <small>{a.topics.length} topics</small>
                <span aria-hidden="true">{open.has(a.area) ? "▴" : "▾"}</span>
              </button>
              {open.has(a.area) && (
                <div className="kb-area__body">
                  {a.topics.map((t) => (
                    <details key={t.id} className="kb-topic">
                      <summary>{t.title}</summary>
                      <ul>
                        {t.rules.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    </details>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default KnowledgeBase;
