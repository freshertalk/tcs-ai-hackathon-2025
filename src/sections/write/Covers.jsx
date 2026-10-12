// src/sections/write/Covers.jsx
// आवरण — both covers, side by side, large. The hero lets you turn the book
// over; this is the one place the two faces are simply laid out together, the
// way a bookshop shows a new title.

import React from "react";
import { Reveal, MaskLine } from "../../components/ui/motion";
import { Cover } from "../../library/BookCard";
import { BackCover } from "../../library/BookShowcase";
import { zoomProps } from "../../library/CoverViewer";
import { useCatalog } from "../../library/hooks";
import { BOOK } from "../../data/books";

const FALLBACK = {
  slug: BOOK.slug,
  title: BOOK.title,
  author: BOOK.byline,
  language: "hi",
  cover: "cover.jpg",
  coverSmall: "cover-sm.jpg",
  description: BOOK.logline,
  published: "2026-10-16",
};

export default function Covers() {
  const { data } = useCatalog();
  const entry = data && data.books.find((b) => b.slug === BOOK.slug);
  // art only ever comes from the published catalogue — never from the fallback
  const book = entry ? { ...FALLBACK, ...entry, art: entry.art } : FALLBACK;

  return (
    <section className="section covers" id="covers">
      <div className="shell">
        <div className="covers__head">
          <Reveal>
            <span className="eyebrow is-hi">आवरण</span>
          </Reveal>
          <h2 className="h-display h-hi title-md covers__title">
            <MaskLine>किताब, आगे और पीछे</MaskLine>
          </h2>
        </div>

        <div className="covers__pair">
          <Reveal className="covers__item" y={30}>
            <div className="covers__face" {...zoomProps(book, "front")}>
              <Cover book={book} sizes="(max-width: 760px) 80vw, 420px" />
            </div>
            <p className="covers__cap">आगे का आवरण · बड़ा करने के लिए दबाइए</p>
          </Reveal>

          <Reveal className="covers__item" y={30} delay={0.12}>
            <div className="covers__face covers__face--back" {...zoomProps(book, "back")}>
              <BackCover book={book} />
            </div>
            <p className="covers__cap">पिछला आवरण · बड़ा करने के लिए दबाइए</p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
