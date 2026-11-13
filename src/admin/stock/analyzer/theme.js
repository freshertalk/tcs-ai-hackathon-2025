// Light or dark for the private area. Dark by default (the trading terminal is built for it);
// a choice is remembered in the browser. One shared value: every screen that asks for it sees
// the same theme, and a toggle anywhere changes it everywhere at once.

import { useEffect, useState } from "react";

const THEME_KEY = "vpt.desk.theme";

const stored = () => {
  try {
    const saved = window.localStorage.getItem(THEME_KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch (_) {
    /* private mode */
  }
  return "dark";
};

let current = null;
const listeners = new Set();
let users = 0; // screens currently showing the theme: the attribute goes when the last one leaves

const apply = () => {
  const el = typeof document !== "undefined" ? document.querySelector(".adm") : null;
  if (!el) return;
  if (users > 0) el.setAttribute("data-desk", current);
  else el.removeAttribute("data-desk");
};

export function setDeskTheme(next) {
  current = next === "light" ? "light" : "dark";
  try {
    window.localStorage.setItem(THEME_KEY, current);
  } catch (_) {
    /* private mode — the choice lasts for this visit */
  }
  apply();
  listeners.forEach((fn) => fn(current));
}

export function useDeskTheme() {
  if (current === null) current = stored();
  const [theme, setTheme] = useState(current);
  useEffect(() => {
    listeners.add(setTheme);
    users += 1;
    setTheme(current);
    apply();
    return () => {
      listeners.delete(setTheme);
      users -= 1;
      apply();
    };
  }, []);
  const toggle = () => setDeskTheme(current === "dark" ? "light" : "dark");
  return [theme, toggle];
}
