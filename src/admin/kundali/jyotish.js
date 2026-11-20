// The parts of a Kundali that are the same for everyone: the names of the signs and the planets, and the arithmetic of
// the Vimshottari dasha. Nothing here is about a person — the chart itself comes from the server, to superadmins only
// (server/kundali.js), and is never part of this bundle.

export const SIGNS = ["मेष", "वृष", "मिथुन", "कर्क", "सिंह", "कन्या", "तुला", "वृश्चिक", "धनु", "मकर", "कुंभ", "मीन"];
export const signName = (n) => SIGNS[(((Number(n) || 1) - 1) % 12 + 12) % 12];

export const PLANETS = {
  su: { name: "सूर्य", short: "सू" },
  mo: { name: "चंद्र", short: "चं" },
  ma: { name: "मंगल", short: "मं" },
  me: { name: "बुध", short: "बु" },
  ju: { name: "गुरु", short: "गु" },
  ve: { name: "शुक्र", short: "शु" },
  sa: { name: "शनि", short: "श" },
  ra: { name: "राहु", short: "रा" },
  ke: { name: "केतु", short: "के" },
};
export const planetName = (id) => (PLANETS[id] ? PLANETS[id].name : String(id || ""));
export const PLANET_ORDER = ["su", "mo", "ma", "me", "ju", "ve", "sa", "ra", "ke"];

export const HOUSE_NAMES = ["लग्न (तनु)", "धन", "पराक्रम", "सुख", "पंचम (विद्या)", "षष्ठ (रिपु)", "सप्तम (जाया)", "अष्टम (आयु)", "भाग्य", "कर्म", "लाभ", "व्यय"];
export const ORDINALS = ["प्रथम", "द्वितीय", "तृतीय", "चतुर्थ", "पंचम", "षष्ठ", "सप्तम", "अष्टम", "नवम", "दशम", "एकादश", "द्वादश"];
const MONTHS = ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"];

/** Which house a sign is, counted from the ascendant's sign (1 … 12). */
export const houseOf = (sign, lagna) => (((sign - lagna) % 12) + 12) % 12 + 1;

/* ------------------------------------------------------------------ Vimshottari
   120 years in nine periods, in this order, each planet's share fixed. A horoscope's table counts a year as 360 days
   and a month as 30 (so a period of 2.7 years is "2 years 8 months 12 days"), and so does this: dates are kept as
   [year, month, day] on that calendar, and a part of a day at the end of a sub-sub-period counts as a whole day. A
   30th that the real month does not have (30 February) runs on into the next month when it is shown or compared with
   a real day, as the printed tables show it. This reproduces the printed tables to the day. */
export const DASHA_ORDER = ["ke", "ve", "su", "mo", "ma", "ra", "ju", "sa", "me"];
export const DASHA_YEARS = { ke: 7, ve: 20, su: 6, mo: 10, ma: 7, ra: 18, ju: 16, sa: 19, me: 17 };

const toN = ([y, m, d]) => y * 360 + (m - 1) * 30 + (Math.min(30, Math.max(1, d)) - 1);
const fromN = (n) => [Math.floor(n / 360), Math.floor((((n % 360) + 360) % 360) / 30) + 1, (((n % 30) + 30) % 30) + 1];
const plus = (ymd, days) => fromN(toN(ymd) + Math.ceil(days - 1e-9));
const fromLord = (lord) => {
  const i = DASHA_ORDER.indexOf(lord);
  return i < 0 ? DASHA_ORDER : [...DASHA_ORDER.slice(i), ...DASHA_ORDER.slice(0, i)];
};
/** The real day a date of that calendar falls on: [y, m, d]. */
export function realDate(ymd) {
  const [y, m, d] = ymd;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d <= last) return [y, m, d];
  return m === 12 ? [y + 1, 1, d - last] : [y, m + 1, d - last];
}
const stamp = (ymd) => {
  const [y, m, d] = realDate(ymd);
  return Date.UTC(y, m - 1, d);
};
export const cmpYmd = (a, b) => stamp(a) - stamp(b);

/**
 * The nine great periods of one life (one full cycle from the period running at birth).
 * @param dasha  { first: the lord of the period at birth, balance: [years, months, days] of it still to run, birth: [y, m, d] }
 * @returns [{ lord, from, to, start, years, atBirth }] — `start` is where the period began (before birth, for the first)
 */
export function mahadashas(dasha) {
  if (!dasha || !DASHA_YEARS[dasha.first] || !Array.isArray(dasha.birth) || !Array.isArray(dasha.balance)) return [];
  const [by, bm, bd] = dasha.balance.map((x) => Number(x) || 0);
  const left = by * 360 + bm * 30 + bd;
  const full = DASHA_YEARS[dasha.first] * 360;
  let start = fromN(toN(dasha.birth) - Math.max(0, full - left));
  return fromLord(dasha.first).map((lord, i) => {
    const years = DASHA_YEARS[lord];
    const to = plus(start, years * 360);
    const row = { lord, from: i === 0 ? dasha.birth.slice() : start, to, start, years, atBirth: i === 0 };
    start = to;
    return row;
  });
}

/** The parts of a period: nine, beginning with the period's own lord, each in proportion to its planet's years. */
function parts(lord, start, days) {
  let run = 0;
  let from = start;
  return fromLord(lord).map((sub) => {
    run += (days * DASHA_YEARS[sub]) / 120;
    const to = plus(start, run);
    const row = { lord: sub, from, to, days: (days * DASHA_YEARS[sub]) / 120 };
    from = to;
    return row;
  });
}
/** The nine antardashas of a mahadasha (a row of mahadashas()). */
export const antardashas = (md) => (md ? parts(md.lord, md.start, md.years * 360) : []);
/** The nine pratyantars of an antardasha (a row of antardashas()). */
export const pratyantars = (ad) => (ad ? parts(ad.lord, ad.from, ad.days) : []);

const holds = (row, day) => cmpYmd(day, row.from) >= 0 && cmpYmd(day, row.to) < 0;
/** What is running on a day: { maha, antar, praty, list } (any may be null outside the cycle). `day`: [y, m, d]. */
export function runningOn(dasha, day) {
  const list = mahadashas(dasha);
  const maha = list.find((r) => holds(r, day)) || null;
  const antars = antardashas(maha);
  const antar = antars.find((r) => holds(r, day)) || null;
  const pratys = pratyantars(antar);
  const praty = pratys.find((r) => holds(r, day)) || null;
  return { list, maha, antars, antar, pratys, praty };
}

/** Today in India, as [y, m, d]. */
export function todayYmd(now = Date.now()) {
  const d = new Date(now + 5.5 * 3600 * 1000);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
}

/** A date of that calendar in words: "18 अप्रैल 2030". */
export function hindiDate(ymd) {
  if (!Array.isArray(ymd)) return "";
  const [y, m, d] = realDate(ymd);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** How far through a period a day is, 0 … 1. */
export function progress(row, day) {
  if (!row) return 0;
  const span = stamp(row.to) - stamp(row.from);
  return span <= 0 ? 0 : Math.max(0, Math.min(1, (stamp(day) - stamp(row.from)) / span));
}
