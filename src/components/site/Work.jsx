// src/components/site/Work.jsx — experience with a sticky, scroll-linked aside
import React, { useRef, memo } from "react";
import { motion, useScroll, useTransform, useSpring } from "framer-motion";
import { EXPERIENCE, INITIATIVE } from "../../data/experience";
import { Reveal, MaskLine, Counter, Arrow } from "../ui/motion";

const Company = memo(function Company({ co }) {
  return (
    <Reveal className="xp__co" amount={0.12} y={26}>
      <div className="xp__co-h">
        <div>
          <h3 className="xp__co-n">{co.company}</h3>
          <div className="xp__co-r">{co.role}</div>
        </div>
        <div className="xp__co-p">{co.period}</div>
      </div>

      {co.blurb && <p className="xp__co-b">{co.blurb}</p>}

      <div className="xp__items">
        {co.items.map((it, i) => (
          <motion.article
            className="xp__item"
            key={it.title}
            initial={{ opacity: 0, y: 22 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.15 }}
            transition={{ duration: 0.8, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="xp__item-t">{it.title}</div>
            {it.client && <div className="xp__item-c">{it.client}</div>}
            {it.time && <div className="xp__item-time">{it.time}</div>}
            <div className="xp__pts">
              {it.points.map((p) => (
                <span className="xp__pt" key={p}>
                  {p}
                </span>
              ))}
            </div>
            {it.tags?.length > 0 && (
              <div className="xp__tags">
                {it.tags.map((t) => (
                  <span className="xp__tag" key={t}>
                    {t}
                  </span>
                ))}
              </div>
            )}
          </motion.article>
        ))}
      </div>
    </Reveal>
  );
});

function Initiative() {
  return (
    <Reveal className="xp__co" amount={0.12} y={26}>
      <div className="xp__co-h">
        <div>
          <h3 className="xp__co-n">{INITIATIVE.name}</h3>
          <div className="xp__co-r">{INITIATIVE.role}</div>
        </div>
        <div className="xp__co-p">{INITIATIVE.period}</div>
      </div>

      <div className="xp__items">
        <motion.article
          className="xp__item xp__item--own"
          initial={{ opacity: 0, y: 22 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.15 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="xp__item-t">Personal initiative</div>
          <div className="xp__item-c">Teaching what I build</div>
          <div className="xp__pts">
            {INITIATIVE.points.map((p) => (
              <span className="xp__pt" key={p}>
                {p}
              </span>
            ))}
          </div>
          <div className="xp__tags">
            {INITIATIVE.tags.map((t) => (
              <span className="xp__tag" key={t}>
                {t}
              </span>
            ))}
          </div>
          <a
            className="btn"
            href={INITIATIVE.url}
            target="_blank"
            rel="noreferrer"
            style={{ marginTop: 18 }}
            data-cursor="Visit"
          >
            btplearninghub.com <Arrow />
          </a>
        </motion.article>
      </div>
    </Reveal>
  );
}

export default function Work() {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start center", "end end"],
  });
  const line = useSpring(scrollYProgress, { stiffness: 130, damping: 30 });
  const drift = useTransform(scrollYProgress, [0, 1], [0, -26]);

  return (
    <section className="section" id="work" ref={ref}>
      <div className="shell">
        <div className="xp__layout">
          <aside className="xp__aside">
            <Reveal>
              <span className="eyebrow">Experience</span>
            </Reveal>
            <motion.div style={{ y: drift }}>
              <div className="xp__counter">
                <Counter to={11} />
              </div>
              <h2
                className="h-display"
                style={{ fontSize: "clamp(1.5rem,2.4vw,2.1rem)", marginTop: 6 }}
              >
                <MaskLine>years across five</MaskLine>
                <MaskLine delay={0.08}>
                  <span className="ital">engineering floors</span>
                </MaskLine>
              </h2>
              <p
                style={{
                  color: "var(--ink-2)",
                  marginTop: 20,
                  fontSize: "0.92rem",
                  maxWidth: "34ch",
                }}
              >
                Wipro to Mindtree to Cognizant to IBM to TCS — and back to IBM
                as a Package Consultant for SAP BTP. Cybersecurity,
                infrastructure, IoT, telecom, aerospace, HR, healthcare and now
                chemical manufacturing.
              </p>

              <div
                style={{
                  marginTop: 30,
                  height: 3,
                  background: "var(--line)",
                  borderRadius: 99,
                  overflow: "hidden",
                }}
              >
                <motion.div
                  style={{
                    scaleX: line,
                    transformOrigin: "left",
                    height: "100%",
                    background: "linear-gradient(90deg, var(--clay), var(--amber))",
                  }}
                />
              </div>
            </motion.div>
          </aside>

          <div className="xp__list">
            {EXPERIENCE.map((co) => (
              <Company co={co} key={`${co.company}-${co.period}`} />
            ))}
            <Initiative />
          </div>
        </div>
      </div>
    </section>
  );
}
