// The door to the private area. It says plainly, and politely, that this is a personal space;
// no address or name of an account is shown, and having a Google account is not enough.

import React from "react";
import { useSearchParams } from "react-router-dom";
import { IconGoogle, IconShield } from "./icons";

const ERRORS = {
  denied: "The Google sign-in was cancelled. You may try again whenever you wish.",
  state: "That sign-in attempt expired or did not match. Please try once more.",
  google: "Google could not complete the sign-in. Please try once more.",
  unverified: "That Google account does not have a verified email address.",
  unauthorized: "Thank you for your interest — this account does not have access to this area.",
  "not-configured": "Sign-in has not been set up yet.",
};

export default function Login() {
  const [params] = useSearchParams();
  const error = ERRORS[params.get("error")];

  return (
    <main className="gate">
      <section className="gate__panel" aria-labelledby="gate-title">
        <span className="gate__badge" aria-hidden="true">
          <IconShield />
        </span>
        <p className="gate__kicker">Private area</p>
        <h1 id="gate-title">Vinay&rsquo;s control room</h1>

        <div className="gate__notice" role="note">
          <p>
            Namaste, and thank you for visiting. This area is a personal workspace of <b>Vinay Kumar Tiwari</b>. It is
            not a public service and is not intended for visitors.
          </p>
          <p>
            If you have reached this page by chance, we kindly request that you do not attempt to enter. You are most
            welcome on the public website instead.
          </p>
        </div>

        {error && (
          <p className="gate__error" role="alert">
            {error}
          </p>
        )}

        {/* a normal link, not fetch(): the browser has to follow Google's redirects */}
        <a className="gate__google" href="/api/auth/google/start">
          <IconGoogle />
          <span>Sign in with Google</span>
        </a>
        <p className="gate__fine">Only accounts authorised by the owner can sign in. Every attempt is checked by the server.</p>

        <a className="gate__home" href="/">
          ← Go to the public website
        </a>
      </section>
    </main>
  );
}
