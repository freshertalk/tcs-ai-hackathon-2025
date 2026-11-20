// The terminal's workspaces, by the id the terminal knows them by — for the pages outside the terminal that list them
// (/me and its Customize card). The terminal itself keeps the full descriptions (stock/StockReport.jsx).
//   superOnly  the owner's alone
//   traderOk   …except for a person who has their own Zerodha account here: they get this one too (it shows THEIR account)

export const WORKSPACE_LIST = [
  { id: "analyzer", label: "Desk" },
  { id: "research", label: "Research" },
  { id: "advisor", label: "Advisor" },
  { id: "screener", label: "Screener" },
  { id: "account", label: "Positions", superOnly: true, traderOk: true },
  { id: "indices", label: "Indices" },
  { id: "analysis", label: "Trade Analysis", superOnly: true },
  { id: "calendar", label: "Calendar" },
  { id: "journal", label: "Journal", superOnly: true },
  { id: "paper", label: "Paper" },
  { id: "debrief", label: "Debrief" },
  { id: "engine", label: "AI Engine" },
  { id: "document", label: "Document" },
];

/** May this person open this workspace? (What they have HIDDEN is their preference; this is their right.) */
export const mayOpen = (w, user) => !w.superOnly || Boolean(user && (user.role === "superadmin" || (w.traderOk && user.trader)));

/** The workspaces a person may open. */
export const workspacesFor = (user) => WORKSPACE_LIST.filter((w) => mayOpen(w, user));
