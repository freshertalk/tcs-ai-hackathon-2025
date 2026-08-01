// src/pages/Technical.jsx
import React, { useEffect } from "react";

import Nav from "../components/site/Nav";
import Footer from "../components/site/Footer";
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
    document.title = "Vinay Kumar Tiwari — SAP BTP Solution Architect";
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", "#f4f5f7");
  }, []);

  return (
    <div data-theme="tech">
      <Nav
        links={LINKS}
        kicker="Technical portfolio"
        switchTo={{ href: "/writings", label: "Writings" }}
        contact={{ email: PROFILE.email, phone: PROFILE.phone }}
      />

      <main>
        <Hero />
        <Marquee items={TICKER} />
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
    </div>
  );
}
