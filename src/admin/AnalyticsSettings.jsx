import React, { useEffect, useState } from "react";
import { api } from "./api";
import Shell from "./Shell";
import { Alert, Field, Loading } from "./ui";

export default function AnalyticsSettings() {
  const [loaded, setLoaded] = useState(false);
  const [id, setId] = useState("");
  const [saved, setSaved] = useState("");
  const [msg, setMsg] = useState({ kind: "", text: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api("/api/admin/settings")
      .then((d) => {
        setId(d.gaMeasurementId);
        setSaved(d.gaMeasurementId);
        setLoaded(true);
      })
      .catch((e) => setMsg({ kind: "error", text: e.message }));
  }, []);

  const save = async (next) => {
    setBusy(true);
    setMsg({ kind: "", text: "" });
    try {
      const r = await api("/api/admin/settings/analytics", {
        method: "PUT",
        body: { gaMeasurementId: next },
      });
      setId(r.gaMeasurementId);
      setSaved(r.gaMeasurementId);
      setMsg({
        kind: "ok",
        text: r.gaMeasurementId ? "Saved. Analytics is on for the live site." : "Analytics is switched off.",
      });
    } catch (err) {
      setMsg({ kind: "error", text: err.message });
    }
    setBusy(false);
  };

  return (
    <Shell crumb="Google Analytics" narrow>
      <h1 className="adm-h1">Google Analytics</h1>
      <p className="adm-lead">
        Paste the GA4 measurement ID and the public website starts reporting page views. No redeploy
        needed.
      </p>

      {!loaded && !msg.text && <Loading />}
      {loaded && (
        <>
          <form
            className="adm-card adm-form"
            onSubmit={(e) => {
              e.preventDefault();
              save(id.trim());
            }}
          >
            <p className="adm-status">
              <i className={saved ? "is-on" : ""} aria-hidden="true" />
              {saved ? (
                <>
                  On — <code>{saved}</code>
                </>
              ) : (
                "Off — no tag is set"
              )}
            </p>
            <Field id="ga" label="Measurement ID" hint="Looks like G-XXXXXXXXXX (Admin → Data streams → Web).">
              <input
                id="ga"
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder="G-XXXXXXXXXX"
                spellCheck="false"
              />
            </Field>
            <Alert kind={msg.kind === "ok" ? "ok" : "error"}>{msg.text}</Alert>
            <div className="adm-actions">
              <button className="adm-btn adm-btn--solid" disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </button>
              {saved && (
                <button type="button" className="adm-btn adm-btn--ghost" disabled={busy} onClick={() => save("")}>
                  Switch off
                </button>
              )}
            </div>
          </form>

          <section className="adm-card">
            <h2>What is never counted</h2>
            <ul className="adm-list">
              <li>
                <b>Your own development runs</b> — <code>npm start</code>, <code>localhost</code>,{" "}
                <code>127.0.0.1</code> and home-network addresses (192.168.x.x, 10.x.x.x).
              </li>
              <li>
                <b>This private area</b> — no analytics script is loaded on{" "}
                <code>/vinay-personal-tasks</code>.
              </li>
              <li>
                <b>Signed-in admins</b> — when you are signed in and browse the live site, your visits
                are left out too.
              </li>
            </ul>
          </section>
        </>
      )}
      {!loaded && msg.text && <Alert>{msg.text}</Alert>}
    </Shell>
  );
}
