// src/sections/write/Themes.jsx
import React from "react";
import { motion } from "framer-motion";
import {
  Reveal,
  MaskLine,
  Stagger,
  riseItem,
} from "../../components/ui/motion";
import { BOOK } from "../../data/books";

export default function Themes() {
  return (
    <section className="section section--alt th" id="themes">
      <div className="shell">
        <div className="sec-head">
          <div>
            <Reveal>
              <span className="eyebrow is-hi">विषय</span>
            </Reveal>
            <h2 className="h-display h-hi title-md">
              <MaskLine>यह किताब</MaskLine>
              <MaskLine delay={0.08}>
                <span className="ital">असल में किस बारे में है</span>
              </MaskLine>
            </h2>
          </div>
          <Reveal delay={0.16}>
            <p className="sec-head__note hi">छह बातें, जिनके इर्द-गिर्द यह कहानी घूमती है।</p>
          </Reveal>
        </div>

        <Stagger className="themes" stagger={0.07}>
          {BOOK.themes.map((t) => (
            <motion.div className="themes__cell" key={t.n} variants={riseItem}>
              <div className="themes__n">{t.n}</div>
              <div className="themes__t">{t.t}</div>
              <p className="themes__d hi">{t.d}</p>
            </motion.div>
          ))}
        </Stagger>

      </div>
    </section>
  );
}
