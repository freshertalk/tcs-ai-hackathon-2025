// src/analytics/TrackerHost.jsx
// Mounted once. Tells the tracker which page the visitor is on, and nudges it
// when something changes the rules (a cookie choice, a sign-in).

import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../auth/google";
import { useCookieChoice } from "../legal/consent";
import { flush, startTracker, trackView } from "./tracker";

export default function TrackerHost() {
  const { pathname } = useLocation();
  const choice = useCookieChoice();
  const { user } = useAuth();
  const who = user ? user.email : "";

  useEffect(() => startTracker(), []);

  useEffect(() => {
    trackView(pathname);
  }, [pathname]);

  // a choice was just made, or someone signed in: whatever was waiting can go
  useEffect(() => {
    const t = setTimeout(() => flush(), 1500);
    return () => clearTimeout(t);
  }, [choice, who]);

  return null;
}
