// src/components/site/Preloader.jsx
import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Kulhad from "./Kulhad";
import { EASE } from "../ui/motion";

export default function Preloader({ onDone }) {
  const [count, setCount] = useState(0);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let raf;
    const start = performance.now();
    const DURATION = 1900;

    const tick = (now) => {
      const t = Math.min(1, (now - start) / DURATION);
      // ease-out so the number decelerates into 100
      const eased = 1 - Math.pow(1 - t, 3);
      setCount(Math.round(eased * 100));
      if (t < 1) raf = requestAnimationFrame(tick);
      else setTimeout(() => setLeaving(true), 260);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <AnimatePresence onExitComplete={onDone}>
      {!leaving && (
        <motion.div
          className="preloader"
          exit={{ y: "-100%" }}
          transition={{ duration: 1.05, ease: EASE }}
        >
          <motion.div
            className="preloader__inner"
            exit={{ opacity: 0, y: -30 }}
            transition={{ duration: 0.5, ease: EASE }}
          >
            <motion.div
              className="preloader__kulhad"
              initial={{ opacity: 0, y: 18, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 1, ease: EASE }}
            >
              <Kulhad size={86} />
            </motion.div>

            <div className="reveal-mask">
              <motion.div
                className="preloader__word reveal-line"
                initial={{ y: "110%" }}
                animate={{ y: "0%" }}
                transition={{ duration: 1.05, ease: EASE, delay: 0.22 }}
              >
                दो कुल्हड़ चाय
              </motion.div>
            </div>

            <motion.div
              className="preloader__sub"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.7 }}
            >
              Vinay Kumar Tiwari · Engineer &amp; Author
            </motion.div>
          </motion.div>

          <div className="preloader__count">{String(count).padStart(3, "0")}</div>

          <motion.div
            className="preloader__bar"
            initial={{ width: "0%" }}
            animate={{ width: `${count}%` }}
            transition={{ ease: "linear", duration: 0.1 }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
