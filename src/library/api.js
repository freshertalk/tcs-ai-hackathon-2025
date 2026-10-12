// src/library/api.js
// ---------------------------------------------------------------------------
// Everything the site knows about published books comes through here.
//
// Books are static files written by scripts/publish-book.js:
//
//   /content/index.json                    the catalogue
//   /content/<slug>/book.json              metadata + contents + version
//   /content/<slug>/chapters/<id>.dat      one (scrambled) fragment per section
//
// Layers that keep it quick — and keep it current:
//   1. a seed (window.__LIBRARY__) that the prerender step inlines, so the
//      first paint already has the catalogue and book metadata;
//   2. an in-memory cache, so moving around the site never refetches;
//   3. neighbour prefetch in the reader, so the next chapter is already here;
//   4. a version on every book. Metadata is always revalidated, and chapters
//      are requested as ?v=<version>, so replacing the EPUB reaches readers
//      without anyone clearing a cache.
// ---------------------------------------------------------------------------

import DOMPurify from "dompurify";

const ROOT = `${process.env.PUBLIC_URL || ""}/content`;

const cache = {
  catalog: null,
  books: new Map(),
  chapters: new Map(), // `${slug}/${version}/${id}` → sanitised html
  text: new Map(), // same key → plain text (for search)
  inflight: new Map(),
};

function seeded() {
  const g = typeof window !== "undefined" ? window : global;
  return g.__LIBRARY__ || null;
}

/** Once-only fetch per key, even if several components ask at the same time. */
function once(key, make) {
  if (cache.inflight.has(key)) return cache.inflight.get(key);
  const p = make().finally(() => cache.inflight.delete(key));
  cache.inflight.set(key, p);
  return p;
}

// `no-cache` means "ask the server whether this changed" — a 304 when it
// has not — so metadata is never stale and is still cheap.
async function fetchText(url, { revalidate = false } = {}) {
  const res = await fetch(url, revalidate ? { cache: "no-cache" } : undefined);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const text = await res.text();
  // Static hosts with an SPA fallback answer a missing file with index.html
  // and a 200. That is never a valid book resource.
  if (/^\s*<!doctype html/i.test(text)) throw new Error(`Not found: ${url}`);
  return text;
}

/* ------------------------------------------------------------------ urls */
export const contentUrl = (slug, file) => (file ? `${ROOT}/${slug}/${file}` : "");

/* --------------------------------------------------------------- catalog */
export function peekCatalog() {
  if (cache.catalog) return cache.catalog;
  const s = seeded();
  if (s && s.catalog) cache.catalog = s.catalog;
  return cache.catalog;
}

export function getCatalog() {
  const hit = peekCatalog();
  if (hit) return Promise.resolve(hit);
  return once("catalog", async () => {
    const data = JSON.parse(await fetchText(`${ROOT}/index.json`, { revalidate: true }));
    cache.catalog = data;
    return data;
  });
}

/* ----------------------------------------------------------------- books */
export function peekBook(slug) {
  if (cache.books.has(slug)) return cache.books.get(slug);
  const s = seeded();
  if (s && s.books && s.books[slug]) {
    cache.books.set(slug, s.books[slug]);
    return s.books[slug];
  }
  return null;
}

/**
 * Ask the server for the book's current metadata, whatever is cached or
 * seeded. A changed `version` means a new edition has been published.
 */
export function getBookFresh(slug) {
  return once(`book:${slug}`, async () => {
    const data = JSON.parse(
      await fetchText(`${ROOT}/${slug}/book.json`, { revalidate: true })
    );
    cache.books.set(slug, data);
    return data;
  });
}

/* -------------------------------------------------------------- chapters */
// The publisher scrambles chapter files (see scripts/publish-book.js). This
// is the inverse. It is a speed bump for scrapers, not a lock — the key is
// derived from public values — and the README says as much.
function unscramble(b64, key) {
  const bin = atob(b64.trim());
  const k = new TextEncoder().encode(key);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i) ^ k[i % k.length] ^ ((i * 31) & 255);
  }
  return new TextDecoder().decode(bytes);
}

let hookInstalled = false;
function installLinkHook() {
  if (hookInstalled) return;
  hookInstalled = true;
  // links that leave the site open in a new tab, safely
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A" && node.hasAttribute("href")) {
      const href = node.getAttribute("href") || "";
      if (/^https?:\/\//i.test(href)) {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
    }
  });
}

function clean(html) {
  installLinkHook();
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "form", "input", "button", "iframe", "object", "embed"],
    FORBID_ATTR: ["style"],
  });
}

const chapterKey = (book, id) => `${book.slug}/${book.version || "0"}/${id}`;

export function peekChapter(book, id) {
  return cache.chapters.get(chapterKey(book, id)) || null;
}

export function getChapter(book, id) {
  const key = chapterKey(book, id);
  if (cache.chapters.has(key)) return Promise.resolve(cache.chapters.get(key));

  return once(`chapter:${key}`, async () => {
    const entry = book.chapters.find((c) => c.id === id);
    if (!entry) throw new Error(`No such chapter: ${id}`);
    // ?v= makes each edition's files distinct URLs: nothing stale can be served
    const url = `${contentUrl(book.slug, entry.file)}?v=${book.version || "0"}`;
    const raw = await fetchText(url);
    const html = clean(unscramble(raw, `${book.slug}:${book.version}`));
    cache.chapters.set(key, html);
    return html;
  });
}

/** Warm the cache; failures are silent because nobody asked for this. */
export function prefetchChapter(book, id) {
  if (!id || cache.chapters.has(chapterKey(book, id))) return;
  getChapter(book, id).catch(() => {});
}

/* ---------------------------------------------------------------- search */
function plainText(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.body.textContent || "").replace(/\s+/g, " ").trim().normalize("NFC");
}

export async function getChapterText(book, id) {
  const key = chapterKey(book, id);
  if (cache.text.has(key)) return cache.text.get(key);
  const text = plainText(await getChapter(book, id));
  cache.text.set(key, text);
  return text;
}

/**
 * Find a phrase across the whole book. Chapters are fetched a few at a time
 * and results stream out through onProgress, so the panel fills in as it goes.
 */
export async function searchBook(book, query, { limit = 120, signal, onProgress } = {}) {
  const q = query.normalize("NFC").trim().toLowerCase();
  if (q.length < 2) return [];

  const hits = [];
  const queue = book.chapters.filter((c) => c.words > 0);
  const total = queue.length;
  let done = 0;

  const worker = async () => {
    while (queue.length && !signal?.aborted && hits.length < limit) {
      const ch = queue.shift();
      try {
        const text = await getChapterText(book, ch.id);
        const hay = text.toLowerCase();
        let from = 0;
        let n = 0;
        while (n < 6 && hits.length < limit) {
          const at = hay.indexOf(q, from);
          if (at < 0) break;
          const a = Math.max(0, at - 38);
          const b = Math.min(text.length, at + q.length + 62);
          hits.push({
            chapter: ch.id,
            order: book.chapters.indexOf(ch),
            at,
            pos: text.length ? at / text.length : 0,
            before: (a > 0 ? "…" : "") + text.slice(a, at),
            match: text.slice(at, at + q.length),
            after: text.slice(at + q.length, b) + (b < text.length ? "…" : ""),
          });
          from = at + q.length;
          n++;
        }
      } catch {
        /* an unreachable chapter just contributes nothing */
      }
      done++;
      onProgress?.(done, total);
    }
  };

  await Promise.all([worker(), worker(), worker(), worker()]);
  return hits.sort((x, y) => x.order - y.order || x.at - y.at);
}
