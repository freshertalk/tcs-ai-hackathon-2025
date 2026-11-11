import React, { useState } from "react";

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
