// src/components/site/SocialIcons.jsx
// Instagram and Facebook, as plain round icon links.
//
// The addresses live in AUTHOR.connect.social (src/data/books.js). An icon
// whose address is not set yet is drawn but is not a link — it never points
// anywhere that was guessed. Set the address and it becomes one.

import React from "react";
import { AUTHOR } from "../../data/books";

export function IconInstagram(props) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconFacebook(props) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
      <path d="M13.6 21v-7.6h2.6l.4-3h-3V8.5c0-.9.3-1.5 1.5-1.5h1.6V4.3c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.2H8v3h2.6V21h3z" />
    </svg>
  );
}

export function IconLinkedIn(props) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
      <path d="M6.2 8.6h-3V20h3V8.6zM4.7 3.7a1.75 1.75 0 100 3.5 1.75 1.75 0 000-3.5zM20.5 20v-6.3c0-3.1-1.7-4.6-3.9-4.6-1.8 0-2.6 1-3 1.7V8.6h-3V20h3v-6.1c0-1.6.3-3.2 2.3-3.2s2 1.8 2 3.3V20h2.6z" />
    </svg>
  );
}

const NETWORKS = [
  { key: "instagram", label: "Instagram", Icon: IconInstagram },
  { key: "facebook", label: "Facebook", Icon: IconFacebook },
  { key: "linkedin", label: "LinkedIn", Icon: IconLinkedIn },
];

export default function SocialIcons({ className = "", size = "md" }) {
  const social = (AUTHOR.connect && AUTHOR.connect.social) || {};

  return (
    <span className={`social social--${size} ${className}`}>
      {NETWORKS.map(({ key, label, Icon }) => {
        const href = social[key];
        if (href) {
          return (
            <a
              key={key}
              className="social__a"
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${label} पर ${AUTHOR.name}`}
              title={label}
            >
              <Icon />
            </a>
          );
        }
        // no address yet: the icon is there, the link is not
        return (
          <span
            key={key}
            className="social__a is-soon"
            role="img"
            aria-label={`${label} — जल्द`}
            title={`${label} — जल्द`}
          >
            <Icon />
          </span>
        );
      })}
    </span>
  );
}
