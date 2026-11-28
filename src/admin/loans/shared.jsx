// Small pieces the Loans page's parts share.
import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import { usePrefs } from "../prefs";
import { hideAmounts } from "../privacy";

export const URL_ = "/api/admin/loans";
const IST_TIME = { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" };
export const when = (iso) => (iso ? `${new Date(iso).toLocaleString("en-IN", IST_TIME)} IST` : "—");

/** With “Hide amounts” on: sentences carry stars too (the switch's own watcher only stars short figures). */
export function useHidden() {
  const { prefs } = usePrefs();
  const on = Boolean(prefs && prefs.privacy);
  return useCallback((words) => (on ? hideAmounts(words) : words), [on]);
}

export function Bar({ pct, label, tone = "" }) {
  const v = Math.max(0, Math.min(100, pct || 0));
  return (
    <span className={`lo-bar ${tone}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)} aria-label={label}>
      <i style={{ width: `${v}%` }} />
    </span>
  );
}

/** Principal and interest as one split bar, with both figures in words under it (never colour alone). */
export function SplitBar({ principal, interest, label, format }) {
  const all = (principal || 0) + (interest || 0);
  if (!(all > 0)) return null;
  return (
    <div className="lo-split" role="img" aria-label={`${label}: principal ${format(principal)}, interest ${format(interest)}`}>
      <span className="lo-split__bar" aria-hidden="true">
        <i className="is-p" style={{ flexGrow: principal || 0 }} />
        <i className="is-i" style={{ flexGrow: interest || 0 }} />
      </span>
      <span className="lo-split__keys">
        <em className="is-p">Principal {format(principal)}</em>
        <em className="is-i">Interest {format(interest)}</em>
      </span>
    </div>
  );
}

/** A remark kept by leaving the box (or Enter); the box grows with the words, so nothing is cut off. */
export function RemarksBox({ value, label, onSave }) {
  const [v, setV] = useState(value);
  const [saved, setSaved] = useState(value);
  // a change made elsewhere (another tab, a form) replaces what is shown, unless it is being typed in
  if (value !== saved) {
    setSaved(value);
    setV(value);
  }
  const box = useRef(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const fit = () => {
      el.style.height = "auto";
      if (el.scrollHeight) el.style.height = `${el.scrollHeight + 2}px`;
    };
    fit();
    let width = el.clientWidth;
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            if (el.clientWidth !== width) {
              width = el.clientWidth;
              fit();
            }
          })
        : null;
    if (ro) ro.observe(el);
    return () => ro && ro.disconnect();
  }, [v]);
  return (
    <textarea
      ref={box}
      rows={1}
      className="lo-remarks"
      value={v}
      maxLength={300}
      placeholder="Add a remark"
      aria-label={label}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v.trim() !== value) onSave(v);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault(); // Enter saves; a remark is one paragraph
          e.currentTarget.blur();
        }
        if (e.key === "Escape") setV(value);
      }}
    />
  );
}
