// src/reader/prefs.js
// Reading preferences. Saved once and shared by every book, because how you
// like to read does not change with the title.

import { useCallback, useEffect, useMemo, useState } from "react";

// v4: the book opens on white at a larger size — earlier saved choices are
// let go rather than carried into different defaults
const KEY = "vkt.reader.prefs.v4";

export const THEMES = [
  { id: "auto", label: "स्वतः", note: "System", bg: "linear-gradient(135deg,#faf4e9 50%,#15181e 50%)", fg: "#2a2018" },
  { id: "paper", label: "काग़ज़", note: "Paper", bg: "#faf4e9", fg: "#2a2018" },
  { id: "white", label: "सफ़ेद", note: "White", bg: "#ffffff", fg: "#161616" },
  { id: "sepia", label: "सेपिया", note: "Sepia", bg: "#efe0bf", fg: "#3a2a17" },
  { id: "night", label: "रात", note: "Night", bg: "#15181e", fg: "#d8d3c8" },
  { id: "black", label: "काला", note: "Black", bg: "#000000", fg: "#c9c4b9" },
];

// Browser-bar colour for each resolved theme.
export const THEME_BG = {
  paper: "#faf4e9",
  white: "#ffffff",
  sepia: "#efe0bf",
  night: "#15181e",
  black: "#000000",
};

// One face, by design: every book is set in Noto Sans Devanagari.
export const FONTS = [
  {
    id: "sans",
    label: "Noto Sans Devanagari",
    css: '"Noto Sans Devanagari", "Nirmala UI", "Mangal", system-ui, sans-serif',
  },
];

// Measured in em, so a line holds about the same number of words whatever
// the type size — 12px text and 24px text both get a comfortable line.
export const WIDTHS = [
  { id: "narrow", label: "संकरा", em: 30 },
  { id: "medium", label: "मध्यम", em: 38 },
  { id: "wide", label: "चौड़ा", em: 48 },
];

export const SIZE = { min: 10, max: 36, step: 1 };
export const DEFAULT_SIZE = 20;
const DEFAULT_SIZE_PHONE = 18;
// How a page turns.
export const TURNS = [
  { id: "page", label: "पन्ना पलटना" },
  { id: "slide", label: "सरकना" },
  { id: "fade", label: "धुँधलाना" },
  { id: "none", label: "सीधा" },
];

// What the small line at the bottom of the page says; a tap steps through.
export const PROGRESS = ["page", "chapter", "book", "percent"];

export const LINES = [
  { id: 1.7, label: "सघन" },
  { id: 1.9, label: "सामान्य" },
  { id: 2.15, label: "खुला" },
];

function defaults() {
  return {
    theme: "white",
    font: "sans",
    size:
      typeof window !== "undefined" && window.innerWidth < 640 ? DEFAULT_SIZE_PHONE : DEFAULT_SIZE,
    line: 1.9,
    width: "medium",
    align: "left",
    mode: "paged",
    awake: false,
    bold: false,
    brightness: 1, // 0.35 – 1
    warm: 0, // 0 – 1, an amber wash like a night light
    turn: "page",
    sound: false,
    haptic: true,
    progress: "page",
  };
}

function load() {
  const base = defaults();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    return raw && typeof raw === "object" ? { ...base, ...raw } : base;
  } catch {
    return base;
  }
}

function systemDark() {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

export default function useReaderPrefs() {
  const [prefs, setPrefs] = useState(load);
  const [dark, setDark] = useState(systemDark);

  useEffect(() => {
    let mq;
    try {
      mq = window.matchMedia("(prefers-color-scheme: dark)");
    } catch {
      return undefined;
    }
    const on = () => setDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const update = useCallback((patch) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* preferences just won't persist */
      }
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    setPrefs(defaults());
  }, []);

  const resolvedTheme = useMemo(
    () => (prefs.theme === "auto" ? (dark ? "night" : "paper") : prefs.theme),
    [prefs.theme, dark]
  );

  return { prefs, update, reset, resolvedTheme };
}
