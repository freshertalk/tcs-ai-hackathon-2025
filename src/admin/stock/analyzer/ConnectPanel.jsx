import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./conn.css";
import { api } from "../../api";
import { Alert, CopyBox, Field } from "../../ui";
import { when } from "./format";
import { snack } from "../../ux/snack";

/**
 * Where the prices come from — kept out of the way: a very small status button at the left of the desk's top row, and
 * everything else (the words, the buttons, the setup steps) in a dialog it opens. Three states:
 *   connected      live Zerodha data until 6 AM tomorrow
 *   configured     key + secret saved; needs today's Kite login
 *   not set up     instructions + the form
 * Demo data can be switched on at any time before Zerodha is connected.
 */
/* The dialog is drawn at the private area's root (the .adm element), not inside the Desk: a page that is still easing in
   (or any card with a transform) would otherwise hold a "fixed" dialog inside itself — after a Kite login that left the
   whole Desk dimmed with the dialog thousands of pixels down, out of sight (28 Nov 2026). */
function lift(node, root) {
  return root ? createPortal(node, root) : node;
}

export default function ConnectPanel({ status, flash, onStatus, startOpen }) {
  const k = status.kite;
  // the dialog opens by itself only when there is something to act on: nothing set up yet, or the result of a Kite login
  // since 28 Nov 2026 a SUCCESSFUL login leaves the Desk clear: the good news is a short note at the bottom, not a dialog
  // over the page (the dialog still opens for a failed login, where the reason must be read, and on the button any time)
  const [dlg, setDlg] = useState(Boolean(startOpen) || Boolean(flash && flash.kind !== "ok"));
  useEffect(() => {
    if (flash && flash.kind === "ok") snack(flash.text, { tone: "ok", key: "kite-login", ms: 6000 });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [open, setOpen] = useState(Boolean(startOpen)); // the setup steps inside it
  const back = useRef(null);
  const [root, setRoot] = useState(null); // where the dialog is drawn: the .adm root, found once the button is on the page
  useEffect(() => {
    setRoot((back.current && back.current.closest(".adm")) || null);
  }, []);
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
  const label = status.mode === "kite" ? "Live" : status.mode === "demo" ? "Demo data" : k.configured ? "Log in" : "Connect";
  const words = status.mode === "kite" ? `Live data from Zerodha${k.user ? ` · ${k.user}` : ""}` : status.mode === "demo" ? "Demo data — not real prices" : k.configured ? "Zerodha is not logged in today" : "No market data connected";

  const close = () => {
    setDlg(false);
    if (back.current) back.current.focus();
  };
  // Escape closes; the page behind does not scroll while it is open; Tab stays inside
  const box = useRef(null);
  useEffect(() => {
    if (!dlg) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab" && box.current) {
        const f = [...box.current.querySelectorAll('a[href], button:not([disabled]), input, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null);
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const t = setTimeout(() => box.current && box.current.focus(), 30);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
      clearTimeout(t);
    };
  }, [dlg]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <button
        ref={back}
        type="button"
        className={`conn-btn ${dot} ${status.mode === "kite" ? "" : "conn-btn--text"}`}
        aria-haspopup="dialog"
        aria-expanded={dlg}
        aria-label={`Market data connection: ${words}. Open details.`}
        data-tip={`${words}. Press for the connection, its buttons and the Zerodha setup.`}
        onClick={() => setDlg(true)}
      >
        <i className="conn__dot" aria-hidden="true" />
        {status.mode !== "kite" && <span>{label}</span>}
      </button>

      {dlg &&
        lift(
        <div className="tr-modal conn-modal" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <section ref={box} tabIndex={-1} className={`tr-dialog conn-dlg ${dot ? `conn-dlg--${dot.slice(3)}` : ""}`} role="dialog" aria-modal="true" aria-labelledby="conn-dlg-h" aria-label="Market data connection">
            <header className="conn-dlg__head">
              <i className="conn__dot" aria-hidden="true" />
              <h3 id="conn-dlg-h">Market data connection</h3>
              <button type="button" className="conn-dlg__x" onClick={close} aria-label="Close">
                ×
              </button>
            </header>
            <p className="conn__text">
              {status.mode === "kite" && (
                <>
                  <b>Live data from Zerodha</b>
                  {k.user ? ` · ${k.user}` : ""}. Until {when(k.expiresAt)}; log in again after that. Orders are placed only from Positions, with the trading switch on.
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
              The secret and the daily token are stored encrypted on your server and are never sent to the browser. This market-data connection can only read
              prices; orders are sent by a separate part, only from Positions, with the trading switch on.
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
        </div>,
        root
      )}
    </>
  );
}
