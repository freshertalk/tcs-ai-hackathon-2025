// src/sections/write/Novel.jsx
import React from "react";
import { motion } from "framer-motion";
import {
  Reveal,
  MaskLine,
  Tilt,
  Parallax,
  Magnetic,
  Stagger,
  riseItem,
  Arrow,
} from "../../components/ui/motion";
import Kulhad from "../../components/site/Kulhad";
import { scrollToId } from "../../hooks/useSmoothScroll";
import { BOOK } from "../../data/books";

export default function Novel() {
  return (
    <>
      <section className="section novel" id="novel">
        <div className="shell">
          <div className="novel__stage">
            <Parallax distance={30}>
              <Tilt max={9} className="cover">
                <div className="cover__face">
                  <span className="cover__glow" aria-hidden="true" />
                  <span className="cover__top">
                    {BOOK.kind} · {BOOK.language}
                  </span>
                  <div className="cover__art">
                    <Kulhad size={86} steamColor="#f3d9b5" steamOpacity={0.55} />
                    <Kulhad size={86} steamColor="#f3d9b5" steamOpacity={0.4} />
                  </div>
                  <div>
                    <div className="cover__title">{BOOK.title}</div>
                    <div className="cover__by" style={{ marginTop: 10 }}>
                      {BOOK.byline}
                    </div>
                  </div>
                </div>
              </Tilt>
            </Parallax>

            <div className="novel__body">
              <Reveal>
                <span className="tag is-hi">{BOOK.status}</span>
              </Reveal>

              <h2 className="novel__title">
                <MaskLine>{BOOK.title}</MaskLine>
              </h2>

              <Reveal delay={0.1}>
                <span className="novel__roman">
                  {BOOK.roman} · {BOOK.route}
                </span>
              </Reveal>

              <Reveal delay={0.16}>
                <p className="novel__logline">{BOOK.logline}</p>
              </Reveal>

              <Reveal delay={0.22}>
                <p className="novel__premise">{BOOK.premise}</p>
              </Reveal>

              <Reveal delay={0.28} className="novel__facts" as="dl">
                {BOOK.facts.map((f) => (
                  <div className="novel__fact" key={f.k}>
                    <dt className="is-hi">{f.k}</dt>
                    <dd className={f.hi ? "h" : ""}>{f.v}</dd>
                  </div>
                ))}
                <div className="novel__fact novel__fact--quote">
                  <p>{BOOK.factsQuote}</p>
                  <cite className="novel__fact-attrib">{BOOK.factsQuoteAttrib}</cite>
                </div>
              </Reveal>

              <Reveal delay={0.34} className="novel__actions">
                <Magnetic>
                  <button
                    className="btn btn--solid"
                    onClick={() => scrollToId("lines", 62)}
                    data-cursor="पढ़िए"
                  >
                    पंक्तियाँ पढ़िए
                    <Arrow />
                  </button>
                </Magnetic>
                <Magnetic>
                  <button
                    className="btn"
                    onClick={() => scrollToId("author", 62)}
                  >
                    लेखक के बारे में
                  </button>
                </Magnetic>
              </Reveal>

            </div>
          </div>

          {/* ------------------------------------------------------- cast */}
          <Reveal style={{ marginTop: "clamp(56px, 7vw, 100px)" }}>
            <span className="eyebrow is-hi">किरदार</span>
            <h3 className="h-display title-md" style={{ marginTop: 14 }}>
              चार लोग, एक डिब्बा
            </h3>
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
