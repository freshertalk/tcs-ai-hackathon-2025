// src/pages/Library.jsx
// रचनाएँ — everything on the shelf, and a short note on how it reads.

import React, { useEffect } from "react";

import Nav from "../components/site/Nav";
import Footer from "../components/site/Footer";
import Seo from "../components/seo/Seo";
import { Reveal, MaskLine } from "../components/ui/motion";
import { BookCard } from "../library/BookCard";
import { useCatalog } from "../library/hooks";

export const SITE_LINKS = [
  { to: "/", label: "मुखपृष्ठ" },
  { to: "/library", label: "रचनाएँ" },
];

const HOW = [
  {
    k: "हर स्क्रीन पर",
    d: "फ़ोन, टैबलेट या कंप्यूटर — पाठ अपने आप स्क्रीन के हिसाब से ढल जाता है। बड़ी स्क्रीन पर खुली किताब की तरह दो पन्ने दिखते हैं।",
  },
  {
    k: "आपकी पसंद का",
    d: "अक्षर का आकार और शैली, रंग (काग़ज़, सेपिया, रात, काला), पंक्तियों की दूरी — सब आपके हाथ में। स्क्रॉल कीजिए या पन्ने पलटिए।",
  },
  {
    k: "आपकी जगह याद रखता है",
    d: "जहाँ छोड़ा था, किताब वहीं खुलेगी — किसी खाते या पासवर्ड के बिना। और खोज पूरी किताब में चलती है।",
  },
  {
    k: "सिर्फ़ पढ़ने के लिए",
    d: "किताबें इसी रीडर में पढ़ी जाती हैं। डाउनलोड या कॉपी का विकल्प नहीं है — लेखक की मेहनत लेखक के नाम रहे।",
  },
];

export default function Library() {
  const { data, error } = useCatalog();
  const books = data ? data.books : [];

  useEffect(() => {
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", "#faf4e9");
  }, []);

  return (
    <div data-theme="write">
      <Seo page="library" />
      <Nav
        links={SITE_LINKS}
        kicker="रचनाएँ"
        cta={{ href: "/read/do-kulhad-chai", label: "पढ़ना शुरू करें" }}
      />

      <main className="lib">
        <header className="shell lib__head">
          <Reveal>
            <span className="eyebrow is-hi">रचनाएँ</span>
          </Reveal>
          <h1 className="h-display h-hi title-lg lib__title">
            <MaskLine>किताबें, जो आपके साथ</MaskLine>
            <MaskLine delay={0.08}>
              <span className="ital">हर जगह चलती हैं।</span>
            </MaskLine>
          </h1>
          <Reveal delay={0.16}>
            <p className="lib__note hi">
              यहाँ विनय कुमार तिवारी की किताबें हैं — ऑनलाइन पढ़िए, किसी भी डिवाइस पर। कोई
              खाता नहीं, कोई विज्ञापन नहीं।
            </p>
          </Reveal>
        </header>

        <section className="shell lib__shelf" aria-label="किताबें">
          {error && <p className="lib__state">रचनाएँ अभी खुल नहीं पाईं। थोड़ी देर बाद फिर देखिए।</p>}
          {!error && !data && <p className="lib__state">किताबें आ रही हैं…</p>}
          {data && books.length === 0 && <p className="lib__state">रचनाएँ अभी ख़ाली हैं।</p>}

          {books.length > 0 && (
            <ul className={`lib__grid ${books.length === 1 ? "lib__grid--one" : ""}`}>
              {books.map((b) => (
                <li key={b.slug}>
                  <BookCard book={b} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="section section--alt lib__how">
          <div className="shell">
            <Reveal>
              <span className="eyebrow is-hi">पढ़ने का अनुभव</span>
            </Reveal>
            <ul className="lib__howGrid">
              {HOW.map((h, i) => (
                <Reveal as="li" key={h.k} delay={i * 0.06} y={24}>
                  <h2 className="lib__howK hi-d">{h.k}</h2>
                  <p className="lib__howD hi">{h.d}</p>
                </Reveal>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <Footer note="दो कुल्हड़ चाय · रचनाएँ" />
    </div>
  );
}
