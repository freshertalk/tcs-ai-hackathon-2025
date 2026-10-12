// src/components/ui/icons.jsx
// One small family of line icons for the account and admin screens: 24px grid,
// 1.7 stroke, round caps — so they sit together and take the text colour.

import React from "react";

function Icon({ size = 20, children, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Sign in: a person stepping through a doorway. */
export const IconSignIn = (p) => (
  <Icon {...p}>
    <path d="M14.5 4.5h3A2.5 2.5 0 0 1 20 7v10a2.5 2.5 0 0 1-2.5 2.5h-3" />
    <path d="M4 12h10" />
    <path d="m10.5 8 4 4-4 4" />
  </Icon>
);

export const IconSignOut = (p) => (
  <Icon {...p}>
    <path d="M9.5 4.5h-3A2.5 2.5 0 0 0 4 7v10a2.5 2.5 0 0 0 2.5 2.5h3" />
    <path d="M10 12h10" />
    <path d="m16.5 8 4 4-4 4" />
  </Icon>
);

export const IconUser = (p) => (
  <Icon {...p}>
    <circle cx="12" cy="8.2" r="3.6" />
    <path d="M4.8 20c.9-3.6 3.7-5.4 7.2-5.4s6.3 1.8 7.2 5.4" />
  </Icon>
);

export const IconDashboard = (p) => (
  <Icon {...p}>
    <rect x="3.5" y="3.5" width="7" height="8.5" rx="1.6" />
    <rect x="13.5" y="3.5" width="7" height="5" rx="1.6" />
    <rect x="13.5" y="11.5" width="7" height="9" rx="1.6" />
    <rect x="3.5" y="15" width="7" height="5.5" rx="1.6" />
  </Icon>
);

export const IconShield = (p) => (
  <Icon {...p}>
    <path d="M12 3.2 4.8 6v5.6c0 4.3 3 7.6 7.2 9.2 4.2-1.6 7.2-4.9 7.2-9.2V6z" />
    <path d="m8.8 12.2 2.2 2.2 4.2-4.4" />
  </Icon>
);

export const IconChart = (p) => (
  <Icon {...p}>
    <path d="M4 20V4" />
    <path d="M4 20h16" />
    <path d="m7.5 15 3.5-4.5 3 2.5 4.5-6" />
  </Icon>
);

export const IconUsers = (p) => (
  <Icon {...p}>
    <circle cx="9" cy="8.5" r="3.2" />
    <path d="M3 19.5c.7-3.1 3-4.7 6-4.7s5.3 1.6 6 4.7" />
    <path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8" />
    <path d="M17.5 14.9c1.7.6 2.9 2 3.5 4.6" />
  </Icon>
);

export const IconTag = (p) => (
  <Icon {...p}>
    <path d="M3.5 12.4V4.6a1 1 0 0 1 1-1h7.8a1 1 0 0 1 .7.3l7.4 7.4a1 1 0 0 1 0 1.4l-7.8 7.8a1 1 0 0 1-1.4 0l-7.4-7.4a1 1 0 0 1-.3-.7z" />
    <circle cx="8" cy="8" r="1.4" />
  </Icon>
);

export const IconList = (p) => (
  <Icon {...p}>
    <path d="M8.5 6.5H20M8.5 12H20M8.5 17.5H20" />
    <path d="M4 6.5h.01M4 12h.01M4 17.5h.01" strokeWidth="2.4" />
  </Icon>
);

export const IconClock = (p) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
);

export const IconStar = (p) => (
  <Icon {...p}>
    <path d="m12 3.6 2.5 5.2 5.7.8-4.1 4 1 5.7L12 16.6l-5.1 2.7 1-5.7-4.1-4 5.7-.8z" />
  </Icon>
);

export const IconDownload = (p) => (
  <Icon {...p}>
    <path d="M12 4v11" />
    <path d="m7.5 11 4.5 4.5 4.5-4.5" />
    <path d="M4.5 19.5h15" />
  </Icon>
);

export const IconTrash = (p) => (
  <Icon {...p}>
    <path d="M4.5 7h15" />
    <path d="M9.5 7V4.8h5V7" />
    <path d="M6.5 7l.8 12.2a1.5 1.5 0 0 0 1.5 1.3h6.4a1.5 1.5 0 0 0 1.5-1.3L17.5 7" />
    <path d="M10 11v6M14 11v6" />
  </Icon>
);

export const IconRefresh = (p) => (
  <Icon {...p}>
    <path d="M19.5 12a7.5 7.5 0 1 1-2.4-5.5" />
    <path d="M19.5 4.5v4h-4" />
  </Icon>
);

export const IconPlus = (p) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const IconCheck = (p) => (
  <Icon {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
);

export const IconBook = (p) => (
  <Icon {...p}>
    <path d="M4.5 5.2c2.6-.9 5.1-.7 7.5.9 2.4-1.6 4.9-1.8 7.5-.9v13.3c-2.6-.9-5.1-.7-7.5.9-2.4-1.6-4.9-1.8-7.5-.9z" />
    <path d="M12 6.1v13.3" />
  </Icon>
);

export const IconBookmark = (p) => (
  <Icon {...p}>
    <path d="M6.5 4.5h11v15.2L12 15.8l-5.5 3.9z" />
  </Icon>
);

export const IconLock = (p) => (
  <Icon {...p}>
    <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
  </Icon>
);

export const IconEye = (p) => (
  <Icon {...p}>
    <path d="M2.8 12S6 6 12 6s9.2 6 9.2 6-3.2 6-9.2 6-9.2-6-9.2-6z" />
    <circle cx="12" cy="12" r="2.6" />
  </Icon>
);

export const IconArrowUp = (p) => (
  <Icon {...p}>
    <path d="M12 19V5M6.5 10.5 12 5l5.5 5.5" />
  </Icon>
);

export const IconArrowDown = (p) => (
  <Icon {...p}>
    <path d="M12 5v14M6.5 13.5 12 19l5.5-5.5" />
  </Icon>
);

export const IconPause = (p) => (
  <Icon {...p}>
    <path d="M9 5.5v13M15 5.5v13" />
  </Icon>
);

export const IconPlay = (p) => (
  <Icon {...p}>
    <path d="M8 5.5v13l10.5-6.5z" />
  </Icon>
);

export const IconCopy = (p) => (
  <Icon {...p}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
    <path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
  </Icon>
);

export const IconSearch = (p) => (
  <Icon {...p}>
    <circle cx="10.5" cy="10.5" r="6" />
    <path d="m15 15 5 5" />
  </Icon>
);

export const IconAlert = (p) => (
  <Icon {...p}>
    <path d="M12 4 3 19.5h18z" />
    <path d="M12 10v4.5M12 17.4h.01" />
  </Icon>
);

export const IconHome = (p) => (
  <Icon {...p}>
    <path d="m4 11 8-6.5L20 11" />
    <path d="M6 9.5v9.7h12V9.5" />
  </Icon>
);

/** Google’s own four-colour "G", as a mark (brand colours, not currentColor). */
export function GoogleG({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z" />
      <path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 010-9.4l-7.9-6.1a24 24 0 000 21.6l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.8 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}
