import React, { useEffect, useState } from "react";
import { api } from "./api";
import Shell from "./Shell";
import { Alert, Field, Loading } from "./ui";
import { useDialog } from "./dialog/DialogProvider";

const when = (iso) =>
  iso
    ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "never";

/** Superadmin only (the route guard and the server both enforce it). */
export default function AdminUsers() {
  const ask = useDialog();
  const [rows, setRows] = useState(null);
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState({ kind: "", text: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api("/api/admin/admins")
      .then((d) => setRows(d.admins))
      .catch((e) => setMsg({ kind: "error", text: e.message }));
  }, []);

  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMsg({ kind: "", text: "" });
    try {
      const d = await api("/api/admin/admins", { method: "POST", body: { email } });
      setRows(d.admins);
      setEmail("");
      setMsg({ kind: "ok", text: "Added. They can now sign in with that Google account." });
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
        Admins can use everything in this area except this page. Add someone by the email address of
        their Google account.
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
              </div>
              {r.locked ? (
                <span className="adm-small">Cannot be removed</span>
              ) : (
                <button className="adm-btn adm-btn--danger adm-btn--sm" disabled={busy} onClick={() => remove(r)}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
