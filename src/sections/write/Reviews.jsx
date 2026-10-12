// src/sections/write/Reviews.jsx
// The home page's place for readers' ratings and comments.

import React from "react";
import { Reveal, MaskLine } from "../../components/ui/motion";
import { ReviewsSection } from "../../reviews/Reviews";
import { BOOK } from "../../data/books";

const BOOK_STUB = { slug: BOOK.slug, title: BOOK.title, author: BOOK.byline };

export default function Reviews() {
  return (
    <section className="section reviews" id="reviews">
      <div className="shell">
        <Reveal>
          <span className="eyebrow is-hi">पाठकों की राय</span>
        </Reveal>
        <h2 className="h-display h-hi title-md" style={{ marginTop: 16 }}>
          <MaskLine>पढ़कर बताइए,</MaskLine>
          <MaskLine delay={0.08}>
            <span className="ital">आपको कैसी लगी?</span>
          </MaskLine>
        </h2>
        <ReviewsSection book={BOOK_STUB} />
      </div>
    </section>
  );
}
