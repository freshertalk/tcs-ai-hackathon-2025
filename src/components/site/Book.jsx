// src/components/site/Book.jsx
import React, { useRef, useLayoutEffect, useState } from "react";
import { motion, useScroll, useTransform, useSpring } from "framer-motion";
import { BOOK, OTHER_WRITING } from "../../data/books";
import { PROFILE } from "../../data/profile";
import { EASE, Reveal, MaskLine, Magnetic, Arrow, Tilt } from "../ui/motion";
import Kulhad from "./Kulhad";
import useMediaQuery from "../../hooks/useMediaQuery";

/* ------------------------------------------------------------------ */
/* Cover                                                               */
/* ------------------------------------------------------------------ */
function Cover() {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  const y = useSpring(useTransform(scrollYProgress, [0, 1], [70, -70]), {
    stiffness: 80,
    damping: 22,
  });

  return (
    <motion.div className="book__coverwrap" ref={ref} style={{ y }}>
      <Tilt max={9} style={{ transformStyle: "preserve-3d", perspective: 1400 }}>
        <motion.div
          className="book__cover"
          initial={{ opacity: 0, rotateY: -22, x: -40 }}
          whileInView={{ opacity: 1, rotateY: 0, x: 0 }}
          viewport={{ once: true, amount: 0.35 }}
          transition={{ duration: 1.35, ease: EASE }}
          data-cursor="दो कुल्हड़"
        >
          <div className="book__cover-top">A Novel · हिन्दी उपन्यास</div>

          <div className="book__cover-art">
            <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
              <Kulhad size={62} />
              <Kulhad size={62} />
            </div>
          </div>

          <div>
            <div className="book__cover-title">
              दो कुल्हड़
              <br />
              चाय
            </div>
            <div className="book__cover-by" style={{ marginTop: 14 }}>
              — {BOOK.byline}
            </div>
          </div>

          <span className="book__spineglow" />
        </motion.div>
      </Tilt>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Horizontal, scroll-pinned synopsis                                  */
/* ------------------------------------------------------------------ */
function SynopsisRail() {
  const wrapRef = useRef(null);
  const railRef = useRef(null);
  const [distance, setDistance] = useState(0);

  // On phones a long scroll-pin feels like the page has frozen. Swap to a
  // native swipeable, snap-scrolling rail instead — same content, thumb-driven.
  const isCompact = useMediaQuery("(max-width: 860px)");

  useLayoutEffect(() => {
    if (isCompact) {
      setDistance(0);
      return undefined;
    }
    const measure = () => {
      const rail = railRef.current;
      if (!rail) return;
      setDistance(Math.max(0, rail.scrollWidth - window.innerWidth + 40));
    };
    measure();
    window.addEventListener("resize", measure);
    const t = setTimeout(measure, 600); // after webfonts settle
    return () => {
      window.removeEventListener("resize", measure);
      clearTimeout(t);
    };
  }, [isCompact]);

  const { scrollYProgress } = useScroll({
    target: wrapRef,
    offset: ["start start", "end end"],
  });
  const rawX = useTransform(scrollYProgress, [0, 1], [0, -distance]);
  const x = useSpring(rawX, { stiffness: 110, damping: 26, mass: 0.35 });

  const cards = (
    <>
      {BOOK.beats.map((b, i) => (
        <article className={`syn__card ${b.end ? "syn__card--end" : ""}`} key={i}>
          <div className="syn__idx">
            {String(i + 1).padStart(2, "0")} /{" "}
            {String(BOOK.beats.length).padStart(2, "0")}
          </div>
          <div className="syn__when">{b.when}</div>
          <p className="syn__text">{b.text}</p>
          {b.end && (
            <div style={{ marginTop: "auto", opacity: 0.9 }}>
              <Kulhad size={54} />
            </div>
          )}
        </article>
      ))}

      <article className="syn__card" style={{ justifyContent: "center" }}>
        <div className="syn__idx">Closing</div>
        <p
          className="syn__text"
          style={{ color: "var(--cream)", fontSize: "1.1rem" }}
        >
          {BOOK.closing}
        </p>
      </article>
    </>
  );

  const header = (
    <>
      <Reveal>
        <span className="eyebrow">Synopsis</span>
      </Reveal>
      <h3 className="h-display title-md" style={{ marginTop: 12 }}>
        <span className="ital">Eight</span> beats
      </h3>
    </>
  );

  if (isCompact) {
    return (
      <section className="syn syn--swipe" aria-label="Synopsis">
        <div className="shell">{header}</div>
        <div className="syn__swipe" data-lenis-prevent>
          {cards}
        </div>
        <div className="shell syn__hint">
          <span className="mono">Swipe →</span>
        </div>
      </section>
    );
  }

  return (
    <section
      className="syn"
      ref={wrapRef}
      style={{ height: `calc(100svh + ${distance}px)` }}
      aria-label="Synopsis"
    >
      <div className="syn__sticky">
        <div className="syn__head">{header}</div>
        <motion.div className="syn__rail" ref={railRef} style={{ x }}>
          {cards}
        </motion.div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Section                                                             */
/* ------------------------------------------------------------------ */
export default function Book() {
  return (
    <>
      <section className="section book" id="book">
        <div className="shell">
          <div className="sec-head">
            <div>
              <Reveal>
                <span className="eyebrow">The Writing</span>
              </Reveal>
              <h2 className="h-display title-lg" style={{ marginTop: 18 }}>
                <MaskLine delay={0.05}>Some problems don't</MaskLine>
                <MaskLine delay={0.14}>
                  compile. <span className="ital">They're written.</span>
                </MaskLine>
              </h2>
            </div>
            <Reveal delay={0.18}>
              <p className="sec-head__note">
                A debut Hindi novel about six stalled hours, two strangers, and a
                promise kept on the twelfth of every month — for nine years.
              </p>
            </Reveal>
          </div>

          <div className="book__stage">
            <Cover />

            <div className="book__body">
              <Reveal>
                <span className="book__tag">{BOOK.status} · {BOOK.language}</span>
              </Reveal>

              <Reveal delay={0.08}>
                <h3 className="book__title">{BOOK.title}</h3>
                <div className="book__roman">{BOOK.roman} · {BOOK.kind}</div>
              </Reveal>

              <Reveal delay={0.16}>
                <p className="book__logline">{BOOK.logline}</p>
              </Reveal>

              <Reveal delay={0.22}>
                <dl className="book__facts">
                  <div className="book__fact">
                    <dt>Form</dt>
                    <dd>Novel</dd>
                  </div>
                  <div className="book__fact">
                    <dt>Timeline</dt>
                    <dd className="hi">{BOOK.span}</dd>
                  </div>
                  <div className="book__fact">
                    <dt>Setting</dt>
                    <dd className="hi">{BOOK.setting}</dd>
                  </div>
                  <div className="book__fact">
                    <dt>Language</dt>
                    <dd className="hi">{BOOK.language}</dd>
                  </div>
                </dl>
              </Reveal>

              <Reveal delay={0.28}>
                <div className="book__actions">
                  <Magnetic>
                    <a
                      className="btn btn--solid"
                      href={`mailto:${PROFILE.email}?subject=${encodeURIComponent(
                        "दो कुल्हड़ चाय"
                      )}`}
                      data-cursor="Write"
                    >
                      Enquire about the book <Arrow />
                    </a>
                  </Magnetic>
                  <Magnetic>
                    <button
                      className="btn"
                      onClick={() =>
                        document
                          .querySelector(".syn")
                          ?.scrollIntoView({ behavior: "smooth" })
                      }
                    >
                      Read the synopsis <Arrow />
                    </button>
                  </Magnetic>
                </div>
              </Reveal>
            </div>
          </div>
        </div>
      </section>

      <SynopsisRail />

      <section className="section section--tight" style={{ background: "var(--bg-2)" }}>
        <div className="shell">
          <Reveal>
            <span className="eyebrow">What it's about</span>
          </Reveal>
          <h3 className="h-display title-md" style={{ marginTop: 16, maxWidth: "18ch" }}>
            <MaskLine>Four things the</MaskLine>
            <MaskLine delay={0.08}>
              book <span className="ital">keeps returning to</span>
            </MaskLine>
          </h3>

          <div className="theme">
            {BOOK.themes.map((t, i) => (
              <Reveal key={t.n} delay={i * 0.08} className="theme__cell">
                <div className="theme__n">{t.n}</div>
                <div className="theme__t">{t.t}</div>
                <p className="theme__d">{t.d}</p>
              </Reveal>
            ))}
          </div>

          <div style={{ marginTop: "clamp(46px, 6vw, 80px)" }}>
            <Reveal>
              <span className="eyebrow">Also writing</span>
            </Reveal>
            <div className="theme" style={{ marginTop: 26 }}>
              {OTHER_WRITING.map((w, i) => (
                <Reveal key={w.title} delay={i * 0.08} className="theme__cell">
                  <div className="mono" style={{ color: "var(--terra)" }}>{w.kind}</div>
                  <div
                    className="h-display"
                    style={{ fontSize: "1.35rem", marginTop: 12 }}
                  >
                    {w.title}
                  </div>
                  <p className="theme__d">{w.d}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
