// The AI asks (23 Nov 2026): when an automatic feature would like the AI (the exit coach's read, the Top 10's review, the index
// projection, the after-close write-up, the scanner's review…), the server does not spend credit on its own — it keeps an ASK.
// This popup shows each one on every private page for the superadmin: what wants the AI and why, with "Allow once" (it runs now,
// as your press — credit is used only then) or "Not now" (that ask is quiet for two hours). It appears the moment an ask arrives
// (the live channel's "ai-ask" topic) and re-checks every minute as a safety net.

import React, { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { everyVisible } from "./visible";
import "./ai-asks.css";

const URL = "/api/admin/ai/asks";
const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "");

export default function AiAsks() {
  const [asks, setAsks] = useState([]);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [folded, setFolded] = useState(false);

  const read = useCallback(() => {
    api(URL)
      .then((d) => setAsks(Array.isArray(d.asks) ? d.asks : []))
      .catch(() => {});
  }, []);
  useEffect(() => {
    read();
    const stop = everyVisible(read, 60000, { topics: ["ai-ask", "ai"] });
    return () => stop && stop();
  }, [read]);
  useEffect(() => {
    if (asks.length) setFolded(false);
  }, [asks.length]);

  const act = async (key, what) => {
    setBusy(key);
    setNote("");
    try {
      const d = await api(`${URL}/${encodeURIComponent(key)}/${what}`, { method: "POST" });
      setAsks(Array.isArray(d.asks) ? d.asks : []);
      if (what === "allow") setNote("Started — the AI is working on it now; the result appears on its page.");
    } catch (e) {
      setNote(e.message || "That did not go through.");
      read();
    }
    setBusy("");
  };

  if (!asks.length && !note) return null;
  if (!asks.length)
    return (
      <div className="aiask aiask--note" role="status">
        <p>{note}</p>
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setNote("")}>
          Close
        </button>
      </div>
    );
  return (
    <section className={`aiask ${folded ? "is-folded" : ""}`} role="dialog" aria-modal="false" aria-labelledby="aiask-h" aria-live="polite">
      <header className="aiask__head">
        <span className="aiask__mark" aria-hidden="true">
          AI
        </span>
        <h2 id="aiask-h">
          DrishtiAI would like to use the AI{asks.length > 1 ? ` (${asks.length})` : ""}
        </h2>
        <button type="button" className="aiask__fold" onClick={() => setFolded(!folded)} aria-expanded={!folded} aria-label={folded ? "Show the requests" : "Fold the requests"}>
          {folded ? "▴" : "▾"}
        </button>
      </header>
      {!folded && (
        <>
          <p className="aiask__lead">AI credit is used only if you allow it. Everything else on the desk keeps working without it.</p>
          <ul className="aiask__list">
            {asks.map((a) => (
              <li key={a.key}>
                <b>{a.feature}</b>
                {a.why && <span>{a.why}</span>}
                <small>
                  asked {a.n > 1 ? `${a.n} times since ${clock(a.first)}` : `at ${clock(a.first)}`}
                </small>
                <div className="aiask__acts">
                  <button type="button" className="adm-btn adm-btn--solid adm-btn--sm" disabled={busy === a.key} onClick={() => act(a.key, "allow")}>
                    {busy === a.key ? "Starting…" : "Allow once"}
                  </button>
                  <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={busy === a.key} onClick={() => act(a.key, "dismiss")} data-tip="Not now: this request stays quiet for two hours.">
                    Not now
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {note && (
            <p className="aiask__note" role="status">
              {note}
            </p>
          )}
        </>
      )}
    </section>
  );
}
