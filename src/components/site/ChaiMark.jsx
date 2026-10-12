// src/components/site/ChaiMark.jsx
// "दो कुल्हड़ चाय": two unglazed clay cups of tea, steam rising off the tea
// and drifting up and out over the rim.
//
// How it is drawn, so it stays right
//   • Each wisp has TWO wrappers: an outer <g transform="translate(x y)"> that
//     only positions it on the tea and is never animated, and an inner <g>
//     that CSS animates. (CSS `transform` replaces an SVG transform attribute
//     on the same element — animating the positioned element is what once
//     sent every wisp to the corner of the cup.)
//   • The steam is a soft, blurred stroke that is densest where it leaves the
//     tea and thins to nothing as it climbs, so it reads as vapour.
//   • Light comes from the upper left: a lit left shoulder, a darker right
//     side, ambient shadow toward the foot, the rim's lip catching light, and
//     tea with a creamy skin and a shadowed back wall of the cup above it.
//
// Colours of the steam come from the CSS variable --chai-steam, so the same
// mark sits on a cream bar and on the navy sign-in panel. The movement is plain
// CSS (src/styles/auth.css) and stops for anyone who asks for less motion.

import React, { useId } from "react";

// cup cell: 80 wide, rim at y = 35, foot at y = 98.5. x is across the tea.
const WISPS = [
  { x: 33, h: 44, w: 5.4, dur: 4.6, delay: 0.0, sway: -3.2 },
  { x: 39.5, h: 50, w: 6.2, dur: 5.2, delay: 1.4, sway: 2.6 },
  { x: 46, h: 42, w: 5.0, dur: 4.2, delay: 2.5, sway: -2.2 },
  { x: 51, h: 36, w: 4.2, dur: 4.9, delay: 0.8, sway: 2.8 },
];

// a few flecks in the clay, fixed so the mark never shimmers between renders
const SPECKS = [
  [22, 52, 0.7], [31, 47, 0.5], [47, 50, 0.6], [57, 57, 0.7], [27, 66, 0.6],
  [38, 62, 0.5], [51, 70, 0.7], [60, 49, 0.5], [34, 78, 0.6], [45, 84, 0.5],
  [55, 80, 0.6], [29, 88, 0.5], [41, 73, 0.4], [20, 60, 0.5],
];

const BODY =
  "M14.5 35 C15.5 57 21 82 27 94.5 Q28.2 98.5 32 98.5 H48 Q51.8 98.5 53 94.5 C59 82 64.5 57 65.5 35 Z";

function wisp(h) {
  // one slow S-curve, rising from (0,0)
  return `M0 0 C -5 ${-h * 0.2}, 6 ${-h * 0.42}, 0 ${-h * 0.62} S -5 ${-h * 0.87}, 1.2 ${-h}`;
}

function Cup({ id, rotate, dx, phase }) {
  return (
    <g transform={`translate(${dx} 0) rotate(${rotate} 40 98)`}>
      {/* contact shadow */}
      <ellipse cx="40" cy="99.4" rx="26" ry="3.4" fill="rgba(38,18,6,0.34)" filter={`url(#${id}-soft)`} />

      {/* the steam first, so the lip is in front of where it starts */}
      <g filter={`url(#${id}-blur)`}>
        {WISPS.map((w, i) => (
          <g key={i} transform={`translate(${w.x} 34)`}>
            <g
              className="chai__w"
              style={{
                "--d": `${w.dur}s`,
                "--sway": `${w.sway}px`,
                animationDelay: `${w.delay + phase}s`,
              }}
            >
              <path d={wisp(w.h)} fill="none" stroke={`url(#${id}-steam)`} strokeWidth={w.w} strokeLinecap="round" />
            </g>
          </g>
        ))}
      </g>

      {/* the clay */}
      <path d={BODY} fill={`url(#${id}-clay)`} />
      <path d={BODY} fill={`url(#${id}-ao)`} />
      {/* turned rings, each with a lit edge beneath it */}
      <g fill="none" strokeLinecap="round">
        <path d="M17.6 52 C32 56.5 48 56.5 62.4 52" stroke="rgba(52,22,8,0.30)" strokeWidth="1" />
        <path d="M17.6 53.1 C32 57.6 48 57.6 62.4 53.1" stroke="rgba(255,214,168,0.20)" strokeWidth="0.8" />
        <path d="M20.4 67 C33 71 47 71 59.6 67" stroke="rgba(52,22,8,0.30)" strokeWidth="1" />
        <path d="M20.4 68.1 C33 72.1 47 72.1 59.6 68.1" stroke="rgba(255,214,168,0.18)" strokeWidth="0.8" />
        <path d="M23.4 82 C34 85 46 85 56.6 82" stroke="rgba(52,22,8,0.30)" strokeWidth="1" />
        <path d="M23.4 83.1 C34 86.1 46 86.1 56.6 83.1" stroke="rgba(255,214,168,0.16)" strokeWidth="0.8" />
      </g>
      {SPECKS.map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill="rgba(48,20,6,0.38)" />
      ))}
      {/* light down the left shoulder, a little reflected warmth on the right */}
      <path d="M17.5 40 C18.6 58 23 78 28.5 91" stroke="rgba(255,226,190,0.5)" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <path d="M62 44 C60.6 62 56.4 78 51.6 90" stroke="rgba(255,170,110,0.22)" strokeWidth="2" fill="none" strokeLinecap="round" />

      {/* inside: the shadowed back wall, then the tea */}
      <ellipse cx="40" cy="35" rx="25.5" ry="7.3" fill="#3f1b0b" />
      <ellipse cx="40" cy="36.1" rx="22.8" ry="5.6" fill={`url(#${id}-tea)`} />
      {/* creamy skin and a bright meniscus where the tea meets the clay */}
      <ellipse cx="37.5" cy="35.4" rx="13.5" ry="2.5" fill={`url(#${id}-skin)`} />
      <path d="M18 36.2 A22.8 5.6 0 0 0 62 36.2" fill="none" stroke="rgba(255,236,196,0.55)" strokeWidth="0.9" />
      <circle cx="47" cy="37.8" r="1.2" fill="rgba(255,240,210,0.8)" />
      <circle cx="30.5" cy="38" r="0.9" fill="rgba(255,240,210,0.7)" />

      {/* the lip: thickness at the front, a dark line behind */}
      <path d="M14.6 35 A25.4 7.2 0 0 0 65.4 35" fill="none" stroke={`url(#${id}-lip)`} strokeWidth="1.9" strokeLinecap="round" />
      <path d="M14.6 35 A25.4 7.2 0 0 1 65.4 35" fill="none" stroke="rgba(30,10,2,0.55)" strokeWidth="0.8" />
    </g>
  );
}

export default function ChaiMark({ size = 64, steam = true, className = "", title }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const a = `${uid}a`;
  const b = `${uid}b`;
  // drawn 160 x 122: 46 units of headroom for the steam above 76 of cup
  const w = Math.round(size * (160 / 122));

  return (
    <svg
      className={`chai ${steam ? "" : "chai--still"} ${className}`}
      width={w}
      height={size}
      viewBox="0 -24 160 122"
      role={title ? "img" : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : "true"}
      focusable="false"
      style={{ color: "var(--chai-steam, #9a6c50)" }}
    >
      <defs>
        {[a, b].map((id) => (
          <React.Fragment key={id}>
            <linearGradient id={`${id}-clay`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#74361d" />
              <stop offset="0.2" stopColor="#b3622f" />
              <stop offset="0.46" stopColor="#dc9560" />
              <stop offset="0.72" stopColor="#b9663a" />
              <stop offset="1" stopColor="#64301a" />
            </linearGradient>
            <linearGradient id={`${id}-ao`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="rgba(30,12,4,0)" />
              <stop offset="0.62" stopColor="rgba(30,12,4,0)" />
              <stop offset="1" stopColor="rgba(30,12,4,0.5)" />
            </linearGradient>
            <radialGradient id={`${id}-tea`} cx="0.45" cy="0.4" r="0.75">
              <stop offset="0" stopColor="#f0c27c" />
              <stop offset="0.55" stopColor="#c98c3c" />
              <stop offset="1" stopColor="#8a5016" />
            </radialGradient>
            <radialGradient id={`${id}-skin`} cx="0.5" cy="0.5" r="0.6">
              <stop offset="0" stopColor="rgba(255,238,200,0.75)" />
              <stop offset="1" stopColor="rgba(255,238,200,0)" />
            </radialGradient>
            <linearGradient id={`${id}-lip`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#f0b78a" />
              <stop offset="0.5" stopColor="#f6c9a0" />
              <stop offset="1" stopColor="#d98e5e" />
            </linearGradient>
            {/* densest at the tea, gone by the top of the wisp */}
            <linearGradient id={`${id}-steam`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="-52">
              <stop offset="0" stopColor="currentColor" stopOpacity="0.85" />
              <stop offset="0.55" stopColor="currentColor" stopOpacity="0.4" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
            <filter id={`${id}-blur`} x="-60%" y="-30%" width="220%" height="160%">
              <feGaussianBlur stdDeviation="1.15" />
            </filter>
            <filter id={`${id}-soft`} x="-30%" y="-100%" width="160%" height="300%">
              <feGaussianBlur stdDeviation="1.6" />
            </filter>
          </React.Fragment>
        ))}
      </defs>
      {title ? <title>{title}</title> : null}
      <Cup id={a} rotate={-4} dx={-1} phase={0} />
      <Cup id={b} rotate={4} dx={81} phase={0.9} />
    </svg>
  );
}
