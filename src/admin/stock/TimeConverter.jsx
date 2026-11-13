// Convert a time from any of the world's time zones into any other. The browser's own time
// zone database supplies the rules, so daylight saving is always right.

import React, { useMemo, useState } from "react";
import { allZones, currentZoneName, dateToWallTime, formatUtcOffset, tzOffsetMinutes, wallTimeToDate } from "./timezones";

const label = (tz) => tz.replace(/_/g, " ").replace(/\//g, " / ");
const PRESETS = [
  ["Asia/Kolkata", "India"],
  ["America/New_York", "New York"],
  ["Europe/London", "London"],
  ["Asia/Singapore", "Singapore"],
  ["Asia/Tokyo", "Tokyo"],
  ["Asia/Dubai", "Dubai"],
];

function ZonePick({ id, value, onChange, zones, title }) {
  return (
    <label className="tzc__zone" htmlFor={id}>
      <span>{title}</span>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {zones.map((z) => (
          <option key={z} value={z}>
            {label(z)} ({formatUtcOffset(tzOffsetMinutes(z))})
          </option>
        ))}
      </select>
    </label>
  );
}

export default function TimeConverter() {
  const zones = useMemo(() => allZones(), []);
  const here = useMemo(() => {
    try {
      return currentZoneName(Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata");
    } catch (_) {
      return "Asia/Kolkata";
    }
  }, []);
  const [from, setFrom] = useState(zones.includes(here) ? here : "Asia/Kolkata");
  const [to, setTo] = useState(from === "America/New_York" ? "Asia/Kolkata" : "America/New_York");
  const [when, setWhen] = useState(() => dateToWallTime(new Date(), from));

  const moment = wallTimeToDate(when, from);
  const result = moment ? dateToWallTime(moment, to) : "";
  const pretty = (wall, tz) => {
    if (!wall) return "—";
    const d = wallTimeToDate(wall, tz);
    return d ? new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d) : "—";
  };
  const gap = moment ? (tzOffsetMinutes(to, moment) - tzOffsetMinutes(from, moment)) / 60 : 0;
  const swap = () => {
    setFrom(to);
    setTo(from);
    if (result) setWhen(result);
  };

  return (
    <section className="sr-card tzc" aria-labelledby="tzc-h">
      <header className="sr-card__head">
        <h2 id="tzc-h">Time zone converter</h2>
        <p>Pick a date and time in one zone; see it in another. Every zone in the world, daylight saving included.</p>
      </header>
      <div className="tzc__row">
        <label className="tzc__when" htmlFor="tzc-when">
          <span>Date and time</span>
          <input id="tzc-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </label>
        <ZonePick id="tzc-from" title="From" value={from} onChange={setFrom} zones={zones} />
        <button type="button" className="tzc__swap" onClick={swap} aria-label="Swap the two zones" data-tip="Swap the two zones, keeping the same moment.">
          ⇄
        </button>
        <ZonePick id="tzc-to" title="To" value={to} onChange={setTo} zones={zones} />
      </div>
      <div className="tzc__out" aria-live="polite">
        <p>
          <small>{label(from)}</small>
          <b>{pretty(when, from)}</b>
        </p>
        <span aria-hidden="true">→</span>
        <p>
          <small>{label(to)}</small>
          <b>{pretty(result, to)}</b>
        </p>
        <em>{gap === 0 ? "same time" : `${gap > 0 ? "+" : "−"}${Math.abs(gap)} h`}</em>
      </div>
      <div className="tzc__presets" role="group" aria-label="Quick choices for the second zone">
        {PRESETS.map(([tz, name]) => (
          <button key={tz} type="button" aria-pressed={to === tz} onClick={() => setTo(tz)}>
            {name}
          </button>
        ))}
        <button type="button" onClick={() => setWhen(dateToWallTime(new Date(), from))}>
          Now
        </button>
      </div>
    </section>
  );
}
