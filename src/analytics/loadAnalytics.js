// Google Analytics for the PUBLIC site — and only there.
//
// Never counted:
//   • a local run (npm start, localhost, 127.0.0.1, LAN addresses, *.local)
//   • anything outside a production build
//   • the private admin area
//   • a signed-in admin browsing the live site (the server leaves the ID out)
//
// The measurement ID is not baked into the bundle: it is set from the admin
// panel and fetched from /api/public-config, so changing it needs no redeploy.
// If that endpoint is unreachable (a static-only host), nothing loads.

import { isAdminPath } from "../admin/paths";

const GA_ID = /^G-[A-Z0-9]{4,20}$/;

export function isLocalEnvironment(host = window.location.hostname) {
  const h = String(host).toLowerCase();
  if (["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0", ""].includes(h)) return true;
  if (h.endsWith(".localhost") || h.endsWith(".local")) return true;
  const m = h.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

export async function loadAnalytics() {
  if (typeof window === "undefined") return;
  if (process.env.NODE_ENV !== "production") return;
  if (isLocalEnvironment() || isAdminPath(window.location.pathname)) return;
  if (window.__gaLoaded) return;

  try {
    const res = await fetch("/api/public-config", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return;
    const { ga } = await res.json();
    if (typeof ga !== "string" || !GA_ID.test(ga) || window.__gaLoaded) return;

    window.__gaLoaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() {
      window.dataLayer.push(arguments); // gtag.js requires `arguments`, not a rest array
    };
    window.gtag("js", new Date());
    window.gtag("config", ga);

    const s = document.createElement("script");
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga)}`;
    document.head.appendChild(s);
  } catch (_) {
    /* analytics must never break the page */
  }
}
