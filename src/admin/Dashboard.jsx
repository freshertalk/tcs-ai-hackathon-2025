import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "./api";
import { useAuth } from "./auth";
import { adminPath } from "./paths";
import Shell from "./Shell";
import Welcome from "./Welcome";
import { IconArrow, IconChart, IconClock, IconGlobe, IconKey, IconShield, IconUsers } from "./icons";

/** The strip across the very top of the dashboard — and only the dashboard. */
function Notice() {
  return (
    <div className="adm-notice" role="note">
      <div className="adm-wrap adm-notice__row">
        <span className="adm-notice__tag">Private notice</span>
        <p>
          This is a very personal setup of <b>Vinay Kumar Tiwari</b> and is not at all for public use.
        </p>
      </div>
    </div>
  );
}

function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 5) return "Working late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 22) return "Good evening";
  return "Good night";
}

function firstName(user) {
  const raw = (user.name || user.email.split("@")[0] || "").trim().split(/[\s._-]+/)[0] || "there";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** A large tile at the top of the dashboard. Both open in their own tab. */
function Feature({ href, icon, kicker, title, text, tone, tip }) {
  return (
    <a className={`dash-feature dash-feature--${tone}`} href={href} target="_blank" rel="noopener noreferrer" data-tip={tip}>
      <span className="dash-feature__ico">{icon}</span>
      <span className="dash-feature__body">
        <span className="dash-feature__k">{kicker}</span>
        <span className="dash-feature__t">{title}</span>
        {text && <span className="dash-feature__d">{text}</span>}
      </span>
      <span className="dash-feature__go" aria-hidden="true">
        <IconArrow />
      </span>
      <span className="adm-sr">(opens in a new tab)</span>
    </a>
  );
}

function Tile({ to, href, external, icon, title, text, status, tip }) {
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
    <a className="adm-tile" href={href} target="_blank" rel="noopener noreferrer" data-tip={tip}>
      {inner}
      <span className="adm-sr">(opens in a new tab)</span>
    </a>
  ) : (
    <Link className="adm-tile" to={to} data-tip={tip}>
      {inner}
    </Link>
  );
}

function Category({ title, text, children }) {
  return (
    <section className="dash-cat">
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

  // The welcome opens every time the dashboard does: after signing in, on a refresh, in a
  // new tab, and on coming back here from a settings page. It closes by itself.
  const [welcome, setWelcome] = useState(true);

  // only feeds the status chips and tile badges; the dashboard works without it
  useEffect(() => {
    api("/api/admin/settings")
      .then(setS)
      .catch(() => {});
  }, []);

  // the AI strategist is optional; its badge shows whether a key is set
  const [ai, setAi] = useState(null);
  useEffect(() => {
    api("/api/admin/ai/status")
      .then(setAi)
      .catch(() => {});
  }, []);

  const isSuper = user.role === "superadmin";
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <Shell notice={<Notice />}>
      {welcome && <Welcome onDone={() => setWelcome(false)} />}
      <div className="dash">
        {/* ------------------------------------------------------------- hello */}
        <section className="dash-hello" aria-label="Welcome">
          <div>
            <p className="dash-hello__k">{greeting()}</p>
            <h1>Namaste, {firstName(user)}</h1>
            <p className="dash-hello__d">{today}</p>
            <button type="button" className="dash-om" lang="hi" aria-label="Show the welcome again" data-tip="Show the welcome picture and play the mantra once more." onClick={() => setWelcome(true)}>
              ॐ
            </button>
          </div>
          <ul className="dash-chips" aria-label="Status">
            <li className={s && s.googleSecretSet ? "is-on" : ""} data-tip="Whether Google sign-in has its Client ID and Client Secret. Without them nobody can sign in.">
              <i aria-hidden="true" />
              Google sign-in {s ? (s.googleSecretSet ? "connected" : "not set up") : "…"}
            </li>
            <li className={s && s.gaMeasurementId ? "is-on" : ""} data-tip="Whether Google Analytics is counting visits to the public website. Your own visits are never counted.">
              <i aria-hidden="true" />
              Analytics {s ? (s.gaMeasurementId ? "on" : "off") : "…"}
            </li>
            <li className={`is-role is-${user.role}`} data-tip="Your role here. A superadmin can also add and remove the admins.">
              {isSuper ? "Superadmin" : "Admin"}
            </li>
          </ul>
        </section>

        {/* --------------------------------------------------- top: quick access */}
        <section className="dash-quick" aria-label="Quick access">
          <div>
            <Feature
              tone="blue"
              href={adminPath("/personal-access")}
              icon={<IconShield />}
              kicker="Private"
              title="Vinay’s Personal Access"
              tip="Opens the private page for Vinay and his family, in a new tab."
            />
            <p className="adm-note">
              <em>(not for public uses, only private access for Vinay and his family)</em>
            </p>
          </div>
          <div>
            <Feature
              tone="night"
              href={adminPath("/stock-report")}
              icon={<IconClock />}
              kicker="Markets"
              title="Stock Report"
              text="Trading terminal · positions · research · holidays"
              tip="Opens the trading terminal in a new tab: the desk, your positions and orders, research, the screener, the day debrief and the market calendar."
            />
          </div>
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
            tip="Enter or replace the Google credentials that the sign-in button uses."
            status={s && { on: s.googleSecretSet, label: s.googleSecretSet ? "Connected" : "Not set up" }}
          />
          {isSuper && (
            <Tile
              to={adminPath("/admins")}
              icon={<IconUsers />}
              title="Admin users"
              text="Add or remove the people who can open this area. Superadmin only."
              tip="Choose which Google accounts may sign in here."
            />
          )}
        </Category>

        <Category title="Trading desk" text="Optional extras for the Stock Report. The desk works without them.">
          <Tile
            to={adminPath("/ai")}
            icon={<IconChart />}
            title="AI strategist"
            text="Anthropic API key and model. Builds a strategy on request; never places an order."
            tip="Set the Anthropic API key, choose the model, and set the live co-pilot’s limits."
            status={ai && { on: ai.configured, label: ai.configured ? `On · ${(ai.models.find((m) => m.id === ai.model) || {}).name || ai.model}` : "Off — no key" }}
          />
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
            tip="Turn visit counting on or off for the public website."
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
            tip="See the public website as a visitor does."
          />
        </Category>
      </div>
    </Shell>
  );
}
