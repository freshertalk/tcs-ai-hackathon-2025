// src/data/hub.js
// ---------------------------------------------------------------------------
// BTP Learning Hub — Vinay's own technical website.
// This is the content for the dedicated showcase section on the home page.
// Everything here is editable copy; change it without touching any component.
// ---------------------------------------------------------------------------

import { YEARS } from "./profile";

export const HUB = {
  name: "BTP Learning Hub",
  url: "https://btplearninghub.com",
  urlLabel: "btplearninghub.com",
  role: "Founder · Author · Engineer",
  since: "Feb 2026 — Present",
  kicker: "My own technical website",

  tagline: "SAP BTP, explained by someone who ships it on Monday.",

  intro:
    "Most SAP BTP material is either a 400-page official guide or a two-minute video that skips the hard part. BTP Learning Hub sits in between — production-grade walkthroughs written from live enterprise delivery, in plain language, with the mistakes left in.",

  // The full-stack behind it
  stack: ["React", "Node.js", "Express", "MongoDB", "REST APIs", "Vercel"],

  // Big numbers for the counter strip
  stats: [
    { n: 6, suffix: "", label: "Learning tracks" },
    { n: 40, suffix: "+", label: "Articles & tutorials" },
    { n: YEARS, suffix: " yrs", label: "Of delivery behind it" },
    { n: 100, suffix: "%", label: "Free to read" },
  ],

  // What you actually find on the site
  tracks: [
    {
      n: "01",
      t: "SAP BTP foundations",
      d: "Subaccounts, entitlements, Cloud Foundry vs Kyma, destinations, connectivity and the org model — the parts every project gets wrong in week one.",
      tags: ["Cockpit", "Entitlements", "Destinations"],
    },
    {
      n: "02",
      t: "CAP (CAPM) end to end",
      d: "From `cds init` to a deployed MTA: CDS modelling, services, custom handlers, authorisation, HANA Cloud persistence and multitenancy.",
      tags: ["CDS", "Node.js", "HANA Cloud", "MTA"],
    },
    {
      n: "03",
      t: "Fiori & SAPUI5 in practice",
      d: "Freestyle vs elements, OData V2/V4 realities, performance patterns, Launchpad/WorkZone integration and Fiori design-guideline compliance.",
      tags: ["UI5", "Fiori Elements", "OData V4"],
    },
    {
      n: "04",
      t: "Integration & events",
      d: "Integration Suite iFlows, Event Mesh topics, API Management policies and how to keep S/4HANA extensions on the clean side of Clean Core.",
      tags: ["Event Mesh", "Integration Suite", "Clean Core"],
    },
    {
      n: "05",
      t: "AI-assisted engineering",
      d: "How GitHub Copilot, Claude Code, SAP Joule and SAP AI Core actually change a delivery sprint — prompts, guardrails, review discipline and what not to delegate.",
      tags: ["GenAI", "Agentic AI", "SAP AI Core", "Joule"],
    },
    {
      n: "06",
      t: "Architecture & career",
      d: "Clean Architecture and SOLID applied to BTP codebases, estimation, design reviews, certification routes and how to move from developer to architect.",
      tags: ["Clean Architecture", "SOLID", "Certification"],
    },
  ],

  // Who it's for
  audience: [
    {
      t: "ABAP & functional folks moving to cloud",
      d: "A route into BTP that does not assume you already write JavaScript.",
    },
    {
      t: "UI5 / Fiori developers going full-stack",
      d: "CAP services, HANA Cloud and deployment — the half of the job most UI developers never get shown.",
    },
    {
      t: "Architects and leads",
      d: "Reference patterns, Clean Core decision trees and reviewable checklists you can drop into a design workshop.",
    },
    {
      t: "Certification candidates",
      d: "Structured prep for the Fiori Developer and Extension Suite exams, written by someone who holds both.",
    },
  ],

  // Why it exists — the differentiator list
  why: [
    "Written from live enterprise delivery, not from the documentation index",
    "Every walkthrough is something that shipped to a real production tenant",
    "Plain English first, jargon second — with the failure modes included",
    "Built and maintained solo on the MERN stack, so it stays fast and ad-free",
    "Free to read. No paywall, no gated PDF, no sign-up to see a tutorial",
  ],

  // Calls to action
  cta: {
    primary: { label: "Open BTP Learning Hub", href: "https://btplearninghub.com" },
    secondary: { label: "vinaytiwari.org", href: "https://vinaytiwari.org" },
  },

  // Mock browser chrome content for the visual
  preview: {
    urlBar: "btplearninghub.com",
    headline: "Learn SAP BTP the way it is actually delivered.",
    sub: "CAP · Fiori/UI5 · HANA Cloud · Integration Suite · AI-assisted engineering",
    chips: ["Guides", "Tutorials", "Architecture", "AI", "Certification"],
  },
};

export default HUB;
