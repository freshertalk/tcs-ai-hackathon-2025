// AI Engine: everything about the AI in one place.
//   - How the AI works: every AI feature, rule and condition, in plain English (everyone).
//   - Brains: the owner's standing instructions for the AI — add, edit, switch off, reorder, delete,
//     with the AI team (the free NVIDIA-hosted models, and the paid model when it is on) writing
//     and placing each one (superadmin only).
//   - Real instructions: what every feature actually sends the AI now, brains included (superadmin).
//   - Skills file: the core rules every strategist / research / decision request reads (superadmin).
//   - Live engine: the one engine every feature uses — what is asking the models right now, the
//     shared lanes, and today's calls per feature (every admin).
//   - Word: the whole page as a .docx.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BRAND } from "../../brand";
import { api } from "../../api";
import { useAuth } from "../../auth";
import { Alert, Loading } from "../../ui";
import { useDialog } from "../../dialog/DialogProvider";
import { DocView } from "../docs/Document";
import { downloadDocx } from "../docs/docx";
import { AI } from "../docs/content/ai";
import { ENGINE } from "../docs/content/engine";
import "../docs/document.css";
import "./engine.css";

const PARTS = [
  { id: "ai", title: "How the AI works" },
  { id: "brains", title: "Brains and instructions" },
];
const CHAPTERS = [...AI, ...ENGINE].map((c, i) => ({ ...c, no: String(i + 1) }));
const when = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

/* ------------------------------------------------------------------------------- brains */

function ScopePicker({ features, value, onChange, disabled }) {
  const all = value.includes("all");
  const flip = (id) => {
    if (id === "all") return onChange(all ? [] : ["all"]);
    const cur = value.filter((x) => x !== "all");
    onChange(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  };
  return (
    <div className="eng-scopes" role="group" aria-label="Where it applies">
      <label className={`eng-chip ${all ? "is-on" : ""}`}>
        <input type="checkbox" checked={all} onChange={() => flip("all")} disabled={disabled} /> All features
      </label>
      {features.map((f) => (
        <label key={f.id} className={`eng-chip ${!all && value.includes(f.id) ? "is-on" : ""}`} data-tip={f.trigger}>
          <input type="checkbox" checked={!all && value.includes(f.id)} onChange={() => flip(f.id)} disabled={disabled || all} /> {f.name}
        </label>
      ))}
    </div>
  );
}

function Editor({ start, features, team, limits, onSaved, onCancel }) {
  const [title, setTitle] = useState(start ? start.title : "");
  const [text, setText] = useState(start ? start.text : "");
  const [scopes, setScopes] = useState(start ? start.scopes : ["all"]);
  const [enabled, setEnabled] = useState(start ? start.enabled !== false : true);
  const [refine, setRefine] = useState(true);
  const [keepScopes, setKeepScopes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const hasTeam = team && (team.free.length > 0 || team.lead);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const d = await api("/api/admin/ai/brains", { method: "POST", body: { id: start ? start.id : undefined, title, text, scopes: scopes.length ? scopes : ["all"], enabled, refine: refine && hasTeam, keepScopes } });
      onSaved(d);
    } catch (x) {
      setErr(x.message);
    }
    setBusy(false);
  };
  return (
    <form className="eng-edit" onSubmit={save}>
      <h4>{start ? "Edit the brain" : "A new brain"}</h4>
      <label className="eng-field">
        <span>Title</span>
        <input value={title} maxLength={limits.title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Midday discipline" required />
      </label>
      <label className="eng-field">
        <span>
          The instruction <small>{text.length} / {limits.text}</small>
        </span>
        <textarea rows={6} value={text} maxLength={limits.text} onChange={(e) => setText(e.target.value)} placeholder="Write it in your own words — the AI team will polish it. e.g. Between 11:30 and 1:30 prefer no trade unless the tape is strong." required />
      </label>
      <div className="eng-field">
        <span>Where it applies</span>
        <ScopePicker features={features} value={scopes} onChange={setScopes} disabled={busy} />
      </div>
      <div className="eng-opts">
        <label className="eng-check">
          <input type="checkbox" checked={refine && Boolean(hasTeam)} disabled={!hasTeam || busy} onChange={(e) => setRefine(e.target.checked)} /> Let the AI team refine it and decide where it belongs
        </label>
        {refine && hasTeam && (
          <label className="eng-check">
            <input type="checkbox" checked={keepScopes} disabled={busy} onChange={(e) => setKeepScopes(e.target.checked)} /> Keep my scopes
          </label>
        )}
        <label className="eng-check">
          <input type="checkbox" checked={enabled} disabled={busy} onChange={(e) => setEnabled(e.target.checked)} /> Switched on
        </label>
      </div>
      <p className="eng-dim">
        {hasTeam ? (
          <>
            The team now: <b>{team.free.length} free model{team.free.length === 1 ? "" : "s"}</b>
            {team.free.length ? ` (${team.free.join(", ")})` : ""}
            {team.lead ? (
              <>
                {" "}
                and the paid lead <b>{team.lead}</b>
              </>
            ) : (
              " — no paid model (switched off or no paid key)"
            )}
            . Your own wording is kept and can be put back.
          </>
        ) : (
          "No AI key is saved for the team (the free NVIDIA key, or a paid key on the AI page), so the brain is saved exactly as written."
        )}
      </p>
      <Alert>{err}</Alert>
      <span className="eng-actions">
        <button type="submit" className="adm-btn adm-btn--solid adm-btn--sm" disabled={busy}>
          {busy ? (refine && hasTeam ? "The AI team is writing… (up to two minutes)" : "Saving…") : start ? "Save the brain" : "Add the brain"}
        </button>
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </span>
    </form>
  );
}

function TeamResult({ r, onClose }) {
  if (!r || !r.refine) return null;
  const t = r.refine;
  return (
    <section className="eng-team" aria-label="What the AI team did">
      <header>
        <b>Written by {t.models.length} model{t.models.length === 1 ? "" : "s"} · merged by {t.mergedBy}</b>
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={onClose}>
          Close
        </button>
      </header>
      {t.final.notes && <p>{t.final.notes}</p>}
      {t.final.conflicts && t.final.conflicts.length > 0 && (
        <ul className="eng-warn">
          {t.final.conflicts.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
      <details>
        <summary>Each model’s version ({t.versions.length})</summary>
        <ul className="eng-versions">
          {t.versions.map((v) => (
            <li key={v.id} className={v.ok ? "" : "is-failed"}>
              <b>
                {v.name}
                {v.lead ? " · paid lead" : " · free"}
              </b>{" "}
              <small>{Math.round((v.ms || 0) / 1000)} s</small>
              {v.ok ? (
                <>
                  <p>
                    <i>{v.title}</i> — {v.text}
                  </p>
                  <small>{v.rationale}</small>
                </>
              ) : (
                <p className="eng-dim">No answer: {v.error}</p>
              )}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function BrainCard({ b, i, n, features, onEdit, onChanged, onError }) {
  const ask = useDialog();
  const [open, setOpen] = useState(false);
  const names = b.scopes.includes("all") ? ["All features"] : b.scopes.map((s) => (features.find((f) => f.id === s) || { name: s }).name);
  const act = async (fn) => {
    try {
      onChanged(await fn());
    } catch (e) {
      onError(e.message);
    }
  };
  const del = async () => {
    const yes = await ask({ tone: "danger", title: "Delete this brain?", body: `“${b.title}” stops reaching the AI at once and is removed with its history.`, confirmText: "Delete the brain", cancelText: "Keep it" });
    if (yes) act(() => api(`/api/admin/ai/brains/${b.id}`, { method: "DELETE" }));
  };
  return (
    <article className={`eng-brain ${b.enabled === false ? "is-off" : ""}`}>
      <header>
        <span className="eng-brain__no">{i + 1}</span>
        <h4>{b.title}</h4>
        <label className="eng-switch" data-tip="Switched off, the brain is kept but sent nowhere.">
          <input type="checkbox" checked={b.enabled !== false} onChange={(e) => act(() => api(`/api/admin/ai/brains/${b.id}/enabled`, { method: "PUT", body: { enabled: e.target.checked } }))} /> {b.enabled === false ? "Off" : "On"}
        </label>
      </header>
      <p className="eng-brain__text">{b.text}</p>
      <p className="eng-brain__meta">
        {names.map((x) => (
          <span key={x} className="eng-tag">
            {x}
          </span>
        ))}
      </p>
      <p className="eng-dim">
        {b.refined ? `Refined by ${b.refined.by.length} model${b.refined.by.length === 1 ? "" : "s"}, merged by ${b.refined.mergedBy} · ` : "As written · "}
        updated {when(b.updatedAt)}
      </p>
      {b.refined && b.refined.conflicts && b.refined.conflicts.length > 0 && (
        <ul className="eng-warn">
          {b.refined.conflicts.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
      <span className="eng-actions">
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => onEdit(b)}>
          Edit
        </button>
        {b.original && (
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => act(() => api(`/api/admin/ai/brains/${b.id}/revert`, { method: "POST", body: { to: "original" } }))} data-tip={`Your wording: “${b.original.text.slice(0, 160)}”`}>
            Use my wording
          </button>
        )}
        {(b.history || []).length > 0 && (
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            History ({b.history.length})
          </button>
        )}
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={i === 0} onClick={() => act(() => api(`/api/admin/ai/brains/${b.id}/move`, { method: "POST", body: { dir: "up" } }))} aria-label="Move up">
          ↑
        </button>
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={i === n - 1} onClick={() => act(() => api(`/api/admin/ai/brains/${b.id}/move`, { method: "POST", body: { dir: "down" } }))} aria-label="Move down">
          ↓
        </button>
        <button type="button" className="adm-btn adm-btn--danger adm-btn--sm" onClick={del}>
          Delete
        </button>
      </span>
      {open && (
        <ol className="eng-history">
          {b.history.map((h, k) => (
            <li key={h.at + k}>
              <small>{when(h.at)}</small> <i>{h.title}</i> — {h.text.slice(0, 300)}
              {h.text.length > 300 ? "…" : ""}{" "}
              <button type="button" className="ta-link" onClick={() => act(() => api(`/api/admin/ai/brains/${b.id}/revert`, { method: "POST", body: { to: "history", index: k } }))}>
                Put this back
              </button>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

function Brains({ data, setData }) {
  const [editing, setEditing] = useState(null); // null | "new" | brain
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");
  if (!data) return <Loading label="Reading the brains…" />;
  const { brains, features, team, limits } = data;
  const saved = (d) => {
    setData(d);
    setEditing(null);
    setResult(d.refine ? d : null);
  };
  return (
    <div className="eng-brains">
      <section className="eng-card">
        <header className="eng-card__h">
          <div>
            <h3>Brains ({brains.length})</h3>
            <p>Standing instructions for the AI, written once and followed by every feature they belong to — from the next request on. Only you (the superadmin) can see and change them.</p>
          </div>
          {!editing && (
            <button type="button" className="adm-btn adm-btn--solid adm-btn--sm" onClick={() => setEditing("new")} disabled={brains.length >= limits.brains}>
              + Add a brain
            </button>
          )}
        </header>
        {editing && <Editor key={editing === "new" ? "new" : editing.id} start={editing === "new" ? null : editing} features={features} team={team} limits={limits} onSaved={saved} onCancel={() => setEditing(null)} />}
        <TeamResult r={result} onClose={() => setResult(null)} />
        <Alert>{err}</Alert>
        {!brains.length && !editing && <p className="eng-dim">No brains yet. The AI follows the trading-skills file and each feature’s own instructions. Add one to teach every feature a rule of yours.</p>}
        <div className="eng-list">
          {brains.map((b, i) => (
            <BrainCard key={b.id} b={b} i={i} n={brains.length} features={features} onEdit={(x) => { setEditing(x); setResult(null); window.scrollTo({ top: 0, behavior: "smooth" }); }} onChanged={(d) => { setData(d); setErr(""); }} onError={setErr} />
          ))}
        </div>
      </section>
      <section className="eng-card">
        <h3>Which brains reach which feature</h3>
        <div className="doc-table" role="region" tabIndex={0} aria-label="Brains by feature">
          <table>
            <thead>
              <tr>
                <th>Feature</th>
                <th>Started by</th>
                <th>Brains it receives now</th>
              </tr>
            </thead>
            <tbody>
              {features.map((f) => (
                <tr key={f.id}>
                  <td data-label="Feature">{f.name}</td>
                  <td data-label="Started by">{f.trigger}</td>
                  <td data-label="Brains">{f.brains.length ? f.brains.map((id) => (brains.find((b) => b.id === id) || {}).title).join(" · ") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/* --------------------------------------------------------------------- real instructions */

function Instructions({ engine }) {
  if (!engine) return <Loading label="Reading the instructions…" />;
  return (
    <div className="eng-ins">
      <p className="eng-dim">What each feature sends the AI right now, word for word — its own instructions, then the brains that are added to it. The data (the brief) follows these in each request.</p>
      {engine.features.map((f) => (
        <details key={f.id} className="eng-card eng-ins__f">
          <summary>
            <b>{f.name}</b> <small>{f.trigger}</small>
          </summary>
          {f.prompts.map((p) => (
            <div key={p.label}>
              <h5>{p.label}</h5>
              <pre>{p.text}</pre>
            </div>
          ))}
          <h5>Brains added now</h5>
          {f.brains ? <pre>{f.brains.trim()}</pre> : <p className="eng-dim">None.</p>}
        </details>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- skills file */

function Skills({ engine, onSaved }) {
  const [draft, setDraft] = useState(engine ? engine.skills.text : "");
  const [msg, setMsg] = useState({ kind: "", text: "" });
  const [busy, setBusy] = useState(false);
  const ask = useDialog();
  useEffect(() => {
    if (engine) setDraft(engine.skills.text);
  }, [engine]);
  if (!engine) return <Loading label="Reading the skills file…" />;
  const save = async (reset) => {
    if (reset) {
      const yes = await ask({ tone: "danger", title: "Reset the skills file?", body: "The starting rules come back; every lesson and the paper-test findings are cleared.", confirmText: "Reset it", cancelText: "Keep it" });
      if (!yes) return;
    }
    setBusy(true);
    setMsg({ kind: "", text: "" });
    try {
      const d = reset ? await api("/api/admin/ai/skills/reset", { method: "POST" }) : await api("/api/admin/ai/skills", { method: "PUT", body: { text: draft } });
      setDraft(d.text);
      setMsg({ kind: "ok", text: reset ? "Restored the starting rules." : "Saved. Every request that reads the skills file uses it from now on." });
      onSaved();
    } catch (e) {
      setMsg({ kind: "error", text: e.message });
    }
    setBusy(false);
  };
  return (
    <section className="eng-card">
      <header className="eng-card__h">
        <div>
          <h3>The trading-skills file</h3>
          <p>The core brain: sent in full with every strategy, research note, decision, coach reading and journal review; its first 6,000 characters with the day review. Lessons are added by Score &amp; learn and by the rules you accept.</p>
        </div>
        <small>
          {draft.length} / 24,000 · {engine.skills.lessons} lessons
        </small>
      </header>
      <textarea className="eng-skills" rows={22} value={draft} maxLength={24000} onChange={(e) => setDraft(e.target.value)} spellCheck="false" />
      <Alert kind={msg.kind === "ok" ? "ok" : "error"}>{msg.text}</Alert>
      <span className="eng-actions">
        <button type="button" className="adm-btn adm-btn--solid adm-btn--sm" disabled={busy || draft === engine.skills.text} onClick={() => save(false)}>
          Save
        </button>
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={busy || draft === engine.skills.text} onClick={() => setDraft(engine.skills.text)}>
          Undo changes
        </button>
        <button type="button" className="adm-btn adm-btn--danger adm-btn--sm" disabled={busy} onClick={() => save(true)}>
          Reset to the starting rules
        </button>
      </span>
    </section>
  );
}

/* -------------------------------------------------------------------------- live engine */

const fmtTok = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n || 0));

function LiveEngine() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let alive = true;
    const read = () => {
      if (document.visibilityState === "hidden") return;
      api("/api/admin/ai/engine/live")
        .then((x) => {
          if (!alive || !x || !Array.isArray(x.running)) return;
          setD(x);
          setErr("");
        })
        .catch((e) => alive && setErr(e.message));
    };
    read();
    const id = setInterval(read, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  if (!d) return err ? <Alert>{err}</Alert> : <Loading label="Reading the engine…" />;
  const used = d.today.features.filter((f) => f.calls > 0);
  const idle = d.today.features.filter((f) => f.calls === 0);
  return (
    <div className="eng-live">
      <section className="eng-card eng-live__hero">
        <div className="eng-live__core" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div>
          <h3>One engine, every feature</h3>
          <p className="eng-dim">
            Every AI feature — strategist, co-pilot, decision, research, coach, reviews, debrief, AI Live / AI Research, TradeAI, WhatsApp and the brains team — reaches the models through this one engine. Each request carries the same brains and trading-skills rules, and requests that share a key queue fairly, so many features can use the free models at the same time.
          </p>
          <div className="eng-live__chips">
            <span>
              <b>{d.core.brainsOn}</b> of {d.core.brains} brains on
            </span>
            <span>
              Skills file <b>{fmtTok(d.core.skillsChars)}</b> characters
            </span>
            <span>
              Free models <b>{d.core.lanes.nvidia}</b> at a time · others <b>{d.core.lanes.other}</b>
            </span>
            <span>
              <b>{d.running.length}</b> running now
            </span>
          </div>
        </div>
      </section>

      <section className="eng-card" aria-live="polite">
        <h3>Running now</h3>
        {d.running.length === 0 ? (
          <p className="eng-dim">Nothing is asking the models at this moment. Use TradeAI, AI Live or any AI button and watch it appear here.</p>
        ) : (
          <ul className="eng-live__run">
            {d.running.map((r, i) => (
              <li key={i} className={r.waiting ? "is-wait" : ""}>
                <span className="eng-live__dot" />
                <b>{r.name}</b>
                <span>{r.model}</span>
                <small>{r.waiting ? `waiting for a free lane · ${r.sec}s` : `${r.kind === "search" ? "searching" : "thinking"} · ${r.sec}s`}</small>
              </li>
            ))}
          </ul>
        )}
        {d.lanes.length > 0 && (
          <div className="eng-live__lanes">
            {d.lanes.map((l) => (
              <div key={l.lane}>
                <span>{l.lane === "nvidia" ? "Free NVIDIA models" : l.lane}</span>
                <span className="eng-live__bar" role="img" aria-label={`${l.busy} of ${l.limit} in use, ${l.waiting} waiting`}>
                  <i style={{ width: `${Math.min(100, (l.busy / l.limit) * 100)}%` }} />
                </span>
                <small>
                  {l.busy}/{l.limit}
                  {l.waiting ? ` · ${l.waiting} waiting` : ""}
                </small>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="eng-card">
        <h3>Today ({d.today.date || "no calls yet"})</h3>
        <div className="eng-live__tablewrap">
          <table className="eng-live__table">
            <thead>
              <tr>
                <th>Feature</th>
                <th>Brains</th>
                <th>Calls</th>
                <th>Failed</th>
                <th>Avg time</th>
                <th>Tokens in / out</th>
                <th>Models</th>
                <th>Last</th>
              </tr>
            </thead>
            <tbody>
              {[...used, ...idle].map((f) => (
                <tr key={f.id} className={f.calls ? "" : "is-idle"}>
                  <td>
                    <b>{f.name}</b>
                  </td>
                  <td>{f.brains}</td>
                  <td>{f.calls}</td>
                  <td className={f.failed ? "is-bad" : ""}>{f.failed}</td>
                  <td>{f.avgSec !== null ? `${f.avgSec}s` : "—"}</td>
                  <td>{f.calls ? `${fmtTok(f.input)} / ${fmtTok(f.output)}` : "—"}</td>
                  <td className="eng-live__models">{Object.entries(f.models).map(([m, n]) => `${m} ×${n}`).join(", ") || "—"}</td>
                  <td>{when(f.last) || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {d.recent.length > 0 && (
        <section className="eng-card">
          <h3>Last calls</h3>
          <ul className="eng-live__recent">
            {d.recent.slice(0, 20).map((r, i) => (
              <li key={i} className={r.ok ? "" : "is-bad"}>
                <span>{r.ok ? "✓" : "✕"}</span>
                <b>{r.name}</b>
                <span>{r.model}</span>
                <small>
                  {(r.ms / 1000).toFixed(1)}s{r.waitMs > 300 ? ` (waited ${(r.waitMs / 1000).toFixed(1)}s)` : ""} · {when(r.at)}
                  {r.error ? ` · ${r.error}` : ""}
                </small>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------------------- page */

export default function AiEngine() {
  const { user } = useAuth() || {};
  const isSuper = Boolean(user && user.role === "superadmin");
  const [tab, setTab] = useState("doc");
  const [brains, setBrains] = useState(null);
  const [engine, setEngine] = useState(null);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    if (!isSuper) return;
    api("/api/admin/ai/brains").then(setBrains).catch((e) => setErr(e.message));
    api("/api/admin/ai/engine").then(setEngine).catch((e) => setErr(e.message));
  }, [isSuper]);
  useEffect(() => {
    load();
  }, [load]);
  // the real instructions follow the brains: read them again after a change
  const setBrainsAndReload = (d) => {
    setBrains(d);
    api("/api/admin/ai/engine").then(setEngine).catch(() => {});
  };

  const appendix = useMemo(() => {
    if (!isSuper) return [];
    const out = [];
    if (brains) {
      out.push({
        title: `Appendix A — The brains (${brains.brains.length})`,
        intro: brains.brains.length ? "Each brain, where it applies and whether it is on." : "No brains have been written yet.",
        blocks: brains.brains.flatMap((b, i) => [
          { h: `${i + 1}. ${b.title}${b.enabled === false ? " (switched off)" : ""}` },
          { p: b.text },
          { p: `Applies to: ${b.scopes.includes("all") ? "all features" : b.scopes.map((s) => (brains.features.find((f) => f.id === s) || { name: s }).name).join(", ")}. ${b.refined ? `Refined by ${b.refined.by.join(", ")}; merged by ${b.refined.mergedBy}.` : "As written by the owner."}` },
        ]),
      });
    }
    if (engine) {
      out.push({
        title: "Appendix B — The real instructions of every AI feature",
        intro: "Word for word, as sent now, with the brains that are added.",
        blocks: engine.features.flatMap((f) => [{ h: `${f.name} — ${f.trigger}` }, ...f.prompts.map((p) => ({ pre: `${p.label}:\n\n${p.text}` })), ...(f.brains ? [{ pre: f.brains.trim() }] : [])]),
      });
      out.push({ title: "Appendix C — The trading-skills file", blocks: [{ pre: engine.skills.text }] });
    }
    return out;
  }, [isSuper, brains, engine]);

  const word = () => downloadDocx(`${BRAND.name}-AI-Engine.docx`, { title: `${BRAND.name} — AI Engine`, subtitle: "Every AI feature, rule and condition — and the owner’s AI brains", parts: PARTS, chapters: CHAPTERS, appendix });

  const tabs = [
    { id: "doc", label: "How the AI works" },
    { id: "live", label: "Live engine" },
    ...(isSuper
      ? [
          { id: "brains", label: `Brains${brains ? ` (${brains.brains.length})` : ""}` },
          { id: "ins", label: "Real instructions" },
          { id: "skills", label: "Skills file" },
        ]
      : []),
  ];

  return (
    <div className="eng">
      <nav className="eng-tabs" aria-label="AI Engine">
        {tabs.map((t) => (
          <button key={t.id} type="button" aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
        <span className="eng-grow" />
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={word} data-tip={isSuper ? "The whole AI Engine as a Word file, with the brains, every feature's real instructions and the skills file." : "The AI Engine explanation as a Word file."}>
          Download Word ⤓
        </button>
      </nav>
      <Alert>{err}</Alert>
      {!isSuper && <p className="eng-dim eng-note">The brains, the real instructions and the skills file are shown to the superadmin only.</p>}
      {tab === "doc" && (
        <DocView
          parts={PARTS}
          chapters={CHAPTERS}
          kicker="AI Engine"
          title="AI Engine — every AI rule, condition and brain"
          lead="Everything the AI does on this desk: which companies and models, who starts each request, what is sent and what never is, the checks on every answer, how answers are weighed and scored — and the owner’s brains, the instructions every AI feature follows."
          endNote="The AI is a second opinion and a writer. The rule engines make the calls, the arithmetic checks every plan, and you decide. It can never place an order and it never promises a profit."
          onWord={word}
        />
      )}
      {tab === "live" && <LiveEngine />}
      {tab === "brains" && isSuper && <Brains data={brains} setData={setBrainsAndReload} />}
      {tab === "ins" && isSuper && <Instructions engine={engine} />}
      {tab === "skills" && isSuper && <Skills engine={engine} onSaved={load} />}
    </div>
  );
}
