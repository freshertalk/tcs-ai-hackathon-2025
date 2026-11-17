"use strict";
// Which sector a large NSE stock belongs to — for the risk gate's concentration check (do not put the whole book into
// banks, however good each setup looks) and for the correlation hint. Zerodha does not supply sectors, so this is a
// plain table for the NIFTY 50 and the main names of the NIFTY Next 50; anything else is "Other" and is simply not
// counted as a concentration. Group names follow the NSE sector indices.

const GROUPS = {
  Banks: "HDFCBANK ICICIBANK SBIN KOTAKBANK AXISBANK INDUSINDBK BANKBARODA PNB CANBK UNIONBANK IDFCFIRSTB FEDERALBNK AUBANK BANDHANBNK",
  "Financial services": "BAJFINANCE BAJAJFINSV SHRIRAMFIN HDFCLIFE SBILIFE ICICIGI ICICIPRULI CHOLAFIN MUTHOOTFIN PFC RECLTD LICI JIOFIN SBICARD HDFCAMC",
  IT: "TCS INFY HCLTECH WIPRO TECHM LTIM PERSISTENT COFORGE MPHASIS OFSS",
  Auto: "MARUTI TATAMOTORS M&M BAJAJ-AUTO EICHERMOT HEROMOTOCO TVSMOTOR ASHOKLEY BOSCHLTD MOTHERSON",
  FMCG: "HINDUNILVR ITC NESTLEIND BRITANNIA TATACONSUM DABUR GODREJCP MARICO COLPAL VBL",
  Pharma: "SUNPHARMA DRREDDY CIPLA DIVISLAB APOLLOHOSP LUPIN TORNTPHARM ZYDUSLIFE MAXHEALTH AUROPHARMA",
  "Metals & mining": "TATASTEEL JSWSTEEL HINDALCO VEDL COALINDIA NMDC JINDALSTEL SAIL HINDCOPPER NATIONALUM",
  "Oil, gas & power": "RELIANCE ONGC BPCL IOC GAIL NTPC POWERGRID ADANIGREEN ADANIPOWER TATAPOWER HINDPETRO COALINDIA",
  "Infra & capital goods": "LT ADANIPORTS ADANIENT SIEMENS ABB HAL BEL CGPOWER POLYCAB DLF GODREJPROP LODHA ULTRACEMCO GRASIM AMBUJACEM SHREECEM",
  "Consumer & retail": "TITAN ASIANPAINT TRENT DMART PIDILITIND HAVELLS ZOMATO NYKAA JUBLFOOD IRCTC INDIGO",
  Telecom: "BHARTIARTL IDEA INDUSTOWER",
};

const MAP = new Map();
for (const [sector, list] of Object.entries(GROUPS)) for (const s of list.split(" ")) if (!MAP.has(s)) MAP.set(s, sector);

/** The sector of a stock, or "Other". */
const sectorOf = (symbol) => MAP.get(String(symbol || "").toUpperCase()) || "Other";

module.exports = { sectorOf, GROUPS };
