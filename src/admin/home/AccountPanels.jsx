// /me's first screen, your half: funds, positions and holdings from your own Zerodha account, what needs a look now, and
// every open position with what protects it in today's order book. Read only — nothing here places, changes or cancels an
// order. The money here is yours: these blocks are in MONEY_ZONES, so "Hide amounts" stars them (privacy.jsx).

import React from "react";
import { num, percent, pnlWords, price, rupees, tone } from "./homeData";
import { istTime } from "./MarketPanels";

const plural = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;

function Row({ k, v, valueTone }) {
  return (
    <div className="fs-line">
      <dt>{k}</dt>
      <dd className={valueTone || ""}>{v}</dd>
    </div>
  );
}

function Funds({ equity, error }) {
  return (
    <div className="fs-fig">
      <h3>Margin available</h3>
      <b className="fs-big">{equity ? rupees(equity.available) : "—"}</b>
      {equity && num(equity.usedPct) && (
        <span className="fs-meter" role="img" aria-label={`${Math.round(equity.usedPct)}% of the equity margin is in use`}>
          <i style={{ width: `${Math.min(100, equity.usedPct)}%` }} className={equity.usedPct >= 80 ? "is-high" : ""} />
        </span>
      )}
      {equity ? (
        <dl>
          <Row k="Margins used" v={rupees(equity.used)} />
          <Row k="Opening balance" v={rupees(equity.opening)} />
          <Row k="Share in use" v={num(equity.usedPct) ? `${equity.usedPct.toFixed(1)}%` : "—"} />
        </dl>
      ) : (
        <p className="fs-dim">{error ? `Funds could not be read: ${error}` : "No equity funds in Zerodha’s answer."}</p>
      )}
    </div>
  );
}

function Positions({ n, room, error }) {
  return (
    <div className="fs-fig">
      <h3>Positions · total P&amp;L</h3>
      <b className={`fs-big ${n ? tone(n.total) : ""}`}>{n ? pnlWords(n.total) : "—"}</b>
      {n ? (
        <>
          <p className="fs-sub">
            {n.open ? `${n.open} open (${n.longs} long, ${n.shorts} short)` : "No open position"}
            {n.closed ? ` · ${n.closed} closed today` : ""}
          </p>
          <dl>
            <Row k="Booked P&L" v={pnlWords(n.booked)} valueTone={tone(n.booked)} />
            <Row k="Open P&L" v={pnlWords(n.unrealised)} valueTone={tone(n.unrealised)} />
            <Row k="Given back if all stops fill" v={n.open ? rupees(n.giveBack) : "—"} />
            {room && num(room.loss) && <Row k="Loss room left today" v={rupees(room.loss)} />}
          </dl>
        </>
      ) : (
        <p className="fs-dim">{error ? `Positions could not be read: ${error}` : "Not read yet."}</p>
      )}
    </div>
  );
}

function Holdings({ h, error }) {
  const i = h && h.insights;
  return (
    <div className="fs-fig">
      <h3>Holdings · total P&amp;L</h3>
      <b className={`fs-big ${h ? tone(h.holdPnl) : ""}`}>{h ? pnlWords(h.holdPnl) : "—"}</b>
      {h ? (
        <>
          <p className="fs-sub">
            {i ? `${plural(i.count, "stock")} · ${i.inProfit} in profit, ${i.inLoss} in loss` : "No holding"}
            {i && num(h.holdPnlPct) ? ` · ${percent(h.holdPnlPct)}` : ""}
          </p>
          <dl>
            <Row k="Current value" v={rupees(h.current)} />
            <Row k="Invested" v={rupees(h.invested)} />
            <Row k="Today’s change" v={pnlWords(h.holdDay)} valueTone={tone(h.holdDay)} />
            {i && i.bestToday && <Row k="Best today" v={`${i.bestToday.symbol} ${percent(i.bestToday.dayPct)}`} valueTone={tone(i.bestToday.dayPct)} />}
            {i && i.worstToday && <Row k="Worst today" v={`${i.worstToday.symbol} ${percent(i.worstToday.dayPct)}`} valueTone={tone(i.worstToday.dayPct)} />}
          </dl>
        </>
      ) : (
        <p className="fs-dim">{error ? `Holdings could not be read: ${error}` : "Not read yet."}</p>
      )}
    </div>
  );
}

export function AccountPanel({ status, account, error, positionsHref, deskHref }) {
  const connected = Boolean(status && status.connected);
  return (
    <section className="fs-box fs-acct" aria-labelledby="fs-acct-h" data-jump="Account">
      <header className="fs-box__head">
        <h2 id="fs-acct-h">Your account</h2>
        {status && (
          <span className={`fs-pill ${status.enabled ? "is-live" : ""}`} data-tip="The master switch for orders from this site. It is changed on the Positions page.">
            Trading {status.enabled ? "ON: orders can be sent" : "OFF"}
          </span>
        )}
        <a href={positionsHref} target="_blank" rel="noopener noreferrer">
          Positions &amp; orders
        </a>
      </header>
      {!status ? (
        <p className="fs-dim">{error ? `Your account could not be read: ${error}` : "Reading your account…"}</p>
      ) : !connected ? (
        <p className="fs-empty">
          Zerodha is not connected. Log in on the Desk to see your funds, positions and holdings here.{" "}
          <a href={deskHref} target="_blank" rel="noopener noreferrer">
            Open the Desk
          </a>
        </p>
      ) : !account ? (
        <p className="fs-dim">{error ? `Your account could not be read: ${error}` : "Reading funds, positions and holdings…"}</p>
      ) : (
        <>
          <div className="fs-figs">
            <Funds equity={account.equity} error={account.errors.funds} />
            <Positions n={account.numbers} room={account.room} error={account.errors.positions} />
            <Holdings h={account.holdings} error={account.errors.holdings} />
          </div>
          {account.stats && (
            <p className="fs-orders">
              <span>
                Today’s orders: <b>{account.stats.waiting}</b> waiting
              </span>
              <span>
                <b>{account.stats.complete}</b> filled
              </span>
              <span className={account.stats.rejected ? "is-down" : ""}>
                <b>{account.stats.rejected}</b> rejected
              </span>
              <span>
                <b>{account.stats.cancelled}</b> cancelled
              </span>
              <span>
                <b>{account.stats.fills}</b> trades · turnover <b>{rupees(account.stats.turnover, 0)}</b>
              </span>
              {account.at && <span className="fs-dim">read {istTime(account.at)} IST{error ? " · the latest reading failed" : ""}</span>}
            </p>
          )}
          <div className="fs-attn" aria-live="polite">
            <h3>Needs a look now</h3>
            {account.attention.length ? (
              <ul>
                {account.attention.map((a) => (
                  <li key={a.id} className={`is-${a.level}`}>
                    <i aria-hidden="true">{a.level === "danger" ? "!" : "•"}</i>
                    <span>{a.text}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>Nothing in today’s positions and orders is flagged.</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export function PositionsNow({ account, deskOf, positionsHref }) {
  if (!account || !account.open.length) return null;
  return (
    <section className="fs-box fs-pos" aria-labelledby="fs-pos-h" data-jump="Open positions">
      <header className="fs-box__head">
        <h2 id="fs-pos-h">Open positions ({account.open.length})</h2>
        <a href={positionsHref} target="_blank" rel="noopener noreferrer">
          Manage on Positions
        </a>
      </header>
      <table className="fs-table fs-table--pos">
        <thead>
          <tr>
            <th scope="col">Instrument</th>
            <th scope="col">Qty.</th>
            <th scope="col">Avg. price</th>
            <th scope="col">LTP</th>
            <th scope="col">Day</th>
            <th scope="col">P&amp;L</th>
            <th scope="col">Return</th>
            <th scope="col">Stop order</th>
            <th scope="col">Target order</th>
          </tr>
        </thead>
        <tbody>
          {account.open.map((p) => (
            <tr key={p.key}>
              <th scope="row">
                <a href={deskOf(p.symbol)} target="_blank" rel="noopener noreferrer">
                  {p.symbol}
                </a>
                <small>
                  {p.exchange} · {p.product}
                  {p.squareOff ? ` · squared off ${p.squareOff}` : ""}
                </small>
              </th>
              <td data-label="Qty." className={p.qty > 0 ? "is-long" : "is-short"}>
                {p.qty > 0 ? "+" : "−"}
                {Math.abs(p.qty).toLocaleString("en-IN")}
              </td>
              <td data-label="Avg. price">{price(p.average)}</td>
              <td data-label="LTP">{price(p.last)}</td>
              <td data-label="Day" className={tone(p.dayPct)}>
                {percent(p.dayPct)}
              </td>
              {/* the figure sits in the cell itself: a second element would be starred a second time */}
              <td data-label="P&L" className={`fs-strong ${tone(p.pnl)}`}>
                {pnlWords(p.pnl)}
              </td>
              <td data-label="Return" className={tone(p.pnlPct)}>
                {percent(p.pnlPct)}
              </td>
              <td data-label="Stop order">
                {p.stop ? (
                  <>
                    {price(p.stop.price)}
                    <small>
                      {percent(p.stop.away)} away{p.cover === "partial" ? " · part of the quantity" : ""}
                    </small>
                  </>
                ) : (
                  <span className="fs-flag">No stop order</span>
                )}
              </td>
              <td data-label="Target order">
                {p.target ? (
                  <>
                    {price(p.target.price)}
                    <small>{percent(p.target.away)} away</small>
                  </>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="fs-note">Stops and targets are the orders waiting in today’s order book. GTT triggers are not part of it.</p>
    </section>
  );
}
