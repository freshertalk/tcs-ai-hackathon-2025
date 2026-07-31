// src/App.js
import React, { useEffect, useState } from "react";
import { MotionConfig } from "framer-motion";

import useSmoothScroll from "./hooks/useSmoothScroll";
import Preloader from "./components/site/Preloader";
import Cursor from "./components/site/Cursor";
import Nav from "./components/site/Nav";
import Hero from "./components/site/Hero";
import Marquee from "./components/site/Marquee";
import Intro from "./components/site/Intro";
import Book from "./components/site/Book";
import Craft from "./components/site/Craft";
import Work from "./components/site/Work";
import Projects from "./components/site/Projects";
import Assistant from "./components/site/Assistant";
import Contact from "./components/site/Contact";

import "./styles/site.css";

const TICKER = [
  { text: "SAP BTP", hl: true },
  { text: "CAPM" },
  { text: "Fiori / UI5" },
  { text: "HANA Cloud" },
  { text: "Event Mesh" },
  { text: "Node.js" },
  { text: "Agentic AI" },
  { text: "दो कुल्हड़ चाय", hl: true },
  { text: "Clean Core" },
  { text: "Hindi Fiction" },
];

export default function App() {
  const [loading, setLoading] = useState(true);

  useSmoothScroll(!loading);

  // Keep the page pinned at the top while the preloader is on screen.
  useEffect(() => {
    if (loading) {
      window.scrollTo(0, 0);
      document.body.classList.add("is-locked");
    } else {
      document.body.classList.remove("is-locked");
    }
  }, [loading]);

  return (
    // reducedMotion="user" makes every framer-motion animation collapse to a
    // cross-fade for visitors who ask their OS for less motion.
    <MotionConfig reducedMotion="user">
      <div className="grain" aria-hidden="true" />
      <Cursor />
      <Preloader onDone={() => setLoading(false)} />

      <Nav />

      <main>
        <Hero />
        <Marquee items={TICKER} />
        <Intro />
        <Book />
        <Craft />
        <Work />
        <Projects />
        <Assistant />
        <Contact />
      </main>
    </MotionConfig>
  );
}
