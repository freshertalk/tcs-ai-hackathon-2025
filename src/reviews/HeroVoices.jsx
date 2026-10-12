// src/reviews/HeroVoices.jsx
// Readers' words, at the top of the page.
//
// A card in the hero: the score on one side, one reader's words on the other,
// turning to the next every few seconds (and stopping when someone is reading
// it, or hovering, or has asked their system for less motion). Nothing here is
// invented: with no ratings yet it says so and invites the first one.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { StarRow } from "./Stars";
import { useSummary } from "./Reviews";
import { fmtDate } from "../reader/util";

const initials = (n) => String(n || "प").trim().slice(0, 1).toUpperCase();

export default function HeroVoices({ slug }) {
  const s = useSummary(slug);
  const items = useMemo(() => s.comments.slice(0, 6), [s.comments]);
  const [i, setI] = useState(0);
  const [pause, setPause] = useState(false);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    if (pause || reduced.current || items.length < 2) return undefined;
    const t = setInterval(() => setI((n) => (n + 1) % items.length), 6500);
    return () => clearInterval(t);
  }, [pause, items.length]);

  useEffect(() => {
    if (i >= items.length) setI(0);
  }, [items.length, i]);

  if (!s.loaded) return <div className="hv hv--wait" aria-hidden="true" />;

  const c = items[i];
  const top = Math.max(1, ...s.distribution);

  return (
    <aside
      className="hv"
      aria-label="पाठकों की राय"
      onMouseEnter={() => setPause(true)}
      onMouseLeave={() => setPause(false)}
      onFocus={() => setPause(true)}
      onBlur={() => setPause(false)}
    >
      <div className="hv__score">
        {s.count > 0 ? (
          <>
            <span className="hv__n">{s.average.toFixed(1)}</span>
            <StarRow value={s.average} size={17} />
            <span className="hv__c">{s.count} पाठकों की रेटिंग</span>
            <ul className="hv__dist" aria-hidden="true">
              {[5, 4, 3, 2, 1].map((n) => (
                <li key={n}>
                  <i style={{ width: `${(s.distribution[n - 1] / top) * 100}%` }} />
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <span className="hv__n hv__n--none">★</span>
            <span className="hv__c">अभी कोई रेटिंग नहीं</span>
          </>
        )}
      </div>

      <div className="hv__voice" aria-live="polite">
        {c ? (
          <figure key={`${c.at}-${i}`} className="hv__fig">
            <blockquote className="hi" lang="hi">
              {c.comment}
            </blockquote>
            <figcaption>
              {c.picture ? (
                <img src={c.picture} alt="" width="30" height="30" loading="lazy" referrerPolicy="no-referrer" />
              ) : (
                <span className="hv__ini" aria-hidden="true">
                  {initials(c.name)}
                </span>
              )}
              <b className="hi-d">{c.name || "एक पाठक"}</b>
              <StarRow value={c.rating} size={13} />
              {c.at ? <time dateTime={c.at}>{fmtDate(c.at.slice(0, 10))}</time> : null}
            </figcaption>
          </figure>
        ) : (
          <div className="hv__fig hv__fig--none">
            <p className="hi">
              {s.count > 0
                ? "पाठकों ने रेटिंग दी है — पढ़कर आप भी अपने शब्द जोड़ सकते हैं।"
                : "पहली राय आपकी हो सकती है — किताब पढ़कर दो पंक्तियाँ लिखिए।"}
            </p>
          </div>
        )}

        <div className="hv__foot">
          {items.length > 1 && (
            <div className="hv__dots" role="tablist" aria-label="कौन-सी राय">
              {items.map((_, n) => (
                <button key={n} type="button" role="tab" aria-selected={n === i} aria-label={`राय ${n + 1}`} className={n === i ? "is-on" : ""} onClick={() => setI(n)} />
              ))}
            </div>
          )}
          <a className="hv__more" href="#reviews">
            {s.count > 0 ? "सभी राय पढ़िए" : "राय दीजिए"} →
          </a>
        </div>
      </div>
    </aside>
  );
}
