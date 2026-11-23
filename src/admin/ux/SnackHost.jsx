// The snackbar (23 Nov 2026): short notes at the bottom of the screen — "Saved", "Copied", "You are offline", "Started" — one
// look for every private page. Notes stack (three at most on screen; the rest wait), each with its icon, its words and at most
// one action. They leave by themselves after a few seconds (an error stays longer); hovering, focusing or touching one holds it;
// a swipe sideways or the × closes it. Screen readers hear them (errors at once, others politely). On a phone they sit above the
// terminal's bottom bar. The connection is watched too: going offline says so until it is back.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { SNACK_CLOSE, SNACK_EVENT, closeSnack, snack } from "./snack";

const MAX = 3;
const ICON = {
  ok: <path d="m7.5 12.5 3 3 6-6.5" />,
  info: <path d="M12 11v5.5M12 7.8v.2" />,
  warn: <path d="M12 8v5M12 16.3v.2" />,
  error: <path d="m9 9 6 6m0-6-6 6" />,
};

let seq = 0;

function Snack({ s, onClose }) {
  const [hold, setHold] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const left = useRef(s.ms);
  const start = useRef(Date.now());
  const drag = useRef(null);
  const [dx, setDx] = useState(0);
  const close = useCallback(() => {
    setLeaving(true);
    setTimeout(() => onClose(s.id), 180);
  }, [onClose, s.id]);
  // the clock: it runs only while nobody is reading the note
  useEffect(() => {
    if (!s.ms || hold || leaving) return undefined;
    start.current = Date.now();
    const t = setTimeout(close, Math.max(400, left.current));
    return () => {
      clearTimeout(t);
      left.current -= Date.now() - start.current;
    };
  }, [s.ms, hold, leaving, close, s.bump]);
  useEffect(() => {
    left.current = s.ms;
  }, [s.bump, s.ms]);
  const down = (e) => {
    drag.current = { x: e.clientX, id: e.pointerId };
    setHold(true);
  };
  const move = (e) => {
    if (!drag.current) return;
    setDx(e.clientX - drag.current.x);
  };
  const up = () => {
    if (!drag.current) return;
    drag.current = null;
    if (Math.abs(dx) > 80) close();
    else setDx(0);
    setHold(false);
  };
  return (
    <div
      className={`ux-snack ux-snack--${s.tone} ${leaving ? "is-leaving" : ""}`}
      role={s.tone === "error" ? "alert" : "status"}
      aria-live={s.tone === "error" ? "assertive" : "polite"}
      style={dx ? { transform: `translateX(${dx}px)`, opacity: Math.max(0.2, 1 - Math.abs(dx) / 200) } : undefined}
      onMouseEnter={() => setHold(true)}
      onMouseLeave={() => !drag.current && setHold(false)}
      onFocus={() => setHold(true)}
      onBlur={() => setHold(false)}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <svg className="ux-snack__icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9.2" />
        {ICON[s.tone] || ICON.info}
      </svg>
      <p className="ux-snack__text">
        {s.text}
        {s.count > 1 && <span className="ux-snack__count"> ×{s.count}</span>}
      </p>
      {s.action && s.action.label && (
        <button
          type="button"
          className="ux-snack__act"
          onClick={() => {
            try {
              if (typeof s.action.onClick === "function") s.action.onClick();
            } finally {
              close();
            }
          }}
        >
          {s.action.label}
        </button>
      )}
      <button type="button" className="ux-snack__x" aria-label="Close this note" onClick={close}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m7 7 10 10M17 7 7 17" />
        </svg>
      </button>
    </div>
  );
}

export default function SnackHost() {
  const [list, setList] = useState([]);
  useEffect(() => {
    const onSnack = (e) => {
      const d = e.detail || {};
      const tone = ["ok", "info", "warn", "error"].includes(d.tone) ? d.tone : "info";
      const ms = d.ms === 0 ? 0 : Number.isFinite(d.ms) ? d.ms : tone === "error" ? 7000 : 4500;
      setList((cur) => {
        // the same words again (or the same key): the note on screen is renewed instead of a second one stacking
        const i = cur.findIndex((x) => (d.key && x.key === d.key) || (!d.key && x.text === d.text));
        if (i >= 0) {
          const next = [...cur];
          next[i] = { ...next[i], text: d.text, tone, ms, action: d.action || null, count: next[i].text === d.text ? next[i].count + 1 : 1, bump: (next[i].bump || 0) + 1 };
          return next;
        }
        return [...cur, { id: (seq += 1), key: d.key || "", text: d.text, tone, ms, action: d.action || null, count: 1, bump: 0 }];
      });
    };
    const onClose = (e) => {
      const k = e.detail && e.detail.key;
      if (k) setList((cur) => cur.filter((x) => x.key !== k));
    };
    // the connection: going offline is said until it is back
    const off = () => snack("You are offline. Prices and calls will catch up when the connection returns.", { tone: "warn", key: "network", ms: 0 });
    const on = () => {
      closeSnack("network");
      snack("Back online — catching up.", { tone: "ok", key: "network-back", ms: 3000 });
    };
    window.addEventListener(SNACK_EVENT, onSnack);
    window.addEventListener(SNACK_CLOSE, onClose);
    window.addEventListener("offline", off);
    window.addEventListener("online", on);
    return () => {
      window.removeEventListener(SNACK_EVENT, onSnack);
      window.removeEventListener(SNACK_CLOSE, onClose);
      window.removeEventListener("offline", off);
      window.removeEventListener("online", on);
    };
  }, []);
  const remove = useCallback((id) => setList((cur) => cur.filter((x) => x.id !== id)), []);
  const shown = list.slice(0, MAX);
  return (
    <section className="ux-snacks" aria-label="Notifications">
      {shown.map((s) => (
        <Snack key={s.id} s={s} onClose={remove} />
      ))}
      {list.length > MAX && <p className="ux-snacks__more">{list.length - MAX} more waiting</p>}
    </section>
  );
}
