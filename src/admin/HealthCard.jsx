// Site health — the card under Settings on /me: every part of the site, working, switched off or in
// trouble, with a plain sentence and what to do. Re-read every minute while the page is open.

import React, { useCallback, useEffect, useState } from "react";
import { api } from "./api";

const MARK = { ok: "✓", warn: "!", error: "✕", off: "–" };
const WORD = { ok: "Working", warn: "Look at it", error: "Not working", off: "Off" };

export default function HealthCard() {
  const [h, setH] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => {
    setBusy(true);
    api("/api/admin/health")
      .then((d) => {
        if (d && Array.isArray(d.checks)) {
          setH(d);
          setErr("");
        }
      })
      .catch((e) => setErr(e.message))
      .finally(() => setBusy(false));
  }, []);
  useEffect(() => {
    load();
    const id = setInterval(() => document.visibilityState !== "hidden" && load(), 60000);
    return () => clearInterval(id);
  }, [load]);
  if (!h && !err) return null;
  const groups = h ? [...new Set(h.checks.map((c) => c.group))] : [];
  const problems = h ? h.checks.filter((c) => c.status === "warn" || c.status === "error") : [];
  return (
    <section className={`hlth is-${h ? h.overall : "error"}`} aria-labelledby="hlth-h">
      <header className="hlth__head">
        <div>
          <h3 id="hlth-h">Site health</h3>
          <p>{h ? `${h.counts.ok} working · ${h.counts.warn} to look at · ${h.counts.error} not working · ${h.counts.off} off — checked ${new Date(h.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : err}</p>
        </div>
        <span className="hlth__tools">
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={load} disabled={busy}>
            {busy ? "Checking…" : "Check now"}
          </button>
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? "Hide the list" : `Show all ${h ? h.checks.length : ""}`}
          </button>
        </span>
      </header>
      {problems.length > 0 && !open && (
        <ul className="hlth__list">
          {problems.map((c) => (
            <Row key={c.id} c={c} />
          ))}
        </ul>
      )}
      {problems.length === 0 && !open && h && <p className="hlth__fine">Everything that is switched on is working.</p>}
      {open &&
        groups.map((g) => (
          <div key={g} className="hlth__group">
            <h4>{g}</h4>
            <ul className="hlth__list">
              {h.checks
                .filter((c) => c.group === g)
                .map((c) => (
                  <Row key={c.id} c={c} />
                ))}
            </ul>
          </div>
        ))}
    </section>
  );
}

function Row({ c }) {
  return (
    <li className={`hlth__row is-${c.status}`}>
      <span className="hlth__dot" aria-label={WORD[c.status]} title={WORD[c.status]}>
        {MARK[c.status]}
      </span>
      <span className="hlth__body">
        <b>{c.name}</b>
        <span>{c.detail}</span>
        {c.hint && <small>→ {c.hint}</small>}
      </span>
    </li>
  );
}
