// src/sections/tech/Hub.jsx
// BTP Learning Hub — Vinay's own technical website, given its own stage.
// All copy comes from src/data/hub.js.

import React from "react";
import { motion } from "framer-motion";
import {
  Reveal,
  MaskLine,
  Counter,
  Magnetic,
  Stagger,
  riseItem,
  Tilt,
  Arrow,
} from "../../components/ui/motion";
import { HUB } from "../../data/hub";

export default function Hub() {
  return (
    <section className="section hub" id="hub">
      <div className="hub__ribbon" aria-hidden="true" />

      <div className="shell">
        {/* ------------------------------------------------ headline row */}
        <div className="hub__top">
          <div>
            <Reveal>
              <span className="eyebrow">{HUB.kicker}</span>
            </Reveal>

            <h2 className="hub__title">
              <MaskLine>BTP Learning</MaskLine>
              <MaskLine delay={0.08}>
                <span className="ital">Hub</span>
              </MaskLine>
            </h2>

            <Reveal delay={0.16}>
              <a
                className="hub__url"
                href={HUB.url}
                target="_blank"
                rel="noreferrer"
                data-cursor="Open"
              >
                <i />
                {HUB.urlLabel}
                <Arrow size={12} />
              </a>
            </Reveal>

            <Reveal delay={0.22}>
              <p className="hub__tagline">{HUB.tagline}</p>
            </Reveal>

            <Reveal delay={0.28}>
              <p className="hub__intro">{HUB.intro}</p>
            </Reveal>

            <Reveal delay={0.34}>
              <div className="chips" style={{ marginTop: 22 }}>
                {HUB.stack.map((s) => (
                  <span className="chip" key={s}>
                    {s}
                  </span>
                ))}
              </div>
            </Reveal>

            <Reveal delay={0.4} className="hub__actions">
              <Magnetic>
                <a
                  className="btn btn--solid btn--lg"
                  href={HUB.cta.primary.href}
                  target="_blank"
                  rel="noreferrer"
                  data-cursor="Open"
                >
                  {HUB.cta.primary.label}
                  <Arrow />
                </a>
              </Magnetic>
              <Magnetic>
                <a
                  className="btn btn--lg"
                  href={HUB.cta.secondary.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  {HUB.cta.secondary.label}
                  <Arrow />
                </a>
              </Magnetic>
            </Reveal>
          </div>

          {/* --------------------------------------------- browser mock */}
          <Reveal delay={0.18} y={44}>
            <Tilt max={7}>
              <a
                className="browser"
                href={HUB.url}
                target="_blank"
                rel="noreferrer"
                data-cursor="Visit"
                style={{ display: "block" }}
              >
                <div className="browser__bar">
                  <span className="browser__dots">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="browser__url">
                    https://{HUB.preview.urlBar}
                  </span>
                </div>
                <div className="browser__page">
                  <span className="browser__eyebrow">
                    Learn · Build · Ship
                  </span>
                  <h3 className="browser__h">{HUB.preview.headline}</h3>
                  <p className="browser__p">{HUB.preview.sub}</p>
                  <div className="browser__chips">
                    {HUB.preview.chips.map((c) => (
                      <span key={c}>{c}</span>
                    ))}
                  </div>
                  <div className="browser__skeleton" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </div>
                </div>
              </a>
            </Tilt>
          </Reveal>
        </div>

        {/* ----------------------------------------------------- numbers */}
        <Stagger className="hub__stats" stagger={0.08}>
          {HUB.stats.map((s) => (
            <motion.div className="hub__stat" key={s.label} variants={riseItem}>
              <div className="stat__n">
                <Counter to={s.n} suffix={s.suffix} />
              </div>
              <div className="stat__l">{s.label}</div>
            </motion.div>
          ))}
        </Stagger>

        {/* ------------------------------------------------------ tracks */}
        <Reveal style={{ marginTop: "clamp(46px, 6vw, 84px)" }}>
          <h3 className="h-display title-md">
            What you will find inside
          </h3>
          <p className="sec-head__note" style={{ marginTop: 10 }}>
            Six learning tracks, each written from something that actually
            shipped.
          </p>
        </Reveal>

        <Stagger className="hub__tracks" stagger={0.07}>
          {HUB.tracks.map((t) => (
            <motion.article className="track" key={t.n} variants={riseItem}>
              <span className="track__n">{t.n}</span>
              <h4 className="track__t">{t.t}</h4>
              <p className="track__d">{t.d}</p>
              <div className="track__tags">
                {t.tags.map((x) => (
                  <span key={x}>{x}</span>
                ))}
              </div>
            </motion.article>
          ))}
        </Stagger>

        {/* ----------------------------------------- audience + why panels */}
        <div className="hub__split">
          <Reveal className="hub__panel" y={30}>
            <h3>Who it is for</h3>
            <div className="aud">
              {HUB.audience.map((a) => (
                <div className="aud__li" key={a.t}>
                  <div className="aud__t">{a.t}</div>
                  <div className="aud__d">{a.d}</div>
                </div>
              ))}
            </div>
          </Reveal>

          <Reveal className="hub__panel" y={30} delay={0.1}>
            <h3>Why it exists</h3>
            <div className="why">
              {HUB.why.map((w) => (
                <div className="why__li" key={w}>
                  <i />
                  <span>{w}</span>
                </div>
              ))}
            </div>
            <p
              style={{
                marginTop: 22,
                fontFamily: "var(--f-mono)",
                fontSize: "0.62rem",
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: "var(--ink-3)",
              }}
            >
              {HUB.role} · {HUB.since}
            </p>
          </Reveal>
        </div>

        {/* --------------------------------------------------- closing CTA */}
        <Reveal className="hub__cta" y={40}>
          <div>
            <h3>Come read it. It is free, and it is written for you.</h3>
            <p>
              No paywall, no sign-up, no ads. Just the walkthroughs I wish
              existed when I started on SAP BTP.
            </p>
          </div>
          <Magnetic>
            <a
              className="btn btn--lg"
              href={HUB.url}
              target="_blank"
              rel="noreferrer"
              data-cursor="Open"
            >
              {HUB.urlLabel}
              <Arrow />
            </a>
          </Magnetic>
        </Reveal>
      </div>
    </section>
  );
}
