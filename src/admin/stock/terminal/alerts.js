// Price alerts, the part that is plain arithmetic: has the price reached the level?

const fin = (x) => typeof x === "number" && Number.isFinite(x);

/** Has a waiting alert's level been reached at this price? */
export function crossed(alert, last) {
  if (!alert || alert.firedAt || !fin(last) || !fin(alert.price)) return false;
  return alert.dir === "above" ? last >= alert.price : last <= alert.price;
}

/** The waiting alerts whose level has been reached. priceOf(symbol) → the latest price or null */
export function due(alerts, priceOf) {
  return (alerts || []).filter((a) => crossed(a, priceOf(a.symbol)));
}

export const alertText = (a) => `${a.symbol} ${a.dir === "above" ? "at or above" : "at or below"} ₹${a.price}`;

/** How far the price is from the level, as a share of the level: "1.2% away". */
export function distancePct(alert, last) {
  if (!alert || !fin(last) || !(alert.price > 0)) return null;
  return Math.round((Math.abs(alert.price - last) / alert.price) * 1000) / 10;
}
