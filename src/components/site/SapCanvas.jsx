// src/components/site/SapCanvas.jsx
// An animated Clean Core architecture diagram — the visual for the About
// section. Pure SVG + CSS, no images, themes off the CSS custom properties.

import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";

const NODES = [
  { id: "cap", label: "CAP", sub: "services", x: 200, y: 92 },
  { id: "ui5", label: "FIORI", sub: "UI5", x: 322, y: 250 },
  { id: "hana", label: "HANA", sub: "cloud", x: 200, y: 408 },
  { id: "mesh", label: "EVENT", sub: "mesh", x: 78, y: 250 },
];

// core edge -> chip edge, as path data so a dot can ride along it
const LINKS = [
  { id: "cap", d: "M200 202 L200 116" },
  { id: "ui5", d: "M248 250 L278 250" },
  { id: "hana", d: "M200 298 L200 384" },
  { id: "mesh", d: "M152 250 L122 250" },
];

const TERMINAL = [
  "cds deploy --to hana",
  "npm run build:mta",
  "cf push btp-service",
  "git commit -m 'clean core'",
];

export default function SapCanvas() {
  const [line, setLine] = useState(0);
  const [typed, setTyped] = useState("");

  // cycle the terminal line, typing it out one character at a time
  useEffect(() => {
    const full = TERMINAL[line];
    let i = 0;
    setTyped("");
    const type = setInterval(() => {
      i += 1;
      setTyped(full.slice(0, i));
      if (i >= full.length) clearInterval(type);
    }, 55);
    const next = setTimeout(
      () => setLine((l) => (l + 1) % TERMINAL.length),
      full.length * 55 + 2200
    );
    return () => {
      clearInterval(type);
      clearTimeout(next);
    };
  }, [line]);

  return (
    <div className="sapviz" aria-hidden="true">
      <div className="sapviz__bar">
        <span className="sapviz__dots">
          <i />
          <i />
          <i />
        </span>
        <span className="sapviz__barTxt">clean-core · architecture</span>
      </div>

      <svg className="sapviz__svg" viewBox="0 0 400 500" fill="none">
        <defs>
          <linearGradient id="sv-core" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--accent)" />
            <stop offset="100%" stopColor="var(--accent-2)" />
          </linearGradient>
          <pattern
            id="sv-grid"
            width="40"
            height="40"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M40 0H0V40"
              stroke="currentColor"
              strokeOpacity="0.35"
              strokeWidth="1"
              fill="none"
            />
          </pattern>
        </defs>

        <rect width="400" height="500" fill="url(#sv-grid)" className="sapviz__grid" />

        {/* orbit */}
        <circle
          cx="200"
          cy="250"
          r="140"
          className="sapviz__orbit"
          strokeDasharray="3 9"
        />
        <g className="sapviz__spin">
          <circle cx="340" cy="250" r="4" className="sapviz__orbitDot" />
        </g>

        {/* pulsing rings behind the core */}
        {[0, 1, 2].map((i) => (
          <circle
            key={i}
            cx="200"
            cy="250"
            r="52"
            className="sapviz__ring"
            style={{ animationDelay: `${i * 1.2}s` }}
          />
        ))}

        {/* connectors + travelling packets */}
        {LINKS.map((l, i) => (
          <g key={l.id}>
            <path d={l.d} className="sapviz__link" />
            <circle r="3.6" className="sapviz__packet">
              <animateMotion
                dur="2.4s"
                begin={`${i * 0.6}s`}
                repeatCount="indefinite"
                path={l.d}
              />
            </circle>
          </g>
        ))}

        {/* satellite chips */}
        {NODES.map((n, i) => (
          <motion.g
            key={n.id}
            animate={{ y: [0, -5, 0] }}
            transition={{
              duration: 4.2,
              repeat: Infinity,
              delay: i * 0.5,
              ease: "easeInOut",
            }}
          >
            <rect
              x={n.x - 52}
              y={n.y - 24}
              width="104"
              height="48"
              rx="14"
              className="sapviz__chip"
            />
            <text x={n.x} y={n.y - 2} className="sapviz__chipT">
              {n.label}
            </text>
            <text x={n.x} y={n.y + 13} className="sapviz__chipS">
              {n.sub}
            </text>
          </motion.g>
        ))}

        {/* the core */}
        <motion.g
          animate={{ scale: [1, 1.045, 1] }}
          transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
          style={{ transformOrigin: "200px 250px" }}
        >
          <rect
            x="152"
            y="202"
            width="96"
            height="96"
            rx="26"
            fill="url(#sv-core)"
          />
          <text x="200" y="244" className="sapviz__coreT">
            SAP
          </text>
          <text x="200" y="268" className="sapviz__coreT">
            BTP
          </text>
        </motion.g>

        {/* scanning sweep */}
        <rect
          x="0"
          y="0"
          width="400"
          height="70"
          className="sapviz__sweep"
        />
      </svg>

      <div className="sapviz__term">
        <span className="sapviz__prompt">$</span>
        <span className="sapviz__cmd">{typed}</span>
        <span className="sapviz__caret" />
      </div>
    </div>
  );
}
