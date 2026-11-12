// Light or dark, for the Stock Report's trading pages only. Remembered in the browser;
// follows the system setting until a choice is made.

import { useEffect, useState } from "react";

const THEME_KEY = "vpt.desk.theme";

export function useDeskTheme() {
  const [theme, setTheme] = useState(() => {
    try {
      const saved = window.localStorage.getItem(THEME_KEY);
      if (saved === "dark" || saved === "light") return saved;
    } catch (_) {
      /* private mode */
    }
    return typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  useEffect(() => {
    const el = document.querySelector(".adm");
    if (!el) return undefined;
    el.setAttribute("data-desk", theme);
    return () => el.removeAttribute("data-desk");
  }, [theme]);
  const toggle = () =>
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      try {
        window.localStorage.setItem(THEME_KEY, next);
      } catch (_) {
        /* private mode */
      }
      return next;
    });
  return [theme, toggle];
}
