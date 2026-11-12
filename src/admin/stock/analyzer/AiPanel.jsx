// The AI strategist tab. It asks Claude for a strategy for the open stock — only
// when the button is pressed — shows the answer with every mechanical check that
// was run on it, keeps a scored record of past plans, and holds the skills file
// the model follows and adds lessons to.
//
// With no API key set, this tab explains how to switch it on and the rest of the
// desk carries on unchanged.

import React, { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import { adminPath } from "../../paths";
import { Alert, Loading } from "../../ui";
import { inr, isNum, num, when } from "./format";

const enc = encodeURIComponent;
const HORIZONS = [
  { id: "intraday", label: "Intraday" },
  { id: "swing", label: "Swing" },
  { id: "both", label: "Both" },
];
const MARK = { bullish: "▲", bearish: "▼", neutral: "◆" };
const ENTRY = { at_market: "at the current price", breakout: "on a break of", pullback: "on a pullback to", none: "" };
const OUTCOME = { target: "Target reached", stop: "Stopped out", expired: "Closed at time limit", "not-triggered": "Never triggered", pending: "Waiting for entry", open: "Open", invalid: "Not scoreable" };
const rText = (r) => (isNum(r) ? `${r > 0 ? "+" : ""}${num(r, 2)}R` : "—");

function Plan({ p, onSize }) {
  const none = p.action === "no_trade";
  const failed = p.checks.filter((c) => !c.ok);
  const side = none ? "flat" : p.side;
  return (
    <div className={`aip aip--${side} ${p.checkStatus === "rejected" ? "is-rejected" : ""}`}>
      <h5>
        <span className={`callchip is-${side === "flat" ? "off" : side} ${p.checkStatus === "passed" ? "is-active" : ""}`}>{none ? "No trade" : p.side}</span>
        {p.horizon === "intraday" ? "Intraday · same day" : "Swing · days to weeks"}
      </h5>
      {!none && (
        <dl className="vd-dl">
          <div className="is-strong">
            <dt>
              {p.side === "long" ? "Buy" : "Sell"} {ENTRY[p.entryType]}
            </dt>
            <dd>{inr(p.entry)}</dd>
          </div>
          <div className="is-strong">
            <dt>Stop-loss</dt>
            <dd>{inr(p.stop)}</dd>
          </div>
          <div>
            <dt>Targets</dt>
            <dd>{p.targets.map((t) => inr(t)).join(" → ")}</dd>
          </div>
          <div>
            <dt>Risk / share</dt>
            <dd>
              {inr(p.riskPerShare)} <small>({num(p.riskPct)}%) · reward {num(p.rewardToRisk, 1)}× risk</small>
            </dd>
          </div>
        </dl>
      )}
      <p className="vd-note">{p.rationale}</p>
      {p.invalidation && (
        <p className="vd-note">
          <b>{none ? "Watch for:" : "Cancel if:"}</b> {p.invalidation}
        </p>
      )}
      {!none && (
        <details className="aip__checks" open={failed.length > 0}>
          <summary className={failed.length ? "is-down" : "is-up"}>
            {failed.length ? `Rejected by the desk’s checks — ${failed.length} failed` : `Passed all ${p.checks.length} of the desk’s checks`}
          </summary>
          <ul className="setup__conds">
            {p.checks.map((c) => (
              <li key={c.name} className={c.ok ? "is-ok" : "is-no"}>
                <i aria-hidden="true">{c.ok ? "✓" : "✕"}</i>
                <span>
                  {c.name}
                  <span className="adm-sr">{c.ok ? " — passed" : " — failed"}</span>
                  <small>{c.detail}</small>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {(p.notes || []).map((n) => (
        <p key={n} className="vd-note vd-note--caveat">
          {n}
        </p>
      ))}
      {p.outcome && (
        <p className="vd-note">
          <b>Scored: {OUTCOME[p.outcome.status] || p.outcome.status}</b> {isNum(p.outcome.r) ? `(${rText(p.outcome.r)})` : ""} — {p.outcome.note}
        </p>
      )}
      {!none && p.checkStatus === "passed" && p.side === "long" && onSize && (
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => onSize(p.entry, p.stop)}>
          Size this trade
        </button>
      )}
    </div>
  );
}

function Strategy({ e, onSize, models }) {
  const model = (models.find((m) => m.id === e.model) || {}).name || e.model;
  return (
    <div className="ai-out">
      <p className={`vd-stance vd-stance--${e.stance}`}>
        <b>
          <span aria-hidden="true">{MARK[e.stance]}</span> {e.stance.charAt(0).toUpperCase() + e.stance.slice(1)}
        </b>
        <span>
          {e.confidence} confidence (how well the evidence agrees — not a chance of profit) · {when(e.at)}
        </span>
      </p>
      <p className="vd-headline">{e.summary}</p>
      {e.context && (e.context.stale || !e.context.live) && (
        <p className="adm-alert adm-alert--error">This was built without a live price ({e.context.stale ? "saved data" : "last close"}). Re-check every level before using it.</p>
      )}
      <div className="ai-plans">
        {e.plans.map((p) => (
          <Plan key={p.horizon} p={p} onSize={onSize} />
        ))}
      </div>
      <div className="an-two">
        <div>
          <h4>Evidence</h4>
          <ul className="ai-list">
            {e.evidence.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          {e.changeMind.length > 0 && (
            <>
              <h4>What would change its mind</h4>
              <ul className="ai-list">
                {e.changeMind.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div>
          <h4>Risks</h4>
          <ul className="ai-list ai-list--risk">
            {e.risks.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          {e.skillsUsed.length > 0 && (
            <>
              <h4>Skills it applied</h4>
              <ul className="ai-list">
                {e.skillsUsed.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
      <p className="adm-small">
        {model} · {num(e.usage.inputTokens, 0)} tokens in, {num(e.usage.outputTokens, 0)} out · at ₹{num(e.context ? e.context.last : null)} · written by a
        language model from price data only. It cannot see news or results and is not investment advice.
      </p>
    </div>
  );
}

function Record({ stats }) {
  if (!stats || stats.total === 0) return <p className="vd-note">No plans yet. Each plan is saved here and scored later against what price actually did.</p>;
  return (
    <>
      <dl className="vd-tiles">
        {[
          ["Plans made", stats.total],
          ["Finished", stats.resolved],
          ["Reached target", stats.target],
          ["Stopped out", stats.stop],
          ["Timed out", stats.expired],
          ["Never triggered", stats.notTriggered],
          ["Rejected by checks", stats.rejected],
          ["Average result", stats.resolved ? rText(stats.avgR) : "—"],
          ["Won", stats.resolved ? `${stats.winRatePct}%` : "—"],
        ].map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {stats.resolved < 30 && (
        <p className="vd-note">
          {stats.resolved} finished plan{stats.resolved === 1 ? "" : "s"} is too few to tell skill from luck. Read these numbers as a diary, not as proof, until there are at least
          thirty.
        </p>
      )}
    </>
  );
}

const NEWS_TONE = {
  positive: ["bullish", "▲ Positive news"],
  negative: ["bearish", "▼ Negative news"],
  mixed: ["neutral", "◆ Mixed news"],
  neutral: ["neutral", "◆ Routine news"],
  none: ["neutral", "◆ No company-specific news found"],
};
const EXPLAINS = {
  yes: "It explains today’s move.",
  partly: "It partly explains today’s move.",
  no: "It does not explain today’s move — that looks driven by the market or by flows.",
  unknown: "Whether it explains today’s move is unclear.",
};
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || "")) ? u : null);

/** "Why is it moving?" — a web search on the one company, on request. */
function News({ symbol, models }) {
  const [state, setState] = useState({ loading: true, news: null, fresh: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setState({ loading: true, news: null, fresh: false });
    setError("");
    api(`/api/admin/ai/news/${enc(symbol)}`)
      .then((d) => alive && setState({ loading: false, news: d.news, fresh: d.fresh }))
      .catch((e) => {
        if (!alive) return;
        setState({ loading: false, news: null, fresh: false });
        setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [symbol]);

  const check = (refresh) => {
    setBusy(true);
    setError("");
    api(`/api/admin/ai/news/${enc(symbol)}`, { method: "POST", body: { refresh } })
      .then((d) => setState({ loading: false, news: d.news, fresh: d.fresh }))
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };

  const n = state.news;
  const [dir, label] = n ? NEWS_TONE[n.tone] || NEWS_TONE.neutral : ["neutral", ""];
  return (
    <section className="an-card">
      <header className="an-card__head">
        <div>
          <h3>Why is it moving? · news check</h3>
          <p>
            A web search on <b>{symbol}</b>: results, new contracts, rating changes, block deals, and what is scheduled. It runs only when you press the button. For the next six
            hours the strategist and the live co-pilot are shown its summary.
          </p>
        </div>
        <button type="button" className="adm-btn adm-btn--solid adm-btn--sm" onClick={() => check(Boolean(n))} disabled={busy}>
          {busy ? "Searching… up to a minute" : n ? "Check again" : `Check the news on ${symbol}`}
        </button>
      </header>
      <Alert>{error}</Alert>
      {busy && <Loading label="Searching the web and reading what it finds…" />}
      {!busy && n && (
        <div className="ai-out">
          <p className={`vd-stance vd-stance--${dir}`}>
            <b>{label}</b>
            <span>
              {EXPLAINS[n.explainsMove] || EXPLAINS.unknown} · checked {when(n.at)}
              {n.move && isNum(n.move.changePct) ? ` with the share ${n.move.changePct >= 0 ? "up" : "down"} ${num(Math.abs(n.move.changePct))}%` : ""}
            </span>
          </p>
          <p className="vd-headline">{n.headline}</p>
          {!state.fresh && <p className="adm-alert adm-alert--info">This check is more than six hours old (or from another day), so the AI is no longer shown it. Check again for today’s news.</p>}
          <div className="an-two">
            <div>
              <h4>What was found</h4>
              {n.items.length > 0 ? (
                <ul className="ai-list ai-news">
                  {n.items.map((x) => (
                    <li key={`${x.date}${x.what}`} className={`is-${x.read}`}>
                      {x.date && <b>{x.date}: </b>}
                      {x.what}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="vd-note">Nothing specific to the company.</p>
              )}
            </div>
            <div>
              <h4>Scheduled</h4>
              {n.upcoming.length > 0 ? (
                <ul className="ai-list">
                  {n.upcoming.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              ) : (
                <p className="vd-note">Nothing scheduled was found.</p>
              )}
              {n.caveats.length > 0 && (
                <>
                  <h4>Unclear or missing</h4>
                  <ul className="ai-list ai-list--risk">
                    {n.caveats.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
          <details className="ai-skills">
            <summary>
              <b>The full note and its sources</b> — {n.sources.length} page{n.sources.length === 1 ? "" : "s"}
            </summary>
            <p className="ai-news__text">{n.text}</p>
            <ul className="ai-list">
              {n.sources.map((s) => (
                <li key={s.url}>
                  {safeUrl(s.url) ? (
                    <a href={safeUrl(s.url)} target="_blank" rel="noopener noreferrer">
                      {s.title}
                    </a>
                  ) : (
                    s.title
                  )}
                  {s.age ? ` · ${s.age}` : ""}
                  {s.cited ? " · cited" : ""}
                </li>
              ))}
            </ul>
          </details>
          <p className="adm-small">
            {(models.find((m) => m.id === n.model) || {}).name || n.model} · {n.usage.searches} web search{n.usage.searches === 1 ? "" : "es"} · {num(n.usage.inputTokens, 0)} tokens
            in, {num(n.usage.outputTokens, 0)} out · written by a language model from web pages. It can be stale, incomplete or wrong, and a headline is not a reason to trade: open
            the sources before relying on it.
          </p>
        </div>
      )}
      {!busy && !n && !state.loading && <p className="vd-note">No news check has been run for {symbol} yet.</p>}
    </section>
  );
}

export default function AiPanel({ symbol, onSize }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState("");
  const [horizon, setHorizon] = useState("both");
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState(null);
  const [journal, setJournal] = useState({ entries: [], stats: null });
  const [review, setReview] = useState(null);
  const [skills, setSkills] = useState(null);
  const [draft, setDraft] = useState("");
  const [skillMsg, setSkillMsg] = useState({ kind: "", text: "" });

  const loadJournal = useCallback(
    () =>
      api(`/api/admin/ai/journal?symbol=${enc(symbol)}`)
        .then((d) => {
          setJournal(d);
          setResult((r) => r || d.entries[0] || null);
        })
        .catch(() => {}),
    [symbol]
  );

  useEffect(() => {
    let alive = true;
    api("/api/admin/ai/status")
      .then((d) => alive && setStatus(d))
      .catch((e) => alive && setError(e.message));
    loadJournal();
    return () => {
      alive = false;
    };
  }, [loadJournal]);

  const build = async () => {
    setBusy("build");
    setError("");
    try {
      const r = await api(`/api/admin/ai/strategy/${enc(symbol)}`, { method: "POST", body: { horizon } });
      setResult(r);
      loadJournal();
    } catch (e) {
      setError(e.message);
    }
    setBusy("");
  };

  const learn = async () => {
    setBusy("review");
    setError("");
    setReview(null);
    try {
      setReview(await api("/api/admin/ai/review", { method: "POST" }));
      loadJournal();
      api("/api/admin/ai/status").then(setStatus).catch(() => {});
      if (skills !== null) openSkills(true);
    } catch (e) {
      setError(e.message);
    }
    setBusy("");
  };

  const openSkills = (force) => {
    if (skills !== null && !force) return;
    api("/api/admin/ai/skills")
      .then((d) => {
        setSkills(d.text);
        setDraft(d.text);
      })
      .catch((e) => setSkillMsg({ kind: "error", text: e.message }));
  };
  const saveSkills = (reset) => {
    setSkillMsg({ kind: "", text: "" });
    (reset ? api("/api/admin/ai/skills/reset", { method: "POST" }) : api("/api/admin/ai/skills", { method: "PUT", body: { text: draft } }))
      .then((d) => {
        setSkills(d.text);
        setDraft(d.text);
        setSkillMsg({ kind: "ok", text: reset ? "Restored the starting rules. Lessons were cleared." : "Saved. The next strategy will follow this file." });
      })
      .catch((e) => setSkillMsg({ kind: "error", text: e.message }));
  };

  if (!status && !error) return <Loading label="Loading the AI strategist…" />;
  if (!status) return <Alert>{error}</Alert>;

  if (!status.configured) {
    return (
      <section className="an-card">
        <header className="an-card__head">
          <div>
            <h3>AI strategist — off</h3>
            <p>
              No Anthropic API key is set, so this tab is idle. Everything else on the desk — the live call, the charts, the setups, the backtests — works
              without it.
            </p>
          </div>
          <a className="adm-btn adm-btn--solid adm-btn--sm" href={adminPath("/ai")}>
            Set up the AI strategist
          </a>
        </header>
        <p className="vd-note">
          With a key, Claude reads this stock’s live and historical Zerodha data and the desk’s skills file, and writes a strategy on request. Each plan is
          checked mechanically, saved, and later scored against real prices; the results become lessons in the skills file. It never places an order.
        </p>
        <Record stats={journal.stats} />
      </section>
    );
  }

  const modelName = (status.models.find((m) => m.id === status.model) || {}).name || status.model;
  return (
    <>
      <section className="an-card">
        <header className="an-card__head">
          <div>
            <h3>AI strategist</h3>
            <p>
              {modelName} reads <b>{symbol}</b>’s live quote, today’s tape, daily history, indicators, the rule engine’s reading and its backtests, then
              writes a plan. It runs only when you press the button, and each answer shows the tokens it used.
            </p>
          </div>
          <div className="ai-go">
            <div className="sv__ranges" role="group" aria-label="Horizon">
              {HORIZONS.map((h) => (
                <button key={h.id} type="button" aria-pressed={horizon === h.id} onClick={() => setHorizon(h.id)} disabled={busy === "build"}>
                  {h.label}
                </button>
              ))}
            </div>
            <button type="button" className="adm-btn adm-btn--solid" onClick={build} disabled={Boolean(busy)}>
              {busy === "build" ? "Thinking… up to a minute" : `Build strategy for ${symbol}`}
            </button>
          </div>
        </header>
        <Alert>{error}</Alert>
        {busy === "build" && <Loading label="Gathering the data and asking the model…" />}
        {result && result.symbol === symbol && busy !== "build" && <Strategy e={result} onSize={onSize} models={status.models} />}
        {!result && busy !== "build" && <p className="vd-note">No strategy has been built for {symbol} yet.</p>}
      </section>

      <News symbol={symbol} models={status.models} />

      <section className="an-card">
        <header className="an-card__head">
          <div>
            <h3>Track record and learning</h3>
            <p>
              Past plans are scored by arithmetic against the prices that followed — a tie between stop and target counts as a stop. When at least three new
              plans have finished, the model is asked what the results teach, and its lessons are added to the skills file.
            </p>
          </div>
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={learn} disabled={Boolean(busy)}>
            {busy === "review" ? "Scoring…" : "Score outcomes & learn"}
          </button>
        </header>
        {review && (
          <div className="adm-alert adm-alert--info" role="status">
            <p>
              Scored {review.scored} plan{review.scored === 1 ? "" : "s"}; {review.newOutcomes} newly finished. {review.learned ? review.observation : review.why}
            </p>
            {review.lessonsAdded.length > 0 && (
              <ul className="ai-list">
                {review.lessonsAdded.map((l) => (
                  <li key={l}>
                    <b>New lesson:</b> {l}
                  </li>
                ))}
              </ul>
            )}
            {review.errors.length > 0 && <p>Could not score: {review.errors.join("; ")}</p>}
          </div>
        )}
        <h4>{symbol}</h4>
        <Record stats={journal.stats} />
        <h4>All stocks</h4>
        <Record stats={status.stats} />

        {journal.entries.length > 0 && (
          <>
            <h4>Plans for {symbol}</h4>
            <div className="bt__scroll">
              <table className="an-table bt__table">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Reading</th>
                    <th scope="col">Plan</th>
                    <th scope="col">Checks</th>
                    <th scope="col">Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {journal.entries.flatMap((e) =>
                    e.plans.map((p) => (
                      <tr key={`${e.id}${p.horizon}`} className={result && result.id === e.id ? "is-picked" : ""}>
                        <td>
                          <button type="button" className="bt__pick" onClick={() => setResult(e)}>
                            {when(e.at)}
                          </button>
                        </td>
                        <td>
                          {e.stance} · {e.confidence}
                        </td>
                        <td>{p.action === "no_trade" ? `${p.horizon}: no trade` : `${p.horizon}: ${p.side} ${num(p.entry)} · stop ${num(p.stop)} · target ${num(p.target)}`}</td>
                        <td className={p.checkStatus === "rejected" ? "is-down" : ""}>{p.checkStatus === "no-trade" ? "—" : p.checkStatus}</td>
                        <td className={p.outcome && isNum(p.outcome.r) ? (p.outcome.r > 0 ? "is-up" : p.outcome.r < 0 ? "is-down" : "") : ""}>
                          {p.action === "no_trade" || p.checkStatus === "rejected" ? "—" : p.outcome ? `${OUTCOME[p.outcome.status] || p.outcome.status}${isNum(p.outcome.r) ? ` ${rText(p.outcome.r)}` : ""}` : "not scored yet"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="an-card">
        <details className="ai-skills" onToggle={(e) => e.currentTarget.open && openSkills(false)}>
          <summary>
            <b>Trading-skills file</b> — the rules the strategist follows, and {status.lessons} lesson{status.lessons === 1 ? "" : "s"} it has drawn from scored plans
          </summary>
          <p className="vd-note">
            This file is sent with every strategy request, so what is written here shapes every answer. Edit the rules to match how you trade. Lessons are
            added only by “Score outcomes &amp; learn”.
          </p>
          {skills === null ? (
            <Loading />
          ) : (
            <>
              <label className="adm-sr" htmlFor="ai-skills">
                Trading-skills file
              </label>
              <textarea id="ai-skills" className="ai-skills__text" value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck="false" rows={22} />
              <Alert kind={skillMsg.kind === "ok" ? "ok" : "error"}>{skillMsg.text}</Alert>
              <div className="adm-actions">
                <button type="button" className="adm-btn adm-btn--solid adm-btn--sm" onClick={() => saveSkills(false)} disabled={draft === skills}>
                  Save
                </button>
                <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setDraft(skills)} disabled={draft === skills}>
                  Undo changes
                </button>
                <button type="button" className="adm-btn adm-btn--danger adm-btn--sm" onClick={() => saveSkills(true)}>
                  Reset to the starting rules
                </button>
                <span className="adm-small">{num(draft.length, 0)} / 24,000 characters</span>
              </div>
            </>
          )}
        </details>
      </section>
    </>
  );
}
