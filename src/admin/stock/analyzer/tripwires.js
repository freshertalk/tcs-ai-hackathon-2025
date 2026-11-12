// Tripwires: the levels that matter for the open stock, checked on every tick.
//
// The live call is recomputed every couple of seconds; a tick can break a level in
// between. This is what notices at once — the stop, a target, a trigger, VWAP, the
// previous day's high or low — says so, and asks for the call to be read again
// immediately. It also gives a word of warning when price closes in on a level.

const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const money = (x) => `₹${x.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The wires for one stock, from its latest verdict. */
export function wiresFrom(v) {
  if (!v || !v.available || !v.day || !v.day.available) return { wires: [], atr: null };
  const d = v.day;
  const wires = [];
  const inPlay = d.state === "long" || d.state === "short";
  if (d.plan && inPlay) {
    wires.push({ id: "stop", kind: "stop", side: d.plan.side, price: d.plan.stop });
    (d.plan.targets || []).forEach((t) => wires.push({ id: `target-${t.label}`, kind: "target", side: d.plan.side, price: t.price, name: t.label }));
  }
  if (d.triggers && d.triggers.rangeSet && d.state !== "no-trade") {
    if (d.state !== "long") wires.push({ id: "trigger-long", kind: "trigger", side: "long", price: d.triggers.long });
    if (d.state !== "short") wires.push({ id: "trigger-short", kind: "trigger", side: "short", price: d.triggers.short });
  }
  if (d.movement && isNum(d.movement.vwap)) wires.push({ id: "vwap", kind: "vwap", price: d.movement.vwap });
  for (const r of v.ladder || []) {
    if (r.label === "Previous day high" || r.label === "Previous day low") wires.push({ id: r.label, kind: "level", price: r.price, name: r.label.toLowerCase() });
  }
  return { wires: wires.filter((w) => isNum(w.price) && w.price > 0), atr: v.movement ? v.movement.atr : null };
}

/**
 * What the move from `prev` to this tick did.
 * @param cfg   { wires, atr } from wiresFrom
 * @param memo  an object kept between calls: remembers what was said, so a level does not ring over and over
 * @returns events, oldest first: { id, at, price, kind, tone: "up"|"down"|"flat", urgent, refresh, text }
 *   urgent  → worth a sound: the stop, a target or a trigger
 *   refresh → read the call again now, without waiting for the next poll
 */
export function checkWires(cfg, prev, tick, memo, now) {
  const last = tick ? tick.last : null;
  if (!isNum(prev) || !isNum(last) || prev === last) return [];
  const out = [];
  const said = memo.said || (memo.said = {});
  const near = memo.near || (memo.near = {});
  const say = (id, quietMs, ev) => {
    if (said[id] && now - said[id] < quietMs) return;
    said[id] = now;
    out.push({ id, at: now, price: last, ...ev });
  };
  const band = Math.max(0.05, isNum(cfg.atr) ? cfg.atr * 0.08 : last * 0.001);

  for (const w of cfg.wires) {
    // VWAP moves with every trade: compare with where it is now, not where it was at the last poll
    const level = w.kind === "vwap" && isNum(tick.avgPrice) && tick.avgPrice > 0 ? tick.avgPrice : w.price;
    const up = prev < level && last >= level;
    const down = prev > level && last <= level;

    if (w.kind === "stop") {
      if ((w.side === "long" && down) || (w.side === "short" && up)) {
        say(w.id, 60000, { kind: "stop", tone: "down", urgent: true, refresh: true, text: `Stop level ${money(level)} broken — the ${w.side} idea is no longer valid.` });
      }
    } else if (w.kind === "target") {
      if ((w.side === "long" && up) || (w.side === "short" && down)) {
        say(w.id, 300000, { kind: "target", tone: "up", urgent: true, refresh: false, text: `Target ${w.name} reached at ${money(level)}.` });
      }
    } else if (w.kind === "trigger") {
      const through = (w.side === "long" && up) || (w.side === "short" && down);
      const back = (w.side === "long" && down) || (w.side === "short" && up);
      if (through) {
        say(w.id, 30000, { kind: "trigger", tone: w.side === "long" ? "up" : "down", urgent: true, refresh: true, text: `Through the ${w.side} trigger ${money(level)} — it counts once a 5-minute bar closes ${w.side === "long" ? "above" : "below"} it.` });
      } else if (back) {
        say(`${w.id}-back`, 30000, { kind: "trigger", tone: "flat", urgent: false, refresh: true, text: `Back ${w.side === "long" ? "under" : "over"} the ${w.side} trigger ${money(level)}.` });
      }
    } else if (w.kind === "vwap") {
      if (up || down) say("vwap", 20000, { kind: "vwap", tone: up ? "up" : "down", urgent: false, refresh: true, text: `Crossed ${up ? "above" : "below"} VWAP ${money(level)}.` });
    } else if (up || down) {
      say(w.id, 60000, { kind: "level", tone: up ? "up" : "down", urgent: false, refresh: false, text: `Crossed ${up ? "above" : "below"} the ${w.name} ${money(level)}.` });
    }

    // a word in advance when price closes in on the stop or a trigger
    if (w.kind === "stop" || w.kind === "trigger") {
      const dist = Math.abs(last - level);
      const beyond = w.kind === "trigger" ? (w.side === "long" ? last >= level : last <= level) : w.side === "long" ? last <= level : last >= level;
      if (!beyond && dist <= band && !near[w.id]) {
        near[w.id] = true;
        say(`${w.id}-near`, 45000, { kind: "near", tone: "flat", urgent: false, refresh: false, text: `Closing in on the ${w.kind === "stop" ? "stop level" : `${w.side} trigger`} ${money(level)} — ${money(dist)} away.` });
      } else if (dist > band * 2) near[w.id] = false;
    }
  }

  // a new high or low for the day
  if (isNum(tick.high) && isNum(memo.high) && tick.high > memo.high) say("day-high", 60000, { kind: "extreme", tone: "up", urgent: false, refresh: false, text: `New high for the day: ${money(tick.high)}.` });
  if (isNum(tick.low) && tick.low > 0 && isNum(memo.low) && tick.low < memo.low) say("day-low", 60000, { kind: "extreme", tone: "down", urgent: false, refresh: false, text: `New low for the day: ${money(tick.low)}.` });
  if (isNum(tick.high)) memo.high = tick.high;
  if (isNum(tick.low) && tick.low > 0) memo.low = tick.low;
  return out;
}
