import React, { useEffect, useState } from "react";
import { api } from "./api";
import { useTopics } from "./live";
import { useAuth } from "./auth";
import Shell from "./Shell";
import { Alert, Field, Loading } from "./ui";
import { useDialog } from "./dialog/DialogProvider";
import "./signin.css";

const when = (iso) =>
  iso
    ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "never";

const roleName = (r) => (r.owner ? "Owner · superadmin" : r.role === "superadmin" ? "Superadmin" : "Admin");

/** What a superadmin can do, in the words the owner reads before making one. */
function SuperMeans({ email }) {
  return (
    <>
      <p>
        <b>{email}</b> will be able to do everything you can in this area:
      </p>
      <ul className="adm-means">
        <li>see and trade on the site’s own Zerodha account, with its orders, positions and funds</li>
        <li>change every setting: sign-in, email, the AI model and its spending switches</li>
        <li>add and remove admins, and see the sign-in trail</li>
        <li>open the pages kept for superadmins, your Kundali among them</li>
      </ul>
      <p>Only you can make someone a superadmin, make them an admin again, or remove them. You cannot be removed.</p>
    </>
  );
}

/** Superadmins only (the route guard and the server both enforce it). Who is a superadmin is the owner's to decide. */
export default function AdminUsers() {
  const ask = useDialog();
  const { user } = useAuth();
  const [rows, setRows] = useState(null);
  const [canSupers, setCanSupers] = useState(false);
  const [role, setRole] = useState("admin");
  const [email, setEmail] = useState("");
  const [emailReady, setEmailReady] = useState(false);
  const [requests, setRequests] = useState([]);
  const [invite, setInvite] = useState(true);
  const [msg, setMsg] = useState({ kind: "", text: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api("/api/admin/admins")
      .then((d) => {
        setRows(d.admins);
        setCanSupers(Boolean(d.canManageSupers));
        setEmailReady(Boolean(d.emailReady));
      })
      .catch((e) => setMsg({ kind: "error", text: e.message }));
    api("/api/admin/requests")
      .then((d) => setRequests(d.requests || []))
      .catch(() => {});
  }, []);
  // someone asked for access, or the list was changed from another tab or device
  useTopics(["system"], () => {
    api("/api/admin/admins")
      .then((d) => {
        setRows(d.admins);
        setCanSupers(Boolean(d.canManageSupers));
        setEmailReady(Boolean(d.emailReady));
      })
      .catch(() => {});
    api("/api/admin/requests")
      .then((d) => setRequests(d.requests || []))
      .catch(() => {});
  });

  const decide = async (r, verb) => {
    setBusy(true);
    setMsg({ kind: "", text: "" });
    try {
      const d = await api(`/api/admin/requests/${encodeURIComponent(r.id)}/${verb}`, { method: "POST", body: {} });
      setRequests(d.requests || []);
      if (verb === "approve") {
        const list = await api("/api/admin/admins");
        setRows(list.admins);
        setMsg(
          d.invited
            ? { kind: "ok", text: `${r.name} was added, and an invitation was emailed to ${r.email}.` }
            : { kind: "error", text: `${r.name} was added, but the invitation could not be sent${d.inviteProblem ? `: ${d.inviteProblem}` : "."} Use “Send sign-in link” in the list.` }
        );
      } else setMsg({ kind: "ok", text: `The request from ${r.name} was declined. They are not told.` });
    } catch (err) {
      setMsg({ kind: "error", text: err.message });
    }
    setBusy(false);
  };

  const add = async (e) => {
    e.preventDefault();
    const asSuper = canSupers && role === "superadmin";
    if (asSuper) {
      const yes = await ask({ tone: "danger", title: "Add this person as a superadmin?", body: <SuperMeans email={email.trim()} />, confirmText: "Add as superadmin", cancelText: "Not now" });
      if (!yes) return;
    }
    setBusy(true);
    setMsg({ kind: "", text: "" });
    try {
      const d = await api("/api/admin/admins", { method: "POST", body: { email, invite, ...(asSuper ? { role: "superadmin" } : {}) } });
      setRows(d.admins);
      setEmail("");
      setRole("admin");
      const added = asSuper ? "Added as a superadmin" : "Added";
      setMsg(
        d.invited
          ? { kind: "ok", text: `${added}, and an invitation was emailed. They can sign in with Google, or choose a password from the link.` }
          : d.inviteProblem
            ? { kind: "error", text: `${added}, but the invitation could not be sent: ${d.inviteProblem} You can send it again from the list.` }
            : { kind: "ok", text: `${added}. They can now sign in with that email address — through Google, or by email.` }
      );
    } catch (err) {
      setMsg({ kind: "error", text: err.message });
    }
    setBusy(false);
  };

  // an admin becomes a superadmin, or a superadmin an admin again: the owner's decision, asked once more before it happens
  const setRoleOf = async (row, to) => {
    const yes = await ask(
      to === "superadmin"
        ? { tone: "danger", title: "Make this person a superadmin?", body: <SuperMeans email={row.email} />, confirmText: "Make superadmin", cancelText: "Keep as admin" }
        : {
            title: "Make this person an admin again?",
            body: (
              <>
                <p>
                  <b>{row.email}</b> keeps their sign-in and everything an admin can use.
                </p>
                <p>The site’s own trading account, the settings, this page and the superadmin pages close for them at once, even if they are signed in right now.</p>
              </>
            ),
            confirmText: "Make admin",
            cancelText: "Keep as superadmin",
          }
    );
    if (!yes) return;
    setBusy(true);
    setMsg({ kind: "", text: "" });
    try {
      const d = await api(`/api/admin/admins/${encodeURIComponent(row.email)}`, { method: "PUT", body: { role: to } });
      setRows(d.admins);
      setMsg({ kind: "ok", text: to === "superadmin" ? `${row.email} is now a superadmin.` : `${row.email} is an admin again.` });
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
      title: row.role === "superadmin" ? "Remove this superadmin?" : "Remove this admin?",
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

  // a superadmin the owner made manages the admins and their own row; another superadmin's row (and the owner's) is the owner's
  const mine = (r) => canSupers || r.role !== "superadmin" || r.email === (user || {}).email;

  return (
    <Shell crumb="Admin users" narrow>
      <h1 className="adm-h1">Admin users</h1>
      <p className="adm-lead">
        Admins can use everything in this area except this page. Add someone by their email address: they
        can then sign in with Google, a password or an emailed code. One mailbox is one person — the same
        address in another spelling (capitals; for Gmail, dots, +tags) is not added twice.
      </p>
      <p className="adm-lead adm-lead--roles">
        <b>Superadmins</b> can do everything the owner can — the site’s own trading account, every setting, this page and the
        pages kept for superadmins. {canSupers ? "Only you, the owner, can make someone a superadmin or take that away." : "Only the owner can make someone a superadmin or take that away; you manage the admins."}
      </p>

      <form className="adm-card adm-form adm-form--inline" onSubmit={add}>
        <Field id="new" label={canSupers ? "Add a person" : "Add an admin"}>
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
          {canSupers && role === "superadmin" ? "Add superadmin" : "Add admin"}
        </button>
        {canSupers && (
          <fieldset className="adm-rolepick" style={{ gridColumn: "1 / -1" }}>
            <legend>Add them as</legend>
            <label className={role === "admin" ? "is-on" : ""}>
              <input type="radio" name="new-role" value="admin" checked={role === "admin"} onChange={() => setRole("admin")} />
              <span>
                <b>Admin</b>
                <small>The desk and its tools — not people, your trading account or the superadmin pages</small>
              </span>
            </label>
            <label className={role === "superadmin" ? "is-on" : ""}>
              <input type="radio" name="new-role" value="superadmin" checked={role === "superadmin"} onChange={() => setRole("superadmin")} />
              <span>
                <b>Superadmin</b>
                <small>Everything you can do, your trading account included</small>
              </span>
            </label>
          </fieldset>
        )}
        {emailReady && (
          <label className="sg-check" style={{ gridColumn: "1 / -1" }}>
            <input type="checkbox" checked={invite} onChange={(e) => setInvite(e.target.checked)} /> Email them an invitation with a link to choose a password
          </label>
        )}
      </form>

      <Alert kind={msg.kind === "ok" ? "ok" : "error"}>{msg.text}</Alert>

      {requests.length > 0 && (
        <section className="adm-card" aria-label="Access requests">
          <h2>Access requests ({requests.length})</h2>
          <p className="adm-small">People who used “Create account” on the sign-in page. Nobody gets in until you approve: approving adds them and emails an invitation.</p>
          <ul className="adm-people">
            {requests.map((r) => (
              <li key={r.id}>
                <div>
                  <b>{r.name}</b>
                  <small>
                    {r.email} · asked {when(r.at)}
                  </small>
                  {r.note && <small>“{r.note}”</small>}
                </div>
                <span className="sg-acts">
                  <button className="adm-btn adm-btn--solid adm-btn--sm" disabled={busy} onClick={() => decide(r, "approve")}>
                    Approve
                  </button>
                  <button className="adm-btn adm-btn--ghost adm-btn--sm" disabled={busy} onClick={() => decide(r, "decline")}>
                    Decline
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!rows && !msg.text && <Loading />}

      {rows && (
        <ul className="adm-people" aria-label="People with access">
          {rows.map((r) => (
            <li key={r.email}>
              <div>
                <b>{r.email}</b>
                <small>
                  <span className={`adm-role adm-role--${r.role}`}>{roleName(r)}</span> · last sign-in {when(r.lastLogin)}
                  {r.addedBy ? ` · added by ${r.addedBy}` : ""}
                  {r.role === "superadmin" && !r.owner && r.madeSuperAt ? ` · superadmin since ${when(r.madeSuperAt)}` : ""}
                </small>
                <span className="sg-badges">
                  <span className={`sg-chip ${r.googleLinked ? "is-on" : ""}`}>Google {r.googleLinked ? "used" : "not yet"}</span>
                  <span className={`sg-chip ${r.hasPassword ? "is-on" : ""}`}>Password {r.hasPassword ? "set" : "none"}</span>
                  {r.lockedOut && <span className="sg-chip is-warn">Locked out</span>}
                </span>
              </div>
              {mine(r) ? (
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
                  {canSupers && !r.locked && (
                    <button
                      className="adm-btn adm-btn--ghost adm-btn--sm"
                      disabled={busy}
                      onClick={() => setRoleOf(r, r.role === "superadmin" ? "admin" : "superadmin")}
                      data-tip={r.role === "superadmin" ? "Back to an admin: your trading account, the settings and the superadmin pages close for them at once." : "Give this person everything you can do, your trading account included."}
                    >
                      {r.role === "superadmin" ? "Make admin" : "Make superadmin"}
                    </button>
                  )}
                  {r.locked ? (
                    <span className="adm-small">Cannot be removed</span>
                  ) : r.role === "superadmin" && !canSupers ? (
                    <span className="adm-small">Removed by the owner only</span>
                  ) : (
                    <button className="adm-btn adm-btn--danger adm-btn--sm" disabled={busy} onClick={() => remove(r)}>
                      Remove
                    </button>
                  )}
                </span>
              ) : (
                <span className="sg-acts">
                  <span className="adm-small">Managed by the owner</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
