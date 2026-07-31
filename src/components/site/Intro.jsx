// src/components/site/Intro.jsx — portrait + short bio
import React, { useRef } from "react";
import { motion, useScroll, useTransform, useSpring } from "framer-motion";
import { PROFILE } from "../../data/profile";
import { Reveal, MaskLine, Tilt } from "../ui/motion";
import Picture from "../ui/Picture";

export default function Intro() {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  const y = useSpring(useTransform(scrollYProgress, [0, 1], [56, -56]), {
    stiffness: 80,
    damping: 22,
  });

  return (
    <section className="section intro" id="intro" ref={ref}>
      <div className="shell">
        <div className="intro__grid">
          <motion.div style={{ y }}>
            <Tilt max={7} style={{ perspective: 1200 }}>
              <motion.figure
                className="portrait"
                initial={{ opacity: 0, y: 40, scale: 0.96 }}
                whileInView={{ opacity: 1, y: 0, scale: 1 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
                data-cursor="Namaste"
                style={{ margin: 0 }}
              >
                <Picture
                  name="vinay-portrait"
                  smallName="vinay-portrait-sm"
                  sizes="(max-width: 900px) 92vw, 440px"
                  alt={`${PROFILE.name}, SAP BTP solution architect and author`}
                  width="1000"
                  height="1250"
                />
                <span className="portrait__wash" />
                <span className="portrait__frame" />
                <span className="portrait__badge">
                  <span className="hero__dot" /> Since 2015
                </span>
                <figcaption className="portrait__scrim">
                  <div>
                    <div className="portrait__name">{PROFILE.name}</div>
                    <div className="portrait__role">
                      Package Consultant — SAP BTP · IBM · Noida
                    </div>
                  </div>
                </figcaption>
              </motion.figure>
            </Tilt>
          </motion.div>

          <div>
            <Reveal>
              <span className="eyebrow">Who's writing this</span>
            </Reveal>

            <h2 className="intro__quote" style={{ marginTop: 20 }}>
              <MaskLine>I spend my days making</MaskLine>
              <MaskLine delay={0.08}>enterprise software feel</MaskLine>
              <MaskLine delay={0.16}>
                <span className="ital">humane</span> — and my evenings
              </MaskLine>
              <MaskLine delay={0.24}>writing about people who</MaskLine>
              <MaskLine delay={0.32}>keep impossible promises.</MaskLine>
            </h2>

            <Reveal delay={0.2}>
              <p className="lead" style={{ marginTop: 26 }}>
                {PROFILE.summary}. {PROFILE.longSummary} Eleven years across
                Wipro, Mindtree, Cognizant, TCS and now IBM — cybersecurity,
                infrastructure, IoT, telecom, aerospace, HR, healthcare and
                manufacturing. The novel came out of a train that stopped for
                six hours and never quite left me.
              </p>
            </Reveal>

            <Reveal delay={0.26}>
              <div className="intro__meta">
                <div className="intro__cell">
                  <div className="ct__k">Based in</div>
                  <div className="ct__v">Noida | Ghazipur</div>
                </div>
                <div className="intro__cell">
                  <div className="ct__k">Role</div>
                  <div className="ct__v">Package Consultant — SAP BTP</div>
                </div>
                <div className="intro__cell">
                  <div className="ct__k">Writing in</div>
                  <div className="ct__v hindi">हिन्दी</div>
                </div>
              </div>
            </Reveal>

            <Reveal delay={0.32}>
              <div className="intro__sign">
                <span className="intro__sign-mark">
                  <Picture
                    name="vinay-avatar-sm"
                    alt=""
                    width="200"
                    height="200"
                    aria-hidden="true"
                  />
                </span>
                <span className="intro__sign-txt">
                  — विनय कुमार तिवारी
                </span>
              </div>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}
