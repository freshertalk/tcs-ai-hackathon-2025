// src/sections/Experience.jsx
// One employer on screen at a time. Four stacked employers used to make this
// the longest block on the page (5,000+ px on a phone); tabs keep every job
// one tap away while the page stays short.

import React, { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Reveal, MaskLine, EASE } from "../components/ui/motion";
import { EXPERIENCE } from "../data/experience";
import { YEARS } from "../data/profile";

const short = (name) =>
  name
    .replace("Tata Consultancy Services", "TCS")
    .replace(" India Pvt. Ltd.", "")
    .replace(/ · /g, " + ");

const span = (period) => {
  const m = period.match(/(\d{4})\D+?(Present|\d{4})/);
  return m ? `${m[1]} — ${m[2] === "Present" ? "Now" : m[2]}` : period;
};

export default function Experience() {
  const [active, setActive] = useState(0);
  const tabs = useRef([]);
  const co = EXPERIENCE[active];

  // arrow keys move between tabs, as a tablist should
  const onKey = (e) => {
    const n = EXPERIENCE.length;
    let next = null;
    if (e.key === "ArrowRight") next = (active + 1) % n;
    if (e.key === "ArrowLeft") next = (active - 1 + n) % n;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = n - 1;
    if (next === null) return;
    e.preventDefault();
    setActive(next);
    tabs.current[next]?.focus();
  };

  return (
    <section className="section section--alt" id="work">
      <div className="shell">
        <div className="sec-head">
          <div>
            <Reveal>
              <span className="eyebrow">Experience</span>
            </Reveal>
            <h2 className="h-display title-lg">
              <MaskLine>
                <span className="xp__years">{YEARS}+</span>{" "}
                years, <span className="ital">five companies</span>
              </MaskLine>
            </h2>
          </div>
          <Reveal delay={0.16}>
            <p className="sec-head__note">
              From enterprise Java and microservices to SAP BTP solution
              architecture — understand the domain first, then write the
              smallest system that survives it.
            </p>
          </Reveal>
        </div>

        <div
          className="xp__tabs"
          role="tablist"
          aria-label="Employers"
          onKeyDown={onKey}
        >
          {EXPERIENCE.map((c, i) => (
            <button
              key={`${c.company}-${i}`}
              ref={(el) => (tabs.current[i] = el)}
              role="tab"
              id={`xp-tab-${i}`}
              aria-selected={active === i}
              aria-controls="xp-panel"
              tabIndex={active === i ? 0 : -1}
              className={`xp__tab ${active === i ? "is-on" : ""}`}
              onClick={() => setActive(i)}
            >
              <span className="xp__tab-n">{short(c.company)}</span>
              <span className="xp__tab-p">{span(c.period)}</span>
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={active}
            id="xp-panel"
            role="tabpanel"
            aria-labelledby={`xp-tab-${active}`}
            className="xp__panel"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: EASE }}
          >
            <div className="xp__co-h">
              <h3 className="xp__co-n">{co.company}</h3>
              <span className="xp__co-p">{co.period}</span>
            </div>
            <div className="xp__co-r">{co.role}</div>
            <p className="xp__co-b">{co.blurb}</p>

            <div className="xp__items">
              {co.items.map((it) => (
                <div className="xp__item" key={it.title}>
                  <h4 className="xp__item-t">{it.title}</h4>
                  <div className="xp__item-c">{it.client}</div>
                  <div className="xp__item-time">{it.time}</div>
                  <ul className="xp__pts">
                    {it.points.map((p) => (
                      <li className="xp__pt" key={p}>
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="xp__tags">
                    {it.tags.map((t) => (
                      <span className="xp__tag" key={t}>
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}
