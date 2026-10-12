// src/pages/Technical.jsx
//
// HIDDEN. The site is now an author's site and this page is deliberately not
// routed (see App.js — /technical redirects home) or linked, and it is kept
// out of the sitemap. Everything it needs is still here, so bringing it back
// is: add the route, add a link, add a sitemap entry, and give it a real
// entry in data/seo.js. Until then it carries noindex as a safety net.
import React, { useEffect } from "react";

import Nav from "../components/site/Nav";
import Footer from "../components/site/Footer";
import ScrollTop from "../components/site/ScrollTop";
import Seo from "../components/seo/Seo";
import Marquee from "../components/site/Marquee";
import Assistant from "../components/site/Assistant";

import Hero from "../sections/tech/Hero";
import About from "../sections/tech/About";
import Stack from "../sections/tech/Stack";
import Experience from "../sections/tech/Experience";
import Projects from "../sections/tech/Projects";
import Hub from "../sections/tech/Hub";
import Credentials from "../sections/tech/Credentials";
import Contact from "../sections/tech/Contact";

import { PROFILE } from "../data/profile";

const LINKS = [
  // "About" returns to the very top of the page, not to the #about block —
  // the intro pills and headline are part of the introduction.
  { id: "top", label: "About" },
  { id: "stack", label: "Stack" },
  { id: "work", label: "Experience" },
  { id: "projects", label: "Projects" },
  { id: "hub", label: "Learning Hub" },
  { id: "credentials", label: "Credentials" },
  { id: "assistant", label: "Ask AI" },
  { id: "contact", label: "Contact" },
];

const TICKER = [
  { text: "SAP BTP", hl: true },
  { text: "CAPM" },
  { text: "Fiori / UI5" },
  { text: "HANA Cloud" },
  { text: "Event Mesh" },
  { text: "Integration Suite" },
  { text: "Node.js" },
  { text: "Agentic AI", hl: true },
  { text: "Clean Core" },
  { text: "BTP Learning Hub", hl: true },
];

export default function Technical() {
  useEffect(() => {
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", "#f4f5f7");
  }, []);

  return (
    <div data-theme="tech">
      <Seo
        meta={{
          title: "Technical portfolio — Vinay Kumar Tiwari",
          path: "/technical",
          noindex: true,
          lang: "en",
        }}
      />
      <Nav
        links={LINKS}
        kicker="Technical portfolio"
        switchTo={{ href: "/writings", label: "Writings" }}
        contact={{ email: PROFILE.email, phone: PROFILE.phone }}
      />

      <main>
        <Hero />
        <Marquee items={TICKER} baseVelocity={22} />
        <About />
        <Stack />
        <Experience />
        <Projects />
        <Hub />
        <Credentials />
        <Assistant />
        <Contact />
      </main>

      <Footer switchTo={{ href: "/writings", label: "Writings" }} />
      <ScrollTop />
    </div>
  );
}
