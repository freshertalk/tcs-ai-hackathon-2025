// src/sections/write/Contact.jsx
import React from "react";
import { Reveal, MaskLine, Magnetic, Arrow } from "../../components/ui/motion";
import Picture from "../../components/ui/Picture";
import { AUTHOR } from "../../data/books";
import { PROFILE } from "../../data/profile";

export default function Contact() {
  return (
    <section className="section section--alt ct" id="contact">
      <div className="ct__glow" aria-hidden="true" />
      <div className="shell">
        <Reveal>
          <span className="eyebrow is-hi">{AUTHOR.connect.heading}</span>
        </Reveal>

        <h2 className="h-display h-hi title-lg" style={{ marginTop: 20 }}>
          <MaskLine>कहानी पसंद आई?</MaskLine>
          <MaskLine delay={0.08}>
            <span className="ital">लिखिए।</span>
          </MaskLine>
        </h2>

        <Reveal
          delay={0.16}
          style={{
            marginTop: 32,
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
          <a
            className="ct__mail"
            href={`mailto:${AUTHOR.connect.email}`}
            data-cursor="Mail"
          >
            {AUTHOR.connect.email}
          </a>
        </Reveal>

        <div className="ct__row">
          <Reveal y={18}>
            <div className="ct__k is-hi">वेबसाइट</div>
            <div className="ct__v">
              <a
                href={AUTHOR.connect.website}
                target="_blank"
                rel="noreferrer"
              >
                {AUTHOR.connect.websiteLabel}
              </a>
            </div>
          </Reveal>
          <Reveal y={18} delay={0.06}>
            <div className="ct__k is-hi">फ़ोन</div>
            <div className="ct__v">
              <a href={`tel:${PROFILE.phone}`}>{PROFILE.phone}</a>
            </div>
          </Reveal>
          <Reveal y={18} delay={0.12}>
            <div className="ct__k is-hi">निवास</div>
            <div className="ct__v hi">नोएडा · गाज़ीपुर, उत्तर प्रदेश</div>
          </Reveal>
          <Reveal y={18} delay={0.18}>
            <div className="ct__k is-hi">भाषा</div>
            <div className="ct__v hi">हिंदी · अंग्रेज़ी · भोजपुरी</div>
          </Reveal>
        </div>

        <Reveal delay={0.26} style={{ marginTop: 40 }}>
          <Magnetic>
            <a
              className="btn btn--solid btn--lg"
              href={`mailto:${AUTHOR.connect.email}?subject=${encodeURIComponent(
                "दो कुल्हड़ चाय"
              )}`}
            >
              लेखक को लिखिए
              <Arrow />
            </a>
          </Magnetic>
        </Reveal>
      </div>
    </section>
  );
}
