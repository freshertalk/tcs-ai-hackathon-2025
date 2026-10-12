// src/components/site/usePrivatePage.js
// Account and admin pages are for one person: give them a title, and tell
// search engines not to list them.

import { useEffect } from "react";

export default function usePrivatePage(title) {
  useEffect(() => {
    const prev = document.title;
    document.title = `${title} — दो कुल्हड़ चाय`;
    let meta = document.querySelector('meta[name="robots"]');
    const made = !meta;
    const before = meta ? meta.getAttribute("content") : null;
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "robots");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", "noindex, nofollow");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#faf4e9");
    return () => {
      document.title = prev;
      if (made) meta.remove();
      else if (before !== null) meta.setAttribute("content", before);
    };
  }, [title]);
}
