// src/reader/annotations.js
// A reader's own marks: bookmarks, highlights and notes.
//
// They live in this browser (localStorage), per book. A highlight is kept at
// paragraph level — a long-press on a paragraph — because the page does not
// allow free text selection (that is how the book stays read-only). The first
// words of the paragraph are stored with it so the list in the panel can say
// what was marked without opening the chapter.
//
// When a reader is signed in with Google, src/sync keeps these in step across
// their devices. Two things make that safe to merge:
//   • every highlight carries `u`, the moment it was last changed, so the
//     newer edit wins;
//   • a removal leaves a tombstone ("tomb"), so a mark deleted on the phone is
//     not brought back by the laptop.

import { useCallback, useEffect, useState } from "react";

const KEY = "vkt.reader.marks.v1";

export const HL_COLORS = [
  { id: "y", label: "पीला" },
  { id: "g", label: "हरा" },
  { id: "b", label: "नीला" },
  { id: "r", label: "गुलाबी" },
];

/* ------------------------------------------------------------------ store */
const listeners = new Set();
const emit = (slug) => listeners.forEach((fn) => fn(slug));

function readAll() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function writeAll(all) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* marks just won't persist */
  }
}

const blank = () => ({ bookmarks: [], marks: [], tomb: {} });

export function readBook(slug) {
  const b = readAll()[slug] || {};
  return {
    bookmarks: Array.isArray(b.bookmarks) ? b.bookmarks : [],
    marks: Array.isArray(b.marks) ? b.marks : [],
    tomb: b.tomb && typeof b.tomb === "object" ? b.tomb : {},
  };
}

/** Replace a book's marks wholesale (used by sync). `quiet` skips the change event. */
export function writeBook(slug, data, { quiet = false } = {}) {
  const all = readAll();
  all[slug] = { ...blank(), ...data };
  writeAll(all);
  if (!quiet) emit(slug);
}

/** Subscribe to any change to any book's marks. Returns an unsubscribe. */
export function onMarksChange(fn) {
  listeners.add(fn);
  const onStorage = (e) => e.key === KEY && fn(null);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
const markKey = (m) => `${m.chapter}:${m.p}`;
const stamp = (m) => Number(m.u || m.at) || 0;

/**
 * Merge two copies of one book's marks. Pure: used by sync, and tested by
 * reasoning — union, newer edit wins, a tombstone beats anything older.
 */
export function mergeMarks(a, b) {
  const tomb = { ...(a.tomb || {}) };
  Object.entries(b.tomb || {}).forEach(([k, ts]) => {
    tomb[k] = Math.max(Number(tomb[k]) || 0, Number(ts) || 0);
  });

  const bm = new Map();
  [...(a.bookmarks || []), ...(b.bookmarks || [])].forEach((x) => {
    if (!x || !x.id) return;
    const cur = bm.get(x.id);
    if (!cur || (Number(x.at) || 0) > (Number(cur.at) || 0)) bm.set(x.id, x);
  });
  const bookmarks = [...bm.values()].filter((x) => !((tomb[x.id] || 0) >= (Number(x.at) || 0)));

  const mk = new Map();
  [...(a.marks || []), ...(b.marks || [])].forEach((m) => {
    if (!m || m.p === undefined) return;
    const k = markKey(m);
    const cur = mk.get(k);
    if (!cur || stamp(m) > stamp(cur)) mk.set(k, m);
  });
  const marks = [...mk.values()].filter((m) => !((tomb[`m:${markKey(m)}`] || 0) >= stamp(m)));

  return { bookmarks, marks, tomb };
}

/** Do two copies hold the same thing? (Cheap: ids, stamps, tombstones.) */
export function sameMarks(a, b) {
  const sig = (d) =>
    JSON.stringify([
      (d.bookmarks || []).map((x) => `${x.id}@${x.at}`).sort(),
      (d.marks || []).map((m) => `${markKey(m)}@${stamp(m)}:${m.color}:${m.note}`).sort(),
      Object.entries(d.tomb || {}).sort(),
    ]);
  return sig(a) === sig(b);
}

/* ------------------------------------------------------------------- hook */
export default function useAnnotations(slug) {
  const [data, setData] = useState(() => readBook(slug));

  // another tab, or a sync, may have changed them
  useEffect(() => {
    setData(readBook(slug));
    return onMarksChange((changed) => {
      if (!changed || changed === slug) setData(readBook(slug));
    });
  }, [slug]);

  const commit = useCallback(
    (fn) => {
      const next = fn(readBook(slug));
      writeBook(slug, next); // emits: this hook, and the sync, hear it
    },
    [slug]
  );

  /** Bookmarks whose position falls in [from, to). */
  const bookmarksIn = useCallback(
    (chapter, from, to) =>
      data.bookmarks.filter((b) => b.chapter === chapter && b.pos >= from - 1e-6 && b.pos < to - 1e-6),
    [data.bookmarks]
  );

  const toggleBookmark = useCallback(
    (chapter, from, to, label) => {
      commit((d) => {
        const inside = d.bookmarks.filter((b) => b.chapter === chapter && b.pos >= from - 1e-6 && b.pos < to - 1e-6);
        if (inside.length) {
          const drop = new Set(inside.map((b) => b.id));
          const tomb = { ...d.tomb };
          inside.forEach((b) => {
            tomb[b.id] = Date.now();
          });
          return { ...d, bookmarks: d.bookmarks.filter((b) => !drop.has(b.id)), tomb };
        }
        return {
          ...d,
          bookmarks: [...d.bookmarks, { id: uid(), chapter, pos: from, label, at: Date.now() }],
        };
      });
    },
    [commit]
  );

  const removeBookmark = useCallback(
    (id) =>
      commit((d) => ({
        ...d,
        bookmarks: d.bookmarks.filter((b) => b.id !== id),
        tomb: { ...d.tomb, [id]: Date.now() },
      })),
    [commit]
  );

  /** Create or update the mark on paragraph `p` of a chapter. */
  const setMark = useCallback(
    (chapter, p, patch, text) => {
      commit((d) => {
        const now = Date.now();
        const at = d.marks.findIndex((m) => m.chapter === chapter && m.p === p);
        if (at < 0) {
          return {
            ...d,
            marks: [
              ...d.marks,
              { id: uid(), chapter, p, color: "y", note: "", text: String(text || "").slice(0, 160), at: now, u: now, ...patch },
            ],
          };
        }
        const marks = d.marks.slice();
        marks[at] = { ...marks[at], ...patch, u: now };
        return { ...d, marks };
      });
    },
    [commit]
  );

  const removeMark = useCallback(
    (chapter, p) =>
      commit((d) => ({
        ...d,
        marks: d.marks.filter((m) => !(m.chapter === chapter && m.p === p)),
        tomb: { ...d.tomb, [`m:${chapter}:${p}`]: Date.now() },
      })),
    [commit]
  );

  const removeMarkById = useCallback(
    (id) =>
      commit((d) => {
        const m = d.marks.find((x) => x.id === id);
        return {
          ...d,
          marks: d.marks.filter((x) => x.id !== id),
          tomb: m ? { ...d.tomb, [`m:${markKey(m)}`]: Date.now() } : d.tomb,
        };
      }),
    [commit]
  );

  return {
    bookmarks: data.bookmarks,
    marks: data.marks,
    bookmarksIn,
    toggleBookmark,
    removeBookmark,
    setMark,
    removeMark,
    removeMarkById,
  };
}
