// What the knowledge base says about one stock now (server/market/situation.js): the rules of the trade
// read against the stock's readings — which agree with the call, which argue against it, which ask for
// care, and the context — each with the topic it comes from. Shown wherever the desk advises or selects
// a stock: the live scanner, the Top 10, the Advisor, the AI decision and the AI strategist.
//
// `k` is the checks' short form ({ vote, cautions, notes: [{ id, topic, title, stance, side, text }] });
// `side` ("long" | "short", optional) turns "supports a short" into "argues against" a long, and so on.

import React from "react";
import "./knowledge.css";

const OPP = { long: "short", short: "long" };

/** The notes sorted for one side (or for none: by their own stance). */
export function groupChecks(notes, side) {
  const g = { agree: [], against: [], care: [], info: [] };
  for (const n of notes || []) {
    if (n.stance === "caution") g.care.push(n);
    else if (n.stance === "info" || n.side === "both") g.info.push(n);
    else if (!side) (n.stance === "for" ? g.agree : g.against).push(n);
    else if ((n.stance === "for" && n.side === side) || (n.stance === "against" && n.side === OPP[side])) g.agree.push(n);
    else g.against.push(n);
  }
  return g;
}

const LABEL = { agree: "Agrees", against: "Argues against", care: "Asks for care", info: "Context" };

function sideWord(n, side) {
  if (side || n.side === "both" || n.stance === "caution" || n.stance === "info") return null;
  return n.stance === "for" ? `for a ${n.side}` : `against a ${n.side}`;
}

export function KnowledgeChecks({ k, side = null, title = "What the knowledge base says", compact = false }) {
  if (!k || !Array.isArray(k.notes) || !k.notes.length) return null;
  const g = groupChecks(k.notes, side);
  const order = ["against", "agree", "care", "info"].filter((x) => g[x].length);
  return (
    <section className={`kq ${compact ? "kq--compact" : ""}`} aria-label={title}>
      <h4 className="kq-title">
        {title}
        {side && (
          <small>
            {" "}
            — for the {side}: {g.agree.length} agree{g.agree.length === 1 ? "s" : ""}, {g.against.length} against{g.care.length ? `, ${g.care.length} ask${g.care.length === 1 ? "s" : ""} for care` : ""}
          </small>
        )}
      </h4>
      {order.map((grp) => (
        <div key={grp} className={`kq-group kq-group--${grp}`}>
          <b className="kq-label">{LABEL[grp]}</b>
          <ul>
            {g[grp].map((n) => {
              // a card shows each rule's headline (the full rule on hover and in the stock's detail)
              const head = compact ? n.text.split(": ")[0] : n.text;
              return (
                <li key={`${n.id}-${n.side}`} data-tip={compact && head !== n.text ? `${n.text} (${n.title})` : undefined}>
                  {sideWord(n, side) && <span className="kq-side">{sideWord(n, side)} · </span>}
                  {head} {!compact && <small className="kq-from">{n.title}</small>}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {!compact && <p className="kq-foot">Rules of the trade from the desk&rsquo;s knowledge base, read against these numbers. Where the desk&rsquo;s own measured records disagree, the measurement wins — a rule is evidence, not a promise.</p>}
    </section>
  );
}

export default KnowledgeChecks;
