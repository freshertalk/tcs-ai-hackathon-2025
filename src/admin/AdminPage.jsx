// src/admin/AdminPage.jsx
// The admin dashboard: analytics, readers, coupons, the audit log, comment
// moderation, and the admin team.
//
// This screen only decides what to show. Every request it makes is checked
// again by the collector against the verified e-mail, so opening this page as
// anyone else shows an empty frame and a refusal.

import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Nav from "../components/site/Nav";
import Footer from "../components/site/Footer";
import usePrivatePage from "../components/site/usePrivatePage";
import LoginScreen from "../auth/LoginScreen";
import { useAuth } from "../auth/google";
import { useMe } from "../account/me";
import { BOOK, REVIEWS } from "../data/books";
import { AdminPanel } from "../reviews/Reviews";
import { Failure, Loading, Tabs } from "./ui";
import { explain } from "../api/collector";
import Overview from "./Overview";
import Readers from "./Readers";
import Coupons from "./Coupons";
import Sales from "./Sales";
import Audit from "./Audit";
import System from "./System";
import { IconAlert, IconChart, IconList, IconReceipt, IconShield, IconStar, IconTag, IconUsers, IconSignOut } from "../components/ui/icons";

const NAV = [
  { to: "/", label: "मुखपृष्ठ" },
  { to: "/library", label: "रचनाएँ" },
  { to: "/account", label: "मेरा खाता" },
];

const TABS = [
  { id: "overview", label: "Analytics", icon: <IconChart size={17} /> },
  { id: "readers", label: "Readers", icon: <IconUsers size={17} /> },
  { id: "sales", label: "Sales", icon: <IconReceipt size={17} /> },
  { id: "coupons", label: "Coupons", icon: <IconTag size={17} /> },
  { id: "audit", label: "Audit log", icon: <IconList size={17} /> },
  { id: "reviews", label: "Comments", icon: <IconStar size={17} /> },
  { id: "system", label: "Team & system", icon: <IconShield size={17} /> },
];

/**
 * The admin account is right but the dashboard cannot open: the commonest cause
 * is that the script on Google (which keeps the Sheet) is still an older build
 * than this site, so it does not know the new actions. Ask it, and say so.
 */
function ScriptNotice({ error, onRetry, email }) {
  const [state, setState] = useState("checking"); // checking | old | ok | unknown

  useEffect(() => {
    let live = true;
    if (!REVIEWS.endpoint) {
      setState("unknown");
      return undefined;
    }
    const sep = REVIEWS.endpoint.includes("?") ? "&" : "?";
    fetch(`${REVIEWS.endpoint}${sep}check=1`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => live && setState(d && d.analytics && d.shop ? "ok" : "old"))
      .catch(() => live && setState("unknown"));
    return () => {
      live = false;
    };
  }, []);

  if (state === "checking") return <Loading label="Checking the script…" />;
  if (state !== "old") return <Failure error={error} text={explain(error)} onRetry={onRetry} />;

  return (
    <div className="deny deny--wide">
      <IconAlert size={34} />
      <h1>The script on Google is older than this site</h1>
      <p>
        You are signed in as <b>{email}</b>, the admin account. The dashboard cannot open because the script that
        keeps your Sheet does not know the new actions yet (statistics, coupons, audit log, sales).
      </p>
      <ol className="deny__steps">
        <li>In your Sheet: Extensions → Apps Script.</li>
        <li>
          Replace the code with the newest <code>scripts/reviews-apps-script.gs</code> and press Ctrl+S.
        </li>
        <li>Deploy → Manage deployments → ✏ → Version: <b>New version</b> → Deploy.</li>
        <li>Reload this page.</li>
      </ol>
      <div className="deny__act">
        <button type="button" className="db db--solid" onClick={() => window.location.reload()}>
          I have deployed it — reload
        </button>
      </div>
    </div>
  );
}

const fromHash = () => {
  const h = (typeof window !== "undefined" && window.location.hash.replace("#", "")) || "";
  return TABS.some((t) => t.id === h) ? h : "overview";
};

export default function AdminPage() {
  usePrivatePage("Admin");
  const { user, signOut } = useAuth();
  const { me, status, error, isAdmin, reload } = useMe();
  const [tab, setTab] = useState(fromHash);

  useEffect(() => {
    const on = () => setTab(fromHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  const go = (id) => {
    setTab(id);
    window.history.replaceState(null, "", `#${id}`);
  };

  const frame = (children) => (
    <div data-theme="write" className="dsh">
      <Nav links={NAV} kicker="एडमिन" />
      <main className="dsh__main">{children}</main>
      <Footer note="Admin" />
    </div>
  );

  if (!user) return <LoginScreen reason="admin" />;

  if (status === "loading" || (status === "idle" && !me)) {
    return frame(
      <div className="shell">
        <Loading label="Checking your access…" />
      </div>
    );
  }

  if (status === "error" && !me) {
    return frame(
      <div className="shell">
        <ScriptNotice error={error} onRetry={reload} email={user.email} />
      </div>
    );
  }

  if (!isAdmin) {
    return frame(
      <div className="shell">
        <div className="deny">
          <IconShield size={34} />
          <h1 className="hi-d">यह पन्ना एडमिन के लिए है</h1>
          <p className="hi">
            आप <b>{user.email}</b> से साइन इन हैं, और इस खाते को एडमिन का अधिकार नहीं है।
          </p>
          <div className="deny__act">
            <Link className="db db--solid" to="/account">
              मेरा खाता
            </Link>
            <button type="button" className="db db--ghost" onClick={signOut}>
              <IconSignOut size={16} /> दूसरे खाते से साइन इन
            </button>
          </div>
        </div>
      </div>
    );
  }

  const badge = undefined;

  return frame(
    <div className="shell">
      <header className="dsh__head">
        <div>
          <p className="dsh__eyebrow">दो कुल्हड़ चाय · Admin</p>
          <h1 className="dsh__t">Dashboard</h1>
          <p className="dsh__sub">
            {me.owner ? "Owner" : "Admin"} · {user.email}
          </p>
        </div>
      </header>

      <Tabs value={tab} onChange={go} label="Admin sections" tabs={TABS.map((t) => ({ ...t, badge: t.id === "reviews" ? badge : undefined }))} />

      <div className="dsh__body" role="tabpanel">
        {tab === "overview" && <Overview />}
        {tab === "readers" && <Readers />}
        {tab === "sales" && <Sales />}
        {tab === "coupons" && <Coupons />}
        {tab === "audit" && <Audit />}
        {tab === "reviews" && (
          <div className="rvmod">
            <AdminPanel slug={BOOK.slug} />
          </div>
        )}
        {tab === "system" && <System />}
      </div>
    </div>
  );
}
