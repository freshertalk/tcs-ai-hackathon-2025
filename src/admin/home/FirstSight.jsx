// /me's first screen (28 Nov 2026, the owner: "all details required for stock analysis must be displayed on front … keep all
// first sight information on upfront"): the indices, the status line, your account beside what to know before a trade, and your open
// positions. Each block can be switched off under Customize; a block that is
// off reads nothing. Reads only: no AI is asked and no order can be sent from here.

import React, { useMemo } from "react";
import "./first-sight.css";
import { adminPath } from "../paths";
import { useExchangeNow } from "../clock/exchangeClock";
import { accountNumbers, indexCells, watchSummary } from "./homeData";
import { useAccountData, useMarketData } from "./useHomeData";
import { IndexStrip, MarketRead, priceStamp } from "./MarketPanels";
import { AccountPanel, PositionsNow } from "./AccountPanels";

const terminal = (view, symbol) => {
  const q = [view ? `view=${view}` : "", symbol ? `s=${encodeURIComponent(symbol)}` : ""].filter(Boolean).join("&");
  return `${adminPath("/stock-report")}${q ? `?${q}` : ""}`;
};
const deskOf = (symbol) => terminal("", symbol);

/**
 * @param own         may this person see an account here: the owner, a superadmin, or a member with their own Zerodha account
 * @param statusLine  the page's status row (Dashboard.jsx), shown under the indices
 */
export default function FirstSight({ own, show, statusLine = null }) {
  const market = show.market !== false;
  const mine = own && show.account !== false;
  const data = useMarketData(market);
  const acct = useAccountData(mine);
  const now = useExchangeNow(60000);
  const { quotes, context, setup, expiries, alerts, status } = data;
  const summary = useMemo(() => watchSummary(quotes, status && status.watchlist), [quotes, status]);
  const cells = useMemo(() => indexCells(quotes), [quotes]);
  const account = useMemo(() => accountNumbers(acct.summary, quotes, now), [acct.summary, quotes, now]);
  if (!market && !mine && !statusLine) return null;
  return (
    <div className="fs">
      {market && <IndexStrip cells={cells} context={context} watch={summary} stamp={priceStamp(status, quotes, context)} deskHref={terminal("")} />}
      {statusLine}
      {(market || mine) && (
        <div className={`fs-pair ${market && mine ? "" : "is-single"}`}>
          {mine && <AccountPanel status={acct.status} account={account} error={acct.errors.summary || acct.errors.status} positionsHref={terminal("account")} deskHref={terminal("")} />}
          {market && <MarketRead context={context} setup={setup} expiries={expiries} alerts={alerts} setupHref={terminal("setup")} calendarHref={terminal("calendar")} />}
        </div>
      )}
      {mine && <PositionsNow account={account} deskOf={deskOf} positionsHref={terminal("account")} />}
    </div>
  );
}
