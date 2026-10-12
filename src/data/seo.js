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
//
// The site is an author's site: the person is Vinay Kumar Tiwari, the work is
// his writing. Books come from the library (public/content), so book pages
// build their metadata from each book's own book.json.
// ---------------------------------------------------------------------------

import { BOOK, AUTHOR } from "./books";

export const SITE = {
  origin: "https://vinaytiwari.org",
  name: "Vinay Kumar Tiwari",
  shortName: "Vinay Tiwari",
  locale: "hi_IN",
  localeAlt: "en_IN",
  twitter: "", // add the @handle if one exists
  ogImage: "/og-image.jpg",
};

export const url = (p = "/") => `${SITE.origin}${p === "/" ? "/" : p}`;

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
  "विनय कुमार तिवारी",
  "विनय तिवारी",
  "Vinay Tiwari author",
  "Vinay Tiwari Hindi author",
  "Vinay Kumar Tiwari novelist",
];

/* Topics this person is a credible source on — feeds knowsAbout + keywords. */
export const TOPICS = [
  "Hindi literature",
  "Hindi fiction",
  "Hindi novel",
  "हिन्दी उपन्यास",
  "Contemporary Hindi fiction",
  "Storytelling",
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
  "Hindi novel online",
  "हिन्दी उपन्यास ऑनलाइन पढ़ें",
  "विवान प्राची",
  "शिवगंगा एक्सप्रेस",
  "सीट तैंतीस छत्तीस",
  "सीट 33 और 36",
  "बारह तारीख़",
  "नई दिल्ली कानपुर आउटर बनारस",
  "दूसरा टिकट",
  "नई हिन्दी कहानी",
  "रेलवे प्रेम कहानी",
];

/* ---------------------------------------------------------------- per page */
export const PAGES = {
  home: {
    path: "/",
    title: "दो कुल्हड़ चाय — विनय कुमार तिवारी का हिन्दी उपन्यास · ऑनलाइन पढ़िए",
    description:
      "दो कुल्हड़ चाय (Do Kulhad Chai) — विनय कुमार तिवारी का पहला हिन्दी उपन्यास। शिवगंगा एक्सप्रेस, सीट 33 और 36, एक रुका हुआ लाल सिग्नल, और हर महीने की बारह तारीख़ का एक वादा। पूरा उपन्यास ऑनलाइन पढ़िए — फ़ोन, टैबलेट या कंप्यूटर पर।",
    keywords: [...BOOK_TERMS, ...NAME_VARIANTS.slice(0, 7)],
    lang: "hi",
    type: "website",
    summary:
      "विनय कुमार तिवारी (Vinay Kumar Tiwari, Vinay Tiwari) हिन्दी के लेखक हैं। गाज़ीपुर, उत्तर प्रदेश के रहने वाले और अब नोएडा में बसे विनय का पहला उपन्यास दो कुल्हड़ चाय (Do Kulhad Chai) है — छत्तीस अध्याय और 2015 से 2026 तक फैले ग्यारह साल। 12 जुलाई 2015 की रात नई दिल्ली से बनारस जाती शिवगंगा एक्सप्रेस कानपुर आउटर पर साढ़े चार घंटे एक लाल सिग्नल के सामने खड़ी रह जाती है, और सीट 33 और 36 पर बैठे दो अजनबी — विवान और प्राची — पूरी रात बात करते हैं, और नाम सबसे आख़िर में पूछते हैं। इस वेबसाइट पर पूरा उपन्यास ऑनलाइन पढ़ा जा सकता है। Vinay Kumar Tiwari is a Hindi author; his debut novel Do Kulhad Chai can be read online on this website.",
  },
  library: {
    path: "/library",
    title: "किताबघर · Books — विनय कुमार तिवारी की किताबें ऑनलाइन पढ़िए",
    description:
      "विनय कुमार तिवारी की किताबें — ऑनलाइन पढ़िए, कहीं भी, किसी भी डिवाइस पर। फ़ोन, टैबलेट और कंप्यूटर के लिए बना, ई-रीडर जैसा पढ़ने का अनुभव।",
    keywords: ["किताबघर", "हिन्दी किताबें ऑनलाइन", "Hindi books online", "Hindi ebook online", ...BOOK_TERMS.slice(0, 4)],
    lang: "hi",
    type: "website",
    summary:
      "विनय कुमार तिवारी की प्रकाशित किताबों का किताबघर। हर किताब ऑनलाइन रीडर में पढ़ी जा सकती है — पन्ने पलटकर या स्क्रॉल करके, अपनी पसंद के रंग और अक्षर में।",
  },
};

/** Per-book metadata, built from that book's book.json. */
export function bookMeta(book) {
  const isFlagship = book.slug === BOOK.slug;
  const roman = isFlagship ? ` (${BOOK.roman})` : "";
  return {
    path: `/books/${book.slug}`,
    title: `${book.title}${roman} — ${book.author} · पूरा उपन्यास ऑनलाइन पढ़िए`,
    description: `${book.description} — ${book.author}। ${book.stats.chapters} अध्याय, लगभग ${book.stats.minutes} मिनट का पाठ। ऑनलाइन पढ़िए।`,
    keywords: isFlagship
      ? [...BOOK_TERMS, ...NAME_VARIANTS.slice(0, 5)]
      : [book.title, book.author, ...(book.subjects || [])],
    lang: book.language === "hi" ? "hi" : "en",
    type: "book",
    image: book.cover ? `${SITE.origin}/content/${book.slug}/${book.cover}` : `${SITE.origin}${SITE.ogImage}`,
  };
}

/* ---------------------------------------------------------------------------
   JSON-LD entity graph.
   Kept strictly truthful: no ratings, no ISBN, no offers — the novel is
   copyright-filed and self-published, and inventing those fields is both a
   structured-data violation and a trust problem.
   --------------------------------------------------------------------------- */
export const personLd = () => ({
  "@type": "Person",
  "@id": `${SITE.origin}/#person`,
  name: "Vinay Kumar Tiwari",
  alternateName: NAME_VARIANTS,
  givenName: "Vinay",
  additionalName: "Kumar",
  familyName: "Tiwari",
  jobTitle: "Author",
  description:
    "Hindi author from Ghazipur, Uttar Pradesh, based in Noida. Writer of the Hindi novel दो कुल्हड़ चाय (Do Kulhad Chai). Software engineer by profession, novelist by night.",
  url: SITE.origin,
  image: `${SITE.origin}/vinay-portrait.jpg`,
  email: `mailto:${AUTHOR.connect.email}`,
  knowsLanguage: ["hi", "en", "bho"],
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
  sameAs: [SITE.origin, "https://www.instagram.com/_vinaytiwari"],
});

export const websiteLd = () => ({
  "@type": "WebSite",
  "@id": `${SITE.origin}/#website`,
  url: SITE.origin,
  name: "Vinay Kumar Tiwari",
  alternateName: NAME_VARIANTS.slice(0, 6),
  inLanguage: ["hi-IN", "en-IN"],
  publisher: { "@id": `${SITE.origin}/#person` },
  about: { "@id": `${SITE.origin}/#person` },
});

/** A Book entity. `book` is a book.json (or the BOOK stub for the home page). */
export const bookLd = (book) => {
  const flagship = book.slug === BOOK.slug;
  const readUrl = url(`/read/${book.slug}`);
  const ld = {
    "@type": "Book",
    "@id": `${url(`/books/${book.slug}`)}#book`,
    name: book.title,
    inLanguage: book.language || "hi",
    author: { "@id": `${SITE.origin}/#person` },
    description: book.description,
    url: url(`/books/${book.slug}`),
    isAccessibleForFree: true,
    workExample: {
      "@type": "Book",
      bookFormat: "https://schema.org/EBook",
      inLanguage: book.language || "hi",
      isAccessibleForFree: true,
      url: readUrl,
      potentialAction: { "@type": "ReadAction", target: readUrl },
    },
  };

  if (book.cover) ld.image = `${SITE.origin}/content/${book.slug}/${book.cover}`;
  if (book.published) ld.datePublished = String(book.published);
  if (book.stats && book.stats.words) ld.wordCount = book.stats.words;

  if (flagship) {
    Object.assign(ld, {
      alternateName: ["Do Kulhad Chai", "Do Kulhad Chai novel", "दो कुल्हड़ चाय उपन्यास"],
      genre: ["Fiction", "Literary fiction", "Hindi literature", "हिन्दी उपन्यास"],
      bookEdition: "First",
      abstract: BOOK.premise,
      copyrightYear: 2026,
      copyrightHolder: { "@id": `${SITE.origin}/#person` },
      countryOfOrigin: { "@type": "Country", name: "India" },
      about: BOOK.themes.map((t) => t.t),
      character: BOOK.cast.map((c) => ({ "@type": "Person", name: c.name })),
      contentLocation: [
        { "@type": "Place", name: "New Delhi Railway Station" },
        { "@type": "Place", name: "Kanpur" },
        { "@type": "Place", name: "Lucknow" },
        { "@type": "Place", name: "Bengaluru" },
        { "@type": "Place", name: "Varanasi (Banaras)" },
      ],
    });
  }
  return ld;
};

/* Answer-engine fuel: short, direct Q&A in the exact shape people ask. */
export const FAQ = [
  {
    q: "Who is Vinay Kumar Tiwari?",
    a: "Vinay Kumar Tiwari (also written Vinay Tiwari, विनय कुमार तिवारी) is a Hindi author from Ghazipur, Uttar Pradesh, now based in Noida. His debut novel is दो कुल्हड़ चाय (Do Kulhad Chai). By day he builds software systems; by night he writes about the people life left something unsaid with.",
  },
  {
    q: "दो कुल्हड़ चाय उपन्यास किसके बारे में है?",
    a: "दो कुल्हड़ चाय विनय कुमार तिवारी का पहला हिन्दी उपन्यास है। 12 जुलाई 2015 की रात शिवगंगा एक्सप्रेस कानपुर आउटर पर साढ़े चार घंटे लाल सिग्नल के सामने रुकी रह जाती है। सीट 33 पर लेखक विवान है, सीट 36 पर फ़ोटोग्राफ़र प्राची। दोनों पूरी रात बात करते हैं और नाम सबसे आख़िर में पूछते हैं। आगे चलकर उनके बीच एक वादा बनता है — हर महीने की बारह तारीख़, उसी ट्रेन में, दो कुल्हड़ चाय। किताब की पहली पंक्तियाँ ही बताती हैं कि एक आदमी हर बार दो टिकट लेता है और अकेला सफ़र करता है; और किताब यह बताने के लिए लिखी गई है कि दूसरा टिकट किसका है।",
  },
  {
    q: "Who wrote Do Kulhad Chai?",
    a: "Do Kulhad Chai (दो कुल्हड़ चाय) is written by Vinay Kumar Tiwari. It is his debut Hindi novel, copyright filed with the Copyright Office, Government of India (Diary No. LD-36102/2026-CO).",
  },
  {
    q: "दो कुल्हड़ चाय कहाँ पढ़ें?",
    a: "पूरा उपन्यास vinaytiwari.org पर ऑनलाइन पढ़ा जा सकता है — फ़ोन, टैबलेट और कंप्यूटर पर, पन्ने पलटकर या स्क्रॉल करके। रीडर ई-रीडर जैसा है: अपनी पसंद का रंग और अक्षर, और जहाँ छोड़ा था वहीं से आगे।",
  },
  {
    q: "How can I read Do Kulhad Chai online?",
    a: "The full Hindi novel can be read in the browser at vinaytiwari.org/read/do-kulhad-chai — on phone, tablet or desktop, with adjustable type, themes and an e-reader style page-turning mode that remembers where you stopped.",
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

const webPageLd = (meta, type = "WebPage") => ({
  "@type": type,
  "@id": `${url(meta.path)}#webpage`,
  url: url(meta.path),
  name: meta.title,
  description: meta.description,
  inLanguage: meta.lang === "hi" ? "hi-IN" : "en-IN",
  isPartOf: { "@id": `${SITE.origin}/#website` },
  about: { "@id": `${SITE.origin}/#person` },
  primaryImageOfPage: meta.image || `${SITE.origin}${SITE.ogImage}`,
});

/**
 * Full @graph. `book` is required for the "book" key; on the home page it is
 * the catalogue entry for the flagship novel (for its date and cover).
 */
export function graphFor(key, book) {
  const base = [personLd(), websiteLd()];

  if (key === "home") {
    return [
      ...base,
      webPageLd(PAGES.home, "ProfilePage"),
      bookLd({ ...BOOK, description: BOOK.logline, language: "hi", ...(book || {}) }),
      faqLd(),
      breadcrumbLd([{ name: "Home", path: "/" }]),
    ];
  }

  if (key === "library") {
    return [
      ...base,
      webPageLd(PAGES.library, "CollectionPage"),
      breadcrumbLd([
        { name: "Home", path: "/" },
        { name: "किताबघर", path: "/library" },
      ]),
    ];
  }

  if (key === "book" && book) {
    const meta = bookMeta(book);
    return [
      ...base,
      webPageLd(meta),
      bookLd(book),
      breadcrumbLd([
        { name: "Home", path: "/" },
        { name: "किताबघर", path: "/library" },
        { name: book.title, path: meta.path },
      ]),
    ];
  }

  return base;
}
