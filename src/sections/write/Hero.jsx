// src/sections/write/Hero.jsx
// The front door is a book listing.
//
// Everything a reader weighs before buying a book is on the first screen,
// with no scrolling and no splash in the way: the cover, the title, who
// wrote it, its price and the way to buy it, what it is about (in one
// breath), what readers said, how long it is and when it was published.
// The longer answers — the story, its people, its author — each have their
// own section further down, so none of them is repeated here.
//
// Layout is one grid with named areas, so the same markup becomes a
// product-page on a desktop (cover left, details right) and a compact
// cover-beside-title card on a phone, with the button still above the fold.

import React from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Reveal, EASE } from "../../components/ui/motion";
import BuyBar from "../../shop/BuyBar";
import { RatingChip } from "../../reviews/Reviews";
import Price from "../../library/Price";
import CouponBox from "../../coupons/CouponBox";
import HeroVoices from "../../reviews/HeroVoices";
import BookShowcase from "../../library/BookShowcase";
import { useCatalog } from "../../library/hooks";
import { fmtDate, fmtMinutes } from "../../reader/util";
import { BOOK } from "../../data/books";

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
    // blank until there is one (BOOK.facts, "ISBN"): drawn as a dash
    { k: "ISBN", v: ((BOOK.facts || []).find((f) => f.k === "ISBN") || {}).v || "" },
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
            </div>
            {/* the action sits with the price: buy, add to cart, a coupon */}
            <div className="bh__buyrow">
              <span ref={readRef} className="bh__buy">
                <BuyBar
                  book={book}
                  slug={BOOK.slug}
                  readClass="btn btn--solid bh__read"
                  buyClass="btn btn--solid bh__read"
                  cartClass="bh__cart"
                />
              </span>
              <CouponBox className="bh__coupon" />
            </div>
            <div className="bh__rate">
              <RatingChip slug={BOOK.slug} compact />
            </div>
          </Reveal>
        </div>

        {/* --------------------------------------- the rest of the listing */}
        <div className="bh__body">
          {/* the premise, in the book's own words: it ends on the question the
              book exists to answer */}
          <Reveal y={18} delay={0.16} duration={0.9}>
            <div className="bh__story">
              <p className="bh__tag hi">{BOOK.logline}</p>
            </div>
          </Reveal>

          <Reveal y={18} delay={0.18} duration={0.9}>
            <HeroVoices slug={BOOK.slug} />
          </Reveal>

          <Reveal y={18} delay={0.2} duration={0.9}>
            <dl className="bh__facts">
              {facts.map((f) => (
                <div key={f.k}>
                  <dt>{f.k}</dt>
                  <dd>{f.v || "—"}</dd>
                </div>
              ))}
            </dl>
          </Reveal>

          <Reveal y={18} delay={0.24} duration={0.9} className="bh__actions">
            <span className="bh__links">
              <a className="bh__ghost" href="#opening">
                पहला पन्ना पढ़िए
              </a>
              <a className="bh__ghost" href="#novel">
                कहानी के बारे में
              </a>
              <Link className="bh__ghost" to={`/books/${BOOK.slug}#contents`}>
                अनुक्रम
              </Link>
            </span>
          </Reveal>

        </div>
      </div>
    </section>
  );
}
