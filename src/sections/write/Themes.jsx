// src/sections/write/Themes.jsx
import React from "react";
import { motion } from "framer-motion";
import {
  Reveal,
  MaskLine,
  Stagger,
  riseItem,
} from "../../components/ui/motion";
import { BOOK, OTHER_WRITING } from "../../data/books";

export default function Themes() {
  return (
    <section className="section section--alt" id="themes">
      <div className="shell">
        <div className="sec-head">
          <div>
            <Reveal>
              <span className="eyebrow is-hi">विषय · Themes</span>
            </Reveal>
            <h2 className="h-display title-lg">
              <MaskLine>What the book</MaskLine>
              <MaskLine delay={0.08}>
                <span className="ital">is really about</span>
              </MaskLine>
            </h2>
          </div>
          <Reveal delay={0.16}>
            <p className="sec-head__note hi">{BOOK.closing}</p>
          </Reveal>
        </div>

        <Stagger className="themes" stagger={0.07}>
          {BOOK.themes.map((t) => (
            <motion.div className="themes__cell" key={t.n} variants={riseItem}>
              <div className="themes__n">{t.n}</div>
              <div className="themes__t">{t.t}</div>
              <p className="themes__d">{t.d}</p>
            </motion.div>
          ))}
        </Stagger>

        {/* ------------------------------------------------ other writing */}
        <Reveal style={{ marginTop: "clamp(52px, 7vw, 96px)" }}>
          <span className="eyebrow is-hi">और भी</span>
          <h3 className="h-display title-md" style={{ marginTop: 14 }}>
            Also on the desk
          </h3>
        </Reveal>

        <Stagger className="ow" stagger={0.08} style={{ marginTop: 28 }}>
          {OTHER_WRITING.map((w) => (
            <motion.article className="ow__card" key={w.title} variants={riseItem}>
              <span className="ow__k">{w.kind}</span>
              <h4 className="ow__t">{w.title}</h4>
              <p className="ow__d">{w.d}</p>
            </motion.article>
          ))}
        </Stagger>
      </div>
    </section>
  );
}
