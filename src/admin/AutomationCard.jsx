// Automation — the card behind the tile on /me: every system that runs by itself (its schedule in words and whether it is
// on), what the supervisor found behind and caught up, and the one thing that cannot be automatic (the Zerodha login).
// The server does the work (server/supervisor.js); this only shows it, live.

import React, { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { useAuth } from "./auth";
import { everyVisible } from "./visible";

const WORD = { on: "On", off: "Off", "needs-zerodha": "Waits for Zerodha", "needs-you": "Needs you", learning: "Learning", "standing-by": "Standing by", "click-only": "Click only", unknown: "Unknown" };
const TONE = { on: "ok", learning: "ok", "standing-by": "ok", "click-only": "ok", off: "off", "needs-zerodha": "warn", "needs-you": "warn", unknown: "warn" };
const DUTY = { ok: "Up to date", behind: "Behind", waiting: "Waits for the close", failed: "Last try failed", running: "Running now" };
const DTONE = { ok: "ok", behind: "warn", waiting: "warn", failed: "error", running: "ok" };
const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

export default function AutomationCard() {
  const { user } = useAuth() || {};
  const owner = Boolean(user && user.role === "superadmin");
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(
    () =>
      api("/api/admin/automation")
        .then((x) => {
          if (x && Array.isArray(x.duties)) {
            setD(x);
            setErr("");
          }
        })
        .catch((e) => setErr(e.message)),
    []
  );
  useEffect(() => {
    load();
    return everyVisible(load, 30000, { topics: ["automation", "market", "horizon", "open", "health"] });
  }, [load]);
  const look = async () => {
    setBusy(true);
    try {
      setD(await api("/api/admin/automation/run", { method: "POST" }));
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  };
  if (!d) return <section className="auto">{err ? <p className="adm-alert adm-alert--info">{err}</p> : <p className="auto__dim">Reading what runs by itself…</p>}</section>;
  const on = d.systems.filter((s) => TONE[s.state] === "ok").length;
  const behind = d.duties.filter((x) => x.state !== "ok");
  return (
    <section className="auto" aria-labelledby="auto-h">
      <header className="auto__head">
        <div>
          <h3 id="auto-h">Automation</h3>
          <p>
            {on} of {d.systems.length} systems running by themselves · {behind.length ? `${behind.length} catching up` : "nothing is behind"} · the supervisor looks every minute{d.running ? ` · running now: ${(d.duties.find((x) => x.id === d.running.id) || {}).name || d.running.id}` : ""}
          </p>
        </div>
        {owner && (
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={look} disabled={busy} data-tip="Ask the supervisor to look now instead of at the next minute. It runs the first duty that is behind.">
            {busy ? "Looking…" : "Look now"}
          </button>
        )}
      </header>
      {err && <p className="adm-alert adm-alert--info">{err}</p>}

      <h4>What runs by itself</h4>
      <ul className="auto__list">
        {d.systems.map((s) => (
          <li key={s.id} className={`auto__row is-${TONE[s.state] || "warn"}`}>
            <span className="auto__state">{WORD[s.state] || s.state}</span>
            <span className="auto__body">
              <b>{s.name}</b>
              <span>{s.schedule}.</span>
              {s.detail && <small>{s.detail}</small>}
            </span>
          </li>
        ))}
      </ul>

      <h4>Catch-up duties (last finished session: {d.lastSession})</h4>
      <ul className="auto__list">
        {d.duties.map((x) => (
          <li key={x.id} className={`auto__row is-${DTONE[x.state] || "warn"}`}>
            <span className="auto__state">{DUTY[x.state] || x.state}</span>
            <span className="auto__body">
              <b>{x.name}</b>
              <span>{x.what}</span>
              {(x.reason || x.lastOkAt || x.lastError) && (
                <small>
                  {x.reason ? `Behind: ${x.reason}. ` : ""}
                  {x.lastError ? `Last try failed: ${x.lastError}. ` : ""}
                  {x.nextAt ? `Next look ${when(x.nextAt)}. ` : ""}
                  {x.lastOkAt ? `Last caught up ${when(x.lastOkAt)}.` : ""}
                </small>
              )}
            </span>
          </li>
        ))}
      </ul>

      {d.events.length > 0 && (
        <>
          <h4>What the supervisor did</h4>
          <ul className="auto__events">
            {d.events.slice(0, 10).map((e, i) => (
              <li key={`${e.at}${e.id}${e.kind}${i}`}>
                <time>{when(e.at)}</time> <b>{e.name}</b> — {e.kind === "started" ? `started (${e.reason})` : e.kind === "done" ? "done" : e.kind === "partial" ? "ran; still behind, it will look again later" : `failed: ${e.error}`}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="auto__dim">Nothing here places an order, and nothing here spends AI credit: every forecast and every learning step above is arithmetic on market data.</p>
    </section>
  );
}
