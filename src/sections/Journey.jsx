// src/sections/Journey.jsx
// The path from Ghazipur to Noida, as one line of stops. Content lives in
// JOURNEY (src/data/profile.js).

import React from "react";
import { motion } from "framer-motion";
import {
  Reveal,
  MaskLine,
  Stagger,
  riseItem,
} from "../components/ui/motion";
import { JOURNEY } from "../data/profile";

export default function Journey() {
  return (
    <section className="section" id="journey">
      <div className="shell">
        <div className="sec-head">
          <div>
            <Reveal>
              <span className="eyebrow">The path</span>
            </Reveal>
            <h2 className="h-display title-lg">
              <MaskLine>From Ghazipur</MaskLine>
              <MaskLine delay={0.08}>
                <span className="ital">to Noida</span>
              </MaskLine>
            </h2>
          </div>
          <Reveal delay={0.16}>
            <p className="sec-head__note">
              An electronics degree, a year of computing in Pune, and a decade
              of enterprise software — each stop added a layer to how I build.
            </p>
          </Reveal>
        </div>

        <Stagger className="path" stagger={0.08}>
          {JOURNEY.map((j, i) => (
            <motion.div
              className={`path__stop ${i === JOURNEY.length - 1 ? "is-now" : ""}`}
              key={j.when}
              variants={riseItem}
            >
              <span className="path__when">{j.when}</span>
              <h3 className="path__place">{j.place}</h3>
              <p className="path__what">{j.what}</p>
            </motion.div>
          ))}
        </Stagger>
      </div>
    </section>
  );
}
