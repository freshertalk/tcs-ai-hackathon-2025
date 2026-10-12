// src/sections/write/Novel.jsx
// About the novel — the fuller version of what the hero says in a breath:
// the book in a paragraph, the four people on the train, and the three lines
// that stand before page one.

import React from "react";
import { motion } from "framer-motion";
import { Reveal, MaskLine, Stagger, riseItem } from "../../components/ui/motion";
import { BOOK } from "../../data/books";
import { useCatalog } from "../../library/hooks";
import { fmtDate } from "../../reader/util";

export default function Novel() {
  const { data } = useCatalog();
  const entry = data && data.books.find((b) => b.slug === BOOK.slug);

  // the date is the publisher's single source of truth (public/ebooks/books.json)
  const facts = BOOK.facts.map((f) =>
    f.k === "स्थिति" && entry
      ? { k: "प्रकाशन", v: fmtDate(entry.published), hi: false }
      : f
  );

  return (
    <>
      <section className="section novel" id="novel">
        <div className="shell">
          <div className="novel__about">
            <div>
              <Reveal>
                <span className="eyebrow is-hi">उपन्यास के बारे में</span>
              </Reveal>
              <h2 className="h-display h-hi title-lg novel__title2">
                <MaskLine>एक रात।</MaskLine>
                <MaskLine delay={0.08}>
                  <span className="ital">ग्यारह साल।</span>
                </MaskLine>
              </h2>
            </div>

            <div>
              <Reveal delay={0.1}>
                <p className="novel__logline">{BOOK.logline}</p>
              </Reveal>
              <Reveal delay={0.16}>
                <p className="novel__premise">{BOOK.closing}</p>
              </Reveal>
              <Reveal delay={0.22} className="novel__facts" as="dl">
                {facts.map((f) => (
                  <div className="novel__fact" key={f.k}>
                    <dt className="is-hi">{f.k}</dt>
                    <dd className={f.hi ? "h" : ""}>{f.v}</dd>
                  </div>
                ))}
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
