// src/reader/annotations.js
// A reader's own marks: bookmarks, highlights and notes.
//
// They live in this browser only (localStorage), per book. A highlight is
// kept at paragraph level — a long-press on a paragraph — because the page
// does not allow free text selection (that is how the book stays read-only).
// The first words of the paragraph are stored with it so the list in the
// panel can say what was marked without opening the chapter.

import { useCallback, useEffect, useState } from "react";

const KEY = "vkt.reader.marks.v1";

export const HL_COLORS = [
  { id: "y", label: "पीला" },
  { id: "g", label: "हरा" },
  { id: "b", label: "नीला" },
  { id: "r", label: "गुलाबी" },
];

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

const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);

export default function useAnnotations(slug) {
  const [data, setData] = useState(() => {
    const b = readAll()[slug] || {};
    return { bookmarks: b.bookmarks || [], marks: b.marks || [] };
  });

  // another tab may have changed them
  useEffect(() => {
    const on = (e) => {
      if (e.key !== KEY) return;
      const b = readAll()[slug] || {};
      setData({ bookmarks: b.bookmarks || [], marks: b.marks || [] });
    };
    window.addEventListener("storage", on);
    return () => window.removeEventListener("storage", on);
  }, [slug]);

  const commit = useCallback(
    (fn) => {
      setData((prev) => {
        const next = fn(prev);
        const all = readAll();
        all[slug] = next;
        writeAll(all);
        return next;
      });
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
          return { ...d, bookmarks: d.bookmarks.filter((b) => !drop.has(b.id)) };
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
    (id) => commit((d) => ({ ...d, bookmarks: d.bookmarks.filter((b) => b.id !== id) })),
    [commit]
  );

  /** Create or update the mark on paragraph `p` of a chapter. */
  const setMark = useCallback(
    (chapter, p, patch, text) => {
      commit((d) => {
        const at = d.marks.findIndex((m) => m.chapter === chapter && m.p === p);
        if (at < 0) {
          return {
            ...d,
            marks: [...d.marks, { id: uid(), chapter, p, color: "y", note: "", text: text || "", at: Date.now(), ...patch }],
          };
        }
        const marks = d.marks.slice();
        marks[at] = { ...marks[at], ...patch };
        return { ...d, marks };
      });
    },
    [commit]
  );

  const removeMark = useCallback(
    (chapter, p) => commit((d) => ({ ...d, marks: d.marks.filter((m) => !(m.chapter === chapter && m.p === p)) })),
    [commit]
  );

  const removeMarkById = useCallback(
    (id) => commit((d) => ({ ...d, marks: d.marks.filter((m) => m.id !== id) })),
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
