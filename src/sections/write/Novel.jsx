// src/sections/write/Novel.jsx
import React from "react";
import { motion } from "framer-motion";
import {
  Reveal,
  MaskLine,
  Tilt,
  Parallax,
  Magnetic,
  Stagger,
  riseItem,
  Arrow,
} from "../../components/ui/motion";
import Kulhad from "../../components/site/Kulhad";
import { scrollToId } from "../../hooks/useSmoothScroll";
import { BOOK, COPYRIGHT } from "../../data/books";

export default function Novel() {
  return (
    <>
      <section className="section novel" id="novel">
        <div className="shell">
          <div className="novel__stage">
            <Parallax distance={30}>
              <Tilt max={9} className="cover">
                <div className="cover__face">
                  <span className="cover__glow" aria-hidden="true" />
                  <span className="cover__top">
                    {BOOK.kind} · {BOOK.language}
                  </span>
                  <div className="cover__art">
                    <Kulhad size={86} steamColor="#f3d9b5" steamOpacity={0.55} />
                    <Kulhad size={86} steamColor="#f3d9b5" steamOpacity={0.4} />
                  </div>
                  <div>
                    <div className="cover__title">{BOOK.title}</div>
                    <div className="cover__by" style={{ marginTop: 10 }}>
                      {BOOK.byline}
                    </div>
                  </div>
                </div>
              </Tilt>
            </Parallax>

            <div className="novel__body">
              <Reveal>
                <span className="tag">{BOOK.status}</span>
              </Reveal>

              <h2 className="novel__title">
                <MaskLine>{BOOK.title}</MaskLine>
              </h2>

              <Reveal delay={0.1}>
                <span className="novel__roman">
                  {BOOK.roman} · {BOOK.route}
                </span>
              </Reveal>

              <Reveal delay={0.16}>
                <p className="novel__logline">{BOOK.logline}</p>
              </Reveal>

              <Reveal delay={0.22}>
                <p className="novel__premise">{BOOK.premise}</p>
              </Reveal>

              <Reveal delay={0.28} className="novel__facts" as="dl">
                {BOOK.facts.map((f) => (
                  <div className="novel__fact" key={f.k}>
                    <dt className="hi">{f.k}</dt>
                    <dd className={f.hi ? "h" : ""}>{f.v}</dd>
                  </div>
                ))}
              </Reveal>

              <Reveal delay={0.34} className="novel__actions">
                <Magnetic>
                  <button
                    className="btn btn--solid"
                    onClick={() => scrollToId("synopsis", 62)}
                    data-cursor="पढ़िए"
                  >
                    कहानी एक नज़र में
                    <Arrow />
                  </button>
                </Magnetic>
                <Magnetic>
                  <button
                    className="btn"
                    onClick={() => scrollToId("author", 62)}
                  >
                    लेखक के बारे में
                  </button>
                </Magnetic>
              </Reveal>

              {/* ------------------------------------------- copyright */}
              <Reveal delay={0.4} className="cr">
                <div className="cr__head">
                  <span className="cr__seal" aria-hidden="true">
                    ©
                  </span>
                  <div>
                    <div className="cr__title">{COPYRIGHT.heading}</div>
                    <div className="cr__status">{COPYRIGHT.statusLabel}</div>
                  </div>
                </div>

                <dl className="cr__rows">
                  {COPYRIGHT.rows.map((r) => (
                    <div className="cr__row" key={r.k}>
                      <dt>{r.k}</dt>
                      <dd>{r.v}</dd>
                    </div>
                  ))}
                </dl>

                <div className="cr__office">
                  <span className="cr__k">
                    प्रस्तुत · Submitted to
                  </span>
                  <a
                    className="cr__office-n tlink"
                    href={COPYRIGHT.office.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {COPYRIGHT.office.name}
                  </a>
                  <span className="cr__office-a">
                    {COPYRIGHT.office.address}
                  </span>
                </div>

                <p className="cr__notice">
                  {COPYRIGHT.notice} {COPYRIGHT.noticeEn}
                </p>
              </Reveal>
            </div>
          </div>

          {/* ------------------------------------------------------- cast */}
          <Reveal style={{ marginTop: "clamp(56px, 7vw, 100px)" }}>
            <span className="eyebrow">किरदार</span>
            <h3 className="h-display title-md" style={{ marginTop: 14 }}>
              चार लोग, एक डिब्बा
            </h3>
          </Reveal>

          <Stagger className="cast" stagger={0.08}>
            {BOOK.cast.map((c) => (
              <motion.div className="cast__card" key={c.name} variants={riseItem}>
                <span className="cast__seat">{c.seat}</span>
                <div className="cast__name">{c.name}</div>
                <p className="cast__line">{c.line}</p>
              </motion.div>
            ))}
          </Stagger>
        </div>
      </section>

      {/* ------------------------------------------------------ quote band */}
      <section className="qband">
        <div className="shell">
          <Reveal>
            <p className="qband__q">{BOOK.epigraph.text}</p>
            <p className="qband__from">— {BOOK.epigraph.from}</p>
          </Reveal>
        </div>
      </section>
    </>
  );
}
