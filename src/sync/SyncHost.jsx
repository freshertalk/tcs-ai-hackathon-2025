// src/sync/SyncHost.jsx
// Mounted once for the whole site: starts the cross-device sync when a reader
// is signed in, and stops it when they sign out. Renders nothing.

import { useEffect } from "react";
import { useAuth } from "../auth/google";
import { startSync, stopSync } from "./sync";

export default function SyncHost() {
  const { user } = useAuth();
  const email = user ? user.email : "";

  useEffect(() => {
    if (email) startSync();
    else stopSync();
    return undefined;
  }, [email]);

  return null;
}
