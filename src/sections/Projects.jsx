// src/sections/Projects.jsx
import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Reveal, MaskLine, Arrow, EASE } from "../components/ui/motion";
import { PROJECTS } from "../data/projects";

export default function Projects() {
  const [open, setOpen] = useState(null);

  return (
    <section className="section" id="projects">
      <div className="shell">
        <div className="sec-head">
          <div>
            <Reveal>
              <span className="eyebrow">Selected work</span>
            </Reveal>
            <h2 className="h-display title-lg">
              <MaskLine>Things that went</MaskLine>
              <MaskLine delay={0.08}>
                <span className="ital">to production</span>
              </MaskLine>
            </h2>
          </div>
          <Reveal delay={0.16}>
            <p className="sec-head__note">
              Tap any row for the detail. Client names follow what the résumé
              can name — descriptive where it cannot.
            </p>
          </Reveal>
        </div>

        <div className="pj__list">
          {PROJECTS.map((p, i) => {
            const isOpen = open === i;
            return (
              <Reveal key={`${p.name}-${i}`} y={20} amount={0.3}>
                <button
                  className="pj__row"
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  data-cursor={isOpen ? "Close" : "Open"}
                >
                  <span className="pj__yr">{p.year}</span>
                  <span>
                    <span className="pj__n" style={{ display: "block" }}>
                      {p.name}
                    </span>
                    <span className="pj__badge">{p.badge}</span>
                  </span>
                  <span className="pj__d">{p.desc}</span>
                  <span className="pj__go">
                    <Arrow />
                  </span>
                </button>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.55, ease: EASE }}
                      style={{ overflow: "hidden" }}
                    >
                      <div className="pj__detail">
                        <p>{p.desc}.</p>
                        <div className="xp__tags">
                          {p.tags.map((t) => (
                            <span className="xp__tag" key={t}>
                              {t}
                            </span>
                          ))}
                        </div>
                        {p.href && (
                          <a
                            className="btn btn--sm"
                            href={p.href}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open {p.href.replace("https://", "")}
                            <Arrow size={12} />
                          </a>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
