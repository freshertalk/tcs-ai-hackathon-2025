// src/components/site/Preloader.jsx
// Light editorial preloader: counter in the corner, masked word, curtain lift.

import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Kulhad from "./Kulhad";
import { EASE } from "../ui/motion";

export default function Preloader({
  onDone,
  word = "दो कुल्हड़ चाय",
  sub = "Vinay Kumar Tiwari",
  mark = true,
}) {
  const [count, setCount] = useState(0);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let raf;
    const start = performance.now();
    const DURATION = 1500;

    const tick = (now) => {
      const t = Math.min(1, (now - start) / DURATION);
      const eased = 1 - Math.pow(1 - t, 3);
      setCount(Math.round(eased * 100));
      if (t < 1) raf = requestAnimationFrame(tick);
      else setTimeout(() => setLeaving(true), 220);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <AnimatePresence onExitComplete={onDone}>
      {!leaving && (
        <motion.div
          className="pre"
          exit={{ y: "-100%" }}
          transition={{ duration: 1, ease: EASE }}
        >
          <motion.div
            className="pre__inner"
            exit={{ opacity: 0, y: -28 }}
            transition={{ duration: 0.45, ease: EASE }}
          >
            {mark && (
              <motion.div
                className="pre__mark"
                initial={{ opacity: 0, y: 16, scale: 0.94 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.9, ease: EASE }}
              >
                <Kulhad size={78} />
              </motion.div>
            )}

            <div className="reveal-mask">
              <motion.div
                className="pre__word reveal-line"
                initial={{ y: "110%" }}
                animate={{ y: "0%" }}
                transition={{ duration: 1, ease: EASE, delay: 0.18 }}
              >
                {word}
              </motion.div>
            </div>

            <motion.div
              className="pre__sub"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.7, delay: 0.6 }}
            >
              {sub}
            </motion.div>
          </motion.div>

          <div className="pre__count">{String(count).padStart(3, "0")}</div>

          <motion.div
            className="pre__bar"
            initial={{ width: "0%" }}
            animate={{ width: `${count}%` }}
            transition={{ ease: "linear", duration: 0.1 }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
