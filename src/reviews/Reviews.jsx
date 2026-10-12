// src/reviews/Reviews.jsx
// "पाठकों की राय" — what readers have said, and a place to say it.
//
// A reader presses stars, may add a few words, and sends. When Google sign-in
// is configured (AUTH.googleClientId + the collector's CLIENT_ID) they sign in
// with Google first: one rating per account, their name and picture beside a
// comment, and the right to change or take back their own. Without it the page
// stays anonymous, as before.
//
// The admin account sees a moderation list under the comments. That is only a
// view: every action is checked again by the collector.
//
// Nothing on this page is made up: until readers have rated the book, it says
// so.

import React, { useEffect, useState } from "react";
import { AUTH, REVIEWS, AUTHOR } from "../data/books";
import { fmtDate } from "../reader/util";
import { useAuth } from "../auth/google";
import { openSignIn } from "../auth/SignInDialog";
import { IconSignIn } from "../components/ui/icons";
import { StarRow, StarInput } from "./Stars";
import {
  adminApprove,
  adminList,
  adminRemove,
  getMine,
  loadGoogleBooks,
  loadSummary,
  peekSummary,
  submitReview,
  subscribe,
} from "./api";

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
/**
 * The rating, as a small plate of its own: the score, five gold stars and how
 * many readers gave it — and nothing at all until there are ratings.
 */
export function RatingChip({ slug, className = "", compact = false }) {
  const s = useSummary(slug);
  if (!s.count) return null;
  if (compact) {
    // one quiet line: the stars, the score, how many readers
    return (
      <a
        className={`rvp rvp--sm ${className}`}
        href="#reviews"
        aria-label={`पाँच में ${s.average.toFixed(1)} — ${s.count} पाठकों की राय`}
      >
        <StarRow value={s.average} size={15} />
        <b>{s.average.toFixed(1)}</b>
        <span>
          {s.count} पाठकों की राय <i aria-hidden="true">→</i>
        </span>
      </a>
    );
  }
  return (
    <a
      className={`rvp ${className}`}
      href="#reviews"
      aria-label={`पाँच में ${s.average.toFixed(1)} — ${s.count} पाठकों की राय`}
    >
      <span className="rvp__score">{s.average.toFixed(1)}</span>
      <span className="rvp__body">
        <span className="rvp__stars">
          <StarRow value={s.average} size={22} />
        </span>
        <span className="rvp__sub">
          {s.count} पाठकों की राय <i aria-hidden="true">→</i>
        </span>
      </span>
    </a>
  );
}

/* --------------------------------------------------------------- sign-in */
function SignIn({ why }) {
  return (
    <div className="rv-signin">
      <p className="rv-form__q hi-d">{why || "राय देने के लिए Google से साइन इन कीजिए"}</p>
      <button type="button" className="acct__go" onClick={() => openSignIn("rate")}>
        <IconSignIn size={18} />
        <span>साइन इन</span>
      </button>
      <p className="rv-fine">
        टिप्पणी के साथ आपका नाम और फ़ोटो दिखेगा। आपका ई-मेल कभी नहीं दिखता।
      </p>
    </div>
  );
}

function Who({ user, onOut }) {
  return (
    <div className="rv-who">
      {user.picture ? (
        <img src={user.picture} alt="" width="34" height="34" referrerPolicy="no-referrer" />
      ) : (
        <span className="rv-who__i" aria-hidden="true">
          {String(user.name || "?").slice(0, 1)}
        </span>
      )}
      <span className="rv-who__n">
        {user.name}
        {user.admin ? <em> · एडमिन</em> : null}
      </span>
      <button type="button" className="rv-link" onClick={onOut}>
        साइन-आउट
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ form */
function ReviewForm({ book, compact = false }) {
  const { user, configured, signOut } = useAuth();
  const summary = useSummary(book.slug);
  const mine = getMine(book.slug);

  const [rating, setRating] = useState(mine ? mine.rating : 0);
  const [name, setName] = useState(mine ? mine.name : "");
  const [comment, setComment] = useState(mine ? mine.comment : "");
  const [hp, setHp] = useState(""); // a field only a robot fills
  const [state, setState] = useState("idle"); // idle | sending | done | error | reauth
  const [result, setResult] = useState(null);

  // their Google name is the starting point; they may write another
  useEffect(() => {
    if (user && !name) setName(user.name || "");
    // only when the person arrives, not on every keystroke
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user && user.email]);

  const gate = configured && summary.signIn;
  const needSignIn = gate && (!user || state === "reauth");

  const send = async (e) => {
    e.preventDefault();
    if (!rating || state === "sending") return;
    setState("sending");
    try {
      const r = await submitReview({ slug: book.slug, rating, name, comment, hp });
      setResult(r);
      setState("done");
    } catch (err) {
      setState(err && err.message === "signin" ? "reauth" : "error");
    }
  };

  if (needSignIn) {
    return (
      <div className={`rv-form ${compact ? "rv-form--compact" : ""}`}>
        <SignIn why={state === "reauth" ? "साइन-इन की अवधि पूरी हो गई — फिर साइन इन कीजिए" : undefined} />
      </div>
    );
  }

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
      {gate && user && <Who user={user} onOut={signOut} />}

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
        <span className="rv-fine">
          {gate ? "Google खाते से" : "कोई लॉग-इन नहीं"} · {comment.length}/600
        </span>
      </div>
      {state === "error" && (
        <p className="rv-error" role="alert">
          राय अभी जा नहीं पाई। थोड़ी देर बाद फिर कोशिश कीजिए।
        </p>
      )}
    </form>
  );
}

/* ----------------------------------------------------------------- admin */
export function AdminPanel({ slug }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");

  const explain = (e) =>
    e && e.message === "signin"
      ? "साइन-इन की अवधि पूरी हो गई — पेज ताज़ा करके फिर साइन इन कीजिए।"
      : e && e.message === "forbidden"
      ? "यह खाता एडमिन नहीं है।"
      : "सूची अभी नहीं खुल पाई।";

  const load = () =>
    adminList(slug)
      .then((r) => {
        setErr("");
        setRows(r);
      })
      .catch((e) => setErr(explain(e)));

  useEffect(() => {
    load();
    // once per book
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const run = async (key, fn) => {
    setBusy(key);
    try {
      await fn();
      await load();
      loadSummary(slug, { fresh: true });
    } catch (e) {
      setErr(explain(e));
    }
    setBusy("");
  };

  const pending = (rows || []).filter((r) => r.comment && !r.approved).length;

  return (
    <section className="rv-admin" aria-label="एडमिन — टिप्पणियाँ">
      <h3 className="rv-admin__t hi-d">
        एडमिन · सभी राय {rows ? `(${rows.length})` : ""}
        {pending ? <b className="rv-admin__n">{pending} जाँच के लिए</b> : null}
      </h3>
      {err && <p className="rv-error">{err}</p>}
      {rows && rows.length === 0 && <p className="rv-note">अभी कोई राय नहीं आई।</p>}
      <ul className="rv-admin__list">
        {(rows || []).map((r) => (
          <li key={r.key} className={`rv-admin__row ${r.comment && !r.approved ? "is-pending" : ""}`}>
            <div className="rv-admin__top">
              <StarRow value={r.rating} size={15} />
              <b>{r.name || "—"}</b>
              <span className="rv-admin__mail">{r.email || "बिना साइन-इन"}</span>
              <time dateTime={r.at}>{fmtDate(r.at.slice(0, 10))}</time>
            </div>
            {r.comment ? (
              <p className="rv-admin__txt hi" lang="hi">
                {r.comment}
              </p>
            ) : (
              <p className="rv-fine">केवल रेटिंग</p>
            )}
            <div className="rv-admin__act">
              {r.comment && (
                <button
                  type="button"
                  className="rv-mini rv-mini--ok"
                  disabled={busy === r.key}
                  onClick={() => run(r.key, () => adminApprove(slug, r.key, !r.approved))}
                >
                  {r.approved ? "छिपाइए" : "दिखाइए"}
                </button>
              )}
              <button
                type="button"
                className="rv-mini rv-mini--del"
                disabled={busy === r.key}
                onClick={() => {
                  if (window.confirm("यह राय हमेशा के लिए हटाएँ?")) run(r.key, () => adminRemove(slug, r.key));
                }}
              >
                हटाइए
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ----------------------------------------------------------- the section */
export function ReviewsSection({ book, variant = "page" }) {
  const s = useSummary(book.slug);
  const g = useGoogleRating();
  const { user } = useAuth();
  const places = (REVIEWS.places || []).filter((p) => p.url);
  const top = Math.max(1, ...s.distribution);
  const admin = Boolean(user && user.admin && AUTH.googleClientId && REVIEWS.endpoint);

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
                {c.picture ? (
                  <img
                    className="rv-item__pic"
                    src={c.picture}
                    alt=""
                    width="28"
                    height="28"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                ) : null}
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

      {admin && <AdminPanel slug={book.slug} />}
    </div>
  );
}
