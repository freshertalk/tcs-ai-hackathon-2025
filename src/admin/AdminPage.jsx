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
import { BOOK } from "../data/books";
import { AdminPanel } from "../reviews/Reviews";
import { Failure, Loading, Tabs } from "./ui";
import { explain } from "../api/collector";
import Overview from "./Overview";
import Readers from "./Readers";
import Coupons from "./Coupons";
import Audit from "./Audit";
import System from "./System";
import { IconChart, IconList, IconShield, IconStar, IconTag, IconUsers, IconSignOut } from "../components/ui/icons";

const NAV = [
  { to: "/", label: "मुखपृष्ठ" },
  { to: "/library", label: "रचनाएँ" },
  { to: "/account", label: "मेरा खाता" },
];

const TABS = [
  { id: "overview", label: "Analytics", icon: <IconChart size={17} /> },
  { id: "readers", label: "Readers", icon: <IconUsers size={17} /> },
  { id: "coupons", label: "Coupons", icon: <IconTag size={17} /> },
  { id: "audit", label: "Audit log", icon: <IconList size={17} /> },
  { id: "reviews", label: "Comments", icon: <IconStar size={17} /> },
  { id: "system", label: "Team & system", icon: <IconShield size={17} /> },
];

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
        <Failure error={error} text={explain(error)} onRetry={reload} />
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
          <p className="dsh__eyebrow">कुल्हड़ प्रकाशन · Admin</p>
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
