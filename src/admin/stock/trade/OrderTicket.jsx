// The order ticket: one form for every Buy and Sell on the Stock Report, laid out the way
// Kite's is — side in the header, product, quantity, price, trigger, order type — and a
// second step that states the order in words before anything is sent.
//
// It sends nothing while trading is switched off (the server refuses too). A fresh
// reference goes with each ticket, so a double click or a retry cannot place it twice.
//
// Two things a broker's ticket does not do for you:
//   • the exit plan — a stop, a target and the money you accept losing give the quantity, the
//     rupees at risk and the reward-to-risk ratio before you buy. The stop is not sent with
//     the order: once the entry fills, the terminal offers the stop-loss order to confirm.
//   • the pre-trade check — the margin and the charges by Zerodha's own calculator, what is
//     available, and whether your per-order limits and the risk guard would let it through.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import { inr, isNum, num } from "../analyzer/format";
import { CASH, describe, newRef, planNumbers, sizeForRisk, ticketProblem } from "./tradeMath";

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
  const given = prefill.plan || null;
  const [plan, setPlan] = useState(() => ({
    stop: given && isNum(given.stop) ? String(given.stop) : "",
    target: given && isNum(given.target) ? String(given.target) : "",
    risk: given && isNum(given.risk) ? String(given.risk) : "",
  }));
  const [planOpen, setPlanOpen] = useState(Boolean(given));
  const [check, setCheck] = useState(null); // the pre-trade check, or null while there is none
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
  const pn = planOpen ? planNumbers({ side: t.side, entry: px, stop: plan.stop, target: plan.target, quantity: t.quantity }) : null;
  const sized = planOpen ? sizeForRisk(plan.risk, px, plan.stop) : 0;
  const planOut = planOpen && Number(plan.stop) > 0 && pn && !pn.problem ? { stop: Number(plan.stop), target: Number(plan.target) > 0 ? Number(plan.target) : null } : null;

  // the pre-trade check, a moment after the ticket stops changing
  const checkBody = useMemo(() => {
    if (problem || !connected) return null;
    const b = { exchange: t.exchange, symbol: t.symbol, side: t.side, product: t.product, type: t.type, quantity: Number(t.quantity), validity: t.validity, variety: t.variety };
    if (t.type === "LIMIT" || t.type === "SL") b.price = t.price;
    if (t.type === "SL" || t.type === "SL-M") b.trigger = t.trigger;
    if (t.protection !== "") b.protection = t.protection;
    return b;
  }, [problem, connected, t]);
  const ltpNow = useRef(ltp);
  ltpNow.current = ltp;
  useEffect(() => {
    if (!checkBody) {
      setCheck(null);
      return undefined;
    }
    let alive = true;
    const id = setTimeout(() => {
      api("/api/admin/trading/preview", { method: "POST", body: { ...checkBody, refPrice: ltpNow.current || undefined } })
        .then((d) => alive && setCheck(d))
        .catch(() => alive && setCheck(null));
    }, 350);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [checkBody]);
  const failed = check ? check.checks.filter((c) => !c.ok && c.id !== "switch") : [];

  const send = async () => {
    setStep("sending");
    setError("");
    try {
      const body = { ...t, quantity: Number(t.quantity), confirm: true, clientRef: ref.current, refPrice: ltp || undefined };
      if (!(t.type === "LIMIT" || t.type === "SL")) delete body.price;
      if (!(t.type === "SL" || t.type === "SL-M")) delete body.trigger;
      if (body.protection === "") delete body.protection;
      const r = await api("/api/admin/trading/orders", { method: "POST", body });
      onPlaced(r, t, planOut);
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
            {prefill.note && <p className="tr-plan__src">{prefill.note}</p>}
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

            <button type="button" className="tr-more" aria-expanded={planOpen} onClick={() => setPlanOpen((p) => !p)} data-tip="Decide the exit before the entry: a stop, a target, and the money you accept losing. The ticket then shows the rupees at risk, the reward-to-risk ratio and the quantity that fits your risk.">
              {planOpen ? "Hide the exit plan" : "Plan the exit: stop, target, size by risk"}
            </button>
            {planOpen && (
              <div className="tr-plan">
                {given && given.source && <p className="tr-plan__src">{given.source}</p>}
                <div className="tr-grid">
                  <label className="tr-field">
                    <span>Stop</span>
                    <input type="number" inputMode="decimal" min="0" step="0.05" value={plan.stop} onChange={(e) => setPlan((p) => ({ ...p, stop: e.target.value }))} />
                  </label>
                  <label className="tr-field">
                    <span>Target</span>
                    <input type="number" inputMode="decimal" min="0" step="0.05" value={plan.target} onChange={(e) => setPlan((p) => ({ ...p, target: e.target.value }))} />
                  </label>
                  <label className="tr-field">
                    <span>Risk ₹</span>
                    <input type="number" inputMode="numeric" min="0" step="100" value={plan.risk} onChange={(e) => setPlan((p) => ({ ...p, risk: e.target.value }))} />
                  </label>
                </div>
                <div className="tr-plan__sum">
                  {pn && pn.risk !== null ? (
                    <span>
                      If stopped <b className="is-down">−{inr(pn.risk)}</b>
                    </span>
                  ) : (
                    <span>{isNum(px) ? "Enter a stop to see the money at risk." : "Waiting for a price."}</span>
                  )}
                  {pn && pn.reward !== null && (
                    <span>
                      At the target <b className="is-up">+{inr(pn.reward)}</b>
                    </span>
                  )}
                  {pn && pn.rr !== null && (
                    <span data-tip="How many rupees the target would make for each rupee the stop would lose.">
                      Reward : risk <b>{pn.rr.toFixed(2)}</b>
                    </span>
                  )}
                  {sized > 0 && String(sized) !== String(t.quantity) && (
                    <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setT((x) => ({ ...x, quantity: String(sized) }))} data-tip="Set the quantity so that being stopped out loses about the risk you entered: the risk divided by the distance from the entry to the stop.">
                      Use {num(sized, 0)} shares for {inr(Number(plan.risk), 0)}
                    </button>
                  )}
                </div>
                {pn && pn.problem && <p className="tr-note is-warn">{pn.problem}</p>}
                <p className="vd-note">The stop and target are not sent with this order. When the entry fills, the terminal offers the stop-loss order for you to confirm.</p>
              </div>
            )}

            {check && (check.margin !== null || check.available !== null) && (
              <dl className="tr-pre" data-tip="The pre-trade check: Zerodha's own calculator for the margin this order blocks and the charges it costs, against what your account has available. Nothing is reserved by checking.">
                <div>
                  <dt>Margin needed</dt>
                  <dd>{check.reduces ? "None — it closes what you hold" : check.margin !== null ? inr(check.margin) : "—"}</dd>
                </div>
                <div>
                  <dt>Available</dt>
                  <dd className={check.enough === false ? "is-down" : ""}>{check.available !== null ? inr(check.available) : "—"}</dd>
                </div>
                <div>
                  <dt>Charges</dt>
                  <dd>{check.charges ? inr(check.charges.total) : "—"}</dd>
                </div>
              </dl>
            )}
            {failed.map((c) => (
              <p key={c.id} className="tr-note is-warn">
                {c.text}
              </p>
            ))}

            {(problem || blocked || (overLimit && !check) || error) && (
              <p className={`tr-note ${error || blocked ? "is-bad" : "is-warn"}`} role="alert">
                {error || blocked || problem || `Over your per-order limit (${limits.maxQty} shares / ₹${num(limits.maxValue, 0)}). The server will refuse it unless it only closes an existing position.`}
              </p>
            )}
          </div>
        ) : (
          <div className="tr-ticket__body tr-confirm">
            <p className="tr-confirm__what">{words}</p>
            {value && <p>Approximate value: {inr(value)}</p>}
            {check && check.margin !== null && (
              <p>
                {check.reduces ? "Closes or reduces what you hold" : `Margin needed ${inr(check.margin)}`}
                {check.charges ? ` · charges about ${inr(check.charges.total)}` : ""}
                {check.available !== null ? ` · available ${inr(check.available)}` : ""}
              </p>
            )}
            {failed.map((c) => (
              <p key={c.id} className="tr-note is-warn">
                {c.text}
              </p>
            ))}
            {planOut && pn && (
              <p>
                Your plan: stop {inr(planOut.stop)} — about <b className="is-down">−{inr(pn.risk)}</b> if it is hit
                {planOut.target && pn.reward !== null ? (
                  <>
                    ; target {inr(planOut.target)} — about <b className="is-up">+{inr(pn.reward)}</b>
                  </>
                ) : null}
                . The stop is offered as a separate order once this one fills.
              </p>
            )}
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
