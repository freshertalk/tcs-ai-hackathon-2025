// src/components/ui/motion.jsx
// Shared motion primitives used across the site.

import React, { useRef, useState, useEffect } from "react";
import {
  motion,
  useInView,
  useMotionValue,
  useSpring,
  useTransform,
  useScroll,
  useReducedMotion,
  animate,
} from "framer-motion";

export const EASE = [0.16, 1, 0.3, 1];

/* ------------------------------------------------------------------ */
/* Reveal — fades + lifts children once they enter the viewport.       */
/* ------------------------------------------------------------------ */
export function Reveal({
  children,
  delay = 0,
  y = 34,
  duration = 0.95,
  once = true,
  amount = 0.25,
  as = "div",
  ...rest
}) {
  const MotionTag = motion[as] || motion.div;
  return (
    <MotionTag
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, amount }}
      transition={{ duration, delay, ease: EASE }}
      {...rest}
    >
      {children}
    </MotionTag>
  );
}

/* ------------------------------------------------------------------ */
/* MaskLine — a line of text that slides up from behind a mask.        */
/* ------------------------------------------------------------------ */
export function MaskLine({ children, delay = 0, duration = 1.05, className = "" }) {
  // The observer MUST sit on the mask, not on the sliding line.
  //
  // The line starts translated 110% below the mask, and the mask is
  // overflow:hidden. IntersectionObserver clips the intersection rect by
  // ancestor overflow, so a whileInView on the line itself reports a ratio
  // of 0 forever — the animation never starts and the heading stays
  // invisible. Watching the (unclipped) mask fixes it.
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, amount: 0.15 });
  const reduced = useReducedMotion();
  const shown = inView || reduced;

  return (
    <span className="reveal-mask" ref={ref}>
      <motion.span
        className={`reveal-line ${className}`}
        initial={reduced ? false : { y: "125%" }}
        animate={{ y: shown ? "0%" : "125%" }}
        transition={{ duration, delay, ease: EASE }}
      >
        {children}
      </motion.span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* SplitWords — word-by-word masked headline reveal                    */
/* ------------------------------------------------------------------ */
export function SplitWords({
  text,
  className = "",
  delay = 0,
  stagger = 0.055,
  once = true,
  amount = 0.2,
}) {
  const words = String(text).split(" ");
  // amount stays low: the wrapper is unclipped, but a long paragraph can be
  // taller than the viewport, and a high threshold would never be reached.
  return (
    <motion.span
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once, amount }}
      transition={{ staggerChildren: stagger, delayChildren: delay }}
      aria-label={text}
    >
      {words.map((w, i) => (
        <span className="word-wrap" key={`${w}-${i}`} aria-hidden="true">
          <motion.span
            className="word"
            variants={{
              hidden: { y: "110%", opacity: 0 },
              show: { y: "0%", opacity: 1 },
            }}
            transition={{ duration: 1, ease: EASE }}
          >
            {w}
            {i < words.length - 1 ? " " : ""}
          </motion.span>
        </span>
      ))}
    </motion.span>
  );
}

/* ------------------------------------------------------------------ */
/* ClipReveal — curtain wipe. The editorial image-reveal move.         */
/* ------------------------------------------------------------------ */
export function ClipReveal({
  children,
  className = "",
  delay = 0,
  duration = 1.15,
  from = "bottom", // bottom | left | right | top
  scale = true,
  ...rest
}) {
  const reduced = useReducedMotion();
  const ref = useRef(null);
  // Same trap as MaskLine: an element clipped to inset(100%) can report a
  // zero intersection, so the observer goes on the ref and the clip goes on
  // the child. Never let an animation be the only thing making content visible.
  const inView = useInView(ref, { once: true, amount: 0.15 });
  const shown = inView || reduced;

  const inset = {
    bottom: "inset(100% 0% 0% 0%)",
    top: "inset(0% 0% 100% 0%)",
    left: "inset(0% 100% 0% 0%)",
    right: "inset(0% 0% 0% 100%)",
  }[from];

  if (reduced) {
    return (
      <div className={className} ref={ref} {...rest}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      className={className}
      ref={ref}
      initial={{ clipPath: inset }}
      animate={{ clipPath: shown ? "inset(0% 0% 0% 0%)" : inset }}
      transition={{ duration, delay, ease: EASE }}
      {...rest}
    >
      {scale ? (
        <motion.div
          initial={{ scale: 1.14 }}
          animate={{ scale: shown ? 1 : 1.14 }}
          transition={{ duration: duration + 0.35, delay, ease: EASE }}
          style={{ height: "100%" }}
        >
          {children}
        </motion.div>
      ) : (
        children
      )}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Stagger — a list container whose children rise in sequence.         */
/* ------------------------------------------------------------------ */
export function Stagger({
  children,
  className = "",
  stagger = 0.09,
  delay = 0,
  amount = 0.2,
  ...rest
}) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount }}
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: stagger, delayChildren: delay } },
      }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

export const riseItem = {
  hidden: { opacity: 0, y: 28 },
  show: { opacity: 1, y: 0, transition: { duration: 0.85, ease: EASE } },
};

/* ------------------------------------------------------------------ */
/* Magnetic — element leans toward the cursor, springs back on exit.   */
/* ------------------------------------------------------------------ */
export function Magnetic({ children, strength = 0.32, className = "", ...rest }) {
  const ref = useRef(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 170, damping: 15, mass: 0.35 });
  const sy = useSpring(y, { stiffness: 170, damping: 15, mass: 0.35 });

  const onMove = (e) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    x.set((e.clientX - (r.left + r.width / 2)) * strength);
    y.set((e.clientY - (r.top + r.height / 2)) * strength);
  };
  const onLeave = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={{ x: sx, y: sy, display: "inline-flex" }}
      className={className}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Counter — animates a number when it scrolls into view.              */
/* ------------------------------------------------------------------ */
export function Counter({ to, duration = 1.9, suffix = "", prefix = "" }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const [val, setVal] = useState(0);

  useEffect(() => {
    if (!inView) return undefined;
    const controls = animate(0, to, {
      duration,
      ease: EASE,
      onUpdate: (v) => setVal(Math.round(v)),
    });
    return () => controls.stop();
  }, [inView, to, duration]);

  return (
    <span ref={ref}>
      {prefix}
      {val}
      {suffix}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Parallax — moves a layer at a different rate than the scroll.       */
/* ------------------------------------------------------------------ */
export function Parallax({ children, distance = 90, className = "", style }) {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  const y = useTransform(scrollYProgress, [0, 1], [distance, -distance]);
  const sy = useSpring(y, { stiffness: 90, damping: 22, mass: 0.4 });
  return (
    <motion.div ref={ref} className={className} style={{ y: sy, ...style }}>
      {children}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Tilt — subtle 3D tilt driven by pointer position.                   */
/* ------------------------------------------------------------------ */
export function Tilt({ children, max = 11, className = "", style }) {
  const ref = useRef(null);
  const mx = useMotionValue(0.5);
  const my = useMotionValue(0.5);
  const srx = useSpring(useTransform(my, [0, 1], [max, -max]), {
    stiffness: 130,
    damping: 18,
  });
  const sry = useSpring(useTransform(mx, [0, 1], [-max, max]), {
    stiffness: 130,
    damping: 18,
  });

  const onMove = (e) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    mx.set((e.clientX - r.left) / r.width);
    my.set((e.clientY - r.top) / r.height);
  };
  const onLeave = () => {
    mx.set(0.5);
    my.set(0.5);
  };

  return (
    <motion.div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className={className}
      style={{ rotateX: srx, rotateY: sry, transformStyle: "preserve-3d", ...style }}
    >
      {children}
    </motion.div>
  );
}

/* Small arrow glyph used on buttons/links. */
export function Arrow({ size = 14 }) {
  return (
    <svg
      className="btn__ico"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 13L13 3M13 3H5.5M13 3v7.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
