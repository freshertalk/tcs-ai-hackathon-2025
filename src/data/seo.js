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
import { AUTHOR } from "./author";

export const SITE = {
  origin: "https://vinaytiwari.org",
  name: "Vinay Kumar Tiwari",
  shortName: "Vinay Tiwari",
  locale: "en_IN",
  localeAlt: "hi_IN",
  twitter: "", // add the @handle if one exists
  ogImage: "/og-image.jpg",
  ogImageAlt:
    "Vinay Kumar Tiwari, SAP BTP Solution Architect and Hindi author — portrait beside the line: I design systems where nothing is allowed to slip, and write about people who did.",
  // the line the site opens with — reused for the link preview
  tagline:
    "I design systems where nothing is allowed to slip — and write about people who did.",
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

/* Writer-side terms — the author and his Hindi fiction. */
export const WRITER_TERMS = [
  "विनय कुमार तिवारी लेखक",
  "Vinay Kumar Tiwari Hindi author",
  "हिन्दी लेखक",
  "हिन्दी उपन्यास",
  "दो कुल्हड़ चाय",
  "Do Kulhad Chai",
  "Hindi fiction",
  "ग़ाज़ीपुर के लेखक",
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
// One page now. The map stays so <Seo page="..."/> and graphFor() keep their
// shape if a second route is ever added.
export const PAGES = {
  home: {
    path: "/",
    title: "Vinay Kumar Tiwari — SAP BTP Solution Architect & Hindi Author",
    description: `SAP BTP Solution Architect (${YEARS}+ years), BTP Learning Hub founder and Hindi author. I build systems where nothing slips — and write about people who did.`,
    keywords: [...NAME_VARIANTS, ...TECH_TERMS, ...WRITER_TERMS],
    lang: "en",
    summary: `Vinay Kumar Tiwari — also written Vinay Tiwari, Tiwari Vinay, or विनय कुमार तिवारी — is an SAP BTP Solution Architect and Hindi author. He grew up in Ghazipur, Uttar Pradesh, and lives in Noida, India. He has ${YEARS}+ years of enterprise delivery experience across IBM, TCS, Cognizant, Mindtree and Wipro, currently as Package Consultant — SAP BTP at IBM India. He specialises in SAP Business Technology Platform: CAP (CAPM), SAP Fiori and SAPUI5, SAP HANA Cloud, Integration Suite, Event Mesh, Cloud Foundry and Clean Core extensibility for S/4HANA, with AI-assisted engineering. He holds SAP Certified Development Associate credentials for SAP Fiori Application Developer (C_FIORDEV_21) and SAP Extension Suite (C_CPE_12), and founded BTP Learning Hub, a free SAP BTP tutorial site. By night he writes Hindi fiction; his debut novel is दो कुल्हड़ चाय (Do Kulhad Chai).`,
  },
};

/* ---------------------------------------------------------------------------
   JSON-LD entity graph.
   Kept strictly truthful: no ratings, no offers, nothing that is not on the
   page. The novel is described in the Person entity only; it is sold on its
   own site, so this one does not claim a Book page of its own.
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
  birthPlace: {
    "@type": "Place",
    address: {
      "@type": "PostalAddress",
      addressLocality: "Ghazipur",
      addressRegion: "Uttar Pradesh",
      addressCountry: "IN",
    },
  },
  description: `${PROFILE.summary}. Hindi author; his debut novel is दो कुल्हड़ चाय (Do Kulhad Chai).`,
  url: SITE.origin,
  image: {
    "@type": "ImageObject",
    url: `${SITE.origin}/vinay-portrait.jpg`,
    contentUrl: `${SITE.origin}/vinay-portrait.jpg`,
    width: 1000,
    height: 1250,
    caption: "Vinay Kumar Tiwari, SAP BTP Solution Architect and Hindi author",
  },
  mainEntityOfPage: { "@id": `${SITE.origin}/#webpage` },
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
  contactPoint: [
    {
      "@type": "ContactPoint",
      contactType: "professional enquiries",
      email: PROFILE.email,
    },
    {
      "@type": "ContactPoint",
      contactType: "author enquiries",
      email: AUTHOR.connect.email,
      availableLanguage: ["Hindi", "English"],
    },
  ],
  sameAs: [
    PROFILE.linkedin,
    PROFILE.instagram,
    "https://btplearninghub.com",
    SITE.origin,
  ].filter(Boolean),
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
    a: `Vinay Kumar Tiwari (also written Vinay Tiwari, विनय कुमार तिवारी) is an SAP BTP Solution Architect and Hindi author. He grew up in Ghazipur, Uttar Pradesh, lives in Noida, and has ${YEARS}+ years of enterprise delivery across IBM, TCS, Cognizant, Mindtree and Wipro. He founded BTP Learning Hub and wrote the Hindi novel दो कुल्हड़ चाय (Do Kulhad Chai).`,
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
    q: "Does Vinay Kumar Tiwari write books?",
    a: "Yes. Alongside his SAP career he writes Hindi fiction. His debut novel is दो कुल्हड़ चाय (Do Kulhad Chai). He writes about people who have let something slip and cannot put it right, mostly at night. Author contact: author.vinaytiwari1@gmail.com; Instagram @_vinaytiwari.",
  },
  {
    lang: "hi",
    q: "विनय कुमार तिवारी कौन हैं?",
    a: "विनय कुमार तिवारी ग़ाज़ीपुर, उत्तर प्रदेश में पले-बढ़े और आजकल नोएडा में रहते हैं। वे सॉफ़्टवेयर इंजीनियर और SAP BTP सॉल्यूशन आर्किटेक्ट हैं, और हिन्दी में कहानियाँ-उपन्यास लिखते हैं। उनका पहला उपन्यास दो कुल्हड़ चाय है।",
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

  return [
    personLd(),
    websiteLd(),
    {
      "@type": "ProfilePage",
      "@id": `${url(page.path)}#webpage`,
      url: url(page.path),
      name: page.title,
      description: page.description,
      inLanguage: "en-IN",
      isPartOf: { "@id": `${SITE.origin}/#website` },
      about: { "@id": `${SITE.origin}/#person` },
      mainEntity: { "@id": `${SITE.origin}/#person` },
      primaryImageOfPage: `${SITE.origin}${SITE.ogImage}`,
    },
    hubLd(),
    faqLd(),
    breadcrumbLd([{ name: "Home", path: "/" }]),
  ];
}

export { url };
