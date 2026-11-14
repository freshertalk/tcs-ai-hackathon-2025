// Keyboard shortcuts for the trading terminal. Pure: a key press in, an action out —
// so it can be tested without a page.

export const SHORTCUTS = [
  { keys: ["Ctrl", "K"], action: "palette", text: "Search or command: a stock, a workspace, “buy sbin 10”, “alert infy 1500”" },
  { keys: ["/"], action: "search", text: "Search any stock" },
  { keys: ["B"], action: "buy", text: "Buy the open stock (trading switch on)" },
  { keys: ["S"], action: "sell", text: "Sell the open stock (trading switch on)" },
  { keys: ["D"], action: "dock", text: "Show or hide the positions dock" },
  { keys: ["T"], action: "theme", text: "Dark or light theme" },
  { keys: ["1", "…", "9"], action: "view", text: "Desk, Advisor, Positions, Journal, Research, Screener, Paper, Debrief, Calendar" },
  { keys: ["?"], action: "help", text: "This list" },
  { keys: ["Esc"], action: "close", text: "Close a dialog or this list" },
];

const TYPING = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * @param e  { key, ctrlKey, metaKey, altKey, target }
 * @returns  null, or { action, view? } — view is 1-based
 */
export function keyAction(e) {
  if (!e) return null;
  // Ctrl K (⌘ K) opens the palette from anywhere, a field included — but never over another dialog
  if ((e.ctrlKey || e.metaKey) && !e.altKey && String(e.key).toLowerCase() === "k") {
    if (typeof document !== "undefined" && document.querySelector('[aria-modal="true"]:not(.tm-pal)')) return null;
    return { action: "palette" };
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const t = e.target;
  const typing = t && (TYPING.has(t.tagName) || t.isContentEditable);
  if (e.key === "Escape") return { action: "close" };
  if (typing) return null; // letters typed into a field are text, not commands
  // a dialog has its own keys: nothing global while one is open
  if (typeof document !== "undefined" && document.querySelector('[aria-modal="true"]')) return null;
  const k = e.key;
  if (k === "/") return { action: "search" };
  if (k === "?") return { action: "help" };
  if (/^[1-9]$/.test(k)) return { action: "view", view: Number(k) };
  const l = k.length === 1 ? k.toLowerCase() : "";
  if (l === "b") return { action: "buy" };
  if (l === "s") return { action: "sell" };
  if (l === "d") return { action: "dock" };
  if (l === "t") return { action: "theme" };
  return null;
}
