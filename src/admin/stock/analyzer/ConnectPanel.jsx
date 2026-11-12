import React, { useState } from "react";
import { api } from "../../api";
import { Alert, CopyBox, Field } from "../../ui";
import { when } from "./format";

/**
 * Where the prices come from. Three states:
 *   connected      live Zerodha data until 6 AM tomorrow
 *   configured     key + secret saved; needs today's Kite login
 *   not set up     instructions + the form
 * Demo data can be switched on at any time before Zerodha is connected.
 */
export default function ConnectPanel({ status, flash, onStatus, startOpen }) {
  const k = status.kite;
  const [open, setOpen] = useState(Boolean(startOpen));
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [msg, setMsg] = useState({ kind: "", text: "" });
  const [busy, setBusy] = useState(false);

  const call = async (fn, okText) => {
    setBusy(true);
    setMsg({ kind: "", text: "" });
    try {
      onStatus(await fn());
      if (okText) setMsg({ kind: "ok", text: okText });
    } catch (err) {
      setMsg({ kind: "error", text: err.message });
    }
    setBusy(false);
  };

  const save = (e) => {
    e.preventDefault();
    call(() => api("/api/admin/market/kite", { method: "PUT", body: { apiKey: apiKey.trim(), apiSecret: apiSecret.trim() } }), "Saved. Now log in to Kite to start today’s session.").then(() => setApiSecret(""));
  };

  const dot = status.mode === "kite" ? "is-on" : status.mode === "demo" ? "is-demo" : "";

  return (
    <section className={`conn ${dot}`} aria-label="Market data connection">
      <div className="conn__row">
        <i className="conn__dot" aria-hidden="true" />
        <p className="conn__text">
          {status.mode === "kite" && (
            <>
              <b>Live data from Zerodha</b>
              {k.user ? ` · ${k.user}` : ""}. Read-only — this tool cannot place orders. The session ends by itself at {when(k.expiresAt)}; log in again
              after that.
            </>
          )}
          {status.mode === "demo" && (
            <>
              <b>DEMO DATA — these are not real prices.</b> Made-up “DEMO-…” series for exploring the tool. Connect Zerodha for real NSE data.
            </>
          )}
          {status.mode === "none" && k.configured && (
            <>
              <b>Zerodha is set up but not logged in today.</b> Kite sessions end every morning at 6 AM (an exchange rule), so one login a day is needed.
            </>
          )}
          {status.mode === "none" && !k.configured && (
            <>
              <b>No market data connected yet.</b> Connect your Zerodha Kite Connect key for live NSE data, or look around with demo data first.
            </>
          )}
        </p>
        <div className="conn__actions">
          {status.mode !== "kite" && k.configured && (
            <a className="adm-btn adm-btn--solid adm-btn--sm" href="/api/admin/market/kite/login">
              Log in to Kite
            </a>
          )}
          {status.mode !== "kite" && (
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={busy} onClick={() => call(() => api("/api/admin/market/demo", { method: "PUT", body: { on: !status.demo } }))}>
              {status.demo ? "Leave demo" : "Explore with demo data"}
            </button>
          )}
          {status.mode === "kite" && (
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={busy} onClick={() => call(() => api("/api/admin/market/kite/disconnect", { method: "POST" }), "Disconnected.")}>
              Disconnect
            </button>
          )}
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? "Hide setup" : "Zerodha setup"}
          </button>
        </div>
      </div>

      {flash && <Alert kind={flash.kind}>{flash.text}</Alert>}
      {k.lastError && status.mode !== "kite" && <Alert kind="info">{k.lastError}</Alert>}
      <Alert kind={msg.kind === "ok" ? "ok" : "error"}>{msg.text}</Alert>

      {open && (
        <div className="conn__setup">
          <div>
            <h3>Get a Kite Connect API key</h3>
            <ol className="adm-steps">
              <li>
                You need a Zerodha trading account with two-factor login (TOTP) switched on.
              </li>
              <li>
                Go to{" "}
                <a href="https://developers.kite.trade" target="_blank" rel="noopener noreferrer">
                  developers.kite.trade
                </a>
                , sign up, and choose <b>Create new app</b>.
              </li>
              <li>
                Pick the <b>Connect</b> app type — the paid plan (₹500 a month at the time of writing) that includes live quotes and historical
                candles. The free <b>Personal</b> type has <b>no market data</b>, so it cannot feed this page.
              </li>
              <li>
                Enter your Zerodha client ID, any app name, and this exact <b>Redirect URL</b>:
                <CopyBox value={status.redirectUrl} />
              </li>
              <li>
                Create the app, then copy its <b>API key</b> and <b>API secret</b> into the form here and save.
              </li>
              <li>
                Press <b>Log in to Kite</b>. You sign in on Zerodha’s own page (your password and TOTP never touch this site) and are sent back here.
                Repeat that one click each trading morning.
              </li>
            </ol>
            <p className="adm-small">
              The secret and the daily token are stored encrypted on your server and are never sent to the browser. Only market-data calls are made —
              there is no order code in this tool.
            </p>
          </div>

          <form className="adm-form" onSubmit={save} autoComplete="off">
            <h3>{k.configured ? "Replace the saved key" : "Enter the key"}</h3>
            {k.configured && <p className="adm-small">A key is saved ({k.apiKeyHint}). Fill this in only to change it.</p>}
            <Field id="kite-key" label="API key">
              <input id="kite-key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} required spellCheck="false" autoComplete="off" />
            </Field>
            <Field id="kite-secret" label="API secret" hint={k.configured ? "Leave blank to keep the saved secret (only if the key is unchanged)." : ""}>
              <input id="kite-secret" type="password" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} required={!k.configured} spellCheck="false" autoComplete="new-password" />
            </Field>
            <div>
              <button className="adm-btn adm-btn--solid" disabled={busy}>
                {busy ? "Saving…" : "Save key"}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
