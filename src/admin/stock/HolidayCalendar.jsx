import React, { useMemo, useState } from "react";
import {
  INDIA_META,
  INDIA_YEARS,
  daysBetween,
  formatDate,
  indiaFreshness,
  indiaHolidays,
  isWeekend,
  nextClosure,
  resolveNasdaq,
  todayIn,
  weekdayClosures,
} from "./holidays";
import { useOfficialHolidays } from "./useOfficialHolidays";

// Both calendars share this component; only the data, time zone and wording differ.
const MARKETS = {
  india: {
    id: "bse-nse",
    title: "BSE / NSE holidays",
    sub: "India · equity and equity derivatives",
    tz: "Asia/Kolkata",
    // published data: only the years the exchanges have announced, plus the next one
    years: () => [...INDIA_YEARS, Math.max(...INDIA_YEARS) + 1],
    source: [
      { label: "NSE", href: "https://www.nseindia.com/resources/exchange-communication-holidays" },
      { label: "BSE", href: "https://www.bseindia.com/static/markets/marketinfo/listholi.aspx" },
    ],
    emptyText: (y) =>
      `The exchanges have not published the ${y} list yet — they usually do in December. It will appear here once it is out.`,
    foot: "Currency, commodity and other segments can follow a different calendar. The exchanges can add closures at short notice (elections, for example) — check the exchange before relying on a date.",
  },
  nasdaq: {
    id: "nasdaq",
    title: "NASDAQ holidays",
    sub: "United States · NYSE follows the same days",
    tz: "America/New_York",
    years: (thisYear) => [thisYear - 1, thisYear, thisYear + 1, thisYear + 2],
    source: [{ label: "Nasdaq Trader", href: "https://www.nasdaqtrader.com/trader.aspx?id=Calendar" }],
    emptyText: () => "",
    foot: "Weekend holidays are observed on the nearest weekday. Rare one-off closures (such as national days of mourning) appear here as soon as the exchange lists them.",
  },
};

const stamp = (iso) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
const monthOf = (date) => formatDate(date, { month: "long", year: "numeric" });

/** One line saying where the list on screen came from and how fresh it is. */
function SourceStrip({ tone, children, action }) {
  return (
    <div className={`hc__source hc__source--${tone}`} role="status">
      <i aria-hidden="true" />
      <p>{children}</p>
      {action}
    </div>
  );
}

function NasdaqSource({ view, hook, year }) {
  const { status, data, error, busy, checkNow } = hook;
  const feed = data && data.nasdaq;

  const button = (
    <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={checkNow} disabled={busy}>
      {busy ? "Checking…" : "Check now"}
    </button>
  );

  if (status === "unreachable" && !feed) {
    return (
      <SourceStrip tone="warn" action={button}>
        <b>Can’t reach the server</b> ({error}) — showing the calendar calculated from the exchange’s rules, not its
        published list.
      </SourceStrip>
    );
  }
  if (status === "loading" || !feed) {
    return <SourceStrip tone="idle">Checking the official source…</SourceStrip>;
  }

  const failed = feed.lastError ? (
    <>
      {" "}
      The latest check failed (<i>{feed.lastError}</i>); the last good copy is kept.
    </>
  ) : null;

  if (view.source === "official") {
    const s = view.snapshot;
    return (
      <>
        <SourceStrip tone={feed.lastError ? "warn" : "ok"} action={button}>
          <b>Official list</b> from{" "}
          <a href={feed.sourceUrl} target="_blank" rel="noopener noreferrer">
            {feed.sourceName}
          </a>
          . Checked {stamp(feed.lastSuccessAt)}; the list last changed {stamp(s.changedAt)}.{failed}
        </SourceStrip>
        {view.differences.length > 0 && (
          <SourceStrip tone="warn">
            <b>Heads-up:</b> the official list differs from the rule-based calendar on{" "}
            {view.differences.map((d) => formatDate(d, { day: "numeric", month: "short" })).join(", ")}. The official list
            is what is shown.
          </SourceStrip>
        )}
      </>
    );
  }

  // the server has never managed to read the official page
  if (!feed.lastSuccessAt) {
    return (
      <SourceStrip tone="warn" action={button}>
        <b>Calculated from the exchange’s rules</b> — the official list has not been fetched yet. The server checks
        every few hours; use “Check now” to try straight away.{failed}
      </SourceStrip>
    );
  }

  // fetched fine, but the exchange has not published this particular year
  return (
    <SourceStrip tone="warn" action={button}>
      <b>Calculated from the exchange’s rules</b> — Nasdaq Trader has not published {year} yet. Last checked{" "}
      {stamp(feed.lastSuccessAt)}; it is re-checked automatically and switches to the official list as soon as it
      appears.{failed}
    </SourceStrip>
  );
}

function IndiaSource({ today }) {
  const fresh = indiaFreshness(today);
  return (
    <>
      <SourceStrip tone="idle">
        <b>Checked by hand</b> on {formatDate(INDIA_META.verifiedOn, { day: "numeric", month: "short", year: "numeric" })}{" "}
        against {INDIA_META.basis}. <b>Not updated automatically</b> — the exchanges publish it only on pages that block
        automated requests.
      </SourceStrip>
      {fresh.state === "stale" && (
        <SourceStrip tone="warn">
          <b>May be out of date.</b> {fresh.text} Check the exchange’s list below.
        </SourceStrip>
      )}
    </>
  );
}

export default function HolidayCalendar({ market }) {
  const m = MARKETS[market];
  const isNasdaq = market === "nasdaq";
  const hook = useOfficialHolidays(isNasdaq);

  const today = todayIn(m.tz);
  const thisYear = Number(today.slice(0, 4));
  // only what is still to come: past years are not offered, and days already gone are hidden
  const years = useMemo(() => m.years(thisYear).filter((y) => y >= thisYear), [m, thisYear]);

  const entriesFor = (y, official) => (isNasdaq ? resolveNasdaq(y, official) : { entries: indiaHolidays(y), source: "manual", differences: [] });
  const ahead = (list) => list.filter((e) => e.date >= today);
  const official = hook.data && hook.data.nasdaq;

  // start on the current year while it has closures left, else the next year that has any
  const firstYear = years.find((y) => ahead(entriesFor(y, null).entries).length) || years[0];
  const [year, setYear] = useState(firstYear);

  const view = useMemo(() => entriesFor(year, official), [year, official, isNasdaq]); // eslint-disable-line react-hooks/exhaustive-deps
  const allOfYear = view.entries;
  const entries = useMemo(() => allOfYear.filter((e) => e.date >= today), [allOfYear, today]);
  const gone = allOfYear.length - entries.length;
  const next = useMemo(() => nextClosure(entries, today), [entries, today]);
  const closures = weekdayClosures(entries);
  const weekendOnes = entries.filter((e) => e.kind === "closed" && isWeekend(e.date)).length;

  // group by month, keeping order
  const groups = [];
  for (const e of entries) {
    const key = monthOf(e.date);
    if (!groups.length || groups[groups.length - 1].key !== key) groups.push({ key, rows: [] });
    groups[groups.length - 1].rows.push(e);
  }

  return (
    <section className="sr-card" id={m.id} aria-labelledby={`${m.id}-h`}>
      <header className="sr-card__head">
        <div>
          <h2 id={`${m.id}-h`}>{m.title}</h2>
          <p>{m.sub}</p>
        </div>
        <label className="sr-year">
          <span className="adm-sr">Year</span>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label={`${m.title} — year`}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </header>

      {isNasdaq ? <NasdaqSource view={view} hook={hook} year={year} /> : <IndiaSource today={today} />}

      {entries.length === 0 ? (
        <p className="adm-alert adm-alert--info">
          {allOfYear.length === 0
            ? m.emptyText(year)
            : `No more closures in ${year}.${years.includes(year + 1) ? " Pick the next year above to see what comes after." : ""}`}
        </p>
      ) : (
        <>
          <div className="hc__summary">
            <span>
              <b>{closures.length}</b> closed weekday{closures.length === 1 ? "" : "s"} {year === thisYear ? "left" : "ahead"}
            </span>
            {weekendOnes > 0 && (
              <span>
                <b>{weekendOnes}</b> more on weekends
              </span>
            )}
            {gone > 0 && (
              <span className="hc__gone" data-tip="Holidays earlier this year are hidden: only the ones still to come are listed.">
                {gone} already passed, hidden
              </span>
            )}
            {year === thisYear && next && (
              <span className="hc__next">
                Next: <b>{next.name}</b> · {formatDate(next.date, { weekday: "short", day: "numeric", month: "short" })}
                {" · "}
                {daysBetween(today, next.date) === 0
                  ? "today"
                  : daysBetween(today, next.date) === 1
                    ? "tomorrow"
                    : `in ${daysBetween(today, next.date)} days`}
              </span>
            )}
            {year === thisYear && !next && <span className="hc__next">No more closures this year</span>}
          </div>

          {groups.map((g) => (
            <div key={g.key} className="hc__month">
              <h3>{g.key}</h3>
              <ul className="hc__list">
                {g.rows.map((e) => {
                  const weekend = isWeekend(e.date);
                  const isNext = next && e.date === next.date && year === thisYear;
                  return (
                    <li
                      key={`${e.date}-${e.name}`}
                      className={`hc__row hc__row--${e.kind} ${isNext ? "is-next" : ""}`}
                    >
                      <time dateTime={e.date} className="hc__date">
                        <b>{Number(e.date.slice(8))}</b>
                        <span>{formatDate(e.date, { weekday: "short" })}</span>
                      </time>
                      <span className="hc__what">
                        <span className="hc__name">{e.name}</span>
                        {(e.note || (weekend && e.kind === "closed")) && (
                          <small>
                            {e.note}
                            {weekend && e.kind === "closed" && !e.note ? "Falls on a weekend — no trading day lost" : ""}
                          </small>
                        )}
                      </span>
                      <span className="hc__tags">
                        {isNext && <i className="hc__pill hc__pill--next">Next</i>}
                        {e.tag && <i className="hc__pill hc__pill--tag">{e.tag}</i>}
                        {e.kind === "closed" && (
                          <i className={`hc__pill ${weekend ? "hc__pill--weekend" : "hc__pill--closed"}`}>
                            {weekend ? "Weekend" : "Closed"}
                          </i>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </>
      )}

      <footer className="hc__foot">
        <p>{m.foot}</p>
        <p>
          Official lists:{" "}
          {m.source.map((s, i) => (
            <React.Fragment key={s.label}>
              {i > 0 && " · "}
              <a href={s.href} target="_blank" rel="noopener noreferrer">
                {s.label}
              </a>
            </React.Fragment>
          ))}
        </p>
      </footer>
    </section>
  );
}
