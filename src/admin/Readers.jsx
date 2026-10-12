// src/admin/Readers.jsx
// Everyone who has signed in: when they came, how often, how long they have
// spent. Searchable, sortable, and downloadable as a spreadsheet.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { call, explain } from "../api/collector";
import { Card, Chip, Empty, Failure, Loading } from "./ui";
import { download, fmtAgo, fmtDur, fmtN, fmtWhen, toCsv } from "./format";
import { IconDownload, IconRefresh, IconSearch } from "../components/ui/icons";

const COLS = [
  { key: "name", label: "Reader" },
  { key: "firstSeen", label: "First seen", num: true },
  { key: "lastSeen", label: "Last seen", num: true },
  { key: "signins", label: "Sign-ins", num: true },
  { key: "seconds", label: "Time spent", num: true },
  { key: "views", label: "Page views", num: true },
];

export default function Readers() {
  const [state, setState] = useState({ status: "loading", rows: [], total: 0, error: null });
  const [q, setQ] = useState("");
  const [sort, setSort] = useState({ key: "lastSeen", dir: -1 });

  const load = useCallback(async (term) => {
    setState((s) => ({ ...s, status: "loading", error: null }));
    try {
      const d = await call("admin_users", { q: term || "", limit: 500 });
      setState({ status: "ready", rows: d.rows || [], total: d.total || 0, error: null });
    } catch (e) {
      setState((s) => ({ ...s, status: "error", error: e }));
    }
  }, []);

  // opening loads at once; searching asks the collector after a short pause in typing
  useEffect(() => {
    const t = setTimeout(() => load(q), q ? 350 : 0);
    return () => clearTimeout(t);
  }, [q, load]);

  const rows = useMemo(() => {
    const k = sort.key;
    const list = state.rows.slice();
    list.sort((a, b) => {
      const x = a[k];
      const y = b[k];
      if (typeof x === "number" && typeof y === "number") return (x - y) * sort.dir;
      return String(x || "").localeCompare(String(y || "")) * sort.dir;
    });
    return list;
  }, [state.rows, sort]);

  const head = (c) => (
    <th key={c.key} className={c.num ? "num" : ""} aria-sort={sort.key === c.key ? (sort.dir > 0 ? "ascending" : "descending") : "none"}>
      <button type="button" className="th" onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? -s.dir : -1 }))}>
        {c.label}
        {sort.key === c.key ? <span aria-hidden="true">{sort.dir > 0 ? " ↑" : " ↓"}</span> : null}
      </button>
    </th>
  );

  const exportCsv = () =>
    download(
      `readers-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(rows, [
        { label: "Name", key: "name" },
        { label: "Email", key: "email" },
        { label: "Role", key: "role" },
        { label: "Status", key: "status" },
        { label: "First seen", key: "firstSeen" },
        { label: "Last seen", key: "lastSeen" },
        { label: "Sign-ins", key: "signins" },
        { label: "Seconds spent", key: "seconds" },
        { label: "Page views", key: "views" },
      ])
    );

  return (
    <Card
      pad={false}
      title="Readers"
      sub={`${fmtN(state.total)} signed-in reader${state.total === 1 ? "" : "s"}${q ? " match" : ""}`}
      action={
        <div className="row">
          <label className="srch">
            <IconSearch size={16} />
            <input type="search" placeholder="Search name or e-mail" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <button type="button" className="db db--ghost db--sm" onClick={() => load(q)}>
            <IconRefresh size={15} /> Refresh
          </button>
          <button type="button" className="db db--ghost db--sm" onClick={exportCsv} disabled={!rows.length}>
            <IconDownload size={15} /> CSV
          </button>
        </div>
      }
    >
      {state.status === "loading" && !rows.length && <Loading label="Loading readers…" />}
      {state.status === "error" && <Failure error={state.error} text={explain(state.error)} onRetry={() => load(q)} />}
      {state.status !== "loading" && !rows.length && !state.error && <Empty>No readers yet{q ? " for this search" : ""}.</Empty>}

      {rows.length > 0 && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>{COLS.map(head)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.email}>
                  <td>
                    <div className="who">
                      {r.picture ? <img src={r.picture} alt="" width="34" height="34" referrerPolicy="no-referrer" loading="lazy" /> : <span className="who__i">{(r.name || r.email).slice(0, 1).toUpperCase()}</span>}
                      <div>
                        <b>{r.name || "—"}</b>
                        <small className="sub">
                          {r.email}
                          {r.role === "admin" ? <Chip tone="ink">admin</Chip> : null}
                          {r.status === "erased" ? <Chip tone="warn">data erased</Chip> : null}
                        </small>
                      </div>
                    </div>
                  </td>
                  <td className="num" title={fmtWhen(r.firstSeen)}>
                    {fmtAgo(r.firstSeen)}
                  </td>
                  <td className="num" title={fmtWhen(r.lastSeen)}>
                    {fmtAgo(r.lastSeen)}
                  </td>
                  <td className="num">{fmtN(r.signins)}</td>
                  <td className="num">{fmtDur(r.seconds)}</td>
                  <td className="num">{fmtN(r.views)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
