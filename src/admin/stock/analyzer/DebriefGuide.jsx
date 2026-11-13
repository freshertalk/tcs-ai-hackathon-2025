// The Debrief, explained for anyone: what it is, why it exists, how to read it, in four
// short steps with a worked example. Open the first time, then folded to one line.

import React, { useState } from "react";

const KEY = "vpt.debrief.guide";

export default function DebriefGuide() {
  const [open, setOpen] = useState(() => {
    try {
      return window.localStorage.getItem(KEY) !== "closed";
    } catch (_) {
      return true;
    }
  });
  const toggle = (e) => {
    const now = e.currentTarget.open;
    setOpen(now);
    try {
      window.localStorage.setItem(KEY, now ? "open" : "closed");
    } catch (_) {
      /* remembered for this visit only */
    }
  };
  return (
    <details className="an-card dbg" open={open} onToggle={toggle}>
      <summary>
        <b>What is the Debrief, and why is it here?</b>
        <span>A 1-minute guide</span>
      </summary>

      <p className="dbg__lead">
        During the day the Desk gives a <b>live call</b> for each stock — “long in play”, “short in play”, “wait”. The Debrief answers one honest question after the close:
        <b> if you had followed every one of those calls exactly, by fixed rules, what would today have made or lost?</b> It is a report card for the desk’s signals, not for you, and
        no real trade is involved.
      </p>

      <ol className="dbg__steps">
        <li>
          <b>Replay.</b> The day’s 5-minute price bars are played back, and at each bar the live call is worked out again — exactly as the Desk showed it.
        </li>
        <li>
          <b>Simulated trade.</b> Each time a stock turns “in play”, a pretend trade starts at that price, with the stop the call gave. It ends at the stop, at the target (one
          times the risk, “1R”), or at the 3:15 PM square-off — whichever comes first.
        </li>
        <li>
          <b>Score in R.</b> Results are counted in <b>R</b>, the amount risked: +1R means it made what it risked; −1R means the stop was hit. Rupees depend on how much you buy; R
          does not, so stocks can be compared fairly.
        </li>
        <li>
          <b>Costs.</b> Brokerage and taxes are taken off using the cost you pick above. A call that only wins before costs is not really winning.
        </li>
      </ol>

      <div className="dbg__eg">
        <b>Example.</b> At 10:20 SBIN turns “long in play” at ₹800 with a stop at ₹796 (₹4 of risk = 1R). At 11:05 it touches ₹804, the 1R target: <b>+1R</b>. After a 0.1% cost
        (₹0.80, which is 0.2R) the trade counts as <b>+0.8R</b>.
      </div>

      <div className="dbg__use">
        <div>
          <b>Why it is useful</b>
          <ul>
            <li>Shows which stocks the live call reads well, and which it reads badly.</li>
            <li>Shows when in the day the calls work (mornings often differ from afternoons).</li>
            <li>Shows whether trading with the daily trend beats trading against it.</li>
            <li>Stops you trusting a signal that only looks good before costs.</li>
          </ul>
        </div>
        <div>
          <b>How to use it</b>
          <ul>
            <li>Open it after 3:30 PM, once the day is complete.</li>
            <li>Look at the total first, then at the stocks with the worst numbers.</li>
            <li>Read one day as a hint, a week as a pattern. One day proves nothing.</li>
            <li>With an AI key, “Review” turns the numbers into a short written lesson.</li>
          </ul>
        </div>
      </div>
    </details>
  );
}
