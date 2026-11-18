import React from "react";
import { useLive } from "./live";

const WORD = { live: "Live", idle: "Connecting", connecting: "Connecting", reconnecting: "Reconnecting", offline: "Offline" };
const TONE = { live: "ok", idle: "warn", connecting: "warn", reconnecting: "warn", offline: "down" };
const TIP = {
  live: "Live: every change on the server — a forecast, an order, a setting, a status — appears on every open page at once, with no refresh.",
  idle: "Connecting to the live channel…",
  connecting: "Connecting to the live channel…",
  reconnecting: "The live connection dropped and is reconnecting. Pages still refresh by themselves every few seconds, and catch up the moment it is back.",
  offline: "No live connection (you are offline, or the server is restarting). Pages keep refreshing on their own timers and catch up as soon as it returns.",
};

/** The state of the live channel, in the header: green "Live", amber while it reconnects, red when it cannot. */
export default function LiveBadge() {
  const { status } = useLive();
  return (
    <span className={`live-badge is-${TONE[status] || "warn"}`} role="status" aria-label={`${WORD[status] || "Connecting"}. ${TIP[status] || ""}`} data-tip={TIP[status]}>
      <i aria-hidden="true" />
      <span className="live-badge__t">{WORD[status] || "Connecting"}</span>
    </span>
  );
}
