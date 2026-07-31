// src/components/site/Hero.jsx
import React, { useRef } from "react";
import { motion, useScroll, useTransform, useSpring } from "framer-motion";
import { PROFILE } from "../../data/profile";
import { EASE, Counter, Magnetic, Arrow } from "../ui/motion";
import { scrollToId } from "../../hooks/useSmoothScroll";
import Picture from "../ui/Picture";

const LINE_DELAY = 0.12;

function Line({ children, i = 0 }) {
  return (
    <span className="reveal-mask">
      <motion.span
        className="reveal-line"
        initial={{ y: "112%" }}
        animate={{ y: "0%" }}
        transition={{ duration: 1.25, ease: EASE, delay: 0.25 + i * LINE_DELAY }}
      >
        {children}
      </motion.span>
    </span>
  );
}

export default function Hero() {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });

  const bgY = useSpring(useTransform(scrollYProgress, [0, 1], [0, 180]), {
    stiffness: 80,
    damping: 24,
  });
  const contentY = useSpring(useTransform(scrollYProgress, [0, 1], [0, 110]), {
    stiffness: 80,
    damping: 24,
  });
  const fade = useTransform(scrollYProgress, [0, 0.8], [1, 0]);
  const ringRot = useTransform(scrollYProgress, [0, 1], [0, 55]);

  return (
    <section className="hero" id="top" ref={ref}>
      <motion.div className="hero__bg" style={{ y: bgY }} />
      <div className="hero__grid" />

      <motion.svg
        className="hero__rings"
        viewBox="0 0 400 400"
        style={{ rotate: ringRot }}
        aria-hidden="true"
      >
        {[70, 108, 146, 184].map((r, i) => (
          <motion.circle
            key={r}
            cx="200"
            cy="200"
            r={r}
            fill="none"
            stroke="rgba(233,169,60,0.16)"
            strokeWidth="1"
            strokeDasharray={i % 2 ? "3 9" : "0"}
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 1.6, delay: 0.4 + i * 0.12, ease: EASE }}
            style={{ transformOrigin: "200px 200px" }}
          />
        ))}
        <motion.circle
          cx="200"
          cy="16"
          r="4"
          fill="#E9A93C"
          animate={{ rotate: 360 }}
          transition={{ duration: 26, repeat: Infinity, ease: "linear" }}
          style={{ transformOrigin: "200px 200px" }}
        />
      </motion.svg>

      <motion.div
        className="hero__face"
        initial={{ opacity: 0, scale: 0.86 }}
        animate={{ opacity: 0.62, scale: 1 }}
        transition={{ duration: 1.6, ease: EASE, delay: 0.5 }}
        style={{ y: bgY }}
        aria-hidden="true"
      >
        <Picture
          name="vinay-portrait"
          smallName="vinay-portrait-sm"
          sizes="(max-width: 1100px) 220px, 290px"
          alt=""
          width="1000"
          height="1250"
          loading="eager"
          fetchPriority="high"
        />
      </motion.div>

      <motion.div
        className="hero__inner shell"
        style={{ y: contentY, opacity: fade }}
      >
        <motion.div
          className="hero__meta"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: EASE, delay: 0.1 }}
        >
          <span className="hero__pill">
            <span className="hero__dot" />
            Package Consultant — SAP BTP · IBM
          </span>
          <span className="hero__pill">Noida | Ghazipur</span>
          <span className="hero__pill">Est. 2015</span>
        </motion.div>

        <h1 className="hero__title">
          <Line i={0}>I build systems</Line>
          <Line i={1}>
            <span className="amp">&amp;</span> I write stories
          </Line>
        </h1>

        <div className="hero__sub">
          <motion.p
            className="hero__blurb"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, ease: EASE, delay: 0.75 }}
          >
            Eleven years of shipping enterprise software — now architecting
            SAP BTP solutions at IBM, with AI-assisted delivery baked into how
            the work gets done. Off the clock, I write fiction in Hindi. <span className="hindi" style={{ color: "var(--cream)" }}>दो कुल्हड़ चाय</span> is my
            first novel.
          </motion.p>

          <motion.div
            className="hero__stats"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, ease: EASE, delay: 0.9 }}
          >
            <div>
              <div className="hero__stat-n">
                <Counter to={11} />
              </div>
              <div className="hero__stat-l">Years engineering</div>
            </div>
            <div>
              <div className="hero__stat-n">
                <Counter to={9} />
              </div>
              <div className="hero__stat-l">Live BTP initiatives</div>
            </div>
            <div>
              <div className="hero__stat-n">
                <Counter to={7} />
              </div>
              <div className="hero__stat-l">Certifications</div>
            </div>
            <div>
              <div className="hero__stat-n">01</div>
              <div className="hero__stat-l">Novel</div>
            </div>
          </motion.div>
        </div>

        <motion.div
          className="hero__actions"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: EASE, delay: 1.05 }}
        >
          <Magnetic>
            <button
              className="btn btn--solid"
              onClick={() => scrollToId("book", 0)}
              data-cursor="Read"
            >
              Read the novel <Arrow />
            </button>
          </Magnetic>
          <Magnetic>
            <button className="btn" onClick={() => scrollToId("craft", 60)}>
              See the engineering <Arrow />
            </button>
          </Magnetic>
          <Magnetic>
            <a className="btn" href={`mailto:${PROFILE.email}`} data-cursor="Mail">
              Get in touch <Arrow />
            </a>
          </Magnetic>
        </motion.div>
      </motion.div>

      <motion.div
        className="hero__scroll"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.5, duration: 0.8 }}
        style={{ opacity: fade }}
      >
        <span className="hero__scroll-rail" />
        Scroll
      </motion.div>
    </section>
  );
}
