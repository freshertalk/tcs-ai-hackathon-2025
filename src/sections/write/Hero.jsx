// src/sections/write/Hero.jsx
// The front door is a book listing.
//
// Everything a reader weighs before opening a book is on the first screen,
// with no scrolling and no splash in the way: the cover, the title, who
// wrote it, what it is about (briefly), a line about the author, how long it
// is, when it was published — and the Read button.
//
// Layout is one grid with named areas, so the same markup becomes a
// product-page on a desktop (cover left, details right) and a compact
// cover-beside-title card on a phone, with the button still above the fold.

import React from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Reveal, Magnetic, EASE } from "../../components/ui/motion";
import Picture from "../../components/ui/Picture";
import { ReadButton } from "../../library/BookCard";
import { RatingChip } from "../../reviews/Reviews";
import Price from "../../library/Price";
import CouponBox from "../../coupons/CouponBox";
import HeroVoices from "../../reviews/HeroVoices";
import BookShowcase from "../../library/BookShowcase";
import { useCatalog } from "../../library/hooks";
import { fmtDate, fmtMinutes } from "../../reader/util";
import { BOOK, AUTHOR } from "../../data/books";

// Used until the catalogue arrives, so the cover never pops in late and the
// page is complete on the very first paint.
const FALLBACK = {
  slug: BOOK.slug,
  title: BOOK.title,
  author: BOOK.byline,
  cover: "cover.jpg",
  coverSmall: "cover-sm.jpg",
  chapters: 36,
  minutes: 325,
  published: "2026-10-16",
  language: "hi",
  description: BOOK.logline,
};

export default function Hero({ readRef }) {
  const { data } = useCatalog();
  const book = (data && data.books.find((b) => b.slug === BOOK.slug)) || FALLBACK;

  const facts = [
    { k: "भाषा", v: "हिन्दी" },
    { k: "अध्याय", v: String(book.chapters) },
    { k: "पढ़ने का समय", v: fmtMinutes(book.minutes) },
    { k: "प्रकाशन", v: fmtDate(book.published) },
  ];

  return (
    <section className="bh" id="top">
      {/* the cover's own night: rain, a red signal, a clay-coloured glow */}
      <div className="bh__bg" aria-hidden="true">
        <i className="bh__rain" />
        <i className="bh__rain bh__rain--b" />
        <i className="bh__glow" />
        <i className="bh__signal" />
      </div>

      <div className="shell bh__grid">
        {/* ------------------------------------------------------ cover */}
        <motion.div
          className="bh__cover"
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: EASE }}
        >
          <BookShowcase book={book} eager sizes="(max-width: 760px) 80vw, 420px" />
        </motion.div>

        {/* ------------------------------------------- title and author */}
        <div className="bh__head">
          <Reveal y={14} duration={0.8}>
            <span className="bh__kicker">हिन्दी उपन्यास · पहला उपन्यास</span>
          </Reveal>
          <Reveal y={20} delay={0.06} duration={0.9}>
            <h1 className="bh__title">{BOOK.title}</h1>
          </Reveal>
          <Reveal y={14} delay={0.12} duration={0.8}>
            <p className="bh__by">
              <span>लेखक:</span> <b>{BOOK.byline}</b>
            </p>
            <div className="bh__meta">
              <Price className="bh__price" />
              <RatingChip slug={BOOK.slug} />
            </div>
            <CouponBox className="bh__coupon" />
          </Reveal>
        </div>

        {/* --------------------------------------- the rest of the listing */}
        <div className="bh__body">
          <Reveal y={18} delay={0.16} duration={0.9}>
            <p className="bh__tag hi">{BOOK.logline}</p>
          </Reveal>

          <Reveal y={18} delay={0.18} duration={0.9}>
            <HeroVoices slug={BOOK.slug} />
          </Reveal>

          <Reveal y={18} delay={0.2} duration={0.9}>
            <dl className="bh__facts">
              {facts.map((f) => (
                <div key={f.k}>
                  <dt>{f.k}</dt>
                  <dd>{f.v}</dd>
                </div>
              ))}
            </dl>
          </Reveal>

          <Reveal y={18} delay={0.24} duration={0.9} className="bh__actions">
            <Magnetic>
              <span ref={readRef} style={{ display: "inline-flex" }}>
                <ReadButton book={book} className="btn btn--solid btn--lg bh__read" />
              </span>
            </Magnetic>
            <a className="bh__ghost" href="#opening">
              पहला पन्ना देखिए
            </a>
            <Link className="bh__ghost" to={`/books/${BOOK.slug}#contents`}>
              अनुक्रम
            </Link>
          </Reveal>

          <Reveal y={22} delay={0.3} duration={0.95} className="bh__cards">
            <article className="bh__card">
              <h2 className="bh__cardT">उपन्यास के बारे में</h2>
              <p className="hi">{BOOK.premise}</p>
            </article>

            <article className="bh__card bh__card--author">
              <span className="bh__avatar">
                <Picture
                  name="vinay-avatar-sm"
                  alt=""
                  width="200"
                  height="200"
                  loading="eager"
                  aria-hidden="true"
                />
              </span>
              <div>
                <h2 className="bh__cardT">लेखक के बारे में</h2>
                <p className="hi">
                  <b>{AUTHOR.name}</b> — {AUTHOR.brief}
                </p>
                <a className="bh__more" href="#author">
                  पूरा परिचय
                </a>
              </div>
            </article>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
