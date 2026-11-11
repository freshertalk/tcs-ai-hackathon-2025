import React from "react";
import { useSearchParams } from "react-router-dom";
import { Alert } from "./ui";
import { IconGoogle } from "./icons";

const ERRORS = {
  denied: "Google sign-in was cancelled.",
  state: "That sign-in attempt expired or did not match. Please try again.",
  google: "Google could not complete the sign-in. Please try again.",
  unverified: "That Google account's email address is not verified.",
  unauthorized: "That Google account does not have access to this area.",
  "not-configured": "Google sign-in has not been set up yet.",
};

export default function Login() {
  const [params] = useSearchParams();
  const error = ERRORS[params.get("error")];

  return (
    <main className="adm-center">
      <section className="adm-card adm-card--login">
        <p className="adm-eyebrow">Private area</p>
        <h1>Vinay&rsquo;s control room</h1>
        <p className="adm-lead">
          This is a very personal setup and is not for public use. Sign in with an authorised
          Google account to continue.
        </p>

        <Alert>{error}</Alert>

        {/* a normal link, not fetch(): the browser has to follow Google's redirects */}
        <a className="adm-google" href="/api/auth/google/start">
          <IconGoogle />
          <span>Login with Google</span>
        </a>

        <p className="adm-small">
          Only the owner and the admins the owner has added can sign in. Having a Google account is
          not enough.
        </p>
      </section>
    </main>
  );
}
