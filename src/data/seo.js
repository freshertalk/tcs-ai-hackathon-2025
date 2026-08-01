// src/data/seo.js
// ---------------------------------------------------------------------------
// Every SEO / AEO string on the site lives here.
//
// Two audiences are being served:
//   1. Search crawlers  — titles, descriptions, canonicals, sitemap, headings.
//   2. Answer engines   — Google AI Overviews, ChatGPT, Claude, Perplexity.
//      These read structured data and plain prose far more than keywords, and
//      most of them do NOT execute JavaScript, which is why the build also
//      prerenders static HTML (see scripts/prerender.js).
// ---------------------------------------------------------------------------

import { PROFILE, YEARS, SKILLS, EDUCATION } from "./profile";
import { CERTS } from "./certs";
import { BOOK, AUTHOR } from "./books";

export const SITE = {
  origin: "https://vinaytiwari.org",
  name: "Vinay Kumar Tiwari",
  shortName: "Vinay Tiwari",
  locale: "en_IN",
  localeAlt: "hi_IN",
  twitter: "", // add the @handle if one exists
  ogImage: "/og-image.jpg",
};

const url = (p = "/") => `${SITE.origin}${p === "/" ? "/" : p}`;

/* ---------------------------------------------------------------------------
   Name variants.
   The single most useful signal for "Vinay Tiwari" / "Tiwari Vinay" / the
   Devanagari spelling all resolving to one person is a Person entity that
   declares every form as alternateName.
   --------------------------------------------------------------------------- */
export const NAME_VARIANTS = [
  "Vinay Kumar Tiwari",
  "Vinay Tiwari",
  "Tiwari Vinay",
  "Tiwari Vinay Kumar",
  "Vinay K. Tiwari",
  "Vinay",
  "विनय कुमार तिवारी",
  "विनय तिवारी",
  "Vinay Tiwari SAP",
  "SAP Vinay Tiwari",
  "Vinay Tiwari SAP BTP",
  "Vinay Tiwari BTP Learning Hub",
  "Vinay Tiwari author",
  "Vinay Tiwari Hindi author",
];

/* Topics this person is a credible source on — feeds knowsAbout + keywords. */
export const TOPICS = [
  ...SKILLS.sap,
  ...SKILLS.ai,
  ...SKILLS.engineering,
  ...SKILLS.architecture,
  "SAP Business Technology Platform",
  "SAP CAP",
  "SAPUI5",
  "SAP Fiori Elements",
  "SAP S/4HANA extensions",
  "SAP BTP architecture",
  "Clean Core extensibility",
  "Enterprise cloud architecture",
  "AI-assisted software engineering",
  "Hindi literature",
  "Hindi fiction",
  "Hindi novel",
];

/* Book-side terms — the novel is its own searchable entity. */
export const BOOK_TERMS = [
  "दो कुल्हड़ चाय",
  "Do Kulhad Chai",
  "दो कुल्हड़ चाय उपन्यास",
  "Do Kulhad Chai novel",
  "दो कुल्हड़ चाय विनय कुमार तिवारी",
  "हिन्दी उपन्यास",
  "Hindi novel 2026",
  "विवान प्राची",
  "शिवगंगा एक्सप्रेस",
  "सीट छत्तीस सैंतीस",
  "बारह तारीख़",
  "कानपुर लखनऊ बनारस",
  "नई हिन्दी कहानी",
  "रेलवे प्रेम कहानी",
];

const TECH_TERMS = [
  "SAP BTP Solution Architect",
  "SAP BTP consultant India",
  "SAP CAPM developer",
  "SAP Fiori UI5 developer",
  "SAP HANA Cloud",
  "SAP Integration Suite",
  "SAP Event Mesh",
  "Clean Core",
  "SAP certified Fiori application developer",
  "C_FIORDEV_21",
  "C_CPE_12",
  "BTP Learning Hub",
  "SAP BTP tutorials",
  "SAP consultant Noida",
  "IBM SAP consultant",
];

/* ---------------------------------------------------------------- per page */
export const PAGES = {
  home: {
    path: "/",
    title:
      "Vinay Kumar Tiwari — SAP BTP Solution Architect & Hindi Author (दो कुल्हड़ चाय)",
    description: `Vinay Kumar Tiwari (विनय कुमार तिवारी) — SAP BTP Solution Architect with ${YEARS}+ years across IBM, TCS, Cognizant, Mindtree and Wipro, founder of BTP Learning Hub, and author of the Hindi novel दो कुल्हड़ चाय (Do Kulhad Chai).`,
    keywords: [...NAME_VARIANTS, ...TECH_TERMS.slice(0, 6), ...BOOK_TERMS.slice(0, 4)],
    lang: "en",
    summary: `Vinay Kumar Tiwari — also written Vinay Tiwari, Tiwari Vinay, or विनय कुमार तिवारी — is an SAP BTP Solution Architect based in Noida, India, originally from Ghazipur, Uttar Pradesh. He has ${YEARS}+ years of enterprise delivery experience across IBM, TCS, Cognizant, Mindtree and Wipro, founded the free SAP learning site BTP Learning Hub, and wrote the Hindi novel दो कुल्हड़ चाय (Do Kulhad Chai). This site holds two portfolios: a technical one and a literary one.`,
  },
  technical: {
    path: "/technical",
    title: `Vinay Kumar Tiwari — SAP BTP Solution Architect | ${YEARS}+ Years, SAP Certified`,
    description: `SAP BTP Solution Architect Vinay Kumar Tiwari: ${YEARS}+ years delivering CAPM, Fiori/UI5, HANA Cloud, Integration Suite and Clean Core extensions for manufacturing, healthcare, aerospace and finance. SAP certified (C_FIORDEV_21, C_CPE_12). Founder of BTP Learning Hub.`,
    keywords: [...TECH_TERMS, ...NAME_VARIANTS.slice(0, 6)],
    lang: "en",
    summary: `Technical portfolio of Vinay Kumar Tiwari (Vinay Tiwari), SAP BTP Solution Architect and Package Consultant at IBM India, based in Noida. ${YEARS}+ years across SAP Business Technology Platform, CAP (CAPM), SAP Fiori and SAPUI5, SAP HANA Cloud, Integration Suite, Event Mesh, Cloud Foundry and Clean Core extensibility for S/4HANA, with AI-assisted engineering. SAP Certified Development Associate for SAP Fiori Application Developer (C_FIORDEV_21) and SAP Extension Suite (C_CPE_12). Founder of BTP Learning Hub, a free SAP BTP tutorial site.`,
  },
  writings: {
    path: "/writings",
    title:
      "दो कुल्हड़ चाय (Do Kulhad Chai) — हिन्दी उपन्यास · विनय कुमार तिवारी",
    description:
      "दो कुल्हड़ चाय — विनय कुमार तिवारी का पहला हिन्दी उपन्यास। शिवगंगा एक्सप्रेस, सीट छत्तीस और सैंतीस, और हर महीने की बारह तारीख़ का एक वादा। Do Kulhad Chai, a Hindi novel by Vinay Kumar Tiwari.",
    keywords: [...BOOK_TERMS, "विनय कुमार तिवारी", "Vinay Kumar Tiwari author"],
    lang: "hi",
    summary:
      "दो कुल्हड़ चाय (Do Kulhad Chai) विनय कुमार तिवारी का पहला हिन्दी उपन्यास है। शिवगंगा एक्सप्रेस में सीट छत्तीस और सैंतीस पर बैठे दो अजनबी — विवान और प्राची — एक रुके हुए लाल सिग्नल पर पूरी रात बात करते हैं, और फिर एक वादा करते हैं: हर महीने की बारह तारीख़, उसी ट्रेन में, दो कुल्हड़ चाय। कहानी कानपुर आउटर से लखनऊ जंक्शन होते हुए बनारस तक जाती है। Do Kulhad Chai is a Hindi literary novel by Vinay Kumar Tiwari, copyright filed with the Copyright Office, Government of India (Diary No. LD-36102/2026-CO).",
  },
};

/* ---------------------------------------------------------------------------
   JSON-LD entity graph.
   Kept strictly truthful: no ratings, no ISBN, no offers — the novel is
   copyright-filed but not yet published, and inventing those fields is both
   a structured-data violation and a trust problem.
   --------------------------------------------------------------------------- */
export const personLd = () => ({
  "@type": "Person",
  "@id": `${SITE.origin}/#person`,
  name: "Vinay Kumar Tiwari",
  alternateName: NAME_VARIANTS,
  givenName: "Vinay",
  additionalName: "Kumar",
  familyName: "Tiwari",
  jobTitle: "SAP BTP Solution Architect",
  description: `${PROFILE.summary}. Author of the Hindi novel दो कुल्हड़ चाय (Do Kulhad Chai).`,
  url: SITE.origin,
  image: `${SITE.origin}/vinay-portrait.jpg`,
  email: `mailto:${PROFILE.email}`,
  telephone: PROFILE.phone,
  knowsLanguage: ["en", "hi", "bho"],
  knowsAbout: TOPICS,
  nationality: { "@type": "Country", name: "India" },
  homeLocation: {
    "@type": "Place",
    address: {
      "@type": "PostalAddress",
      addressLocality: "Noida",
      addressRegion: "Uttar Pradesh",
      addressCountry: "IN",
    },
  },
  worksFor: {
    "@type": "Organization",
    name: PROFILE.company,
    url: "https://www.ibm.com",
  },
  alumniOf: EDUCATION.map((e) => ({
    "@type": "EducationalOrganization",
    name: e.institute,
  })),
  hasCredential: CERTS.map((c) => ({
    "@type": "EducationalOccupationalCredential",
    name: c,
  })),
  sameAs: [
    PROFILE.linkedin,
    "https://btplearninghub.com",
    SITE.origin,
  ].filter(Boolean),
});

export const bookLd = () => ({
  "@type": "Book",
  "@id": `${SITE.origin}/writings#book`,
  name: "दो कुल्हड़ चाय",
  alternateName: ["Do Kulhad Chai", "Do Kulhad Chai novel", "दो कुल्हड़ चाय उपन्यास"],
  inLanguage: "hi",
  genre: ["Fiction", "Literary fiction", "Hindi literature", "हिन्दी उपन्यास"],
  bookEdition: "First",
  abstract: BOOK.premise,
  description: `${BOOK.logline} ${BOOK.closing}`,
  author: { "@id": `${SITE.origin}/#person` },
  copyrightYear: 2026,
  copyrightHolder: { "@id": `${SITE.origin}/#person` },
  countryOfOrigin: { "@type": "Country", name: "India" },
  about: BOOK.themes.map((t) => t.t),
  character: BOOK.cast.map((c) => ({ "@type": "Person", name: c.name })),
  contentLocation: [
    { "@type": "Place", name: "Kanpur" },
    { "@type": "Place", name: "Lucknow Junction" },
    { "@type": "Place", name: "Varanasi (Banaras)" },
  ],
  url: url("/writings"),
});

export const websiteLd = () => ({
  "@type": "WebSite",
  "@id": `${SITE.origin}/#website`,
  url: SITE.origin,
  name: "Vinay Kumar Tiwari",
  alternateName: NAME_VARIANTS.slice(0, 6),
  inLanguage: ["en-IN", "hi-IN"],
  publisher: { "@id": `${SITE.origin}/#person` },
  about: { "@id": `${SITE.origin}/#person` },
});

export const hubLd = () => ({
  "@type": "WebSite",
  "@id": "https://btplearninghub.com/#website",
  url: "https://btplearninghub.com",
  name: "BTP Learning Hub",
  description:
    "Free SAP BTP tutorials and architecture walkthroughs — CAP, Fiori/UI5, HANA Cloud, Integration Suite and AI-assisted engineering.",
  inLanguage: "en",
  author: { "@id": `${SITE.origin}/#person` },
});

/* Answer-engine fuel: short, direct Q&A in the exact shape people ask. */
export const FAQ = [
  {
    q: "Who is Vinay Kumar Tiwari?",
    a: `Vinay Kumar Tiwari (also written Vinay Tiwari, विनय कुमार तिवारी) is an SAP BTP Solution Architect based in Noida, India, with ${YEARS}+ years of enterprise delivery across IBM, TCS, Cognizant, Mindtree and Wipro. He founded BTP Learning Hub and wrote the Hindi novel दो कुल्हड़ चाय (Do Kulhad Chai).`,
  },
  {
    q: "What does Vinay Tiwari specialise in?",
    a: "SAP Business Technology Platform architecture: CAP (CAPM), SAP Fiori and SAPUI5, SAP HANA Cloud, Integration Suite, Event Mesh, Cloud Foundry and Clean Core extensibility for S/4HANA — with AI-assisted engineering built into delivery.",
  },
  {
    q: "Which SAP certifications does Vinay Kumar Tiwari hold?",
    a: "SAP Certified Development Associate — SAP Fiori Application Developer (C_FIORDEV_21) and SAP Certified Development Associate — SAP Extension Suite (C_CPE_12).",
  },
  {
    q: "What is BTP Learning Hub?",
    a: "BTP Learning Hub (btplearninghub.com) is Vinay Kumar Tiwari's own technical website — free, ad-free SAP BTP guides covering CAP, Fiori/UI5, HANA Cloud, Integration Suite, AI-assisted engineering and certification prep.",
  },
  {
    q: "दो कुल्हड़ चाय उपन्यास किसके बारे में है?",
    a: "दो कुल्हड़ चाय विनय कुमार तिवारी का पहला हिन्दी उपन्यास है। शिवगंगा एक्सप्रेस में सीट छत्तीस और सैंतीस पर बैठे दो अजनबी एक रात बात करते हैं और एक वादा करते हैं — हर महीने की बारह तारीख़, उसी ट्रेन में, दो कुल्हड़ चाय।",
  },
  {
    q: "Who wrote Do Kulhad Chai?",
    a: "Do Kulhad Chai (दो कुल्हड़ चाय) is written by Vinay Kumar Tiwari, an SAP consultant from Ghazipur, Uttar Pradesh, now based in Noida. It is his debut Hindi novel, copyright filed with the Copyright Office, Government of India (Diary No. LD-36102/2026-CO).",
  },
];

export const faqLd = () => ({
  "@type": "FAQPage",
  "@id": `${SITE.origin}/#faq`,
  mainEntity: FAQ.map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: { "@type": "Answer", text: f.a },
  })),
});

export const breadcrumbLd = (crumbs) => ({
  "@type": "BreadcrumbList",
  itemListElement: crumbs.map((c, i) => ({
    "@type": "ListItem",
    position: i + 1,
    name: c.name,
    item: url(c.path),
  })),
});

/** Full @graph for a given page key. */
export function graphFor(key) {
  const page = PAGES[key];
  const base = [personLd(), websiteLd()];

  const webPage = {
    "@type": key === "technical" ? "ProfilePage" : "WebPage",
    "@id": `${url(page.path)}#webpage`,
    url: url(page.path),
    name: page.title,
    description: page.description,
    inLanguage: page.lang === "hi" ? "hi-IN" : "en-IN",
    isPartOf: { "@id": `${SITE.origin}/#website` },
    about: { "@id": `${SITE.origin}/#person` },
    primaryImageOfPage: `${SITE.origin}${SITE.ogImage}`,
  };

  if (key === "home") {
    return [
      ...base,
      webPage,
      bookLd(),
      hubLd(),
      faqLd(),
      breadcrumbLd([{ name: "Home", path: "/" }]),
    ];
  }
  if (key === "technical") {
    return [
      ...base,
      webPage,
      hubLd(),
      faqLd(),
      breadcrumbLd([
        { name: "Home", path: "/" },
        { name: "Technical portfolio", path: "/technical" },
      ]),
    ];
  }
  return [
    ...base,
    webPage,
    bookLd(),
    breadcrumbLd([
      { name: "Home", path: "/" },
      { name: "Writings · लेखन", path: "/writings" },
    ]),
  ];
}

export { url };
