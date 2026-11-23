// The Calendar workspace in the Journal's anatomy (23 Nov 2026): the head card, the sticky bar (the next trading day,
// the next holiday, NSE's time, whether the holiday list is NSE's own) and the parts in tabs — with "Everything" first,
// as the page was one long sheet before. The parts are the same components as before, kept mounted behind their tabs.

import React from "react";
import WorldClock from "./WorldClock";
import TimeConverter from "./TimeConverter";
import ExpiryCalendar from "./ExpiryCalendar";
import HolidayCalendar from "./HolidayCalendar";
import { useNextSession } from "../NextSession";
import { useExchangeNow } from "../clock/exchangeClock";
import { PageBar, PageHead, PagePart, usePageTab } from "../ux/PageKit";

const PARTS = [
  { id: "all", label: "Everything", tip: "The clocks, the expiries and the holidays on one page." },
  { id: "clocks", label: "Clocks & converter", tip: "Six live clocks on exchange time and a time-zone converter." },
  { id: "expiry", label: "Expiries", tip: "Every weekly and monthly NSE and BSE expiry, from the exchanges' own contract lists." },
  { id: "holidays", label: "Holidays", tip: "BSE / NSE holidays (NSE's own list) and NASDAQ holidays." },
];
const PART_IDS = PARTS.map((p) => p.id);

export default function CalendarView() {
  const [part, setPart] = usePageTab("calendar", PART_IDS);
  const ns = useNextSession();
  const now = useExchangeNow(1000);
  const d = ns.data;
  const later = d ? (d.upcoming || [])[0] : null;
  const ist = new Date(now).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  return (
    <>
      <PageHead
        title="Calendar"
        text="Exchange time, the next trading day, every derivatives expiry and the holiday lists — read from the exchanges themselves and kept current by the server. No AI."
      />
      <PageBar
        label={d ? d.next.label : "…"}
        labelTitle="Next trading day"
        kpis={[
          { label: "NSE time (IST)", value: ist, tip: "NSE's time, kept in step with India's time servers — not this computer's clock." },
          { label: "Opens", value: d ? `${d.next.openClock}` : null },
          { label: "Next holiday", value: later ? `${later.short} · ${later.name}` : d ? "none listed" : null, more: true },
          { label: "Holiday list", value: d ? (d.verify.status === "match" ? "NSE ✓" : d.verify.status === "differs" ? "NSE (differs)" : "built-in") : null, tone: d && d.verify.status === "differs" ? "warn" : "", more: true, tip: d ? d.verify.text : undefined },
        ]}
        tabs={PARTS}
        tab={part}
        onTab={setPart}
        tabsLabel="Calendar sections"
      />
      <PagePart id="clocks" tab={part} all="all">
        <WorldClock />
        <TimeConverter />
      </PagePart>
      <PagePart id="expiry" tab={part} all="all">
        {/* every weekly and monthly derivatives expiry, from the exchanges' own contract lists (server/expiry.js) */}
        <ExpiryCalendar />
      </PagePart>
      <PagePart id="holidays" tab={part} all="all">
        <div className="sr-two">
          <HolidayCalendar market="india" />
          <HolidayCalendar market="nasdaq" />
        </div>
      </PagePart>
    </>
  );
}
