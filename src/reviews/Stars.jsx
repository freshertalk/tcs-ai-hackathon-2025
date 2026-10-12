// src/reviews/Stars.jsx
// Five stars, to look at and to press.

import React, { useState } from "react";

const STAR = "M12 2.6l2.9 6.1 6.7.8-4.9 4.6 1.3 6.6L12 17.4l-6 3.3 1.3-6.6L2.4 9.5l6.7-.8L12 2.6z";

export const STAR_WORDS = ["बहुत कमज़ोर", "कमज़ोर", "ठीक-ठाक", "अच्छी", "बेहतरीन"];

function Row({ size }) {
  return (
    <span className="stars__row" style={{ "--s": `${size}px` }} aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <svg key={i} viewBox="0 0 24 24" width={size} height={size} fill="currentColor" focusable="false">
          <path d={STAR} />
        </svg>
      ))}
    </span>
  );
}

/** A rating shown, to a tenth: a grey row with a gold row cut to width over it. */
export function StarRow({ value = 0, size = 18, label }) {
  const pct = Math.max(0, Math.min(5, value)) * 20;
  return (
    <span
      className="stars"
      role="img"
      aria-label={label || `पाँच में से ${Number(value).toFixed(1)}`}
      style={{ "--s": `${size}px` }}
    >
      <span className="stars__base">
        <Row size={size} />
      </span>
      <span className="stars__fill" style={{ width: `${pct}%` }}>
        <Row size={size} />
      </span>
    </span>
  );
}

/** A rating given: five pressable stars with a word for each. */
export function StarInput({ value, onChange, size = 38, disabled = false }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value || 0;

  const onKey = (e, n) => {
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      onChange(Math.min(5, (value || n) + (value ? 1 : 0)));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      onChange(Math.max(1, (value || n) - 1));
    }
  };

  return (
    <div className="stari">
      <div
        className="stari__row"
        role="radiogroup"
        aria-label="आपकी रेटिंग, पाँच में से"
        onMouseLeave={() => setHover(0)}
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} — ${STAR_WORDS[n - 1]}`}
            tabIndex={value === n || (!value && n === 1) ? 0 : -1}
            disabled={disabled}
            className={`stari__b ${n <= shown ? "is-on" : ""}`}
            onMouseEnter={() => setHover(n)}
            onFocus={() => setHover(0)}
            onClick={() => onChange(n)}
            onKeyDown={(e) => onKey(e, n)}
          >
            <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
              <path d={STAR} />
            </svg>
          </button>
        ))}
      </div>
      <span className="stari__word" aria-live="polite">
        {shown ? STAR_WORDS[shown - 1] : "तारे दबाकर बताइए"}
      </span>
    </div>
  );
}
