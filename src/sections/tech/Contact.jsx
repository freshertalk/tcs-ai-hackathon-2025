// src/sections/tech/Contact.jsx
import React from "react";
import { Link } from "react-router-dom";
import { Reveal, MaskLine, Magnetic, Arrow } from "../../components/ui/motion";
import Picture from "../../components/ui/Picture";
import { PROFILE } from "../../data/profile";

export default function Contact() {
  return (
    <section className="section ct" id="contact">
      <div className="ct__glow" aria-hidden="true" />
      <div className="shell">
        <Reveal>
          <span className="eyebrow">Contact</span>
        </Reveal>

        <h2 className="h-display title-lg" style={{ marginTop: 20 }}>
          <MaskLine>Got an architecture</MaskLine>
          <MaskLine delay={0.08}>
            problem <span className="ital">worth solving?</span>
          </MaskLine>
        </h2>

        <Reveal
          delay={0.16}
          style={{
            marginTop: 34,
            display: "flex",
            alignItems: "center",
            gap: 22,
            flexWrap: "wrap",
          }}
        >
          <span className="ct__avatar">
            <Picture
              name="vinay-avatar"
              smallName="vinay-avatar-sm"
              sizes="76px"
              alt=""
              width="400"
              height="400"
              aria-hidden="true"
            />
          </span>
          <a className="ct__mail" href={`mailto:${PROFILE.email}`} data-cursor="Mail">
            {PROFILE.email}
          </a>
        </Reveal>

        <div className="ct__row">
          <Reveal y={18}>
            <div className="ct__k">Phone</div>
            <div className="ct__v">
              <a href={`tel:${PROFILE.phone}`}>{PROFILE.phone}</a>
            </div>
          </Reveal>
          <Reveal y={18} delay={0.06}>
            <div className="ct__k">LinkedIn</div>
            <div className="ct__v">
              <a href={PROFILE.linkedin} target="_blank" rel="noreferrer">
                /in/vinay-tiwari-sap
              </a>
            </div>
          </Reveal>
          <Reveal y={18} delay={0.12}>
            <div className="ct__k">Learning Hub</div>
            <div className="ct__v">
              <a href={PROFILE.learningHub} target="_blank" rel="noreferrer">
                btplearninghub.com
              </a>
            </div>
          </Reveal>
          <Reveal y={18} delay={0.18}>
            <div className="ct__k">Website</div>
            <div className="ct__v">
              <a href={PROFILE.website} target="_blank" rel="noreferrer">
                vinaytiwari.org
              </a>
            </div>
          </Reveal>
          <Reveal y={18} delay={0.24}>
            <div className="ct__k">Based in</div>
            <div className="ct__v">{PROFILE.location}</div>
          </Reveal>
        </div>

        <Reveal
          delay={0.3}
          style={{ marginTop: 40, display: "flex", gap: 12, flexWrap: "wrap" }}
        >
          <Magnetic>
            <a className="btn btn--solid" href={`mailto:${PROFILE.email}`}>
              Write to me
              <Arrow />
            </a>
          </Magnetic>
          <Magnetic>
            <Link className="btn" to="/writings" data-cursor="पढ़िए">
              Read the novel instead
              <Arrow />
            </Link>
          </Magnetic>
        </Reveal>
      </div>
    </section>
  );
}
