// The alerts panel behind the bell in the top bar: set one, see what is waiting and how far
// away each level is, and what has fired.

import React, { useEffect, useRef, useState } from "react";
import { inr, isNum, when } from "../analyzer/format";
import { useAlerts } from "./AlertsContext";
import { distancePct } from "./alerts";

export default function AlertsPanel({ symbol, onClose }) {
  const al = useAlerts();
  const [f, setF] = useState({ symbol: symbol || "", price: "", dir: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [perm, setPerm] = useState(typeof Notification !== "undefined" ? Notification.permission : "unsupported");
  const box = useRef(null);
  const first = useRef(null);

  useEffect(() => {
    if (first.current) first.current.focus();
    const out = (e) => box.current && !box.current.contains(e.target) && !(e.target.closest && e.target.closest("[data-alerts-toggle]")) && onClose();
    const esc = (e) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", out);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", out);
      document.removeEventListener("keydown", esc);
    };
  }, [onClose]);

  if (!al) return null;
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await al.add({ symbol: f.symbol.trim().toUpperCase(), price: Number(f.price), dir: f.dir || undefined, note: f.note });
      setF((x) => ({ ...x, price: "", note: "" }));
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };
  const allow = () => {
    try {
      Notification.requestPermission().then((p) => setPerm(p));
    } catch (_) {
      setPerm("denied");
    }
  };
  const fired = al.alerts.filter((a) => a.firedAt).slice(0, 8);

  return (
    <div className="tm-alerts" ref={box} role="dialog" aria-label="Price alerts">
      <h3>Price alerts</h3>
      <form onSubmit={submit} className="tm-alerts__form">
        <input ref={first} value={f.symbol} onChange={(e) => setF((x) => ({ ...x, symbol: e.target.value.toUpperCase() }))} placeholder="Symbol" aria-label="Symbol" autoComplete="off" maxLength={25} />
        <select value={f.dir} onChange={(e) => setF((x) => ({ ...x, dir: e.target.value }))} aria-label="Side" data-tip="Leave on “reaches” and the side is taken from the price now: above it if your level is higher, below it if lower.">
          <option value="">reaches</option>
          <option value="above">rises to</option>
          <option value="below">falls to</option>
        </select>
        <input type="number" inputMode="decimal" min="0" step="0.05" value={f.price} onChange={(e) => setF((x) => ({ ...x, price: e.target.value }))} placeholder="Price" aria-label="Price" />
        <input className="tm-alerts__note" value={f.note} onChange={(e) => setF((x) => ({ ...x, note: e.target.value }))} placeholder="Note to yourself (optional)" aria-label="Note" maxLength={120} />
        <button type="submit" className="adm-btn adm-btn--solid adm-btn--sm" disabled={busy || !f.symbol.trim() || !(Number(f.price) > 0)}>
          {busy ? "Setting…" : "Set alert"}
        </button>
      </form>
      {error && (
        <p className="tr-note is-bad" role="alert">
          {error}
        </p>
      )}

      {al.waiting.length === 0 ? (
        <p className="tm-alerts__none">No alerts waiting. Set one above, or type “alert sbin 800” in the command palette (Ctrl K).</p>
      ) : (
        <ul className="tm-alerts__list">
          {al.waiting.map((a) => {
            const last = al.prices[a.symbol] && isNum(al.prices[a.symbol].last) ? al.prices[a.symbol].last : null;
            const d = distancePct(a, last);
            return (
              <li key={a.id}>
                <span>
                  <b>{a.symbol}</b> {a.dir === "above" ? "rises to" : "falls to"} <b>{inr(a.price)}</b>
                  {a.note && <small>{a.note}</small>}
                </span>
                <small>{d !== null ? `${d}% away` : isNum(a.from) ? `set at ${inr(a.from)}` : ""}</small>
                <button type="button" aria-label={`Remove the alert on ${a.symbol}`} onClick={() => al.remove(a.id).catch((err) => setError(err.message))}>
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {fired.length > 0 && (
        <>
          <h4>Fired</h4>
          <ul className="tm-alerts__list is-fired">
            {fired.map((a) => (
              <li key={a.id}>
                <span>
                  <b>{a.symbol}</b> {a.dir === "above" ? "rose to" : "fell to"} {inr(a.price)}
                  {a.note && <small>{a.note}</small>}
                </span>
                <small>
                  {when(a.firedAt)}
                  {isNum(a.firedPrice) ? ` at ${inr(a.firedPrice)}` : ""}
                </small>
                <button type="button" aria-label={`Clear the fired alert on ${a.symbol}`} onClick={() => al.remove(a.id).catch((err) => setError(err.message))}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="tm-alerts__foot">
        {al.streaming ? "Watching live ticks." : "Watching by a 15-second check (the live stream is off)."} Alerts are checked while this terminal is open in a tab.
        {perm === "default" && (
          <button type="button" onClick={allow}>
            Allow notifications
          </button>
        )}
        {perm === "denied" && " Browser notifications are blocked for this site: you will get the sound and the note here."}
      </p>
    </div>
  );
}
