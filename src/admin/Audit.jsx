// src/admin/Audit.jsx
// The audit log: every sign-in, key released, rating, moderation, coupon and
// data request, with who did it and when. Append-only: nothing on this screen
// (or anywhere in the collector) edits or removes a line.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { call, explain } from "../api/collector";
import { Card, Chip, Empty, Failure, Loading } from "./ui";
import { addDays, download, fmtWhen, fmtN, toCsv } from "./format";
import { IconDownload, IconRefresh, IconSearch } from "../components/ui/icons";

const WINDOWS = [
  { id: "1", label: "Today", days: 0 },
  { id: "7", label: "7 days", days: 6 },
  { id: "30", label: "30 days", days: 29 },
  { id: "all", label: "All time", days: null },
];

const TONES = {
  auth: "info",
  book: "ink",
  review: "gold",
  coupon: "clay",
  admin: "muted",
  security: "bad",
  data: "warn",
  team: "ink",
  system: "bad",
};

const toneOf = (a) => TONES[String(a).split(".")[0]] || "muted";

export default function Audit() {
  const [win, setWin] = useState("7");
  const [actor, setActor] = useState("");
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(200);
  const [live, setLive] = useState(false);
  const [state, setState] = useState({ status: "loading", rows: [], total: 0, actions: [], error: null });
  const seq = useRef(0);

  const params = useMemo(() => {
    const w = WINDOWS.find((x) => x.id === win);
    const p = { limit, actor: actor.trim(), kind, q: q.trim() };
    if (w && w.days !== null) {
      const d = addDays(new Date(), -w.days);
      d.setHours(0, 0, 0, 0);
      p.from = d.toISOString();
    }
    return p;
  }, [win, actor, kind, q, limit]);

  const load = useCallback(async () => {
    const id = ++seq.current;
    setState((s) => ({ ...s, status: s.rows.length ? "refreshing" : "loading", error: null }));
    try {
      const d = await call("audit_list", params);
      if (id === seq.current) setState({ status: "ready", rows: d.rows || [], total: d.total || 0, actions: d.actions || [], error: null });
    } catch (e) {
      if (id === seq.current) setState((s) => ({ ...s, status: "error", error: e }));
    }
  }, [params]);

  // typing in the search boxes waits a moment; everything else is immediate
  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    if (!live) return undefined;
    const t = setInterval(() => document.visibilityState === "visible" && load(), 20 * 1000);
    return () => clearInterval(t);
  }, [live, load]);

  const exportCsv = () =>
    download(
      `audit-log-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(state.rows, [
        { label: "When (UTC)", key: "at" },
        { label: "Who", key: "actor" },
        { label: "Role", key: "role" },
        { label: "Action", key: "action" },
        { label: "Target", key: "target" },
        { label: "Detail", key: "detail" },
        { label: "Result", key: "result" },
        { label: "Device", key: "device" },
      ])
    );

  return (
    <Card
      pad={false}
      title="Audit log"
      sub={`Showing ${fmtN(state.rows.length)} of ${fmtN(state.total)} matching entries · newest first · cannot be edited`}
      action={
        <div className="row">
          <label className="sw">
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
            <span className="sw__t" aria-hidden="true" />
            <span>Live</span>
          </label>
          <button type="button" className="db db--ghost db--sm" onClick={load}>
            <IconRefresh size={15} className={state.status === "refreshing" ? "spin" : ""} /> Refresh
          </button>
          <button type="button" className="db db--ghost db--sm" onClick={exportCsv} disabled={!state.rows.length}>
            <IconDownload size={15} /> CSV
          </button>
        </div>
      }
    >
      <div className="filters">
        <div className="dpills" role="group" aria-label="Period">
          {WINDOWS.map((w) => (
            <button key={w.id} type="button" className={`dpill ${win === w.id ? "is-on" : ""}`} onClick={() => setWin(w.id)}>
              {w.label}
            </button>
          ))}
        </div>
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Action">
          <option value="">Every action</option>
          {state.actions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <label className="srch">
          <IconSearch size={16} />
          <input placeholder="Who (e-mail)" value={actor} onChange={(e) => setActor(e.target.value)} />
        </label>
        <label className="srch">
          <IconSearch size={16} />
          <input placeholder="Search target or detail" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <select value={limit} onChange={(e) => setLimit(Number(e.target.value))} aria-label="How many">
          <option value={100}>100 rows</option>
          <option value={200}>200 rows</option>
          <option value={500}>500 rows</option>
        </select>
      </div>

      {state.status === "loading" && !state.rows.length && <Loading label="Loading the log…" />}
      {state.status === "error" && <Failure error={state.error} text={explain(state.error)} onRetry={load} />}
      {state.status !== "loading" && !state.rows.length && !state.error && <Empty>No entries for these filters.</Empty>}

      {state.rows.length > 0 && (
        <div className="tbl-wrap">
          <table className="tbl tbl--audit">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
                <th>Target</th>
                <th>Detail</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {state.rows.map((r, i) => (
                <tr key={`${r.at}-${i}`} className={r.result === "denied" ? "is-denied" : ""}>
                  <td className="nowrap">{fmtWhen(r.at)}</td>
                  <td>
                    <span className="clip">{r.actor}</span>
                    <small className="sub">{r.role}</small>
                  </td>
                  <td>
                    <Chip tone={toneOf(r.action)}>{r.action}</Chip>
                  </td>
                  <td>
                    <span className="clip">{r.target || "—"}</span>
                  </td>
                  <td>
                    <span className="clip clip--wide" title={r.detail}>
                      {r.detail || "—"}
                    </span>
                  </td>
                  <td>{r.result === "denied" ? <Chip tone="bad">denied</Chip> : <Chip tone="ok">ok</Chip>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
