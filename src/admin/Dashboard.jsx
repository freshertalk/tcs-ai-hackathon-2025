import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "./api";
import { useAuth } from "./auth";
import { adminPath } from "./paths";
import Shell from "./Shell";
import { IconArrow, IconChart, IconGlobe, IconKey, IconShield, IconUsers } from "./icons";

/** The strip across the very top of the dashboard — and only the dashboard. */
function Notice() {
  return (
    <div className="adm-notice" role="note">
      <div className="adm-wrap adm-notice__row">
        <span className="adm-notice__tag">Private notice</span>
        <p>
          This is a very personal setup of <b>Vinay Kumar Tiwari</b> and is not at all for public
          use.
        </p>
      </div>
    </div>
  );
}

function Tile({ to, href, external, icon, title, text, status }) {
  const inner = (
    <>
      <span className="adm-ico">{icon}</span>
      <span className="adm-tile__body">
        <span className="adm-tile__t">{title}</span>
        <span className="adm-tile__d">{text}</span>
        {status && <span className={`adm-tile__s ${status.on ? "is-on" : ""}`}>{status.label}</span>}
      </span>
      {external && (
        <span className="adm-tile__go" aria-hidden="true">
          <IconArrow />
        </span>
      )}
    </>
  );
  return external ? (
    <a className="adm-tile" href={href} target="_blank" rel="noopener noreferrer">
      {inner}
      <span className="adm-sr">(opens in a new tab)</span>
    </a>
  ) : (
    <Link className="adm-tile" to={to}>
      {inner}
    </Link>
  );
}

function Category({ title, text, children }) {
  return (
    <section className="adm-cat">
      <header>
        <h3>{title}</h3>
        <p>{text}</p>
      </header>
      <div className="adm-tiles">{children}</div>
    </section>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [s, setS] = useState(null);

  // only to show a status line on two tiles; the dashboard works without it
  useEffect(() => {
    api("/api/admin/settings")
      .then(setS)
      .catch(() => {});
  }, []);

  const isSuper = user.role === "superadmin";

  return (
    <Shell notice={<Notice />}>
      {/* ------------------------------------------------ top: the personal tile */}
      <section className="adm-personal" aria-labelledby="personal-h">
        <a className="adm-personal__tile" href={adminPath("/personal-access")} target="_blank" rel="noopener noreferrer">
          <span className="adm-ico adm-ico--lg">
            <IconShield />
          </span>
          <span className="adm-personal__body">
            <span className="adm-personal__k">Private</span>
            <span className="adm-personal__t" id="personal-h">
              Vinay&rsquo;s Personal Access
            </span>
          </span>
          <span className="adm-tile__go" aria-hidden="true">
            <IconArrow />
          </span>
          <span className="adm-sr">(opens in a new tab)</span>
        </a>
        <p className="adm-note">
          <em>(not for public uses, only private access for Vinay and his family)</em>
        </p>
      </section>

      {/* ------------------------------------------- bottom: website management */}
      <div className="adm-sep" role="separator">
        <span>Website management</span>
      </div>

      <Category
        title="Access & security"
        text="Decide who can sign in to this area, and how. Changes take effect on the next sign-in."
      >
        <Tile
          to={adminPath("/google")}
          icon={<IconKey />}
          title="Google sign-in"
          text="Client ID and Client Secret used by Login with Google."
          status={s && { on: s.googleSecretSet, label: s.googleSecretSet ? "Connected" : "Not set up" }}
        />
        {isSuper && (
          <Tile
            to={adminPath("/admins")}
            icon={<IconUsers />}
            title="Admin users"
            text="Add or remove the people who can open this area. Superadmin only."
          />
        )}
      </Category>

      <Category
        title="Analytics & tracking"
        text="See how the public website is used. Local development and admin visits are never counted."
      >
        <Tile
          to={adminPath("/analytics")}
          icon={<IconChart />}
          title="Google Analytics"
          text="Set the GA4 measurement ID for the public site."
          status={
            s && {
              on: Boolean(s.gaMeasurementId),
              label: s.gaMeasurementId ? `On · ${s.gaMeasurementId}` : "Off",
            }
          }
        />
      </Category>

      <Category title="Public website" text="The site everyone else sees.">
        <Tile
          external
          href="/"
          icon={<IconGlobe />}
          title="Open the website"
          text="vinaytiwari.org in a new tab."
        />
      </Category>
    </Shell>
  );
}
