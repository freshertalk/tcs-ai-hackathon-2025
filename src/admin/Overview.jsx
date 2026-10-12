// src/admin/Overview.jsx
// The analytics: who came, when, what they read and for how long — for any
// period, today to all time.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { call, explain } from "../api/collector";
import { BarChart, Donut, HBars, LineChart } from "./charts";
import { Card, Failure, Kpi, Loading, Empty } from "./ui";
import {
  PRESETS,
  addDays,
  fmtAgo,
  fmtDur,
  fmtN,
  prettyPath,
  shortDate,
  tzMinutes,
  ymd,
} from "./format";
import { IconClock, IconEye, IconRefresh, IconUsers, IconBook, IconChart, IconUser } from "../components/ui/icons";

const INK = "#7b2b2b";
const CLAY = "#c1663a";
const NAVY = "#1d3d62";
const GOLD = "#d9a441";
const SAGE = "#5f8a6b";

function useStats(req, includeAdmins) {
  const [state, setState] = useState({ status: "loading", data: null, error: null });
  const live = useRef(0);

  const load = useCallback(
    async (fresh) => {
      const id = ++live.current;
      setState((s) => ({ ...s, status: s.data ? "refreshing" : "loading", error: null }));
      try {
        const data = await call("admin_stats", { ...req, tzMin: tzMinutes(), includeAdmins, fresh: Boolean(fresh) });
        if (id === live.current) setState({ status: "ready", data, error: null });
      } catch (e) {
        if (id === live.current) setState((s) => ({ status: "error", data: s.data, error: e }));
      }
    },
    // the request is an object rebuilt each render; its content is what matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(req), includeAdmins]
  );

  useEffect(() => {
    load(false);
    const t = setInterval(() => document.visibilityState === "visible" && load(false), 60 * 1000);
    return () => {
      clearInterval(t);
      live.current += 1;
    };
  }, [load]);

  return { ...state, reload: () => load(true) };
}

function Snapshot({ s }) {
  const items = [
    { k: "today", label: "Today" },
    { k: "yesterday", label: "Yesterday" },
    { k: "week", label: "Last 7 days" },
    { k: "month", label: "Last 30 days" },
    { k: "all", label: "Till date" },
  ];
  return (
    <div className="snap">
      {items.map(({ k, label }) => (
        <div className="snap__c" key={k}>
          <span className="snap__l">{label}</span>
          <b className="snap__v">{fmtN(s[k].visitors)}</b>
          <span className="snap__u">visitors</span>
          <span className="snap__m">
            {fmtN(s[k].views)} views · {fmtDur(s[k].seconds)}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function Overview() {
  const [preset, setPreset] = useState("7d");
  const today = useMemo(() => new Date(), []);
  const [custom, setCustom] = useState({ from: ymd(addDays(today, -13)), to: ymd(today) });
  const [includeAdmins, setIncludeAdmins] = useState(false);

  const req = useMemo(() => {
    if (preset === "custom") {
      const a = custom.from <= custom.to ? custom : { from: custom.to, to: custom.from };
      return { from: a.from, to: a.to };
    }
    const p = PRESETS.find((x) => x.id === preset);
    const r = p && p.range(today);
    return r ? { from: r[0], to: r[1] } : { all: true };
  }, [preset, custom, today]);

  const { status, data, error, reload } = useStats(req, includeAdmins);

  const hourly = useMemo(
    () => (data ? data.hourly.map((v, h) => ({ d: String(h), v })) : []),
    [data]
  );
  const series = useMemo(
    () => (data ? data.series.map((r) => ({ ...r, min: Math.round(r.seconds / 60) })) : []),
    [data]
  );

  const label = useCallback(
    (r) => (data && data.range.bucket === "month" ? r.d : shortDate(r.d)),
    [data]
  );

  return (
    <div className="ov">
      <div className="bar">
        <div className="dpills" role="group" aria-label="Period">
          {PRESETS.map((p) => (
            <button key={p.id} type="button" className={`dpill ${preset === p.id ? "is-on" : ""}`} onClick={() => setPreset(p.id)}>
              {p.label}
            </button>
          ))}
          <button type="button" className={`dpill ${preset === "custom" ? "is-on" : ""}`} onClick={() => setPreset("custom")}>
            Custom
          </button>
        </div>
        <div className="bar__r">
          <label className="sw">
            <input type="checkbox" checked={includeAdmins} onChange={(e) => setIncludeAdmins(e.target.checked)} />
            <span className="sw__t" aria-hidden="true" />
            <span>Include admin traffic</span>
          </label>
          <button type="button" className="db db--ghost db--sm" onClick={reload} disabled={status === "loading" || status === "refreshing"}>
            <IconRefresh size={15} className={status === "refreshing" ? "spin" : ""} /> Refresh
          </button>
        </div>
      </div>

      {preset === "custom" && (
        <div className="range">
          <label>
            From
            <input type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
          </label>
          <label>
            To
            <input type="date" value={custom.to} min={custom.from} max={ymd(today)} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
          </label>
        </div>
      )}

      {status === "loading" && !data && <Loading label="Reading the figures…" />}
      {status === "error" && !data && <Failure error={error} text={explain(error)} onRetry={reload} />}

      {data && (
        <>
          {status === "error" && <Failure error={error} text={`Showing the last figures. ${explain(error)}`} onRetry={reload} />}

          <p className="ov__range">
            {data.range.all ? "All time" : `${shortDate(data.range.from, true)} – ${shortDate(data.range.to, true)}`} ·{" "}
            {data.range.days} day{data.range.days === 1 ? "" : "s"} · updated {fmtAgo(data.at)}
            {data.totals.anonViews ? ` · ${fmtN(data.totals.anonViews)} views from visitors who chose “necessary only”` : ""}
          </p>

          <Snapshot s={data.snapshot} />

          <div className="kpis">
            <Kpi label="Visitors" icon={<IconEye size={18} />} value={fmtN(data.totals.visitors)} now={data.totals.visitors} before={data.prev && data.prev.visitors} hint={`${fmtN(data.totals.newVisitors)} new · ${fmtN(data.totals.returning)} returning`} />
            <Kpi label="Page views" icon={<IconChart size={18} />} value={fmtN(data.totals.views)} now={data.totals.views} before={data.prev && data.prev.views} hint={`${fmtN(data.totals.sessions)} sessions`} />
            <Kpi label="Signed-in readers" icon={<IconUsers size={18} />} value={fmtN(data.totals.readers)} now={data.totals.readers} before={data.prev && data.prev.readers} hint={`${fmtN(data.users.registered)} registered in all`} />
            <Kpi label="Time spent" icon={<IconClock size={18} />} value={fmtDur(data.totals.seconds)} now={data.totals.seconds} before={data.prev && data.prev.seconds} hint={`${fmtDur(data.split.reading)} reading`} />
            <Kpi label="Avg. per visitor" icon={<IconUser size={18} />} value={fmtDur(data.totals.avgVisitor)} hint="time on site" />
            <Kpi label="Avg. session" icon={<IconClock size={18} />} value={fmtDur(data.totals.avgSession)} hint={`${fmtN(data.totals.sessions)} sessions`} />
            <Kpi label="Chapters opened" icon={<IconBook size={18} />} value={fmtN(data.totals.chapters)} now={data.totals.chapters} before={data.prev && data.prev.chapters} hint="in the reader" />
            <Kpi label="New readers" icon={<IconUsers size={18} />} value={fmtN(data.users.newInRange)} hint={`${fmtN(data.totals.signins)} sign-ins`} />
          </div>

          <div className="grid2">
            <Card title="Visitors and page views" sub={`by ${data.range.bucket}`}>
              <LineChart
                data={series}
                label={label}
                fmt={fmtN}
                series={[
                  { key: "views", label: "Page views", color: CLAY, area: true },
                  { key: "visitors", label: "Visitors", color: INK },
                  { key: "readers", label: "Signed-in readers", color: NAVY },
                ]}
              />
            </Card>
            <Card title="Time spent on the site" sub="minutes, all visitors together">
              <BarChart data={series} valueKey="min" label={label} color={GOLD} fmt={(n) => `${fmtN(n)}m`} />
            </Card>
          </div>

          <div className="grid3">
            <Card title="When people visit" sub="page views by hour of the day">
              <BarChart data={hourly} valueKey="v" label={(r) => r.d} color={NAVY} height={180} fmt={fmtN} />
            </Card>
            <Card title="Devices" sub="by page views">
              <Donut
                parts={[
                  { label: "Phone", value: data.devices.m, color: INK },
                  { label: "Tablet", value: data.devices.t, color: GOLD },
                  { label: "Computer", value: data.devices.d, color: NAVY },
                ]}
                center={fmtN(data.devices.m + data.devices.t + data.devices.d)}
              />
            </Card>
            <Card title="Time: who and where">
              <Donut
                parts={[
                  { label: "Signed-in readers", value: data.split.signedIn, color: INK },
                  { label: "Other visitors", value: data.split.visitors, color: CLAY },
                ]}
                center={fmtDur(data.split.signedIn + data.split.visitors)}
              />
              <div style={{ height: 14 }} />
              <Donut
                parts={[
                  { label: "Reading the book", value: data.split.reading, color: SAGE },
                  { label: "Elsewhere on the site", value: data.split.other, color: GOLD },
                ]}
                center={fmtDur(data.split.reading + data.split.other)}
              />
            </Card>
          </div>

          <div className="grid2">
            <Card title="Top pages" pad={false}>
              {data.pages.length ? (
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Page</th>
                      <th className="num">Views</th>
                      <th className="num">Visitors</th>
                      <th className="num">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.pages.map((p) => (
                      <tr key={p.p}>
                        <td title={p.p}>{prettyPath(p.p)}</td>
                        <td className="num">{fmtN(p.views)}</td>
                        <td className="num">{fmtN(p.visitors)}</td>
                        <td className="num">{fmtDur(p.seconds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <Empty>No page views in this period.</Empty>
              )}
            </Card>

            <Card title="Most opened chapters">
              <HBars
                rows={data.reads.map((r) => ({
                  label: prettyPath(r.p).replace("Reader · ", ""),
                  value: r.opens,
                  sub: r.secs ? fmtDur(r.secs) : "",
                }))}
                color={SAGE}
                fmt={fmtN}
                empty="No chapters opened in this period."
              />
            </Card>
          </div>

          <div className="grid2">
            <Card title="Where visitors came from">
              <HBars rows={data.referrers.map((r) => ({ label: r.r, value: r.n }))} color={CLAY} fmt={fmtN} empty="No outside referrers in this period (direct visits aren’t listed)." />
            </Card>

            <Card title="Most engaged readers" sub="by time spent" pad={false}>
              {data.people.length ? (
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Reader</th>
                      <th className="num">Time</th>
                      <th className="num">Views</th>
                      <th className="num">Last seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.people.map((p) => (
                      <tr key={p.email}>
                        <td>
                          <b>{p.name || p.email.split("@")[0]}</b>
                          <small className="sub">{p.email}</small>
                        </td>
                        <td className="num">{fmtDur(p.seconds)}</td>
                        <td className="num">{fmtN(p.views)}</td>
                        <td className="num">{fmtAgo(p.last)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <Empty>No signed-in reading in this period.</Empty>
              )}
            </Card>
          </div>

          <p className="ov__foot">
            {fmtN(data.scanned)} event rows scanned. Figures count a visitor by a random id kept in the browser (for
            those who accepted cookies) and a reader by their account.
            {data.includeAdmins ? " Admin traffic is included." : " Admin traffic is left out."}
          </p>
        </>
      )}
      {status === "refreshing" && <span className="ov__live">updating…</span>}
    </div>
  );
}
