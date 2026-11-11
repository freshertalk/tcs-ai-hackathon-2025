import React, { useState } from "react";
import { api } from "./api";
import { Alert, CopyBox, Field } from "./ui";

/** First run only: save Google credentials using the one-time token from the server console. */
export default function Setup() {
  const [f, setF] = useState({ token: "", id: "", secret: "", ga: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const redirect = `${window.location.origin}/api/auth/google/callback`;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/setup", {
        method: "POST",
        body: {
          token: f.token.trim(),
          googleClientId: f.id.trim(),
          googleClientSecret: f.secret.trim(),
          gaMeasurementId: f.ga.trim(),
        },
      });
      window.location.reload(); // status now says "configured" → the login screen
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <main className="adm-center">
      <section className="adm-card adm-card--wide">
        <p className="adm-eyebrow">First-time setup</p>
        <h1>Connect Google sign-in</h1>
        <p className="adm-lead">
          Nobody can sign in until this is done. You will only see this screen once.
        </p>

        <ol className="adm-steps">
          <li>
            In <b>Google Cloud Console → APIs &amp; Services → Credentials</b>, create an{" "}
            <b>OAuth client ID</b> of type <b>Web application</b>.
          </li>
          <li>
            Under <b>Authorized redirect URIs</b> add exactly:
            <CopyBox value={redirect} />
          </li>
          <li>
            Paste the Client ID and Client Secret below, with the one-time setup token printed in
            the terminal where the server started.
          </li>
        </ol>

        <form onSubmit={submit} className="adm-form" autoComplete="off">
          <Field id="tok" label="Setup token" hint="Printed in the server console when it started.">
            <input id="tok" value={f.token} onChange={set("token")} required spellCheck="false" />
          </Field>
          <Field id="cid" label="Google Client ID">
            <input
              id="cid"
              value={f.id}
              onChange={set("id")}
              required
              spellCheck="false"
              placeholder="1234567890-abc….apps.googleusercontent.com"
            />
          </Field>
          <Field id="csec" label="Google Client Secret">
            <input
              id="csec"
              type="password"
              value={f.secret}
              onChange={set("secret")}
              required
              spellCheck="false"
              autoComplete="new-password"
            />
          </Field>
          <Field
            id="ga"
            label="Google Analytics measurement ID (optional)"
            hint="Looks like G-XXXXXXXXXX. You can set or change it later."
          >
            <input id="ga" value={f.ga} onChange={set("ga")} spellCheck="false" placeholder="G-XXXXXXXXXX" />
          </Field>
          <Alert>{error}</Alert>
          <button className="adm-btn adm-btn--solid" disabled={busy}>
            {busy ? "Saving…" : "Save and continue"}
          </button>
        </form>
      </section>
    </main>
  );
}
