// The next trading day on /me (23 Nov 2026): the date, the weekday and the times of the next NSE session after today —
// when tomorrow is a holiday (or a weekend) it is the day after, and so on — with a live countdown, the days skipped and
// why, today's state, and whether the calendar is NSE's own official list.
//
// One calendar: the server's /api/admin/market/next-session answers from market/nse-holidays.js — the same trading-day
// rules every service uses — which reads NSE's official holiday list (holidays/nse-service.js, checked every six hours).
// The Calendar page's "BSE / NSE holidays" shows that same list. Nothing here keeps its own holiday table.
//
// Asked ONCE (the owner's rule, 23 Nov 2026: "don't check multiple times"): when the page opens, then only when the day
// changes (midnight IST) or the server says NSE's list changed (live topic "holidays"). The server itself reads NSE once
// a weekday after the 3:30 PM close. Today's state (before the open, pre-open, open, closed for the day) is worked out
// here from the times in the answer and NSE's clock (clock/exchangeClock.js), so it flips on the second without asking.

import "./next-session.css";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { onTopics } from "./live";
import { adminPath } from "./paths";
import { exchangeNow, istParts, startExchangeClock, useExchangeNow } from "./clock/exchangeClock";


/**
 * The next-session answer. Returns { data, status: "loading" | "ready" | "error", skew, reload }. `skew` stays 0: every
 * time here is NSE's (exchangeNow), so there is nothing to correct.
 */
export function useNextSession() {
  const [state, setState] = useState({ status: "loading", data: null, skew: 0 });
  const alive = useRef(true);
  const load = useCallback(() => {
    return api("/api/admin/market/next-session")
      .then((d) => {
        if (!alive.current) return;
        if (!d || !d.next || !d.today) {
          setState((s) => ({ ...s, status: s.data ? "ready" : "error" }));
          return;
        }
        setState({ status: "ready", data: d, skew: 0 });
      })
      .catch(() => alive.current && setState((s) => ({ ...s, status: s.data ? "ready" : "error" })));
  }, []);
  useEffect(() => {
    alive.current = true;
    startExchangeClock();
    load();
    // NSE's list changed at the source (the server's daily check, or Check now): ask again
    const unlive = onTopics(["holidays"], () => load());
    return () => {
      alive.current = false;
      unlive();
    };
  }, [load]);
  // a new day (midnight IST): ask again, once — and when the tab comes back after midnight
  const today = state.data ? state.data.today.date : null;
  useEffect(() => {
    if (!today) return undefined;
    const p = istParts(exchangeNow());
    const toMidnight = ((24 * 60 - p.minute) * 60 - p.ss) * 1000 + 1500;
    const id = setTimeout(load, Math.max(1000, toMidnight)); // at most a day: within what a timer can wait
    const back = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      if (istParts(exchangeNow()).date !== today) load();
    };
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", back);
    if (typeof window !== "undefined") window.addEventListener("focus", back);
    return () => {
      clearTimeout(id);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", back);
      if (typeof window !== "undefined") window.removeEventListener("focus", back);
    };
  }, [today, load]);
  return { ...state, reload: load };
}

/** Today's state from the answer's times and NSE's clock — the same rules as the server, worked out to the second. */
export function todayNow(today, now) {
  if (!today || !today.trading || !Number.isFinite(today.opensAt)) return today;
  if (now < today.preOpenAt) return { ...today, status: "before-open", text: `Opens today at ${today.openClock} (pre-open ${today.preOpenClock})` };
  if (now < today.opensAt) return { ...today, status: "pre-open", text: `Pre-open now · opens at ${today.openClock}` };
  if (now < today.closesAt) return { ...today, status: "open", text: `Market open · closes at ${today.closeClock}` };
  return { ...today, status: "closed-for-day", text: `Closed for the day (closed at ${today.closeClock})` };
}

/** "1 d 14 h", "2 h 5 min", "4 min", "under a minute" */
export function countdown(ms) {
  if (!Number.isFinite(ms)) return "";
  if (ms <= 0) return "now";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "under a minute";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h${min % 60 ? ` ${min % 60} min` : ""}`;
  const d = Math.floor(h / 24);
  return `${d} d${h % 24 ? ` ${h % 24} h` : ""}`;
}

/** NSE's time now (clock/exchangeClock.js), turning over on the edge of each exchange second. */
function useNow() {
  return useExchangeNow(1000);
}

const istClock = (ms) => new Date(ms).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }).replace(/\s?(am|pm)$/i, (m) => ` ${m.trim().toUpperCase()}`);
const checkedAt = (iso) => {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const sameDay = new Date(t).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) === new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return sameDay ? istClock(t) : new Date(t).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
};

/** Weekend days in a row become one line ("Sat 28 – Sun 29 Nov: weekend"); each holiday is its own line. */
function skippedLines(skipped) {
  const out = [];
  for (const s of skipped || []) {
    const last = out[out.length - 1];
    if (s.reason === "weekend" && !s.name && last && last.reason === "weekend" && !last.name) {
      last.to = s;
      continue;
    }
    out.push({ ...s, to: null });
  }
  return out;
}

const STATUS_TONE = { open: "ok", "pre-open": "warn", "before-open": "idle", "closed-for-day": "idle", holiday: "hol", weekend: "idle" };

/**
 * The strip. `place` is "main" (the top of the page beside the side column, wide screens) or "side" (under the greeting,
 * narrow screens) — the page draws both and CSS shows the one that is on top for the screen.
 */
export default function NextSession({ ns, place = "main", calendarHref, children = null }) {
  const d = ns && ns.data;
  const now = useNow();
  const id = `ns-h-${place}`;
  const cal = calendarHref || `${adminPath("/stock-report")}?view=calendar`;
  if (!ns || ns.status === "error") return null;
  if (!d) {
    return (
      <section className={`ns ns--${place} is-loading`} aria-label="Next trading day" aria-busy="true">
        <span className="ns__shimmer" />
        <span className="ns__shimmer ns__shimmer--short" />
      </section>
    );
  }
  const { next, verify, calendar } = d;
  const today = todayNow(d.today, now);
  const lines = skippedLines(d.skipped);
  const later = (d.upcoming || []).find((u) => !(d.skipped || []).some((s) => s.date === u.date));
  const todayTone = STATUS_TONE[today.status] || "idle";
  const todayLeft =
    today.status === "open" ? `closes in ${countdown(today.closesAt - now)}` : today.status === "pre-open" || today.status === "before-open" ? `opens in ${countdown(today.opensAt - now)}` : "";
  const vTone = verify.status === "match" ? "ok" : verify.status === "differs" ? "warn" : "idle";
  const checked = checkedAt(calendar.lastSuccessAt);
  return (
    <section className={`ns ns--${place}`} aria-labelledby={id}>
      <span className="ns__ico" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" />
          <path d="M9 15l2 2 4-4" />
        </svg>
      </span>

      <div className="ns__when">
        <h2 id={id} className="ns__k">
          Next trading day{next.daysAway === 1 ? " · tomorrow" : ""}
        </h2>
        <p className="ns__date">
          <time dateTime={next.date}>{next.label}</time>
        </p>
        <p className="ns__times">
          <span>
            Pre-open <b>{next.preOpenClock}</b>
          </span>
          <span>
            Opens <b>{next.openClock}</b>
          </span>
          <span data-tip={next.closingAuction ? next.closingAuction.text : undefined}>
            Closes <b>{next.closeClock}</b>
          </span>
          <span className="ns__tz">IST</span>
        </p>
        {next.special && <p className="ns__special">Special session: {next.special}</p>}
      </div>

      <div className="ns__count" aria-live="off">
        <span className="ns__k">Opens in</span>
        <b className="ns__left">{countdown(next.opensAt - now)}</b>
        {next.closingAuction && <small>{next.closingAuction.text}</small>}
      </div>

      <div className="ns__side">
        <p className={`ns__today is-${todayTone}`}>
          <i aria-hidden="true" />
          <span>
            <b>Today, {today.short}:</b> {today.text}
            {todayLeft ? ` · ${todayLeft}` : ""}
          </span>
        </p>
        <p className="ns__now">Now {istClock(now)} IST</p>
      </div>

      {(lines.length > 0 || later) && (
        <ul className="ns__skips" aria-label="Days the market is shut before then">
          {lines.map((s) => (
            <li key={s.date} className={`is-${s.reason}`}>
              <b>
                {s.short}
                {s.to ? ` – ${s.to.short}` : ""}
              </b>
              {s.reason === "holiday" ? (
                <>
                  {" "}
                  market holiday · <span className="ns__hol">{s.name}</span>
                </>
              ) : (
                <> weekend{s.name ? ` · ${s.name}` : ""}</>
              )}
            </li>
          ))}
          {later && (
            <li className="is-later">
              <b>Next holiday:</b> {later.short} · {later.name}
              {later.daysAway > 1 ? ` · in ${later.daysAway} days` : ""}
            </li>
          )}
        </ul>
      )}

      {/* what the page adds under the dates (/me: your trading days) */}
      {children ? <div className="ns__days">{children}</div> : null}

      <p className={`ns__verify is-${vTone}`}>
        <i aria-hidden="true">{vTone === "ok" ? "✓" : vTone === "warn" ? "!" : "·"}</i>
        <span>
          {verify.status === "match" ? (
            <>
              Matches{" "}
              <a href={calendar.sourceUrl} target="_blank" rel="noopener noreferrer">
                NSE’s official calendar
              </a>
              {checked ? ` · checked ${checked}` : ""}
            </>
          ) : (
            verify.text
          )}
        </span>
        <a className="ns__more" href={cal} target="_blank" rel="noopener noreferrer" data-tip="The full BSE / NSE holiday list on the Calendar page (the same list), in a new tab.">
          Holiday list
        </a>
      </p>
    </section>
  );
}

/**
 * The status row's "NSE session" card from the same answer: the state now and when it opens next by NSE's calendar.
 * Returns null without an answer (the row keeps its clock-only reading then).
 */
export function sessionCard(ns, now = exchangeNow()) {
  const d = ns && ns.data;
  if (!d) return null;
  const t = now + (ns.skew || 0);
  const today = todayNow(d.today, t);
  const { next } = d;
  if (today.status === "open") return { id: "open", label: "Open", sub: `closes in ${countdown(today.closesAt - t)} · ${today.closeClock} IST` };
  if (today.status === "pre-open") return { id: "pre", label: "Pre-open", sub: `opens in ${countdown(today.opensAt - t)} · ${today.openClock} IST` };
  if (today.status === "before-open") return { id: "closed", label: "Closed", sub: `opens today at ${today.openClock} IST` };
  const when = next.daysAway === 1 ? "tomorrow" : next.short;
  return { id: "closed", label: today.status === "holiday" ? "Holiday" : "Closed", sub: `opens ${when} at ${next.openClock} IST` };
}
