// Chapters only the AI Engine has: the owner's AI brains, how they reach each feature, and a
// feature-by-feature table of triggers, data and limits. The AI chapters of the Document (ai.js)
// come before these on the AI Engine page.

export const ENGINE = [
  {
    id: "engine-brains",
    part: "brains",
    title: "AI brains — the owner’s standing instructions",
    intro: "A brain is an instruction the owner writes once; from the next request on, every AI feature it belongs to follows it. The default AI model helps write it and decides where it belongs.",
    blocks: [
      { logic: {
        title: "One engine for every feature",
        who: "The server (server/ai/engine.js): every AI feature gets its model client here.",
        when: "On every AI request, from every feature, at the same time.",
        steps: [
          "**One door, one default model.** The strategist, Score & learn, the co-pilot, AI decision, research notes, the AI Live / AI Research analyst and its web research, the position coach, the journal and day reviews, the debrief, the brains’ refining, TradeAI, the Social Media digest and the WhatsApp updates all reach the **default model** (Claude Sonnet 5.5 unless another is picked on the AI page) through it — and, with the AI page’s fallback on, the other companies whose keys are saved when it fails.",
          "**One set of brains and rules.** On the way out each request gets the owner’s brains for the feature its instructions belong to, read at that moment — so one edit reaches every feature at once. The trading-skills file is the shared core brain (TradeAI now reads its first part too).",
          "**No credit spent twice.** The very same request — same model, same instructions with their brains, same data, same schema — within 15 minutes gets the answer already paid for, and two identical requests at the same moment share one call. The Live engine tab shows “Reused today: N calls · tokens not spent”. A reused answer does not count against the daily AI-run limits. Buttons that ask for a new answer (Retry in TradeAI, Refresh of the world brief or the news check, a new debrief, Rewrite with AI) always ask again.",
          "**Shared lanes.** Requests that use the same key share a fair number of calls in flight: 6 for Anthropic, 6 for any other key. When TradeAI, AI Live, Social Media, WhatsApp and the co-pilot ask at the same moment, the extra requests wait their turn for a moment instead of tripping the provider’s rate limit.",
          "**A live board** — the **Live engine** tab of this page (every admin): what is asking the models right now and what is waiting, how full each lane is, and today’s calls, failures, average time, tokens and models per feature, with the last 20 calls.",
        ],
        limits: "The board’s counts are kept for the current day (Indian time) and survive a restart. The web searches (world brief, news check) are counted but take no brains.",
      } },
      { p: "Brains live on the **AI Engine** page, under **Brains**. Only the **superadmin** can see, add, edit, switch off, reorder or delete them; other admins see this explanation but not the brains themselves. The trading-skills file stays what it was — the core brain the strategist, research notes, decision desk, coach and journal review already read — and the superadmin can edit it on the same page." },
      { h: "What a brain is" },
      { dl: [
        ["Title", "A short name, up to 100 characters."],
        ["Instruction", "The text the AI follows, up to 4,000 characters. Plain, specific and about process: time of day, trend agreement, distance from VWAP, volume, risk, stops, when to stand aside."],
        ["Where it applies (scopes)", "“All features”, or any of: AI strategist, Score & learn, Live co-pilot, AI decision, Research notes and summary, AI Live analysts, AI Research analysts, Position coach, Journal review, Trade Analysis day review, Day debrief, TradeAI chat, WhatsApp updates, Social & news digest."],
        ["On / off", "A brain that is switched off is kept but sent nowhere."],
        ["Order", "Brains are sent in the order shown; up to 9,000 characters of brains go with one request (the first ones win the space)."],
        ["History", "The last 10 wordings are kept, and any of them can be put back."],
      ] },
      { logic: {
        title: "How a brain reaches the AI — automatically",
        who: "The server, on every AI request.",
        when: "From the very next request after a save. Nothing has to be restarted.",
        steps: [
          "Every AI feature registers the instructions (system prompt) it sends. When a request is made, the server recognises which feature it belongs to.",
          "It collects the brains that are switched on and whose scopes include that feature (or “All features”), in their order.",
          "It appends them to that request’s instructions under the heading **THE OWNER’S AI BRAINS**, with a fixed reminder: brains never change the answer format, never permit promising a profit, a win rate or a probability, and never remove a stop-loss or the desk’s checks.",
          "This works for every company and model — the default model and any fallback, in every feature including the AI Live / AI Research analyst.",
        ],
        limits: "The answer format, the ten arithmetic plan checks, the scoring and the fact that the AI can never place an order are all in code — no brain can change them. The world brief and the company news check (web searches) do not take brains.",
      } },
      { logic: {
        title: "The default model writes and places the brain",
        who: "The superadmin presses **Save** with “Let the AI refine it and decide where it belongs” ticked (the default). The default AI model does the writing.",
        when: "On that save. It usually takes well under a minute (up to about two).",
        steps: [
          "**The default model writes the final version.** It sees the owner’s draft, the existing brains and the first part of the trading-skills file, keeps the owner’s intent, makes it clear and testable, chooses the scopes, and lists conflicts.",
          "**If it fails**, the AI page’s fallback models (the other companies with a saved key) are tried one at a time; the one that answers writes the brain.",
          "**Each refine counts as one of today’s AI runs** — the same daily cap as AI Live / AI Research. At the cap the refine is refused with the reason; save the brain as written instead.",
          "The final brain is saved and goes live at once. **The owner’s own wording is kept** beside it, with the model that wrote it and any conflicts it found. **Use my wording** puts the owner’s text back with one click.",
          "“Keep my scopes” keeps the features the owner ticked instead of the model’s choice.",
        ],
        limits: "Each model has the AI Live wait limit (default 90 seconds, at least 90 used). If every model fails, nothing is saved and the reason is shown — save it as written instead. With no AI key at all, brains are saved exactly as written.",
      } },
      { h: "Good brains, bad brains" },
      { table: { label: "Examples", head: ["Good (process the AI can apply)", "Not useful (or refused)"], rows: [
        ["Between 11:30 AM and 1:30 PM prefer “no trade” unless the tape score is 45 or more.", "Buy SBIN tomorrow."],
        ["Never suggest an entry more than 0.8 ATR from its invalidation level.", "Promise at least 80% winning trades."],
        ["When the daily trend and the 5-minute trend disagree, say so and halve the suggested size.", "Remove the stop-loss when the trend is strong."],
        ["Mention the India VIX when it is above 18 and widen nothing; prefer smaller size.", "Place the order automatically."],
      ] } },
      { note: "Brains change what the AI writes. They never change the rule engines (the live call, the setups, the odds), which are arithmetic and work without any AI." },
    ],
  },
  {
    id: "engine-features",
    part: "brains",
    title: "Feature by feature — trigger, data, rules and limits",
    intro: "Every AI feature in one table, then the facts that apply to all of them.",
    blocks: [
      { table: { label: "AI features", head: ["Feature", "Started by", "Reads", "Never sent", "Checks and limits"], rows: [
        ["AI strategist", "Build strategy (the same click within 60 s costs nothing)", "One stock’s full brief, the engines’ readings, backtests, its earlier scored plans, the skills file, brains", "Name, email, account, positions, funds, orders", "Ten arithmetic plan checks; scored on real prices (first target, stop counts first); 30 per hour"],
        ["Score & learn", "Score outcomes & learn", "Lessons so far, the record, up to 40 newly finished outcomes, brains", "Account data", "Needs 3 newly finished plans; at most 5 lessons; 12 per hour"],
        ["Live co-pilot", "Ask now, or Go live on a call change, urgent level break, early warning or quiet timer", "The live snapshot, 1-minute tape, order book, market, fresh world/news one-liners, its own last reading, brains", "Positions, funds, orders, the skills file", "Gap 120 s (30–900), 80 a day (1–500); scored 10 minutes later (0.05% flat band)"],
        ["AI decision", "Get AI decision", "Today’s brief, the stock’s one-year habits, measured odds and forward test, the skills file, brains", "Account data", "Grade C or no grade can never be the reason for a trade; plan checks; not scored; 40 per hour"],
        ["Research notes", "Research N stocks; automatic research when AI notes are on", "The data sheet, the desk’s direction, the skills file, brains", "Account data", "Up to 12 stocks; one summary when 2+ notes; 12 per hour"],
        ["AI Live / AI Research analyst", "The AI Live and AI Research buttons; the Market board’s “AI, one by one”", "The stock’s brief, your position in that stock and your cash (read-only), brains", "Name, email, the skills file, other holdings", "The default model, fallbacks in turn; weights, thresholds, gates, median plans and plan checks; scored later; AI runs capped per day (default 40)"],
        ["Position coach", "Ask the coach (owner only)", "Up to 10 positions, 10 holdings, cash and margin, 20 open orders, the engines’ levels, the skills file, brains", "Name, email", "A stop on the wrong side is removed; advice only; 30 per hour"],
        ["Journal review", "Review this range (owner only)", "Journal statistics and up to 150 round trips, the skills file, brains", "Name, email", "Needs 5 closed trades; at most 4 rules; 20 per hour"],
        ["Trade Analysis day review", "The 3:45 PM report when AI analysis is on, or Write the AI analysis", "One day’s report and trades, the first 6,000 characters of the skills file, brains", "Name, email, account number", "Quotes only given figures; at most 4 rules; 20 per hour"],
        ["Day debrief", "Write the debrief", "The replay’s facts, the co-pilot’s readings, the strategist’s plans, brains", "Your real trades, positions, funds", "At most 3 lessons, each backed by two calls; 12 per hour"],
        ["TradeAI chat", "A question on the TradeAI page, or ASK on WhatsApp", "The data the plan gathers: positions and funds (owner), P&L history, stock snapshots, market, outlook, news when asked, brains", "Name, email", "Routed: data questions answered instantly with no model; light ones briefly, advice with the full data, Deep with longer thinking — all by the default model, fallbacks one at a time; model answers capped per day (default 150); the desk's arithmetic if no model answers; 30 questions per 10 minutes"],
        ["WhatsApp updates", "The timed updates while WhatsApp Trading is on", "Open positions' figures, live calls, levels, the market, brains", "Name, email, orders", "The default model's action and note per position (fallbacks in turn); the desk's figures if no model answers"],
        ["Social Media digest", "New posts and headlines from the Social Media sources (every few minutes), or Digest now", "Public headlines and posts (title, a short excerpt, source and time), the desk’s tally of mentions, brains", "Everything personal", "Only items the rules found market-related; batches of 8 items, at most the batches an hour set (default 10); the rules’ own reading if no model answers"],
        ["World brief / News check", "Their buttons; Research options; the web research of AI Live / AI Research", "Search results only (the news check sends the symbol, the company name and today’s move)", "Everything personal", "Reused for 30 minutes; shown to other features only while fresh (10 h / 6 h and today); no brains"],
      ] } },
      { h: "Rules that hold for every feature" },
      { ul: [
        "**It starts only from a button** you press (or the co-pilot’s event rules, the 3:45 PM day review when switched on, the automatic research when its AI notes are on, WhatsApp Trading’s timed updates when it is on, and the Social Media digest when its AI is on — those timers live outside the AI folder). No timer exists in the AI folder; a test enforces it.",
        "**It cannot trade.** No AI file can load the broker; a test enforces it. A WhatsApp order is your own command, confirmed with a code and your PIN — never the AI’s.",
        "**One answer shape for every company**: Anthropic holds its answer to the schema itself; every other company’s answer is checked and, once, sent back to be repaired (the AI Live / AI Research analyst gets no repair; a failed answer goes to the next fallback).",
        "**Confidence is never a probability.** No prompt allows a promise of profit or a win rate.",
        "**Tokens are shown, rupees are not**; every AI company bills on its own console (Claude Sonnet 5.5: $2 / $10 per million input / output tokens). Set a spend limit there; the daily caps here keep each feature in bounds.",
        "**One default model, picked on the AI page.** With fallback on, a failed request goes to the next company whose key you saved — never to one you did not.",
        "**Keys are encrypted** (AES-256-GCM) and never sent to a browser.",
      ] },
    ],
  },
];
