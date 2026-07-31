// src/components/site/Marquee.jsx
// Infinite ticker that speeds up and skews with scroll velocity.

import React, { useRef } from "react";
import {
  motion,
  useScroll,
  useVelocity,
  useSpring,
  useTransform,
  useAnimationFrame,
  useMotionValue,
  wrap,
} from "framer-motion";

function Marquee({ items = [], baseVelocity = 40 }) {
  const baseX = useMotionValue(0);
  const { scrollY } = useScroll();
  const scrollVelocity = useVelocity(scrollY);
  const smooth = useSpring(scrollVelocity, {
    damping: 50,
    stiffness: 400,
  });
  const factor = useTransform(smooth, [0, 1200], [0, 4], { clamp: false });
  const skew = useTransform(smooth, [-1600, 0, 1600], [-4, 0, 4], { clamp: true });

  const dirRef = useRef(1);

  // Two copies of the list sit side by side; wrap between -50% and 0.
  const x = useTransform(baseX, (v) => `${wrap(-50, 0, v)}%`);

  useAnimationFrame((t, delta) => {
    let moveBy = dirRef.current * baseVelocity * (delta / 1000);
    const f = factor.get();
    if (f < 0) dirRef.current = -1;
    else if (f > 0) dirRef.current = 1;
    moveBy += dirRef.current * moveBy * Math.abs(f);
    baseX.set(baseX.get() - moveBy / 12);
  });

  const row = (key) => (
    <span className="marquee__item" key={key}>
      {items.map((it, i) => (
        <React.Fragment key={`${key}-${i}`}>
          <span className={it.hl ? "hl" : ""}>{it.text ?? it}</span>
          <span className="sep">✦</span>
        </React.Fragment>
      ))}
    </span>
  );

  return (
    <motion.div className="marquee" style={{ skewY: skew }} aria-hidden="true">
      <motion.div className="marquee__track" style={{ x }}>
        {row("a")}
        {row("b")}
        {row("c")}
        {row("d")}
      </motion.div>
    </motion.div>
  );
}

export default React.memo(Marquee);
