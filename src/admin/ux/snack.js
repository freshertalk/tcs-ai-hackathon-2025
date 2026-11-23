// The snackbar's one function, usable from anywhere (a component, a hook, api.js): snack("Saved.") shows a short note at the
// bottom of the screen. It only sends an event; <SnackHost /> (mounted once in AdminApp) shows it. Without a host it does nothing.
//
//   snack(text, { tone: "ok" | "info" | "warn" | "error", action: { label, onClick }, ms, key })
//     tone    the colour and the icon; "error" is announced at once to screen readers, the others politely
//     action  one button (Undo, Retry, Open…); pressing it closes the note
//     ms      how long it stays (default 4.5 s, 7 s for an error; 0 = until closed); hovering or focusing it pauses the clock
//     key     a note with the same key replaces the one on screen instead of stacking (e.g. "network")
//
// Added on 24 Nov 2026, when every floating note on the private pages became this one soft popup (the daily goal's alert, a
// price alert, an order's state):
//     title    a bold first line above the words
//     actions  up to two buttons: [{ label, onClick, primary }]; pressing one closes the note (action still works)
//     onClose  called once when the note leaves — by itself, by its ×, by a swipe or an action
//     text     may be words or a small piece of page (a React element)

export const SNACK_EVENT = "drishti:snack";
export const SNACK_CLOSE = "drishti:snack-close";

export function snack(text, opts = {}) {
  if (typeof window === "undefined" || !text) return;
  window.dispatchEvent(new CustomEvent(SNACK_EVENT, { detail: { text: typeof text === "object" ? text : String(text), ...opts } }));
}

/** Close the note with this key (e.g. the "offline" note once the connection is back). */
export function closeSnack(key) {
  if (typeof window === "undefined" || !key) return;
  window.dispatchEvent(new CustomEvent(SNACK_CLOSE, { detail: { key } }));
}
