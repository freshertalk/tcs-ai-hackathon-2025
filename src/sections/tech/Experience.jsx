// src/sections/tech/Experience.jsx
import React from "react";
import { Reveal, MaskLine, Counter } from "../../components/ui/motion";
import { EXPERIENCE } from "../../data/experience";
import { YEARS } from "../../data/profile";

export default function Experience() {
  return (
    <section className="section section--alt" id="work">
      <div className="shell">
        <div className="sec-head">
          <div>
            <Reveal>
              <span className="eyebrow">Experience</span>
            </Reveal>
            <h2 className="h-display title-lg">
              <MaskLine>{YEARS}+ years,</MaskLine>
              <MaskLine delay={0.08}>
                <span className="ital">five companies</span>
              </MaskLine>
            </h2>
          </div>
          <Reveal delay={0.16}>
            <p className="sec-head__note">
              From enterprise Java and microservices to SAP BTP solution
              architecture — the same instinct throughout: understand the
              domain first, then write the smallest system that survives it.
            </p>
          </Reveal>
        </div>

        <div className="xp__layout">
          <aside className="xp__aside">
            <Reveal>
              <div className="xp__counter">
                <Counter to={YEARS} suffix="+" />
              </div>
              <p className="stat__l" style={{ maxWidth: "22ch" }}>
                Years across Wipro, Mindtree, Cognizant, TCS and IBM
              </p>
            </Reveal>
            <Reveal delay={0.14} style={{ marginTop: 30 }}>
              <p style={{ color: "var(--ink-2)", fontSize: "0.92rem" }}>
                Currently leading solution architecture across nine concurrent
                SAP transformation initiatives for a leading chemical
                manufacturing client.
              </p>
            </Reveal>
          </aside>

          <div className="xp__list">
            {EXPERIENCE.map((co, ci) => (
              <Reveal className="xp__co" key={`${co.company}-${ci}`} amount={0.12}>
                <div className="xp__co-h">
                  <h3 className="xp__co-n">{co.company}</h3>
                  <span className="xp__co-p">{co.period}</span>
                </div>
                <div className="xp__co-r">{co.role}</div>
                <p className="xp__co-b">{co.blurb}</p>

                <div className="xp__items">
                  {co.items.map((it) => (
                    <div className="xp__item" key={it.title}>
                      <h4 className="xp__item-t">{it.title}</h4>
                      <div className="xp__item-c">{it.client}</div>
                      <div className="xp__item-time">{it.time}</div>
                      <ul className="xp__pts">
                        {it.points.map((p) => (
                          <li className="xp__pt" key={p}>
                            <span>{p}</span>
                          </li>
                        ))}
                      </ul>
                      <div className="xp__tags">
                        {it.tags.map((t) => (
                          <span className="xp__tag" key={t}>
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
