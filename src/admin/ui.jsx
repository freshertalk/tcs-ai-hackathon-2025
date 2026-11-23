import React, { useState } from "react";
import { snack } from "./ux/snack";

export function Alert({ kind = "error", children }) {
  if (!children) return null;
  return (
    <div className={`adm-alert adm-alert--${kind}`} role={kind === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export function Field({ label, hint, id, children }) {
  return (
    <div className="adm-field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <p className="adm-hint">{hint}</p>}
    </div>
  );
}

/** A read-only value with a Copy button — for the redirect URI to register with Google. */
export function CopyBox({ value }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      snack("Copied to the clipboard.", { tone: "ok", key: "copied", ms: 2500 });
      setDone(true);
      setTimeout(() => setDone(false), 1800);
    } catch (_) {
      /* clipboard blocked: the text is selectable anyway */
    }
  };
  return (
    <div className="adm-copy">
      <code>{value}</code>
      <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={copy}>
        {done ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function Loading({ label = "Loading…" }) {
  return (
    <div className="adm-loading" role="status">
      <i aria-hidden="true" />
      {label}
    </div>
  );
}

/**
 * A settings switch as an icon: a gear, with its name on hover and for screen readers.
 * Use it where a "Settings" / "Configure" text button would only take room from the facts beside it.
 */
export function GearButton({ label = "Settings", open = false, onClick, tip, className = "", solid = false }) {
  return (
    <button type="button" className={`adm-gear ${solid ? "adm-gear--solid" : ""} ${className}`.trim()} onClick={onClick} aria-expanded={open} aria-label={label} data-tip={tip || label}>
      <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    </button>
  );
}
