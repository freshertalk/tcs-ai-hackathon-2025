// The small note that floats in the bottom-right corner (a saved setting, a price alert, an order's state).
// It glides in and, when it goes, glides out again instead of vanishing: the caller keeps saying whether it is
// shown, and this keeps the last words on screen for the length of the exit. The look is in smooth.css.

import React, { useEffect, useRef, useState } from "react";

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

export default function SoftToast({ show, kind = "ok", role = "status", className = "", onClose, children }) {
  const last = useRef({ kind, children });
  if (show) last.current = { kind, children };
  const { mounted, leaving } = useExit(show);
  if (!mounted) return null;
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
