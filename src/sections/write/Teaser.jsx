// src/sections/write/Teaser.jsx
// The back-cover moment.
//
// Three short beats land one after another, the question follows, and then
// the invitation. It sits after the themes because by that point the reader
// knows the voice — this is the line that asks them to commit.

import React from "react";
import { motion } from "framer-motion";
import { Reveal, Magnetic, Arrow, EASE } from "../../components/ui/motion";
import { scrollToId } from "../../hooks/useSmoothScroll";
import Kulhad from "../../components/site/Kulhad";
import { BOOK } from "../../data/books";

const T = BOOK.teaser;

export default function Teaser() {
  return (
    <section className="tz" id="teaser">
      <span className="tz__glow" aria-hidden="true" />

      <div className="shell shell--narrow tz__inner">
        {/* three beats, struck one at a time */}
        <p className="tz__beats">
          {T.beats.map((b, i) => (
            <motion.span
              className="tz__beat"
              key={b}
              initial={{ opacity: 0, y: 22, filter: "blur(6px)" }}
              whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              viewport={{ once: true, amount: 0.6 }}
              transition={{ duration: 0.8, delay: i * 0.28, ease: EASE }}
            >
              {b}
            </motion.span>
          ))}
        </p>

        <Reveal delay={0.9} y={24}>
          <p className="tz__q">{T.question}</p>
        </Reveal>

        <Reveal delay={1.05} y={20}>
          <div className="tz__cups" aria-hidden="true">
            <Kulhad size={54} steamColor="#f3d9b5" steamOpacity={0.42} />
            <Kulhad size={44} steamColor="#f3d9b5" steamOpacity={0.3} />
          </div>
        </Reveal>

        <Reveal delay={1.15} y={20}>
          <p className="tz__cta">
            {T.cta} — <strong>{T.ctaBook}</strong>
          </p>
          <p className="tz__by">{T.by}</p>
        </Reveal>

        <Reveal delay={1.3} className="tz__actions">
          <Magnetic>
            <button
              className="btn btn--lg tz__btn"
              onClick={() => scrollToId("opening", 62)}
              data-cursor="पढ़िए"
            >
              पहला पन्ना पढ़िए
              <Arrow />
            </button>
          </Magnetic>
        </Reveal>
      </div>
    </section>
  );
}
