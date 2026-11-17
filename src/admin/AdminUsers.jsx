import React, { useEffect, useState } from "react";
import { api } from "./api";
import Shell from "./Shell";
import { Alert, Field, Loading } from "./ui";
import { useDialog } from "./dialog/DialogProvider";
import "./signin.css";

const when = (iso) =>
  iso
    ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "never";

/** Superadmin only (the route guard and the server both enforce it). */
export default function AdminUsers() {
  const ask = useDialog();
  const [rows, setRows] = useState(null);
  const [email, setEmail] = useState("");
  const [emailReady, setEmailReady] = useState(false);
  const [invite, setInvite] = useState(true);
  const [msg, setMsg] = useState({ kind: "", text: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api("/api/admin/admins")
      .then((d) => {
        setRows(d.admins);
        setEmailReady(Boolean(d.emailReady));
      })
      .catch((e) => setMsg({ kind: "error", text: e.message }));
  }, []);

  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMsg({ kind: "", text: "" });
    try {
      const d = await api("/api/admin/admins", { method: "POST", body: { email, invite } });
      setRows(d.admins);
      setEmail("");
      setMsg(
        d.invited
          ? { kind: "ok", text: "Added, and an invitation was emailed. They can sign in with Google, or choose a password from the link." }
          : d.inviteProblem
            ? { kind: "error", text: `Added, but the invitation could not be sent: ${d.inviteProblem} You can send it again from the list.` }
            : { kind: "ok", text: "Added. They can now sign in with that email address — through Google, or by email." }
      );
    } catch (err) {
      setMsg({ kind: "error", text: err.message });
    }
    setBusy(false);
  };

  const act = async (row, path, done) => {
    setBusy(true);
    setMsg({ kind: "", text: "" });
    try {
      await api(`/api/admin/admins/${encodeURIComponent(row.email)}/${path}`, { method: "POST", body: {} });
      const d = await api("/api/admin/admins");
      setRows(d.admins);
      setMsg({ kind: "ok", text: done });
    } catch (err) {
      setMsg({ kind: "error", text: err.message });
    }
    setBusy(false);
  };

  const remove = async (row) => {
    const yes = await ask({
      tone: "danger",
      title: "Remove this admin?",
      body: (
        <>
          <p>
            <b>{row.email}</b> will no longer be able to sign in to the private area.
          </p>
          <p>If they are signed in right now, their access ends at once. You can add them again at any time.</p>
        </>
      ),
      confirmText: "Remove access",
      cancelText: "Keep them",
    });
    if (!yes) return;
    setBusy(true);
    setMsg({ kind: "", text: "" });
    try {
      const d = await api(`/api/admin/admins/${encodeURIComponent(row.email)}`, { method: "DELETE" });
      setRows(d.admins);
      setMsg({ kind: "ok", text: `${row.email} was removed.` });
    } catch (err) {
      setMsg({ kind: "error", text: err.message });
    }
    setBusy(false);
  };

  return (
    <Shell crumb="Admin users" narrow>
      <h1 className="adm-h1">Admin users</h1>
      <p className="adm-lead">
        Admins can use everything in this area except this page. Add someone by their email address: they
        can then sign in with Google, a password or an emailed code. One mailbox is one person — the same
        address in another spelling (capitals; for Gmail, dots, +tags) is not added twice.
      </p>

      <form className="adm-card adm-form adm-form--inline" onSubmit={add}>
        <Field id="new" label="Add an admin">
          <input
            id="new"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@gmail.com"
            required
            spellCheck="false"
            autoComplete="off"
          />
        </Field>
        <button className="adm-btn adm-btn--solid" disabled={busy}>
          Add admin
        </button>
        {emailReady && (
          <label className="sg-check" style={{ gridColumn: "1 / -1" }}>
            <input type="checkbox" checked={invite} onChange={(e) => setInvite(e.target.checked)} /> Email them an invitation with a link to choose a password
          </label>
        )}
      </form>

      <Alert kind={msg.kind === "ok" ? "ok" : "error"}>{msg.text}</Alert>
      {!rows && !msg.text && <Loading />}

      {rows && (
        <ul className="adm-people" aria-label="People with access">
          {rows.map((r) => (
            <li key={r.email}>
              <div>
                <b>{r.email}</b>
                <small>
                  <span className={`adm-role adm-role--${r.role}`}>
                    {r.role === "superadmin" ? "Superadmin" : "Admin"}
                  </span>{" "}
                  · last sign-in {when(r.lastLogin)}
                  {r.addedBy ? ` · added by ${r.addedBy}` : ""}
                </small>
                <span className="sg-badges">
                  <span className={`sg-chip ${r.googleLinked ? "is-on" : ""}`}>Google {r.googleLinked ? "used" : "not yet"}</span>
                  <span className={`sg-chip ${r.hasPassword ? "is-on" : ""}`}>Password {r.hasPassword ? "set" : "none"}</span>
                  {r.lockedOut && <span className="sg-chip is-warn">Locked out</span>}
                </span>
              </div>
              <span className="sg-acts">
                {r.lockedOut && (
                  <button className="adm-btn adm-btn--ghost adm-btn--sm" disabled={busy} onClick={() => act(r, "unlock", `${r.email} was unlocked.`)}>
                    Unlock
                  </button>
                )}
                {emailReady && (
                  <button className="adm-btn adm-btn--ghost adm-btn--sm" disabled={busy} onClick={() => act(r, "link", `A link to choose a password was emailed to ${r.email}.`)} data-tip="Email this person a one-time link to choose or reset their password.">
                    Send sign-in link
                  </button>
                )}
                <button className="adm-btn adm-btn--ghost adm-btn--sm" disabled={busy} onClick={() => act(r, "signout", `${r.email} was signed out of every device.`)} data-tip="End every session this person has open, on every device.">
                  Sign out everywhere
                </button>
                {r.locked ? (
                  <span className="adm-small">Cannot be removed</span>
                ) : (
                  <button className="adm-btn adm-btn--danger adm-btn--sm" disabled={busy} onClick={() => remove(r)}>
                    Remove
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
