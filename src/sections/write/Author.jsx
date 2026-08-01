// src/sections/write/Author.jsx
import React from "react";
import { Link } from "react-router-dom";
import {
  Reveal,
  MaskLine,
  Parallax,
  Magnetic,
  Arrow,
} from "../../components/ui/motion";
import Picture from "../../components/ui/Picture";
import { AUTHOR, BOOK } from "../../data/books";

export default function Author() {
  return (
    <section className="section" id="author">
      <div className="shell">
        <div className="sec-head">
          <div>
            <Reveal>
              <span className="eyebrow is-hi">{AUTHOR.kicker}</span>
            </Reveal>
            <h2 className="h-display h-hi title-lg">
              <MaskLine>{AUTHOR.name}</MaskLine>
            </h2>
          </div>
          <Reveal delay={0.16}>
            <p className="sec-head__note">
              {AUTHOR.nameRoman} · Ghazipur → Noida · SAP consultant by day,
              novelist by night.
            </p>
          </Reveal>
        </div>

        <div className="author__grid">
          {/* Plain opacity/-y reveal on purpose: a clip-path reveal can leave
              the frame blank if the observer never fires. */}
          <Parallax distance={26}>
            <Reveal y={30} amount={0.12} className="author__photo">
              <Picture
                name="vinay-portrait"
                smallName="vinay-portrait-sm"
                sizes="(max-width: 940px) 90vw, 400px"
                alt={AUTHOR.nameRoman}
                width="1000"
                height="1250"
              />
              <span className="author__plate">
                <span className="author__plateN">{AUTHOR.name}</span>
                <span className="author__plateR">{AUTHOR.nameRoman}</span>
              </span>
            </Reveal>
          </Parallax>

          <div>
            <div className="author__lines">
              {AUTHOR.lines.map((l, i) => (
                <Reveal key={l} delay={i * 0.06} y={22}>
                  <p className="author__p">{l}</p>
                </Reveal>
              ))}
            </div>

            <Reveal delay={0.2}>
              <blockquote className="author__motto">
                <p>“{AUTHOR.motto}”</p>
                <cite className="author__mottoBy">
                  — {AUTHOR.name} ({BOOK.title})
                </cite>
              </blockquote>
            </Reveal>

            <div className="author__cols">
              <Reveal className="author__box" y={24}>
                <div className="author__boxT is-hi">शिक्षा</div>
                {AUTHOR.education.map((e) => (
                  <div className="author__row" key={e.year}>
                    <b>{e.year}</b>
                    <span>{e.what}</span>
                  </div>
                ))}
              </Reveal>

              <Reveal className="author__box" y={24} delay={0.08}>
                <div className="author__boxT is-hi">वर्तमान</div>
                {AUTHOR.now.map((n) => (
                  <div className="author__row" key={n.k}>
                    <b className="is-hi">{n.k}</b>
                    <span>{n.v}</span>
                  </div>
                ))}
              </Reveal>
            </div>

            <Reveal
              delay={0.26}
              style={{ marginTop: 30, display: "flex", gap: 12, flexWrap: "wrap" }}
            >
              <Magnetic>
                <a
                  className="btn btn--solid"
                  href={`mailto:${AUTHOR.connect.email}`}
                >
                  {AUTHOR.connect.email}
                  <Arrow />
                </a>
              </Magnetic>
              <Magnetic>
                <a
                  className="btn"
                  href={AUTHOR.connect.website}
                  target="_blank"
                  rel="noreferrer"
                >
                  {AUTHOR.connect.websiteLabel}
                  <Arrow />
                </a>
              </Magnetic>
              <Magnetic>
                <Link className="btn" to="/technical" data-cursor="Engineering">
                  The engineer's side
                  <Arrow />
                </Link>
              </Magnetic>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}
