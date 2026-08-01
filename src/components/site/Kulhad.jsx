// src/components/site/Kulhad.jsx
// The clay cup + rising steam. Used in the preloader, hero and book cover.

import React from "react";
import { motion } from "framer-motion";

const steamPath = (x) =>
  `M${x} 34 C ${x - 5} 24, ${x + 5} 18, ${x} 8 C ${x - 4} 2, ${x + 3} -2, ${x} -8`;

export default function Kulhad({
  size = 92,
  steam = true,
  tone = "#B0563A",
  steamColor = "currentColor",
  steamOpacity = 0.45,
}) {
  return (
    <svg
      width={size}
      height={size * 1.12}
      viewBox="0 0 80 90"
      fill="none"
      aria-hidden="true"
      style={{ overflow: "visible", color: "var(--accent-2)" }}
    >
      <defs>
        <linearGradient id="clay" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#D8834F" />
          <stop offset="55%" stopColor={tone} />
          <stop offset="100%" stopColor="#6F3A22" />
        </linearGradient>
        <linearGradient id="tea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#E9A93C" />
          <stop offset="100%" stopColor="#B26A2C" />
        </linearGradient>
      </defs>

      {steam && (
        <g
          stroke={steamColor}
          strokeOpacity={steamOpacity}
          strokeWidth="1.5"
          strokeLinecap="round"
          fill="none"
        >
          {[28, 40, 52].map((x, i) => (
            <motion.path
              key={x}
              d={steamPath(x)}
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{
                pathLength: [0, 1, 1],
                opacity: [0, 0.85, 0],
                y: [6, -8, -16],
              }}
              transition={{
                duration: 3.6,
                repeat: Infinity,
                delay: i * 0.75,
                ease: "easeInOut",
              }}
            />
          ))}
        </g>
      )}

      {/* cup */}
      <path
        d="M16 38 h48 l-6 40 a6 6 0 0 1 -6 5 h-24 a6 6 0 0 1 -6 -5 z"
        fill="url(#clay)"
      />
      {/* rim */}
      <ellipse cx="40" cy="38" rx="24" ry="6.5" fill="#8C4B2F" />
      <ellipse cx="40" cy="38" rx="19.5" ry="4.6" fill="url(#tea)" />
      {/* throwing lines on the clay */}
      <g stroke="rgba(0,0,0,0.20)" strokeWidth="0.9">
        <path d="M19 50 h42" />
        <path d="M20.5 60 h39" />
        <path d="M22 70 h36" />
      </g>
      <path
        d="M16 38 h6 l-5 42 a6 6 0 0 0 1 3 h-2 a6 6 0 0 1 -6 -5 z"
        fill="rgba(255,255,255,0.10)"
      />
    </svg>
  );
}
