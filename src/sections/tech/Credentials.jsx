// src/sections/tech/Credentials.jsx
import React from "react";
import { Reveal, MaskLine } from "../../components/ui/motion";
import { CERTS } from "../../data/certs";
import { AWARDS } from "../../data/awards";
import { EDUCATION } from "../../data/profile";

export default function Credentials() {
  return (
    <section className="section" id="credentials">
      <div className="shell">
        <div className="sec-head">
          <div>
            <Reveal>
              <span className="eyebrow">Credentials</span>
            </Reveal>
            <h2 className="h-display title-lg">
              <MaskLine>Paper trail</MaskLine>
            </h2>
          </div>
          <Reveal delay={0.14}>
            <p className="sec-head__note">
              Certifications, recognition and education — the verifiable half
              of the story.
            </p>
          </Reveal>
        </div>

        <div className="cred">
          <Reveal className="cred__col" y={26}>
            <h3 className="stack__t">Certifications</h3>
            <div style={{ marginTop: 16 }}>
              {CERTS.map((c) => (
                <div className="cred__li" key={c}>
                  <i />
                  <span>{c}</span>
                </div>
              ))}
            </div>
          </Reveal>

          <Reveal className="cred__col" y={26} delay={0.08}>
            <h3 className="stack__t">Recognition</h3>
            <div style={{ marginTop: 16 }}>
              {AWARDS.map((a) => (
                <div className="cred__li" key={a}>
                  <i />
                  <span>{a}</span>
                </div>
              ))}
            </div>
          </Reveal>

          <Reveal className="cred__col" y={26} delay={0.16}>
            <h3 className="stack__t">Education</h3>
            <div style={{ marginTop: 16 }}>
              {EDUCATION.map((e) => (
                <div className="cred__li" key={e.degree}>
                  <i />
                  <span>
                    {e.degree}
                    <br />
                    <span style={{ color: "var(--ink-3)", fontSize: "0.84rem" }}>
                      {e.institute} · {e.year} · {e.score}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
