// The risk guard on the Positions screen: how much room is left today against your own
// limits (loss, orders, open positions), whether the day is locked, and the rules themselves.
// The server enforces all of it; this shows it and lets you set it.

import React, { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import { Alert } from "../../ui";
import { num, when } from "../analyzer/format";

const money = (x) => `₹${num(Math.abs(x || 0), 0)}`;

function Gauge({ label, used, limit, text, tip, danger }) {
  const pct = limit > 0 ? Math.min(100, Math.max(0, (used / limit) * 100)) : 0;
  return (
    <div className={`rg-gauge ${danger ? "is-danger" : pct >= 75 ? "is-warn" : ""}`} data-tip={tip}>
      <div className="rg-gauge__top">
        <span>{label}</span>
        <b>{text}</b>
      </div>
      <div className="rg-gauge__bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label={label}>
        <i style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function RiskGuard({ trade, version }) {
  const [d, setD] = useState(null);
  const [form, setForm] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api("/api/admin/trading/risk")
      .then((x) => setD(x))
      .catch((e) => setErr(e.message));
  }, []);
  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load, version]);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await api("/api/admin/trading/risk", { method: "PUT", body: { ...form, enabled: Boolean(form.enabled) } });
      setForm(null);
      load();
      trade.refresh();
      trade.say("Risk rules saved.", "ok");
    } catch (x) {
      setErr(x.message);
    }
    setBusy(false);
  };

  if (!d) return err ? <Alert>{err}</Alert> : null;
  const c = d.config;
  const s = d.standing;
  const locked = Boolean(d.lock || (s && s.locked));
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  return (
    <section className={`an-card rg ${locked ? "is-locked" : c.enabled ? "is-on" : ""}`} aria-label="Risk guard">
      <header className="rg__head">
        <div>
          <h3>Risk guard</h3>
          <p>
            {c.enabled
              ? "Your own prop-desk limits, enforced by the server. A breach locks the day for new trades; exits, cancels and stop changes always go through."
              : "Off. Set a daily loss limit and the server locks new trades for the rest of the day once it is reached — the rule a prop desk puts on every trader."}
          </p>
        </div>
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setForm(form ? null : { enabled: c.enabled || !c.dailyLoss ? true : c.enabled, dailyLoss: c.dailyLoss || "", profitLock: c.profitLock || "", maxOrders: c.maxOrders || "", maxOpen: c.maxOpen || "" })} data-tip="Set the daily loss limit, an optional profit lock, and caps on orders and open positions.">
          {form ? "Close" : "Rules"}
        </button>
      </header>

      {locked && (
        <p className="rg__lock" role="status">
          <b>Locked for today.</b> {(d.lock && d.lock.reason) || (s && s.breach && s.breach.reason)} {d.lock ? `Since ${when(d.lock.at)}.` : ""} New trades are refused until tomorrow; you can still exit and cancel.
        </p>
      )}

      {c.enabled && s && (
        <div className="rg__gauges">
          {c.dailyLoss > 0 && (
            <Gauge
              label="Daily loss"
              used={Math.max(0, -s.dayPnl)}
              limit={c.dailyLoss}
              danger={locked && d.lock && d.lock.kind === "loss"}
              text={`${s.dayPnl < 0 ? "−" : "+"}${money(s.dayPnl)} of −${money(c.dailyLoss)}`}
              tip={`Today’s mark-to-market against your daily loss limit. ${s.room.loss !== null ? `${money(s.room.loss)} of room left.` : ""}`}
            />
          )}
          {c.profitLock > 0 && <Gauge label="Profit lock" used={Math.max(0, s.dayPnl)} limit={c.profitLock} text={`${money(Math.max(0, s.dayPnl))} of ${money(c.profitLock)}`} tip="When today’s gain reaches this, the day locks to keep it." />}
          {c.maxOrders > 0 && <Gauge label="Orders today" used={s.ordersToday} limit={c.maxOrders} text={`${s.ordersToday} of ${c.maxOrders}`} tip="Executed orders today, from any app. At the cap no new ones are allowed (exits still are)." />}
          {c.maxOpen > 0 && <Gauge label="Open positions" used={s.openCount} limit={c.maxOpen} text={`${s.openCount} of ${c.maxOpen}`} tip="Positions open now. At the cap, no position in a new symbol." />}
        </div>
      )}
      {c.enabled && !s && <p className="vd-note">Connect Zerodha to see today’s standing against these limits.</p>}

      {form && (
        <form className="rg__form" onSubmit={save}>
          <label className="tr-check">
            <input type="checkbox" checked={Boolean(form.enabled)} onChange={set("enabled")} /> Risk guard on
          </label>
          <label className="tr-field">
            <span>Daily loss limit (₹)</span>
            <input type="number" min="0" step="500" value={form.dailyLoss} onChange={set("dailyLoss")} placeholder="e.g. 5000" />
          </label>
          <label className="tr-field">
            <span>Profit lock (₹, optional)</span>
            <input type="number" min="0" step="500" value={form.profitLock} onChange={set("profitLock")} placeholder="off" />
          </label>
          <label className="tr-field">
            <span>Max orders a day</span>
            <input type="number" min="0" step="1" value={form.maxOrders} onChange={set("maxOrders")} placeholder="off" />
          </label>
          <label className="tr-field">
            <span>Max open positions</span>
            <input type="number" min="0" step="1" value={form.maxOpen} onChange={set("maxOpen")} placeholder="off" />
          </label>
          <button type="submit" className="adm-btn adm-btn--solid adm-btn--sm" disabled={busy}>
            Save rules
          </button>
          <p className="vd-note">Empty or 0 means no limit. While the day is locked, limits can be tightened but not loosened. Set the loss limit a little inside what you can really afford: market orders can fill beyond it.</p>
        </form>
      )}
      <Alert>{err}</Alert>
    </section>
  );
}
