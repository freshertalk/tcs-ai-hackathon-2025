// The autopilot's order PROPOSALS: the trade, its size, its stop, its reasons — and a Review button that opens the order ticket
// ready-filled. Nothing here sends an order: the ticket (with its own checks, and the trading switch) is where that happens.

import React, { useState } from "react";
import { api } from "../../api";
import { useTrade } from "../trade/TradeContext";
import { inr, isNum, when } from "../analyzer/format";

const enc = encodeURIComponent;
const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
const HOW = { target: "reached target 1", stop: "hit the stop", time: "closed out at 3:15 PM" };

export function outcomeText(p) {
  if (!p.outcome) return "";
  const r = p.outcome.r;
  return `${HOW[p.outcome.how] || p.outcome.how}: ${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r).toFixed(2)}R after costs`;
}

/** A proposal's state in a word. */
export function stateOf(p, now = Date.now()) {
  if (p.status === "blocked") return { id: "blocked", text: "Refused by the risk gate" };
  if (p.outcome) return { id: p.outcome.r > 0 ? "won" : "lost", text: outcomeText(p) };
  if (p.response && p.response.action === "ignored") return { id: "ignored", text: "Ignored" };
  if (Date.parse(p.expiresAt) < now) return { id: "stale", text: "Past its 30 minutes — the price has moved on" };
  if (p.response && p.response.action === "opened") return { id: "opened", text: "Ticket opened" };
  return { id: "new", text: "New" };
}

export function ProposalCard({ p, onChanged, now = Date.now() }) {
  const trade = useTrade();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const st = stateOf(p, now);
  const live = st.id === "new" || st.id === "opened";
  const decide = async (action) => {
    setBusy(true);
    setErr("");
    try {
      await api(`/api/admin/autopilot/proposals/${enc(p.id)}/${action}`, { method: "POST", body: {} });
      if (onChanged) onChanged();
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  };
  const review = async () => {
    if (!trade || !p.ticket) return;
    trade.openTicket({ ...p.ticket, note: `Autopilot · ${p.label} · risk ${inr(p.riskRs, 0)} · stop ${inr(p.stop)} · target ${inr(p.targets[0])}` });
    decide("opened");
  };
  const off = !trade || !trade.enabled || !trade.connected;
  const why = !trade ? "Placing orders is for the owner." : !trade.connected ? "Zerodha is not connected." : !trade.enabled ? "Trading is switched OFF (Positions & orders). You can still read the proposal." : "Open the order ticket with this trade filled in. Nothing is sent until you place it there.";
  return (
    <li className={`apx-prop is-${st.id}`}>
      <div className="apx-prop__top">
        <b className={p.side === "long" ? "is-up" : "is-down"}>{p.side === "long" ? "BUY" : "SELL"}</b>
        <b>{p.symbol}</b>
        {p.status !== "blocked" && <span>{p.qty} shares</span>}
        <span className="apx-dim">{p.label}</span>
        <span className="apx-dim apx-prop__at">{clock(p.createdAt)}</span>
      </div>
      <p className="apx-prop__nums">
        Near {inr(p.price)} · stop {inr(p.stop)} · target {inr(p.targets[0])}
        {isNum(p.targets[1]) ? ` then ${inr(p.targets[1])}` : ""}
        {p.status !== "blocked" ? ` · risk ${inr(p.riskRs, 0)} · ${p.rr}× · position ${inr(p.valueRs, 0)}` : ""}
      </p>
      <p className="apx-prop__why">{p.why}</p>
      {p.measured && <p className="apx-dim">{p.measured}</p>}
      {p.reasons && p.reasons.length > 0 && (
        <ul className="apx-reasons">
          {p.reasons.map((r, i) => (
            <li key={i} className={`is-${r.level}`}>
              {r.text}
            </li>
          ))}
        </ul>
      )}
      <p className="apx-prop__state">{st.text}</p>
      {live && p.status !== "blocked" && (
        <div className="apx-prop__btns">
          <button type="button" className="adm-btn adm-btn--solid adm-btn--sm" onClick={review} disabled={off || busy} data-tip={why}>
            Review the order
          </button>
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => decide("ignored")} disabled={busy}>
            Ignore
          </button>
        </div>
      )}
      {err && <p className="adm-alert adm-alert--error">{err}</p>}
    </li>
  );
}

export function ProposalList({ items, onChanged, empty = "No proposals yet." }) {
  if (!items || !items.length) return <p className="ab-dim">{empty}</p>;
  return (
    <ul className="apx-props">
      {items.map((p) => (
        <ProposalCard key={p.id} p={p} onChanged={onChanged} />
      ))}
    </ul>
  );
}

export { when };
