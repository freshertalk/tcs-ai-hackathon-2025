// src/pages/Library.jsx
// रचनाएँ — the shelf.
//
//   1. a short header
//   2. each book as one feature card: the cover on a warm clay stage (so a
//      dark cover stands out), and beside it what a reader weighs before buying —
//      what it is, a line from it, its facts, its price, and how to get it
//   3. how the reader feels to use, in four points
//   4. who wrote it
//
// Built for one book today and for several: the cards stack, and a search box
// appears only once there are enough books to need one.

import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import Nav from "../components/site/Nav";
import Footer from "../components/site/Footer";
import Seo from "../components/seo/Seo";
import Picture from "../components/ui/Picture";
import { Reveal } from "../components/ui/motion";
import { Cover, percentRead } from "../library/BookCard";
import { useCatalog, useProgress } from "../library/hooks";
import { fmtDate, fmtMinutes } from "../reader/util";
import Price from "../library/Price";
import BuyBar from "../shop/BuyBar";
import { RatingChip } from "../reviews/Reviews";
import { AUTHOR, BOOK } from "../data/books";
import { IconBookmark, IconDashboard, IconEye, IconLock } from "../components/ui/icons";

export const SITE_LINKS = [
  { to: "/", label: "मुखपृष्ठ" },
  { to: "/library", label: "रचनाएँ" },
];

const LANGS = { hi: "हिन्दी", en: "English", bho: "भोजपुरी", ur: "اردو" };

const HOW = [
  {
    Icon: IconDashboard,
    k: "हर स्क्रीन पर",
    d: "फ़ोन, टैबलेट या कंप्यूटर — पाठ अपने आप स्क्रीन के हिसाब से ढल जाता है। बड़ी स्क्रीन पर खुली किताब की तरह दो पन्ने दिखते हैं।",
  },
  {
    Icon: IconEye,
    k: "आपकी पसंद का",
    d: "अक्षर का आकार और शैली, रंग (काग़ज़, सेपिया, रात, काला), पंक्तियों की दूरी — सब आपके हाथ में। स्क्रॉल कीजिए या पन्ने पलटिए।",
  },
  {
    Icon: IconBookmark,
    k: "आपकी जगह याद रखता है",
    d: "जहाँ छोड़ा था, किताब वहीं खुलेगी — हर डिवाइस पर, एक बार साइन इन करने के बाद। और खोज पूरी किताब में चलती है।",
  },
  {
    Icon: IconLock,
    k: "सिर्फ़ पढ़ने के लिए",
    d: "किताबें इसी रीडर में पढ़ी जाती हैं। डाउनलोड या कॉपी का विकल्प नहीं है — लेखक की मेहनत लेखक के नाम रहे।",
  },
];

/** One book, as a feature card. */
function BookRow({ book }) {
  const progress = useProgress(book.slug);
  const pct = percentRead(progress);
  const href = `/books/${book.slug}`;
  const ours = book.slug === BOOK.slug;
  const line = ours && BOOK.highlight && BOOK.highlight.lines ? BOOK.highlight.lines[0] : "";
  const isbn = ours ? ((BOOK.facts || []).find((f) => f.k === "ISBN") || {}).v || "" : "";

  const facts = [
    { k: "भाषा", v: LANGS[book.language] || book.language },
    { k: "अध्याय", v: String(book.chapters) },
    { k: "पढ़ने का समय", v: fmtMinutes(book.minutes) },
    { k: "प्रकाशन", v: fmtDate(book.published) },
    { k: "ISBN", v: isbn || "—" },
  ];

  return (
    <article className="lbk">
      <div className="lbk__stage">
        <i className="lbk__rain" aria-hidden="true" />
        <i className="lbk__glow" aria-hidden="true" />
        <Link to={href} className="lbk__cover" aria-label={`${book.title} — विवरण`}>
          <Cover book={book} eager sizes="(max-width: 700px) 60vw, 300px" />
        </Link>
      </div>

      <div className="lbk__body">
        <p className="lbk__kicker">{LANGS[book.language] || book.language} · उपन्यास</p>
        <h2 className="lbk__title hi-d">
          <Link to={href}>{book.title}</Link>
        </h2>
        <p className="lbk__by">
          <span>लेखक:</span> {book.author}
          <RatingChip slug={book.slug} compact className="lbk__rate" />
        </p>

        <p className="lbk__desc hi">{book.description}</p>

        {line ? <blockquote className="lbk__quote hi">{line}</blockquote> : null}

        <dl className="lbk__facts">
          {facts.map((f) => (
            <div key={f.k}>
              <dt>{f.k}</dt>
              <dd>{f.v}</dd>
            </div>
          ))}
        </dl>

        <div className="lbk__buy">
          <Price slug={book.slug} className="lbk__price" />
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
          </div>
        </div>

        <p className="lbk__links">
          {ours ? <a href="/#opening">पहला पन्ना पढ़िए</a> : null}
          <Link to={href}>
            पूरा विवरण और अनुक्रम <i aria-hidden="true">→</i>
          </Link>
        </p>

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
        </section>

        <section className="lib2__how">
          <div className="shell lib2__howWrap">
            <div className="lib2__howHead">
              <span className="eyebrow is-hi">पढ़ने का अनुभव</span>
              <h2 className="lib2__howT hi-d">पढ़ना, जैसा किताब में होता है</h2>
              <p className="hi">एक शांत रीडर — जो आपकी स्क्रीन, आपकी आँखों और आपकी रफ़्तार के हिसाब से चलता है।</p>
            </div>
            <ul className="lib2__howGrid">
              {HOW.map(({ Icon, k, d }) => (
                <li key={k}>
                  <span className="lib2__howIco">
                    <Icon size={19} />
                  </span>
                  <div>
                    <h3 className="lib__howK hi-d">{k}</h3>
                    <p className="lib__howD hi">{d}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="shell lib2__author" aria-label="लेखक">
          <span className="lib2__avatar">
            <Picture name="vinay-avatar-sm" alt="" width="200" height="200" loading="lazy" aria-hidden="true" />
          </span>
          <div>
            <p className="lib2__authorK">लेखक</p>
            <p className="hi">
              <b>{AUTHOR.name}</b> — {AUTHOR.brief}
            </p>
          </div>
          <a className="lbk__more" href="/#author">
            पूरा परिचय <i aria-hidden="true">→</i>
          </a>
        </section>
      </main>

      <Footer note="दो कुल्हड़ चाय · रचनाएँ" />
    </div>
  );
}
