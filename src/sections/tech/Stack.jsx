// src/sections/tech/Stack.jsx
import React from "react";
import { motion } from "framer-motion";
import {
  Reveal,
  MaskLine,
  Stagger,
  riseItem,
} from "../../components/ui/motion";
import { SKILLS, SKILL_GROUPS } from "../../data/profile";

export default function Stack() {
  return (
    <section className="section" id="stack">
      <div className="shell">
        <div className="sec-head">
          <div>
            <Reveal>
              <span className="eyebrow">Capability</span>
            </Reveal>
            <h2 className="h-display title-lg">
              <MaskLine>The stack behind</MaskLine>
              <MaskLine delay={0.08}>
                <span className="ital">the delivery</span>
              </MaskLine>
            </h2>
          </div>
          <Reveal delay={0.16}>
            <p className="sec-head__note">
              Four columns, one job: get enterprise software into production
              without breaking the core. Everything here is something I have
              shipped, not something I have read about.
            </p>
          </Reveal>
        </div>

        <Stagger className="stack__grid" stagger={0.1}>
          {SKILL_GROUPS.map((g, gi) => (
            <motion.div className="stack__col" key={g.key} variants={riseItem}>
              <div className="stack__h">
                <h3 className="stack__t">{g.title}</h3>
                <span className="stack__n">
                  {String(gi + 1).padStart(2, "0")} · {g.note}
                </span>
              </div>
              <div className="chips">
                {SKILLS[g.key].map((s) => (
                  <span className="chip" key={s}>
                    {s}
                  </span>
                ))}
              </div>
            </motion.div>
          ))}
        </Stagger>
      </div>
    </section>
  );
}
