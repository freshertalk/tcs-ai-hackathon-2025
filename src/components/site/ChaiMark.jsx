// src/components/site/ChaiMark.jsx
// "दो कुल्हड़ चाय": two clay cups brimming with tea, steam curling up and away
// from the top of each.
//
// The steam is plain CSS (see .chai in src/styles/auth.css), so a mark on every
// page costs no JavaScript, and it stops for anyone who asks their system for
// less motion. Colours come from CSS variables, so the same mark sits on the
// cream navigation bar and on the navy sign-in panel.

import React, { useId } from "react";

// Three wisps per cup. Each is one soft S-curve; the animation lifts and
// thins it, so they read as vapour rather than as lines.
const WISPS = [
  { x: 32, d: "M0 0 C -5 -9, 5 -15, 0 -24 C -4 -30, 3 -34, -1 -42", delay: "0s" },
  { x: 42, d: "M0 0 C 5 -10, -5 -17, 1 -27 C 5 -33, -3 -38, 1 -46", delay: "1.1s" },
  { x: 52, d: "M0 0 C -4 -8, 4 -14, 0 -22 C -3 -28, 3 -31, 0 -38", delay: "2.2s" },
];

function Cup({ id, rotate, dx, delayShift }) {
  return (
    <g transform={`translate(${dx} 0) rotate(${rotate} 40 96)`}>
      {/* steam first, so the rim sits in front of where it starts */}
      <g className="chai__steam">
        {WISPS.map((w, i) => (
          <path
            key={i}
            d={w.d}
            transform={`translate(${w.x} 36)`}
            style={{ animationDelay: `calc(${w.delay} + ${delayShift}s)` }}
          />
        ))}
      </g>

      {/* the clay: wider at the lip, narrowing to a flat foot */}
      <path
        d="M14 36 C15 56 20 80 26 94 Q27 98 31 98 H49 Q53 98 54 94 C60 80 65 56 66 36 Z"
        fill={`url(#${id}-clay)`}
      />
      {/* turned rings */}
      <g stroke="rgba(60,25,10,0.26)" strokeWidth="0.9" fill="none" strokeLinecap="round">
        <path d="M17.2 52 C32 56 48 56 62.8 52" />
        <path d="M20.2 67 C33 70.6 47 70.6 59.8 67" />
        <path d="M23.4 82 C34 84.8 46 84.8 56.6 82" />
      </g>
      {/* light on the left shoulder */}
      <path d="M16 38 C17.5 58 21.5 78 26.5 91" stroke="rgba(255,236,210,0.5)" strokeWidth="2.2" fill="none" strokeLinecap="round" />

      {/* the rim, and tea right up to it */}
      <ellipse cx="40" cy="36" rx="26" ry="7.4" fill="#7a3d22" />
      <ellipse cx="40" cy="36.6" rx="22.6" ry="5.7" fill={`url(#${id}-tea)`} />
      {/* the skin catching the light, and a little froth */}
      <ellipse cx="37" cy="35.2" rx="12" ry="2.1" fill="rgba(255,226,170,0.55)" />
      <circle cx="47.5" cy="37.4" r="1.5" fill="rgba(255,240,205,0.85)" />
      <circle cx="30.5" cy="37.9" r="1.1" fill="rgba(255,240,205,0.75)" />
      <circle cx="43" cy="39" r="0.9" fill="rgba(255,240,205,0.7)" />
    </g>
  );
}

export default function ChaiMark({ size = 64, steam = true, className = "", title }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const a = `${uid}a`;
  const b = `${uid}b`;
  // the drawing is 160 x 112: 40 units of steam above 72 of cup
  const w = Math.round(size * (160 / 112));

  return (
    <svg
      className={`chai ${steam ? "" : "chai--still"} ${className}`}
      width={w}
      height={size}
      viewBox="0 -12 160 112"
      role={title ? "img" : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : "true"}
      focusable="false"
    >
      <defs>
        {[a, b].map((id) => (
          <React.Fragment key={id}>
            <linearGradient id={`${id}-clay`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#e08f58" />
              <stop offset="52%" stopColor="#b5593a" />
              <stop offset="100%" stopColor="#6a3320" />
            </linearGradient>
            <linearGradient id={`${id}-tea`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f0b54a" />
              <stop offset="100%" stopColor="#a8601f" />
            </linearGradient>
          </React.Fragment>
        ))}
      </defs>
      {title ? <title>{title}</title> : null}
      <Cup id={a} rotate={-5} dx={-1} delayShift={0} />
      <Cup id={b} rotate={5} dx={81} delayShift={0.6} />
    </svg>
  );
}
