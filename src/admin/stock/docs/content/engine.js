// Chapters only the AI Engine has: the owner's AI brains, how they reach each feature, and a
// feature-by-feature table of triggers, data and limits. The AI chapters of the Document (ai.js)
// come before these on the AI Engine page.

export const ENGINE = [
  {
    id: "engine-brains",
    part: "brains",
    title: "AI brains — the owner’s standing instructions",
    intro: "A brain is an instruction the owner writes once; from the next request on, every AI feature it belongs to follows it. The AI team helps write it and decides where it belongs.",
    blocks: [
      { p: "Brains live on the **AI Engine** page, under **Brains**. Only the **superadmin** can see, add, edit, switch off, reorder or delete them; other admins see this explanation but not the brains themselves. The trading-skills file stays what it was — the core brain the strategist, research notes, decision desk, coach and journal review already read — and the superadmin can edit it on the same page." },
      { h: "What a brain is" },
      { dl: [
        ["Title", "A short name, up to 100 characters."],
        ["Instruction", "The text the AI follows, up to 4,000 characters. Plain, specific and about process: time of day, trend agreement, distance from VWAP, volume, risk, stops, when to stand aside."],
        ["Where it applies (scopes)", "“All features”, or any of: AI strategist, Score & learn, Live co-pilot, AI decision, Research notes and summary, AI Live analysts, AI Research analysts, Position coach, Journal review, Trade Analysis day review, Day debrief."],
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
          "This works for every company and model — the paid ones, the free NVIDIA-hosted ones, and each analyst of AI Live / AI Research.",
        ],
        limits: "The answer format, the ten arithmetic plan checks, the scoring and the fact that the AI can never place an order are all in code — no brain can change them. The world brief and the company news check (web searches) do not take brains.",
      } },
      { logic: {
        title: "The AI team writes and places the brain",
        who: "The superadmin presses **Save** with “Let the AI team refine it and decide where it belongs” ticked (the default). The free NVIDIA-hosted models — and the paid model when it is switched on — do the writing.",
        when: "On that save. It takes up to about two minutes.",
        steps: [
          "**Every free model writes its own version in parallel** (Nemotron 3 Super, Nemotron 3 Ultra, Nemotron Nano 9B v2, Nemotron 3.5 Super VL, Mistral Large 4, DeepSeek V4.1 Flash, Gemma 4 31B IT — those switched on in the AI Live / AI Research settings). Each sees the owner’s draft, the existing brains and the first part of the trading-skills file, keeps the owner’s intent, makes it clear and testable, chooses the scopes, and lists conflicts.",
          "**The paid lead joins** when “The paid model with web search” is on in the AI settings and a paid key is saved — the same model and the same daily cap of paid runs as AI Live / AI Research.",
          "**One model merges the versions** into the final wording and the final scopes: the paid lead when it answered, otherwise the strongest free model that answered (Nemotron 3 Ultra first, then Mistral Large 4, Nemotron 3 Super, …). If the merge fails, the strongest single version is used.",
          "The final brain is saved and goes live at once. **The owner’s own wording is kept** beside it, with the list of models that wrote, who merged and any conflicts they found. **Use my wording** puts the owner’s text back with one click.",
          "“Keep my scopes” keeps the features the owner ticked instead of the team’s choice.",
        ],
        limits: "Each model has the AI Live wait limit (default 75 seconds; the paid lead at least 120). If every model fails, nothing is saved and the reason is shown — save it as written instead. With no AI key at all, brains are saved exactly as written.",
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
        ["AI strategist", "Build strategy (same click within 60 s is free)", "One stock’s full brief, the engines’ readings, backtests, its earlier scored plans, the skills file, brains", "Name, email, account, positions, funds, orders", "Ten arithmetic plan checks; scored on real prices (first target, stop counts first); 30 per hour"],
        ["Score & learn", "Score outcomes & learn", "Lessons so far, the record, up to 40 newly finished outcomes, brains", "Account data", "Needs 3 newly finished plans; at most 5 lessons; 12 per hour"],
        ["Live co-pilot", "Ask now, or Go live on a call change, urgent level break, early warning or quiet timer", "The live snapshot, 1-minute tape, order book, market, fresh world/news one-liners, its own last reading, brains", "Positions, funds, orders, the skills file", "Gap 120 s (30–900), 80 a day (1–500); scored 10 minutes later (0.05% flat band)"],
        ["AI decision", "Get AI decision", "Today’s brief, the stock’s one-year habits, measured odds and forward test, the skills file, brains", "Account data", "Grade C or no grade can never be the reason for a trade; plan checks; not scored; 40 per hour"],
        ["Research notes", "Research N stocks; automatic research when AI notes are on", "The data sheet, the desk’s direction, the skills file, brains", "Account data", "Up to 12 stocks; one summary when 2+ notes; 12 per hour"],
        ["AI Live / AI Research analysts", "The AI Live and AI Research buttons; the Screener’s free-only batch", "The same brief for every analyst, your position in that stock and your cash (read-only), brains", "Name, email, the skills file, other holdings", "Weights, thresholds, gates, median plans and plan checks; scored later; paid runs capped per day"],
        ["Position coach", "Ask the coach (owner only)", "Up to 10 positions, 10 holdings, cash and margin, 20 open orders, the engines’ levels, the skills file, brains", "Name, email", "A stop on the wrong side is removed; advice only; 30 per hour"],
        ["Journal review", "Review this range (owner only)", "Journal statistics and up to 150 round trips, the skills file, brains", "Name, email", "Needs 5 closed trades; at most 4 rules; 20 per hour"],
        ["Trade Analysis day review", "The 3:45 PM report when AI analysis is on, or Write the AI analysis", "One day’s report and trades, the first 6,000 characters of the skills file, brains", "Name, email, account number", "Quotes only given figures; at most 4 rules; 20 per hour"],
        ["Day debrief", "Write the debrief", "The replay’s facts, the co-pilot’s readings, the strategist’s plans, brains", "Your real trades, positions, funds", "At most 3 lessons, each backed by two calls; 12 per hour"],
        ["World brief / News check", "Their buttons; Research options; the paid lead of AI Live / AI Research", "Search results only (the news check sends the symbol, the company name and today’s move)", "Everything personal", "Reused for 30 minutes; shown to other features only while fresh (10 h / 6 h and today); no brains"],
      ] } },
      { h: "Rules that hold for every feature" },
      { ul: [
        "**It starts only from a button** you press (or the co-pilot’s event rules, the 3:45 PM day review when switched on, and the automatic research when its AI notes are on). No timer exists in the AI folder; a test enforces it.",
        "**It cannot trade.** No AI file can load the broker; a test enforces it.",
        "**One answer shape for every company**: Anthropic holds its answer to the schema itself; every other company’s answer is checked and, once, sent back to be repaired (analysts get no repair).",
        "**Confidence is never a probability.** No prompt allows a promise of profit or a win rate.",
        "**Tokens are shown, rupees are not**; paid companies bill on their own consoles. The free NVIDIA models are a rate-limited trial; the app never switches to a paid company by itself.",
        "**Keys are encrypted** (AES-256-GCM) and never sent to a browser.",
      ] },
    ],
  },
];
