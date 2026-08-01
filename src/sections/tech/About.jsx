// src/sections/tech/About.jsx
import React from "react";
import { Link } from "react-router-dom";
import { Reveal, MaskLine, Parallax, Arrow } from "../../components/ui/motion";
import SapCanvas from "../../components/site/SapCanvas";
import { PROFILE, EDUCATION, LANGUAGES } from "../../data/profile";

export default function About() {
  return (
    <section className="section section--alt" id="about">
      <div className="shell">
        <div className="about__grid">
          <Parallax distance={28}>
            <Reveal y={30} amount={0.15}>
              <SapCanvas />
            </Reveal>
          </Parallax>

          <div>
            <Reveal>
              <span className="eyebrow">About</span>
            </Reveal>

            <h2 className="about__quote" style={{ marginTop: 20 }}>
              <MaskLine>I design systems where</MaskLine>
              <MaskLine delay={0.08}>nothing is allowed to slip —</MaskLine>
              <MaskLine delay={0.16}>
                <span className="ital">and write about people who did.</span>
              </MaskLine>
            </h2>

            <Reveal delay={0.2}>
              <p className="lead" style={{ marginTop: 26 }}>
                {PROFILE.summary}.
              </p>
            </Reveal>

            <Reveal delay={0.28}>
              <p style={{ marginTop: 16, color: "var(--ink-2)" }}>
                {PROFILE.longSummary}
              </p>
            </Reveal>

            <Reveal delay={0.34} className="about__meta">
              <div className="about__cell">
                <div className="about__k">Now</div>
                <div className="about__v">{PROFILE.designation}</div>
              </div>
              <div className="about__cell">
                <div className="about__k">Based in</div>
                <div className="about__v">{PROFILE.location}</div>
              </div>
              <div className="about__cell">
                <div className="about__k">Education</div>
                <div className="about__v">
                  {EDUCATION.map((e) => e.degree.split("—")[0].trim()).join(" · ")}
                </div>
              </div>
              <div className="about__cell">
                <div className="about__k">Languages</div>
                <div className="about__v">
                  {LANGUAGES.map((l) => l.name).join(" · ") + " · भोजपुरी"}
                </div>
              </div>
            </Reveal>

            <Reveal delay={0.4} style={{ marginTop: 28 }}>
              <Link className="btn" to="/writings" data-cursor="पढ़िए">
                There is also a novel
                <Arrow />
              </Link>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}
