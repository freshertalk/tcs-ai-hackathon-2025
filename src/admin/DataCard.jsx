// Data & backups — the card behind the tile on /me.
//   · what the market recorder reads by itself every minute of the session, and how much is stored
//   · what the desk has learned from the recorded order book and open interest — with the measured gain, and whether the
//     live forecast uses it (only once it is proven)
//   · for the owner: a download link for every dataset in the database, and the backups (made by itself once a day,
//     kept on the server, downloadable; "Back up now"; how many to keep)
// The server does the work (server/recorder.js, server/vault.js); this only shows it, live.

import React, { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { useAuth } from "./auth";
import { everyVisible } from "./visible";
import { useDialog } from "./dialog/DialogProvider";

const when = (iso) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
const size = (kb) => (kb == null ? "" : kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(kb))} KB`);
const count = (n) => Number(n || 0).toLocaleString("en-IN");
const pct = (x) => (x == null ? "—" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}%`);
const ONE = {
  sessions: "session",
  bars: "bar",
  records: "record",
  entries: "entry",
};
const unit = (n, u) => (n === 1 ? ONE[u] || u : u);
const STATE = {
  recording: ["ok", "Recording now"],
  "needs-zerodha": ["warn", "Waiting for Zerodha"],
  closed: ["off", "Standing by"],
};

function Recorder({ rec }) {
  const [tone, word] = STATE[rec.state] || ["off", rec.state];
  const t = rec.today;
  return (
    <>
      <h4>Read by itself, every minute of the session</h4>
      <ul className="auto__list vault__one">
        <li className={`auto__row is-${tone}`}>
          <span className="auto__state">{word}</span>
          <span className="auto__body">
            <b>Market recorder</b>
            <span>{rec.what}</span>
            <small>
              {rec.detail}.
              {t
                ? ` Today: ${t.taken} of ${t.expected} minutes read for ${t.stocks} stocks and ${t.futures} futures${t.last ? `, the last at ${new Date(t.last).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}` : ""}.`
                : ""}{" "}
              Stored: {count(rec.stored.sessions)} session
              {rec.stored.sessions === 1 ? "" : "s"}
              {rec.stored.from ? ` (${rec.stored.from} to ${rec.stored.to}, ${count(rec.stored.minutes)} minutes, ${size(rec.stored.kb)})` : ""}. No page needs to be open, and no AI credit is used.
              {rec.error ? ` Last problem: ${rec.error}` : ""}
            </small>
          </span>
        </li>
      </ul>
    </>
  );
}

function Learner({ l, owner, onLearn, busy }) {
  const tone = l.on ? "ok" : l.days ? "warn" : "off";
  return (
    <>
      <h4>What it has learned from the order book and open interest</h4>
      <ul className="auto__list vault__one">
        <li className={`auto__row is-${tone}`}>
          <span className="auto__state">{l.on ? "In use" : l.days ? "Not proven yet" : "Waiting"}</span>
          <span className="auto__body">
            <b>
              {count(l.days)} recorded session{l.days === 1 ? "" : "s"} learned · {count(l.evidence)} of {count(l.needed)} forecasts scored on sessions it had not seen
            </b>
            {l.lessons.map((x) => (
              <span key={x}>{x}</span>
            ))}
            {l.days > 0 && <small>Change in the forecaster's squared miss with these readings added (a plus is an improvement): {l.gains.map((g) => `${g.minutes} min ${pct(g.gain)}`).join(" · ")}.</small>}
            {l.waiting > 0 && (
              <small>
                {l.waiting} recorded session{l.waiting === 1 ? "" : "s"} wait
                {l.waiting === 1 ? "s" : ""} to be learned: it happens by itself after the close.{" "}
                {owner && (
                  <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={onLearn} disabled={busy === "learn"}>
                    {busy === "learn" ? "Starting…" : "Learn now"}
                  </button>
                )}
              </small>
            )}
            {!l.available && <small>The 15-minute forecaster is not available, so nothing can be learned yet.</small>}
          </span>
        </li>
      </ul>
    </>
  );
}

function Downloads({ groups }) {
  const [stock, setStock] = useState("");
  // the recorded data and the learning brain are open; the long lists of records open on a press
  const [shut, setShut] = useState(() => ({
    "Forecasts and their scores": true,
    "Trading records": true,
    "Other records": true,
  }));
  return (
    <>
      <h4>Download from the database</h4>
      {groups.map((g) => (
        <div key={g.group} className="vault__group">
          <button type="button" className="vault__fold" aria-expanded={!shut[g.group]} onClick={() => setShut((s) => ({ ...s, [g.group]: !s[g.group] }))}>
            <span>{g.group}</span>
            <small>
              {g.items.length} dataset{g.items.length === 1 ? "" : "s"} · {shut[g.group] ? "show" : "hide"}
            </small>
          </button>
          {!shut[g.group] && (
            <ul className="vault__sets">
              {g.items.map((x) => (
                <li key={x.id}>
                  <span className="vault__name">
                    <b>{x.title}</b>
                    {x.what && <small>{x.what}</small>}
                  </span>
                  <span className="vault__n">
                    {count(x.rows)} {unit(x.rows, x.unit)}
                    {x.kb ? ` · ${size(x.kb)}` : ""}
                  </span>
                  <span className="vault__links">
                    {x.links.map((l) => (
                      <a key={l.href} className="adm-btn adm-btn--ghost adm-btn--sm" href={l.href} download>
                        {l.label}
                      </a>
                    ))}
                    {x.id === "robot_history" && x.stocks && x.stocks.length > 0 && (
                      <>
                        <select aria-label="One stock's history" value={stock} onChange={(e) => setStock(e.target.value)}>
                          <option value="">One stock…</option>
                          {x.stocks.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                        {stock && (
                          <a className="adm-btn adm-btn--ghost adm-btn--sm" href={`/api/admin/vault/history/${encodeURIComponent(stock)}`} download>
                            {stock} (CSV)
                          </a>
                        )}
                      </>
                    )}
                    {x.links.length === 0 && !(x.stocks && x.stocks.length) && <em>nothing stored yet</em>}
                  </span>
                  {x.id === "tape" && x.days && x.days.length > 0 && (
                    <span className="vault__days">
                      One session:{" "}
                      {x.days.slice(0, 12).map((d) => (
                        <a key={d.date} href={d.href} download data-tip={`${d.minutes} minutes read · ${size(d.kb)} stored`}>
                          {d.date}
                        </a>
                      ))}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </>
  );
}

function Backups({ v, busy, run }) {
  const ask = useDialog();
  const remove = async (b) => {
    const yes = await ask({ tone: "danger", title: "Delete this backup?", body: `The backup of ${when(b.at)} is deleted from the server. A copy you downloaded is not touched.`, confirmText: "Delete it", cancelText: "Keep it" });
    if (yes) run("del", () => api(`/api/admin/vault/backups/${b.file}`, { method: "DELETE" }));
  };
  return (
    <>
      <h4>Backups of everything</h4>
      <div className="vault__bk">
        <label className="vault__opt">
          <input
            type="checkbox"
            checked={v.settings.auto}
            disabled={Boolean(busy)}
            onChange={(e) =>
              run("set", () =>
                api("/api/admin/vault/settings", {
                  method: "PUT",
                  body: { auto: e.target.checked },
                }),
              )
            }
          />{" "}
          <b>Back up by itself once a day</b> (after the market closes)
        </label>
        <label className="vault__opt">
          Keep the newest{" "}
          <select
            aria-label="How many backups to keep"
            value={v.settings.keep}
            disabled={Boolean(busy)}
            onChange={(e) =>
              run("set", () =>
                api("/api/admin/vault/settings", {
                  method: "PUT",
                  body: { keep: Number(e.target.value) },
                }),
              )
            }
          >
            {[1, 2, 3, 5, 7, 10, 14, 30].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="adm-btn adm-btn--sm"
          onClick={() => run("backup", () => api("/api/admin/vault/backup", { method: "POST" }))}
          disabled={Boolean(busy)}
          data-tip="Writes every record, list, log and recorded session to one compressed file on the server now."
        >
          {busy === "backup" ? "Backing up…" : "Back up now"}
        </button>
      </div>
      {v.backups.length === 0 ? (
        <p className="auto__dim">No backup has been made yet. {v.settings.auto ? "The first is made by itself after the market closes." : "Press Back up now."}</p>
      ) : (
        <ul className="vault__files">
          {v.backups.map((b) => (
            <li key={b.file}>
              <span>
                <b>{when(b.at)}</b> · {size(b.bytes / 1024)}
              </span>
              <a className="adm-btn adm-btn--ghost adm-btn--sm" href={b.href} download>
                Download
              </a>
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={Boolean(busy)} onClick={() => remove(b)} aria-label={`Delete the backup of ${when(b.at)}`}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="auto__dim">
        {v.holds} Kept {v.where}
        {v.backups.length ? ` (${size(v.totalKb)} in all)` : ""}: download one now and then, because a copy on your own computer is the one that survives the server. {v.restore}
      </p>
      {v.error && <p className="adm-alert adm-alert--info">The last backup failed: {v.error}</p>}
    </>
  );
}

export default function DataCard() {
  const { user } = useAuth() || {};
  const owner = Boolean(user && user.role === "superadmin");
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const load = useCallback(
    () =>
      (owner ? api("/api/admin/vault") : api("/api/admin/recorder").then((recorder) => ({ recorder })))
        .then((x) => {
          if (x && x.recorder && x.recorder.learner) {
            setD(x);
            setErr("");
          }
        })
        .catch((e) => setErr(e.message)),
    [owner],
  );
  useEffect(() => {
    load();
    return everyVisible(load, 60000, { topics: ["data", "market"] });
  }, [load]);
  // an action answers with the vault's new state; the datasets and the recorder are read again behind it
  const run = async (key, fn) => {
    setBusy(key);
    try {
      const st = await fn();
      if (st && st.settings) setD((cur) => (cur ? { ...cur, ...st } : cur));
      setErr("");
      await load();
    } catch (e) {
      setErr(e.message);
    }
    setBusy("");
  };
  if (!d) return <section className="auto vault">{err ? <p className="adm-alert adm-alert--info">{err}</p> : <p className="auto__dim">Reading what is recorded and stored…</p>}</section>;
  const rec = d.recorder;
  const last = d.backups && d.backups[0];
  return (
    <section className="auto vault" aria-labelledby="vault-h">
      <header className="auto__head">
        <div>
          <h3 id="vault-h">Data &amp; backups</h3>
          <p>
            {(STATE[rec.state] || ["", rec.state])[1]} · {count(rec.stored.sessions)} session
            {rec.stored.sessions === 1 ? "" : "s"} recorded · order book and open interest {rec.learner.on ? "in use" : "not in use yet"}
            {owner ? ` · ${last ? `newest backup ${when(last.at)}` : "no backup yet"}` : ""}
          </p>
        </div>
      </header>
      {err && <p className="adm-alert adm-alert--info">{err}</p>}
      <Recorder rec={rec} />
      <Learner l={rec.learner} owner={owner} busy={busy} onLearn={() => run("learn", () => api("/api/admin/recorder/learn", { method: "POST" }))} />
      {owner && d.datasets && <Downloads groups={d.datasets} />}
      {owner && d.settings && <Backups v={d} busy={busy} run={run} />}
      {!owner && <p className="auto__dim">Downloads and backups are the owner's.</p>}
    </section>
  );
}
