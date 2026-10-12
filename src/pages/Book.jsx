// src/pages/Book.jsx
// One book: its cover, what it is, where you are in it, and a way in.

import React, { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import Nav from "../components/site/Nav";
import Footer from "../components/site/Footer";
import Seo from "../components/seo/Seo";
import { Reveal, MaskLine } from "../components/ui/motion";
import { percentRead } from "../library/BookCard";
import BookShowcase from "../library/BookShowcase";
import { useBook, useProgress } from "../library/hooks";
import { fmtDate, fmtMinutes } from "../reader/util";
import { IconCheck, IconEye, IconShare } from "../reader/icons";
import { SITE_LINKS } from "./Library";

const LANGS = { hi: "हिन्दी", en: "English", bho: "भोजपुरी", ur: "اردو" };

const GROUPS = [
  { kind: "front", label: "प्रारंभ" },
  { kind: "chapter", label: "अध्याय" },
  { kind: "back", label: "अंत" },
];

function ShareButton({ book }) {
  const [copied, setCopied] = useState(false);

  const share = useCallback(async () => {
    const url = `${window.location.origin}/books/${book.slug}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: book.title, text: `${book.title} — ${book.author}`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      /* the share sheet was dismissed — nothing to do */
    }
  }, [book]);

  return (
    <button type="button" className="btn" onClick={share}>
      <IconShare width={18} height={18} />
      {copied ? "लिंक कॉपी हो गया" : "साझा करें"}
    </button>
  );
}

function Missing() {
  return (
    <main className="lib">
      <div className="shell lib__head">
        <h1 className="h-display h-hi title-md">यह किताब नहीं मिली।</h1>
        <p className="lib__note hi">पता ग़लत हो सकता है, या किताब हटा दी गई है।</p>
        <Link className="btn btn--solid" to="/library" style={{ marginTop: 26 }}>
          किताबघर देखिए
        </Link>
      </div>
    </main>
  );
}

export default function BookPage() {
  const { slug } = useParams();
  const { data: book, error } = useBook(slug);
  const progress = useProgress(slug);

  useEffect(() => {
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", "#faf4e9");
  }, []);

  const pct = percentRead(progress);
  const resumeChapter =
    book && progress ? book.chapters.find((c) => c.id === progress.chapter) : null;
  const firstChapter = book ? book.chapters[0] : null;
  const done = (progress && progress.done) || {};

  return (
    <div data-theme="write">
      {book && <Seo page="book" book={book} />}
      <Nav
        links={SITE_LINKS}
        tone="light"
        kicker="किताबघर"
        cta={{ href: `/read/${slug}`, label: pct > 0 ? "पढ़ना जारी रखें" : "पढ़ें" }}
      />

      {error && <Missing />}

      {!error && !book && (
        <main className="lib">
          <p className="shell lib__state">किताब खुल रही है…</p>
        </main>
      )}

      {book && (
        <main className="bk">
          {/* ----------------------------------------------------- hero */}
          <div className="bk__heroWrap">
          <section className="shell bk__hero">
            <Reveal className="bk__cover" y={26}>
              <BookShowcase book={book} eager sizes="(max-width: 760px) 80vw, 380px" />
            </Reveal>

            <div className="bk__info">
              <Reveal>
                <span className="eyebrow is-hi">
                  {LANGS[book.language] || book.language} · {book.subjects[0] || "पुस्तक"}
                </span>
              </Reveal>

              <h1 className="h-display h-hi title-lg bk__title">
                <MaskLine>{book.title}</MaskLine>
              </h1>

              <Reveal delay={0.1}>
                <p className="bk__by">
                  <span>लेखक</span> {book.author}
                </p>
              </Reveal>

              <Reveal delay={0.16}>
                <p className="bk__desc hi">{book.description}</p>
              </Reveal>

              <Reveal delay={0.22}>
                <dl className="bk__facts">
                  <div>
                    <dt>अध्याय</dt>
                    <dd>{book.stats.chapters}</dd>
                  </div>
                  <div>
                    <dt>पढ़ने का समय</dt>
                    <dd>{fmtMinutes(book.stats.minutes)}</dd>
                  </div>
                  <div>
                    <dt>शब्द</dt>
                    <dd>{book.stats.words.toLocaleString("en-IN")}</dd>
                  </div>
                  <div>
                    <dt>प्रकाशन</dt>
                    <dd>{fmtDate(book.published)}</dd>
                  </div>
                </dl>
              </Reveal>

              <Reveal delay={0.28} className="bk__actions">
                <Link
                  className="btn btn--solid btn--lg"
                  to={`/read/${book.slug}`}
                  data-cursor="पढ़िए"
                >
                  <IconEye width={20} height={20} />
                  {pct > 0 ? "पढ़ना जारी रखें" : "पढ़ें"}
                </Link>
                {pct > 0 && firstChapter && (
                  <Link className="btn btn--lg" to={`/read/${book.slug}/${firstChapter.id}`}>
                    शुरू से पढ़ें
                  </Link>
                )}
                <ShareButton book={book} />
              </Reveal>

              {pct > 0 && (
                <Reveal delay={0.32}>
                  <div className="bk__resume">
                    <div className="bk__bar" role="img" aria-label={`${pct} प्रतिशत पढ़ा गया`}>
                      <i style={{ width: `${pct}%` }} />
                    </div>
                    <p>
                      {pct}% पढ़ा
                      {resumeChapter &&
                        ` · अगला: ${resumeChapter.num ? `${resumeChapter.num} · ` : ""}${resumeChapter.title}`}
                    </p>
                  </div>
                </Reveal>
              )}
            </div>
          </section>
          </div>

          {/* --------------------------------------------- contents */}
          <section className="section bk__tocSec" id="contents">
            <div className="shell shell--narrow">
              <Reveal>
                <span className="eyebrow is-hi">अनुक्रम · Contents</span>
              </Reveal>

              {GROUPS.map((g) => {
                const items = book.chapters.filter((c) => c.kind === g.kind);
                if (!items.length) return null;
                return (
                  <div key={g.kind} className="bk__group">
                    <h2 className="bk__groupT hi-d">{g.label}</h2>
                    <ol className="bk__toc">
                      {items.map((c) => (
                        <li key={c.id}>
                          <Link to={`/read/${book.slug}/${c.id}`} className="bk__row">
                            <span className="bk__num">{c.num || "·"}</span>
                            <span className="bk__rowT">{c.title}</span>
                            <span className="bk__rowM">
                              {done[c.id] ? (
                                <IconCheck width={16} height={16} aria-label="पढ़ा हुआ" />
                              ) : c.minutes ? (
                                `${c.minutes} मि.`
                              ) : null}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ol>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ------------------------------------------- reading only */}
          <section className="section section--alt bk__formats">
            <div className="shell shell--narrow">
              <Reveal>
                <span className="eyebrow is-hi">पढ़ने का अनुभव</span>
              </Reveal>
              <div className="bk__fmt">
                <Reveal y={22}>
                  <h2 className="h-display h-hi title-md">ई-रीडर जैसा, ब्राउज़र में</h2>
                  <p className="bk__fmtP hi">
                    पन्ने पलटिए या स्क्रॉल कीजिए; रंग और अक्षर अपनी पसंद के रखिए; जहाँ छोड़ा था,
                    किताब वहीं खुलेगी। यह किताब केवल यहीं पढ़ने के लिए है — डाउनलोड या कॉपी का
                    विकल्प नहीं है।
                  </p>
                </Reveal>
              </div>
              {book.rights && <p className="bk__rights hi">{book.rights}</p>}
            </div>
          </section>
        </main>
      )}

      <Footer note="दो कुल्हड़ चाय · किताबघर" />
    </div>
  );
}
