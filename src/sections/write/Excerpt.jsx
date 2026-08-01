// src/sections/write/Excerpt.jsx
// The closing movement of the novel — chapters 55, 56, 57 and the last one.
// Left rail selects, right pane cross-fades. Content lives in data/books.js.

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Reveal, MaskLine, EASE } from "../../components/ui/motion";
import { CHAPTERS } from "../../data/books";

function Passage({ p, i }) {
  const common = {
    initial: { opacity: 0, y: 22 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, amount: 0.2 },
    transition: { duration: 0.8, delay: Math.min(i * 0.04, 0.3), ease: EASE },
  };

  if (p.kind === "letter") {
    return (
      <motion.div className="chap__letter" {...common}>
        <span className="chap__letterWho">{p.who}</span>
        <div className="chap__letterBody">{p.t}</div>
      </motion.div>
    );
  }

  if (p.kind === "end") {
    return (
      <motion.div className="chap__end" {...common}>
        ❖ {p.t} ❖
      </motion.div>
    );
  }

  const cls =
    p.kind === "hi"
      ? "chap__p chap__p--hi"
      : p.kind === "note"
      ? "chap__p chap__p--note"
      : "chap__p";

  return (
    <motion.p className={cls} {...common}>
      {p.t}
    </motion.p>
  );
}

export default function Excerpt() {
  const [i, setI] = useState(0);
  const ch = CHAPTERS[i];

  return (
    <section className="section" id="excerpt">
      <div className="shell">
        <div className="sec-head">
          <div>
            <Reveal>
              <span className="eyebrow">अंश · Excerpt</span>
            </Reveal>
            <h2 className="h-display title-lg">
              <MaskLine>आख़िरी चार</MaskLine>
              <MaskLine delay={0.08}>
                <span className="ital">अध्याय</span>
              </MaskLine>
            </h2>
          </div>
          <Reveal delay={0.16}>
            <p className="sec-head__note hi">
              उपन्यास का आख़िरी हिस्सा — पहली अकेली बारह तारीख़ से लेकर उस रात
              तक, जब सैंतीस नंबर सीट ख़ाली नहीं गई।
            </p>
          </Reveal>
        </div>

        <div className="chaps">
          <nav className="chaps__nav" aria-label="Chapters">
            {CHAPTERS.map((c, ci) => (
              <button
                key={c.no}
                className={`chaps__btn ${ci === i ? "is-on" : ""}`}
                onClick={() => setI(ci)}
                aria-current={ci === i}
              >
                <span className="chaps__no">{c.no}</span>
                <span className="chaps__t">{c.title}</span>
              </button>
            ))}
          </nav>

          <AnimatePresence mode="wait">
            <motion.article
              className="chap"
              key={ch.no}
              initial={{ opacity: 0, y: 26 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -14 }}
              transition={{ duration: 0.6, ease: EASE }}
            >
              <div className="chap__stamp">{ch.stamp}</div>
              <h3 className="chap__no">{ch.no}</h3>
              <div className="chap__t">{ch.title}</div>

              <div className="chap__orn" aria-hidden="true">
                ❖
              </div>

              <p className="chap__teaser">{ch.teaser}</p>

              <div className="chap__orn" aria-hidden="true">
                ◆ ◆ ◆
              </div>

              <div className="chap__body">
                {ch.passages.map((p, pi) => (
                  <Passage p={p} i={pi} key={`${ch.no}-${pi}`} />
                ))}
              </div>
            </motion.article>
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
