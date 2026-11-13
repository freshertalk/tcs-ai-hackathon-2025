// The market around the stock, always in view: Nifty, Bank Nifty and India VIX
// streaming live; GIFT Nifty, the rupee, crude and gold from Zerodha; the Nifty's
// "tide"; and — on request — a world-markets brief gathered by web search.

import React, { useEffect, useState } from "react";
import { api } from "../../api";
import { adminPath } from "../../paths";
import { Alert, Loading } from "../../ui";
import { useAiStatus } from "../../aiStatus";
import { useTick } from "./liveTicks";
import { clock, isNum, num, pct, when } from "./format";

const MOOD = { risk_on: "Risk-on", risk_off: "Risk-off", mixed: "Mixed" };
const MOOD_TONE = { risk_on: "up", risk_off: "down", mixed: "flat" };
const tone = (x) => (!isNum(x) || x === 0 ? "flat" : x > 0 ? "up" : "down");
const safeUrl = (u) => (typeof u === "string" && /^https?:\/\//i.test(u) ? u : null);

function Chip({ it }) {
  // the three NSE indices move tick by tick; the rest refresh with the context
  const tick = useTick(it.symbol || null);
  const last = tick && isNum(tick.last) ? tick.last : it.last;
  const chg = tick && isNum(tick.changePct) ? tick.changePct : it.changePct;
  return (
    <li className={`mk__chip is-${tone(chg)}`} title={it.note || undefined}>
      <span>{it.name}</span>
      <b>{num(last)}</b>
      <em>{pct(chg)}</em>
    </li>
  );
}

/** The world brief: read the stored one for free, or make a new one (a web search and tokens). */
function WorldBrief() {
  const [s0, setS] = useState({ loading: true });
  const aiNow = useAiStatus();
  const s = aiNow && !s0.loading ? { ...s0, configured: aiNow.configured } : s0;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    api("/api/admin/ai/world")
      .then((d) => alive && setS({ loading: false, ...d }))
      .catch((e) => alive && setS({ loading: false, failed: e.message }));
    return () => {
      alive = false;
    };
  }, []);

  const build = (refresh) => {
    setBusy(true);
    setError("");
    api("/api/admin/ai/world", { method: "POST", body: { refresh } })
      .then((d) => setS({ loading: false, ...d }))
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };

  if (s.loading) return <Loading label="Loading the world brief…" />;
  if (s.failed) return <Alert>{s.failed}</Alert>;
  const b = s.brief;

  return (
    <div className="mk__world">
      <div className="mk__worldtop">
        <h4>World brief · overseas markets</h4>
        {s.configured ? (
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => build(Boolean(b))} disabled={busy}>
            {busy ? "Searching… about a minute" : b ? "Refresh (new web search)" : "Get the world brief"}
          </button>
        ) : (
          <a className="adm-btn adm-btn--ghost adm-btn--sm" href={adminPath("/ai")}>
            Set up the AI key
          </a>
        )}
      </div>
      <Alert>{error}</Alert>
      {!b && (
        <p className="vd-note">
          {s.configured
            ? "US, Asian and European markets, crude, the dollar, bond yields, FII/DII flows and today’s events — gathered by the AI with a web search, only when you press the button."
            : "Zerodha does not carry overseas markets. With an Anthropic, OpenAI or Gemini API key, the AI can gather them by web search on request. Everything else here works without it."}
        </p>
      )}
      {b && (
        <>
          <p className={`vd-stance vd-stance--${b.mood === "risk_on" ? "bullish" : b.mood === "risk_off" ? "bearish" : "neutral"}`}>
            <b>{MOOD[b.mood] || "Mixed"}</b>
            <span>
              gathered {when(b.at)}
              {s.fresh ? "" : " — this is an old brief, not today’s"}
            </span>
          </p>
          <p className="vd-headline">{b.headline}</p>
          <p className="vd-note">{b.indiaRead}</p>
          {b.cues.length > 0 && (
            <div className="bt__scroll">
              <table className="an-table mk__cues">
                <thead>
                  <tr>
                    <th scope="col">Cue</th>
                    <th scope="col">Level</th>
                    <th scope="col">Change</th>
                    <th scope="col">As of</th>
                    <th scope="col">For Indian stocks</th>
                  </tr>
                </thead>
                <tbody>
                  {b.cues.map((c) => (
                    <tr key={c.name}>
                      <th scope="row">{c.name}</th>
                      <td>{c.value}</td>
                      <td>{c.change || "—"}</td>
                      <td>{c.asOf}</td>
                      <td className={c.read === "positive" ? "is-up" : c.read === "negative" ? "is-down" : ""}>{c.read}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {b.sectors.length > 0 && (
            <ul className="ai-list">
              {b.sectors.map((x) => (
                <li key={x.sector}>
                  <b>
                    {x.sector} — {x.bias}:
                  </b>{" "}
                  {x.why}
                </li>
              ))}
            </ul>
          )}
          {b.events.length > 0 && (
            <>
              <h4>Today’s events</h4>
              <ul className="ai-list">
                {b.events.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </>
          )}
          {b.caveats.length > 0 && (
            <ul className="ai-list ai-list--risk">
              {b.caveats.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          )}
          <p className="adm-small">
            Gathered by a language model from a web search ({b.usage.searches} searches, {num(b.usage.inputTokens, 0)} tokens in, {num(b.usage.outputTokens, 0)} out). Figures can be stale
            or wrong — check the sources. It is shown as background and never changes a trigger or a score.
          </p>
          {b.sources.length > 0 && (
            <ul className="mk__sources">
              {b.sources.map((x) =>
                safeUrl(x.url) ? (
                  <li key={x.url}>
                    <a href={x.url} target="_blank" rel="noopener noreferrer">
                      {x.title}
                    </a>
                  </li>
                ) : null
              )}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

export default function MarketStrip({ status }) {
  const [ctx, setCtx] = useState(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    const pull = () =>
      api("/api/admin/market/context")
        .then((d) => {
          if (!alive) return;
          setCtx(d);
          setError("");
        })
        .catch((e) => alive && setError(e.message));
    pull();
    const id = setInterval(pull, status.marketHours ? 10000 : 60000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [status.marketHours]);

  if (!ctx) return error ? <p className="adm-small mk__err">Market context: {error}</p> : null;
  if (!ctx.available) return <p className="adm-small mk__err">Market context: {ctx.reason}</p>;

  const t = ctx.tide;
  const shown = ctx.items.filter((x) => x.available);
  return (
    <section className="mk" aria-label="Market context">
      <div className="mk__row">
        <p className={`mk__tide is-${t.score >= 30 ? "up" : t.score <= -30 ? "down" : "flat"}`} title={t.summary}>
          <small>{t.live ? "Market tide" : "Tide at the close"}</small>
          <b>
            {t.label} {t.score > 0 ? `+${t.score}` : t.score}
          </b>
        </p>
        <ul className="mk__chips">
          {shown.map((it) => (
            <Chip key={it.id} it={it} />
          ))}
        </ul>
        {ctx.world && (
          <p className={`mk__tide mk__tide--world is-${MOOD_TONE[ctx.world.mood] || "flat"}`} title={ctx.world.headline}>
            <small>World · {ctx.world.time}</small>
            <b>{MOOD[ctx.world.mood] || "Mixed"}</b>
          </p>
        )}
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Hide" : "Market & world"}
        </button>
      </div>
      {(ctx.stale || error) && <p className="adm-small mk__err">Could not refresh the market context just now — showing the reading from {clock(ctx.at)}.</p>}

      {open && (
        <div className="mk__panel">
          <div>
            <h4>The tide — which way the Indian market is moving</h4>
            <p className="vd-note">{t.summary} A long gets a few points when the tide is rising and loses them when it is falling; a short the other way round.</p>
            <ul className="vd-factors">
              {t.factors.map((f) => (
                <li key={f.name}>
                  <span>
                    <b>{f.name}</b>
                    <small>{f.reading}</small>
                  </span>
                  <em className={`is-${tone(f.pts)}`}>
                    {f.pts > 0 ? `+${f.pts}` : f.pts}
                    <small> / {f.max}</small>
                  </em>
                </li>
              ))}
            </ul>
            {ctx.vix && (
              <p className="vd-note">
                India VIX {num(ctx.vix.last)} ({pct(ctx.vix.changePct)}) — {ctx.vix.level}. A rising VIX means wider swings.
              </p>
            )}
          </div>
          <div>
            <h4>
              Sectors today · {ctx.breadth.up} up, {ctx.breadth.down} down
            </h4>
            <ul className="mk__sectors">
              {ctx.sectors.map((x) => (
                <li key={x.name}>
                  <span>{x.name}</span>
                  <span className="mk__bar">
                    <i className={`is-${tone(x.changePct)}`} style={{ width: `${Math.min(50, Math.abs(x.changePct) * 20)}%`, [x.changePct >= 0 ? "left" : "right"]: "50%" }} />
                  </span>
                  <b className={`is-${tone(x.changePct)}`}>{pct(x.changePct)}</b>
                </li>
              ))}
            </ul>
            {ctx.notes.length > 0 && (
              <ul className="ai-list">
                {ctx.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
            <p className="vd-note">
              {shown.filter((x) => x.group === "world").length
                ? "GIFT Nifty, USD/INR, crude and gold are the overseas-linked instruments Zerodha carries. Hover a chip for what it is."
                : "Zerodha returned no GIFT Nifty, currency or commodity quotes for this account."}
            </p>
          </div>
          <WorldBrief />
        </div>
      )}
    </section>
  );
}
