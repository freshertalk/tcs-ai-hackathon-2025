// src/reader/icons.jsx
// A small, consistent icon set for the reader chrome — 24px grid, 1.6 stroke.

import React from "react";

const base = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false,
};

const make = (paths) =>
  function Icon(props) {
    return (
      <svg {...base} {...props}>
        {paths}
      </svg>
    );
  };

export const IconEye = make(
  <>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </>
);
export const IconBack = make(<path d="M15 5l-7 7 7 7" />);
export const IconNext = make(<path d="M9 5l7 7-7 7" />);
export const IconClose = make(<path d="M6 6l12 12M18 6L6 18" />);
export const IconList = make(
  <>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" strokeWidth="2.6" />
  </>
);
export const IconSearch = make(
  <>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5" />
  </>
);
export const IconType = make(
  <>
    <path d="M3 19L8.5 5 14 19M5 14h7" />
    <path d="M15.5 19l3-8 3 8M16.6 16.5h3.8" />
  </>
);
export const IconFull = make(<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />);
export const IconShare = make(
  <>
    <path d="M12 15V4M8 8l4-4 4 4" />
    <path d="M5 13v6h14v-6" />
  </>
);
export const IconDownload = make(
  <>
    <path d="M12 4v11M8 11l4 4 4-4" />
    <path d="M5 19h14" />
  </>
);
export const IconCheck = make(<path d="M5 12.5l4.5 4.5L19 7.5" />);
export const IconBook = make(
  <>
    <path d="M4 5.5C4 4.7 4.7 4 5.5 4H11v15H5.5C4.7 19 4 18.3 4 17.5z" />
    <path d="M20 5.5c0-.8-.7-1.5-1.5-1.5H13v15h5.5c.8 0 1.5-.7 1.5-1.5z" />
  </>
);
export const IconScroll = make(
  <>
    <rect x="6" y="3.5" width="12" height="17" rx="2" />
    <path d="M12 8v6M9.5 11.5L12 14l2.5-2.5" />
  </>
);
export const IconPages = make(
  <>
    <rect x="3.5" y="5" width="7.5" height="14" rx="1.5" />
    <rect x="13" y="5" width="7.5" height="14" rx="1.5" />
  </>
);

export const IconBookmark = make(<path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z" />);
export const IconBookmarkFill = (props) => (
  <svg {...base} {...props} fill="currentColor">
    <path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z" />
  </svg>
);
export const IconSun = make(
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6" />
  </>
);
export const IconNote = make(
  <>
    <path d="M5 4.5h14a1 1 0 0 1 1 1V15l-5 5H5a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1z" />
    <path d="M15 20v-4a1 1 0 0 1 1-1h4" />
  </>
);
export const IconHighlight = make(
  <>
    <path d="M14.5 4.5l5 5-8 8H6.5v-5z" />
    <path d="M4 21h16" />
  </>
);
export const IconTrash = make(
  <>
    <path d="M5 7h14M10 7V4.5h4V7M7 7l1 12.5h8L17 7" />
  </>
);
export const IconExpand = make(
  <>
    <path d="M14 4h6v6M10 20H4v-6" />
    <path d="M20 4l-7 7M4 20l7-7" />
  </>
);
export const IconReturn = make(
  <>
    <path d="M9 7L4 12l5 5" />
    <path d="M4 12h11a5 5 0 0 1 5 5" />
  </>
);
