import { hideAmounts, isAmount, markAmounts } from "./privacy";

test("what counts as an amount: rupees, signed figures, short figures — never a percentage, a time or a plain count", () => {
  for (const t of ["₹1,627.85", "+₹1,627.85", "−₹3,118", "+4.24k", "1.54k", "−2,840.00", "₹4.2 L", "₹69,001", "+3,369.99"]) expect([t, isAmount(t)]).toEqual([t, true]);
  for (const t of ["+0.44%", "51%", "63", "10:14 pm", "959.34", "Nov 12, 2026", "", "A long sentence that mentions ₹500 a month somewhere in it"]) expect([t, isAmount(t)]).toEqual([t, false]);
});

test("words keep their sense with the rupees starred", () => {
  expect(hideAmounts("Today's best was +₹8,105; now +₹1,628. Keep at least ₹4,052 (50% of the best).")).toBe("Today's best was +₹*****; now +₹*****. Keep at least ₹***** (50% of the best).");
  expect(hideAmounts("No amounts here, 51%")).toBe("No amounts here, 51%");
});

test("inside the money areas only: figures, money columns and labelled figures are marked; prices and market data are not", () => {
  document.body.innerHTML = `
    <div class="adm">
      <div class="tm-page" data-view="journal">
        <p>You made <b id="made">₹5,017</b> from <b id="n">63</b> trades</p>
        <dl><div><dt>Charges &amp; taxes</dt><dd id="ch">1.54k</dd></div><div><dt>Win rate</dt><dd id="wr">51%</dd></div></dl>
        <table><thead><tr><th>Symbol</th><th>Buy avg.</th><th>Charges</th><th>Net P&amp;L</th></tr></thead>
          <tbody><tr><th>SBIN</th><td id="avg">812.40</td><td id="c2">277.62</td><td id="net">−3,117.62</td></tr></tbody></table>
      </div>
      <div class="tm-page" data-view="setup"><b id="fii">₹5,673 cr</b></div>
    </div>`;
  markAmounts(document.querySelector(".adm"));
  const pv = (id) => document.getElementById(id).getAttribute("data-pv");
  expect([pv("made"), pv("c2"), pv("net")]).toEqual(["t", "c", "t"]);
  expect(pv("ch")).toBeTruthy(); // a short figure, under a label that names money
  expect([pv("n"), pv("wr"), pv("avg"), pv("fii")]).toEqual([null, null, null, null]); // a count, a percentage, a price, market data
  // a figure that stops being an amount is let go
  document.getElementById("made").textContent = "—";
  markAmounts(document.getElementById("made"));
  expect(pv("made")).toBeNull();
});
