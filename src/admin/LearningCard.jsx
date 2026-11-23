// Learning (23 Nov 2026): the outside resources the owner reads, on /me — grouped (learning, technical analysis, fundamental
// analysis), each a card that opens the site in a new tab. Nothing is loaded from those sites here (no logos, no trackers): each
// card wears a monogram in the private area's own colours.

import React from "react";

export const LEARNING = [
  {
    id: "learn",
    title: "Learning",
    blurb: "Courses and guides, from the basics up",
    links: [
      { name: "Zerodha Varsity", url: "https://zerodha.com/varsity/", what: "Free, structured modules: markets, technical and fundamental analysis, options and more" },
      { name: "Groww Learn", url: "https://groww.in/", what: "Plain-language guides to stocks, mutual funds and investing" },
      { name: "Investopedia", url: "https://www.investopedia.com/", what: "The finance dictionary: terms, concepts and tutorials" },
    ],
  },
  {
    id: "technical",
    title: "Technical Analysis",
    blurb: "Charts, screeners and market data",
    links: [
      { name: "TradingView", url: "https://www.tradingview.com/", what: "Charts, indicators and drawing tools, with ideas from other traders" },
      { name: "Chartink", url: "https://chartink.com/", what: "Screeners on technical conditions for NSE stocks" },
      { name: "StockEdge", url: "https://stockedge.com/", what: "Scans, F&O data and market analytics for Indian stocks" },
      { name: "Moneycontrol", url: "https://www.moneycontrol.com/", what: "Market news, quotes and the daily trade setup" },
      { name: "Tickertape", url: "https://www.tickertape.in/", what: "Stock screeners, scorecards and market analytics" },
    ],
  },
  {
    id: "fundamental",
    title: "Fundamental Analysis",
    blurb: "Financials, ratios and company research",
    links: [
      { name: "Screener.in", url: "https://www.screener.in/", what: "Financial statements, ratios and custom screens for listed companies" },
      { name: "Trendlyne", url: "https://trendlyne.com/", what: "Fundamentals, research reports and analyst estimates" },
      { name: "Tijori Finance", url: "https://www.tijorifinance.com/?r=n", what: "Company deep-dives: segments, business data and peers" },
    ],
  },
];

const host = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (_) {
    return url;
  }
};
const initials = (name) =>
  name
    .replace(/[^A-Za-z ]/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");

export default function LearningCard() {
  return (
    <section className="hm-card hm-learn" aria-labelledby="hm-learn-h" data-jump="Learning">
      <div className="hm-learn__head">
        <h2 id="hm-learn-h" className="hm-h">
          Learning
        </h2>
        <p>Trusted outside resources for learning, technical and fundamental analysis. Each opens in a new tab.</p>
      </div>
      {LEARNING.map((g) => (
        <div key={g.id} className={`hm-learn__group is-${g.id}`} role="group" aria-labelledby={`hm-learn-${g.id}`}>
          <h3 id={`hm-learn-${g.id}`}>
            {g.title} <small>{g.blurb}</small>
          </h3>
          <ul className="hm-learn__grid">
            {g.links.map((l) => (
              <li key={l.url}>
                <a className="hm-learn__card" href={l.url} target="_blank" rel="noopener noreferrer" data-tip={`${l.name} — opens ${host(l.url)} in a new tab`}>
                  <span className="hm-learn__mono" aria-hidden="true">
                    {initials(l.name)}
                  </span>
                  <span className="hm-learn__txt">
                    <b>{l.name}</b>
                    <small>{l.what}</small>
                    <em>{host(l.url)}</em>
                  </span>
                  <svg className="hm-learn__out" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
                  </svg>
                  <span className="adm-sr"> (opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
