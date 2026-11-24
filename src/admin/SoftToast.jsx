// The small note that floats in the bottom-right corner (a saved setting, a price alert, an order's state).
// It glides in and, when it goes, glides out again instead of vanishing: the caller keeps saying whether it is
// shown, and this keeps the last words on screen for the length of the exit. The look is in smooth.css.
//
// Since 24 Nov 2026 the note is shown in the one soft popup every private page shares (ux/SnackHost.jsx: bottom centre,
// above the Positions bar, gone after 30 seconds (or the ×) unless the pointer rests on it). The callers are unchanged — they still say
// show / kind / onClose — and `stamp` (the note's own time) tells a new note from the same one drawn again. Where no popup
// host is mounted (a test, a page of its own), the old floating note is drawn as before.

import React, { useEffect, useRef, useState } from "react";
import { closeSnack, snack } from "./ux/snack";

let seq = 0;
const hostThere = () => typeof document !== "undefined" && Boolean(document.querySelector(".ux-snacks"));

/** Stay mounted for `ms` after `show` turns false, so an exit animation can play. */
export function useExit(show, ms = 300) {
  const [mounted, setMounted] = useState(Boolean(show));
  useEffect(() => {
    if (show) {
      setMounted(true);
      return undefined;
    }
    const t = setTimeout(() => setMounted(false), ms);
    return () => clearTimeout(t);
  }, [show, ms]);
  return { mounted: mounted || Boolean(show), leaving: mounted && !show };
}

export default function SoftToast({ show, kind = "ok", role = "status", className = "", onClose, children, stamp = null }) {
  const key = useRef(null);
  if (!key.current) key.current = `soft-${(seq += 1)}`;
  const kids = useRef(children);
  kids.current = children;
  const closer = useRef(onClose);
  closer.current = onClose;
  const [viaHost, setViaHost] = useState(hostThere); // known from the first draw, so the old note never flashes
  useEffect(() => {
    if (!show) {
      closeSnack(key.current);
      return;
    }
    if (!hostThere()) {
      setViaHost(false);
      return;
    }
    setViaHost(true);
    snack(kids.current, { key: key.current, tone: kind === "error" ? "error" : kind === "warn" ? "warn" : kind === "info" ? "info" : "ok", ms: 30000, onClose: () => closer.current && closer.current() });
  }, [show, kind, stamp]);
  useEffect(() => () => closeSnack(key.current), []);
  const last = useRef({ kind, children });
  if (show) last.current = { kind, children };
  const { mounted, leaving } = useExit(show && !viaHost);
  if (viaHost || !mounted) return null;
  const k = show ? kind : last.current.kind;
  return (
    <div className={`tr-toast tr-toast--${k} ${leaving ? "is-leaving" : ""} ${className}`.trim()} role={role} aria-live={role === "alert" ? "assertive" : "polite"} aria-hidden={leaving ? "true" : undefined}>
      {show ? children : last.current.children}
      <button type="button" aria-label="Dismiss" onClick={onClose} tabIndex={leaving ? -1 : 0}>
        ×
      </button>
    </div>
  );
}
