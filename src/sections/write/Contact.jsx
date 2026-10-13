// src/sections/write/Contact.jsx
// संपर्क — the last section: an invitation on one side, the author's card on
// the other (stacked on a phone). The address is a link, not a headline; the
// button beside the invitation does the same thing for a thumb.
import React from "react";
import { Reveal, MaskLine, Magnetic, Arrow } from "../../components/ui/motion";
import Picture from "../../components/ui/Picture";
import SocialIcons from "../../components/site/SocialIcons";
import { AUTHOR } from "../../data/books";
import { PROFILE } from "../../data/profile";

const mailto = `mailto:${AUTHOR.connect.email}?subject=${encodeURIComponent("दो कुल्हड़ चाय")}`;

export default function Contact() {
  return (
    <section className="section section--alt wc" id="contact">
      <div className="wc__glow" aria-hidden="true" />
      <div className="shell wc__grid">
        <div className="wc__lead">
          <Reveal>
            <span className="eyebrow is-hi">{AUTHOR.connect.heading}</span>
          </Reveal>

          <h2 className="h-display h-hi title-md wc__title">
            <MaskLine>कहानी पसंद आई?</MaskLine>
            <MaskLine delay={0.08}>
              <span className="ital">लिखिए।</span>
            </MaskLine>
          </h2>

          <Reveal delay={0.14}>
            <p className="wc__note hi">अपनी राय, सवाल या सुझाव सीधे लेखक को भेजिए।</p>
          </Reveal>

          <Reveal delay={0.2} className="wc__go">
            <Magnetic>
              <a className="btn btn--solid btn--lg" href={mailto}>
                लेखक को लिखिए
                <Arrow />
              </a>
            </Magnetic>
          </Reveal>

          <Reveal delay={0.26} className="wc__follow">
            <span className="wc__followK is-hi">फ़ॉलो कीजिए</span>
            <SocialIcons size="lg" />
          </Reveal>
        </div>

        <Reveal y={24} delay={0.1} className="wc__card">
          <div className="wc__who">
            <span className="wc__avatar">
              <Picture
                name="vinay-avatar"
                smallName="vinay-avatar-sm"
                sizes="64px"
                alt=""
                width="400"
                height="400"
                aria-hidden="true"
              />
            </span>
            <div>
              <b className="wc__name hi-d">{AUTHOR.name}</b>
              <a className="wc__mail" href={mailto} data-cursor="Mail">
                {AUTHOR.connect.email}
              </a>
            </div>
          </div>

          <dl className="wc__row">
            <div>
              <dt className="wc__k is-hi">वेबसाइट</dt>
              <dd className="wc__v">
                <a href={AUTHOR.connect.website} target="_blank" rel="noreferrer">
                  {AUTHOR.connect.websiteLabel}
                </a>
              </dd>
            </div>
            <div>
              <dt className="wc__k is-hi">फ़ोन</dt>
              <dd className="wc__v">
                <a href={`tel:${PROFILE.phone}`}>{PROFILE.phone}</a>
              </dd>
            </div>
            <div>
              <dt className="wc__k is-hi">निवास</dt>
              <dd className="wc__v hi">नोएडा · गाज़ीपुर, उत्तर प्रदेश</dd>
            </div>
            <div>
              <dt className="wc__k is-hi">भाषा</dt>
              <dd className="wc__v hi">हिंदी · अंग्रेज़ी · भोजपुरी</dd>
            </div>
          </dl>
        </Reveal>
      </div>
    </section>
  );
}
