// src/pages/Library.jsx
// रचनाएँ — the shelf. One quiet header, each book as a single product card
// (cover, what it is, its price, how to get it), and a short note on how it
// reads. Built for one book today and for several: the cards stack, and a
// search box appears only once there are enough books to need one.

import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import Nav from "../components/site/Nav";
import Footer from "../components/site/Footer";
import Seo from "../components/seo/Seo";
import { Reveal } from "../components/ui/motion";
import { Cover, percentRead } from "../library/BookCard";
import { useCatalog, useProgress } from "../library/hooks";
import { fmtDate, fmtMinutes } from "../reader/util";
import Price from "../library/Price";
import BuyBar from "../shop/BuyBar";
import { RatingChip } from "../reviews/Reviews";
import { IconBook, IconCard, IconLock, IconMail } from "../components/ui/icons";

export const SITE_LINKS = [
  { to: "/", label: "मुखपृष्ठ" },
  { to: "/library", label: "रचनाएँ" },
];

const LANGS = { hi: "हिन्दी", en: "English", bho: "भोजपुरी", ur: "اردو" };

const PROMISES = [
  { Icon: IconCard, t: "एक बार का भुगतान", d: "कोई सब्सक्रिप्शन नहीं" },
  { Icon: IconBook, t: "हमेशा आपकी", d: "खरीदने के बाद आगे कोई शुल्क नहीं" },
  { Icon: IconMail, t: "रसीद ई-मेल पर", d: "भुगतान होते ही, अपने-आप" },
  { Icon: IconLock, t: "सुरक्षित भुगतान", d: "UPI, कार्ड, नेट-बैंकिंग" },
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
    d: "जहाँ छोड़ा था, किताब वहीं खुलेगी — हर डिवाइस पर, एक बार साइन इन करने के बाद। और खोज पूरी किताब में चलती है।",
  },
  {
    k: "सिर्फ़ पढ़ने के लिए",
    d: "किताबें इसी रीडर में पढ़ी जाती हैं। डाउनलोड या कॉपी का विकल्प नहीं है — लेखक की मेहनत लेखक के नाम रहे।",
  },
];

/** One book, as a single card. */
function BookRow({ book }) {
  const progress = useProgress(book.slug);
  const pct = percentRead(progress);
  const href = `/books/${book.slug}`;

  return (
    <article className="lbk">
      <Link to={href} className="lbk__cover" aria-label={`${book.title} — विवरण`}>
        <Cover book={book} eager sizes="(max-width: 700px) 62vw, 280px" />
      </Link>

      <div className="lbk__body">
        <p className="lbk__kicker">
          {LANGS[book.language] || book.language} · उपन्यास
        </p>
        <h2 className="lbk__title hi-d">
          <Link to={href}>{book.title}</Link>
        </h2>
        <p className="lbk__by">
          <span>लेखक:</span> {book.author}
        </p>

        <ul className="lbk__facts" aria-label="किताब के बारे में">
          <li>{book.chapters} अध्याय</li>
          <li>{fmtMinutes(book.minutes)}</li>
          <li>{fmtDate(book.published)}</li>
        </ul>

        <p className="lbk__desc hi">{book.description}</p>

        <div className="lbk__buy">
          <Price slug={book.slug} className="lbk__price" />
          <RatingChip slug={book.slug} compact />
        </div>

        <div className="lbk__act">
          <span className="bh__buy">
            <BuyBar
              book={book}
              slug={book.slug}
              readClass="btn btn--solid bh__read"
              buyClass="btn btn--solid bh__read"
              cartClass="bh__cart"
            />
          </span>
          <Link className="lbk__more" to={href}>
            पूरा विवरण <i aria-hidden="true">→</i>
          </Link>
        </div>

        {pct > 0 && (
          <div className="lbk__prog" role="img" aria-label={`${pct} प्रतिशत पढ़ा गया`}>
            <i style={{ width: `${pct}%` }} />
            <span>{pct}% पढ़ा</span>
          </div>
        )}
      </div>
    </article>
  );
}

export default function Library() {
  const { data, error } = useCatalog();
  const all = useMemo(() => (data ? data.books : []), [data]);
  const [q, setQ] = useState("");

  useEffect(() => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#faf4e9");
  }, []);

  const books = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return all;
    return all.filter((b) => `${b.title} ${b.author} ${b.description}`.toLowerCase().includes(t));
  }, [all, q]);

  return (
    <div data-theme="write">
      <Seo page="library" />
      <Nav links={SITE_LINKS} kicker="रचनाएँ" cta={{ href: "/read/do-kulhad-chai", label: "पढ़ना शुरू करें" }} />

      <main className="lib lib2">
        <header className="shell lib2__head">
          <Reveal>
            <span className="eyebrow is-hi">रचनाएँ</span>
          </Reveal>
          <Reveal delay={0.05}>
            <h1 className="lib2__title hi-d">
              किताबें, जो आपके साथ <span>हर जगह चलती हैं।</span>
            </h1>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="lib2__note hi">
              यहाँ विनय कुमार तिवारी की किताबें हैं — पन्ना-दर-पन्ना, किसी भी स्क्रीन पर। न विज्ञापन, न शोर; बस आप और कहानी।
            </p>
          </Reveal>
        </header>

        <section className="shell lib2__shelf" aria-label="किताबें">
          {all.length > 3 && (
            <label className="lib2__search">
              <span className="sr-only">किताब खोजिए</span>
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="किताब या लेखक का नाम" />
            </label>
          )}

          {error && <p className="lib__state">रचनाएँ अभी खुल नहीं पाईं। थोड़ी देर बाद फिर देखिए।</p>}
          {!error && !data && <p className="lib__state">किताबें आ रही हैं…</p>}
          {data && all.length === 0 && <p className="lib__state">रचनाएँ अभी ख़ाली हैं।</p>}
          {data && all.length > 0 && books.length === 0 && <p className="lib__state">इस नाम की कोई किताब नहीं मिली।</p>}

          {books.length > 0 && (
            <ul className="lib2__list">
              {books.map((b) => (
                <li key={b.slug}>
                  <BookRow book={b} />
                </li>
              ))}
            </ul>
          )}

          <ul className="lib2__promise" aria-label="खरीद का तरीक़ा">
            {PROMISES.map(({ Icon, t, d }) => (
              <li key={t}>
                <span className="lib2__ico">
                  <Icon size={18} />
                </span>
                <span>
                  <b className="hi-d">{t}</b>
                  <small className="hi">{d}</small>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="lib2__how">
          <div className="shell">
            <Reveal>
              <span className="eyebrow is-hi">पढ़ने का अनुभव</span>
            </Reveal>
            <ul className="lib2__howGrid">
              {HOW.map((h, i) => (
                <Reveal as="li" key={h.k} delay={i * 0.05} y={18}>
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
