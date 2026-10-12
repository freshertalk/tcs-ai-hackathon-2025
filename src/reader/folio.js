// src/reader/folio.js
// Page numbers, the way a printed book has them.
//
//   • left-hand pages carry even numbers, right-hand pages odd ones
//   • the first page of the story is page 1, on the right
//   • the cover, title page, copyright and dedication are not numbered
//
// A web page has no fixed pagination: the number of pages depends on the
// screen, the type size and the margins. So numbers are worked out from the
// layout the reader actually has. A chapter that has been laid out here is
// counted exactly; one that has not is estimated from the words-per-page of
// the ones that have. The numbers settle as the reader moves through the book.

const UNNUMBERED = new Set(["cover", "titlepage", "copyright", "dedication"]);

export const isNumbered = (chapter) => !UNNUMBERED.has(chapter.id);

/** Words a page of this size holds, before any chapter has been measured. */
export function guessWordsPerPage(colW, Ht, size, lh) {
  const lines = Math.max(4, Math.floor(Ht / (size * lh)));
  const perLine = Math.max(3, colW / (size * 2.6));
  // 0.8: paragraph ends, indents and the chapter opener leave lines short
  return Math.max(40, lines * perLine * 0.8);
}

/**
 * Words per page, learnt from the chapters measured so far. The chapter being
 * read is left out so its own page numbers do not shift when it is measured.
 */
export function learnWordsPerPage(chapters, counts, exceptId, fallback) {
  let words = 0;
  let pages = 0;
  for (const c of chapters) {
    if (c.id === exceptId || !counts[c.id] || c.words < 300) continue;
    words += c.words;
    // the last page of a chapter is rarely full: count it as half
    pages += Math.max(0.5, counts[c.id] - 0.5);
  }
  return pages > 0 ? words / pages : fallback;
}

/**
 * One entry per chapter: { numbered, first, pages, lead }.
 *   first — the number of the chapter's first page
 *   pages — how many pages it has (measured or estimated)
 *   lead  — blank pages before it on a two-page spread (0 or 1)
 */
export function numbering(chapters, { two, counts, wpp }) {
  const out = [];
  let n = 1;
  for (const c of chapters) {
    const pages = counts[c.id] || (c.words ? Math.max(1, Math.ceil(c.words / wpp)) : 1);
    if (!isNumbered(c)) {
      out.push({ numbered: false, first: 0, pages, lead: two ? 1 : 0 });
      continue;
    }
    const lead = two && n % 2 === 1 ? 1 : 0;
    out.push({ numbered: true, first: n, pages, lead });
    n += pages;
    // on a spread, the next chapter starts on a left-hand page
    if (two && n % 2 === 1) n += 1;
  }
  return out;
}

/** Last page number of the book, for "page 12 of 214". */
export function lastPage(nums) {
  let last = 0;
  for (const e of nums) if (e.numbered) last = Math.max(last, e.first + e.pages - 1);
  return last;
}

/** Page number → { index, pos } (chapter index, fraction through it). */
export function locatePage(nums, n) {
  let best = -1;
  for (let i = 0; i < nums.length; i++) {
    const e = nums[i];
    if (!e.numbered) continue;
    if (n >= e.first) best = i;
    if (n >= e.first && n < e.first + e.pages) {
      return { index: i, pos: e.pages > 1 ? (n - e.first) / e.pages : 0 };
    }
  }
  if (best < 0) return null;
  return { index: best, pos: 1 };
}
