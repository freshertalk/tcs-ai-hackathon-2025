// src/sections/write/Opening.jsx
// The novel's own first page, typeset as a page.
//
// This is the strongest thing the site can do: rather than describe the book,
// let the reader start it. The prologue asks a question and answers nothing,
// so it creates appetite without spending a single plot point.

import React from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Reveal, MaskLine, EASE } from "../../components/ui/motion";
import { IconEye } from "../../reader/icons";
import { OPENING, BOOK } from "../../data/books";

function Line({ l, i }) {
  const common = {
    initial: { opacity: 0, y: 18 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, amount: 0.35 },
    transition: { duration: 0.85, delay: Math.min(i * 0.05, 0.35), ease: EASE },
  };

  if (l.kind === "end") {
    return (
      <motion.p className="op__ask" {...common}>
        {l.t}
      </motion.p>
    );
  }

  const cls =
    l.kind === "hi" ? "op__p op__p--hi" : l.kind === "note" ? "op__p op__p--note" : "op__p";

  return (
    <motion.p className={cls} {...common}>
      {l.t}
    </motion.p>
  );
}

export default function Opening() {
  return (
    <section className="section op" id="opening">
      <div className="shell shell--narrow">
        <div className="op__head">
          <Reveal>
            <span className="eyebrow is-hi">{OPENING.kicker}</span>
          </Reveal>
          <h2 className="h-display h-hi title-md op__title">
            <MaskLine>कहानी यहाँ से शुरू होती है</MaskLine>
          </h2>
          <Reveal delay={0.14}>
            <p className="op__stamp">{OPENING.stamp}</p>
          </Reveal>
        </div>

        <div className="op__page">
          <span className="op__rule" aria-hidden="true">
            ❖
          </span>

          <div className="op__body">
            {OPENING.lines.map((l, i) => (
              <Line l={l} i={i} key={l.t.slice(0, 24)} />
            ))}
          </div>

          <Reveal delay={0.1} className="op__foot">
            <span className="op__footTitle">{BOOK.title}</span>
            <span className="op__footBy">— {BOOK.byline}</span>
          </Reveal>
        </div>

        <Reveal delay={0.12}>
          <p className="op__after">
            यहाँ से आगे साढ़े चार घंटे हैं, और उनके बाद ग्यारह साल।
            <span> वह सब किताब में है।</span>
          </p>
        </Reveal>

        <Reveal delay={0.18}>
          <p className="op__go">
            <Link className="btn btn--solid btn--lg" to={`/read/${BOOK.slug}`} data-cursor="पढ़िए">
              <IconEye width={20} height={20} />
              आगे की कहानी पढ़ें
            </Link>
          </p>
        </Reveal>
      </div>
    </section>
  );
}
