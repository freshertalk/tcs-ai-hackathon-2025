// src/pages/Gate.jsx
// The landing gate — two doors, one person.
//
// This page has exactly one job: make the choice between the two portfolios
// feel considered rather than administrative. So it is atmospheric rather
// than busy — a living backdrop, a cursor spotlight, and two panels that
// respond to attention by taking more room while the other steps back.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  useReducedMotion,
} from "framer-motion";
import { Reveal, MaskLine, SplitWords, Arrow, EASE } from "../components/ui/motion";
import Picture from "../components/ui/Picture";
import Seo from "../components/seo/Seo";
import Kulhad from "../components/site/Kulhad";
import { PROFILE, YEARS } from "../data/profile";
import { BOOK } from "../data/books";

/* ------------------------------------------------------------ motifs */

/** Abstract BTP constellation — a core with four orbiting services. */
function TechMotif() {
  return (
    <svg viewBox="0 0 200 200" fill="none" aria-hidden="true">
      <circle cx="100" cy="100" r="74" className="gm__ring" />
      <circle cx="100" cy="100" r="50" className="gm__ring" />
      <g className="gm__spin">
        {[0, 90, 180, 270].map((deg) => (
          <circle
            key={deg}
            cx={100 + 74 * Math.cos((deg * Math.PI) / 180)}
            cy={100 + 74 * Math.sin((deg * Math.PI) / 180)}
            r="5"
            className="gm__node"
          />
        ))}
      </g>
      <g className="gm__spinSlow">
        {[45, 135, 225, 315].map((deg) => (
          <circle
            key={deg}
            cx={100 + 50 * Math.cos((deg * Math.PI) / 180)}
            cy={100 + 50 * Math.sin((deg * Math.PI) / 180)}
            r="3"
            className="gm__nodeSm"
          />
        ))}
      </g>
      <rect x="82" y="82" width="36" height="36" rx="11" className="gm__core" />
      <circle cx="100" cy="100" r="30" className="gm__pulse" />
    </svg>
  );
}

/** Two kulhads — the novel, literally. */
function WriteMotif() {
  return (
    <div className="gm__cups">
      <Kulhad size={78} steamOpacity={0.42} />
      <Kulhad size={62} steamOpacity={0.3} />
    </div>
  );
}

/* -------------------------------------------------------------- data */

const DOORS = [
  {
    to: "/technical",
    cls: "gate__door--tech",
    idx: "01",
    kicker: "Engineering",
    title: "Technical",
    sub: "SAP BTP Solution Architect",
    note: `${YEARS}+ years of enterprise delivery — SAP BTP, CAPM, Fiori/UI5, HANA Cloud and AI-assisted engineering. Plus my own technical website, BTP Learning Hub.`,
    meta: [`${YEARS}+ years`, "9 live initiatives", "2 SAP certifications"],
    cta: "Enter the workshop",
    cursor: "Engineering",
    Motif: TechMotif,
  },
  {
    to: "/writings",
    cls: "gate__door--write",
    idx: "02",
    kicker: "Literature",
    title: "Writings",
    sub: BOOK.title,
    note:
      "एक हिन्दी उपन्यास — शिवगंगा एक्सप्रेस, सीट छत्तीस और सैंतीस, और हर महीने की बारह तारीख़ का एक वादा।",
    meta: ["हिन्दी उपन्यास", "2015 — 2026", "पूर्ण"],
    cta: "पढ़ना शुरू कीजिए",
    cursor: "पढ़िए",
    Motif: WriteMotif,
  },
];

/* -------------------------------------------------------------- page */

export default function Gate() {
  const navigate = useNavigate();
  const reduced = useReducedMotion();
  const [hover, setHover] = useState(null);
  const [clock, setClock] = useState("");
  const rootRef = useRef(null);

  // cursor spotlight
  const mx = useMotionValue(-500);
  const my = useMotionValue(-500);
  const sx = useSpring(mx, { stiffness: 140, damping: 26, mass: 0.4 });
  const sy = useSpring(my, { stiffness: 140, damping: 26, mass: 0.4 });
  const spotlight = useTransform(
    [sx, sy],
    ([x, y]) =>
      `radial-gradient(460px circle at ${x}px ${y}px, rgba(160,196,232,0.10), transparent 68%)`
  );

  useEffect(() => {
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", "#0d1014");
    window.scrollTo(0, 0);
  }, []);

  // a small sign of life in the corner
  useEffect(() => {
    const tick = () => {
      try {
        setClock(
          new Intl.DateTimeFormat("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
            timeZone: "Asia/Kolkata",
          }).format(new Date())
        );
      } catch {
        setClock("");
      }
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, []);

  // 1 / 2 jump straight to a portfolio
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "1") navigate("/technical");
      if (e.key === "2") navigate("/writings");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  const onMove = useCallback(
    (e) => {
      if (reduced) return;
      const r = rootRef.current?.getBoundingClientRect();
      if (!r) return;
      mx.set(e.clientX - r.left);
      my.set(e.clientY - r.top);
    },
    [mx, my, reduced]
  );

  return (
    <div className="gate" data-theme="gate" ref={rootRef} onPointerMove={onMove}>
      <Seo page="home" />
      {/* ------------------------------------------------------ backdrop */}
      <div className="gate__bg" aria-hidden="true">
        <div className="gate__grid" />
        <motion.span
          className="gate__aurora gate__aurora--a"
          animate={reduced ? undefined : { x: [0, 60, -30, 0], y: [0, -40, 30, 0] }}
          transition={{ duration: 26, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.span
          className="gate__aurora gate__aurora--b"
          animate={reduced ? undefined : { x: [0, -70, 40, 0], y: [0, 40, -30, 0] }}
          transition={{ duration: 32, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.span
          className="gate__aurora gate__aurora--c"
          animate={reduced ? undefined : { scale: [1, 1.15, 1], opacity: [0.5, 0.8, 0.5] }}
          transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
        />
        {!reduced && <motion.div className="gate__spot" style={{ background: spotlight }} />}
        <div className="gate__vignette" />
      </div>

      {/* --------------------------------------------------------- top */}
      <motion.header
        className="gate__top"
        initial={{ opacity: 0, y: -14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: EASE }}
      >
        <span className="gate__brand">
          <span className="nav__mark">
            <Picture
              name="vinay-avatar-sm"
              alt=""
              width="200"
              height="200"
              loading="eager"
              aria-hidden="true"
            />
          </span>
          Vinay Kumar Tiwari
        </span>

        <span className="gate__meta">
          <span className="gate__live">
            <i />
            {PROFILE.location.split("|")[0].trim()}
            {clock && ` · ${clock} IST`}
          </span>
        </span>
      </motion.header>

      {/* ------------------------------------------------------- centre */}
      <div className="gate__head">
        <Reveal>
          <span className="gate__kicker">Two portfolios · one person</span>
        </Reveal>

        <h1 className="gate__title">
          <MaskLine delay={0.08}>Engineer</MaskLine>
          <MaskLine delay={0.18}>
            <em className="gate__amp">&amp;</em> Author
          </MaskLine>
        </h1>

        <Reveal delay={0.34}>
          <p className="gate__note">
            <SplitWords
              text="By day I architect enterprise systems where nothing is allowed to slip. By night I write about people who let something slip."
              stagger={0.026}
            />
          </p>
        </Reveal>

        <Reveal delay={0.5}>
          <p className="gate__hint">
            <span className="gate__hintRule" />
            Choose a side
            <kbd>1</kbd>
            <kbd>2</kbd>
          </p>
        </Reveal>
      </div>

      {/* -------------------------------------------------------- doors */}
      <div className={`gate__split ${hover !== null ? "is-hovering" : ""}`}>
        {DOORS.map((d, i) => {
          const { Motif } = d;
          return (
            <motion.div
              key={d.to}
              className={`gate__doorWrap ${hover === i ? "is-on" : ""}`}
              initial={{ opacity: 0, y: 44 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1, delay: 0.5 + i * 0.12, ease: EASE }}
            >
              <Link
                to={d.to}
                className={`gate__door ${d.cls}`}
                data-cursor={d.cursor}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              >
                <span className="gate__ghost" aria-hidden="true">
                  {d.idx}
                </span>

                <span className="gate__motif" aria-hidden="true">
                  <Motif />
                </span>

                <span className="gate__doorBody">
                  <span className="gate__doorIdx">
                    {d.idx} — {d.kicker}
                  </span>

                  <span className="gate__doorTitle">
                    {d.title}
                    <span>{d.sub}</span>
                  </span>

                  <span className="gate__doorNote">{d.note}</span>

                  <span className="gate__doorMeta">
                    {d.meta.map((m) => (
                      <span key={m}>{m}</span>
                    ))}
                  </span>

                  <span className="gate__cta">
                    {d.cta}
                    <span className="gate__go">
                      <Arrow size={15} />
                    </span>
                  </span>
                </span>
              </Link>
            </motion.div>
          );
        })}
      </div>

      {/* ------------------------------------------------------- footer */}
      <motion.footer
        className="gate__foot"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 0.95 }}
      >
        <a className="tlink" href={`mailto:${PROFILE.email}`}>
          {PROFILE.email}
        </a>
        <span className="gate__footLinks">
          <a
            className="tlink"
            href="https://btplearninghub.com"
            target="_blank"
            rel="noreferrer"
          >
            btplearninghub.com
          </a>
          <a
            className="tlink"
            href="https://vinaytiwari.org"
            target="_blank"
            rel="noreferrer"
          >
            vinaytiwari.org
          </a>
          <a
            className="tlink"
            href={PROFILE.linkedin}
            target="_blank"
            rel="noreferrer"
          >
            LinkedIn
          </a>
          {/* plain <a>, not <Link>: a static file must not be routed by React */}
          <a className="tlink" href="/sitemap.xml">
            Sitemap
          </a>
        </span>
      </motion.footer>
    </div>
  );
}
