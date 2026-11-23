// Vinaypedia — Vinay's own learning (23 Nov 2026): every intraday topic in one place, kept by the desk itself.
//
//   Library         the desk's knowledge base by area (the same pages every AI feature reads), each area with its official
//                   reading (NSE, SEBI, Zerodha Varsity, Zerodha's own pages, RBI)
//   Official updates the newest NSE circulars, SEBI, Zerodha Z-Connect and Varsity, and RBI press releases, read by the server
//                   every six hours from their own feeds and filed under the areas they touch (no AI)
//   AI lessons      the AI writes an area's lesson from those pages, updates and your notes — only when you press the button
//                   (or allow it on the popup when new circulars arrive)
//   My learnings    what you learnt, typed in: a lesson, a rule you follow, a mistake to avoid, an idea to test
//
// Everything updates by itself (the live channel), and a search covers all four.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import { everyVisible } from "../../visible";
import { snack } from "../../ux/snack";
import Skeleton from "../../ux/Skeleton";
import "./vinaypedia.css";

export const KIND_LABEL = { lesson: "Lesson", rule: "Rule I follow", mistake: "Mistake to avoid", idea: "Idea to test" };
const FILTERS = [
  ["all", "All"],
  ["library", "Library"],
  ["updates", "Official updates"],
  ["ai", "AI lessons"],
  ["mine", "My learnings"],
];
const ALL = "";
const day = (iso) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "");
const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "");

/** Every word of the query appears somewhere in the text (case does not matter). Pure, for the tests. */
export function matches(q, ...parts) {
  const words = String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = parts.flat().join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}

/* ------------------------------------------------------------------------------------------- the form */
function NoteForm({ areas, kinds, start, onClose, onSaved }) {
  const editing = Boolean(start && start.id);
  const [f, setF] = useState(() => ({
    title: (start && start.title) || "",
    area: (start && start.area) || "My own",
    kind: (start && start.kind) || "lesson",
    body: (start && start.body) || "",
    tags: start && start.tags ? start.tags.join(", ") : "",
    link: (start && start.link) || "",
    pinned: Boolean(start && start.pinned),
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const first = useRef(null);
  useEffect(() => {
    if (first.current) first.current.focus();
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e && e.target ? (e.target.type === "checkbox" ? e.target.checked : e.target.value) : e }));
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const body = { ...f, tags: f.tags };
      const r = editing ? await api(`/api/admin/learning/notes/${start.id}`, { method: "PUT", body }) : await api("/api/admin/learning/notes", { method: "POST", body });
      snack(editing ? "Learning saved." : "Learning added.", { tone: "ok" });
      onSaved(r.note);
    } catch (x) {
      setErr(x.message);
      setBusy(false);
    }
  };
  return (
    <div className="vp-modal" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="vp-sheet" role="dialog" aria-modal="true" aria-labelledby="vp-form-h" onSubmit={save}>
        <header className="vp-sheet__head">
          <h3 id="vp-form-h">{editing ? "Edit my learning" : "Add my learning"}</h3>
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={onClose} aria-label="Close the form">
            ✕
          </button>
        </header>
        <label className="vp-field">
          <span>Title</span>
          <input ref={first} value={f.title} onChange={set("title")} maxLength={120} required placeholder="e.g. No fresh trade after 2:45 PM" />
        </label>
        <div className="vp-field">
          <span id="vp-kind-l">Kind</span>
          <div className="sv__ranges vp-kinds" role="group" aria-labelledby="vp-kind-l">
            {kinds.map((k) => (
              <button key={k} type="button" aria-pressed={f.kind === k} onClick={() => set("kind")(k)}>
                {KIND_LABEL[k] || k}
              </button>
            ))}
          </div>
        </div>
        <label className="vp-field">
          <span>Area</span>
          <select value={f.area} onChange={set("area")}>
            {areas.map((a) => (
              <option key={a.name} value={a.name}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="vp-field">
          <span>What I learnt</span>
          <textarea value={f.body} onChange={set("body")} maxLength={4000} rows={7} placeholder="In your own words: what happened, what you learnt, what you will do next time." />
          <small>{f.body.length} / 4000</small>
        </label>
        <div className="vp-field-row">
          <label className="vp-field">
            <span>Tags</span>
            <input value={f.tags} onChange={set("tags")} placeholder="orb, discipline" />
          </label>
          <label className="vp-field">
            <span>Link (optional)</span>
            <input type="url" value={f.link} onChange={set("link")} placeholder="https://" />
          </label>
        </div>
        <label className="vp-check">
          <input type="checkbox" checked={f.pinned} onChange={set("pinned")} /> Pin to the top
        </label>
        {err && <p className="adm-alert adm-alert--error">{err}</p>}
        <footer className="vp-sheet__foot">
          <button type="button" className="adm-btn adm-btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="adm-btn" disabled={busy || !f.title.trim()}>
            {busy ? "Saving…" : editing ? "Save" : "Add learning"}
          </button>
        </footer>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------- the pieces */
function NoteCard({ n, onEdit, onRemove, onArea }) {
  const [sure, setSure] = useState(false);
  return (
    <article className={`vp-note vp-note--${n.kind}${n.pinned ? " is-pinned" : ""}`}>
      <header>
        <span className="vp-badge">{KIND_LABEL[n.kind] || n.kind}</span>
        {n.pinned && <span className="vp-badge vp-badge--pin">Pinned</span>}
        <h4>{n.title}</h4>
      </header>
      {n.body && <p className="vp-note__body">{n.body}</p>}
      <footer>
        <span className="vp-meta">
          {onArea ? (
            <button type="button" className="vp-link" onClick={() => onArea(n.area)}>
              {n.area}
            </button>
          ) : (
            n.area
          )}{" "}
          · {n.name || n.by} · {day(n.updatedAt || n.createdAt)}
          {n.tags && n.tags.length ? <> · {n.tags.map((t) => `#${t}`).join(" ")}</> : null}
        </span>
        <span className="vp-note__act">
          {n.link && (
            <a className="vp-link" href={n.link} target="_blank" rel="noopener noreferrer">
              Link<span className="adm-sr"> (opens in a new tab)</span>
            </a>
          )}
          {n.mine && (
            <>
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => onEdit(n)}>
                Edit
              </button>
              <button type="button" className={`adm-btn adm-btn--ghost adm-btn--sm${sure ? " vp-danger" : ""}`} onClick={() => (sure ? onRemove(n) : setSure(true))} onBlur={() => setSure(false)}>
                {sure ? "Sure? Delete" : "Delete"}
              </button>
            </>
          )}
        </span>
      </footer>
    </article>
  );
}

function UpdateRow({ u, onArea }) {
  return (
    <li className="vp-update">
      <span className={`vp-src vp-src--${u.source}`}>{u.by}</span>
      <div className="vp-update__txt">
        {u.link ? (
          <a href={u.link} target="_blank" rel="noopener noreferrer">
            {u.title}
            <span className="adm-sr"> (opens in a new tab)</span>
          </a>
        ) : (
          <b>{u.title}</b>
        )}
        {u.text && u.text !== u.title && <small>{u.text}</small>}
        <span className="vp-meta">
          {day(u.at)}
          {u.areas && u.areas.length > 0 && onArea && (
            <>
              {" · "}
              {u.areas.slice(0, 3).map((a, i) => (
                <React.Fragment key={a}>
                  {i > 0 ? ", " : ""}
                  <button type="button" className="vp-link" onClick={() => onArea(a)}>
                    {a}
                  </button>
                </React.Fragment>
              ))}
            </>
          )}
        </span>
      </div>
    </li>
  );
}

function PageCard({ t, open, onToggle }) {
  const shown = open ? t.rules : t.rules.slice(0, 2);
  return (
    <article className="vp-page">
      <button type="button" className="vp-page__head" aria-expanded={open} onClick={onToggle}>
        <h4>{t.title}</h4>
        <span className="vp-page__n">{t.rules.length} points</span>
        <span className="vp-page__chev" aria-hidden="true">
          {open ? "−" : "+"}
        </span>
      </button>
      <ul>
        {shown.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
      {!open && t.rules.length > 2 && (
        <button type="button" className="vp-link vp-page__more" onClick={onToggle}>
          {t.rules.length - 2} more
        </button>
      )}
    </article>
  );
}

function Lesson({ l, reading }) {
  const R = new Map(reading.map((r) => [r.id, r]));
  const List = ({ title, items }) =>
    items && items.length ? (
      <div className="vp-lesson__block">
        <h5>{title}</h5>
        <ul>
          {items.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      </div>
    ) : null;
  return (
    <div className="vp-lesson">
      <p className="vp-lesson__sum">{l.summary}</p>
      <div className="vp-lesson__grid">
        <List title="Key points" items={l.points} />
        <List title="Rules for the day" items={l.rules} />
        <List title="Mistakes to avoid" items={l.mistakes} />
        <List title="Before a trade" items={l.checklist} />
      </div>
      {l.example && (
        <div className="vp-lesson__ex">
          <h5>Worked example</h5>
          <p>{l.example}</p>
        </div>
      )}
      {l.read && l.read.length > 0 && (
        <p className="vp-lesson__read">
          Read next:{" "}
          {l.read
            .map((id) => R.get(id))
            .filter(Boolean)
            .map((r, i) => (
              <React.Fragment key={r.id}>
                {i > 0 ? " · " : ""}
                <a href={r.url} target="_blank" rel="noopener noreferrer">
                  {r.name}
                  <span className="adm-sr"> (opens in a new tab)</span>
                </a>
              </React.Fragment>
            ))}
        </p>
      )}
      <p className="vp-meta">
        Written by the AI ({l.model || "model"}) on {day(l.at)} from {l.grounded ? `${l.grounded.pages} pages, ${l.grounded.updates} official updates and ${l.grounded.notes} of your notes` : "the library"}. {l.caveat}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------- the page */
export default function Vinaypedia() {
  const [state, setState] = useState({ loading: true, data: null, error: "" });
  const [area, setArea] = useState(ALL);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [form, setForm] = useState(null); // null | {} (new) | note (edit)
  const [open, setOpen] = useState(() => new Set());
  const [busy, setBusy] = useState("");
  const [showAllUpdates, setShowAllUpdates] = useState(false);
  const top = useRef(null);

  const load = useCallback(() => {
    api("/api/admin/learning")
      .then((d) => setState({ loading: false, data: d, error: "" }))
      .catch((e) => setState((s) => ({ loading: false, data: s.data, error: e.message })));
  }, []);
  // read now, then again whenever something changes (the live channel) and every two minutes as a safety net
  useEffect(() => {
    load();
    return everyVisible(load, 120000, { catchUp: true, topics: ["learning"] });
  }, [load]);

  const d = state.data;
  const notes = useMemo(() => (d ? [...d.notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt))) : []), [d]);
  const intraday = useMemo(() => (d ? d.updates.filter((u) => u.intraday) : []), [d]);
  const inArea = (x) => area === ALL || x === area;
  const show = (k) => filter === "all" || filter === k;

  const pages = d ? d.library.filter((t) => inArea(t.area) && matches(q, t.title, t.keys, t.rules)) : [];
  const myNotes = notes.filter((n) => inArea(n.area) && matches(q, n.title, n.body, n.tags || [], n.area));
  const updates = (area === ALL && !q ? intraday : (d ? d.updates : []).filter((u) => (area === ALL || (u.areas || []).includes(area)) && matches(q, u.title, u.text)));
  const lessons = d ? Object.values(d.lessons || {}).filter((l) => inArea(l.area) && matches(q, l.area, l.summary, l.points || [], l.rules || [])) : [];
  const areaInfo = d && area ? d.areas.find((a) => a.name === area) : null;
  const reading = d ? d.reading : [];
  const lessonHere = d && area ? (d.lessons || {})[area] : null;
  const searching = q.trim().length > 0;

  const pickArea = (a) => {
    setArea(a);
    setOpen(new Set());
    if (top.current && top.current.scrollIntoView) top.current.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const toggle = (id) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const run = async (key, fn, ok) => {
    setBusy(key);
    try {
      await fn();
      if (ok) snack(ok, { tone: "ok" });
      load();
    } catch (e) {
      snack(e.message, { tone: "error" });
    }
    setBusy("");
  };
  const writeLesson = (a) => run(`lesson:${a}`, () => api("/api/admin/learning/lessons", { method: "POST", body: { area: a } }), `The AI wrote the lesson on ${a}.`);
  const writeDigest = () => run("digest", () => api("/api/admin/learning/digest", { method: "POST" }), "The AI read the newest official updates.");
  const check = () => run("refresh", () => api("/api/admin/learning/refresh", { method: "POST" }), "Sources checked.");
  const remove = (n) => run(`del:${n.id}`, () => api(`/api/admin/learning/notes/${n.id}`, { method: "DELETE" }), "Learning removed.");

  if (state.loading && !d) return <Skeleton label="Opening Vinaypedia…" lines={6} tiles={4} />;
  if (!d) return <p className="adm-alert adm-alert--error">{state.error || "Vinaypedia could not be read."}</p>;

  const okSources = d.sources.filter((s) => s.lastSuccessAt);
  const lastRead = okSources.map((s) => s.lastSuccessAt).sort().pop();
  const lessonCount = Object.keys(d.lessons || {}).length;
  const aiNote = d.ai && d.ai.configured ? "Uses AI credit, only when you press it." : "Add an AI model on the AI page to use this.";

  return (
    <div className="vp" ref={top}>
      <section className="an-card vp-head">
        <div className="vp-head__txt">
          <h2>
            Vinaypedia <small>Vinay’s own learning</small>
          </h2>
          <p>Every intraday topic in one place: the desk’s library, fresh rules from NSE, SEBI and Zerodha read by the desk itself, lessons the AI writes when you ask, and what you learnt yourself.</p>
          <ul className="vp-stats" aria-label="What is here">
            <li>
              <b>{d.library.length}</b> library pages in {d.areas.length - 1} areas
            </li>
            <li>
              <b>{intraday.length}</b> official updates
            </li>
            <li>
              <b>{lessonCount}</b> AI lesson{lessonCount === 1 ? "" : "s"}
            </li>
            <li>
              <b>{notes.length}</b> learning{notes.length === 1 ? "" : "s"} of yours
            </li>
            <li className="vp-stats__src">{lastRead ? `Sources read ${day(lastRead)}, ${clock(lastRead)}` : "Sources not read yet"}</li>
          </ul>
        </div>
        <div className="vp-head__act">
          <button type="button" className="adm-btn" onClick={() => setForm({ area: area || "My own" })}>
            + Add my learning
          </button>
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={check} disabled={Boolean(busy)} data-tip="Read NSE, SEBI, Zerodha and RBI's feeds now (they are read by themselves every six hours). No AI.">
            {busy === "refresh" ? "Checking…" : "Check sources"}
          </button>
        </div>
      </section>

      <div className="vp-bar">
        <label className="vp-search">
          <span className="adm-sr">Search Vinaypedia</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search everything: VWAP, margin, expiry, revenge trading…" />
        </label>
        <div className="sv__ranges vp-filter" role="group" aria-label="Show">
          {FILTERS.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="vp-body">
        <nav className="vp-rail" aria-label="Areas">
          <label className="vp-rail__pick">
            <span className="adm-sr">Area</span>
            <select value={area} onChange={(e) => pickArea(e.target.value)}>
              <option value={ALL}>All areas</option>
              {d.areas.map((a) => (
                <option key={a.name} value={a.name}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <ul className="vp-rail__list">
            <li>
              <button type="button" aria-current={area === ALL ? "true" : undefined} onClick={() => pickArea(ALL)}>
                <span>All areas</span>
                <em>{d.library.length + notes.length}</em>
              </button>
            </li>
            {d.areas.map((a) => (
              <li key={a.name}>
                <button type="button" aria-current={area === a.name ? "true" : undefined} onClick={() => pickArea(a.name)}>
                  <span>{a.name}</span>
                  <em>
                    {a.pages + a.notes}
                    {a.lesson ? <i className="vp-dot" title="Has an AI lesson" aria-label="has an AI lesson" /> : null}
                  </em>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="vp-main">
          {areaInfo && (
            <section className="an-card vp-area">
              <h3>{areaInfo.name}</h3>
              <p className="vp-meta">
                {areaInfo.pages} library page{areaInfo.pages === 1 ? "" : "s"} · {areaInfo.updates} official update{areaInfo.updates === 1 ? "" : "s"} · {areaInfo.notes} learning{areaInfo.notes === 1 ? "" : "s"} of yours
              </p>
              {areaInfo.reading.length > 0 && (
                <p className="vp-area__read">
                  Official reading:{" "}
                  {areaInfo.reading
                    .map((id) => reading.find((r) => r.id === id))
                    .filter(Boolean)
                    .map((r, i) => (
                      <React.Fragment key={r.id}>
                        {i > 0 ? " · " : ""}
                        <a href={r.url} target="_blank" rel="noopener noreferrer">
                          {r.name}
                          <span className="adm-sr"> (opens in a new tab)</span>
                        </a>
                      </React.Fragment>
                    ))}
                </p>
              )}
            </section>
          )}

          {show("mine") && (myNotes.length > 0 || filter === "mine" || area) && (
            <section className="an-card vp-sec">
              <header className="vp-sec__head">
                <h3>My learnings{area ? ` · ${area}` : ""}</h3>
                <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setForm({ area: area || "My own" })}>
                  + Add{area ? " here" : ""}
                </button>
              </header>
              {myNotes.length ? (
                <div className="vp-notes">
                  {myNotes.map((n) => (
                    <NoteCard key={n.id} n={n} onEdit={(x) => setForm(x)} onRemove={remove} onArea={area ? null : pickArea} />
                  ))}
                </div>
              ) : (
                <p className="vp-empty">{searching ? "None of your learnings match the search." : "Nothing written here yet. What did the market teach you?"}</p>
              )}
            </section>
          )}

          {show("ai") && area && area !== "My own" && !searching && (
            <section className="an-card vp-sec">
              <header className="vp-sec__head">
                <h3>AI lesson</h3>
                <span className="vp-sec__tools">
                  <small className="vp-meta">{aiNote}</small>
                  <button type="button" className="adm-btn adm-btn--sm" onClick={() => writeLesson(area)} disabled={Boolean(busy) || !(d.ai && d.ai.configured)}>
                    {busy === `lesson:${area}` ? "The AI is writing…" : lessonHere ? "Rewrite with AI" : "Write with AI"}
                  </button>
                </span>
              </header>
              {lessonHere ? <Lesson l={lessonHere} reading={reading} /> : <p className="vp-empty">No lesson yet. The AI writes one from this area’s library pages, its newest official updates and your own notes, citing only official reading.</p>}
            </section>
          )}

          {show("ai") && (area === ALL || searching) && lessons.length > 0 && (
            <section className="an-card vp-sec">
              <header className="vp-sec__head">
                <h3>AI lessons</h3>
              </header>
              {lessons.map((l) => (
                <details key={l.area} className="vp-lesson-item">
                  <summary>
                    <b>{l.area}</b> <span className="vp-meta">· {day(l.at)}</span>
                  </summary>
                  <Lesson l={l} reading={reading} />
                </details>
              ))}
            </section>
          )}

          {show("updates") && (
            <section className="an-card vp-sec">
              <header className="vp-sec__head">
                <h3>{area ? "Official updates here" : "What’s new from NSE, SEBI, Zerodha and RBI"}</h3>
                {area === ALL && (
                  <span className="vp-sec__tools">
                    <small className="vp-meta">{aiNote}</small>
                    <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={writeDigest} disabled={Boolean(busy) || !intraday.length || !(d.ai && d.ai.configured)}>
                      {busy === "digest" ? "The AI is reading…" : "What do they mean? (AI)"}
                    </button>
                  </span>
                )}
              </header>
              {area === ALL && d.digest && !searching && (
                <div className="vp-digest">
                  <p className="vp-digest__head">
                    <b>{d.digest.headline}</b> <span className="vp-meta">· the AI, {day(d.digest.at)}</span>
                  </p>
                  <ul>
                    {d.digest.items.map((x) => (
                      <li key={x.key}>
                        <b>{x.by}:</b> {x.what} <em>{x.means}</em>
                      </li>
                    ))}
                  </ul>
                  {d.digest.leftOut > 0 && <p className="vp-meta">{d.digest.leftOut} updates left out as not about intraday trading. {d.digest.caveat}</p>}
                </div>
              )}
              {updates.length ? (
                <>
                  <ul className="vp-updates">
                    {(showAllUpdates ? updates : updates.slice(0, 8)).map((u) => (
                      <UpdateRow key={u.key} u={u} onArea={area ? null : pickArea} />
                    ))}
                  </ul>
                  {updates.length > 8 && (
                    <button type="button" className="vp-link vp-more" onClick={() => setShowAllUpdates((x) => !x)}>
                      {showAllUpdates ? "Show fewer" : `Show all ${updates.length}`}
                    </button>
                  )}
                </>
              ) : (
                <p className="vp-empty">{searching ? "No official update matches the search." : okSources.length ? "No official update filed here yet." : "The sources have not been read yet — they are read by themselves every six hours, or press Check sources."}</p>
              )}
            </section>
          )}

          {show("library") && (
            <section className="an-card vp-sec">
              <header className="vp-sec__head">
                <h3>{area ? "Library" : searching ? "Library pages that match" : "The library, by area"}</h3>
                <small className="vp-meta">The desk’s knowledge base — the pages every AI feature reads.</small>
              </header>
              {area === ALL && !searching ? (
                <ul className="vp-areas">
                  {d.areas
                    .filter((a) => a.pages > 0)
                    .map((a) => (
                      <li key={a.name}>
                        <button type="button" className="vp-areacard" onClick={() => pickArea(a.name)}>
                          <b>{a.name}</b>
                          <span className="vp-meta">
                            {a.pages} page{a.pages === 1 ? "" : "s"}
                            {a.updates ? ` · ${a.updates} update${a.updates === 1 ? "" : "s"}` : ""}
                            {a.notes ? ` · ${a.notes} yours` : ""}
                            {a.lesson ? " · AI lesson" : ""}
                          </span>
                        </button>
                      </li>
                    ))}
                </ul>
              ) : pages.length ? (
                <div className="vp-pages">
                  {pages.map((t) => (
                    <PageCard key={t.id} t={t} open={open.has(t.id)} onToggle={() => toggle(t.id)} />
                  ))}
                </div>
              ) : (
                <p className="vp-empty">{searching ? "No library page matches the search." : "This area has no library pages — it is yours to fill."}</p>
              )}
            </section>
          )}

          {area === ALL && !searching && filter === "all" && (
            <section className="an-card vp-sec vp-sources">
              <header className="vp-sec__head">
                <h3>Where the knowledge comes from</h3>
              </header>
              <ul className="vp-srclist">
                {d.sources.map((s) => (
                  <li key={s.id}>
                    <span className={`vp-src vp-src--${s.id}`}>{s.by}</span>
                    <a href={s.home} target="_blank" rel="noopener noreferrer">
                      {s.name}
                      <span className="adm-sr"> (opens in a new tab)</span>
                    </a>
                    <span className="vp-meta">{s.lastError ? s.lastError : s.lastSuccessAt ? `read ${day(s.lastSuccessAt)}, ${clock(s.lastSuccessAt)}` : "not read yet"}</span>
                  </li>
                ))}
              </ul>
              <p className="vp-meta">Read by the server from each publisher’s own feed every six hours; only the headline, a short excerpt, the date and the link are kept. The library is written from exchange rules and widely published practice.</p>
            </section>
          )}
        </div>
      </div>

      {form && (
        <NoteForm
          areas={d.areas}
          kinds={d.kinds}
          start={form}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            load();
          }}
        />
      )}
    </div>
  );
}
