import React from "react";
import { adminPath } from "./paths";
import Shell from "./Shell";
import { IconShield } from "./icons";

/**
 * Opens in its own tab from the dashboard. Deliberately empty for now: the
 * page exists, is behind the same sign-in, and is waiting for its content.
 */
export default function PersonalAccess() {
  return (
    <Shell crumb="Vinay’s Personal Access" narrow>
      <section className="adm-card adm-card--place">
        <span className="adm-ico adm-ico--lg">
          <IconShield />
        </span>
        <h1 className="adm-h1">Vinay&rsquo;s Personal Access</h1>
        <p className="adm-note">
          <em>(not for public uses, only private access for Vinay and his family)</em>
        </p>
        <p className="adm-lead">Nothing here yet. This page is ready and waiting for what comes next.</p>
        <p>
          <a className="adm-btn adm-btn--ghost" href={adminPath()}>
            Back to the dashboard
          </a>
        </p>
      </section>
    </Shell>
  );
}
