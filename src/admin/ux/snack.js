// The snackbar's one function, usable from anywhere (a component, a hook, api.js): snack("Saved.") shows a short note at the
// bottom of the screen. It only sends an event; <SnackHost /> (mounted once in AdminApp) shows it. Without a host it does nothing.
//
//   snack(text, { tone: "ok" | "info" | "warn" | "error", action: { label, onClick }, ms, key })
//     tone    the colour and the icon; "error" is announced at once to screen readers, the others politely
//     action  one button (Undo, Retry, Open…); pressing it closes the note
//     ms      how long it stays (default 4.5 s, 7 s for an error; 0 = until closed); hovering or focusing it pauses the clock
//     key     a note with the same key replaces the one on screen instead of stacking (e.g. "network")

export const SNACK_EVENT = "drishti:snack";
export const SNACK_CLOSE = "drishti:snack-close";

export function snack(text, opts = {}) {
  if (typeof window === "undefined" || !text) return;
  window.dispatchEvent(new CustomEvent(SNACK_EVENT, { detail: { text: String(text), ...opts } }));
}

/** Close the note with this key (e.g. the "offline" note once the connection is back). */
export function closeSnack(key) {
  if (typeof window === "undefined" || !key) return;
  window.dispatchEvent(new CustomEvent(SNACK_CLOSE, { detail: { key } }));
}
