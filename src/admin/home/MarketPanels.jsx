// /me's first screen, the market's half: the index strip, and what to know before a trade (the morning's lean, the market's
// tide, the NIFTY's and BANKNIFTY's levels, options, funds flow, the next expiries, the F&O ban and your price alerts).
// Every figure is the server's own; one that is not known yet is a dash with the reason.

import React from "react";
import { num, percent, price, signed, tone } from "./homeData";

const IST = { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true };
export const istTime = (iso) => {
  const t = iso ? new Date(iso) : null;
  return t && !Number.isNaN(t.getTime()) ? t.toLocaleTimeString("en-IN", IST).toUpperCase() : "";
};
const dayWords = (iso) => {
  const t = iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00Z`) : null;
  return t && !Number.isNaN(t.getTime()) ? t.toLocaleDateString("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }) : "—";
};
const away = (n) => (n === 0 ? "today" : n === 1 ? "tomorrow" : num(n) ? `in ${n} days` : "");

/** The day's low to high, with a mark where the price is now. */
export function DayRange({ low, high, place }) {
  if (place == null) return <span className="fs-range is-none">—</span>;
  return (
    <span className="fs-range" role="img" aria-label={`Day’s range ${price(low)} to ${price(high)}; the price is ${Math.round(place)}% of the way up`}>
      <span className="fs-range__n">{price(low)}</span>
      <span className="fs-range__bar" aria-hidden="true">
        <i style={{ left: `${place}%` }} />
      </span>
      <span className="fs-range__n">{price(high)}</span>
    </span>
  );
}

/** Up against down as one bar. */
function Split({ up, down }) {
  const all = up + down;
  if (!all) return null;
  return (
    <span className="fs-split" aria-hidden="true">
      <i className="is-up" style={{ flexGrow: up }} />
      <i className="is-down" style={{ flexGrow: down }} />
    </span>
  );
}

/** Where the prices come from, said plainly: live, last prices, demo, or not connected. */
export function priceStamp(status, quotes, context) {
  if (!status) return { tone: "off", text: "Reading prices…" };
  if (status.mode === "demo") return { tone: "warn", text: "Demo prices: made up, not the market" };
  if (status.mode !== "kite") return { tone: "warn", text: "Zerodha is not connected: live prices appear after you log in on the Desk" };
  const at = istTime(quotes && quotes.at);
  const open = context && context.session ? context.session.open : status.marketHours;
  return open ? { tone: "ok", text: `Live from Zerodha${at ? ` · ${at} IST` : ""}` } : { tone: "off", text: `Market closed: last prices from Zerodha${at ? ` · read ${at} IST` : ""}` };
}

export function IndexStrip({ cells, context, watch, stamp, deskHref }) {
  const tide = context && context.tide;
  const breadth = context && context.breadth && context.breadth.total > 0 ? context.breadth : null;
  return (
    <section className="fs-idx" aria-label="Market now">
      <ul>
        {cells.map((c) => (
          <li key={c.symbol} className="fs-cell">
            <span className="fs-cell__k">{c.name}</span>
            <b className={`fs-cell__v ${tone(c.change)}`}>{price(c.last)}</b>
            <span className={`fs-cell__c ${tone(c.change)}`}>{c.last == null ? "—" : `${signed(c.change)} (${percent(c.changePct)})`}</span>
            {c.last != null && <DayRange low={c.low} high={c.high} place={c.place} />}
            <span className="fs-cell__s">
              {c.last == null ? "not read yet" : `Open ${price(c.open)} · Prev ${price(c.prevClose)}`}
              {c.symbol === "INDIA VIX" && context && context.vix && context.vix.level ? ` · ${context.vix.level}` : ""}
            </span>
          </li>
        ))}
        <li className="fs-cell" data-tip={tide ? tide.summary : undefined}>
          <span className="fs-cell__k">Market tide</span>
          <b className={`fs-cell__v ${tide ? tone(tide.score) : ""}`}>{tide ? tide.label : "—"}</b>
          <span className="fs-cell__c">{tide ? `score ${signed(tide.score, 0)} of ±100` : "not read yet"}</span>
          <span className="fs-cell__s">{breadth ? `Breadth: ${breadth.up} up · ${breadth.down} down of ${breadth.total}` : "the NIFTY’s day, VIX and the market’s lean in one"}</span>
        </li>
        <li className="fs-cell">
          <span className="fs-cell__k">Your watchlist</span>
          <b className="fs-cell__v">
            {watch.count ? (
              <>
                <span className="is-up">{watch.up}▲</span> <span className="is-down">{watch.down}▼</span>
              </>
            ) : (
              "—"
            )}
          </b>
          <span className={`fs-cell__c ${tone(watch.average)}`}>{watch.average == null ? "no prices yet" : `average ${percent(watch.average)}`}</span>
          <Split up={watch.up} down={watch.down} />
          <span className="fs-cell__s">{watch.withVwap ? `${watch.aboveVwap} of ${watch.withVwap} above VWAP` : "VWAP needs live prices"}</span>
        </li>
      </ul>
      <p className={`fs-stamp is-${stamp.tone}`}>
        <i aria-hidden="true" />
        <span>{stamp.text}</span>
        {deskHref && stamp.tone === "warn" && (
          <a href={deskHref} target="_blank" rel="noopener noreferrer">
            Open the Desk
          </a>
        )}
      </p>
    </section>
  );
}

function Levels({ name, data }) {
  if (!data || !data.available) {
    return (
      <div className="fs-lv">
        <h4>{name}</h4>
        <p className="fs-dim">{(data && data.reason) || "The levels appear once the morning setup has read a finished session."}</p>
      </div>
    );
  }
  const steps = [
    ["S2", data.s2],
    ["S1", data.s1],
    ["Pivot", data.pivot],
    ["R1", data.r1],
    ["R2", data.r2],
  ];
  return (
    <div className="fs-lv">
      <h4>
        {name} <small>{`${price(data.spot)} · ${data.side} the pivot`}</small>
      </h4>
      <dl>
        {steps.map(([k, v]) => (
          <div key={k} className={k === "Pivot" ? "is-pivot" : k.startsWith("S") ? "is-s" : "is-r"}>
            <dt>{k}</dt>
            <dd>{price(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Fact({ k, v, sub, valueTone }) {
  return (
    <div className="fs-fact">
      <dt>{k}</dt>
      <dd>
        <b className={valueTone || ""}>{v}</b>
        {sub && <small>{sub}</small>}
      </dd>
    </div>
  );
}

const crore = (x) => (num(x) ? `${x > 0 ? "+" : x < 0 ? "−" : ""}₹${Math.abs(Math.round(x)).toLocaleString("en-IN")} cr` : "—");

export function MarketRead({ context, setup, expiries, alerts, setupHref, calendarHref }) {
  const lean = setup && setup.lean;
  const enough = Boolean(lean && lean.readings);
  const rec = setup && setup.record;
  const pcr = setup && setup.pcr;
  const pain = setup && setup.maxPain;
  const flows = setup && setup.flows;
  const ban = setup && setup.ban && setup.ban.symbols;
  const list = (alerts && alerts.alerts) || [];
  const waiting = list.filter((a) => !a.firedAt);
  const fired = list.filter((a) => a.firedAt).slice(0, 3);
  const next = ((expiries && expiries.exchanges) || []).filter((e) => e.next);
  const tide = context && context.tide;
  return (
    <section className="fs-box fs-read" aria-labelledby="fs-read-h" data-jump="Before you trade">
      <header className="fs-box__head">
        <h2 id="fs-read-h">Before you trade</h2>
        <a href={setupHref} target="_blank" rel="noopener noreferrer">
          Trade setup
        </a>
      </header>

      <div className="fs-lean">
        <div>
          <span className="fs-k">Morning lean</span>
          <b className={enough ? tone(lean.score) : ""}>{lean ? lean.label : "—"}</b>
          <small>
            {enough ? `score ${signed(lean.score, 0)} · ${Math.round((lean.agreement || 0) * 100)}% agree · ${lean.readings} of ${lean.of} readings` : "the morning’s readings have not come in yet"}
            {rec && rec.called > 0 && rec.hitRate != null ? ` · right ${Math.round(rec.hitRate)}% of ${rec.called} days called` : ""}
          </small>
        </div>
        <div>
          <span className="fs-k">Tide</span>
          <b className={tide ? tone(tide.score) : ""}>{tide ? tide.label : "—"}</b>
          <small>{tide ? tide.summary : "not read yet"}</small>
        </div>
      </div>

      <div className="fs-levels">
        <Levels name="NIFTY 50 levels" data={setup && setup.nifty} />
        <Levels name="BANK NIFTY levels" data={setup && setup.bank} />
      </div>

      <dl className="fs-facts">
        <Fact k="Put/call ratio" v={pcr && num(pcr.nifty) ? `NIFTY ${pcr.nifty.toFixed(2)}` : "—"} sub={pcr && num(pcr.bank) ? `BANK NIFTY ${pcr.bank.toFixed(2)}` : "from the option chain"} />
        <Fact k="Max pain" v={pain && num(pain.nifty) ? `NIFTY ${pain.nifty.toLocaleString("en-IN")}` : "—"} sub={pain && num(pain.bank) ? `BANK NIFTY ${pain.bank.toLocaleString("en-IN")}` : pcr && pcr.expiry ? `expiry ${dayWords(pcr.expiry)}` : "from the option chain"} />
        <Fact k="FII, cash market" v={crore(flows && flows.fii && flows.fii.net)} valueTone={tone(flows && flows.fii && flows.fii.net)} sub={flows && flows.date ? flows.date : "NSE publishes it after the close"} />
        <Fact k="DII, cash market" v={crore(flows && flows.dii && flows.dii.net)} valueTone={tone(flows && flows.dii && flows.dii.net)} sub={flows && flows.date ? flows.date : "NSE publishes it after the close"} />
        {next.map((e) => (
          <Fact key={e.id} k={`Next ${e.id} expiry`} v={`${dayWords(e.next.date)}${away(e.next.daysLeft) ? ` · ${away(e.next.daysLeft)}` : ""}`} sub={`${e.main} ${e.next.kind || ""}`.trim()} />
        ))}
        <Fact k="F&O ban" v={ban ? (ban.length ? `${ban.length} stock${ban.length === 1 ? "" : "s"}` : "None") : "—"} sub={ban && ban.length ? ban.join(", ") : ban ? "no new F&O positions are barred" : "NSE’s list is not read yet"} />
        <Fact
          k="Your price alerts"
          v={waiting.length ? `${waiting.length} waiting` : "None waiting"}
          sub={
            fired.length
              ? `Reached: ${fired.map((a) => `${a.symbol} ${a.dir} ${price(a.price)}`).join("; ")}`
              : waiting.length
                ? waiting
                    .slice(0, 3)
                    .map((a) => `${a.symbol} ${a.dir} ${price(a.price)}`)
                    .join("; ")
                : "set one on the Desk"
          }
        />
      </dl>
      <p className="fs-note">
        A lean and levels from finished sessions, not advice. <a href={calendarHref} target="_blank" rel="noopener noreferrer">All expiry dates</a>
      </p>
    </section>
  );
}
