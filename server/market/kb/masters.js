"use strict";
// The knowledge base, part 4: the documented methods of well-known traders and investors — what each is
// on record as doing, from their own books and widely published interviews. Each entry describes a
// published method; none speaks for the person, and none promises their results. Data only.

module.exports = [
  {
    id: "m-livermore",
    area: "Masters' methods",
    title: "Jesse Livermore (Reminiscences of a Stock Operator; How to Trade in Stocks)",
    keys: "livermore line of least resistance pivotal points pyramiding sit tight big swing probe",
    rules: [
      "Trade in the direction of the 'line of least resistance' — wait until the market shows its direction rather than predicting turns.",
      "Pivotal points: act when the price breaks a key level with conviction, not before.",
      "Probe with a small position first and add only as the market proves you right; never average down a loss.",
      "The big money is made by sitting tight through the big swing, not by trading every wiggle.",
      "His own career, with fortunes made and lost, is also the classic warning about leverage and overtrading.",
    ],
  },
  {
    id: "m-wyckoff",
    area: "Masters' methods",
    title: "Richard Wyckoff (the Wyckoff method)",
    keys: "wyckoff accumulation distribution spring upthrust composite man phases cause effect effort result supply demand",
    rules: [
      "Three laws: supply and demand moves price; cause (the size of an accumulation or distribution range) and effect (the size of the move after it); effort (volume) versus result (price progress).",
      "Large operators ('the composite man') accumulate in ranges after declines and distribute in ranges after advances; the phases run from the selling climax through tests to the markup.",
      "A spring (a dip below the range's support that is quickly bought back) ends accumulation; an upthrust above resistance that fails ends distribution.",
      "Read volume at the edges of ranges: heavy volume with no progress is absorption.",
    ],
  },
  {
    id: "m-dow",
    area: "Masters' methods",
    title: "Charles Dow (Dow theory)",
    keys: "dow theory primary secondary minor trend confirmation averages volume",
    rules: [
      "The market has a primary trend (months to years), secondary reactions (weeks to months) and minor moves (days).",
      "A trend is in place until it gives a definite signal of reversal; the averages (indices) should confirm each other, and volume should expand with the trend.",
      "It is the root of modern trend analysis: higher highs and higher lows, lower highs and lower lows.",
    ],
  },
  {
    id: "m-oneil",
    area: "Masters' methods",
    title: "William O'Neil (How to Make Money in Stocks; CAN SLIM)",
    keys: "oneil o'neil can slim cup with handle pivot leader institutional sponsorship cut losses 7 8 percent",
    rules: [
      "CAN SLIM: Current quarterly earnings growth, Annual earnings growth, a New product or management or high, Supply and demand (volume on breakouts), Leader not laggard, Institutional sponsorship, Market direction.",
      "Buy leaders as they break out of sound bases (cup with handle, flat base) near the pivot, on volume well above average.",
      "Cut every loss at 7–8% below the purchase price, without exception.",
      "Three of four stocks follow the market's direction: buy only in a confirmed uptrend.",
    ],
  },
  {
    id: "m-minervini",
    area: "Masters' methods",
    title: "Mark Minervini (SEPA, the volatility contraction pattern)",
    keys: "minervini sepa vcp volatility contraction trend template stage 2 relative strength",
    rules: [
      "Trend template: price above the 150 and 200-day averages, the 200-day rising, the 50-day above both, price well above its 52-week low and within about 25% of its 52-week high, strong relative strength — a 'stage 2' uptrend.",
      "Volatility contraction pattern (VCP): successively smaller pullbacks with volume drying up, then a breakout on volume from the tightest point.",
      "Risk is kept small and losses are cut quickly; he stresses that the average loss must be much smaller than the average gain.",
    ],
  },
  {
    id: "m-darvas",
    area: "Masters' methods",
    title: "Nicolas Darvas (How I Made $2,000,000 in the Stock Market)",
    keys: "darvas box breakout techno fundamental buy stop",
    rules: [
      "Stocks rise in a series of 'boxes' (ranges); buy when the price breaks above the top of the box on high volume, with a stop just under the box.",
      "Raise the stop as each new box forms; sell when a box breaks down.",
      "He combined the chart with rising earnings ('techno-fundamental').",
    ],
  },
  {
    id: "m-turtles",
    area: "Masters' methods",
    title: "The Turtle traders (Richard Dennis and William Eckhardt)",
    keys: "turtle traders dennis eckhardt donchian 20 55 breakout n atr unit pyramiding 2n stop curtis faith",
    rules: [
      "Rules later published (Curtis Faith, Way of the Turtle): enter on a 20-day breakout (System 1) or a 55-day breakout (System 2).",
      "N = the 20-day ATR. A unit is sized so a 1-N move equals 1% of equity; stops at 2 N; add a unit every ½ N in favour, up to four.",
      "Exit on the opposite 10-day breakout (System 1) or 20-day breakout (System 2).",
      "The lesson: a simple trend-following method with strict sizing and stops can be taught — the hard part is following it through long losing streaks.",
    ],
  },
  {
    id: "m-wizards",
    area: "Masters' methods",
    title: "What the Market Wizards share (Jack Schwager's interviews)",
    keys: "market wizards schwager seykota paul tudor jones druckenmiller common traits",
    rules: [
      "Across very different methods, the traders Jack Schwager interviewed share risk control, discipline, patience, and a method that fits their own personality.",
      "Ed Seykota, a pioneer of systematic trend following: cut losses, ride winners, keep bets small, follow the rules.",
      "Paul Tudor Jones: defence first; a long-term moving average (the 200-day) as a filter for whether to own something; look for trades where the possible gain is several times the risk.",
      "Stanley Druckenmiller: size up only when the evidence and conviction are strongest; what matters is how much you make when right versus lose when wrong.",
    ],
  },
  {
    id: "m-shortterm",
    area: "Masters' methods",
    title: "Short-term trading authors (Raschke, Crabel, Williams, Connors, Brooks)",
    keys: "raschke holy grail turtle soup 80 20 crabel opening range nr7 larry williams volatility breakout oops connors rsi2 al brooks price action",
    rules: [
      "Linda Bradford Raschke (Street Smarts, with Laurence Connors): the Holy Grail (first pullback to the 20 EMA when ADX is above 30), Turtle Soup (fading a false break of a 20-day high or low), 80-20s (reversal after a close at the extreme of the range).",
      "Toby Crabel: opening-range breakouts, and range contraction (NR4, NR7, inside days) followed by expansion.",
      "Larry Williams: volatility breakouts (entering when the price moves a fraction of yesterday's range from the open), Williams %R, and the 'Oops' pattern (a gap beyond yesterday's range that reverses back inside).",
      "Larry Connors: short-term mean reversion in long-term uptrends (buy a 2-period RSI dip in a stock above its 200-day average, exit on strength).",
      "Al Brooks (Reading Price Charts Bar by Bar): read every bar as trend or range; most breakout attempts from trading ranges fail; enter on second attempts (two-legged pullbacks).",
    ],
  },
  {
    id: "m-elder-tharp",
    area: "Masters' methods",
    title: "Alexander Elder and Van K. Tharp (risk and process)",
    keys: "elder triple screen 2 percent rule 6 percent rule force index tharp r multiple expectancy sqn position sizing",
    rules: [
      "Alexander Elder (Trading for a Living): the triple screen; never risk more than 2% of equity on a trade; stop trading for the month after losing 6% of equity; the 'three Ms' — mind, method, money.",
      "Van K. Tharp: think in R-multiples (results as multiples of the initial risk), know your system's expectancy, and let position sizing meet your objectives; the trader, not the system, is usually the weak link.",
    ],
  },
  {
    id: "m-indicators",
    area: "Masters' methods",
    title: "The inventors of the indicators",
    keys: "wilder appel lane granville bollinger chaikin lambert hosoda steidlmayer nison inventor",
    rules: [
      "J. Welles Wilder Jr. (New Concepts in Technical Trading Systems, 1978): RSI, ATR, ADX/DMI and Parabolic SAR.",
      "Gerald Appel: MACD. George Lane: the stochastic. Joseph Granville: On-Balance Volume. John Bollinger: Bollinger Bands. Marc Chaikin: the A/D line and Chaikin Money Flow. Donald Lambert: CCI. Goichi Hosoda: Ichimoku. Peter Steidlmayer: Market Profile. Steve Nison: candlesticks in the West.",
      "Each inventor stressed context: their indicators summarise price and volume, they do not replace them.",
    ],
  },
  {
    id: "m-value",
    area: "Masters' methods",
    title: "The great investors (Graham, Buffett and Munger, Lynch, Fisher)",
    keys: "graham buffett munger lynch fisher margin of safety mr market moat circle of competence peg value investing",
    rules: [
      "Benjamin Graham (The Intelligent Investor): buy with a margin of safety below intrinsic value; treat the market as 'Mr. Market', whose daily moods offer prices, not verdicts.",
      "Warren Buffett and Charlie Munger: stay within your circle of competence, buy wonderful businesses with durable advantages ('moats') at fair prices and hold them for years; Buffett's often-quoted first rule is never to lose money.",
      "Peter Lynch (One Up on Wall Street): invest in what you understand; sort companies into slow growers, stalwarts, fast growers, cyclicals, turnarounds and asset plays; the PEG ratio (P/E ÷ growth).",
      "Philip Fisher: research the business deeply ('scuttlebutt') and hold outstanding growth companies for the long term.",
      "These are investing methods, not intraday techniques. What carries over to a trader: protect capital, avoid leverage you cannot survive, be patient for good opportunities.",
    ],
  },
  {
    id: "m-india",
    area: "Masters' methods",
    title: "Indian investors and educators (Jhunjhunwala, Kedia, Agrawal, the Kamaths)",
    keys: "rakesh jhunjhunwala vijay kedia smile raamdeo agrawal qglp nithin kamath nikhil kamath zerodha varsity india investor",
    rules: [
      "Rakesh Jhunjhunwala was both an active trader and a long-term investor, and spoke of keeping the two apart; his best-known wealth came from holding a few high-conviction companies (Titan is the most cited) for decades, from long-term optimism about India's growth, and from buying when others were fearful.",
      "Vijay Kedia's SMILE framework for picking companies: Small in size, Medium in experience, Large in aspiration, Extra-large in market potential — held patiently for years.",
      "Raamdeo Agrawal (Motilal Oswal) and QGLP: Quality, Growth, Longevity, Price.",
      "Nithin and Nikhil Kamath (Zerodha): Zerodha Varsity teaches markets, technical and fundamental analysis, derivatives and risk for free; they have often pointed publicly to the regulator's data that most active traders lose money, and warn against overtrading and excessive leverage.",
      "All of them are, first, long-term investors or educators: their lessons for intraday trading are about discipline, risk and patience, not about specific intraday set-ups.",
    ],
  },
];
