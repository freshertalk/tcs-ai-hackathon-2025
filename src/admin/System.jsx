// src/admin/System.jsx
// Who may administer the site, and whether the back end is healthy.

import React, { useCallback, useEffect, useState } from "react";
import { call, explain } from "../api/collector";
import { REVIEWS } from "../data/books";
import { Card, Chip, Empty, Failure, Loading } from "./ui";
import { IconCheck, IconAlert, IconPlus, IconRefresh, IconTrash } from "../components/ui/icons";
import { useMe } from "../account/me";

function useHealth() {
  const [h, setH] = useState({ status: "loading", data: null });
  const load = useCallback(async () => {
    setH({ status: "loading", data: null });
    try {
      const sep = REVIEWS.endpoint.includes("?") ? "&" : "?";
      const r = await fetch(`${REVIEWS.endpoint}${sep}check=1`, { cache: "no-store" });
      const d = await r.json();
      setH({ status: d && d.ok ? "ready" : "error", data: d });
    } catch {
      setH({ status: "error", data: null });
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  return { ...h, reload: load };
}

function Row({ ok, label, hint }) {
  return (
    <li className={`hl ${ok ? "is-ok" : "is-bad"}`}>
      <span className="hl__i">{ok ? <IconCheck size={16} strokeWidth={2.6} /> : <IconAlert size={16} />}</span>
      <span>
        {label}
        {hint && !ok ? <small>{hint}</small> : null}
      </span>
    </li>
  );
}

export default function System() {
  const { isOwner } = useMe();
  const health = useHealth();
  const [team, setTeam] = useState({ status: "loading", admins: [], owner: "", error: null });
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const loadTeam = useCallback(async () => {
    try {
      const d = await call("team_list");
      setTeam({ status: "ready", admins: d.admins || [], owner: d.owner || "", error: null });
    } catch (e) {
      setTeam((t) => ({ ...t, status: "error", error: e }));
    }
  }, []);

  useEffect(() => {
    loadTeam();
  }, [loadTeam]);

  const change = async (action, mail) => {
    setBusy(true);
    setMsg(null);
    try {
      const d = await call(action, { email: mail });
      setTeam({ status: "ready", admins: d.admins || [], owner: d.owner || "", error: null });
      setMsg({ ok: true, text: action === "team_add" ? `${mail} is now an admin.` : `${mail} is no longer an admin.` });
      if (action === "team_add") setEmail("");
    } catch (e) {
      setMsg({ ok: false, text: e && e.code === "invalid" ? "That does not look like a valid e-mail address." : explain(e) });
    }
    setBusy(false);
  };

  const d = health.data;

  return (
    <div className="grid2">
      <Card
        title="Admins"
        sub="Accounts that can open this dashboard. Only the owner can change the list."
      >
        {team.status === "loading" && <Loading label="Loading…" />}
        {team.status === "error" && <Failure error={team.error} text={explain(team.error)} onRetry={loadTeam} />}
        {team.status === "ready" && (
          <ul className="team">
            {team.admins.map((m) => (
              <li key={m}>
                <span className="team__m">{m}</span>
                {m === team.owner ? (
                  <Chip tone="ink">owner</Chip>
                ) : isOwner ? (
                  <button type="button" className="ib" aria-label={`Remove ${m}`} title="Remove" disabled={busy} onClick={() => change("team_remove", m)}>
                    <IconTrash size={16} />
                  </button>
                ) : (
                  <Chip tone="muted">admin</Chip>
                )}
              </li>
            ))}
          </ul>
        )}

        {isOwner ? (
          <form
            className="fld__row team__add"
            onSubmit={(e) => {
              e.preventDefault();
              if (email.trim()) change("team_add", email.trim());
            }}
          >
            <input type="email" placeholder="colleague@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} required aria-label="E-mail address of the new admin" />
            <button type="submit" className="db db--solid db--sm" disabled={busy}>
              <IconPlus size={15} /> Add admin
            </button>
          </form>
        ) : (
          <Empty>Only the owner ({team.owner || "…"}) can add or remove admins.</Empty>
        )}
        {msg && (
          <p className={`note ${msg.ok ? "is-ok" : "is-bad"}`} role="status">
            {msg.text}
          </p>
        )}
      </Card>

      <Card
        title="Back end"
        sub="The Google Sheet and script that keep ratings, readers, statistics, coupons and the audit log."
        action={
          <button type="button" className="db db--ghost db--sm" onClick={health.reload}>
            <IconRefresh size={15} /> Check again
          </button>
        }
      >
        {health.status === "loading" && <Loading label="Checking…" />}
        {health.status === "error" && <Failure text="The collector did not answer. Is the script deployed as a web app open to “Anyone”?" onRetry={health.reload} />}
        {d && health.status === "ready" && (
          <>
            <p className="sys__build">
              Script build <code>{d.build || "unknown — deploy the newest script"}</code> · documents edition <code>{d.legal || "?"}</code>
            </p>
            <ul className="hls">
              <Row ok={Boolean(d.v8)} label="V8 runtime" hint="Project settings → tick “Enable Chrome V8 runtime”." />
              <Row ok={Boolean(d.clientId)} label="Google client id set" />
              <Row ok={Boolean(d.keysTab)} label="Keys tab holds the book key" hint="Paste the row from book-keys-for-sheet.tsv." />
              <Row ok={Boolean(d.consentTab)} label="Consent records exist" hint="Appears after the first sign-in." />
              <Row ok={Boolean(d.signatureCheck)} label="Signature check works" />
              <Row ok={Boolean(d.analytics)} label="Statistics, coupons and audit are in this build" hint="Deploy the newest script as a New version." />
              {d.tabs && (
                <>
                  <Row ok={Boolean(d.tabs.events)} label="Events tab (statistics) created" hint="Created with the first tracked visit." />
                  <Row ok={Boolean(d.tabs.users)} label="Users tab created" hint="Created with the first sign-in on the new script." />
                  <Row ok={Boolean(d.tabs.audit)} label="Audit tab created" hint="Created with the first audited action." />
                </>
              )}
            </ul>
          </>
        )}
      </Card>

      <Card title="What is recorded, and for whom" className="grid2__wide">
        <ul className="plain">
          <li>
            <b>Visitors who press “Accept”</b> — a random id kept in their browser, the pages they open and the
            seconds they are active on each. No IP address, no content typed.
          </li>
          <li>
            <b>Visitors who press “Necessary only”</b> — page views only, with no id at all.
          </li>
          <li>
            <b>Signed-in readers</b> — the same, tied to their account, as the Privacy Policy they accepted says.
          </li>
          <li>
            <b>Admin traffic</b> is left out of the figures unless you switch it on.
          </li>
          <li>
            <b>Audit log and consent records</b> are kept as evidence and are not edited or removed — not even when a
            reader asks for their own data to be erased (their reading data goes; the evidence stays).
          </li>
        </ul>
      </Card>
    </div>
  );
}
