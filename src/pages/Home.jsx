// src/pages/Home.jsx
// The whole site is this one page: the person first, then the engineering,
// then the writing, then how to reach him.
import React, { useEffect } from "react";

import Nav from "../components/site/Nav";
import Footer from "../components/site/Footer";
import ScrollTop from "../components/site/ScrollTop";
import Seo from "../components/seo/Seo";
import Marquee from "../components/site/Marquee";
import Assistant from "../components/site/Assistant";

import Hero from "../sections/Hero";
import About from "../sections/About";
import Journey from "../sections/Journey";
import Stack from "../sections/Stack";
import Experience from "../sections/Experience";
import Projects from "../sections/Projects";
import Hub from "../sections/Hub";
import Writer from "../sections/Writer";
import Credentials from "../sections/Credentials";
import Contact from "../sections/Contact";

import { PROFILE } from "../data/profile";

const LINKS = [
  // "About" returns to the very top of the page, not to the #about block —
  // the intro pills and headline are part of the introduction.
  { id: "top", label: "About" },
  { id: "stack", label: "Stack" },
  { id: "work", label: "Experience" },
  { id: "projects", label: "Projects" },
  { id: "hub", label: "Learning Hub" },
  { id: "writer", label: "Writing" },
  { id: "credentials", label: "Credentials" },
  { id: "assistant", label: "Ask AI" },
];

const TICKER = [
  { text: "SAP BTP", hl: true },
  { text: "CAPM" },
  { text: "Fiori / UI5" },
  { text: "HANA Cloud" },
  { text: "Clean Core" },
  { text: "Agentic AI", hl: true },
  { text: "BTP Learning Hub", hl: true },
  { text: "ग़ाज़ीपुर → नोएडा" },
  { text: "हिन्दी लेखक", hl: true },
];

export default function Home() {
  useEffect(() => {
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", "#f4f5f7");
  }, []);

  return (
    <div data-theme="tech">
      <Seo page="home" />
      <Nav
        links={LINKS}
        kicker="Engineer & Author"
        cta={{ id: "contact", label: "Contact" }}
        contact={{ email: PROFILE.email, phone: PROFILE.phone }}
      />

      <main>
        <Hero />
        <Marquee items={TICKER} baseVelocity={22} />
        <About />
        <Journey />
        <Stack />
        <Experience />
        <Projects />
        <Hub />
        <Writer />
        <Credentials />
        <Assistant />
        <Contact />
      </main>

      <Footer />
      <ScrollTop />
    </div>
  );
}
