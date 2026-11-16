// The live book in the browser: the account's positions at streamed prices, pushed by the server
// (server/trading/livebook.js) over the trading stream every time a price or a position changes.
//
// It lives in a tiny store of its own rather than in the trading context, so the four pushes a
// second it can bring redraw only the few things that show it — the top bar's P&L, the dock, the
// goal pill and bar, the Positions table — and never the whole page.

import { useSyncExternalStore } from "react";

let current = null;
const subs = new Set();

export const bookStore = {
  get: () => current,
  set(next) {
    if (next === current) return;
    current = next;
    subs.forEach((fn) => fn());
  },
  subscribe(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  },
};

/** The newest live book ({ available, day, pnl, open, live, positions, … }) or null. */
export function useLiveBook() {
  return useSyncExternalStore(bookStore.subscribe, bookStore.get, bookStore.get);
}

/** The top bar's and the dock's figures from a book: today's P&L (the day's M2M) and the open count. */
export function pulseOf(book) {
  if (!book || !book.available) return null;
  return { pnl: book.day, total: book.pnl, open: book.open, at: Date.parse(book.at) || Date.now(), live: Boolean(book.live && book.streaming) };
}

/**
 * The daily goal with today's P&L from the live book: the server works the goal out every few seconds,
 * the book moves on every tick; the figure on screen is always the book's. The goal's state and its
 * reminders stay the server's.
 */
export function withLivePnl(goal, book) {
  if (!goal || !goal.available || !book || !book.available) return goal;
  const pnl = Math.round(book.day);
  if (pnl === goal.pnl) return goal;
  return {
    ...goal,
    pnl,
    peak: Math.max(goal.peak || 0, pnl),
    progressPct: goal.target > 0 ? Math.round((pnl / goal.target) * 100) : goal.progressPct,
  };
}

/** The goal as it should be drawn right now. */
export function useLiveGoal(goal) {
  return withLivePnl(goal, useLiveBook());
}
