// The option chain of the open stock, read: what the options market says, beside the Desk's other
// readings. From GET /api/admin/market/options/:symbol (server/market/options.js) — Zerodha's quotes
// on the NFO contracts: every strike around the money with price, open interest, OI change, volume,
// implied volatility and delta, and PCR, max pain, the OI walls, fresh writing, futures build-up, the
// expected move and a bias with its reasons. The Intraday plan uses the same bias as one factor.
// Read-only: nothing here places an order.

import React, { useEffect, useState } from "react";
import { api } from "../../api";
import { formatDate } from "../holidays";
import { inr, isNum, num, pct } from "./format";
import "./optionchain.css";

const enc = encodeURIComponent;
const big = (x) => (isNum(x) ? (Math.abs(x) >= 1e7 ? `${num(x / 1e7, 2)} Cr` : Math.abs(x) >= 1e5 ? `${num(x / 1e5, 2)} L` : Math.round(x).toLocaleString("en-IN")) : "—");
const signedBig = (x) => (isNum(x) ? `${x > 0 ? "+" : x < 0 ? "−" : ""}${big(Math.abs(x))}` : "—");
export const biasTone = (score) => (!isNum(score) ? "flat" : score >= 10 ? "up" : score <= -10 ? "down" : "flat");

/** The chain for one stock: read once, then every minute in market hours and every ten otherwise. */
export function useOptionChain(symbol, enabled = true, expiry = "") {
  const [s, setS] = useState({ loading: enabled, data: null, error: "" });
  useEffect(() => {
    let alive = true;
    if (!enabled || !symbol) return undefined;
    setS((p) => ({ loading: true, data: p.data && p.data.symbol === symbol ? p.data : null, error: "" }));
    const read = () =>
      api(`/api/admin/market/options/${enc(symbol)}${expiry ? `?expiry=${enc(expiry)}` : ""}`)
        .then((d) => alive && setS({ loading: false, data: d, error: "" }))
        .catch((e) => alive && setS((p) => ({ loading: false, data: p.data, error: e.message })));
    read();
    const id = setInterval(() => document.visibilityState !== "hidden" && read(), 60000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [symbol, enabled, expiry]);
  return s;
}

function Side({ q, pick, maxOi, align }) {
  if (!q) return <td colSpan={5} className="oc-none" />;
  const bar = maxOi > 0 && isNum(q.oi) ? Math.max(2, Math.round((q.oi / maxOi) * 100)) : 0;
  const cells = [
    <td key="oi" className={`oc-oi oc-oi--${pick}`}>
      <span className="oc-oibar" style={{ width: `${bar}%`, [align === "left" ? "right" : "left"]: 0 }} aria-hidden="true" />
      <span className="oc-oiv">{big(q.oi)}</span>
    </td>,
    <td key="chg" className={q.oiChange > 0 ? "is-up" : q.oiChange < 0 ? "is-down" : ""}>
      {signedBig(q.oiChange)}
    </td>,
    <td key="vol">{big(q.volume)}</td>,
    <td key="iv">{isNum(q.iv) ? num(q.iv, 1) : "—"}</td>,
    <td key="ltp" className="oc-ltp">
      <b>{isNum(q.last) ? num(q.last) : "—"}</b>
      {isNum(q.change) && <small className={q.change > 0 ? "is-up" : q.change < 0 ? "is-down" : ""}>{`${q.change > 0 ? "+" : ""}${num(q.change)}`}</small>}
    </td>,
  ];
  return align === "left" ? cells : cells.reverse();
}

/** The Desk's view of the chain. `data` when the caller has it; otherwise it is read here. */
export default function OptionChain({ symbol, data = null }) {
  const [expiry, setExpiry] = useState("");
  useEffect(() => setExpiry(""), [symbol]);
  const own = useOptionChain(symbol, !data || Boolean(expiry), expiry);
  const c = expiry ? own.data : data || own.data;
  if (!c && own.loading) return <p className="ab-dim">Reading the option chain…</p>;
  if (!c) return <p className="adm-alert adm-alert--info">{own.error || "The option chain is not available."}</p>;
  if (!c.available) return <p className="adm-alert adm-alert--info">{c.reason}</p>;
  const tone = biasTone(c.bias.score);
  const maxOi = Math.max(1, ...c.rows.map((r) => Math.max((r.ce && r.ce.oi) || 0, (r.pe && r.pe.oi) || 0)));
  return (
    <div className="oc">
      <div className={`oc-head oc-head--${tone}`}>
        <span className="oc-badge">{c.bias.label.toUpperCase()}</span>
        <div className="oc-head__t">
          <b>
            Options on {c.underlying} · expiry {formatDate(c.expiry, { day: "numeric", month: "short" })} ({Math.round(c.daysToExpiry) < 1 ? "expires today" : `${Math.round(c.daysToExpiry)} day${Math.round(c.daysToExpiry) === 1 ? "" : "s"}`})
          </b>
          <span>
            Options bias {c.bias.score > 0 ? "+" : ""}
            {c.bias.score} — one factor among the desk's readings, not a call.
          </span>
        </div>
        {c.expiries && c.expiries.length > 1 && (
          <div className="oc-exp" role="group" aria-label="Expiry">
            {c.expiries.slice(0, 4).map((e) => (
              <button key={e} type="button" aria-pressed={e === c.expiry} onClick={() => setExpiry(e === c.expiries[0] ? "" : e)}>
                {formatDate(e, { day: "numeric", month: "short" })}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="oc-tiles">
        <div>
          <span>PCR (OI · volume)</span>
          <b>
            {isNum(c.pcr) ? num(c.pcr, 2) : "—"} · {isNum(c.pcrVol) ? num(c.pcrVol, 2) : "—"}
          </b>
        </div>
        <div>
          <span>Max pain</span>
          <b>{inr(c.maxPain, 0)}</b>
          <small>{isNum(c.maxPain) ? pct(((c.maxPain - c.spot) / c.spot) * 100, 1) : ""} from spot</small>
        </div>
        <div>
          <span>Resistance (call wall)</span>
          <b className="is-down">{c.resistance ? inr(c.resistance.strike, 0) : "—"}</b>
          <small>{c.resistance ? `${big(c.resistance.oi)} OI${c.nearResistance ? " · close above" : ""}` : ""}</small>
        </div>
        <div>
          <span>Support (put wall)</span>
          <b className="is-up">{c.support ? inr(c.support.strike, 0) : "—"}</b>
          <small>{c.support ? `${big(c.support.oi)} OI${c.nearSupport ? " · close below" : ""}` : ""}</small>
        </div>
        <div>
          <span>ATM IV · skew</span>
          <b>
            {isNum(c.atmIv) ? `${num(c.atmIv, 1)}%` : "—"}
            {isNum(c.skew) ? ` · ${c.skew > 0 ? "+" : ""}${num(c.skew, 1)}` : ""}
          </b>
        </div>
        <div>
          <span>Expected move</span>
          <b>±{inr(c.expectedMove.day)} a day</b>
          <small>{c.expectedMove.low ? `${inr(c.expectedMove.low, 0)} – ${inr(c.expectedMove.high, 0)} by expiry` : ""}</small>
        </div>
        <div>
          <span>Spot · future</span>
          <b>
            {inr(c.spot)}
            {c.future ? ` · ${inr(c.future.last)}` : ""}
          </b>
          <small>{c.future && c.future.buildup ? `futures: ${c.future.buildup}` : isNum(c.basis) ? `basis ${num(c.basis)}` : ""}</small>
        </div>
      </div>

      <div className="oc-why">
        <ul>
          {c.bias.votes.map((v) => (
            <li key={v.id} className={v.vote > 0.1 ? "is-for" : v.vote < -0.1 ? "is-against" : ""}>
              <b>{v.label}</b> {v.why}
            </li>
          ))}
        </ul>
        {c.bias.cautions.length > 0 && (
          <ul className="oc-cautions">
            {c.bias.cautions.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="oc-tablewrap">
        <table className="oc-table">
          <thead>
            <tr className="oc-sides">
              <th colSpan={5} scope="colgroup">
                Calls
              </th>
              <th scope="col" rowSpan={2}>
                Strike
              </th>
              <th colSpan={5} scope="colgroup">
                Puts
              </th>
            </tr>
            <tr>
              <th scope="col">OI</th>
              <th scope="col">OI chg</th>
              <th scope="col">Volume</th>
              <th scope="col">IV</th>
              <th scope="col">LTP</th>
              <th scope="col">LTP</th>
              <th scope="col">IV</th>
              <th scope="col">Volume</th>
              <th scope="col">OI chg</th>
              <th scope="col">OI</th>
            </tr>
          </thead>
          <tbody>
            {c.rows.map((r) => (
              <tr key={r.strike} className={`${r.atm ? "is-atm" : ""} ${r.strike < c.spot ? "ce-itm" : "pe-itm"}`}>
                <Side q={r.ce} pick="ce" maxOi={maxOi} align="left" />
                <th scope="row" className="oc-strike">
                  {num(r.strike, r.strike % 1 ? 1 : 0)}
                  {c.maxPain === r.strike && <small>max pain</small>}
                </th>
                <Side q={r.pe} pick="pe" maxOi={maxOi} align="right" />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="ab-dim oc-foot">
        Lot {c.lot} · {c.oiChangeSince ? `OI change since ${new Date(c.oiChangeSince).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "OI change from the next session"} · IV and delta by Black-76 on the futures price · from Zerodha. Shaded cells are in the money.
      </p>
    </div>
  );
}
