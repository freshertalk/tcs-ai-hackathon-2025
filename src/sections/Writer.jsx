// src/sections/Writer.jsx
// The other half of the person. A warm, paper-coloured band (the "write"
// theme) so the page turns from engineering to writing without a page change.
// Copy comes from src/data/author.js.

import React from "react";
import { Reveal, MaskLine, Magnetic, Arrow } from "../components/ui/motion";
import Kulhad from "../components/site/Kulhad";
import { AUTHOR } from "../data/author";

const ICON = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": "true",
};

const Globe = () => (
  <svg viewBox="0 0 24 24" {...ICON}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.6 2.6 3.9 5.6 3.9 9S14.600 18.400 12 21c-2.600-2.600-3.900-5.600-3.900-9S9.400 5.600 12 3z" />
  </svg>
);
const Mail = () => (
  <svg viewBox="0 0 24 24" {...ICON}>
    <rect x="3" y="5" width="18" height="14" rx="2.500" />
    <path d="m4 7.500 8 5.500 8-5.500" />
  </svg>
);
const Insta = () => (
  <svg viewBox="0 0 24 24" {...ICON}>
    <rect x="3.500" y="3.500" width="17" height="17" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.200" cy="6.800" r="0.600" fill="currentColor" />
  </svg>
);

export default function Writer() {
  const { connect, novel } = AUTHOR;

  const links = [
    { Icon: Globe, label: connect.websiteLabel, href: connect.website, ext: true },
    { Icon: Mail, label: connect.email, href: `mailto:${connect.email}` },
    { Icon: Insta, label: connect.instagramLabel, href: connect.instagram, ext: true },
  ];

  return (
    <section className="section writer" id="writer" data-theme="write">
      <div className="shell">
        <div className="sec-head">
          <div>
            <Reveal>
              <span className="eyebrow is-hi">{AUTHOR.kicker}</span>
            </Reveal>
            <h2 className="h-display h-hi title-lg" lang="hi">
              <MaskLine>{AUTHOR.heading}</MaskLine>
            </h2>
          </div>
          <Reveal delay={0.16}>
            <p className="sec-head__note">{AUTHOR.gloss}</p>
          </Reveal>
        </div>

        <div className="writer__grid">
          {/* -------------------------------------------- the bio, in Hindi */}
          <div className="writer__text" lang="hi">
            {AUTHOR.lines.map((l, i) => (
              <Reveal key={l} delay={i * 0.05} y={22}>
                <p className={i === 0 ? "writer__p writer__p--lead" : "writer__p"}>
                  {l}
                </p>
              </Reveal>
            ))}
          </div>

          {/* ----------------------------------------------------- the side */}
          <aside className="writer__side">
            <Reveal y={24}>
              <blockquote className="writer__motto">
                <p lang="hi">“{AUTHOR.motto}”</p>
                <cite>{AUTHOR.mottoGloss}</cite>
              </blockquote>
            </Reveal>

            <Reveal y={24} delay={0.08}>
              <a
                className="writer__novel"
                href={novel.href}
                target="_blank"
                rel="noreferrer"
                data-cursor="पढ़िए"
              >
                <span className="writer__cup" aria-hidden="true">
                  <Kulhad size={46} steamOpacity={0.4} />
                </span>
                <span className="writer__novelBody">
                  <span className="writer__novelK">{novel.note}</span>
                  <span className="writer__novelT" lang="hi">
                    {novel.title}
                  </span>
                  <span className="writer__novelH">
                    {novel.hrefLabel}
                    <Arrow size={12} />
                  </span>
                </span>
              </a>
            </Reveal>

            <Reveal y={24} delay={0.14}>
              <ul className="writer__links">
                {links.map(({ Icon, label, href, ext }) => (
                  <li key={label}>
                    <Magnetic strength={0.12}>
                      <a
                        href={href}
                        {...(ext ? { target: "_blank", rel: "noreferrer" } : {})}
                      >
                        <span className="writer__ico">
                          <Icon />
                        </span>
                        {label}
                      </a>
                    </Magnetic>
                  </li>
                ))}
              </ul>
            </Reveal>
          </aside>
        </div>
      </div>
    </section>
  );
}
