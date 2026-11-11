import React, { useEffect, useState } from "react";
import { api } from "./api";
import Shell from "./Shell";
import { Alert, CopyBox, Field, Loading } from "./ui";

export default function GoogleSettings() {
  const [s, setS] = useState(null);
  const [id, setId] = useState("");
  const [secret, setSecret] = useState("");
  const [msg, setMsg] = useState({ kind: "", text: "" });
  const [busy, setBusy] = useState(false);
  const redirect = `${window.location.origin}/api/auth/google/callback`;

  useEffect(() => {
    api("/api/admin/settings")
      .then((d) => {
        setS(d);
        setId(d.googleClientId);
      })
      .catch((e) => setMsg({ kind: "error", text: e.message }));
  }, []);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMsg({ kind: "", text: "" });
    try {
      await api("/api/admin/settings/google", {
        method: "PUT",
        body: { googleClientId: id.trim(), googleClientSecret: secret.trim() },
      });
      setSecret("");
      setS({ ...s, googleClientId: id.trim(), googleSecretSet: true, googleSource: "database" });
      setMsg({ kind: "ok", text: "Saved. The next sign-in uses the new credentials." });
    } catch (err) {
      setMsg({ kind: "error", text: err.message });
    }
    setBusy(false);
  };

  return (
    <Shell crumb="Google sign-in" narrow>
      <h1 className="adm-h1">Google sign-in</h1>
      <p className="adm-lead">
        The credentials behind <b>Login with Google</b>. The secret is stored encrypted on the
        server and is never shown again after you save it.
      </p>

      {!s && !msg.text && <Loading />}
      {s && (
        <>
          <section className="adm-card">
            <h2>Authorized redirect URI</h2>
            <p className="adm-small">
              Register this exact address in Google Cloud Console for your OAuth client. Add one per
              address you use (for example <code>localhost</code> for testing and your live domain).
            </p>
            <CopyBox value={redirect} />
          </section>

          <form className="adm-card adm-form" onSubmit={save} autoComplete="off">
            <h2>Credentials</h2>
            {s.googleSource === "environment" && (
              <Alert kind="info">
                These values currently come from server environment variables. Saving here overrides
                them.
              </Alert>
            )}
            <Field id="gid" label="Client ID">
              <input id="gid" value={id} onChange={(e) => setId(e.target.value)} required spellCheck="false" />
            </Field>
            <Field
              id="gsec"
              label="Client Secret"
              hint={
                s.googleSecretSet
                  ? "A secret is saved. Leave this blank to keep it, or type a new one to replace it."
                  : "Required."
              }
            >
              <input
                id="gsec"
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder={s.googleSecretSet ? "•••••••••••• (saved)" : ""}
                required={!s.googleSecretSet}
                spellCheck="false"
                autoComplete="new-password"
              />
            </Field>
            <Alert kind={msg.kind === "ok" ? "ok" : "error"}>{msg.text}</Alert>
            <div>
              <button className="adm-btn adm-btn--solid" disabled={busy}>
                {busy ? "Saving…" : "Save credentials"}
              </button>
            </div>
          </form>
        </>
      )}
      {!s && msg.text && <Alert>{msg.text}</Alert>}
    </Shell>
  );
}
