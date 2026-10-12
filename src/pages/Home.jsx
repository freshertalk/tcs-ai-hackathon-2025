// src/pages/Home.jsx
// The front page: the author, the novel, and a way straight into reading it.
import React, { useEffect, useRef } from "react";

import Nav from "../components/site/Nav";
import Footer from "../components/site/Footer";
import ScrollTop from "../components/site/ScrollTop";
import Seo from "../components/seo/Seo";
import Marquee from "../components/site/Marquee";

import Hero from "../sections/write/Hero";
import StickyRead from "../sections/write/StickyRead";
import Shelf from "../sections/write/Shelf";
import Covers from "../sections/write/Covers";
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
    <div data-theme="write">
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
        <Shelf />
        <Covers />
        <Opening />
        <Novel />
        <Lines />
        <Themes />
        <Teaser />
        <Reviews />
        <Author />
        <Contact />
      </main>

      <Footer note="दो कुल्हड़ चाय · एक उपन्यास" />
      <StickyRead targetRef={readRef} />
      <ScrollTop />
    </div>
  );
}
