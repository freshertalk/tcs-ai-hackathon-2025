// src/sections/Hero.jsx
// Two real grid columns — copy on the left, portrait on the right — so no
// text ever ends up sitting on top of the photograph.

import React, { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import {
  MaskLine,
  SplitWords,
  Counter,
  Magnetic,
  Arrow,
  Reveal,
} from "../components/ui/motion";
import Picture from "../components/ui/Picture";
import { scrollToId } from "../hooks/useSmoothScroll";
import { PROFILE, YEARS } from "../data/profile";
import { AUTHOR } from "../data/author";

const STATS = [
  { to: YEARS, suffix: "+", label: "Years of experience" },
  { to: 9, suffix: "", label: "Initiatives led" },
  { to: 12, suffix: "+", label: "Programmes delivered" },
  { to: 2, suffix: "", label: "SAP certifications" },
];

export default function Hero() {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });
  const y = useTransform(scrollYProgress, [0, 1], [0, 130]);
  const fade = useTransform(scrollYProgress, [0, 0.75], [1, 0]);

  return (
    <section className="hero" id="top" ref={ref}>
      <motion.div className="hero__wash" style={{ y }} aria-hidden="true" />
      <div className="hero__grid" aria-hidden="true" />

      <motion.div className="shell hero__inner" style={{ opacity: fade }}>
        <div className="hero__layout">
          {/* ------------------------------------------------- copy column */}
          <div className="hero__col">
            <div className="hero__meta">
              <Reveal y={14}>
                <span className="pill">
                  <i />
                  Open to architecture roles
                </span>
              </Reveal>
              <Reveal y={14} delay={0.08}>
                <span className="pill">{PROFILE.designation}</span>
              </Reveal>
              <Reveal y={14} delay={0.16}>
                <span className="pill">{PROFILE.company}</span>
              </Reveal>
            </div>

            {/* On phones the portrait sits beside the name instead of in its
                own column. */}
            <div className="thero__row">
              <h1 className="hero__title">
                <MaskLine delay={0.06}>Vinay Kumar</MaskLine>
                <MaskLine delay={0.15}>
                  <span className="amp thero__word">Tiwari</span>
                </MaskLine>
              </h1>

              <motion.div
                className="hero__portrait hero__portrait--inline"
                initial={{ opacity: 0, clipPath: "inset(100% 0 0 0)" }}
                animate={{ opacity: 1, clipPath: "inset(0% 0 0 0)" }}
                transition={{ duration: 1.2, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
              >
                <Picture
                  name="vinay-portrait"
                  smallName="vinay-portrait-sm"
                  sizes="180px"
                  alt="Vinay Kumar Tiwari — SAP BTP Solution Architect and Hindi author"
                  width="1000"
                  height="1250"
                  loading="eager"
                />
              </motion.div>
            </div>

            <Reveal y={14} delay={0.24}>
              <p className="hero__role">
                <span>SAP BTP Solution Architect</span>
                <i aria-hidden="true" />
                <span>Hindi author</span>
                <i aria-hidden="true" />
                <span>Founder, BTP Learning Hub</span>
              </p>
            </Reveal>

            <p className="hero__blurb">
              <SplitWords
                text="Raised in Ghazipur, working from Noida. By day I architect cloud-native SAP systems where every mistake is caught; by night I write Hindi fiction about the ones where nothing can be put right."
                stagger={0.022}
                delay={0.3}
              />
            </p>

            <Reveal y={14} delay={0.36}>
              <p className="hero__motto" lang="hi">
                {AUTHOR.motto}
              </p>
            </Reveal>

            <div className="hero__stats">
              {STATS.map((s, i) => (
                <Reveal key={s.label} delay={0.4 + i * 0.07} y={20}>
                  <div>
                    <div className="stat__n">
                      <Counter to={s.to} suffix={s.suffix} />
                    </div>
                    <div className="stat__l">{s.label}</div>
                  </div>
                </Reveal>
              ))}
            </div>

            <Reveal delay={0.6} className="hero__actions">
              <Magnetic>
                <a
                  className="btn btn--solid btn--lg"
                  href="#work"
                  onClick={(e) => {
                    e.preventDefault();
                    scrollToId("work", 62);
                  }}
                >
                  My work
                  <Arrow />
                </a>
              </Magnetic>
              <Magnetic>
                <a
                  className="btn btn--lg"
                  href="#writer"
                  onClick={(e) => {
                    e.preventDefault();
                    scrollToId("writer", 62);
                  }}
                >
                  The writer
                </a>
              </Magnetic>
              <Magnetic>
                <a
                  className="btn btn--lg"
                  href={`${process.env.PUBLIC_URL}/Vinay-Kumar-Tiwari-Resume.docx`}
                  download
                >
                  Resume
                  <Arrow />
                </a>
              </Magnetic>
            </Reveal>
          </div>

          {/* ------------------------- portrait column (wide screens only) */}
          <motion.div
            className="hero__portrait hero__portrait--col"
            initial={{ opacity: 0, clipPath: "inset(100% 0 0 0)" }}
            animate={{ opacity: 1, clipPath: "inset(0% 0 0 0)" }}
            transition={{ duration: 1.3, delay: 0.45, ease: [0.16, 1, 0.3, 1] }}
          >
            <Picture
              name="vinay-portrait"
              smallName="vinay-portrait-sm"
              sizes="(max-width: 1100px) 0px, 400px"
              alt="Vinay Kumar Tiwari — SAP BTP Solution Architect and Hindi author"
              width="1000"
              height="1250"
              loading="eager"
              fetchPriority="high"
            />
            <span className="hero__portraitTag">
              Ghazipur → Noida
            </span>
          </motion.div>
        </div>
      </motion.div>

      <div className="hero__scroll" aria-hidden="true">
        <span className="hero__rail" />
        Scroll
      </div>
    </section>
  );
}
