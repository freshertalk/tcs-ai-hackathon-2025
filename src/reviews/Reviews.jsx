// src/reviews/Reviews.jsx
// "पाठकों की राय" — what readers have said, and a place to say it.
//
// No sign-in. A reader presses stars, may add a name and a few words, and
// sends. Nothing on this page is made up: until readers have rated the book,
// it says so.

import React, { useEffect, useState } from "react";
import { REVIEWS, AUTHOR } from "../data/books";
import { fmtDate } from "../reader/util";
import { StarRow, StarInput } from "./Stars";
import { getMine, loadGoogleBooks, loadSummary, peekSummary, submitReview, subscribe } from "./api";

/* ------------------------------------------------------------------ hooks */
export function useSummary(slug) {
  const [s, setS] = useState(() => peekSummary(slug));
  useEffect(() => {
    let live = true;
    loadSummary(slug).then((d) => live && setS(d));
    const off = subscribe(slug, (d) => live && setS(d));
    return () => {
      live = false;
      off();
    };
  }, [slug]);
  return s;
}

function useGoogleRating() {
  const [g, setG] = useState(null);
  useEffect(() => {
    let live = true;
    loadGoogleBooks(REVIEWS.googleBooksId).then((d) => live && setG(d));
    return () => {
      live = false;
    };
  }, []);
  return g;
}

/* ------------------------------------------------------------------ chip */
/** A one-line "★ 4.6 · 23 राय" — and nothing at all until there are ratings. */
export function RatingChip({ slug, className = "" }) {
  const s = useSummary(slug);
  if (!s.count) return null;
  return (
    <a className={`rv-chip ${className}`} href="#reviews">
      <StarRow value={s.average} size={16} />
      <b>{s.average.toFixed(1)}</b>
      <span>({s.count} राय)</span>
    </a>
  );
}

/* ------------------------------------------------------------------ form */
function ReviewForm({ book, compact = false }) {
  const mine = getMine(book.slug);
  const [rating, setRating] = useState(mine ? mine.rating : 0);
  const [name, setName] = useState(mine ? mine.name : "");
  const [comment, setComment] = useState(mine ? mine.comment : "");
  const [hp, setHp] = useState(""); // a field only a robot fills
  const [state, setState] = useState("idle"); // idle | sending | done | error
  const [result, setResult] = useState(null);

  const send = async (e) => {
    e.preventDefault();
    if (!rating || state === "sending") return;
    setState("sending");
    try {
      const r = await submitReview({ slug: book.slug, rating, name, comment, hp });
      setResult(r);
      setState("done");
    } catch {
      setState("error");
    }
  };

  if (state === "done") {
    const mail = `mailto:${AUTHOR.connect.email}?subject=${encodeURIComponent(
      `${book.title} — मेरी राय`
    )}&body=${encodeURIComponent(
      `${book.title}\nरेटिंग: ${rating}/5\n${name ? `नाम: ${name}\n` : ""}${comment ? `\n${comment}\n` : ""}`
    )}`;
    return (
      <div className="rv-form rv-done" role="status">
        <StarRow value={rating} size={26} />
        <p className="rv-done__t hi-d">धन्यवाद! आपकी राय दर्ज हो गई।</p>
        {result && result.shared ? (
          result.pending ? (
            <p className="rv-note">आपकी टिप्पणी लेखक की जाँच के बाद यहाँ दिखेगी। रेटिंग गिन ली गई है।</p>
          ) : null
        ) : (
          <p className="rv-note">
            अभी यह राय इसी डिवाइस पर सहेजी गई है। चाहें तो इसे सीधे लेखक को भेज दीजिए —{" "}
            <a href={mail}>ई-मेल से भेजें</a>।
          </p>
        )}
        <button type="button" className="rv-link" onClick={() => setState("idle")}>
          राय बदलिए
        </button>
      </div>
    );
  }

  return (
    <form className={`rv-form ${compact ? "rv-form--compact" : ""}`} onSubmit={send} noValidate>
      <p className="rv-form__q hi-d">{mine ? "आपकी राय" : "आपको यह किताब कैसी लगी?"}</p>
      <StarInput value={rating} onChange={setRating} size={compact ? 34 : 40} disabled={state === "sending"} />

      <label className="rv-label" htmlFor={`rv-name-${compact ? "c" : "p"}`}>
        आपका नाम <span>(चाहें तो)</span>
      </label>
      <input
        id={`rv-name-${compact ? "c" : "p"}`}
        className="rv-input"
        type="text"
        maxLength={40}
        autoComplete="off"
        lang="hi"
        placeholder="जैसे — अनुराग"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <label className="rv-label" htmlFor={`rv-text-${compact ? "c" : "p"}`}>
        आपकी टिप्पणी <span>(चाहें तो)</span>
      </label>
      <textarea
        id={`rv-text-${compact ? "c" : "p"}`}
        className="rv-input rv-input--area"
        rows={compact ? 3 : 4}
        maxLength={600}
        lang="hi"
        placeholder="किताब पढ़कर आपको क्या लगा?"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />

      {/* never shown to a person */}
      <input
        className="rv-hp"
        type="text"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        value={hp}
        onChange={(e) => setHp(e.target.value)}
      />

      <div className="rv-actions">
        <button type="submit" className="rv-send" disabled={!rating || state === "sending"}>
          {state === "sending" ? "भेज रहे हैं…" : mine ? "राय बदलिए" : "राय भेजिए"}
        </button>
        <span className="rv-fine">कोई लॉग-इन नहीं · {comment.length}/600</span>
      </div>
      {state === "error" && (
        <p className="rv-error" role="alert">
          राय अभी जा नहीं पाई। थोड़ी देर बाद फिर कोशिश कीजिए।
        </p>
      )}
    </form>
  );
}

/* ----------------------------------------------------------- the section */
export function ReviewsSection({ book, variant = "page" }) {
  const s = useSummary(book.slug);
  const g = useGoogleRating();
  const places = (REVIEWS.places || []).filter((p) => p.url);
  const top = Math.max(1, ...s.distribution);

  if (variant === "reader") {
    return (
      <div className="rv rv--reader">
        {s.count > 0 && (
          <p className="rv-line">
            <StarRow value={s.average} size={16} /> <b>{s.average.toFixed(1)}</b> · {s.count} पाठकों की राय
          </p>
        )}
        <ReviewForm book={book} compact />
      </div>
    );
  }

  return (
    <div className="rv">
      <div className="rv__grid">
        {/* the tally */}
        <div className="rv-sum">
          {s.count > 0 ? (
            <>
              <div className="rv-sum__big">
                <span className="rv-sum__n">{s.average.toFixed(1)}</span>
                <span className="rv-sum__of">/ 5</span>
              </div>
              <StarRow value={s.average} size={24} />
              <p className="rv-sum__c">{s.count} पाठकों की रेटिंग</p>
              <ul className="rv-dist" aria-label="रेटिंग का बँटवारा">
                {[5, 4, 3, 2, 1].map((n) => (
                  <li key={n}>
                    <span>{n} ★</span>
                    <i>
                      <b style={{ width: `${(s.distribution[n - 1] / top) * 100}%` }} />
                    </i>
                    <span>{s.distribution[n - 1]}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="rv-empty hi">
              {s.configured && !s.failed
                ? "अभी किसी ने रेटिंग नहीं दी है — पहली राय आपकी हो सकती है।"
                : "यहाँ पाठकों की रेटिंग और टिप्पणियाँ दिखेंगी। आप अपनी राय दे सकते हैं।"}
            </p>
          )}

          {g && (
            <p className="rv-ext">
              Google Books पर: <b>{g.average.toFixed(1)} ★</b> ({g.count} रेटिंग)
              {g.link ? (
                <>
                  {" "}
                  · <a href={g.link} target="_blank" rel="noopener noreferrer">देखिए</a>
                </>
              ) : null}
            </p>
          )}
        </div>

        {/* the form */}
        <ReviewForm book={book} />
      </div>

      {/* what readers wrote */}
      {s.comments.length > 0 && (
        <ul className="rv-list">
          {s.comments.map((c, i) => (
            <li key={`${c.at}-${i}`} className="rv-item">
              <div className="rv-item__top">
                <StarRow value={c.rating} size={15} />
                <b className="hi-d">{c.name || "एक पाठक"}</b>
                {c.at && <time dateTime={c.at}>{fmtDate(c.at.slice(0, 10))}</time>}
              </div>
              <p className="rv-item__t hi" lang="hi">
                {c.comment}
              </p>
            </li>
          ))}
        </ul>
      )}

      {places.length > 0 && (
        <p className="rv-places">
          और भी जगह राय दे सकते हैं:{" "}
          {places.map((p, i) => (
            <React.Fragment key={p.name}>
              {i > 0 && " · "}
              <a href={p.url} target="_blank" rel="noopener noreferrer">
                {p.name}
              </a>
            </React.Fragment>
          ))}
        </p>
      )}
    </div>
  );
}
