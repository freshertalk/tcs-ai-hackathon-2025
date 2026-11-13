// The order ticket: one form for every Buy and Sell on the Stock Report, laid out the way
// Kite's is — side in the header, product, quantity, price, trigger, order type — and a
// second step that states the order in words before anything is sent.
//
// It sends nothing while trading is switched off (the server refuses too). A fresh
// reference goes with each ticket, so a double click or a retry cannot place it twice.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import { inr, isNum, num } from "../analyzer/format";
import { CASH, describe, newRef, ticketProblem } from "./tradeMath";

const TYPES = [
  { id: "MARKET", label: "Market" },
  { id: "LIMIT", label: "Limit" },
  { id: "SL", label: "SL" },
  { id: "SL-M", label: "SL-M" },
];

export default function OrderTicket({ prefill, enabled, connected, limits, onClose, onPlaced }) {
  const derivative = prefill.exchange && !CASH.has(prefill.exchange);
  const [t, setT] = useState(() => ({
    exchange: prefill.exchange || "NSE",
    symbol: String(prefill.symbol || "").toUpperCase(),
    side: prefill.side === "SELL" ? "SELL" : "BUY",
    product: prefill.product || (derivative ? "NRML" : "MIS"),
    type: prefill.type || (isNum(prefill.price) ? "LIMIT" : "MARKET"),
    quantity: prefill.quantity ? String(prefill.quantity) : "1",
    price: isNum(prefill.price) ? String(prefill.price) : "",
    trigger: isNum(prefill.trigger) ? String(prefill.trigger) : "",
    validity: "DAY",
    variety: "regular",
    protection: "",
  }));
  const [ltp, setLtp] = useState(isNum(prefill.ltp) ? prefill.ltp : null);
  const [step, setStep] = useState("edit"); // edit → confirm → sending
  const [error, setError] = useState("");
  const [more, setMore] = useState(false);
  const ref = useRef(newRef());
  const first = useRef(null);
  const set = (k) => (e) => setT((x) => ({ ...x, [k]: e && e.target ? (e.target.type === "checkbox" ? e.target.checked : e.target.value) : e }));

  // the latest price, for the value shown and for the server's limit check
  useEffect(() => {
    if (derivative || !t.symbol) return undefined;
    let alive = true;
    api(`/api/admin/market/quotes?symbols=${encodeURIComponent(t.symbol)}`)
      .then((d) => {
        const q = d && d.quotes && d.quotes[t.symbol];
        if (alive && q && isNum(q.last)) setLtp(q.last);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [t.symbol, derivative]);

  useEffect(() => {
    if (first.current) first.current.focus();
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const problem = ticketProblem(t);
  const px = t.type === "LIMIT" || t.type === "SL" ? Number(t.price) : ltp;
  const value = isNum(px) && Number(t.quantity) > 0 ? px * Number(t.quantity) : null;
  const overLimit = limits && ((value && value > limits.maxValue) || Number(t.quantity) > limits.maxQty);
  const blocked = !enabled ? "Trading is switched OFF. Turn it on in Positions & orders to place orders." : !connected ? "Zerodha is not connected. Log in to Kite on the Trading desk." : "";
  const words = useMemo(() => describe(t), [t]);

  const send = async () => {
    setStep("sending");
    setError("");
    try {
      const body = { ...t, quantity: Number(t.quantity), confirm: true, clientRef: ref.current, refPrice: ltp || undefined };
      if (!(t.type === "LIMIT" || t.type === "SL")) delete body.price;
      if (!(t.type === "SL" || t.type === "SL-M")) delete body.trigger;
      if (body.protection === "") delete body.protection;
      const r = await api("/api/admin/trading/orders", { method: "POST", body });
      onPlaced(r, t);
    } catch (e) {
      // a refused order may be corrected and sent again: it gets a new reference
      ref.current = newRef();
      setError(e.message);
      setStep("edit");
    }
  };

  return (
    <div className="tr-modal" role="dialog" aria-modal="true" aria-label={`${t.side === "BUY" ? "Buy" : "Sell"} ${t.symbol}`} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className={`tr-ticket tr-ticket--${t.side.toLowerCase()}`}
        onSubmit={(e) => {
          e.preventDefault();
          if (step === "edit" && !problem && !blocked) setStep("confirm");
        }}
      >
        <header className="tr-ticket__head">
          <div>
            <h3>
              {t.side === "BUY" ? "Buy" : "Sell"} {t.symbol || "—"} <small>{t.exchange}</small>
            </h3>
            <p>
              {derivative ? (
                t.exchange
              ) : (
                <span className="tr-ticket__ex" role="radiogroup" aria-label="Exchange">
                  {["NSE", "BSE"].map((x) => (
                    <label key={x}>
                      <input type="radio" name="tr-ex" checked={t.exchange === x} onChange={() => setT((y) => ({ ...y, exchange: x }))} /> {x}
                    </label>
                  ))}
                </span>
              )}
              {isNum(ltp) && <span className="tr-ticket__ltp"> · LTP {inr(ltp)}</span>}
            </p>
          </div>
          <button
            type="button"
            className="tr-side"
            role="switch"
            aria-checked={t.side === "SELL"}
            aria-label="Buy or sell"
            onClick={() => setT((x) => ({ ...x, side: x.side === "BUY" ? "SELL" : "BUY" }))}
            data-tip="Switch between buying and selling this instrument."
          >
            <i aria-hidden="true" />
          </button>
        </header>

        {step !== "confirm" ? (
          <div className="tr-ticket__body">
            {!prefill.symbol && (
              <label className="tr-field tr-field--wide">
                <span>Symbol</span>
                <input ref={first} value={t.symbol} onChange={(e) => setT((x) => ({ ...x, symbol: e.target.value.toUpperCase().trim() }))} placeholder="e.g. INFY" autoComplete="off" />
              </label>
            )}
            <div className="tr-row" role="radiogroup" aria-label="Product">
              {(derivative ? [["MIS", "Intraday", "MIS"], ["NRML", "Overnight", "NRML"]] : [["MIS", "Intraday", "MIS"], ["CNC", "Longterm", "CNC"]]).map(([id, label, code]) => (
                <label key={id} className="tr-radio">
                  <input type="radio" name="tr-product" checked={t.product === id} onChange={() => setT((x) => ({ ...x, product: id }))} />
                  {label} <small>{code}</small>
                </label>
              ))}
            </div>
            <div className="tr-grid">
              <label className="tr-field">
                <span>Qty.</span>
                <input ref={prefill.symbol ? first : null} type="number" inputMode="numeric" min="1" step="1" value={t.quantity} onChange={set("quantity")} />
              </label>
              <label className="tr-field">
                <span>Price</span>
                <input type="number" inputMode="decimal" min="0" step="0.05" value={t.type === "MARKET" || t.type === "SL-M" ? "" : t.price} placeholder={t.type === "MARKET" || t.type === "SL-M" ? "Market" : ""} disabled={t.type === "MARKET" || t.type === "SL-M"} onChange={set("price")} />
              </label>
              <label className="tr-field">
                <span>Trigger price</span>
                <input type="number" inputMode="decimal" min="0" step="0.05" value={t.type === "SL" || t.type === "SL-M" ? t.trigger : ""} disabled={!(t.type === "SL" || t.type === "SL-M")} onChange={set("trigger")} />
              </label>
            </div>
            <div className="tr-row" role="radiogroup" aria-label="Order type">
              {TYPES.map((x) => (
                <label key={x.id} className="tr-radio">
                  <input type="radio" name="tr-type" checked={t.type === x.id} onChange={() => setT((y) => ({ ...y, type: x.id }))} />
                  {x.label}
                </label>
              ))}
            </div>

            <button type="button" className="tr-more" aria-expanded={more} onClick={() => setMore((m) => !m)}>
              {more ? "Fewer options" : "More options"}
            </button>
            {more && (
              <div className="tr-grid tr-grid--more">
                <label className="tr-field">
                  <span>Validity</span>
                  <select value={t.validity} onChange={set("validity")}>
                    <option value="DAY">Day</option>
                    <option value="IOC">Immediate or cancel</option>
                  </select>
                </label>
                <label className="tr-field">
                  <span>Market protection %</span>
                  <input type="number" step="0.5" placeholder="Auto" value={t.protection} disabled={!(t.type === "MARKET" || t.type === "SL-M")} onChange={set("protection")} />
                </label>
                <label className="tr-check">
                  <input type="checkbox" checked={t.variety === "amo"} onChange={(e) => setT((x) => ({ ...x, variety: e.target.checked ? "amo" : "regular" }))} /> After-market order (AMO)
                </label>
              </div>
            )}

            {(problem || blocked || overLimit || error) && (
              <p className={`tr-note ${error || blocked ? "is-bad" : "is-warn"}`} role="alert">
                {error || blocked || problem || `Over your per-order limit (${limits.maxQty} shares / ₹${num(limits.maxValue, 0)}). The server will refuse it unless it only closes an existing position.`}
              </p>
            )}
          </div>
        ) : (
          <div className="tr-ticket__body tr-confirm">
            <p className="tr-confirm__what">{words}</p>
            {value && <p>Approximate value: {inr(value)}</p>}
            <p className="tr-note is-warn">This sends a real order to your Zerodha account. Check the Orders tab afterwards: an order being accepted does not mean it was filled.</p>
          </div>
        )}

        <footer className="tr-ticket__foot">
          <small>{value ? <>Approx. {inr(value)}</> : " "}</small>
          <span>
            {step === "edit" ? (
              <button type="submit" className={`tr-btn tr-btn--${t.side === "BUY" ? "buy" : "sell"} tr-btn--lg`} disabled={Boolean(problem || blocked)}>
                {t.side === "BUY" ? "Buy" : "Sell"}
              </button>
            ) : (
              <button type="button" className={`tr-btn tr-btn--${t.side === "BUY" ? "buy" : "sell"} tr-btn--lg`} disabled={step === "sending" || Boolean(blocked)} onClick={send}>
                {step === "sending" ? "Sending…" : `Yes, place ${t.side === "BUY" ? "buy" : "sell"} order`}
              </button>
            )}
            <button type="button" className="adm-btn adm-btn--ghost" onClick={step === "confirm" ? () => setStep("edit") : onClose} disabled={step === "sending"}>
              {step === "confirm" ? "Back" : "Cancel"}
            </button>
          </span>
        </footer>
      </form>
    </div>
  );
}
