// AI credit protection, on the AI page: the AI company is asked only when you press an AI button. This card says so, shows what tried to
// run on its own today and was held back, what the AI has used today, and — for the owner — the one switch that lifts the rule.

import React, { useEffect, useState } from "react";
import { api } from "./api";
import { useAuth } from "./auth";
import { Alert } from "./ui";

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
    const id = setInterval(() => document.visibilityState !== "hidden" && load(), 30000);
    return () => clearInterval(id);
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
  if (!d) return <section className="ais-card" aria-labelledby="ais-spend"><h2 id="ais-spend">AI credit protection</h2>{err ? <Alert>{err}</Alert> : <p className="ais-note">Loading…</p>}</section>;
  const used = ((d.today && d.today.features) || []).filter((f) => f.calls > 0);
  const tok = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n || 0));
  return (
    <section className="ais-card ais-spend" aria-labelledby="ais-spend">
      <h2 id="ais-spend">AI credit protection</h2>
      {d.enforced && !d.auto ? (
        <p className="ais-note">
          <b>On.</b> The AI company is asked <b>only when you press an AI button</b> — AI Live, AI Research, Ask now, a TradeAI question, Write the debrief and the like. Nothing runs on a timer, on a page being opened, or by itself: the morning research writes its notes without the AI, the news digest uses the free rules, the after-close reviews wait for a button, and Go live asks nothing until you press Ask now.
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
      {err && <Alert>{err}</Alert>}
    </section>
  );
}
