// src/pages/Gate.jsx
// The landing gate — two doors, one person. Choose a portfolio.

import React, { useEffect } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Reveal, MaskLine, SplitWords, Arrow, EASE } from "../components/ui/motion";
import Picture from "../components/ui/Picture";
import { PROFILE, YEARS } from "../data/profile";

const DOORS = [
  {
    to: "/technical",
    cls: "gate__door--tech",
    idx: "01 — Engineering",
    title: "Technical",
    sub: "SAP BTP Solution Architect",
    note: `${YEARS}+ years of enterprise delivery — SAP BTP, CAPM, Fiori/UI5, HANA Cloud and AI-assisted engineering. Plus my own technical website, BTP Learning Hub.`,
    list: ["SAP BTP", "CAPM", "Fiori / UI5", "GenAI", "BTP Learning Hub"],
    cursor: "Engineering",
  },
  {
    to: "/writings",
    cls: "gate__door--write",
    idx: "02 — Literature",
    title: "Writings",
    sub: "दो कुल्हड़ चाय",
    note:
      "एक हिन्दी उपन्यास — शिवगंगा एक्सप्रेस, सीट छत्तीस और सैंतीस, और हर महीने की बारह तारीख़ का एक वादा।",
    list: ["उपन्यास", "अंश", "किरदार", "लेखक"],
    cursor: "पढ़िए",
  },
];

export default function Gate() {
  useEffect(() => {
    document.title = "Vinay Kumar Tiwari — Engineer & Author";
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="gate" data-theme="gate">
      <div className="gate__glow" aria-hidden="true" />

      <motion.div
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
        <span className="gate__meta">{PROFILE.location}</span>
      </motion.div>

      <div className="gate__head">
        <Reveal>
          <span className="gate__kicker">Two portfolios · one person</span>
        </Reveal>

        <h1 className="gate__title">
          <MaskLine delay={0.08}>Engineer</MaskLine>
          <MaskLine delay={0.18}>
            <em>&amp;</em> Author
          </MaskLine>
        </h1>

        <Reveal delay={0.34}>
          <p className="gate__note">
            <SplitWords
              text="By day I architect enterprise systems where nothing is allowed to slip. By night I write about people who let something slip."
              stagger={0.028}
            />
          </p>
        </Reveal>
      </div>

      <div className="gate__split">
        {DOORS.map((d, i) => (
          <motion.div
            key={d.to}
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.42 + i * 0.12, ease: EASE }}
            style={{ display: "flex" }}
          >
            <Link
              to={d.to}
              className={`gate__door ${d.cls}`}
              data-cursor={d.cursor}
              style={{ flex: 1 }}
            >
              <span className="gate__go">
                <Arrow size={18} />
              </span>

              <span className="gate__doorIdx">{d.idx}</span>

              <span className="gate__doorTitle">
                {d.title}
                <span>{d.sub}</span>
              </span>

              <span className="gate__doorNote">{d.note}</span>

              <ul className="gate__doorList">
                {d.list.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </Link>
          </motion.div>
        ))}
      </div>

      <motion.div
        className="gate__foot"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 0.9 }}
      >
        <span>
          <a className="tlink" href={`mailto:${PROFILE.email}`}>
            {PROFILE.email}
          </a>
        </span>
        <span>
          <a
            className="tlink"
            href="https://btplearninghub.com"
            target="_blank"
            rel="noreferrer"
          >
            btplearninghub.com
          </a>
          {"  ·  "}
          <a
            className="tlink"
            href="https://vinaytiwari.org"
            target="_blank"
            rel="noreferrer"
          >
            vinaytiwari.org
          </a>
        </span>
      </motion.div>
    </div>
  );
}
