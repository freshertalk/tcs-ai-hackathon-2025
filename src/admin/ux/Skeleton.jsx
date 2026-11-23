// A loading placeholder: the shape of what is coming, shimmering softly, with the words for screen readers (and tests) kept —
// "Reading the trade setup…" is still in the page, only shown as bars instead of a lonely line of text.

import React from "react";

export default function Skeleton({ label = "Loading…", lines = 3, tiles = 0, className = "" }) {
  return (
    <div className={`ux-skel ${className}`.trim()} role="status" aria-live="polite" aria-busy="true">
      <span className="adm-sr">{label}</span>
      {tiles > 0 && (
        <div className="ux-skel__tiles" aria-hidden="true">
          {Array.from({ length: tiles }, (_, i) => (
            <i key={i} className="ux-skel__tile" />
          ))}
        </div>
      )}
      {Array.from({ length: lines }, (_, i) => (
        <i key={i} className="ux-skel__line" style={{ width: `${[92, 76, 84, 58, 70][i % 5]}%` }} aria-hidden="true" />
      ))}
    </div>
  );
}
