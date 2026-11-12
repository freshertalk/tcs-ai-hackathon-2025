import React from "react";
import { useSearchParams } from "react-router-dom";
import Shell from "../Shell";
import WorldClock from "./WorldClock";
import HolidayCalendar from "./HolidayCalendar";
import Analyzer from "./analyzer/Analyzer";
import Screener from "./analyzer/Screener";

const VIEWS = [
  { id: "analyzer", label: "Trading desk" },
  { id: "screener", label: "Screener" },
  { id: "calendar", label: "World clock & holidays" },
];

/**
 * Opens in its own tab from the dashboard. The route sits behind the same sign-in
 * as the rest of the private area (the session cookie is shared between tabs), so
 * an admin who is signed in lands here already signed in.
 */
export default function StockReport() {
  const [params, setParams] = useSearchParams();
  const asked = params.get("view");
  const view = asked === "calendar" || asked === "screener" ? asked : "analyzer";
  // a stock picked in the screener opens on the trading desk
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
    <Shell crumb="Stock Report" wide={view === "calendar"} fluid={view !== "calendar"}>
      <div className="sr-head">
        <h1 className="adm-h1">Stock Report</h1>
        <div className="sr-views" role="tablist" aria-label="Stock Report sections">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" role="tab" aria-selected={view === v.id} onClick={() => go(v.id)}>
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {view === "analyzer" ? (
        <Analyzer />
      ) : view === "screener" ? (
        <Screener onOpen={openStock} />
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
  );
}
