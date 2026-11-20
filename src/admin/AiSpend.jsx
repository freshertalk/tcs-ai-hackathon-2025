// AI credit protection, on the AI page: the AI company is asked only when you press an AI button. This card says so, shows what tried to
// run on its own today and was held back, what the AI has used today, and — for the owner — the one switch that lifts the rule.
// One exception the owner asked for has its own block: the AI read of a stock that was just opened on the Desk, when its readings
// are undecided (server/evidence.js) — with its switch, its daily limit and its record.

import React, { useEffect, useState } from "react";
import { api } from "./api";
import { useAuth } from "./auth";
import { Alert } from "./ui";
import { everyVisible } from "./visible";

const when = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");

export default function AiSpend() {
  const { user } = useAuth();
  const owner = Boolean(user && user.role === "superadmin");
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const load = () =>
    api("/api/admin/ai/spend")
      .then(setD)
      .catch((e) => setErr(e.message));
  useEffect(() => {
    load();
    return everyVisible(load, 30000, { topics: ["ai"] });
  }, []);
  const set = async (auto) => {
    setBusy(true);
    setErr("");
    try {
      setD({ ...(d || {}), ...(await api("/api/admin/ai/spend", { method: "PUT", body: { auto } })) });
      load();
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  };
  const setOpen = async (patch) => {
    setBusy(true);
    setErr("");
    try {
      const open = await api("/api/admin/market/evidence/ai", { method: "PUT", body: patch });
      setD((cur) => ({ ...(cur || {}), open }));
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  };
  if (!d) return <section className="ais-card" aria-labelledby="ais-spend"><h2 id="ais-spend">AI credit protection</h2>{err ? <Alert>{err}</Alert> : <p className="ais-note">Loading…</p>}</section>;
  const used = ((d.today && d.today.features) || []).filter((f) => f.calls > 0);
  const tok = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n || 0));
  return (
    <section className="ais-card ais-spend" aria-labelledby="ais-spend">
      <h2 id="ais-spend">AI credit protection</h2>
      {d.enforced && !d.auto ? (
        <p className="ais-note">
          <b>On.</b> The AI company is asked <b>only when you press an AI button</b> — AI Live, AI Research, Ask now, a TradeAI question, Write the debrief and the like. Nothing runs on a timer, on a page being opened, or by itself: the morning research writes its notes without the AI, the news digest uses the free rules, the after-close reviews wait for a button, and Go live asks nothing until you press Ask now.
          {d.open && d.open.mode && d.open.mode !== "off" ? " The one exception you asked for is described below: a stock you open on the Desk." : ""}
        </p>
      ) : d.enforced ? (
        <p className="ais-note">
          <b>Lifted by the owner</b>
          {d.by ? ` (${d.by}${d.at ? `, ${when(d.at)}` : ""})` : ""}. The AI may run on its own: each automatic feature still obeys its own switch and daily limit, and every call is paid for.
        </p>
      ) : (
        <p className="ais-note">Not enforced on this server.</p>
      )}
      <p className="ais-note">
        {d.blockedToday > 0 ? (
          <>
            Held back today: <b>{d.blockedToday}</b> automatic attempt{d.blockedToday === 1 ? "" : "s"} that would have used credit.
          </>
        ) : (
          "Held back today: nothing has tried to run on its own."
        )}
      </p>
      {d.blocked && d.blocked.length > 0 && (
        <ul className="ais-list">
          {d.blocked.map((b) => (
            <li key={b.what}>
              {b.what} — {b.n}× (last {when(b.last)})
            </li>
          ))}
        </ul>
      )}
      <p className="ais-note">
        Used today:{" "}
        {used.length ? used.map((f) => `${f.name} ${f.calls}× (${tok(f.input)} in, ${tok(f.output)} out)`).join(" · ") : "nothing — no AI call has been made."}
        {d.saved && d.saved.calls ? ` · ${d.saved.calls} repeat question${d.saved.calls === 1 ? "" : "s"} answered from memory, free.` : ""}
      </p>
      {owner && d.enforced && (
        <label className="ais-check" data-tip="Off is the default. Turn it on only if you want the automatic AI features (the morning AI notes, the news digest, the after-close reviews, WhatsApp advice, Go live…) to spend credit by themselves.">
          <input type="checkbox" checked={Boolean(d.auto)} disabled={busy} onChange={(e) => set(e.target.checked)} /> Let the AI run on its own (spends credit without a click)
        </label>
      )}
      {d.open && d.open.mode && (
        <div className="ais-open">
          <h3>AI read when you open a stock</h3>
          {d.open.mode === "off" ? (
            <p className="ais-note">
              <b>Off.</b> Opening a stock asks the AI nothing. The evidence board still shows its own call and every reading; “Ask the AI” on the board stays a button.
            </p>
          ) : (
            <p className="ais-note">
              <b>On — the one exception, at your instruction.</b> When {d.open.everyone ? "anyone signed in opens" : "you open"} a stock on the Desk during market hours{" "}
              {d.open.mode === "always" ? "the AI reads that stock's whole evidence board once" : "and its readings are undecided or in conflict (no clear lean, an unproven lean, a warned reversal, unusual volume, or a position of yours in it), the AI reads that stock's whole evidence board once"}. Never on a timer and never for a stock nobody opened. At most <b>{d.open.perDay}</b> a day, and one read per stock every <b>{d.open.gapMin}</b> minutes.
            </p>
          )}
          <p className="ais-note">
            Used today: <b>{d.open.usedToday}</b> of {d.open.perDay}. {d.open.record && d.open.record.n ? `Checked 15 minutes later, its reads were right ${Math.round(d.open.record.right * 100)}% of ${d.open.record.n} times.` : "No read has been checked yet."}
            {!d.open.ready ? " No AI model is set up, so nothing is asked." : ""}
          </p>
          {owner && (
            <div className="ais-open__set">
              <label>
                When a stock is opened
                <select value={d.open.mode} disabled={busy} onChange={(e) => setOpen({ mode: e.target.value })}>
                  <option value="need">Ask the AI only when needed</option>
                  <option value="always">Ask the AI every time</option>
                  <option value="off">Never ask (off)</option>
                </select>
              </label>
              <label>
                Most reads a day
                <input type="number" min="0" max="300" defaultValue={d.open.perDay} disabled={busy} onBlur={(e) => Number(e.target.value) !== d.open.perDay && setOpen({ perDay: Number(e.target.value) })} />
              </label>
              <label>
                Minutes between reads of one stock
                <input type="number" min="5" max="120" defaultValue={d.open.gapMin} disabled={busy} onBlur={(e) => Number(e.target.value) !== d.open.gapMin && setOpen({ gapMin: Number(e.target.value) })} />
              </label>
              <label className="ais-check" data-tip="Off: only your own opens can spend credit. On: a stock opened by any signed-in person may be read, within the same daily limit.">
                <input type="checkbox" checked={Boolean(d.open.everyone)} disabled={busy} onChange={(e) => setOpen({ everyone: e.target.checked })} /> Also for stocks other people open
              </label>
            </div>
          )}
        </div>
      )}
      {err && <Alert>{err}</Alert>}
    </section>
  );
}
