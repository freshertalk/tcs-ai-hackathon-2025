// src/sections/write/Lines.jsx
// पंक्तियाँ — lines from the novel, on a rail.
//
// Replaces the old plot-beat synopsis. Beats told the reader what happens;
// these tell them how it sounds. Every card is attributed, because a quote
// that travels should carry the author's name with it.
//
// Two variants for the same reason as Synopsis had: useScroll({ target })
// must never run in a component whose ref does not reach a DOM node.

import React, { useRef } from "react";
import { motion, useScroll, useTransform, useSpring } from "framer-motion";
import { Reveal, MaskLine } from "../../components/ui/motion";
import useMediaQuery from "../../hooks/useMediaQuery";
import { LINES, LINE_ATTRIB } from "../../data/books";

function Card({ text, i }) {
  return (
    <figure className="ln__card">
      <span className="ln__quote" aria-hidden="true">
        ”
      </span>
      <blockquote className="ln__text">{text}</blockquote>
      <figcaption className="ln__by">{LINE_ATTRIB}</figcaption>
      <span className="ln__idx" aria-hidden="true">
        {String(i + 1).padStart(2, "0")}
      </span>
    </figure>
  );
}

function Head() {
  return (
    <>
      <span className="eyebrow is-hi">पंक्तियाँ · Lines</span>
      <h2 className="h-display h-hi title-md" style={{ marginTop: 12 }}>
        <MaskLine>कुछ वाक्य, जो अकेले भी खड़े रह जाते हैं</MaskLine>
      </h2>
    </>
  );
}

/* ------------------------------------------------- desktop: pinned rail */
function LinesPinned() {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  });
  const raw = useTransform(scrollYProgress, [0, 1], ["2%", "-82%"]);
  const x = useSpring(raw, { stiffness: 90, damping: 26, mass: 0.4 });

  return (
    <section
      className="syn ln"
      id="lines"
      ref={ref}
      style={{ height: `${LINES.length * 34}vh` }}
    >
      <div className="syn__sticky">
        <div className="syn__head shell" style={{ padding: 0 }}>
          <Reveal>
            <Head />
          </Reveal>
        </div>
        <motion.div className="syn__rail" style={{ x }}>
          {LINES.map((t, i) => (
            <Card text={t} i={i} key={t.slice(0, 20)} />
          ))}
        </motion.div>
      </div>
    </section>
  );
}

/* --------------------------------------------------- touch: swipe rail */
function LinesSwipe() {
  return (
    <section className="section syn syn--swipe ln" id="lines">
      <div className="shell">
        <Reveal>
          <Head />
        </Reveal>
      </div>
      <div className="syn__swipe" data-lenis-prevent>
        {LINES.map((t, i) => (
          <Card text={t} i={i} key={t.slice(0, 20)} />
        ))}
      </div>
      <div className="shell">
        <p className="syn__hint mono">Swipe →</p>
      </div>
    </section>
  );
}

export default function Lines() {
  const coarse = useMediaQuery("(max-width: 900px), (pointer: coarse)");
  return coarse ? <LinesSwipe /> : <LinesPinned />;
}
