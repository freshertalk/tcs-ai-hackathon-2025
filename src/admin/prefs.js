// Your preferences for the private area (chosen on /me → Customize, kept on the server so they follow you to every
// device): how it looks, which workspaces the terminal shows and in what order, where it opens, how the Desk starts.
//
// The server checks and keeps them (server/prefs.js); this applies them:
//   · the look goes onto the private area's root element — data-accent, data-density, data-motion — and the text
//     size onto the page's root font size (every size here is in rem, so everything scales together); prefs.css
//     turns those into colours and spacing for both themes
//   · dark or light is the same switch as the one in every header: changing either changes both
//   · the Desk's start (day board, positions dock, chart) is written to the keys the Desk already reads on this
//     device — at once when you change it here, and on a device that has no choice of its own yet
// The last known preferences are kept in this browser too, so the page is drawn right before the server answers.
// A preference shows, hides and arranges; it can never give a person a workspace their role does not allow.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { setDeskTheme, useDeskTheme } from "./stock/analyzer/theme";
import "./prefs.css";

export const DEFAULT_PREFS = Object.freeze({
  theme: "dark",
  accent: "blue",
  text: "normal",
  density: "compact", // compact by default (24 Nov 2026); Customize → Comfortable gives room back
  motion: true,
  nav: { order: [], hidden: [] },
  start: "analyzer",
  desk: { board: true, dock: "auto", chart: "pro" },
  home: { status: true, today: true, workspaces: true },
});
const KEY = "vpt.prefs";
const TEXT_SIZE = { small: "93.75%", normal: "", large: "106.25%", larger: "112.5%" };
// the keys the Desk reads for itself (Analyzer.jsx, StockReport.jsx, StockView.jsx)
const DESK_KEYS = { board: "vpt.desk.board", dock: "vpt.terminal.dock", chart: "vpt.desk.chart" };

const lsGet = (k) => {
  try {
    return window.localStorage.getItem(k);
  } catch (_) {
    return null;
  }
};
const lsSet = (k, v) => {
  try {
    if (v === null) window.localStorage.removeItem(k);
    else window.localStorage.setItem(k, v);
  } catch (_) {
    /* private mode: it lasts for this visit */
  }
};

/** Whatever is at hand, as a complete set (the server is the judge of what is valid; this only fills gaps). */
export function fillPrefs(p) {
  const x = p && typeof p === "object" ? p : {};
  return {
    ...DEFAULT_PREFS,
    ...x,
    nav: { ...DEFAULT_PREFS.nav, ...(x.nav || {}), order: Array.isArray(x.nav && x.nav.order) ? x.nav.order : [], hidden: Array.isArray(x.nav && x.nav.hidden) ? x.nav.hidden : [] },
    desk: { ...DEFAULT_PREFS.desk, ...(x.desk || {}) },
    home: { ...DEFAULT_PREFS.home, ...(x.home || {}) },
  };
}

/** A change laid over the present set, part by part. */
export function mergePrefs(cur, patch) {
  const p = patch || {};
  return fillPrefs({ ...cur, ...p, nav: { ...cur.nav, ...(p.nav || {}) }, desk: { ...cur.desk, ...(p.desk || {}) }, home: { ...cur.home, ...(p.home || {}) } });
}

/**
 * The workspaces a person may open, in THEIR order and without the ones they hid. `views` is already filtered by
 * role: this can only reorder and remove. Workspaces not named in the order keep their built-in order, after the named.
 */
export function arrangeViews(views, prefs) {
  const p = fillPrefs(prefs);
  const hidden = new Set(p.nav.hidden.filter((id) => id !== "analyzer"));
  const rank = new Map(p.nav.order.map((id, i) => [id, i]));
  return views
    .filter((v) => !hidden.has(v.id))
    .map((v, i) => ({ v, i, r: rank.has(v.id) ? rank.get(v.id) : 1000 + i }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.v);
}

/** The look, onto the page. */
export function applyLook(prefs) {
  if (typeof document === "undefined") return;
  const p = fillPrefs(prefs);
  const el = document.querySelector(".adm");
  if (el) {
    el.setAttribute("data-accent", p.accent);
    el.setAttribute("data-density", p.density);
    el.setAttribute("data-motion", p.motion ? "on" : "off");
  }
  document.documentElement.style.fontSize = TEXT_SIZE[p.text] || "";
}

/** The Desk's start, into the keys the Desk reads. `force`: you chose it just now; otherwise only where this device has no choice yet. */
export function applyDesk(prefs, force = false) {
  const d = fillPrefs(prefs).desk;
  if (force || lsGet(DESK_KEYS.board) === null) lsSet(DESK_KEYS.board, d.board ? "open" : "closed");
  if (force || lsGet(DESK_KEYS.dock) === null) lsSet(DESK_KEYS.dock, d.dock === "auto" ? null : d.dock);
  if (force || lsGet(DESK_KEYS.chart) === null) lsSet(DESK_KEYS.chart, d.chart);
}

/** What this device has chosen so far, for a person whose preferences were never saved (nothing changes for them). */
function fromDevice() {
  const theme = lsGet("vpt.desk.theme");
  const dock = lsGet(DESK_KEYS.dock);
  const chart = lsGet(DESK_KEYS.chart);
  return {
    theme: theme === "light" ? "light" : "dark",
    desk: { board: lsGet(DESK_KEYS.board) !== "closed", dock: dock === "open" || dock === "closed" ? dock : "auto", chart: ["pro", "m1", "m5", "daily"].includes(chart) ? chart : "pro" },
  };
}

const cached = () => {
  try {
    return fillPrefs(JSON.parse(lsGet(KEY) || "null"));
  } catch (_) {
    return fillPrefs(null);
  }
};

const PrefsContext = createContext({ prefs: fillPrefs(null), options: null, ready: false, saving: false, error: "", save: () => Promise.resolve(), reset: () => Promise.resolve() });
export const usePrefs = () => useContext(PrefsContext);

export function PrefsProvider({ enabled, children }) {
  const [prefs, setPrefs] = useState(cached);
  const [options, setOptions] = useState(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const now = useRef(prefs);
  now.current = prefs;

  const take = useCallback((p) => {
    const full = fillPrefs(p);
    setPrefs(full);
    lsSet(KEY, JSON.stringify(full));
    return full;
  }, []);

  const save = useCallback(
    async (patch, { desk = false } = {}) => {
      // at once on screen; the server's answer (what it accepted) replaces it
      const next = take(mergePrefs(now.current, patch));
      if (patch && patch.theme) setDeskTheme(next.theme);
      if (desk) applyDesk(next, true);
      setSaving(true);
      try {
        const r = await api("/api/admin/prefs", { method: "PUT", body: patch });
        if (r && r.prefs) take(r.prefs);
        setError("");
      } catch (e) {
        setError(e.message);
      }
      setSaving(false);
      return next;
    },
    [take]
  );

  const reset = useCallback(async () => {
    setSaving(true);
    try {
      const r = await api("/api/admin/prefs", { method: "DELETE" });
      const p = take(r && r.prefs);
      setDeskTheme(p.theme);
      applyDesk(p, true);
      setError("");
    } catch (e) {
      setError(e.message);
    }
    setSaving(false);
  }, [take]);

  // once signed in: read them from the server
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    api("/api/admin/prefs")
      .then((r) => {
        if (!alive || !r || !r.prefs) return;
        setOptions(r.options || null);
        if (r.stored === false) {
          // never saved before: what this device already shows becomes the start, so nothing changes under you
          const seed = mergePrefs(fillPrefs(r.prefs), fromDevice());
          take(seed);
          api("/api/admin/prefs", { method: "PUT", body: { theme: seed.theme, desk: seed.desk } }).catch(() => {});
        } else {
          const p = take(r.prefs);
          setDeskTheme(p.theme);
          applyDesk(p, false);
        }
        setReady(true);
      })
      .catch(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, [enabled, take]);

  // the look follows every change
  useEffect(() => {
    applyLook(prefs);
  }, [prefs]);
  useEffect(
    () => () => {
      if (typeof document !== "undefined") document.documentElement.style.fontSize = "";
    },
    []
  );

  // dark or light switched in a header (or with T): the same preference, saved for every device
  const onTheme = useCallback(
    (theme) => {
      if (theme && theme !== now.current.theme) save({ theme });
    },
    [save]
  );

  const value = useMemo(() => ({ prefs, options, ready, saving, error, save, reset }), [prefs, options, ready, saving, error, save, reset]);
  return (
    <PrefsContext.Provider value={value}>
      {enabled && ready && <ThemeSync onTheme={onTheme} />}
      {children}
    </PrefsContext.Provider>
  );
}

/** Watches the header's dark / light switch — only once signed in, so the sign-in page keeps its own look. */
function ThemeSync({ onTheme }) {
  const [theme] = useDeskTheme();
  useEffect(() => {
    onTheme(theme);
  }, [theme, onTheme]);
  return null;
}
