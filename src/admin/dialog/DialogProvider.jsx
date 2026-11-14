import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import "./dialog.css";

// The site's own confirmation dialog, in place of the browser's grey "vinaytiwari.org says" box.
//
//   const ask = useDialog();
//   if (await ask({ title: "Clear the paper record?", body: "…", confirmText: "Clear", tone: "danger" })) …
//
// It follows the page's light / dark theme, keeps the keyboard where it belongs (Enter confirms,
// Escape or a click outside cancels, Tab stays inside), says what will happen in plain words, and
// on a phone rises from the bottom edge. One dialog at a time; a second request waits its turn.

const DialogContext = createContext(null);

const ICONS = {
  danger: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 2.5 20h19L12 3Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M12 10v4.5M12 17.2v.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  info: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 11v6M12 7.6v.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  ok: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="m8 12.5 2.6 2.6L16.5 9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

function Dialog({ req, onDone }) {
  const box = useRef(null);
  const okBtn = useRef(null);
  const cancelBtn = useRef(null);
  const back = useRef(typeof document !== "undefined" ? document.activeElement : null);
  const tone = req.tone || "info";
  const single = req.kind === "notice";

  useEffect(() => {
    // the safe choice has the focus for anything that removes something
    (tone === "danger" && !single ? cancelBtn.current : okBtn.current)?.focus();
    const before = back.current;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      if (before && typeof before.focus === "function") before.focus();
    };
  }, [tone, single]);

  const onKey = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onDone(false);
    } else if (e.key === "Tab") {
      // keep the keyboard inside the dialog
      const items = [...box.current.querySelectorAll("button")];
      const i = items.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) {
        e.preventDefault();
        items[items.length - 1].focus();
      } else if (!e.shiftKey && i === items.length - 1) {
        e.preventDefault();
        items[0].focus();
      }
    }
  };

  return (
    <div className="vd-overlay" onMouseDown={(e) => e.target === e.currentTarget && onDone(false)} onKeyDown={onKey}>
      <div ref={box} className={`vd-box vd-box--${tone}`} role="alertdialog" aria-modal="true" aria-labelledby="vd-title" aria-describedby="vd-body">
        <div className="vd-top">
          <span className="vd-icon">{ICONS[tone] || ICONS.info}</span>
          <div className="vd-text">
            <h2 id="vd-title">{req.title}</h2>
            <div id="vd-body" className="vd-body">
              {typeof req.body === "string" ? <p>{req.body}</p> : req.body}
            </div>
          </div>
        </div>
        {req.note && <p className="vd-note-line">{req.note}</p>}
        <div className="vd-actions">
          {!single && (
            <button ref={cancelBtn} type="button" className="vd-btn vd-btn--ghost" onClick={() => onDone(false)}>
              {req.cancelText || "Keep it"}
            </button>
          )}
          <button ref={okBtn} type="button" className={`vd-btn ${tone === "danger" ? "vd-btn--danger" : "vd-btn--solid"}`} onClick={() => onDone(true)}>
            {req.confirmText || (single ? "Got it" : "Continue")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DialogProvider({ children }) {
  const [queue, setQueue] = useState([]);
  const open = useCallback(
    (req) =>
      new Promise((resolve) => {
        setQueue((q) => [...q, { ...req, resolve }]);
      }),
    []
  );
  const done = (answer) => {
    setQueue((q) => {
      if (q[0]) q[0].resolve(answer);
      return q.slice(1);
    });
  };
  return (
    <DialogContext.Provider value={open}>
      {children}
      {queue[0] && <Dialog key={queue.length + (queue[0].title || "")} req={queue[0]} onDone={done} />}
    </DialogContext.Provider>
  );
}

/**
 * Ask a question in the site's own dialog. Resolves true (confirmed) or false.
 * @param req { title, body (text or JSX), note, confirmText, cancelText, tone: "danger"|"info"|"ok", kind: "confirm"|"notice" }
 * Outside a DialogProvider it falls back to the browser's confirm, so nothing breaks.
 */
export function useDialog() {
  const open = useContext(DialogContext);
  return useCallback(
    (req) => {
      if (open) return open(req);
      const text = [req.title, typeof req.body === "string" ? req.body : ""].filter(Boolean).join("\n\n");
      return Promise.resolve(req.kind === "notice" ? (window.alert(text), true) : window.confirm(text)); // eslint-disable-line no-alert
    },
    [open]
  );
}
