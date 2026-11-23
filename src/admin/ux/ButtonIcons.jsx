// The icon a button's words call for (24 Nov 2026) — the owner: "for all buttons put appropriate icons". Hundreds of buttons
// across the private area say what they do ("Save", "Refresh", "Download CSV", "Delete", "Write with AI"…); this reads those
// words and names the matching icon in data-ico, and ux/soft-buttons.css draws it before the words, in the button's own
// colour. Only an attribute is written — never the button's own content — so every page keeps working exactly as before.
// A button that already has an icon (an <svg> or an <img> inside), an icon-only button (×, ?, ☾) and the segmented chips are
// left alone; data-ico="none" on a button opts it out.
import { useEffect } from "react";

/** First match wins: [pattern on the button's words, icon]. Pure, for the tests. */
export const RULES = [
  [/^(sign out|log ?out)/i, "logout"],
  [/^(sign in|log ?in|connect|log in to kite)/i, "login"],
  [/\b(with ai|ai\b|ask the|write the|review|coach|analy[sz]e|debrief|generate|what do they mean)/i, "sparkle"],
  [/^(save|apply|update|allow|done|got it|ok|yes|confirm|put it back|it has filled)\b/i, "save"],
  [/^(refresh|reload|retry|rescan|re-?read|check now|check sources|sync|scan)/i, "refresh"],
  [/(download|export|\bcsv\b|\bpdf\b|\bword\b file)/i, "download"],
  [/^(upload|import|choose file|add file)/i, "upload"],
  [/^(delete|remove|clear|forget|sure\? delete|reset)/i, "trash"],
  [/^(\+\s?|add\b|new\b|create\b)/i, "plus"],
  [/^(edit|rename|change)\b/i, "edit"],
  [/^(cancel|close|dismiss|not now|keep mine|keep as is|leave|hide)\b/i, "close"],
  [/^(open|view|go to|show)\b/i, "open"],
  [/^(search|find)\b/i, "search"],
  [/^(settings|customi[sz]e|configure|setup|zerodha setup)\b/i, "gear"],
  [/^copy\b/i, "copy"],
  [/^(send|share|email me|invite)\b/i, "send"],
  [/^(start|run|play|measure|test|try|backtest|replay)\b/i, "play"],
  [/^(stop|pause|turn off)\b/i, "pause"],
  [/^print\b/i, "print"],
  [/^(lock|unlock)\b/i, "lock"],
  [/^(alert|set alert|price alert)/i, "bell"],
  [/^(filter|sort)\b/i, "filter"],
  [/^(undo|restore|revert)\b/i, "undo"],
  [/^(star|pin|favou?rite|save this view)/i, "star"],
  [/(chart|forecast|projection|levels)\b/i, "chart"],
];

/** The icon for a button's words, or "" when none fits. */
export function iconFor(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length < 2 || t.length > 48) return "";
  if (/^[^a-z0-9+]+$/i.test(t)) return ""; // a symbol only (×, ?, ☾, ‹, ›)
  for (const [re, ico] of RULES) if (re.test(t)) return ico;
  return "";
}

const SELECTOR = "button.adm-btn, a.adm-btn, .hm .hm-btn:not(.hm-cta), .vd-actions button";

function tag(scope) {
  if (!scope || scope.nodeType !== 1) return;
  const list = scope.matches && scope.matches(SELECTOR) ? [scope] : [];
  list.push(...scope.querySelectorAll(SELECTOR));
  for (const el of list) {
    if (el.getAttribute("data-ico") === "none") continue;
    if (el.querySelector("svg, img")) {
      if (el.hasAttribute("data-ico")) el.removeAttribute("data-ico");
      continue;
    }
    const ico = iconFor(el.textContent);
    const was = el.getAttribute("data-ico") || "";
    if (ico !== was) {
      if (ico) el.setAttribute("data-ico", ico);
      else el.removeAttribute("data-ico");
    }
  }
}

/** Mounted once (AdminApp). */
export default function ButtonIcons() {
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return undefined;
    const root = document.querySelector(".adm") || document.body;
    tag(root);
    let pending = new Set();
    let timer = null;
    const flush = () => {
      timer = null;
      const list = [...pending];
      pending = new Set();
      if (list.length > 60) tag(root);
      else for (const el of list) if (el.isConnected) tag(el);
    };
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        const el = r.target.nodeType === 1 ? r.target : r.target.parentElement;
        if (el) pending.add(el.closest(SELECTOR) || el);
      }
      if (!timer) timer = setTimeout(flush, 150);
    });
    mo.observe(root, { subtree: true, childList: true, characterData: true });
    return () => {
      mo.disconnect();
      clearTimeout(timer);
    };
  }, []);
  return null;
}
