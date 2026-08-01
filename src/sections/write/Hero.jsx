// src/sections/write/Hero.jsx
import React, { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import {
  MaskLine,
  Reveal,
  Counter,
  Magnetic,
  Arrow,
} from "../../components/ui/motion";
import Kulhad from "../../components/site/Kulhad";
import { scrollToId } from "../../hooks/useSmoothScroll";
import { BOOK } from "../../data/books";

const STATS = [
  { to: 58, suffix: "", label: "अध्याय" },
  { to: 11, suffix: "", label: "साल का कालखंड" },
  { to: 142, suffix: "", label: "रिकॉर्डिंग्स · चेहरे" },
  { to: 2, suffix: "", label: "कुल्हड़ · हर बार" },
];

export default function Hero() {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });
  const y = useTransform(scrollYProgress, [0, 1], [0, 120]);
  const fade = useTransform(scrollYProgress, [0, 0.75], [1, 0]);

  return (
    <section className="hero" id="top" ref={ref}>
      <motion.div className="hero__wash" style={{ y }} aria-hidden="true" />
      <div className="hero__grid" aria-hidden="true" />

      <motion.div className="shell hero__inner" style={{ opacity: fade }}>
        {/* Single column with the cups pinned beside the title, so phone and
            desktop show the same arrangement rather than two different ones. */}
        <div className="whero">
          <div className="hero__col">
            <div className="hero__meta">
              <Reveal y={14}>
                <span className="pill is-hi">
                  <i />
                  {BOOK.status}
                </span>
              </Reveal>
              <Reveal y={14} delay={0.08}>
                <span className="pill is-hi">{BOOK.kind}</span>
              </Reveal>
              <Reveal y={14} delay={0.16}>
                <span className="pill is-hi">{BOOK.span}</span>
              </Reveal>
            </div>

            <div className="whero__row">
              <h1 className="hero__title hero__title--hi">
                <MaskLine delay={0.06}>दो कुल्हड़</MaskLine>
                <MaskLine delay={0.16}>
                  <span className="amp">चाय</span>
                </MaskLine>
              </h1>

              {/* दो कुल्हड़ — the title, literally */}
              <div className="write-hero__cups" aria-hidden="true">
                <motion.div
                  className="write-hero__cup write-hero__cup--a"
                  initial={{ opacity: 0, y: 34 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 1.2, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
                >
                  <Kulhad size={186} steamOpacity={0.5} />
                </motion.div>
                <motion.div
                  className="write-hero__cup write-hero__cup--b"
                  initial={{ opacity: 0, y: 34 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 1.2, delay: 0.62, ease: [0.16, 1, 0.3, 1] }}
                >
                  <Kulhad size={148} steamOpacity={0.38} />
                </motion.div>
              </div>
            </div>

            <Reveal delay={0.3}>
              <p className="hero__blurb hi" style={{ fontSize: "1.06rem" }}>
                {BOOK.logline}
              </p>
            </Reveal>

            <div className="hero__stats">
              {STATS.map((s, i) => (
                <Reveal key={s.label} delay={0.4 + i * 0.07} y={20}>
                  <div>
                    <div className="stat__n">
                      <Counter to={s.to} suffix={s.suffix} />
                    </div>
                    <div className="stat__l is-hi">
                      {s.label}
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>

            <Reveal delay={0.6} className="hero__actions">
              <Magnetic>
                <button
                  className="btn btn--solid btn--lg"
                  onClick={() => scrollToId("novel", 62)}
                  data-cursor="पढ़िए"
                >
                  उपन्यास के बारे में
                  <Arrow />
                </button>
              </Magnetic>
              <Magnetic>
                <button
                  className="btn btn--lg"
                  onClick={() => scrollToId("synopsis", 62)}
                >
                  कहानी
                </button>
              </Magnetic>
              <Magnetic>
                <button
                  className="btn btn--lg"
                  onClick={() => scrollToId("author", 62)}
                >
                  लेखक
                </button>
              </Magnetic>
            </Reveal>
          </div>
        </div>
      </motion.div>

      <div className="hero__scroll" aria-hidden="true">
        <span className="hero__rail" />
        नीचे
      </div>
    </section>
  );
}
