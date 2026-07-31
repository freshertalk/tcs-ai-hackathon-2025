// src/components/site/Contact.jsx
import React from "react";
import { PROFILE } from "../../data/profile";
import { Reveal, MaskLine, Magnetic, Arrow } from "../ui/motion";
import Kulhad from "./Kulhad";
import Picture from "../ui/Picture";

export default function Contact() {
  const year = new Date().getFullYear();

  return (
    <section className="section ct" id="contact">
      <span className="ct__glow" aria-hidden="true" />
      <div className="shell" style={{ position: "relative", zIndex: 2 }}>
        <Reveal>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <span className="ct__avatar">
              <Picture
                name="vinay-avatar-sm"
                alt={PROFILE.name}
                width="200"
                height="200"
              />
            </span>
            <span className="eyebrow">Contact</span>
          </div>
        </Reveal>

        <h2
          className="h-display title-lg"
          style={{ marginTop: 20, maxWidth: "16ch" }}
        >
          <MaskLine>Two kulhads,</MaskLine>
          <MaskLine delay={0.09}>
            <span className="ital">one conversation</span>
          </MaskLine>
        </h2>

        <Reveal delay={0.16}>
          <p className="lead" style={{ marginTop: 24 }}>
            Open to SAP BTP architecture and consulting work, senior
            engineering conversations, and anything to do with writing. Reply
            time is usually a day.
          </p>
        </Reveal>

        <div style={{ marginTop: "clamp(34px, 5vw, 62px)" }}>
          <Magnetic strength={0.14}>
            <a
              className="ct__mail"
              href={`mailto:${PROFILE.email}`}
              data-cursor="Email"
            >
              {PROFILE.email}
            </a>
          </Magnetic>
        </div>

        <div className="ct__row">
          <Reveal>
            <div className="ct__k">Phone</div>
            <div className="ct__v">
              <a href={`tel:${PROFILE.phone.replace(/\s/g, "")}`}>{PROFILE.phone}</a>
            </div>
          </Reveal>
          <Reveal delay={0.07}>
            <div className="ct__k">LinkedIn</div>
            <div className="ct__v">
              <a href={PROFILE.linkedin} target="_blank" rel="noreferrer">
                /in/vinay-tiwari-sap <Arrow size={11} />
              </a>
            </div>
          </Reveal>
          <Reveal delay={0.14}>
            <div className="ct__k">Location</div>
            <div className="ct__v">{PROFILE.location}</div>
          </Reveal>
          <Reveal delay={0.21}>
            <div className="ct__k">Writing at</div>
            <div className="ct__v">
              <a href={PROFILE.learningHub} target="_blank" rel="noreferrer">
                btplearninghub.com <Arrow size={11} />
              </a>
            </div>
          </Reveal>
          <Reveal delay={0.28}>
            <div className="ct__k">Site</div>
            <div className="ct__v">
              <a href={PROFILE.website} target="_blank" rel="noreferrer">
                vinaytiwari.org <Arrow size={11} />
              </a>
            </div>
          </Reveal>
        </div>

        <div
          style={{
            marginTop: "clamp(48px, 6vw, 84px)",
            display: "flex",
            flexWrap: "wrap",
            gap: 14,
          }}
        >
          <Magnetic>
            <a className="btn btn--solid" href={`mailto:${PROFILE.email}`}>
              Start a conversation <Arrow />
            </a>
          </Magnetic>
          <Magnetic>
            <a
              className="btn"
              href={PROFILE.linkedin}
              target="_blank"
              rel="noreferrer"
            >
              Connect on LinkedIn <Arrow />
            </a>
          </Magnetic>
          <Magnetic>
            <a
              className="btn"
              href={`${process.env.PUBLIC_URL}/Vinay-Kumar-Tiwari-Resume.docx`}
              download
              data-cursor="Download"
            >
              Download résumé <Arrow />
            </a>
          </Magnetic>
        </div>

        <div className="foot">
          <span>© {year} {PROFILE.name}. All rights reserved.</span>
          <span className="foot__hi">हर महीने की बारह तारीख़ · दो कुल्हड़ चाय</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Kulhad size={22} steam={false} />
            {PROFILE.location}
          </span>
        </div>
      </div>
    </section>
  );
}
