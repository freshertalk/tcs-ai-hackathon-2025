// Zerodha accounts — on /me.
//
//   THE OWNER sees who may trade on their OWN Zerodha account from this site, and switches that on or off per person.
//             The owner sees that an account exists and is connected — never its key, its positions or its orders —
//             and cannot place an order on it. (The owner's own trading uses the site's connection, on the Desk.)
//   A PERSON  the owner has switched it on for connects their own Kite ID here: their Kite Connect app's key and
//             secret (Zerodha ties an app to one client ID, so each person needs their own), then the daily login on
//             Zerodha's own page. After that the terminal's Positions page, the order ticket and Buy / Sell are theirs:
//             their account, their trading switch (off until they turn it on), their limits, their audit trail.
// The server decides everything (server/accounts.js); this card only shows and asks.

import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "./api";
import { useAuth } from "./auth";
import { adminPath } from "./paths";
import { everyVisible } from "./visible";
import { useDialog } from "./dialog/DialogProvider";

const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const terminal = (view) => `${adminPath("/stock-report")}${view ? `?view=${view}` : ""}`;

function Copy({ text }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1800);
    } catch (_) {
      /* the address is on screen to copy by hand */
    }
  };
  return (
    <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={copy}>
      {done ? "Copied" : "Copy"}
    </button>
  );
}

/** The owner: one line per person who can sign in, with the switch. */
function People({ flash }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const ask = useDialog();
  const load = useCallback(
    () =>
      api("/api/admin/accounts")
        .then((x) => {
          setD(x);
          setErr("");
        })
        .catch((e) => setErr(e.message)),
    []
  );
  useEffect(() => {
    load();
    return everyVisible(load, 60000, { topics: ["accounts", "system"] });
  }, [load]);
  const set = async (email, allowed) => {
    if (allowed) {
      const yes = await ask({
        title: `Let ${email} trade on their own Zerodha account here?`,
        body: "They will be able to connect their OWN Kite ID (their own Kite Connect key) and place orders on it from this site, with their own trading switch and limits. They cannot see or touch your account, and you cannot see or trade theirs.",
        confirmText: "Switch it on",
        cancelText: "Not now",
      });
      if (!yes) return;
    }
    setBusy(email);
    try {
      setD(await api(`/api/admin/accounts/people/${encodeURIComponent(email)}`, { method: "PUT", body: { allowed } }));
      setErr("");
    } catch (e) {
      setErr(e.message);
    }
    setBusy("");
  };
  if (!d) return err ? <p className="adm-alert adm-alert--info">{err}</p> : <p className="za-dim">Reading the accounts…</p>;
  const by = new Map(d.people.map((p) => [p.email, p]));
  const rows = [...new Set([...d.admins, ...d.people.map((p) => p.email)])].sort();
  return (
    <>
      {flash}
      {err && <p className="adm-alert adm-alert--info">{err}</p>}
      {!rows.length ? (
        <p className="za-dim">
          Nobody else can sign in yet. Add a person under <a href={adminPath("/admins")}>Admin users</a>; then you can let them use their own Zerodha account here.
        </p>
      ) : (
        <ul className="za-list">
          {rows.map((email) => {
            const p = by.get(email) || { allowed: false };
            const state = !p.allowed ? "Off" : p.connected ? `Connected${p.kiteUser ? ` · ${p.kiteUser}` : ""}` : p.configured ? "Key saved · not logged in today" : "Waiting for their key";
            return (
              <li key={email} className={p.allowed ? (p.connected ? "is-ok" : "is-warn") : "is-off"}>
                <span className="za-who">
                  <b>{email}</b>
                  <small>
                    {state}
                    {p.allowed && p.tradingOn ? " · their trading switch is ON" : ""}
                    {p.allowed && p.connected && p.loginAt ? ` · since ${when(p.loginAt)}` : ""}
                  </small>
                </span>
                <label className="za-switch" data-tip={p.allowed ? "Switch this off: their day's Zerodha session here is thrown away and their trading switch goes off, at once." : "Let this person connect and trade on their own Zerodha account from this site."}>
                  <input type="checkbox" checked={Boolean(p.allowed)} disabled={busy === email} onChange={(e) => set(email, e.target.checked)} /> Own Zerodha account
                </label>
              </li>
            );
          })}
        </ul>
      )}
      <p className="za-dim">
        Each person uses <b>their own Kite Connect app</b> (Zerodha ties an app to one client ID) and sets its redirect URL to <code>{d.redirectUrl}</code> <Copy text={d.redirectUrl} />. You see that an account is connected, never what is in it; nobody can place an order on an account that is not theirs. Your own trading stays on the site&rsquo;s connection (the Desk).
      </p>
    </>
  );
}

/** A person: their own connection. */
function Mine({ flash }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [form, setForm] = useState({ apiKey: "", apiSecret: "" });
  const [busy, setBusy] = useState("");
  const [edit, setEdit] = useState(false);
  const ask = useDialog();
  const load = useCallback(
    () =>
      api("/api/admin/accounts/me")
        .then((x) => {
          setD(x);
          setErr("");
        })
        .catch((e) => setErr(e.message)),
    []
  );
  useEffect(() => {
    load();
    return everyVisible(load, 60000, { topics: ["accounts", "trading"] });
  }, [load]);
  const act = async (key, fn) => {
    setBusy(key);
    try {
      setD(await fn());
      setErr("");
      setEdit(false);
      setForm({ apiKey: "", apiSecret: "" });
    } catch (e) {
      setErr(e.message);
    }
    setBusy("");
  };
  const saveKeys = (e) => {
    e.preventDefault();
    act("save", () => api("/api/admin/accounts/me/kite", { method: "PUT", body: form }));
  };
  const removeKeys = async () => {
    const yes = await ask({ tone: "danger", title: "Remove your Zerodha key from this site?", body: "Your API key, secret and today's session are deleted here and your trading switch goes off. Nothing changes at Zerodha. You can add the key again later.", confirmText: "Remove it", cancelText: "Keep it" });
    if (yes) act("remove", () => api("/api/admin/accounts/me/kite", { method: "DELETE" }));
  };
  if (!d) return err ? <p className="adm-alert adm-alert--info">{err}</p> : <p className="za-dim">Reading your account…</p>;
  if (!d.allowed) {
    return (
      <>
        {flash}
        <p className="za-dim">Trading on your own Zerodha account is not switched on for you. The owner can switch it on from their dashboard; you will then connect your own Kite ID here.</p>
      </>
    );
  }
  const showForm = !d.configured || edit;
  return (
    <>
      {flash}
      {err && <p className="adm-alert adm-alert--info">{err}</p>}
      <ul className="za-list">
        <li className={d.connected ? "is-ok" : d.configured ? "is-warn" : "is-off"}>
          <span className="za-who">
            <b>{d.connected ? `Connected${d.user ? ` as ${d.user}` : ""}${d.userId ? ` (${d.userId})` : ""}` : d.configured ? "Not logged in today" : "No key yet"}</b>
            <small>
              {d.connected ? `Until ${when(d.expiresAt)}: Zerodha ends every session at 6 AM, so you log in once each trading day.` : d.configured ? `Key ${d.apiKeyHint} is saved. Log in to Kite to start today's session.` : "Add your Kite Connect key and secret below."}
              {d.lastError ? ` ${d.lastError}` : ""}
            </small>
          </span>
          <span className="za-acts">
            {d.configured && !d.connected && (
              <a className="adm-btn adm-btn--solid adm-btn--sm" href="/api/admin/accounts/kite/login" data-tip="Opens Zerodha's own login page. Your password and 2FA are typed there, never on this site.">
                Log in to Kite
              </a>
            )}
            {d.connected && (
              <a className="adm-btn adm-btn--solid adm-btn--sm" href={terminal("account")} target="_blank" rel="noopener noreferrer" data-tip="Your positions, orders and funds — and your trading switch, which is OFF until you turn it on.">
                Open Positions
              </a>
            )}
            {d.connected && (
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={Boolean(busy)} onClick={() => act("out", () => api("/api/admin/accounts/me/disconnect", { method: "POST" }))}>
                Log out of Kite here
              </button>
            )}
          </span>
        </li>
      </ul>

      {showForm ? (
        <form className="za-form" onSubmit={saveKeys}>
          <ol className="za-steps">
            <li>
              At <b>developers.kite.trade</b>, signed in with <b>your own</b> Zerodha ID, create a Kite Connect app (Zerodha charges for it; it is yours, not this site&rsquo;s).
            </li>
            <li>
              Set its <b>redirect URL</b> to <code>{d.redirectUrl}</code> <Copy text={d.redirectUrl} />
            </li>
            <li>Paste its API key and secret here. The secret is stored encrypted and never shown again.</li>
            <li>If your Kite app asks for the static IP that orders will come from, it is this server&rsquo;s address (ask the owner for it): the orders leave from here, not from your computer.</li>
          </ol>
          <div className="za-fields">
            <label>
              <span>API key</span>
              <input value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value.trim() })} autoComplete="off" spellCheck="false" required placeholder={d.apiKeyHint || "your app's key"} />
            </label>
            <label>
              <span>API secret{d.configured ? " (leave empty to keep the saved one)" : ""}</span>
              <input type="password" value={form.apiSecret} onChange={(e) => setForm({ ...form, apiSecret: e.target.value.trim() })} autoComplete="new-password" required={!d.configured} />
            </label>
            <span className="za-acts">
              <button className="adm-btn adm-btn--solid adm-btn--sm" disabled={busy === "save"}>
                {busy === "save" ? "Saving…" : "Save the key"}
              </button>
              {d.configured && (
                <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setEdit(false)}>
                  Cancel
                </button>
              )}
            </span>
          </div>
        </form>
      ) : (
        <p className="za-acts">
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setEdit(true)}>
            Change the key
          </button>
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={Boolean(busy)} onClick={removeKeys}>
            Remove my key
          </button>
        </p>
      )}
      <p className="za-dim">This is <b>your</b> account: only you can see it or place an order on it here. Trading starts OFF; you turn it on under Positions, and every order asks you to confirm. Prices and charts come from the site&rsquo;s own data connection.</p>
    </>
  );
}

export default function ZerodhaAccounts() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const owner = Boolean(user && user.role === "superadmin");
  // the result of the Kite login round trip arrives as ?account=connected | error
  const [flash] = useState(() => {
    const a = params.get("account");
    return a === "connected" ? { ok: true, text: "Your Zerodha account is connected until 6 AM tomorrow." } : a === "error" ? { ok: false, text: params.get("reason") || "The Kite login did not complete." } : null;
  });
  useEffect(() => {
    if (!params.has("account")) return;
    const next = new URLSearchParams(params);
    next.delete("account");
    next.delete("reason");
    setParams(next, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const note = flash ? (
    <p className={`adm-alert ${flash.ok ? "adm-alert--ok" : "adm-alert--error"}`} role="status">
      {flash.text}
    </p>
  ) : null;
  return (
    <section className="hm-card za" aria-labelledby="za-h" data-jump="Zerodha accounts">
      <div className="cz-head">
        <div>
          <h2 id="za-h" className="hm-h">
            {owner ? "People’s own Zerodha accounts" : "Your Zerodha account"}
          </h2>
          <p>{owner ? "Let someone you have added trade on their own Kite ID from this site. Each account is separate from yours and from every other." : "Connect your own Kite ID and trade on it from this site."}</p>
        </div>
      </div>
      {owner ? <People flash={note} /> : <Mine flash={note} />}
    </section>
  );
}
