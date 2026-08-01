// src/pages/Writings.jsx
import React, { useEffect } from "react";

import Nav from "../components/site/Nav";
import Footer from "../components/site/Footer";
import Marquee from "../components/site/Marquee";

import Hero from "../sections/write/Hero";
import Novel from "../sections/write/Novel";
import Synopsis from "../sections/write/Synopsis";
import Themes from "../sections/write/Themes";
import Author from "../sections/write/Author";
import Contact from "../sections/write/Contact";

import { BOOK, AUTHOR } from "../data/books";

const LINKS = [
  { id: "novel", label: "उपन्यास" },
  { id: "synopsis", label: "कहानी" },
  { id: "themes", label: "विषय" },
  { id: "author", label: "लेखक" },
  { id: "contact", label: "संपर्क" },
];

const TICKER = BOOK.quotes.map((q, i) => ({ text: q, hl: i % 2 === 1 }));

export default function Writings() {
  useEffect(() => {
    document.title = "दो कुल्हड़ चाय — विनय कुमार तिवारी";
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", "#faf4e9");
  }, []);

  return (
    <div data-theme="write">
      <Nav
        links={LINKS}
        kicker="Writings · लेखन"
        switchTo={{ href: "/technical", label: "Technical" }}
        contact={{ email: AUTHOR.connect.email }}
      />

      <main>
        <Hero />
        <Marquee items={TICKER} baseVelocity={12} />
        <Novel />
        <Synopsis />
        <Themes />
        <Author />
        <Contact />
      </main>

      <Footer
        note="दो कुल्हड़ चाय · एक उपन्यास"
        switchTo={{ href: "/technical", label: "Technical" }}
      />
    </div>
  );
}
