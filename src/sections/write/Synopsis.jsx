// src/sections/write/Synopsis.jsx
// Desktop: a pinned section whose card rail scrolls sideways.
// Touch:   a native swipe rail — far better than hijacking the scroll.
//
// The two variants are separate components on purpose. useScroll({ target })
// throws "Target ref is defined but not hydrated" if the ref never reaches a
// DOM node, which is exactly what happened when one component owned the hook
// but only attached the ref in the desktop branch.

import React, { useRef } from "react";
import { motion, useScroll, useTransform, useSpring } from "framer-motion";
import { Reveal, MaskLine } from "../../components/ui/motion";
import useMediaQuery from "../../hooks/useMediaQuery";
import { BOOK } from "../../data/books";

function Card({ b, i }) {
  return (
    <article className={`syn__card ${b.end ? "syn__card--end" : ""}`}>
      <span className="syn__idx">{String(i + 1).padStart(2, "0")}</span>
      <h3 className="syn__when">{b.when}</h3>
      <p className="syn__text">{b.text}</p>
    </article>
  );
}

function Head() {
  return (
    <>
      <span className="eyebrow is-hi">कहानी</span>
      <h2 className="h-display title-md" style={{ marginTop: 12 }}>
        <MaskLine>ग्यारह साल, एक डिब्बा</MaskLine>
      </h2>
    </>
  );
}

/* ------------------------------------------------- desktop: pinned rail */
function SynopsisPinned() {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  });
  const raw = useTransform(scrollYProgress, [0, 1], ["2%", "-78%"]);
  const x = useSpring(raw, { stiffness: 90, damping: 26, mass: 0.4 });

  return (
    <section
      className="syn"
      id="synopsis"
      ref={ref}
      style={{ height: `${BOOK.beats.length * 62}vh` }}
    >
      <div className="syn__sticky">
        <div className="syn__head shell" style={{ padding: 0 }}>
          <Reveal>
            <Head />
          </Reveal>
        </div>
        <motion.div className="syn__rail" style={{ x }}>
          {BOOK.beats.map((b, i) => (
            <Card b={b} i={i} key={b.when} />
          ))}
        </motion.div>
      </div>
    </section>
  );
}

/* --------------------------------------------------- touch: swipe rail */
function SynopsisSwipe() {
  return (
    <section className="section syn syn--swipe" id="synopsis">
      <div className="shell">
        <Reveal>
          <Head />
        </Reveal>
      </div>
      <div className="syn__swipe" data-lenis-prevent>
        {BOOK.beats.map((b, i) => (
          <Card b={b} i={i} key={b.when} />
        ))}
      </div>
      <div className="shell">
        <p className="syn__hint mono">Swipe →</p>
      </div>
    </section>
  );
}

export default function Synopsis() {
  const coarse = useMediaQuery("(max-width: 900px), (pointer: coarse)");
  return coarse ? <SynopsisSwipe /> : <SynopsisPinned />;
}
