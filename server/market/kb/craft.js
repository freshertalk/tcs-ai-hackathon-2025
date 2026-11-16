"use strict";
// The knowledge base, part 5: the working knowledge of the trade — derivatives, how the market's plumbing
// works, special days, the rules of thumb and "hacks" traders pass on (with how far each can be trusted),
// systematic and quantitative method, investing, global links, India's lists and surveillance, and the
// schools of analysis the evidence does not support. These are widely published practice, stated with their
// limits; a rule of thumb is a hypothesis to measure on the desk's own data before it is relied on, and the
// desk's measured records outrank every line here. Data only: text about markets, nothing that trades.

module.exports = [
  /* ------------------------------------------------------------------------------ options and derivatives */
  {
    id: "opt-basics",
    area: "Options and derivatives",
    title: "Options in one page",
    keys: "option call put strike premium intrinsic time value itm atm otm lot expiry buyer writer seller cash settled physical settlement",
    rules: [
      "A call gives the right to buy at the strike, a put the right to sell. The buyer pays the premium and can lose no more than that; the seller (writer) receives it and carries the larger, sometimes unlimited, risk and must post margin.",
      "Premium = intrinsic value (how far in the money) + time value (what the market pays for the chance of a further move). At expiry only intrinsic value is left, so every option's time value decays to zero.",
      "In India index options are cash-settled and European (exercised only at expiry); stock derivatives are physically settled, so a stock option or future held into expiry can mean delivery or a margin shortfall — check the exchange's current circulars before holding one.",
      "Lot sizes, strikes and expiry days are set by the exchange and change from time to time: read the current contract specification instead of relying on memory.",
      "Options are leverage on a probability: the cheap far-out-of-the-money option is cheap because it usually expires worthless.",
    ],
  },
  {
    id: "opt-greeks",
    area: "Options and derivatives",
    title: "The Greeks: delta, gamma, theta, vega",
    keys: "delta gamma theta vega rho greeks sensitivity hedge decay",
    rules: [
      "Delta is how much the option's price moves for ₹1 in the underlying (and roughly the chance of finishing in the money): about 0.5 at the money, towards 1 deep in, towards 0 far out.",
      "Gamma is how fast delta changes: it is largest at the money near expiry, which is why a small move can swing a short-dated option's value violently — good for buyers when right, dangerous for writers.",
      "Theta is the premium lost to the passing of a day, and it accelerates in the last days to expiry: a buyer needs the move to arrive soon and be big enough to beat it.",
      "Vega is the change in premium for one point of implied volatility: buying options before an event is partly a bet on volatility, and the volatility usually falls once the event has passed.",
      "Greeks change as price, time and volatility change; they describe the option now, not at the exit.",
    ],
  },
  {
    id: "opt-iv",
    area: "Options and derivatives",
    title: "Implied volatility, IV rank and the volatility crush",
    keys: "implied volatility iv rank percentile vix crush skew smile realised historical volatility",
    rules: [
      "Implied volatility (IV) is the volatility the option's price implies; India VIX is the market's 30-day expectation from Nifty options. High IV makes options expensive to buy and rewarding to sell; low IV the reverse.",
      "IV rank or percentile places today's IV within its own past year, so 'expensive' or 'cheap' is judged against that underlying's history, not an absolute number.",
      "Before a known event (results, a policy decision, the budget) IV rises and after it IV collapses — the 'volatility crush' — so a buyer can be right on direction and still lose.",
      "Implied volatility is usually higher than the volatility that is then realised: that gap is the premium option sellers collect, and the reason selling is statistically attractive and also periodically ruinous when the tail event arrives.",
      "Skew: out-of-the-money puts usually carry a higher IV than calls — the market pays more for protection against falls.",
    ],
  },
  {
    id: "opt-strategies",
    area: "Options and derivatives",
    title: "Common option structures and when each fits",
    keys: "spread straddle strangle iron condor covered call protective put calendar hedge defined risk bull call bear put butterfly",
    rules: [
      "Long call or put: a directional bet with risk limited to the premium; it needs direction and timing, so the odds of a profit are lower than the odds of being right on direction.",
      "Vertical spreads (bull call, bear put) cap both cost and profit: they cut the premium paid and the time decay and are the standard way to express a view with a known maximum loss.",
      "Long straddle or strangle bets on a large move either way; the seller's version (short straddle, iron condor) bets on a quiet market and collects premium, with risk that is undefined (straddle) or capped (condor).",
      "Protective put and covered call: insurance on a position you hold, and income against it in exchange for giving up upside above the strike.",
      "A rule for new option traders: prefer defined-risk structures, size so that the whole premium or the maximum loss is an acceptable day, and never sell naked options without the margin and the temperament for a gap.",
    ],
  },
  {
    id: "opt-chain",
    area: "Options and derivatives",
    title: "Reading the option chain: open interest, PCR, max pain",
    keys: "option chain open interest oi pcr put call ratio max pain support resistance writers strike build up unwinding",
    rules: [
      "The highest put open interest is read as support (writers defend it) and the highest call open interest as resistance; the chain is a map of where positions are concentrated, not a forecast.",
      "A fall in open interest at a strike with a price move through it means writers are covering (unwinding); a rise with the price holding means they are adding — the change through the day matters more than the level at the open.",
      "Put-call ratio (put OI over call OI) is a sentiment gauge: extremes are read contrarily, but it is crude on its own and differs by the expiry and strikes included.",
      "Max pain is the strike at which option buyers would lose most at expiry; prices are sometimes pulled towards it into expiry, but the effect is small and unreliable.",
      "Open interest does not say who is buying and who is writing, and large participants hedge across strikes and futures: treat the chain as evidence that agrees or disagrees with the price, never as the whole case.",
    ],
  },
  {
    id: "opt-expiry",
    area: "Options and derivatives",
    title: "Expiry day: gamma, decay and the 'zero-to-hero' trap",
    keys: "expiry day weekly monthly zero hero gamma theta pinning settlement exercise stt itm physical delivery",
    rules: [
      "On expiry day time value melts within hours and gamma is at its peak: out-of-the-money options go to zero unless the move is large and fast, and the occasional 'zero-to-hero' is the exception the rest of the day pays for.",
      "Prices tend to be 'pinned' towards heavily written strikes into the close, then break when hedges are removed; the last hour is erratic and spreads widen.",
      "An in-the-money option that is exercised or settled at expiry can carry a settlement STT far larger than on a normal sale — square off before expiry instead of letting it settle, and know the current rules for stock options settled physically.",
      "Selling options on expiry day collects fast decay and carries the sharpest gap risk; buying them is paying for lottery tickets. Whichever side, size to survive the worst case.",
      "Exchanges change which weekday each index expires on and which contracts exist: read the current calendar before assuming.",
    ],
  },
  {
    id: "fut-basis",
    area: "Options and derivatives",
    title: "Futures: basis, cost of carry, rollover and what open interest adds",
    keys: "futures basis premium discount cost of carry rollover roll long build up short build up covering unwinding mark to market margin",
    rules: [
      "A future normally trades above spot by the cost of carry (interest less dividends); the gap (basis) narrows to zero by expiry. A premium far above carry means eager longs, a discount means shorts or hedging pressure.",
      "Price up with open interest up is fresh buying (long build-up); price up with OI down is shorts covering; price down with OI up is fresh selling; price down with OI down is longs leaving — a four-way reading that is only as good as the volume behind it.",
      "Rollover — moving positions from the expiring month to the next — shows in the last week: the share of OI already rolled and the roll cost say how conviction is being carried forward.",
      "Futures are marked to market daily: losses are paid in cash every day, so the real risk is the margin call, not only the final price.",
      "Index futures and the cash index can diverge intraday; the futures are the hedging instrument for the market's big players and often lead the index by moments.",
    ],
  },

  /* ----------------------------------------------------------------------------------- market microstructure */
  {
    id: "mic-book",
    area: "Market microstructure",
    title: "The order book: spread, depth, imbalance, spoofing",
    keys: "order book depth spread bid ask queue imbalance iceberg spoofing level 2 market depth liquidity wall",
    rules: [
      "The best bid and offer and the quantity behind them are the market: the spread is the cost of immediacy, and depth says how much can trade before price moves.",
      "At one price, orders fill in time order, so being early in the queue matters; a large resting order can be an iceberg whose visible part is a fraction of the real size.",
      "A heavy imbalance (far more on the bid than the offer) hints at pressure, but it can be pulled in a moment: an order that vanishes as price approaches it (spoofing, or simply a changed mind) tells you nothing.",
      "Retail sees the five best levels; the market's real liquidity also sits in hidden orders and algorithms: read depth as supporting evidence only, and trust executed volume over displayed orders.",
      "Wide spreads and thin depth in illiquid stocks make a good chart untradeable: the spread alone can eat the whole expected move.",
    ],
  },
  {
    id: "mic-auction",
    area: "Market microstructure",
    title: "Pre-open and closing: how the open and the close are set",
    keys: "pre open auction call auction opening price closing price vwap last half hour equilibrium price discovery order matching",
    rules: [
      "Before the open a call auction collects orders and sets one equilibrium price at which the most volume trades; the first session price is not a free-for-all, and the pre-open indications are the day's first read of demand.",
      "The first minutes after the open are the noisiest: spreads are wide, orders from overnight news arrive together and many moves reverse; many intraday rules wait for the opening range (the first 15–30 minutes) to form.",
      "A stock's official closing price on NSE is the volume-weighted average of the last half hour's trades, so late trading is dominated by closing-price-linked flows (index funds, derivative settlement) rather than fresh views.",
      "Index changes, expiries and fund rebalances cluster volume at the close: a sharp last-half-hour move often says more about flows than about the stock.",
      "Pre-open and special sessions have their own rules and price bands: check the exchange's notices for the details of the day.",
    ],
  },
  {
    id: "mic-algos",
    area: "Market microstructure",
    title: "Who is on the other side: institutions, algorithms, market makers",
    keys: "institutions fii dii algos hft market maker vwap twap execution flows block deal bulk deal retail footprints",
    rules: [
      "Big institutions cannot trade their size at once: they slice orders over hours (VWAP, TWAP, participation algorithms), which leaves footprints — persistent volume at a price, steady absorption of selling, trend days that grind.",
      "Market makers and high-frequency firms earn the spread and trade on speed; retail cannot out-run them and should not try — they are why spreads are narrow in liquid names.",
      "Bulk and block deals, FII and DII provisional data and delivery volumes show where large money has been, after the fact; they are evidence about the weeks, not a signal for the next five minutes.",
      "The edge for a small trader is not speed but patience, size flexibility and choosing the few situations — a clean break with volume, a trend day — where the large players' slicing helps rather than hurts.",
      "When a move has no volume and no news, expect it to be a liquidity artefact and to retrace.",
    ],
  },
  {
    id: "mic-slippage",
    area: "Market microstructure",
    title: "Execution quality: slippage, order type and size against liquidity",
    keys: "slippage market order limit order impact size average daily volume partial fill spread cost stop loss market sl m",
    rules: [
      "Slippage is the difference between the price you meant to get and the price you got: it is largest on market orders, in fast moves, in illiquid stocks and at the open and the close.",
      "A limit order controls the price and risks not being filled; a market order guarantees the fill and not the price. Entries at a level are usually limits; protective stops must accept slippage.",
      "A stop-loss order (SL) that triggers a market order can fill far beyond the trigger in a gap; a stop-limit can fail to fill at all. Know which you have and size so that the worst fill is an acceptable loss.",
      "Keep position size a small fraction of the stock's typical volume: a rule of thumb is to stay well under one percent of a day's volume, and far less for a quick exit.",
      "Every round trip pays brokerage, statutory charges and slippage; the strategy has to beat all three before it has an edge, which is why very short scalps in thin stocks lose.",
    ],
  },

  /* --------------------------------------------------------------------------------------- calendar and events */
  {
    id: "cal-days",
    area: "Calendar and events",
    title: "Special days and calendar effects",
    keys: "expiry month end rollover budget rbi policy results ex dividend record date index rebalance muhurat monday friday holiday global cues gift nifty",
    rules: [
      "Days with known scheduled events — the Union Budget, the RBI policy, the Fed decision, results of heavyweight companies, derivative expiry, index rebalancing — carry higher volatility and wider swings; many traders cut size or wait for the reaction.",
      "Month-end and rollover weeks bring flows from fund redemptions, F&O position changes and window dressing; expiry sessions are distinct from ordinary ones.",
      "Overnight global cues (US close and futures, GIFT Nifty, crude, Asian markets) shape the open and the gap; the gap's first 30 minutes show whether the market accepts it.",
      "Corporate actions — ex-dividend, record dates, splits, bonuses — change the price mechanically: adjust before reading a chart, and know that the price drop on an ex-date is not a loss of value.",
      "Weekday and time-of-year patterns (Monday gaps, the Muhurat session, the first week of a month) are weak and unstable: treat each as a hypothesis to measure on your own data, never as a rule.",
    ],
  },
  {
    id: "cal-results",
    area: "Calendar and events",
    title: "Trading around results and other events",
    keys: "earnings results quarterly event reaction gap drift guidance surprise implied move straddle news fade",
    rules: [
      "Price reacts to the result against what was expected, not to the result itself: a good number that was already priced in can fall, a poor one that was feared can rise.",
      "Results usually arrive after the close or before the open and gap the stock; a leveraged intraday position cannot be held through them, and a stop does not protect against a gap.",
      "Options price an expected move before the event (the straddle's price is the market's estimate); afterwards implied volatility drops — buying options to hold through the event pays for that estimate in advance.",
      "Many traders trade the reaction instead of the number: wait for the opening range after the gap and enter on a break of it with volume, with a stop on the other side.",
      "Post-event drift: stocks that surprise strongly tend to keep moving in that direction for days to weeks, which suits swing and positional traders more than intraday ones.",
    ],
  },

  /* ----------------------------------------------------------------------------------------- hacks and tricks */
  {
    id: "tr-checklist",
    area: "Hacks and tricks",
    title: "A pre-trade checklist",
    keys: "checklist pre trade plan entry stop target size risk reward market lean levels volume news",
    rules: [
      "Before any entry answer in one line each: what is the setup, which side is the market, where is the entry, where is the stop (the price at which the idea is wrong), where is the first target, what is the reward over the risk after costs?",
      "Then: how big, so that the stop costs a fixed small share of capital; is there a level in the way; is the volume there; is there news or an event; is this a time of day that suits the setup?",
      "If any answer is 'I do not know' the trade waits: a missed trade costs nothing, an unplanned one costs money and habits.",
      "Write the plan before the order, not after: a plan made after entry is a justification.",
      "The same list at the close — was the plan followed, whatever the result? — builds the process that profit rests on.",
    ],
  },
  {
    id: "tr-intraday-hacks",
    area: "Hacks and tricks",
    title: "Intraday rules of thumb, and how far to trust them",
    keys: "intraday tips hacks opening range first 15 minutes lunch lull last hour one setup partial profit breakeven time stop fewer trades",
    rules: [
      "Let the first 15 minutes form the opening range and trade its break with volume rather than the opening noise; skipping the first five minutes avoids the widest spreads and the most reversals.",
      "Fewer, better trades: the midday lull (about 11:30 to 1:30) has smaller ranges and more false breaks; many traders trade the first two hours and the last hour and rest between.",
      "Take part at the first target (about 1R) and move the stop to the entry: it pays for the losers and lets the rest run; the cost is giving up some big winners.",
      "A time stop — leave if the trade has not worked in a set time — frees capital from trades that go nowhere; most real moves start soon after a good entry.",
      "Trade the stocks that are 'in play' today (a gap, news, high relative volume), in the direction of the market's lean and their own VWAP side; a quiet stock is a poor use of the day.",
      "Each of these is a convention, not a law: the desk's own measured records decide which of them pay here.",
    ],
  },
  {
    id: "tr-levels-hacks",
    area: "Hacks and tricks",
    title: "Working with levels: round numbers, retests, failed breaks",
    keys: "levels round number retest failed breakout false break stop hunt confluence previous day high low vwap bands trap",
    rules: [
      "Round numbers and the previous day's high, low and close attract orders and are where moves stall or reverse: a level nearby is a reason to take profit sooner or to wait for a clean break.",
      "Several independent levels at the same price (yesterday's high, a pivot, VWAP, a round number) make a stronger zone than any one of them.",
      "A break that is not held — price back inside the range within a few bars — is a failed breakout and often a fast move the other way: a stop just beyond an obvious level is where the crowd's stops also sit, so place yours a little beyond or use a time or close-based exit.",
      "Breakouts are better with volume and after a tight, quiet base; retests of the broken level from the other side, holding, are the lower-risk entry than chasing the first break.",
      "The first touch of a level is the strongest; each retest weakens it.",
    ],
  },
  {
    id: "tr-entry-exit-hacks",
    area: "Hacks and tricks",
    title: "Entries, exits, scaling and trailing",
    keys: "scale in scale out trailing stop atr chandelier swing low breakeven target r multiple limit order add to winners never average down",
    rules: [
      "Scale in only to winners, never to losers: adding to a trade that is moving your way raises size where the idea is proven; averaging down raises size where it is wrong.",
      "Scale out in steps (a part at 1R, a part at 2R, the rest trailed) to bank the average and keep the tail; one all-or-nothing exit is a coin flip about the top.",
      "Trail the stop behind structure (the last swing low or high, or a multiple of the ATR) rather than a fixed number, so it follows the stock's own noise; tighten after a sharp run.",
      "Set the stop where the idea is wrong, then size the position from it; never widen a stop after entry to 'give it room'.",
      "Use limit orders at planned levels where you can; market orders only to leave when the stop or the plan says so.",
    ],
  },
  {
    id: "tr-market-hacks",
    area: "Hacks and tricks",
    title: "Reading the whole market before the stock",
    keys: "market breadth advance decline index leads sector relative strength vix regime tape leaders laggards correlation strongest weakest",
    rules: [
      "Know the market's lean before the stock's: the index's trend, its position against VWAP and the breadth (how many of its stocks are rising) decide whether longs or shorts have the wind.",
      "In a strong tape buy the leaders (strongest relative strength, shallowest pullbacks); in a weak tape short the laggards; in a chop tape do less.",
      "A stock that holds up while the index falls is showing strength, and one that cannot rise on a rising index is showing weakness: relative strength against the index is among the most reliable simple reads.",
      "India VIX rising into a fall confirms fear; VIX falling on a rising market supports the move; a market that rises on a rising VIX is less trustworthy.",
      "Sectors move as groups: when a sector's leader breaks out, its peers often follow within the session or the week.",
    ],
  },
  {
    id: "tr-scanner-hacks",
    area: "Hacks and tricks",
    title: "Finding the day's stocks: scans and a watchlist routine",
    keys: "scanner screener watchlist gap volume relative volume 52 week high delivery news sector momentum prepare tomorrow list",
    rules: [
      "Good intraday candidates share three things: a reason to move (gap, news, results, sector momentum), unusual volume against the stock's own average, and enough liquidity to enter and leave cleanly.",
      "Swing candidates: strong relative strength, a tight consolidation near a high, rising volume on up days, a sector in favour.",
      "Build tomorrow's list tonight: the few stocks with a clear plan at levels you have already marked, rather than hunting at the open.",
      "Keep the list short (five to ten): attention is a limited resource and a long list becomes a casino.",
      "Delivery percentage (the share of a day's volume taken for delivery) tells which volume is investment and which is intraday churn: high delivery on a rising day is the more durable move.",
    ],
  },
  {
    id: "tr-risk-hacks",
    area: "Hacks and tricks",
    title: "Risk rules that keep a trader in the game",
    keys: "daily loss limit max trades two strikes size down fixed fractional correlation overnight gtt stop order drawdown rules circuit breaker",
    rules: [
      "Risk a small fixed share of capital on a trade (commonly 0.25–1%) so that a run of ten losses is survivable; the size, not the stock, is what makes a trader.",
      "A daily loss limit (for example 1–2% of capital) and a maximum number of trades turn a bad day into a small loss instead of a blow-up; when the limit is hit the day is over, whatever the chart says.",
      "'Two strikes': after two losing trades in a row, stop for a set time or cut size in half — streaks of losses usually mean the conditions have changed, or the trader has.",
      "Several positions in the same sector or direction are one position: count correlated risk together.",
      "Put the protective stop in the market with the entry (an SL order or a GTT) instead of keeping it in your head; the stop that only exists in the mind is not a stop.",
      "Cut size when conviction is low, the market is erratic or you are drawn down; raise it only after evidence.",
    ],
  },
  {
    id: "tr-psych-hacks",
    area: "Hacks and tricks",
    title: "Habits that protect the trader from the trader",
    keys: "journal routine cool off pre commitment tilt revenge overtrading fomo discipline process score screen break walk away",
    rules: [
      "Keep a journal with the plan, the screenshot, the reason and the emotion for every trade: the repeating mistakes in it are worth more than any indicator.",
      "A fixed pre-market routine (the market's lean, the levels, the watchlist, the limits) and a fixed close routine (review, the lesson in one line) make the day rule-driven.",
      "After a loss take a cooling-off period before the next entry; revenge trades are taken from emotion within minutes of a loss and are the most expensive trades there are.",
      "Pre-commit to the rules while calm — the daily stop, the maximum trades, the size — and make them hard to break (broker-side limits, a locked trading switch).",
      "Judge yourself on process (did I follow the plan?) rather than on the day's money: a good process loses sometimes and a bad one wins sometimes, and only the first lasts.",
      "When in doubt, smaller or out: nothing improves by trading while angry, tired or bored.",
    ],
  },
  {
    id: "tr-myths",
    area: "Hacks and tricks",
    title: "Myths and traps that cost beginners money",
    keys: "myth trap tips telegram whatsapp guaranteed strategy copy trading average down overtrading recovery sebi study f&o losses win rate backtest",
    rules: [
      "SEBI's published studies of individual traders found that most — in the F&O segment around nine in ten — lost money over the years studied, after costs; it is the base rate the desk starts from, and it is not a promise about anyone.",
      "No indicator predicts the market and no strategy wins nine trades in ten forever; a very high claimed win rate usually hides rare large losses or an unrealistic backtest.",
      "Tips from groups, 'operators', pump-and-dump messages and paid 'sure' calls are how money moves from small traders to the people selling the tips; verify everything against price and volume yourself.",
      "Averaging down a loser, doubling to recover and trading more to win it back are the three fastest ways to lose a whole account.",
      "A backtest without costs, slippage and out-of-sample testing is a picture of the past that fitted it; the live result will be worse.",
      "Leverage is not an edge: it only magnifies whatever edge, or lack of one, exists.",
    ],
  },

  /* ------------------------------------------------------------------------------------- quant and systems */
  {
    id: "q-edge",
    area: "Quant and systems",
    title: "Edge, expectancy, sample size and calibration",
    keys: "edge expectancy win rate payoff sample size confidence regression to the mean base rate calibration bayes probability r multiple",
    rules: [
      "Expectancy per trade = win rate × average win − loss rate × average loss, after costs: a 40% win rate with winners twice the losers is profitable, a 70% win rate with small winners and big losers is not.",
      "A result needs a sample: thirty trades say little, a few hundred say something, and a streak of luck can look like skill for a long time. Report every figure with its count.",
      "Regression to the mean: an extreme period (a great month, a hot stock) is likely to be followed by a more ordinary one; do not raise size on the best streak.",
      "Start from the base rate (how often this kind of setup works in general) and adjust it by the evidence on this case; a story that feels certain on one chart is usually a small shift from the base rate.",
      "A probability forecast is calibrated when the things it calls 60% happen about 60% of the time; check calibration, not just direction.",
    ],
  },
  {
    id: "q-systems",
    area: "Quant and systems",
    title: "Systematic strategies: momentum, mean reversion, breakout, pairs",
    keys: "systematic momentum mean reversion trend following breakout pairs statistical arbitrage factor regime filter walk forward overfitting capacity kelly volatility targeting",
    rules: [
      "Momentum and trend-following buy what is rising and tend to win rarely and large; mean reversion sells stretches and tends to win often and small — the two suit different regimes, and each pays for its habit in different ways.",
      "Breakout systems need a regime filter (a trending market) and accept many small false-break losses for the few large trends.",
      "Pairs and relative-value trades bet on the gap between two related stocks closing, hedging the market direction; they need stable relationships, costs low enough for the small edge, and a rule for when the relationship has broken.",
      "Test walk-forward: choose parameters on one period and judge them on the next, never on the data that chose them; prefer few parameters and wide plateaus of good settings over a single sharp optimum.",
      "Size by volatility (smaller when the stock is wilder) so each position carries a similar risk; the Kelly fraction shows the growth-optimal bet and is far too aggressive for real, uncertain edges — fractions of it are used.",
      "A strategy has capacity: what works for ₹1 lakh may not for ₹10 crore, and edges decay once many trade them.",
    ],
  },
  {
    id: "q-ml",
    area: "Quant and systems",
    title: "Machine learning in markets: what helps and what fools",
    keys: "machine learning features leakage non stationary ensemble simple model overfit probability human oversight data mining",
    rules: [
      "Markets are noisy and change over time (non-stationary): a model fitted to the past can fail silently when the regime shifts, so it must be monitored and retired.",
      "The biggest sources of false success are leakage (using information that was not known at the time), survivorship bias (only the stocks that survived), and testing many ideas on the same data.",
      "Simple models on a few sound features usually beat complicated ones out of sample; combining several modest, different signals (an ensemble) is more robust than trusting one.",
      "Output a probability and a reason, then act only where the probability has been checked out of sample against what actually happened.",
      "Keep a human in the loop for sizing, for the unusual day and for the cases the data cannot see (news, halts, circuit limits).",
    ],
  },

  /* ---------------------------------------------------------------------------- investing and portfolio */
  {
    id: "inv-allocation",
    area: "Investing and portfolio",
    title: "Building a portfolio: allocation, diversification, SIP, index funds",
    keys: "asset allocation diversification rebalancing sip index fund etf core satellite factor value quality momentum horizon gold debt tax",
    rules: [
      "Asset allocation — the split between equity, debt, gold and cash — explains most of a portfolio's behaviour; choose it from the goal, the time horizon and how much fall you can bear without selling.",
      "Diversify across stocks, sectors and asset classes so that no single event decides the outcome; many holdings in the same theme are one holding.",
      "A regular investment (SIP) in a broad index fund is a sound default for long-term money: it needs no timing and its costs are low. Trading capital is the part you can afford to put to a faster game.",
      "Rebalance on a schedule or when an allocation drifts far: it sells what has run up and buys what has fallen, by rule.",
      "The factors with long records — value, quality, momentum, low volatility — are rewards for particular risks and have bad years; none is a free lunch.",
      "Keep trading capital separate from long-term savings, and withdraw profits on a plan.",
    ],
  },
  {
    id: "inv-quality",
    area: "Investing and portfolio",
    title: "A quick quality check of a company",
    keys: "valuation pe pb ev ebitda peg roe roce debt cash flow promoter holding pledge earnings quality governance dividend",
    rules: [
      "Business: growth in sales and profit over several years, margins that hold, and a return on capital (ROE, ROCE) well above the cost of money; check that profit turns into operating cash flow.",
      "Balance sheet: low or falling debt, comfortable interest cover, no rising receivables or inventory that outrun sales.",
      "Governance: stable or rising promoter holding, little or no pledging of promoter shares, clean auditors and related-party dealings; pledged shares are a risk because a fall can force sales.",
      "Valuation: compare price-to-earnings, price-to-book or EV/EBITDA with the company's own history, its peers and its growth (PEG); a cheap stock can be cheap for a reason.",
      "For a trader the point is exclusion: avoid names with a governance red flag, a debt problem or a pending event that can gap the price whatever the chart says.",
    ],
  },

  /* ------------------------------------------------------------------------ global links and India's lists */
  {
    id: "mac-global",
    area: "Global links and India's lists",
    title: "How the world reaches the NSE's open",
    keys: "global us markets nasdaq dow futures gift nifty sgx crude oil dollar index dxy us yields fii dii rupee china geopolitical overnight",
    rules: [
      "The US close and its futures, the GIFT Nifty, Asian markets and crude set the tone of the open; a large overnight move in the US or in oil usually shows up as a gap.",
      "A rising US dollar index and rising US bond yields tend to pull money out of emerging markets, and a falling rupee often goes with foreign selling; the reverse supports Indian equities.",
      "Crude oil matters to India as an importer: a sharp rise is a cost for the economy, the rupee and oil-marketing and consuming sectors, and a help for upstream producers.",
      "FII and DII flows (provisional figures after each close) show who has been buying; persistent foreign selling meets domestic buying in many phases and the net decides the trend.",
      "Geopolitical shocks produce gaps and volatility spikes that fade faster than they feel; position size and no-overnight rules matter more than the forecast.",
    ],
  },
  {
    id: "in-lists",
    area: "Global links and India's lists",
    title: "India's lists and surveillance: ASM, GSM, T2T, circuits, SEBI notices",
    keys: "asm gsm surveillance trade for trade t2t price band circuit filter pledge unsolicited sebi action halt suspension",
    rules: [
      "Exchanges put stocks under additional or graded surveillance (ASM, GSM) when price and volume look unusual: margins rise and trading may be restricted, and such stocks are poor candidates for leverage.",
      "Trade-for-trade (T2T) stocks cannot be squared off intraday — every buy is a delivery — so an intraday plan in one cannot work.",
      "A derivative contract enters the ban period when open interest crosses a high share of the market-wide position limit: no fresh positions, only reductions, until it falls back.",
      "Each stock has a price band (daily circuit limit, 2%, 5%, 10% or 20%); a stock at its circuit may have no sellers or buyers and cannot be exited at will — know the band before entering and size for being stuck.",
      "Exchange notices and SEBI orders (suspensions, investigations, promoter pledges, name changes) are published: read them for any stock you hold, because they change liquidity overnight.",
      "These lists and limits are revised often: the exchange's current circulars are the authority.",
    ],
  },

  /* ------------------------------------------------------------------------------------------- other schools */
  {
    id: "sch-other",
    area: "Other schools of analysis",
    title: "Elliott, Gann, harmonic patterns, market profile and the like",
    keys: "elliott wave gann harmonic pattern gartley butterfly market profile astro financial astrology fibonacci cycles subjective evidence",
    rules: [
      "Elliott wave counts, Gann angles and squares, and harmonic patterns (Gartley, butterfly, bat) are rule-rich schemes that fit past charts easily; their counts are subjective and rarely tested out of sample, so two analysts often draw different ones.",
      "Market profile and volume profile (value area, point of control) are descriptive of where trade has been accepted and are useful as levels; they are measurements, not predictions.",
      "Fibonacci retracements work as levels mostly because many traders watch them (a self-fulfilling crowd), not because the ratios are special.",
      "Astrological and numerological methods have no supporting evidence; where they seem to work it is chance or the crowd that believes them.",
      "If you use any of these, use them as a way to define levels and risk, and measure whether it adds anything to a simpler method on your own record.",
    ],
  },
];
