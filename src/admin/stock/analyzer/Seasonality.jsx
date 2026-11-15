// Seasonality on the History tab: each calendar month's return, year by year (a grid), the average
// month and how often it rose, and the weekdays. A past frequency, never a forecast.

import React, { useEffect, useState } from "react";
import { api } from "../../api";
import "./board.css";

const sgn = (x) => (x > 0 ? "+" : x < 0 ? "−" : "");
const fmt = (x, d = 1) => (x === null || x === undefined ? "—" : `${sgn(x)}${Math.abs(x).toFixed(d)}%`);

/** Background for a return: green up, red down, stronger with size; the number is always printed too. */
function shade(x, max) {
  if (x === null || x === undefined) return undefined;
  const a = Math.min(1, Math.abs(x) / max);
  return { background: `color-mix(in srgb, ${x >= 0 ? "var(--up)" : "var(--down)"} ${Math.round(12 + a * 58)}%, transparent)` };
}

export default function Seasonality({ symbol }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let alive = true;
    setD(null);
    setErr("");
    api(`/api/admin/market/seasonality/${encodeURIComponent(symbol)}`)
      .then((x) => alive && setD(x))
      .catch((e) => alive && setErr(e.message));
    return () => {
      alive = false;
    };
  }, [symbol]);
  if (err) return <p className="adm-small">Seasonality could not be read: {err}</p>;
  if (!d) return <p className="adm-small">Reading the seasonality…</p>;
  if (!d.available) return <p className="adm-small">{d.reason}</p>;
  const all = d.years.flatMap((y) => y.months).filter((x) => x !== null);
  const max = Math.max(4, ...all.map((x) => Math.abs(x)));
  const years = d.years.slice(-10);
  return (
    <div className="ssn">
      <h4>Seasonality — month by month</h4>
      <p className="adm-small">
        Each month’s return (last close of the month against the month before), {years[0].year}–{years[years.length - 1].year}. The month still running is marked with a dot. How a stock usually behaved in a month says nothing certain about this year.
      </p>
      <div className="ssn__wrap" role="region" tabIndex={0} aria-label="Monthly returns by year">
        <table className="ssn__t">
          <thead>
            <tr>
              <th scope="col">Year</th>
              {d.months.map((m) => (
                <th key={m.name} scope="col">
                  {m.name}
                </th>
              ))}
              <th scope="col">Year</th>
            </tr>
          </thead>
          <tbody>
            {years.map((y) => (
              <tr key={y.year}>
                <th scope="row">{y.year}</th>
                {y.months.map((x, i) => {
                  const running = `${y.year}-${String(i + 1).padStart(2, "0")}` === d.running;
                  return (
                    <td key={i} style={shade(x, max)} title={x === null ? "" : `${d.months[i].name} ${y.year}: ${fmt(x, 2)}${running ? " (still running)" : ""}`}>
                      {x === null ? "" : fmt(x)}
                      {running ? "•" : ""}
                    </td>
                  );
                })}
                <td className="ssn__tot" style={shade(y.total, max * 3)}>
                  {fmt(y.total)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Average</th>
              {d.months.map((m) => (
                <td key={m.name} style={shade(m.avg, max)} title={`${m.name}: average ${fmt(m.avg, 2)}, median ${fmt(m.median, 2)}, rose in ${m.up}% of ${m.n} years`}>
                  {fmt(m.avg)}
                </td>
              ))}
              <td />
            </tr>
            <tr>
              <th scope="row">Rose</th>
              {d.months.map((m) => (
                <td key={m.name}>{m.up === null ? "—" : `${m.up}%`}</td>
              ))}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <h4>Weekdays</h4>
      <p className="adm-small">The day’s close against the day before, since {d.weekdaySince}.</p>
      <ul className="ssn__wd">
        {d.weekdays.map((w) => (
          <li key={w.name} style={shade(w.avg, 0.4)}>
            <span>{w.name}</span>
            <b>{fmt(w.avg, 2)}</b>
            <small>up {w.up}% of {w.n}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}
