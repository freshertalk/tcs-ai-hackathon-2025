// Expiry — on the Calendar: every weekly and monthly derivatives expiry on NSE and BSE.
//   LISTED     read from the exchange's own contract list (a public file the server reads by itself every morning and
//              twice a day: no login, no AI). The exchange's date, with every holiday already in it.
//   SCHEDULED  beyond what the exchange has listed so far: worked out from the weekday its listed contracts fall on and
//              the holiday calendar; it becomes LISTED by itself when the contract appears.
// What has passed is hidden until you ask for it. A date the exchange moved is marked, with what it was. From 24 December
// the calendar runs to the end of the next year. The server does all of it (server/expiry.js); this only shows it.

import React, { useEffect, useMemo, useState } from "react";
import { api, peek } from "../api";
import { everyVisible } from "../visible";
import "./expiry.css";

const URL = "/api/admin/market/expiries";
const at = (d) => new Date(`${d}T00:00:00`);
const dayMonth = (d) => at(d).toLocaleDateString(undefined, { day: "2-digit", month: "short" });
const longDate = (d) => at(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const monthName = (ym) => at(`${ym}-01`).toLocaleDateString(undefined, { month: "long", year: "numeric" });
const stamp = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const inDays = (n) => (n === 0 ? "today" : n === 1 ? "tomorrow" : n > 1 ? `in ${n} days` : n === -1 ? "yesterday" : `${-n} days ago`);

/** One exchange's next expiry, as a tile. */
function Next({ x }) {
  const n = x.next;
  return (
    <div className={`xp-next ${n && n.daysLeft <= 1 ? "is-near" : ""}`}>
      <small>
        {x.id} · next expiry · {x.weekday}s
      </small>
      {n ? (
        <>
          <b>
            {n.day} {dayMonth(n.date)} <span>{inDays(n.daysLeft)}</span>
          </b>
          <span>{n.what}</span>
          {x.nextMonthly && x.nextMonthly.date !== n.date && (
            <span className="xp-dim">
              Monthly: {x.nextMonthly.day} {dayMonth(x.nextMonthly.date)} ({inDays(x.nextMonthly.daysLeft)})
            </span>
          )}
        </>
      ) : (
        <b>none left this year</b>
      )}
    </div>
  );
}

export default function ExpiryCalendar() {
  const [s, setS] = useState(() => {
    const seen = peek(URL, 10 * 60000);
    return seen ? { d: seen, error: "" } : { d: null, error: "" };
  });
  const [exchange, setExchange] = useState("all");
  const [kind, setKind] = useState("all");
  const [passed, setPassed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    let alive = true;
    const read = () =>
      api(URL)
        .then((d) => alive && setS({ d, error: "" }))
        .catch((e) => alive && setS((p) => ({ d: p.d, error: e.message })));
    read();
    const stop = everyVisible(read, 10 * 60000, { topics: ["expiry"] });
    return () => {
      alive = false;
      if (stop) stop();
    };
  }, []);
  const check = async () => {
    setBusy(true);
    setMsg("");
    try {
      const d = await api(`${URL}/refresh`, { method: "POST" });
      setS({ d, error: "" });
      const r = d.refreshed || {};
      setMsg(r.skipped ? "This server has no network access, so the list could not be read; the dates shown are worked out from the exchange's rule." : r.ok ? (r.changed ? `Read just now: ${r.changed} date${r.changed === 1 ? "" : "s"} changed.` : "Read just now: nothing changed.") : `The read failed (${r.error}); the last good list is kept.`);
    } catch (e) {
      setMsg(e.message);
    }
    setBusy(false);
  };
  const d = s.d;
  const months = useMemo(() => {
    if (!d) return [];
    const rows = d.exchanges
      .filter((x) => exchange === "all" || x.id === exchange)
      .flatMap((x) => x.rows)
      .filter((r) => (kind === "all" || r.kind === kind) && (passed || !r.past))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.exchange < b.exchange ? -1 : 1));
    const by = new Map();
    for (const r of rows) (by.get(r.date.slice(0, 7)) || by.set(r.date.slice(0, 7), []).get(r.date.slice(0, 7))).push(r);
    return [...by];
  }, [d, exchange, kind, passed]);

  if (!d)
    return (
      <section className="sr-card xp" aria-labelledby="xp-h" data-jump="Expiry">
        <div className="sr-card__head">
          <div>
            <h2 id="xp-h">Expiry</h2>
            <p>Weekly and monthly derivatives expiries on NSE and BSE</p>
          </div>
        </div>
        {s.error ? <p className="adm-alert adm-alert--info">{s.error}</p> : <p className="xp-dim">Reading the expiry calendar…</p>}
      </section>
    );

  const src = d.source;
  const hiddenPast = d.exchanges.flatMap((x) => x.rows).filter((r) => r.past && (exchange === "all" || r.exchange === exchange) && (kind === "all" || r.kind === kind)).length;
  const chip = (group, value, set, label) => (
    <button key={`${group}-${value}`} type="button" className={`xp-chip ${(group === "x" ? exchange : kind) === value ? "is-on" : ""}`} aria-pressed={(group === "x" ? exchange : kind) === value} onClick={() => set(value)}>
      {label}
    </button>
  );
  return (
    <section className="sr-card xp" aria-labelledby="xp-h" data-jump="Expiry">
      <div className="sr-card__head">
        <div>
          <h2 id="xp-h">Expiry</h2>
          <p>
            Every weekly and monthly derivatives expiry on NSE and BSE, to {longDate(d.until)}. {d.note}
          </p>
        </div>
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={check} disabled={busy || src.busy} data-tip="Read the exchanges' contract lists this minute. It also happens by itself every morning before the open and every twelve hours. No AI is used.">
          {busy || src.busy ? "Checking…" : "Check now"}
        </button>
      </div>

      <div className="xp-nexts">
        {d.exchanges.map((x) => (
          <Next key={x.id} x={x} />
        ))}
      </div>

      <p className={`xp-source ${src.error ? "is-warn" : src.checkedAt ? "is-ok" : ""}`} role="status">
        {src.checkedAt ? (
          <>
            <b>From the exchanges’ own contract lists</b> (NSE and BSE derivatives, a public file — no login and no AI). Last read {stamp(src.checkedAt)}; read again by itself every morning and every twelve hours.
            {src.error ? ` The latest read failed (${src.error}); the last good list is kept.` : ""}
          </>
        ) : src.on ? (
          <>
            <b>Not read yet.</b> The exchanges’ contract lists are read by themselves a few moments after the server starts{src.error ? ` — the first try failed (${src.error}) and is repeated in half an hour` : ""}. Until then every date is worked out from the exchange’s rule and the holiday calendar.
          </>
        ) : (
          <>
            <b>Worked out from the exchange’s rule.</b> This server cannot reach the exchanges’ contract lists, so every date is the rule’s: the usual weekday, moved back for a holiday.
          </>
        )}
      </p>
      {msg && <p className="adm-alert adm-alert--info">{msg}</p>}

      {d.changes.length > 0 && (
        <div className="xp-changes" aria-label="Dates that changed">
          <b>Changed since it was first shown</b>
          <ul>
            {d.changes.slice(0, 5).map((c, i) => (
              <li key={`${c.at}-${i}`}>
                {c.text} <small>noticed {stamp(c.at)}</small>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="xp-bar">
        <div className="xp-chips" role="group" aria-label="Exchange">
          {chip("x", "all", setExchange, "NSE and BSE")}
          {d.exchanges.map((x) => chip("x", x.id, setExchange, `${x.id} (${x.weekday})`))}
        </div>
        <div className="xp-chips" role="group" aria-label="Kind">
          {chip("k", "all", setKind, "Weekly and monthly")}
          {chip("k", "weekly", setKind, "Weekly")}
          {chip("k", "monthly", setKind, "Monthly")}
        </div>
        <label className="xp-check" data-tip="Expiries that have already happened this year are hidden until you tick this.">
          <input type="checkbox" checked={passed} onChange={(e) => setPassed(e.target.checked)} /> Show passed ({hiddenPast})
        </label>
      </div>

      {months.length === 0 ? (
        <p className="xp-dim">No expiry is left to show for this choice{passed ? "" : ". Tick “Show passed” to see the ones that have gone"}.</p>
      ) : (
        months.map(([ym, rows]) => (
          <div className="xp-month" key={ym}>
            <h3>{monthName(ym)}</h3>
            <ul className="xp-list">
              {rows.map((r) => (
                <li key={`${r.exchange}-${r.nominal}`} className={`xp-row ${r.past ? "is-past" : ""} ${r.kind === "monthly" ? "is-monthly" : ""} ${!r.past && r.daysLeft <= 1 ? "is-near" : ""}`}>
                  <span className="xp-date">
                    <b>{dayMonth(r.date)}</b>
                    <small>{r.day}</small>
                  </span>
                  <span className={`xp-ex xp-ex--${r.exchange.toLowerCase()}`}>{r.exchange}</span>
                  <span className="xp-what">
                    {r.what}
                    {r.moved && (
                      <small className="xp-moved" data-tip={r.why}>
                        moved from {at(r.nominal).toLocaleDateString(undefined, { weekday: "short" })} {dayMonth(r.nominal)}
                        {r.why ? `: ${r.why.replace(/^\w+ \d{4}-\d{2}-\d{2} is /, "").replace(/, so it expires on the trading day before$/, "")}` : ""}
                      </small>
                    )}
                  </span>
                  <span className="xp-tags">
                    <i className={`xp-pill xp-pill--${r.kind}`}>{r.kind}</i>
                    {r.past ? (
                      <i className="xp-pill xp-pill--past">passed</i>
                    ) : r.status === "listed" ? (
                      <i className="xp-pill xp-pill--listed" data-tip="Read from the exchange's own contract list: this is the exchange's date.">
                        listed
                      </i>
                    ) : (
                      <i className="xp-pill xp-pill--scheduled" data-tip={`Beyond what the exchange has listed so far: worked out from its usual weekday and the holiday calendar. It is confirmed by itself when the exchange lists the contract.${r.uncertain ? " The holiday list for that year is not in the desk yet, so this date may move by a day." : ""}`}>
                        scheduled{r.uncertain ? " · may move" : ""}
                      </i>
                    )}
                    {!r.past && <small className="xp-when">{inDays(r.daysLeft)}</small>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}

      <div className="hc__foot">
        {d.ahead.length > 0 && (
          <p>
            Already listed by the exchanges for next year: {d.ahead.map((a) => `${a.exchange} ${a.kind} ${a.day} ${longDate(a.date)}`).join(" · ")}. The whole of next year is added here by itself on 24 December.
          </p>
        )}
        {!d.holidaysKnown && <p>The holiday list for {d.until.slice(0, 4)} is not in the desk yet: a scheduled date that falls on a holiday will move to the trading day before, and is corrected by itself when the exchange lists the contract.</p>}
        <details className="xp-rule">
          <summary>How these dates are found</summary>
          <p>{d.rule}</p>
        </details>
      </div>
    </section>
  );
}
