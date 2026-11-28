// /me's first screen, the stocks: one row of analysis for every stock on your watchlist — price and day's range, VWAP,
// volume, the waiting buy and sell quantity, the daily RSI and reading, the distance from the 52-week high, the average
// daily range and the Advisor's measured odds. Sort by any heading, narrow with the chips; a name opens it on the Desk.

import React, { useState } from "react";
import { FILTERS, num, percent, price, signed, sortRows, tone, volumeWords } from "./homeData";
import { DayRange } from "./MarketPanels";

const COLS = [
  { id: "symbol", label: "Stock", tip: "Press a name to open it on the Desk, with its chart, live call and forecasts." },
  { id: "change", label: "Price & change", tip: "The last price from Zerodha and its change from the last close. Without a live price it is the last daily close." },
  { id: "range", label: "Day’s range", tip: "Today’s low and high, with the price’s place between them." },
  { id: "vwap", label: "Vs VWAP", tip: "How far the price is above or below today’s average traded price (VWAP)." },
  { id: "volume", label: "Volume", tip: "Shares traded today." },
  { id: "book", label: "Buyers waiting", tip: "Of all the shares waiting in buy and sell orders, the part that is waiting to buy. A snapshot that changes by the second." },
  { id: "rsi", label: "RSI (daily)", tip: "The 14-day relative strength index on daily closes: above 70 is usually called stretched up, below 30 stretched down." },
  { id: "high", label: "From 52-week high", tip: "How far the last daily close is from the highest price of a year." },
  { id: "atr", label: "Avg. daily range", tip: "The average true range of a day (ATR): what the stock usually covers. A guide to how wide a stop has to be." },
  { id: "odds", label: "Advisor odds", tip: "What happened on the past days that looked most like today. A and B are backed by the forward test; C is not proven." },
];
const SORT_CHOICES = [
  ["", "Watchlist order"],
  ["change:desc", "Top gainers"],
  ["change:asc", "Top losers"],
  ["vwap:desc", "Above VWAP first"],
  ["volume:desc", "Most volume"],
  ["rsi:desc", "Highest RSI"],
  ["rsi:asc", "Lowest RSI"],
  ["odds:desc", "Best odds"],
  ["symbol:asc", "Name A to Z"],
];

const rsiWord = (x) => (!num(x) ? "" : x >= 70 ? "stretched up" : x <= 30 ? "stretched down" : "");

function Row({ r, deskOf }) {
  return (
    <tr>
      <th scope="row">
        <a href={deskOf(r.symbol)} target="_blank" rel="noopener noreferrer">
          {r.symbol}
        </a>
        <small>
          {r.reading || "no daily reading"}
          {r.banned && <em className="fs-tag is-warn">F&amp;O ban</em>}
          {r.delivery && (
            <em className="fs-tag" data-tip={`Delivered share of the last session’s volume: ${r.delivery.delivPct}%, ${r.delivery.vsAvg}× its own average.`}>
              High delivery
            </em>
          )}
        </small>
      </th>
      <td data-label="Price & change">
        <b>{price(r.last)}</b>
        <small className={tone(r.changePct)}>
          {r.change != null ? `${signed(r.change)} (${percent(r.changePct)})` : percent(r.changePct)}
          {!r.live && r.last != null ? " · daily close" : ""}
        </small>
      </td>
      <td data-label="Day’s range">
        <DayRange low={r.low} high={r.high} place={r.place} small />
      </td>
      <td data-label="Vs VWAP">
        <span className={tone(r.vsVwap)}>{percent(r.vsVwap)}</span>
        {r.vwap != null && <small>VWAP {price(r.vwap)}</small>}
      </td>
      <td data-label="Volume">{volumeWords(r.volume)}</td>
      <td data-label="Buyers waiting">
        {r.bidShare == null ? (
          "—"
        ) : (
          <>
            <span>{Math.round(r.bidShare)}%</span>
            <span className="fs-book" aria-hidden="true">
              <i style={{ width: `${r.bidShare}%` }} />
            </span>
          </>
        )}
      </td>
      <td data-label="RSI (daily)">
        {num(r.rsi) ? r.rsi.toFixed(1) : "—"}
        {rsiWord(r.rsi) && <small>{rsiWord(r.rsi)}</small>}
      </td>
      <td data-label="From 52-week high">{percent(r.fromHigh)}</td>
      <td data-label="Avg. daily range">
        {price(r.atr)}
        {num(r.atrPct) && <small>{r.atrPct.toFixed(1)}% of price</small>}
      </td>
      <td data-label="Advisor odds">
        {r.odds ? (
          <span className="fs-odds" data-tip={r.odds.warning || (r.odds.proven ? "Backed by the forward test." : "Not proven by the forward test.")}>
            <i className={`is-${r.odds.grade}`}>{r.odds.grade}</i>
            <span>
              {r.odds.text}
              <small>
                {r.odds.winPct != null ? `${Math.round(r.odds.winPct)}% made money` : ""}
                {r.odds.n != null ? ` of ${r.odds.n} like days` : ""}
              </small>
            </span>
          </span>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}

export default function WatchBoard({ rows, summary, loading, error, deskOf, advisorHref, screenerHref }) {
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState(null);
  const active = FILTERS.find((f) => f.id === filter) || FILTERS[0];
  const shown = sortRows(rows.filter(active.test), sort);
  const asOf = rows.map((r) => r.dailyAsOf).filter(Boolean).sort().pop();
  const turn = (id) => setSort((s) => (s && s.by === id ? (s.way === (id === "symbol" ? "asc" : "desc") ? { by: id, way: id === "symbol" ? "desc" : "asc" } : null) : { by: id, way: id === "symbol" ? "asc" : "desc" }));
  return (
    <section className="fs-box fs-watch" aria-labelledby="fs-watch-h" data-jump="Watchlist">
      <header className="fs-box__head">
        <h2 id="fs-watch-h">Watchlist analysis</h2>
        <a href={screenerHref} target="_blank" rel="noopener noreferrer">
          Screener
        </a>
        <a href={advisorHref} target="_blank" rel="noopener noreferrer">
          Advisor
        </a>
      </header>
      {summary.count > 0 && (
        <p className="fs-watch__sum">
          <span>
            <b>{summary.count}</b> stocks
          </span>
          {summary.best && (
            <span>
              Strongest <b>{summary.best.symbol}</b> <em className={tone(summary.best.changePct)}>{percent(summary.best.changePct)}</em>
            </span>
          )}
          {summary.worst && (
            <span>
              Weakest <b>{summary.worst.symbol}</b> <em className={tone(summary.worst.changePct)}>{percent(summary.worst.changePct)}</em>
            </span>
          )}
          <span>
            <b>{summary.proven}</b> with grade A or B odds
          </span>
        </p>
      )}
      <div className="fs-watch__bar">
        <div className="fs-chips" role="group" aria-label="Show">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label} <small>{rows.filter(f.test).length}</small>
            </button>
          ))}
        </div>
        <label className="fs-sortpick">
          <span>Sort</span>
          <select
            value={sort ? `${sort.by}:${sort.way}` : ""}
            onChange={(e) => {
              const [by, way] = e.target.value.split(":");
              setSort(by ? { by, way } : null);
            }}
          >
            {SORT_CHOICES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
            {sort && !SORT_CHOICES.some(([v]) => v === `${sort.by}:${sort.way}`) && <option value={`${sort.by}:${sort.way}`}>By heading</option>}
          </select>
        </label>
      </div>
      {!rows.length ? (
        <p className="fs-empty">{loading ? "Reading your watchlist…" : error ? `The watchlist could not be read: ${error}` : "Your watchlist is empty. Add stocks on the Desk."}</p>
      ) : !shown.length ? (
        <p className="fs-empty">No stock on your watchlist is under “{active.label}” right now.</p>
      ) : (
        <table className="fs-table fs-table--watch">
          <thead>
            <tr>
              {COLS.map((c) => (
                <th key={c.id} scope="col" aria-sort={sort && sort.by === c.id ? (sort.way === "asc" ? "ascending" : "descending") : undefined}>
                  <button type="button" onClick={() => turn(c.id)} data-tip={c.tip}>
                    {c.label}
                    <i aria-hidden="true">{sort && sort.by === c.id ? (sort.way === "asc" ? " ▲" : " ▼") : ""}</i>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <Row key={r.symbol} r={r} deskOf={deskOf} />
            ))}
          </tbody>
        </table>
      )}
      <p className="fs-note">
        RSI, the daily reading and the 52-week distance come from daily candles{asOf ? ` to ${asOf}` : ""}. Odds are how often something happened before, on this stock’s own history: not a promise, and not advice.
      </p>
    </section>
  );
}
