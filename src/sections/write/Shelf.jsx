// src/sections/write/Shelf.jsx
// The house's shelf: the novel stands on a plank, cover turned to the room,
// its spine beside it, a pair of kulhads next to it — and the way in.
//
// Nothing here is claimed that the book does not say. The words are the
// book's own (its three beats, its prologue's last line); the "perks" are
// facts about how the reader works.

import React from "react";
import { Link } from "react-router-dom";
import { Reveal, MaskLine } from "../../components/ui/motion";
import { KulhadPair } from "../../components/site/Kulhad";
import { Cover, ReadButton } from "../../library/BookCard";
import { contentUrl } from "../../library/api";
import { openCoverViewer } from "../../library/CoverViewer";
import Price from "../../library/Price";
import { useCatalog } from "../../library/hooks";
import { fmtDate, fmtMinutes } from "../../reader/util";
import { BOOK, PUBLISHER } from "../../data/books";

const FALLBACK = {
  slug: BOOK.slug,
  title: BOOK.title,
  author: BOOK.byline,
  language: "hi",
  cover: "cover.jpg",
  coverSmall: "cover-sm.jpg",
  chapters: 36,
  minutes: 325,
  published: "2026-10-16",
  description: BOOK.logline,
};

const PERKS = [
  { k: "पहला पन्ना, अभी", d: "खाता नहीं, फ़ॉर्म नहीं — बटन दबाइए और पढ़ना शुरू।" },
  { k: "फ़ोन, टैबलेट, कंप्यूटर", d: "जिस स्क्रीन पर आराम मिले, वहीं पन्ने पलटिए।" },
  { k: "आपकी जगह, याद", d: "रुकिए तो वहीं से, जहाँ छोड़ा था — हर बार।" },
  { k: "आपकी पसंद का पन्ना", d: "रंग, अक्षर का आकार, चमक — सब आपके हाथ में।" },
];

export default function Shelf() {
  const { data } = useCatalog();
  const entry = data && data.books.find((b) => b.slug === BOOK.slug);
  // art only ever comes from the published catalogue — never from the fallback
  const book = entry ? { ...FALLBACK, ...entry, art: entry.art } : FALLBACK;

  return (
    <section className="section shelf" id="shelf">
      <div className="shell">
        <div className="shelf__head">
          <Reveal>
            <span className="eyebrow is-hi">{PUBLISHER.name} · रचनाएँ</span>
          </Reveal>
          <h2 className="h-display h-hi title-md shelf__title">
            {BOOK.teaser.beats.map((b, i) => (
              <MaskLine key={b} delay={i * 0.07}>
                {b}
              </MaskLine>
            ))}
          </h2>
          <Reveal delay={0.2}>
            <p className="shelf__lede hi">
              {PUBLISHER.name} की अलमारी में सबसे आगे रखी किताब। इसके पीछे का सवाल वही है, जो
              इसके पहले पन्ने पर पूछा गया है — दूसरा टिकट किसका है?
            </p>
          </Reveal>
        </div>

        <Reveal y={36} className="shelf__case">
          <div className="shelf__row">
            {/* the book, face out */}
            <button
              type="button"
              className="shelf__feature"
              onClick={() => openCoverViewer(book, "front")}
              aria-label={`${book.title} — आवरण बड़ा करके देखिए`}
              data-cursor="बड़ा"
            >
              <Cover book={book} sizes="(max-width: 760px) 54vw, 300px" />
            </button>

            {/* the same book, seen from the side */}
            {book.art && book.art.spine ? (
              <Link
                className="shelf__spine shelf__spine--art"
                to={`/books/${book.slug}`}
                aria-hidden="true"
                tabIndex={-1}
              >
                <img src={contentUrl(book.slug, book.art.spine)} alt="" loading="lazy" decoding="async" />
              </Link>
            ) : (
              <Link className="shelf__spine" to={`/books/${book.slug}`} aria-hidden="true" tabIndex={-1}>
                <span className="shelf__spineT">{book.title}</span>
                <span className="shelf__spineA">{book.author}</span>
              </Link>
            )}

            {/* the plaque */}
            <div className="shelf__plaque">
              <span className="shelf__kicker">पहली किताब · हिन्दी उपन्यास</span>
              <h3 className="shelf__book hi-d">{book.title}</h3>
              <p className="shelf__by">
                <span>लेखक</span> {book.author}
              </p>
              <p className="shelf__facts">
                {book.chapters} अध्याय · {fmtMinutes(book.minutes)} · {fmtDate(book.published)}
              </p>
              <Price slug={book.slug} className="shelf__price" />
              <div className="shelf__go">
                <ReadButton book={book} className="btn btn--solid btn--lg" />
                <Link className="shelf__link" to={`/books/${book.slug}`}>
                  किताब का पन्ना
                </Link>
              </div>
            </div>

            <div className="shelf__cups" aria-hidden="true">
              <KulhadPair size={46} steam />
            </div>
          </div>
          <div className="shelf__plank" aria-hidden="true" />
        </Reveal>

        <ul className="shelf__perks">
          {PERKS.map((p, i) => (
            <Reveal as="li" key={p.k} y={20} delay={i * 0.06}>
              <b className="hi-d">{p.k}</b>
              <span className="hi">{p.d}</span>
            </Reveal>
          ))}
        </ul>

        <Reveal className="shelf__more" y={16}>
          <Link className="shelf__link" to="/library">
            सभी रचनाएँ देखिए
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
