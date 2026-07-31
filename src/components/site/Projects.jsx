// src/components/site/Projects.jsx
import React, { useState, useCallback, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PROJECTS } from "../../data/projects";
import { Reveal, MaskLine, EASE } from "../ui/motion";

const Row = memo(function Row({ p, i, isOpen, onToggle }) {
  const toggle = useCallback(() => onToggle(i), [onToggle, i]);

  return (
    <Reveal delay={Math.min(i, 6) * 0.05} y={24} amount={0.2}>
      <div
        className="pj__row"
        onClick={toggle}
        data-cursor={isOpen ? "Close" : "Open"}
        role="button"
        aria-expanded={isOpen}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        }}
      >
        <span className="pj__yr">{p.year}</span>
        <div>
          <div className="pj__n">{p.name}</div>
          <span className="pj__badge">{p.badge}</span>
        </div>
        <p className="pj__d">{p.desc}</p>
        <span className="pj__go" aria-hidden="true">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <path
              d="M3 13L13 3M13 3H5.5M13 3v7.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </div>

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
              <p>{p.desc}</p>
              <div className="xp__tags">
                {p.tags.map((t) => (
                  <span className="xp__tag" key={t}>
                    {t}
                  </span>
                ))}
              </div>
              {p.href && (
                <a
                  className="btn"
                  href={p.href}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  data-cursor="Visit"
                >
                  Visit the site
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M3 13L13 3M13 3H5.5M13 3v7.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </a>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Reveal>
  );
});

export default function Projects() {
  const [open, setOpen] = useState(null);
  const onToggle = useCallback(
    (i) => setOpen((cur) => (cur === i ? null : i)),
    []
  );

  return (
    <section className="section pj" id="projects">
      <div className="shell">
        <div className="sec-head">
          <div>
            <Reveal>
              <span className="eyebrow">Selected work</span>
            </Reveal>
            <h2 className="h-display title-lg" style={{ marginTop: 18 }}>
              <MaskLine>Twelve builds,</MaskLine>
              <MaskLine delay={0.09}>
                <span className="ital">eleven years</span>
              </MaskLine>
            </h2>
          </div>
          <Reveal delay={0.18}>
            <p className="sec-head__note">
              From enterprise cybersecurity and cache intelligence to SAP BTP
              solution architecture. Tap any row to expand.
            </p>
          </Reveal>
        </div>

        <div className="pj__list">
          {PROJECTS.map((p, i) => (
            <Row
              key={p.name}
              p={p}
              i={i}
              isOpen={open === i}
              onToggle={onToggle}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
