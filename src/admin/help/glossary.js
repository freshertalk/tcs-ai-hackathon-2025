// The words behind the hover help: what each label, number and button on the private
// area means, in plain language. One place, so the wording stays consistent.
//
// Each entry is  [labels, help, scope?]:
//   labels  the text as it appears on screen (matched whole, ignoring case and a leading mark)
//   help    one or two short sentences
//   scope   optional CSS selector: the help applies only inside it (for words that mean
//           different things in different places, like "Setups" or "Refresh")
// PATTERNS cover labels with a changing part ("Target 2R", "Build strategy for SBIN").

import { norm } from "./tips";

/** Where labels are looked for. */
export const SELECTOR = [
  "dt",
  "th",
  "h3",
  "h4",
  "h5",
  "label",
  "button",
  "summary b",
  '[role="tab"]',
  ".callchip",
  ".cp__bias",
  ".vd-live__k",
  ".ob__k",
  ".db-filters__k",
  ".vd-factors b",
  ".vd-frames__name b",
  ".vd-horizons small",
  ".vd-band__ends small",
  ".mk__tide small",
  ".adm-btn",
].join(", ");

/** A label as a key: normalised, without a leading tick, cross, arrow or plus. */
export const keyOf = (text) => norm(text).replace(/^[✓✕×◦▲▼◆■…+−⇄⚠-]+\s*/, "");

const VWAP = "VWAP is the average price paid for every share traded today. Above it buyers are in control; below it, sellers.";
const ATR = "ATR is the average high-to-low range of the last 14 days: the size of a normal day for this stock.";
const STOP = "The price that proves the idea wrong. If it trades there the trade is closed — a stop is never moved further away.";
const RISK = "Entry minus stop: what one share loses if the stop is hit. Shares to trade = the money you accept losing ÷ this.";
const CIRCUIT = "The lowest and highest prices the exchange allows today. At a limit, trading can lock with only buyers or only sellers.";
const PIVOT_R = "A pivot resistance level, worked out from the last session’s high, low and close. Rallies often pause here.";
const PIVOT_S = "A pivot support level, worked out from the last session’s high, low and close. Falls often pause here.";
const EMA = "An exponential moving average: the average close of that many days, weighing recent days more. A trend line.";
const TOKENS = "It uses your Anthropic API tokens, and runs only when you press it.";

const ENTRIES = [
  /* ------------------------------------------------------------ everywhere */
  [["Sign out"], "End this session on this device. You will need to sign in with Google again."],
  [["Light theme", "Dark theme"], "Switch these trading pages between a light and a dark look. Remembered on this device."],
  [["Try again"], "Ask the server again."],
  [["Copy"], "Copy this value to the clipboard."],

  /* ------------------------------------------------- Stock Report sections */
  [["Trading desk"], "The live desk: pick a stock and see its live call, charts, order book and every level.", ".sr-views"],
  [["Screener"], "Find every NSE stock whose RSI is at a value you choose, right now. Any result opens on the desk.", ".sr-views"],
  [["Day debrief"], "After the session: what the desk’s calls would have done today, stock by stock, with an optional AI review.", ".sr-views"],
  [["World clock & holidays"], "The time in the main markets, and the trading holidays of NSE, BSE and NASDAQ.", ".sr-views"],

  /* ------------------------------------------------------- data connection */
  [["Log in to Kite"], "Opens Zerodha’s own login page. A Kite session ends at about 6 AM the next day, so this is needed once each trading morning."],
  [["Disconnect"], "End the Zerodha session on this server now. Live prices stop until you log in to Kite again."],
  [["Zerodha setup", "Hide setup"], "Show or hide where the Kite Connect API key and secret are entered."],
  [["Explore with demo data"], "Try every screen with made-up DEMO stocks. Nothing shown in demo mode is a real price."],
  [["Leave demo"], "Leave the made-up demo stocks and go back to real data."],
  [["Save key"], "Store the Kite API key and secret, encrypted on the server. They are never shown again."],

  /* ----------------------------------------------------------- market strip */
  [["Market tide", "Tide at the close"], "One number from −100 to +100 for which way the Nifty is moving: against yesterday’s close, since the open, its 5-minute trend, Bank Nifty and how many sectors are up."],
  [["Market & world"], "Open the detail: how the tide is built, the sectors, and the AI’s world brief."],
  [["Hide"], "Close the market detail.", ".mk"],
  [["Get the world brief"], `Ask the AI to search the web for overseas markets, crude, gold, the dollar and today’s events. ${TOKENS}`],
  [["Refresh (new web search)"], `Search the web again and replace the world brief. ${TOKENS}`],

  /* -------------------------------------------------------------- watchlist */
  [["Rescan"], "Work out the one-line reading and the setup flags again for every stock on the watchlist."],
  [["My order"], "Keep the watchlist in the order you added the stocks.", ".wl__order"],
  [["Strongest"], "Put the stocks that are trading strongest right now at the top.", ".wl__order"],
  [["Weakest"], "Put the stocks that are trading weakest right now at the top.", ".wl__order"],
  [["Add to watchlist"], "Keep this stock on your watchlist, so it is tracked and scanned every day."],

  /* ------------------------------------------------------- the stock's stats */
  [["Open"], "Today’s first traded price.", ".sv__stats"],
  [["High"], "The highest price traded today so far.", ".sv__stats"],
  [["Low"], "The lowest price traded today so far.", ".sv__stats"],
  [["Prev close"], "Yesterday’s closing price. Today’s change is measured from it."],
  [["Volume"], "Shares traded today so far.", ".sv__stats"],
  [["Daily reading"], "A score from −100 to +100 for the daily chart: trend, momentum and volume. It describes recent days, not this minute."],
  [["Setups on"], "The rule-based trade setups whose conditions are all met on the latest daily bar."],
  [["Circuit limits"], CIRCUIT],

  /* ------------------------------------------------------- the stock's tabs */
  [["Verdict"], "The desk’s verdict: the live intraday call, the order book, the swing and long-term views and every level.", ".sv__tabs"],
  [["Overview"], "The charts — 1-minute, 5-minute or daily — and the daily technical reading.", ".sv__tabs"],
  [["Setups"], "Seven rule-based trade setups, with each condition ticked or crossed and a plan when one triggers.", ".sv__tabs"],
  [["Levels"], "Pivots, support and resistance, moving averages and the 52-week range.", ".sv__tabs"],
  [["Indicators"], "Every indicator’s latest value, with a line on how to read it.", ".sv__tabs"],
  [["AI strategist"], "Ask the AI for a written plan or a news check on this stock, and see how its past plans turned out.", ".sv__tabs"],
  [["Position size"], "Work out how many shares to trade from the money you are prepared to lose.", ".sv__tabs"],
  [["Backtest"], "How each setup would have done on this stock’s own history, costs included.", ".sv__tabs"],
  [["History"], "What this stock has returned year by year, and how rough the ride was.", ".sv__tabs"],

  /* -------------------------------------------------------------- the charts */
  [["Intraday · 1 min"], "Today in 1-minute candles: the fastest view. It turns first and misleads most.", ".sv__chartbar"],
  [["Intraday · 5 min"], "Today in 5-minute candles — the view the live call is made on.", ".sv__chartbar"],
  [["Daily"], "One candle per day with its moving averages, for the bigger picture.", ".sv__chartbar"],
  [["3M", "6M", "1Y", "2Y"], "How much history the daily chart shows.", ".sv__chartbar"],
  [["Last hour", "Last 2 h", "Full day"], "How much of today the 1-minute chart shows. Less time means wider candles.", ".ic__spans"],
  [["EMA 20 / 50 / 200"], "Show the 20-, 50- and 200-day moving averages: the short, medium and long-term trend lines.", ".pc__toggles"],
  [["Bollinger"], "Show Bollinger Bands: a band two standard deviations around the 20-day average. Price at an edge is stretched.", ".pc__toggles"],
  [["Supertrend"], "Show the Supertrend line, a trailing level built from ATR. Price above it reads as an uptrend, below it as a downtrend.", ".pc__toggles"],
  [["Setups"], "Mark the days on which a rule-based setup triggered.", ".pc__toggles"],

  /* ------------------------------------------------------------ the live call */
  [["Desk verdict"], "One mechanical reading of this stock on three horizons — today, days to weeks, and months to years — with every level it is based on."],
  [["Live intraday call"], "What today’s tape says right now, read again every two seconds in market hours: long, short, wait or no trade — with entry, stop and targets."],
  [["LONG in play"], "The conditions for a long are met now: above VWAP and the opening range, confirmed by a 5-minute close."],
  [["SHORT in play"], "The conditions for a short are met now: below VWAP and the opening range, confirmed by a 5-minute close."],
  [["WAIT · long side"], "The tape leans up, but the trigger has not confirmed. No entry yet."],
  [["WAIT · short side"], "The tape leans down, but the trigger has not confirmed. No entry yet."],
  [["WAIT · no edge"], "The score is too weak either way. The disciplined trade is no trade."],
  [["NO TRADE"], "Standing aside by rule: the first 15 minutes, after 2:45 PM, at a circuit limit, or when the last trade is old."],
  [["Off"], "There is no live call: the market is closed or Zerodha is not connected.", ".sv__ticker"],
  [["Stop-loss", "Stop"], STOP],
  [["Risk / share", "Risk per share"], RISK],
  [["Targets"], "Price targets, each a multiple of the risk away from the entry (1R, 2R, …)."],
  [["Long only above"], "A long is considered only once price is above this trigger: the opening-range high plus one tick."],
  [["Short only below"], "A short is considered only once price is below this trigger: the opening-range low minus one tick."],
  [["VWAP", "vs VWAP"], VWAP],
  [["Size this trade", "Size this swing trade"], "Open the position-size calculator with this entry and stop already filled in."],
  [["Refresh"], "Read the verdict again now. It refreshes by itself every two seconds in market hours.", ".vd__top"],
  [["Alert me with a sound", "Alerts on — sound"], "Play a sound when the call changes, or when a stop, a target or a trigger is hit. Press again to turn it off."],
  [["Live events · level breaks and call changes"], "A running list, newest first: every time price crosses one of the call’s levels, and every change of the call."],

  /* ------------------------------------------------------------ AI co-pilot */
  [["AI co-pilot"], "A language model’s short second reading of this stock: whether the engine’s call deserves trust right now, and what to watch. It never gives prices of its own."],
  [["Go live", "Live · on"], "Let the co-pilot read again by itself when the call changes, a level breaks or a warning appears — within the limits in AI settings. Press again to stop."],
  [["Ask now"], `Ask the co-pilot for one reading now. ${TOKENS}`],
  [["UP"], "The co-pilot expects the next 10–15 minutes to be up. It is scored against the price ten minutes later.", ".cp"],
  [["DOWN"], "The co-pilot expects the next 10–15 minutes to be down. It is scored against the price ten minutes later.", ".cp"],
  [["UNCLEAR"], "The evidence is mixed or thin, so the co-pilot takes no side. That is a normal, respectable answer.", ".cp"],

  /* -------------------------------------------------------------- order book */
  [["Order book · live"], "The five best buy prices (bids) and sell prices (offers) right now, with the shares waiting and the number of orders at each."],
  [["Pressure · book and trades together"], "One number from −100 (sellers pressing) to +100 (buyers pressing), from the order book and the last minute of trades. Beyond ±50 against a trade it becomes an early warning."],
  [["Near the price"], "Bids against offers in the five best levels, counting the nearest levels most. Positive means more is waiting to buy."],
  [["Whole book"], "Every pending buy order against every pending sell order in this stock. Positive means more buyers are waiting."],
  [["Traded · 30 s", "Traded · 60 s", "Traded · 5 min"], "Shares bought at the offer minus shares sold at the bid in that time. Positive means buyers were the ones in a hurry."],
  [["Average order"], "Average shares per waiting order on each side. Much larger orders on one side can mean bigger players there."],

  /* -------------------------------------------------------- movement right now */
  [["Movement right now"], "How the stock is moving today, from the live price and today’s 5-minute bars."],
  [["Today"], "The change from yesterday’s close.", ".vd-tiles"],
  [["Opening gap"], "How far today’s open was from yesterday’s close. A large gap that holds shows conviction; one that fades shows the opposite."],
  [["Since the open"], "The change from today’s opening price.", ".vd-tiles"],
  [["Last 15 min", "Last 30 min", "Last 1 min", "Last 5 min"], "The price change over that stretch of time."],
  [["Range used"], "Today’s high-to-low range as a share of a normal day’s range (ATR). Above about 150% the move is stretched, and a late entry has less room."],
  [["Volume pace"], "Today’s volume against what is usual by this time of day. The first hours always run high."],
  [["5-min RSI"], "RSI on 5-minute bars: momentum from 0 to 100. Above 70 is short-term overbought, below 30 oversold."],
  [["Opening range", "Opening range (15 min)"], "The high and low of the first 15 minutes. A confirmed break of it often sets the day’s direction.", ".vd-tiles, .an-table, dl"],
  [["1-min trend"], "The 9-minute average against the 21-minute average of 1-minute closes. “Pausing” means price has slipped back between them."],
  [["1-min RSI"], "RSI on 1-minute bars. Above 70 is overbought, below 30 oversold — over minutes, not hours."],
  [["Structure"], "Whether the last two swing highs and lows on the 1-minute chart are rising or falling."],
  [["Last swing low", "Last swing high"], "The most recent turning point on the 1-minute chart. A break of it is the first sign the short-term direction has changed."],
  [["Volume, last 5 min"], "The average minute of the last five against the average minute of the whole session. Above 2× is a burst of activity."],

  /* ------------------------------------------------------- the score's factors */
  [["Why — the score, factor by factor"], "Every part of the intraday score, so the call can be checked rather than trusted."],
  [["Price vs VWAP"], "Up to ±25 points: how far price is above or below VWAP, the day’s average traded price."],
  [["Opening range"], "±20 points: above the first-15-minute high, below its low, or inside it (0).", ".vd-factors"],
  [["5-minute trend"], "Up to ±15 points: the 9-bar average against the 21-bar average on 5-minute bars, and whether price is beyond both."],
  [["Last 30 minutes"], "Up to ±15 points: the price change over the last half hour, against a normal day’s range."],
  [["Place in today's range"], "Up to ±10 points: near the day’s high scores positive, near the low negative."],
  [["Since the open"], "Up to ±10 points: how far price has moved from today’s open.", ".vd-factors"],
  [["Volume behind the move"], "±5 points when the last 15 minutes are clearly busier than the rest of the day, in the direction of the move."],
  [["Market tide (Nifty)"], "Up to ±8 points: a rising Nifty helps longs, a falling one helps shorts."],
  [["Strength vs Nifty since the open"], "Up to ±7 points: a stock doing better than the index shows real strength; doing worse, real weakness."],
  [["The stock's own tape"], "The seven factors above added together, before the adjustment for the market."],
  [["Score used for the call", "Tape score"], "The final score. A side needs ±35 or more — ±45 in the midday lull."],

  /* ------------------------------------------------------ the three horizons */
  [["Intraday · today"], "The live call, for today only. Intraday positions are closed before the 3:15 PM square-off."],
  [["Swing · days to weeks"], "The daily-chart verdict for a delivery trade held for days to weeks. Long only."],
  [["Long term · months to years"], "The primary trend, from the 200-day and 30-week averages. For investing rather than trading."],
  [["Entry near"], "Where the swing plan enters: a setup has triggered, so the entry is near the current price."],
  [["Buy above"], "The swing plan enters only if price trades above this level."],
  [["First resistance"], "The nearest level above where sellers have appeared before, and the reward to it in multiples of the risk."],
  [["Bullish case ends"], "Below this level the bullish reading is wrong, and a swing long should be closed."],
  [["Holders: warning below"], "If you already hold the stock: a close below this level is the warning to act on."],
  [["Improves only above"], "The reading turns better only if price gets back above this level."],
  [["Turns bullish above"], "A close above this level would turn the neutral reading bullish."],
  [["Turns bearish below"], "A close below this level would turn the neutral reading bearish."],
  [["Weekly"], "The weekly trend, from the 10- and 30-week averages.", ".vd-frames"],
  [["Daily"], "The daily trend and its score.", ".vd-frames"],
  [["Intraday (5 min)"], "Today’s trend on 5-minute bars.", ".vd-frames"],
  [["What argues against the swing reading"], "Everything in the rules that disagrees with the reading. Always shown, so the case is never one-sided."],

  /* ----------------------------------------------------------------- long term */
  [["200-day average"], "The average close of the last 200 sessions: the classic long-term trend line. The percentage is how far price is from it."],
  [["30-week average"], "The average of the last 30 weekly closes: a slower trend line for the long-term picture."],
  [["52-week range"], "The lowest and highest prices of the past year."],
  [["Highest in this history"], "The highest price in the stored history, and how far below it the stock is now."],
  [["12 months"], "The price change over the last 12 months.", ".vd"],
  [["Worst fall from a peak", "Worst fall (peak to trough)"], "The largest drop from any high to a later low in this history: what a holder had to sit through."],
  [["Yearly volatility", "Volatility (annualised)"], "How much the price swings in a typical year, in percent. Higher means a rougher ride."],

  /* ---------------------------------------------------- circuits, a normal day */
  [["Lower circuit"], "The lowest price the exchange allows today."],
  [["Upper circuit"], "The highest price the exchange allows today."],
  [["A normal day for this stock"], "The stock’s typical daily range, to judge how stretched today’s move is."],
  [["Day's range (ATR)", "ATR (14)", "Typical daily move (ATR 14)"], ATR],
  [["Expected range"], "Where a normal day would be expected to stay, from the typical daily range."],
  [["Volume vs 20-day", "Volume vs 20-day average"], "Today’s volume against the 20-day average. Above 1× is busier than usual."],

  /* -------------------------------------------------------------- every level */
  [["Every level, top to bottom"], "Every price level the desk knows, from highest to lowest, with its distance from the current price."],
  [["Away"], "How far the level is from the current price."],
  [["Pivot"], "The pivot point: the average of the last session’s high, low and close. Above it the day leans up, below it down."],
  [["R1", "R2", "R3"], PIVOT_R],
  [["S1", "S2", "S3"], PIVOT_S],
  [["CPR top", "CPR bottom"], "The Central Pivot Range: a narrow band around the pivot. A narrow band often comes before a trending day."],
  [["Previous day high", "Previous day low"], "Yesterday’s extreme. Breaks of it are watched by many traders."],
  [["Previous close", "Last close", "Reference (last close)"], "The closing price of the last completed session."],
  [["Day high", "Day low", "Day high / low"], "Today’s extreme so far."],
  [["Opening range high", "Opening range low"], "The edge of the first 15 minutes’ range. The long and short triggers sit just beyond these."],
  [["20 EMA", "50 EMA", "200 EMA"], EMA],
  [["52-week high", "52-week low"], "The extreme price of the past year."],
  [["Last price"], "The price of the most recent trade."],
  [["Moving averages"], "Trend lines made from average closes: 20 days (short term), 50 (medium) and 200 (long)."],
  [["Support and resistance"], "Levels where price has turned before: support below, resistance above. More touches make a level stronger."],
  [["Pivot levels for the next session"], "Levels worked out from the latest completed session’s high, low and close, for use in the next one."],
  [["Support"], "A level below the price where buyers have appeared before.", ".an-table, dl"],
  [["Resistance"], "A level above the price where sellers have appeared before.", ".an-table, dl"],
  [["50 DMA", "200 DMA"], "A simple moving average of that many daily closes: the medium-term (50) or long-term (200) trend line."],
  [["Today, intraday"], "Today’s VWAP and opening range, from 5-minute bars."],
  [["Level"], "The name of the level, and what kind it is.", ".vd-ladder"],
  [["Price"], "The price of the level.", ".vd-ladder"],

  /* ------------------------------------------------------- reading and setups */
  [["Technical reading"], "The daily-chart score, shown measure by measure. A checklist, not a forecast."],
  [["Trade setups"], "Seven rule-based setups. Each lists its conditions with a tick or a cross, and gives entry, stop and targets when it triggers."],
  [["Price levels"], "Pivots, support and resistance, moving averages and the 52-week range for this stock."],
  [["Things to be careful about"], "What the daily data warns about for this stock right now."],
  [["Warning signs in the last 5 sessions"], "Bearish signals that appeared on the daily chart in the last five sessions."],

  [["Trend"], "Where the price sits against its 20-, 50- and 200-day averages, and whether those are rising.", ".score__group"],
  [["Momentum"], "How strongly the price is moving: RSI, MACD and the recent change.", ".score__group"],
  [["Volume"], "Whether trading activity is backing the move.", ".score__group"],
  [["Relative strength"], "How the stock is doing against the Nifty 50 over the same period."],
  [["Trend pullback to the 20 EMA"], "A healthy uptrend that has dipped to its 20-day average and turned back up: buying the pause rather than the peak."],
  [["55-day breakout with volume"], "A close at the highest level in 55 trading days on clearly above-average volume. Left when it makes a 20-day low."],
  [["MACD turn-up in an uptrend"], "Momentum turning up (MACD crossing above its signal) while the trend and RSI already favour buyers."],
  [["Supertrend turns bullish"], "The Supertrend (10, 3) has flipped from red to green. Held until it flips back."],
  [["Golden cross (50 over 200 DMA)"], "A slow, long-term signal: the 50-day average is above the 200-day average."],
  [["Short-term dip in an uptrend (RSI-2)"], "In a long-term uptrend, a sharp two-to-three-day sell-off (2-period RSI below 10), sold on the bounce."],
  [["Volatility squeeze breakout"], "After an unusually quiet stretch (Bollinger Bands at their narrowest in about six months), the first strong close above the upper band."],
  [["History"], "What this stock has returned year by year, and how rough the ride was.", ".an-card__head"],
  [["Returns"], "The price change over standard periods."],
  [["Year by year"], "The return of each calendar year in the stored history."],
  [["Risk"], "How far the stock has fallen from its peaks, and how much it swings.", ".an-card"],
  [["Below its peak now"], "How far the price is below the highest point in this history."],
  [["1 month", "3 months", "6 months", "1 year"], "The price change over that period."],
  [["Costs per round trip"], "Brokerage, taxes and slippage assumed for each buy and sell together. It is taken off every trade’s result."],
  [["Set up the AI strategist", "Set up the AI"], "Opens the AI settings, where the Anthropic API key is entered."],
  [["AI co-pilot · off"], "The co-pilot is a language model’s second reading of the live call. It is off because no Anthropic API key is set."],

  /* ------------------------------------------------------------ position size */
  [["Position size"], "Work out how many shares to trade from the money you are prepared to lose.", ".an-card__head"],
  [["Trading capital (₹)"], "The money in your trading account. Remembered on this device only — it is never sent anywhere."],
  [["Risk per trade (%)"], "The share of your capital you accept losing if this one trade hits its stop."],
  [["Entry price (₹)"], "The price you plan to buy at."],
  [["Stop-loss (₹)"], "The price at which you will sell if the trade goes wrong."],
  [["Position value"], "Shares × entry price: the money tied up in the trade."],
  [["Loss if the stop is hit"], "What the trade loses if it is closed at the stop. A gap past the stop can lose more."],
  [["Stop distance"], "Entry minus stop, in rupees and in percent."],

  /* ----------------------------------------------------------------- backtest */
  [["Backtest on this stock"], "How each rule-based setup would have done on this stock’s own history, costs included. Past behaviour, not a promise."],
  [["Setup"], "The rule-based setup that was tested.", ".bt__table"],
  [["Trades"], "How many times the setup traded in this history. A handful of trades proves very little."],
  [["Win rate"], "The share of trades that made money. It means little without the average win and loss beside it."],
  [["Avg win / loss"], "The average gain of the winners against the average loss of the losers."],
  [["Per trade"], "The average result of one trade after costs. This is what the setup is really worth."],
  [["Profit factor"], "Total gains divided by total losses. Above 1 it made money; below 1 it lost."],
  [["Return / yr"], "The compound yearly return of following the setup — compare it with simply holding the stock."],
  [["Worst fall"], "The deepest drop of the setup’s results from a peak. What following it would have felt like at its worst."],
  [["In market"], "The share of days the setup was holding the stock."],
  [["Evidence"], "How far the sample can be trusted. Few trades are weak evidence.", ".bt__table"],
  [["Why it closed"], "What ended the trade: its stop, its exit rule, or the end of the data."],

  /* ------------------------------------------------------------ AI strategist */
  [["Intraday"], "Ask for a same-day plan only.", ".ai-go"],
  [["Swing"], "Ask for a days-to-weeks delivery plan only.", ".ai-go"],
  [["Both"], "Ask for an intraday plan and a swing plan.", ".ai-go"],
  [["Score outcomes & learn"], "Score past plans against the prices that followed and, once at least three new plans have finished, ask the AI what they teach."],
  [["Check again"], `Search the web again for news on this company. ${TOKENS}`],
  [["Track record and learning"], "Every AI plan is saved and later scored by arithmetic against real prices. Only those results can become lessons."],
  [["Plans made"], "AI plans written, not counting “no trade” answers."],
  [["Finished"], "Plans that have ended: target, stop, or time limit."],
  [["Reached target"], "Plans whose first target was reached before the stop."],
  [["Stopped out"], "Plans whose stop was hit first. A bar that touches both stop and target counts as a stop."],
  [["Timed out"], "Plans that reached neither stop nor target before their time limit."],
  [["Never triggered"], "Plans whose entry price was never reached, so no trade happened."],
  [["Rejected by checks"], "Plans that failed the desk’s arithmetic checks, for example a stop on the wrong side or a reward smaller than the risk."],
  [["Average result"], "The average outcome of finished plans, in R: multiples of the planned risk."],
  [["Won"], "The share of finished plans that ended in profit. With fewer than about thirty, it says little."],
  [["Checks"], "Whether the plan passed the desk’s arithmetic checks."],
  [["Trading-skills file"], "The rules the AI strategist follows, plus the lessons you have accepted. You can edit it here."],
  [["Undo changes"], "Put the text back to what is saved.", ".ai-skills"],
  [["Reset to the starting rules"], "Replace the file with the original rules and clear every lesson.", ".ai-skills"],

  /* ------------------------------------------------------------------ screener */
  [["Search"], "List every NSE stock whose RSI is in the range you typed, at this moment.", ".scr"],
  [["RSI now"], "The daily RSI with the live price as today’s bar: its value at this moment."],
  [["RSI at last close"], "The RSI as it stood at the close of the previous session."],
  [["Today"], "The change from yesterday’s close.", ".scr"],
  [["Volume today"], "Shares traded today so far."],
  [["Avg traded value"], "The average rupee value traded per day over the last 20 sessions: how easy the stock is to get in and out of."],
  [["RSI (as found)", "Change today", "Turnover", "Name"], "Sort the results by this.", ".scr"],
  [["Download the NSE stock list"], "Fetch about a year of daily closes for every NSE stock, once — roughly twelve minutes. After that the list keeps itself up to date."],
  [["RSI is"], "How to compare: about a value (within 2), at least, at most, or between two values."],
  [["RSI value", "From", "To"], "RSI runs from 0 to 100. Below 30 is commonly called oversold, above 70 overbought.", ".scr"],
  [["Period"], "How many days the RSI is worked out over. 14 is the standard.", ".scr"],
  [["Traded value"], "Leave out thinly traded stocks: list only those whose average daily traded value is at least this."],
  [["Include ETFs and liquid funds"], "Also list exchange-traded funds, which are otherwise left out."],

  /* --------------------------------------------------------------- day debrief */
  [["Assumed cost of a round trip"], "Brokerage, taxes and fees for buying and selling once, as a share of the position’s value. An assumption — your contract note is the truth."],
  [["None", "0.05%", "0.1%", "0.2%"], "The cost assumed for one round trip. Changing it changes the results, never the calls.", ".db-filters"],
  [["Refresh"], "Replay the watchlist again. Results are kept for a minute while the market is open.", ".db"],
  [["Calls made"], "How many times the replayed engine said “in play”, long or short. Each one is treated as one imaginary trade."],
  [["Reached target"], "Calls that hit their 1R target before their stop.", ".db"],
  [["Stopped out"], "Calls whose stop was hit first.", ".db"],
  [["Closed at 3:15 PM"], "Calls that reached neither stop nor target and were closed at the square-off."],
  [["Before costs"], "The finished calls added together, in R, before any charges."],
  [["Costs", "Cost"], "The assumed charges, in R. The tighter the stop, the bigger the share of the risk that costs eat."],
  [["After costs"], "Before costs minus costs. This is the number that matters."],
  [["Deepest dip on the way"], "The largest fall of the running total from an earlier high during the day."],
  [["Running total, after costs"], "Every finished call of the day in the order it ended. A step up is a winner; a step down, a loser."],
  [["Stock by stock"], "One row per watchlist stock. Open a row for its price through the day, the side the engine was on, and each call.", ".an-card__head"],
  [["Day"], "The stock’s change on the day, and since its open.", ".db-table"],
  [["Calls"], "How many “in play” calls the replay found, and how they ended.", ".db-table"],
  [["Call"], "The side, the time the call appeared, the engine’s score and whether it went with the daily trend.", ".db-calls"],
  [["Long"], "A call to buy: the engine read the tape as rising.", ".db-calls"],
  [["Short"], "A call to sell first and buy back lower: the engine read the tape as falling. In the cash market a short is closed the same day.", ".db-calls"],
  [["Entry"], "The close of the 5-minute bar at which the call appeared.", ".db-calls"],
  [["Target"], "The 1R target: as far from the entry as the stop, on the winning side.", ".db-calls"],
  [["How it ended"], "Target, stop, or the 3:15 PM square-off — with the time and the price."],
  [["Write the debrief", "Write it again"], `Ask the AI to read these numbers back as a short review. ${TOKENS}`],
  [["Add to the skills file"], "Save this lesson in the trading-skills file. The AI strategist follows it from its next plan."],
  [["Lessons it suggests"], "At most three, and only when several of the day’s calls support one. Nothing is saved unless you add it."],

  /* --------------------------------------------------------- clocks, holidays */
  [["Check now"], "Ask the server to fetch NASDAQ’s holiday list again. At most once a minute."],
  [["24h", "12h"], "Show the clocks in 24-hour or 12-hour time."],
  [["Year"], "Which year’s market holidays to show."],

  /* ---------------------------------------------------------------- settings */
  [["Anthropic API key", "Replace the API key"], "The key from Anthropic’s developer console. It is stored encrypted on the server and never shown again."],
  [["Save"], "Store these settings.", ".adm-form"],
  [["Client ID", "Google Client ID"], "The public name of your Google sign-in client. It ends in .apps.googleusercontent.com."],
  [["Client Secret", "Google Client Secret"], "The private half of the Google sign-in client. Stored encrypted; never shown again."],
  [["Save credentials"], "Store the Google credentials. They are used from the next sign-in."],
  [["Measurement ID"], "The Google Analytics ID of the public website, like G-XXXXXXXXXX. Empty turns analytics off."],
  [["Add admin"], "Allow this Google account to sign in to the private area."],
  [["Test the key"], "Send one tiny request to check that the key and the model work."],
  [["Remove the key"], "Delete the stored API key. The AI features switch off; everything else keeps working."],
  [["Save the co-pilot's limits"], "Store these limits. The desk uses them from the next reading."],
  [["Model"], "Which Claude model writes strategies, debriefs and briefs. More capable models cost more per request.", ".adm-form"],
  [["Model for the co-pilot"], "The model for live readings. A faster one answers sooner."],
  [["Shortest time between readings (seconds)"], "However much happens, the co-pilot does not read one stock more often than this."],
  [["Most readings in a day"], "A hard daily limit across all stocks. When it is reached the co-pilot stops until tomorrow."],
  [["Look again after this many quiet minutes"], "With “Go live” on and nothing happening, read again after this long. 0 means only when something happens."],
  /* ---- Positions & orders (the account and trading) */
  [["Positions & orders"], "Your Zerodha account: positions with live P&L, holdings, orders, trades and funds — and the trading switch. For the account owner only."],
  [["Positions"], "What you bought or sold today (and F&O carried overnight), with P&L at the live price.", ".tr"],
  [["Holdings"], "Delivery shares in your demat account, with what you paid and what they are worth now.", ".tr"],
  [["Orders"], "Today’s order book: orders still open (they can be changed or cancelled), executed ones, and the trades that filled them.", ".tr"],
  [["Funds"], "Margin and cash as Zerodha reports them, for equity and commodity.", ".tr"],
  [["Product"], "MIS = intraday (squared off by Zerodha before the close), CNC = delivery, NRML = F&O carried overnight.", ".tr"],
  [["Instrument"], "The trading symbol and its exchange.", ".tr"],
  [["Qty.", "Qty"], "Number of shares (or units). Negative means a short position.", ".tr, .tr-ticket"],
  [["Avg.", "Avg. cost"], "The average price you paid (or sold at, for a short).", ".tr"],
  [["LTP"], "Last traded price — live while prices stream, otherwise refreshed every few seconds.", ".tr, .tr-ticket"],
  [["P&L"], "Profit or loss in rupees at the live price. For positions it follows Zerodha’s formula: sold value − bought value + open quantity × price.", ".tr"],
  [["Chg."], "The price change since yesterday’s close.", ".tr"],
  [["Cur. val"], "What the holding is worth at the live price.", ".tr"],
  [["Net chg."], "Profit or loss on the holding as a percentage of what you paid.", ".tr"],
  [["Day chg."], "How much the share has moved since yesterday’s close.", ".tr"],
  [["Exit"], "Close this position with an opposite order. You choose the quantity and confirm. Greyed out while trading is off.", ".tr"],
  [["Modify"], "Change an open order’s quantity, price, trigger or type. Greyed out while trading is off.", ".tr"],
  [["Exit all positions"], "Emergency square-off: an opposite market order (with protection) for every open position, after cancelling pending orders if you tick that. You type EXIT ALL to confirm."],
  [["Open orders", "Executed orders", "Trades"], "Orders still waiting at the exchange, orders that finished (filled, rejected or cancelled), and the individual fills.", ".tr"],
  [["Available margin"], "What Zerodha says you can use for new trades right now."],
  [["Used margin"], "Margin blocked by open positions and pending orders."],
  [["Ask the coach"], `The AI reads your positions and holdings beside the desk’s live call and levels, and says what it would do with each. It advises only; it cannot place orders. ${TOKENS}`],
  [["Open exit form"], "Opens the exit form for this position, prefilled. You still choose the quantity and confirm."],
  [["Trigger price"], "The price that sets off a stop order. SL: then a limit order at your price. SL-M: then a market order.", ".tr-ticket, .tr-dialog"],
  [["Market protection %"], "Zerodha turns a market order into a limit this far from the price, so it cannot fill at any price. Empty = Zerodha’s automatic limit.", ".tr-ticket"],
  [["Validity"], "Day: the order stays until filled or the close. Immediate or cancel: whatever cannot fill at once is cancelled.", ".tr-ticket"],
  [["After-market order (AMO)"], "Placed now, sent to the exchange when the market next opens."],
  [["Intraday"], "MIS: squared off by Zerodha before the close; needs less margin.", ".tr-ticket"],
  [["Longterm"], "CNC: delivery — the shares go to your demat account.", ".tr-ticket"],
  [["Overnight"], "NRML: an F&O position you can carry to the next day.", ".tr-ticket"],
  [["Market"], "Fill at the best available price now (with market protection).", ".tr-ticket"],
  [["Limit"], "Fill only at your price or better.", ".tr-ticket"],
  [["SL"], "Stop-loss limit: when the trigger is touched, a limit order at your price is sent.", ".tr-ticket"],
  [["SL-M"], "Stop-loss market: when the trigger is touched, a market order is sent.", ".tr-ticket"],

  /* ---- Research */
  [["Research"], "Pre-market and post-market preparation for your watchlist: a data sheet per stock and, with an AI key, a note and a summary."],
  [["Pre-market", "Post-market"], "Before the open the research looks at what to expect today; after the close it reviews today and prepares tomorrow."],
  [["Key levels"], "Resistances above, supports below and the pivot — taken from the desk’s own levels.", ".rs"],
  [["Scenarios for the session"], "If-then plans tied to levels: what it would mean if the stock opens or trades above or below them.", ".rs"],
  [["Long trigger", "Short trigger (intraday)"], "What would have to happen before a trade on that side makes sense.", ".rs"],
  [["Cancels the idea"], "The level or event that would prove the bias wrong.", ".rs"],
  [["Stand aside if"], "Conditions in which the stock is best left alone.", ".rs"],
  [["Data sheet"], "The desk’s raw numbers for the stock: indicators, levels, setups, backtests and the multi-time-frame view.", ".rs"],
  [["AI notes"], "Have the AI write a research note per stock and a summary. Off, you get the data sheets only.", ".rs"],
  [["Open on desk"], "Open this stock on the trading desk.", ".rs"],

  /* ---- Advisor: measured odds */
  [["Advisor"], "Your watchlist read by measured odds: what followed the past days most like today, whether such calls held up when tested forward, and a plan sized for your risk."],
  [["Measured odds"], "Frequencies from this stock’s own past: how the days most like today turned out, and whether calls like this held up when each was made from earlier data only. Not a forecast."],
  [["Risk per trade"], "The money you accept losing if a trade hits its stop. Every quantity on the board is this amount divided by the distance to the stop."],
  [["Does the method work on your watchlist?"], "The forward test of every stock on the board added together. One stock can look good by luck; a method that holds across many is harder to fake."],
  [["Forward record"], "Every favourable call, written down the day it was made and scored later by the engine’s own rules. It starts empty, and hindsight cannot improve it."],
  [["Latest calls"], "The most recent favourable readings and, once known, how each one ended in R."],
  [["How to read this"], "The method in four steps: similar days, two fixed trades, the forward test that decides the grade, and sizing by risk."],
  [["Swing"], "A trade held for up to ten sessions: in at the next open, stop 1.5 ATR away, target 2.25 ATR.", ".av-kind"],
  [["Day"], "A trade for one session: in at the open, stop 0.6 ATR away, out at the close.", ".av-kind"],
  [["The measured odds say"], "What the AI took from the measured odds and their forward test when it made this decision."],
  [["After similar days"], "Where the stock went, close to close, after the days most like today. No stop, no target, no costs."],
  [["Most similar days"], "The past days that looked most like today, and what a swing long taken the next morning did, in R after costs."],
  [["Were its odds honest?"], "Over the forward test: when the similar days said a swing long would win this often, how often did it? Close numbers mean the odds can be believed."],

  /* ---- the ticket's exit plan and pre-trade check */
  [["Stop"], "The price at which you accept the trade is wrong and get out. It is not sent with the order: after the fill the terminal offers the stop-loss order to confirm.", ".tr-plan"],
  [["Target"], "The price at which you plan to take the profit. Kept as your plan; not sent as an order.", ".tr-plan"],
  [["Risk ₹"], "The money you accept losing on this trade. With a stop it gives the quantity that fits.", ".tr-plan"],
  [["Margin needed"], "What Zerodha’s calculator says this order would block from your funds.", ".tr-pre"],
  [["Available"], "The margin your account has free right now.", ".tr-pre"],
  [["Charges"], "Brokerage, taxes and exchange fees for this order, by Zerodha’s calculator.", ".tr-pre"],
  [["Place the stop…"], "Open the stop-loss order for the entry that just filled, as a ticket. Nothing is sent until you confirm it."],

  /* ---- the terminal on a phone or tablet */
  [["More"], "The rest of the workspaces, the market clock, the Zerodha connection and the theme.", ".tm-bnav"],
  [["Connect"], "Go to the Desk to log in to Zerodha.", ".tm-sheet"],
  [["Light theme", "Dark theme"], "Switch the whole terminal between dark and light.", ".tm-sheet"],
  [["Open on the Desk"], "Open this stock on the Desk: chart, live call, order book."],

  /* ---- research: the direction */
  [["Long-term owner"], "Is this a stock in a durable uptrend worth owning? Its 200-day line, the long-term checks, its place in the 52-week range and its drawdown.", ".dir"],
  [["Trend follower"], "Is the swing trend up, and is it strong? The swing reading, the 20- and 50-day averages, and ADX.", ".dir"],
  [["Momentum"], "Is buying pressure building or fading? RSI, MACD and the 20-day rate of change.", ".dir"],
  [["Measured odds"], "Did days like today pay, tested forward? The Advisor's grade — the only lens tested on unseen data.", ".dir"],
  [["Habits"], "How this stock usually behaves from here, from its own one-year record.", ".dir"],
  [["Market backdrop"], "Whether the Nifty's tide is with the stock or against it.", ".dir"],
  [["Risk"], "Whether it can be traded sensibly: volatility, liquidity and the room to the next level. It never picks a direction; it lowers the confidence.", ".dir"],
  [["Value investor"], "Earnings, debt, cash flow and valuation. Not available: the data source does not provide company financials, and the desk does not guess them.", ".dir"],
  [["Entry", "Stop", "Targets", "Reward : risk"], "The plan for this direction, taken from the stock's own levels.", ".dir"],
  [["Time zone converter"], "Pick a date and time in one zone and see it in another. Every zone in the world, with daylight saving."],

  /* ---- price alerts and the palette */
  [["Price alerts"], "Be told when a stock reaches a level: a sound, a note on this page and, if you allow them, a browser notification. Kept in the database; checked while the terminal is open. An alert never trades."],
  [["Set alert"], "Save this alert. Leave the side on “reaches” and it is taken from the price now."],
  [["Fired"], "Alerts whose level was reached, with the time and the price seen.", ".tm-alerts"],
  [["Allow notifications"], "Let this site show a browser notification when an alert fires, even when the tab is in the background."],
];

const PATTERNS = [
  [/^show (all \d+ round trips|only the latest \d+)$/, "The list opens on the latest trades. The figures above always cover every trade in the period."],
  [/^use [\d,]+ shares for /, "Set the quantity so that being stopped out loses about the risk you entered: the risk divided by the distance from the entry to the stop."],
  [/^order limits/, "A guard against a fat finger: an order above these is refused unless it only closes something you already hold."],
  [/^research \d+ stocks?$/, "Run the research for the stocks picked above."],
  [/^trading (on|off)$/, "The master switch for trading from this site. OFF: Buy, Sell, Exit, Modify and Cancel do nothing. ON: they send real orders to Zerodha."],
  [/^target \d+(\.\d+)?r$/, "A price target that many times the risk away from the entry. At 1R the trade has made what it risked."],
  [/^level: /, "A nearby price level from the pivots or the previous day, where moves often pause."],
  [/^(at )?\d r( level| — .*)?$/, "The price at which the trade has made that many times what it risked."],
  [/^against /, "The stock’s return minus the index’s over the same period. Positive means it beat the market."],
  [/^open .+ on the trading desk$/, "Go to the trading desk with this stock selected."],
  [/^(buy|sell) (at the current price|on a pullback|on a bounce|after a 5-minute close|only if it trades there)/, "The entry price of this plan, and how it is taken."],
  [/^(weakening —|early warnings —)/, "First signs that the move is changing character. A warning is a reason to tighten up or wait; it never starts a trade by itself."],
  [/^next \d+ seconds · /, "A small model that learns today, on this stock, how the order book relates to the price a little later. Trust it only as far as the hit rate printed with it."],
  [/^1-minute (tape|read) · /, "A quick read of 1-minute bars. It turns before the 5-minute view and is wrong more often: use it for timing, not to overrule the call."],
  [/^swing · days to weeks · /, "The daily-chart reading and its delivery plan: entry, stop, targets and the level that ends the bullish case."],
  [/^long term · months to years$/, "A checklist of long-term trend conditions, the line that ends the trend, and what the stock has actually returned."],
  [/^trend line \(/, "The level that defines the long-term trend. A weekly close below it ends an uptrend."],
  [/^[\d.]+ years?, per year$/, "The compound yearly growth of the price over that period."],
  [/^vs .+, 12 months$/, "The stock’s 12-month return minus the index’s. Positive means it beat the market."],
  [/^(resistance|support) \(\d+×\)$/, "A level where price has turned that many times before. More touches make a stronger level."],
  [/^build strategy for /, `Ask the AI to write a plan for this stock from its live and historical data. Every plan is checked by arithmetic and saved. ${TOKENS}`],
  [/^check the news on /, `A web search on this company: results, contracts, rating changes and what is scheduled. ${TOKENS}`],
  [/^(deeply |very )?(oversold|overbought) [≤≥] \d+$|^mid-range /, "A common search: it fills in the RSI range for you."],
];

const GLOBAL = new Map();
const SCOPED = new Map();
for (const [labels, tip, scope] of ENTRIES) {
  for (const label of labels) {
    const k = keyOf(label);
    if (scope) {
      if (!SCOPED.has(k)) SCOPED.set(k, []);
      SCOPED.get(k).push({ scope, tip });
    } else GLOBAL.set(k, tip);
  }
}

/**
 * The help for a label, or null.
 * @param text  the label's own text
 * @param el    the element it sits in (decides between meanings by where it is)
 */
export function lookup(text, el = null) {
  const k = keyOf(text);
  if (!k || k.length > 60) return null;
  const scoped = SCOPED.get(k);
  if (scoped && el && typeof el.closest === "function") {
    for (const s of scoped) if (el.closest(s.scope)) return s.tip;
  }
  if (GLOBAL.has(k)) return GLOBAL.get(k);
  for (const [re, tip] of PATTERNS) if (re.test(k)) return tip;
  return null;
}

/** For tests and for a count on the page: every entry as written. */
export const ALL = { entries: ENTRIES, patterns: PATTERNS };
