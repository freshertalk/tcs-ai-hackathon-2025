// src/legal/CookieNotice.jsx
// Shown on a visitor's first visit (and again whenever the documents change
// edition). It does not block reading the site; it asks for a recorded
// choice and points to the Privacy Policy, Terms of Use and Refund Policy.

import React from "react";
import { Link } from "react-router-dom";
import { saveCookieChoice, useCookieChoice } from "./consent";

export default function CookieNotice() {
  const choice = useCookieChoice();
  if (choice) return null;

  return (
    <section className="ck" role="dialog" aria-live="polite" aria-label="Cookies and privacy" lang="en">
      <p className="ck__t">
        <b>Cookies and privacy.</b> This website uses cookies and browser storage that are necessary for it to
        work — for your reading preferences, your place in the book and your sign-in — and Google’s sign-in
        service sets its own cookies. If you press “Accept”, we also keep anonymous usage statistics (pages
        opened and time spent, under a random id); “Necessary only” counts page views and nothing more. We do
        not use advertising cookies. By continuing you agree to our{" "}
        <Link to="/privacy">Privacy Policy</Link>, <Link to="/terms">Terms of Use</Link> and{" "}
        <Link to="/refund">Refund Policy</Link>. Signing in requires your express acceptance of them.
      </p>
      <div className="ck__act">
        <button type="button" className="ck__b ck__b--ok" onClick={() => saveCookieChoice("all")}>
          Accept
        </button>
        <button type="button" className="ck__b" onClick={() => saveCookieChoice("necessary")}>
          Necessary only
        </button>
      </div>
    </section>
  );
}
