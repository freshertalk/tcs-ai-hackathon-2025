// src/components/site/Craft.jsx — skills + credentials
import React from "react";
import { SKILLS, SKILL_GROUPS, EDUCATION, LANGUAGES } from "../../data/profile";
import { CERTS } from "../../data/certs";
import { AWARDS } from "../../data/awards";
import { Reveal, MaskLine } from "../ui/motion";

export default function Craft() {
  return (
    <section className="section skills" id="craft">
      <div className="shell">
        <div className="sec-head">
          <div>
            <Reveal>
              <span className="eyebrow">The Engineering</span>
            </Reveal>
            <h2 className="h-display title-lg" style={{ marginTop: 18 }}>
              <MaskLine>Enterprise software,</MaskLine>
              <MaskLine delay={0.09}>
                built to <span className="ital">last</span>
              </MaskLine>
            </h2>
          </div>
          <Reveal delay={0.18}>
            <p className="sec-head__note">
              SAP BTP architecture with genuine UI/UX care, secure CAPM services
              on Node.js, and AI-assisted delivery used where it measurably
              speeds the work up.
            </p>
          </Reveal>
        </div>

        <div className="skills__grid">
          {SKILL_GROUPS.map((col, ci) => (
            <Reveal key={col.key} delay={ci * 0.08} className="skills__col">
              <div className="skills__col-h">
                <span className="skills__col-t">{col.title}</span>
                <span className="skills__col-n">
                  {String(SKILLS[col.key].length).padStart(2, "0")} · {col.note}
                </span>
              </div>
              <div className="chips">
                {SKILLS[col.key].map((s, i) => (
                  <Reveal
                    key={s}
                    as="span"
                    y={14}
                    duration={0.6}
                    delay={ci * 0.05 + i * 0.03}
                    className={`chip ${col.key === "ai" ? "chip--teal" : ""}`}
                  >
                    {s}
                  </Reveal>
                ))}
              </div>
            </Reveal>
          ))}
        </div>

        <div className="cred" style={{ marginTop: "clamp(20px, 2.4vw, 32px)" }}>
          <Reveal className="cred__col">
            <div className="skills__col-h">
              <span className="skills__col-t">Certifications</span>
              <span className="skills__col-n">Verified</span>
            </div>
            <ul>
              {CERTS.map((c) => (
                <li className="cred__li" key={c}>
                  <i />
                  {c}
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal delay={0.1} className="cred__col">
            <div className="skills__col-h">
              <span className="skills__col-t">Recognition</span>
              <span className="skills__col-n">Awards</span>
            </div>
            <ul>
              {AWARDS.map((a) => (
                <li className="cred__li" key={a}>
                  <i />
                  {a}
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal delay={0.2} className="cred__col">
            <div className="skills__col-h">
              <span className="skills__col-t">Education</span>
              <span className="skills__col-n">Foundation</span>
            </div>
            <div style={{ paddingTop: 6, display: "grid", gap: 22 }}>
              {EDUCATION.map((ed) => (
                <div key={ed.degree}>
                  <div
                    className="h-display"
                    style={{ fontSize: "1.16rem", lineHeight: 1.35 }}
                  >
                    {ed.degree}
                  </div>
                  <div
                    style={{
                      color: "var(--ink-2)",
                      marginTop: 8,
                      fontSize: "0.88rem",
                    }}
                  >
                    {ed.institute} · {ed.year}
                  </div>
                  <div className="mono" style={{ color: "var(--amber)", marginTop: 8 }}>
                    {ed.score}
                  </div>
                </div>
              ))}

              <div style={{ borderTop: "1px solid var(--line)", paddingTop: 18 }}>
                <div className="ct__k">Languages</div>
                <div className="chips" style={{ marginTop: 12 }}>
                  {LANGUAGES.map((l) => (
                    <span className="chip" key={l.name}>
                      {l.name} · {l.level}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
