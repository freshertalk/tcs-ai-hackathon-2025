// "Alerts on your phone" — the Telegram card under Settings (superadmin). Price alerts the server
// sees with no page open, the risk guard locking the day, and the 3:45 PM day report arrive as
// Telegram messages. The bot token is typed here by the owner, kept encrypted on the server, and
// never shown again.

import React, { useEffect, useState } from "react";
import { api } from "./api";
import { Alert } from "./ui";

const KIND_TEXT = [
  ["alerts", "Price alerts"],
  ["risk", "Risk guard locks the day"],
  ["dayReport", "The 3:45 PM day report"],
];

export default function NotifyCard() {
  const [st, setSt] = useState(null);
  const [token, setToken] = useState("");
  const [chat, setChat] = useState("");
  const [kinds, setKinds] = useState({ alerts: true, risk: true, dayReport: true });
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState({ kind: "", text: "" });
  const [watch, setWatch] = useState(null);

  useEffect(() => {
    api("/api/admin/notify")
      .then((d) => {
        if (!d || typeof d.configured !== "boolean") return; // not this server's answer: show nothing
        setSt(d);
        setChat(d.chatId || "");
        if (d.kinds) setKinds(d.kinds);
      })
      .catch(() => setSt(null));
    api("/api/admin/market/alerts/watch").then(setWatch).catch(() => {});
  }, []);

  const run = async (what, fn, ok) => {
    setBusy(what);
    setMsg({ kind: "", text: "" });
    try {
      const d = await fn();
      if (d && typeof d.configured === "boolean") setSt(d);
      setToken("");
      if (ok) setMsg({ kind: "ok", text: ok });
    } catch (e) {
      setMsg({ kind: "error", text: e.message });
    }
    setBusy("");
  };

  if (!st) return null;
  return (
    <section className="ntf" aria-labelledby="ntf-h">
      <header className="ntf__head">
        <div>
          <h3 id="ntf-h">Alerts on your phone (Telegram)</h3>
          <p>
            Price alerts are now checked by the server every 15 seconds in market hours — even with no page open{watch ? (watch.running ? "" : " (the watcher is stopped on this server)") : ""}. With a Telegram bot set up, each one, the risk guard locking the day and the 3:45 PM report reach your phone.
          </p>
        </div>
        <span className={`ntf__chip ${st.configured ? "is-on" : ""}`}>{st.configured ? "On" : "Not set up"}</span>
      </header>
      <details className="ntf__how">
        <summary>How to set it up (two minutes)</summary>
        <ol>
          <li>In Telegram, open <b>@BotFather</b>, send <code>/newbot</code>, and follow the steps. It gives you a <b>bot token</b> (digits, a colon, then a long code).</li>
          <li>Open your new bot and press <b>Start</b> (send it any message), so it is allowed to write to you.</li>
          <li>Find your <b>chat id</b>: for example open <b>@userinfobot</b> in Telegram and it replies with your id (a number).</li>
          <li>Enter both below, Save, and press <b>Send a test</b>.</li>
        </ol>
      </details>
      <div className="ntf__grid">
        <label className="mdr-field">
          <span>Bot token {st.tokenHint && <small>(saved: {st.tokenHint} — leave blank to keep it)</small>}</span>
          <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={st.tokenHint ? "•••••••• (saved)" : "123456789:AA…"} />
        </label>
        <label className="mdr-field">
          <span>Chat id</span>
          <input value={chat} onChange={(e) => setChat(e.target.value)} placeholder="e.g. 123456789" inputMode="numeric" />
        </label>
      </div>
      <div className="ntf__kinds" role="group" aria-label="Which messages">
        {KIND_TEXT.map(([k, label]) => (
          <label key={k} className="mdr-check">
            <input type="checkbox" checked={kinds[k] !== false} onChange={(e) => setKinds({ ...kinds, [k]: e.target.checked })} /> {label}
          </label>
        ))}
      </div>
      {st.lastError && <p className="mdr__err">Last attempt failed: {st.lastError}</p>}
      {st.lastSent && <p className="mdr-dim">Last message sent {new Date(st.lastSent).toLocaleString("en-IN")}.</p>}
      <Alert kind={msg.kind === "ok" ? "ok" : "error"}>{msg.text}</Alert>
      <span className="mdr-actions">
        <button type="button" className="adm-btn adm-btn--solid adm-btn--sm" disabled={Boolean(busy)} onClick={() => run("save", () => api("/api/admin/notify", { method: "PUT", body: { token, chatId: chat, kinds } }), "Saved.")}>
          {busy === "save" ? "Saving…" : "Save"}
        </button>
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={Boolean(busy) || !st.configured} onClick={() => run("test", () => api("/api/admin/notify/test", { method: "POST" }), "Sent — look in Telegram.")}>
          {busy === "test" ? "Sending…" : "Send a test"}
        </button>
        {st.configured && (
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={Boolean(busy)} onClick={() => run("rm", () => api("/api/admin/notify", { method: "PUT", body: { remove: true } }), "Telegram is switched off and the token is removed.")}>
            Remove
          </button>
        )}
      </span>
      <p className="mdr-dim">Telegram receives only the text of each message. Nothing here can trade.</p>
    </section>
  );
}
