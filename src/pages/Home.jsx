// src/pages/Home.jsx
// The front page, in the order a reader decides in:
//
//   1. the book and how to get it          (Hero, then the moving strip)
//   2. what it is about, and who is in it  (Novel — which ends on the epigraphs
//                                           that stand before page one)
//   3. page one itself                     (Opening)
//   4. how it sounds                       (Lines)
//   5. what it is really about             (Themes)
//   6. what readers said                   (Reviews)
//   7. who wrote it                        (Author)
//   8. the invitation, once more           (Teaser)
//   9. how to write to the author          (Contact)
//
// The book is shown once, at the top; nothing below repeats its cover or its
// price except the closing invitation.
import React, { useEffect, useRef } from "react";

import Nav from "../components/site/Nav";
import Footer from "../components/site/Footer";
import ScrollTop from "../components/site/ScrollTop";
import Seo from "../components/seo/Seo";
import Marquee from "../components/site/Marquee";

import Hero from "../sections/write/Hero";
import StickyRead from "../sections/write/StickyRead";
import Novel from "../sections/write/Novel";
import Opening from "../sections/write/Opening";
import Lines from "../sections/write/Lines";
import Themes from "../sections/write/Themes";
import Teaser from "../sections/write/Teaser";
import Reviews from "../sections/write/Reviews";
import Author from "../sections/write/Author";
import Contact from "../sections/write/Contact";

import { useCatalog } from "../library/hooks";
import { BOOK, AUTHOR } from "../data/books";

const LINKS = [
  // "उपन्यास" returns to the very top — the intro chips and the title are
  // part of the introduction.
  { id: "top", label: "उपन्यास" },
  { id: "opening", label: "पहला पन्ना" },
  { id: "lines", label: "पंक्तियाँ" },
  { id: "reviews", label: "राय" },
  { id: "author", label: "लेखक" },
  { to: "/library", label: "रचनाएँ" },
  { id: "contact", label: "संपर्क" },
];

// The strapline leads the moving strip, then the pull-quotes follow it.
const TICKER = [
  { text: BOOK.marqueeLine, hl: true },
  ...BOOK.quotes.map((q) => ({ text: q })),
];

export default function Home() {
  const readRef = useRef(null);
  const { data } = useCatalog();
  const entry = data ? data.books.find((b) => b.slug === BOOK.slug) : null;

  useEffect(() => {
    // the page opens in pale, rain-washed light; the browser bar should match it
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", "#e9eef6");
  }, []);

  return (
    <div data-theme="write" className="home">
      <Seo page="home" book={entry} />
      <Nav
        links={LINKS}
        tone="light"
        kicker="विनय कुमार तिवारी"
        cta={{ href: `/read/${BOOK.slug}`, label: "पढ़ें" }}
        contact={{ email: AUTHOR.connect.email }}
      />

      <main>
        <Hero readRef={readRef} />
        <Marquee items={TICKER} baseVelocity={12} />
        <Novel />
        <Opening />
        <Lines />
        <Themes />
        <Reviews />
        <Author />
        <Teaser />
        <Contact />
      </main>

      <Footer note="दो कुल्हड़ चाय · एक उपन्यास" />
      <StickyRead targetRef={readRef} />
      <ScrollTop />
    </div>
  );
}
