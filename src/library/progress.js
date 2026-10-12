// src/library/progress.js
// Where each reader has got to, kept in the reader's own browser.
//
// There are no accounts here on purpose: a book site should not need a login
// to remember a page number. Every call is wrapped because storage can be
// unavailable (private windows, blocked cookies) and reading must still work.

const KEY = "vkt.library.progress.v1";
const listeners = new Set();

function readAll() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

function writeAll(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage full or blocked — the session still works */
  }
  listeners.forEach((fn) => fn());
}

export function getProgress(slug) {
  return readAll()[slug] || null;
}

/** Merge a patch into a book's record. `done` merges key by key. */
export function saveProgress(slug, patch) {
  const all = readAll();
  const prev = all[slug] || { done: {} };
  const next = {
    ...prev,
    ...patch,
    done: { ...prev.done, ...(patch.done || {}) },
    at: Date.now(),
  };
  all[slug] = next;
  writeAll(all);
  return next;
}

export function clearProgress(slug) {
  const all = readAll();
  delete all[slug];
  writeAll(all);
}

/** Subscribe to changes (this tab and others). Returns an unsubscribe. */
export function onProgressChange(fn) {
  listeners.add(fn);
  const onStorage = (e) => e.key === KEY && fn();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}
