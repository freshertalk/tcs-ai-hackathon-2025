// src/sections/write/Novel.jsx
// About the novel — what the hero says in a breath, said in full: the night
// the book begins on, the four people on the train, and the three lines that
// stand before page one (the first page itself follows this section).
//
// The book's length, language and date are in the hero's facts row, so they
// are not repeated here.

import React from "react";
import { motion } from "framer-motion";
import { Reveal, MaskLine, Stagger, riseItem } from "../../components/ui/motion";
import { BOOK } from "../../data/books";

export default function Novel() {
  return (
    <>
      <section className="section novel" id="novel">
        <div className="shell">
          <div className="novel__about">
            <div className="novel__lead">
              <Reveal>
                <span className="eyebrow is-hi">उपन्यास के बारे में</span>
              </Reveal>
              <h2 className="h-display h-hi title-lg novel__title2">
                <MaskLine>एक रात।</MaskLine>
                <MaskLine delay={0.08}>
                  <span className="ital">ग्यारह साल।</span>
                </MaskLine>
              </h2>
              <Reveal delay={0.14}>
                <p className="novel__route hi">{BOOK.route}</p>
              </Reveal>
            </div>

            <div>
              <Reveal delay={0.1}>
                <p className="novel__logline">{BOOK.premise}</p>
              </Reveal>
              <Reveal delay={0.16}>
                <p className="novel__premise">{BOOK.closing}</p>
              </Reveal>
            </div>
          </div>

          {/* ------------------------------------------------------- cast */}
          <Reveal className="novel__castHead">
            <span className="eyebrow is-hi">किरदार</span>
            <h3 className="h-display h-hi title-md">चार लोग, एक डिब्बा</h3>
          </Reveal>

          <Stagger className="cast" stagger={0.08}>
            {BOOK.cast.map((c) => (
              <motion.div className="cast__card" key={c.name} variants={riseItem}>
                <span className="cast__seat is-hi">{c.seat}</span>
                <div className="cast__name">{c.name}</div>
                <p className="cast__line">{c.line}</p>
              </motion.div>
            ))}
          </Stagger>
        </div>
      </section>

      {/* --------------------------------------------- the three epigraphs */}
      <section className="qband">
        <div className="shell">
          <Reveal>
            <span className="qband__kicker">पहले पन्ने से पहले</span>
          </Reveal>
          <div className="qband__grid">
            {BOOK.epigraphs.map((e, i) => (
              <Reveal key={e.slice(0, 18)} delay={i * 0.12} y={26}>
                <p className="qband__q">{e}</p>
              </Reveal>
            ))}
          </div>
          <Reveal delay={0.4}>
            <p className="qband__from">— {BOOK.byline} ({BOOK.title})</p>
          </Reveal>
        </div>
      </section>
    </>
  );
}
