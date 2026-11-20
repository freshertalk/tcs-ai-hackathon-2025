// A Kundali drawn the North Indian way: the houses never move (the first is the diamond at the top, and they run
// anticlockwise), and the number written in each house is the sign that falls there. Given the ascendant's sign and
// the sign each planet is in, it works out the rest.
import React from "react";
import { PLANETS, PLANET_ORDER, houseOf, signName } from "./jyotish";

const S = 360; // the square's side, in drawing units
const H = S / 2;
const Q = S / 4;
// where each house's planets are written (its middle) and where its sign number sits (its corner towards the centre)
const HOUSES = [
  { at: [H, Q - 6], sign: [H, H - 26] },
  { at: [Q, 34], sign: [Q, Q - 14] },
  { at: [34, Q], sign: [Q - 14, Q + 4] },
  { at: [Q + 6, H], sign: [H - 26, H + 4] },
  { at: [34, S - Q], sign: [Q - 14, S - Q + 4] },
  { at: [Q, S - 30], sign: [Q, S - Q + 22] },
  { at: [H, S - Q + 6], sign: [H, H + 34] },
  { at: [S - Q, S - 30], sign: [S - Q, S - Q + 22] },
  { at: [S - 34, S - Q], sign: [S - Q + 14, S - Q + 4] },
  { at: [S - Q - 6, H], sign: [H + 26, H + 4] },
  { at: [S - 34, Q], sign: [S - Q + 14, Q + 4] },
  { at: [S - Q, 34], sign: [S - Q, Q - 14] },
];
// the corner houses are small triangles: two planets to a line there, three in the diamonds
const perLine = (house) => ([1, 4, 7, 10].includes(house) ? 3 : 2);

/**
 * @param lagna   the ascendant's sign, 1 (Aries) … 12
 * @param at      { su: sign, mo: sign, … } — the sign each planet is in
 * @param marks   { sa: "व", ju: "अ" } — a small mark after a planet (retrograde, combust)
 * @param title   what the drawing is, for a screen reader
 */
export default function KundaliChart({ lagna, at = {}, marks = {}, title = "कुंडली" }) {
  const byHouse = Array.from({ length: 12 }, () => []);
  for (const id of PLANET_ORDER) {
    const sign = at[id];
    if (!Number.isInteger(sign)) continue;
    byHouse[houseOf(sign, lagna) - 1].push(id);
  }
  const said = byHouse
    .map((ids, i) => (ids.length ? `${i + 1} (${signName(((lagna - 1 + i) % 12) + 1)}): ${ids.map((id) => PLANETS[id].name).join(", ")}` : null))
    .filter(Boolean)
    .join("; ");
  return (
    <svg className="kd-chart" viewBox={`0 0 ${S} ${S}`} role="img" aria-label={`${title}। लग्न ${signName(lagna)}। ${said}`}>
      <rect className="kd-chart__frame" x="1.5" y="1.5" width={S - 3} height={S - 3} rx="10" />
      <path className="kd-chart__lines" d={`M1.5 1.5 L${S - 1.5} ${S - 1.5} M${S - 1.5} 1.5 L1.5 ${S - 1.5} M${H} 1.5 L${S - 1.5} ${H} L${H} ${S - 1.5} L1.5 ${H} Z`} />
      {HOUSES.map((h, i) => {
        const house = i + 1;
        const sign = ((lagna - 1 + i) % 12) + 1;
        const ids = byHouse[i];
        const n = perLine(house);
        const lines = [];
        for (let k = 0; k < ids.length; k += n) lines.push(ids.slice(k, k + n));
        const lh = 19;
        const y0 = h.at[1] - ((lines.length - 1) * lh) / 2;
        return (
          <g key={house}>
            <text className={`kd-chart__sign${house === 1 ? " is-lagna" : ""}`} x={h.sign[0]} y={h.sign[1]} textAnchor="middle">
              {sign}
            </text>
            {house === 1 && (
              <text className="kd-chart__lagna" x={H} y={18} textAnchor="middle">
                लग्न
              </text>
            )}
            {lines.map((row, r) => (
              <text key={r} className="kd-chart__planets" x={h.at[0]} y={y0 + r * lh + 5} textAnchor="middle">
                {row.map((id, j) => (
                  <tspan key={id} className={`kd-p kd-p--${id}`}>
                    {j ? " " : ""}
                    {PLANETS[id].short}
                    {marks[id] ? <tspan className="kd-chart__mark" dy="-5" fontSize="9">{marks[id]}</tspan> : null}
                    {marks[id] ? <tspan dy="5" fontSize="1"> </tspan> : null}
                  </tspan>
                ))}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
