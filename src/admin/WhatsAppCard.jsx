// "WhatsApp Trading" — the card under Settings (superadmin). Like WhatsApp banking for this desk:
// timed updates on your open positions (with the free AI models' voted advice), answers to fixed
// commands, and — only if you allow it — trading by WhatsApp, every money-moving step confirmed with
// a code and your PIN. It runs on the server: the laptop can be closed. Every secret is typed here
// by you, kept encrypted on the server, and never shown again.

import React, { useEffect, useState } from "react";
import { api } from "./api";
import { Alert } from "./ui";

const COMMANDS = [
  ["HELP", "the list of commands"],
  ["STATUS", "Zerodha, trading switch, risk guard, today's P&L, margin left"],
  ["POS", "every open position: price, P&L, volume, buyers vs sellers, RSI, VWAP, the desk's call"],
  ["PNL · PNL YESTERDAY · PNL WEEK · PNL MONTH", "profit and loss (past days from Trade Analysis)"],
  ["QUOTE SBIN", "price, day range, VWAP, volume, buyers/sellers, circuits, live call"],
  ["CALL SBIN", "the desk's live call and plan"],
  ["ASK <anything>", "TradeAI answers in plain English (the free AI models)"],
  ["ALERTS · ALERT SBIN 800 · ALERT SBIN BELOW 780", "price alerts the server watches"],
  ["UPDATES ON · UPDATES OFF · EVERY 15", "the timed updates"],
  ["TRADING OFF", "switch trading off at once"],
  ["TRADING ON", "needs YES <code> <PIN>"],
  ["BUY 10 SBIN · SELL 5 INFY @ 1500 · BUY 10 SBIN CNC", "an order — needs YES <code> <PIN>"],
  ["EXIT SBIN · EXIT ALL", "exits — need YES <code> <PIN>"],
  ["NO", "cancel what is waiting"],
];

export default function WhatsAppCard() {
  const [st, setSt] = useState(null);
  const [f, setF] = useState({ phoneNumberId: "", token: "", appSecret: "", verifyToken: "", owner: "", pin: "", template: "", lang: "en", every: 30 });
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState({ kind: "", text: "" });
  const [preview, setPreview] = useState("");
  const hook = typeof window !== "undefined" ? `${window.location.origin}/api/whatsapp/webhook` : "/api/whatsapp/webhook";

  useEffect(() => {
    api("/api/admin/whatsapp")
      .then((d) => {
        if (!d || typeof d.configured !== "boolean") return;
        setSt(d);
        setF((x) => ({ ...x, phoneNumberId: d.phoneNumberId || "", template: (d.template && d.template.name) || "", lang: (d.template && d.template.lang) || "en", every: d.every || 30 }));
      })
      .catch(() => setSt(null));
  }, []);

  const run = async (what, fn, ok) => {
    setBusy(what);
    setMsg({ kind: "", text: "" });
    try {
      const d = await fn();
      if (d && typeof d.configured === "boolean") setSt(d);
      setF((x) => ({ ...x, token: "", appSecret: "", verifyToken: "", pin: "" }));
      if (ok) setMsg({ kind: "ok", text: ok });
    } catch (e) {
      setMsg({ kind: "error", text: e.message });
    }
    setBusy("");
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  if (!st) return null;
  const save = (extra = {}) => run("save", () => api("/api/admin/whatsapp", { method: "PUT", body: { phoneNumberId: f.phoneNumberId, token: f.token, appSecret: f.appSecret, verifyToken: f.verifyToken, owner: f.owner || undefined, pin: f.pin, template: { name: f.template, lang: f.lang }, every: Number(f.every), ...extra } }), "Saved.");

  return (
    <section className="wa" aria-labelledby="wa-h">
      <header className="ntf__head">
        <div>
          <h3 id="wa-h">WhatsApp Trading</h3>
          <p>
            Updates on your open positions while you are away — price, P&amp;L, volume, buyers vs sellers, RSI, VWAP and the desk’s call, with the free AI models’ voted advice — answers to simple commands, and, only if you allow it, trading by WhatsApp with a code and your PIN for every order. It runs on the server, so your laptop can be closed.
          </p>
        </div>
        <span className={`ntf__chip ${st.enabled ? "is-on" : ""}`}>{!st.configured ? "Not set up" : st.enabled ? "On" : "Off"}</span>
      </header>

      <div className="wa__switches">
        <label className="mdr-check">
          <input type="checkbox" checked={st.enabled} disabled={Boolean(busy) || !st.configured} onChange={(e) => run("en", () => api("/api/admin/whatsapp", { method: "PUT", body: { enabled: e.target.checked } }), e.target.checked ? "WhatsApp Trading is on." : "WhatsApp Trading is off.")} /> <b>WhatsApp service on</b>
        </label>
        <label className="mdr-check">
          <input type="checkbox" checked={st.allowTrading} disabled={Boolean(busy) || !st.pinSet} onChange={(e) => run("tr", () => api("/api/admin/whatsapp", { method: "PUT", body: { allowTrading: e.target.checked } }), e.target.checked ? "Trading from WhatsApp is allowed (each order needs YES, the code and your PIN)." : "Trading from WhatsApp is not allowed.")} /> Allow trading from WhatsApp {st.pinSet ? "" : "(set a PIN first)"}
        </label>
      </div>
      <p className="mdr-dim">
        {st.configured ? `Owner ${st.owner} · ${st.windowOpen ? "chat window open (24 h)" : "chat window closed — send HI to the bot to open it for 24 hours"}${st.lastSent ? ` · last sent ${new Date(st.lastSent).toLocaleString("en-IN")}` : ""}${st.lastReceived ? ` · last command ${new Date(st.lastReceived).toLocaleString("en-IN")}` : ""}${st.lockedUntil ? " · trading locked after wrong PINs" : ""}` : "Fill in the fields below to set it up."}
      </p>
      {st.lastError && <p className="mdr__err">Last problem: {st.lastError}</p>}

      <details className="ntf__how">
        <summary>How to set it up (the official WhatsApp Cloud API, about 15 minutes)</summary>
        <ol>
          <li>At developers.facebook.com create an app of type <b>Business</b> and add the <b>WhatsApp</b> product. Use a phone number for the bot (a new number, or Meta’s test number while trying it).</li>
          <li>On <b>WhatsApp → API setup</b> copy the <b>Phone number ID</b>. Create a <b>permanent access token</b> (Business settings → System users → generate a token with whatsapp_business_messaging) and paste it below.</li>
          <li>On <b>App settings → Basic</b> copy the <b>App secret</b>. Choose any <b>verify token</b> (12+ letters/digits) and type it below.</li>
          <li>On <b>WhatsApp → Configuration → Webhook</b> enter the callback URL <code>{hook}</code> and the same verify token, then subscribe to <b>messages</b>.</li>
          <li>Enter <b>your own WhatsApp number</b> (with the country code) — only this number is ever answered — and a <b>trading PIN</b> (4–8 digits).</li>
          <li>WhatsApp lets a business message you freely only within 24 hours of your last message: send <b>HI</b> to the bot each morning. To receive updates outside that window, create an approved <b>utility template</b> with one body parameter and enter its name.</li>
          <li>Meta may charge per conversation under its own pricing; check your WhatsApp Business account.</li>
        </ol>
      </details>

      <div className="ntf__grid">
        <label className="mdr-field">
          <span>Phone number ID</span>
          <input value={f.phoneNumberId} onChange={set("phoneNumberId")} inputMode="numeric" placeholder="e.g. 123456789012345" />
        </label>
        <label className="mdr-field">
          <span>Access token {st.tokenHint && <small>(saved: {st.tokenHint})</small>}</span>
          <input type="password" autoComplete="off" value={f.token} onChange={set("token")} placeholder={st.tokenHint ? "•••• (saved — blank keeps it)" : "EAAG…"} />
        </label>
        <label className="mdr-field">
          <span>App secret {st.appSecretSet && <small>(saved)</small>}</span>
          <input type="password" autoComplete="off" value={f.appSecret} onChange={set("appSecret")} placeholder={st.appSecretSet ? "•••• (saved)" : "hex code"} />
        </label>
        <label className="mdr-field">
          <span>Verify token {st.verifyTokenSet && <small>(saved)</small>}</span>
          <input type="password" autoComplete="off" value={f.verifyToken} onChange={set("verifyToken")} placeholder={st.verifyTokenSet ? "•••• (saved)" : "any phrase you choose"} />
        </label>
        <label className="mdr-field">
          <span>Your WhatsApp number {st.owner && <small>(saved: {st.owner})</small>}</span>
          <input value={f.owner} onChange={set("owner")} inputMode="tel" placeholder="919876543210" />
        </label>
        <label className="mdr-field">
          <span>Trading PIN {st.pinSet && <small>(set — blank keeps it)</small>}</span>
          <input type="password" autoComplete="off" inputMode="numeric" value={f.pin} onChange={set("pin")} placeholder="4–8 digits" />
        </label>
        <label className="mdr-field">
          <span>Update every (minutes)</span>
          <input type="number" min="10" max="120" value={f.every} onChange={set("every")} />
        </label>
        <label className="mdr-field">
          <span>Template name (optional)</span>
          <input value={f.template} onChange={set("template")} placeholder="e.g. drishtiai_update" />
        </label>
      </div>
      <p className="mdr-dim">
        Webhook URL for Meta: <code>{hook}</code>
      </p>
      <Alert kind={msg.kind === "ok" ? "ok" : "error"}>{msg.text}</Alert>
      <span className="mdr-actions">
        <button type="button" className="adm-btn adm-btn--solid adm-btn--sm" disabled={Boolean(busy)} onClick={() => save()}>
          {busy === "save" ? "Saving…" : "Save"}
        </button>
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={Boolean(busy) || !st.configured || !st.enabled} onClick={() => run("test", () => api("/api/admin/whatsapp/test", { method: "POST" }), "Sent — look in WhatsApp.")}>
          {busy === "test" ? "Sending…" : "Send a test"}
        </button>
        <button
          type="button"
          className="adm-btn adm-btn--ghost adm-btn--sm"
          disabled={Boolean(busy)}
          onClick={async () => {
            setBusy("prev");
            try {
              setPreview((await api("/api/admin/whatsapp/preview", { method: "POST" })).text);
            } catch (e) {
              setMsg({ kind: "error", text: e.message });
            }
            setBusy("");
          }}
        >
          {busy === "prev" ? "Writing (the free AI models)…" : "Preview an update"}
        </button>
        {st.configured && (
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={Boolean(busy)} onClick={() => run("rm", () => api("/api/admin/whatsapp", { method: "PUT", body: { remove: true } }), "WhatsApp is removed: every secret is deleted.")}>
            Remove
          </button>
        )}
      </span>
      {preview && <pre className="wa__preview">{preview}</pre>}
      <details className="ntf__how">
        <summary>The commands you can send</summary>
        <dl className="wa__cmds">
          {COMMANDS.map(([c, d]) => (
            <div key={c}>
              <dt>
                <code>{c}</code>
              </dt>
              <dd>{d}</dd>
            </div>
          ))}
        </dl>
        <p className="mdr-dim">Anything that moves money is never done on the first message: the reply states it and asks for YES, a 6-digit code and your PIN within 2 minutes. Three wrong PINs lock WhatsApp trading for 30 minutes. Orders still pass the trading switch, your limits, the risk guard and the duplicate guard, and are audited as “whatsapp”.</p>
      </details>
    </section>
  );
}
