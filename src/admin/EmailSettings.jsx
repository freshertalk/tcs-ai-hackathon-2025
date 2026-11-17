// Email & sign-in (superadmin): which ways in are open, the mail server that sends sign-in links and codes
// (SMTP: host, port, user, password, From), the site address used in those links, and the sign-in trail.
// The password is stored encrypted and is never shown again; leave it blank to keep it.

import React, { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import Shell from "./Shell";
import { Alert, Field, Loading } from "./ui";
import "./signin.css";

const PRESETS = [
  { name: "Gmail", host: "smtp.gmail.com", port: 587, security: "starttls", note: "Use an app password (Google account → Security → 2-Step Verification → App passwords), not your normal password." },
  { name: "Outlook / Microsoft 365", host: "smtp.office365.com", port: 587, security: "starttls", note: "SMTP AUTH must be allowed for the mailbox; an app password may be needed." },
  { name: "Amazon SES", host: "email-smtp.ap-south-1.amazonaws.com", port: 587, security: "starttls", note: "Use the SMTP user name and password from the SES console (not your AWS keys); the From address must be verified." },
  { name: "Zoho Mail", host: "smtp.zoho.in", port: 587, security: "starttls", note: "Use an application-specific password." },
];

const TYPES = {
  signin: "Signed in",
  signin_failed: "Failed sign-in",
  signout: "Signed out",
  signout_everywhere: "Signed out everywhere",
  signout_forced: "Signed out by the owner",
  locked: "Locked (too many tries)",
  unlocked: "Unlocked",
  link_requested: "Link requested",
  code_sent: "Code sent",
  invite_sent: "Invitation sent",
  password_set: "Password chosen",
  password_changed: "Password changed",
  password_change_failed: "Wrong current password",
  admin_added: "Person added",
  admin_removed: "Person removed",
  settings_changed: "Settings changed",
  test_mail: "Test email",
};
const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—");

export default function EmailSettings() {
  const [s, setS] = useState(null);
  const [form, setForm] = useState(null);
  const [signIn, setSignIn] = useState({ google: true, password: true, code: true });
  const [publicUrl, setPublicUrl] = useState("");
  const [msg, setMsg] = useState({ kind: "", text: "" });
  const [busy, setBusy] = useState("");
  const [trail, setTrail] = useState(null);

  const take = useCallback((d) => {
    setS(d);
    setSignIn(d.signIn);
    setPublicUrl(d.publicUrl || "");
    setForm({ host: d.smtp.host, port: String(d.smtp.port || 587), security: d.smtp.security || "starttls", user: d.smtp.user, pass: "", fromEmail: d.smtp.fromEmail, fromName: d.smtp.fromName });
  }, []);

  const loadTrail = useCallback(() => {
    api("/api/admin/auth/audit?limit=40")
      .then((d) => setTrail(d.entries))
      .catch(() => setTrail([]));
  }, []);

  useEffect(() => {
    api("/api/admin/settings/email")
      .then(take)
      .catch((e) => setMsg({ kind: "error", text: e.message }));
    loadTrail();
  }, [take, loadTrail]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const say = (kind, text) => setMsg({ kind, text });

  const run = async (name, fn) => {
    setBusy(name);
    say("", "");
    try {
      await fn();
    } catch (err) {
      say("error", err.message);
    }
    setBusy("");
  };

  const save = (e) => {
    e.preventDefault();
    run("save", async () => {
      const body = { signIn, publicUrl };
      if (form.host.trim()) body.smtp = { host: form.host.trim(), port: Number(form.port), security: form.security, user: form.user.trim(), pass: form.pass, fromEmail: form.fromEmail.trim(), fromName: form.fromName.trim() };
      const d = await api("/api/admin/settings/email", { method: "PUT", body });
      take(d);
      loadTrail();
      say("ok", "Saved. The next sign-in uses these settings.");
    });
  };
  const test = () =>
    run("test", async () => {
      const d = await api("/api/admin/settings/email/test", { method: "POST", body: {} });
      say("ok", `A test email was sent to ${d.to}. Check that inbox (and its spam folder).`);
    });
  const check = () =>
    run("check", async () => {
      await api("/api/admin/settings/email/verify", { method: "POST", body: {} });
      say("ok", "Connected: the mail server accepted the login.");
    });
  const forget = () =>
    run("forget", async () => {
      const d = await api("/api/admin/settings/email", { method: "PUT", body: { clearSmtp: true, signIn } });
      take(d);
      say("ok", "The saved mail server was removed.");
    });
  const preset = (p) => setForm({ ...form, host: p.host, port: String(p.port), security: p.security });
  const flip = (k) => (e) => setSignIn({ ...signIn, [k]: e.target.checked });

  return (
    <Shell crumb="Email & sign-in" narrow>
      <h1 className="adm-h1">Email &amp; sign-in</h1>
      <p className="adm-lead">
        How people get in. Google and email lead to the <b>same person</b>: one mailbox is one user, however they arrive, and only people you
        have added under Admin users can sign in at all. Mail goes out through your own mail server.
      </p>

      {!s && !msg.text && <Loading />}
      {s && form && (
        <form onSubmit={save} autoComplete="off" className="adm-form">
          <section className="adm-card">
            <h2>Status</h2>
            <p className="sg-chips">
              <span className={`sg-chip ${s.googleReady ? "is-on" : ""}`}>Google {s.googleReady ? "ready" : "not set up"}</span>
              <span className={`sg-chip ${s.emailReady ? "is-on" : "is-warn"}`}>Email {s.emailReady ? `ready (${s.smtp.source})` : "not set up"}</span>
              <span className={`sg-chip ${s.peopleWithPassword ? "is-on" : ""}`}>
                {s.peopleWithPassword} {s.peopleWithPassword === 1 ? "person has" : "people have"} a password
              </span>
            </p>
          </section>

          <section className="adm-card">
            <h2>Ways to sign in</h2>
            <div className="sg-opts">
              <label className="sg-opt">
                <input type="checkbox" checked={signIn.google} onChange={flip("google")} />
                <b>Google</b>
                <small>The “Sign in with Google” button (set its credentials under Google sign-in).</small>
              </label>
              <label className="sg-opt">
                <input type="checkbox" checked={signIn.password} onChange={flip("password")} />
                <b>Email and password</b>
                <small>People choose a password from an emailed link; five wrong tries lock the address for 15 minutes.</small>
              </label>
              <label className="sg-opt">
                <input type="checkbox" checked={signIn.code} onChange={flip("code")} />
                <b>Emailed code</b>
                <small>A 6-digit code sent to the person's inbox, valid 10 minutes, used once. Needs the mail server below.</small>
              </label>
            </div>
          </section>

          <section className="adm-card">
            <h2>Mail server (SMTP)</h2>
            {s.smtp.source === "environment" && <Alert kind="info">These values come from the server's environment (SMTP_HOST …). Saving here overrides them.</Alert>}
            <p className="adm-small">
              Quick fill:{" "}
              {PRESETS.map((p) => (
                <button key={p.name} type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => preset(p)} style={{ marginRight: 6 }} data-tip={p.note}>
                  {p.name}
                </button>
              ))}
            </p>
            <div className="sg-grid">
              <Field id="sm-host" label="Host">
                <input id="sm-host" value={form.host} onChange={set("host")} placeholder="smtp.example.org" spellCheck="false" autoCapitalize="none" />
              </Field>
              <Field id="sm-port" label="Port" hint="587 for STARTTLS, 465 for SSL.">
                <input id="sm-port" type="number" min="1" max="65535" value={form.port} onChange={set("port")} />
              </Field>
              <Field id="sm-sec" label="Connection security">
                <select id="sm-sec" value={form.security} onChange={set("security")}>
                  <option value="starttls">STARTTLS (recommended)</option>
                  <option value="ssl">SSL / TLS</option>
                  <option value="none">None (only for a trusted internal server)</option>
                </select>
              </Field>
              <Field id="sm-user" label="User name" hint="Often the full email address. Leave empty for a server that needs no login.">
                <input id="sm-user" value={form.user} onChange={set("user")} autoComplete="off" spellCheck="false" autoCapitalize="none" />
              </Field>
              <Field id="sm-pass" label="Password" hint={s.smtp.passSet ? "A password is saved. Leave this blank to keep it, or type a new one." : "Required when a user name is given."}>
                <input id="sm-pass" type="password" value={form.pass} onChange={set("pass")} placeholder={s.smtp.passSet ? "•••••••••••• (saved)" : ""} autoComplete="new-password" spellCheck="false" />
              </Field>
              <Field id="sm-from" label="Send from (address)" hint="Must be allowed for this account.">
                <input id="sm-from" type="email" value={form.fromEmail} onChange={set("fromEmail")} placeholder="noreply@example.org" spellCheck="false" autoCapitalize="none" />
              </Field>
              <Field id="sm-name" label="Sender name">
                <input id="sm-name" value={form.fromName} onChange={set("fromName")} placeholder="DrishtiAI" />
              </Field>
            </div>
          </section>

          <section className="adm-card">
            <h2>Site address used in emailed links</h2>
            <Field id="sm-url" label="Address" hint={s.publicUrlInUse ? `Links currently point to ${s.publicUrlInUse}.` : "Not set: links cannot be sent from the live site until this is filled in."}>
              <input id="sm-url" value={publicUrl} onChange={(e) => setPublicUrl(e.target.value)} placeholder="https://vinaytiwari.org" spellCheck="false" autoCapitalize="none" />
            </Field>
            <p className="adm-small">Always the real address of this site, never taken from a visitor's request, so nobody can make a link that points somewhere else.</p>
          </section>

          <Alert kind={msg.kind === "ok" ? "ok" : "error"}>{msg.text}</Alert>
          <div className="adm-actions">
            <button className="adm-btn adm-btn--solid" disabled={Boolean(busy)}>
              {busy === "save" ? "Saving…" : "Save settings"}
            </button>
            <button type="button" className="adm-btn adm-btn--ghost" onClick={check} disabled={Boolean(busy) || !s.emailReady} data-tip="Connect and log in to the mail server without sending anything.">
              {busy === "check" ? "Checking…" : "Check connection"}
            </button>
            <button type="button" className="adm-btn adm-btn--ghost" onClick={test} disabled={Boolean(busy) || !s.emailReady} data-tip="Send a test message to your own address.">
              {busy === "test" ? "Sending…" : "Send me a test email"}
            </button>
            {s.smtp.source === "database" && (
              <button type="button" className="adm-btn adm-btn--danger" onClick={forget} disabled={Boolean(busy)}>
                Remove saved mail server
              </button>
            )}
          </div>
        </form>
      )}
      {!s && msg.text && <Alert>{msg.text}</Alert>}

      <section className="adm-card" style={{ marginTop: 16 }}>
        <h2>Recent sign-in activity</h2>
        {!trail && <Loading />}
        {trail && !trail.length && <p className="adm-small">Nothing recorded yet.</p>}
        {trail && trail.length > 0 && (
          <div className="sg-scroll">
            <table className="sg-audit">
              <thead>
                <tr>
                  <th>When</th>
                  <th>What</th>
                  <th>Who</th>
                  <th>How</th>
                  <th>From</th>
                </tr>
              </thead>
              <tbody>
                {trail.map((a, i) => (
                  <tr key={`${a.at}-${i}`}>
                    <td>{when(a.at)}</td>
                    <td className={/failed|locked|wrong/i.test(a.type) ? "is-bad" : ""}>{TYPES[a.type] || a.type}</td>
                    <td>{a.email}</td>
                    <td>{a.method || ""}</td>
                    <td>{a.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p>
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={loadTrail}>
            Refresh
          </button>
        </p>
      </section>
    </Shell>
  );
}
