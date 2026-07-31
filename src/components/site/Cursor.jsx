// src/components/site/Cursor.jsx
// Dot follows instantly, ring lags behind on a spring, and grows over
// anything marked with data-cursor. Hidden on touch devices via CSS.

import React, { useEffect, useState } from "react";
import { motion, useMotionValue, useSpring } from "framer-motion";

export default function Cursor() {
  const x = useMotionValue(-100);
  const y = useMotionValue(-100);
  const rx = useSpring(x, { stiffness: 340, damping: 32, mass: 0.5 });
  const ry = useSpring(y, { stiffness: 340, damping: 32, mass: 0.5 });

  const [label, setLabel] = useState("");
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(pointer: coarse)").matches) return undefined;

    const move = (e) => {
      x.set(e.clientX);
      y.set(e.clientY);
      const hit = e.target.closest?.("[data-cursor], a, button");
      if (hit) {
        setActive(true);
        setLabel(hit.getAttribute?.("data-cursor") || "");
      } else {
        setActive(false);
        setLabel("");
      }
    };

    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, [x, y]);

  return (
    <>
      <motion.div className="cursor-dot" style={{ x, y }} />
      <motion.div
        className="cursor-ring"
        style={{ x: rx, y: ry }}
        animate={{
          scale: label ? 2.15 : active ? 1.55 : 1,
          opacity: active ? 0.95 : 0.55,
        }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      >
        {label && <span className="cursor-label">{label}</span>}
      </motion.div>
    </>
  );
}
