import React, { useEffect, useState } from "react";
import { ZONES, clockParts, compareTo, dayRelation, formatUtcOffset, isDst, tzOffsetMinutes } from "./timezones";

/**
 * Six live clocks. Pick any city as the reference (it starts as India) and every
 * other card shows how far ahead or behind it is right now — daylight saving included.
 */
export default function WorldClock() {
  const [now, setNow] = useState(() => new Date());
  const [refId, setRefId] = useState("in");
  const [twelve, setTwelve] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const ref = ZONES.find((z) => z.id === refId);

  return (
    <section className="sr-card" id="world-clock" aria-labelledby="wc-h">
      <header className="sr-card__head">
        <div>
          <h2 id="wc-h">World clock</h2>
          <p>
            Time offset shown against <b>{ref.label}</b>. Tap a city to compare against it instead.
          </p>
        </div>
        <div className="sr-seg" role="group" aria-label="Clock format">
          <button type="button" aria-pressed={!twelve} onClick={() => setTwelve(false)}>
            24h
          </button>
          <button type="button" aria-pressed={twelve} onClick={() => setTwelve(true)}>
            12h
          </button>
        </div>
      </header>

      <ul className="wc">
        {ZONES.map((z) => {
          const face = clockParts(z.tz, now, twelve);
          const off = tzOffsetMinutes(z.tz, now);
          const dst = isDst(z.tz, now);
          const isRef = z.id === refId;
          const cmp = compareTo(z.tz, ref.tz, now);
          const rel = dayRelation(z.tz, ref.tz, now);

          return (
            <li key={z.id}>
              <button
                type="button"
                className={`wc__card ${isRef ? "is-ref" : ""}`}
                data-tip={isRef ? "The reference city: the other clocks show their difference from this one." : "Make this the reference city. The other clocks will show their difference from it."}
                aria-pressed={isRef}
                onClick={() => setRefId(z.id)}
                aria-label={`${z.label}, ${face.hm} ${face.meridiem}, ${isRef ? "reference city" : `${cmp.text} compared with ${ref.label}`}`}
              >
                <span className="wc__top">
                  <span className="wc__code" aria-hidden="true">
                    {z.code}
                  </span>
                  <span className="wc__name">
                    {z.label}
                    <small>{z.city}</small>
                  </span>
                </span>

                <time className="wc__time" dateTime={now.toISOString()}>
                  {face.hm}
                  <span className="wc__sec">:{face.seconds}</span>
                  {face.meridiem && <span className="wc__mer">{face.meridiem}</span>}
                </time>

                <span className="wc__date">{face.date}</span>

                <span className="wc__meta">
                  <span>
                    {formatUtcOffset(off)} · {z.abbr(dst)}
                    {dst ? " (daylight)" : ""}
                  </span>
                </span>

                <span className={`wc__off ${isRef ? "is-ref" : `is-${cmp.direction}`}`}>
                  {isRef ? (
                    "Reference"
                  ) : (
                    <>
                      <b>{cmp.text}</b>
                      <span>
                        {cmp.direction === "same" ? "" : `${cmp.direction} of ${ref.label}`}
                        {rel !== "same day" ? ` · ${rel}` : ""}
                      </span>
                    </>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
