import React from "react";
import { useSearchParams } from "react-router-dom";
import Shell from "../Shell";
import WorldClock from "./WorldClock";
import HolidayCalendar from "./HolidayCalendar";
import Analyzer from "./analyzer/Analyzer";
import Screener from "./analyzer/Screener";
import Debrief from "./analyzer/Debrief";
import Account from "./trade/Account";
import Research from "./trade/Research";
import { TradeProvider } from "./trade/TradeContext";
import { useAuth } from "../auth";

const VIEWS = [
  { id: "analyzer", label: "Trading desk" },
  { id: "account", label: "Positions & orders", superOnly: true },
  { id: "research", label: "Research" },
  { id: "screener", label: "Screener" },
  { id: "debrief", label: "Day debrief" },
  { id: "calendar", label: "World clock & holidays" },
];

/**
 * Opens in its own tab from the dashboard. The route sits behind the same sign-in
 * as the rest of the private area (the session cookie is shared between tabs), so
 * an admin who is signed in lands here already signed in.
 */
export default function StockReport() {
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const isSuper = Boolean(user && user.role === "superadmin");
  const views = VIEWS.filter((v) => !v.superOnly || isSuper);
  const asked = params.get("view");
  const view = views.some((v) => v.id === asked) ? asked : "analyzer";
  // a stock picked in the screener or the debrief opens on the trading desk
  const openStock = (symbol) => {
    const next = new URLSearchParams(params);
    next.delete("view");
    next.set("s", symbol);
    setParams(next);
  };
  const go = (id) => {
    const next = new URLSearchParams(params);
    if (id === "analyzer") next.delete("view");
    else next.set("view", id);
    setParams(next, { replace: true });
  };

  return (
    <TradeProvider>
    <Shell crumb="Stock Report" wide={view === "calendar"} fluid={view !== "calendar"}>
      <div className="sr-head">
        <h1 className="adm-h1">Stock Report</h1>
        <div className="sr-views" role="tablist" aria-label="Stock Report sections">
          {views.map((v) => (
            <button key={v.id} type="button" role="tab" aria-selected={view === v.id} onClick={() => go(v.id)}>
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {view === "analyzer" ? (
        <Analyzer />
      ) : view === "account" ? (
        <Account />
      ) : view === "research" ? (
        <Research onOpen={openStock} />
      ) : view === "screener" ? (
        <Screener onOpen={openStock} />
      ) : view === "debrief" ? (
        <Debrief onOpen={openStock} />
      ) : (
        <>
          <WorldClock />
          <div className="sr-two">
            <HolidayCalendar market="india" />
            <HolidayCalendar market="nasdaq" />
          </div>
        </>
      )}
    </Shell>
    </TradeProvider>
  );
}
