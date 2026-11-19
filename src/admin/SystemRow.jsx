// The system cards of /me — Site health, Automation, Data & backups, WhatsApp Trading, Alerts on your phone (Telegram) and the Mandir — as one
// row of compact tiles. Each tile shows the live state in a glance; pressing one opens the full card (the same card as
// before, with all its settings) in a panel under the row, one at a time. Nothing was removed: the row is only a more
// compact front for the cards.

import React, { useEffect, useState } from "react";
import { api } from "./api";
import { everyVisible } from "./visible";
import HealthCard from "./HealthCard";
import WhatsAppCard from "./WhatsAppCard";
import NotifyCard from "./NotifyCard";
import TempleCard from "./temple/TempleCard";
import AutomationCard from "./AutomationCard";
import DataCard from "./DataCard";

const ICON = {
  health: "M3 12h4l2-6 4 12 2-6h6",
  whatsapp: "M4 5h16v11H9l-5 4zM8 9h8M8 12h5",
  telegram: "M21 3L3 11l7 3 3 7zM10 14l11-11",
  mandir: "M12 3l8 5H4zM6 8v10M18 8v10M4 21h16M10 21v-5h4v5",
  data: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6",
  auto: "M12 3v3M12 18v3M4.6 6.6l2.1 2.1M17.3 15.3l2.1 2.1M3 12h3M18 12h3M4.6 17.4l2.1-2.1M17.3 8.7l2.1-2.1M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
};
const ago = (iso) => {
  if (!iso) return "";
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s) || s < 0) return "";
  if (s < 90) return "just now";
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
};

function Tile({ id, tone, icon, title, value, sub, open, onToggle }) {
  return (
    <li className={`hm-sys__tile is-${tone} ${open ? "is-open" : ""}`}>
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={`hm-sys-${id}`} data-tip={`${title}: press to ${open ? "close" : "open"} the full card with its settings.`}>
        <span className="hm-sys__ico">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={ICON[icon]} />
          </svg>
        </span>
        <span className="hm-sys__txt">
          <span className="hm-sys__k">{title}</span>
          <b className="hm-sys__v">{value}</b>
          <small>{sub}</small>
        </span>
        <span className="hm-sys__chev" aria-hidden="true">
          {open ? "▴" : "▾"}
        </span>
      </button>
    </li>
  );
}

export default function SystemRow({ isSuper }) {
  const [d, setD] = useState({});
  const [open, setOpen] = useState("");
  useEffect(() => {
    let alive = true;
    const put = (k) => (v) => alive && setD((x) => ({ ...x, [k]: v }));
    const load = () => {
      api("/api/admin/health").then(put("health")).catch(() => {});
      api("/api/admin/temple").then(put("temple")).catch(() => {});
      api("/api/admin/automation").then(put("auto")).catch(() => {});
      api("/api/admin/recorder").then(put("rec")).catch(() => {});
      if (isSuper) {
        api("/api/admin/whatsapp").then(put("wa")).catch(() => {});
        api("/api/admin/notify").then(put("tg")).catch(() => {});
        api("/api/admin/vault/status").then(put("vault")).catch(() => {});
      }
    };
    load();
    const stop = everyVisible(load, 60000, { topics: ["health", "system", "automation", "data"] });
    return () => {
      alive = false;
      stop();
    };
  }, [isSuper]);

  const h = d.health && d.health.counts ? d.health : null;
  const health = h
    ? { tone: h.overall === "error" ? "error" : h.overall === "warn" ? "warn" : "ok", value: `${h.counts.ok} working`, sub: `${h.counts.warn} to look at · ${h.counts.error} not working · ${h.counts.off} off` }
    : { tone: "off", value: "…", sub: "checking every part of the site" };

  const wa = d.wa && typeof d.wa.configured === "boolean" ? d.wa : null;
  const whatsapp = !wa
    ? { tone: "off", value: "…", sub: "timed updates and commands" }
    : !wa.configured
      ? { tone: "off", value: "Not set up", sub: "positions, advice and commands on WhatsApp" }
      : wa.lastError
        ? { tone: "warn", value: wa.enabled ? "On, with a problem" : "Off", sub: `last message failed: ${String(wa.lastError).slice(0, 60)}` }
        : wa.enabled
          ? { tone: "ok", value: "On", sub: `updates every ${wa.every} min${wa.lastSent ? ` · last ${ago(wa.lastSent)}` : ""}${wa.allowTrading ? " · trading allowed" : ""}` }
          : { tone: "off", value: "Switched off", sub: "set up; press to turn it on" };

  const tg = d.tg && typeof d.tg.configured === "boolean" ? d.tg : null;
  const telegram = !tg
    ? { tone: "off", value: "…", sub: "price alerts, risk guard, day report" }
    : !tg.configured
      ? { tone: "off", value: "Not set up", sub: "alerts to your phone with no page open" }
      : tg.lastError
        ? { tone: "warn", value: "Connected", sub: `last message failed: ${String(tg.lastError).slice(0, 60)}` }
        : { tone: "ok", value: "Connected", sub: `price alerts · risk guard · day report${tg.lastSent ? ` · last ${ago(tg.lastSent)}` : ""}` };

  const t = d.temple && d.temple.source ? d.temple : null;
  const files = t && Array.isArray(t.library) ? t.library.length : 0;
  const mandir = !t
    ? { tone: "off", value: "…", sub: "Shri Hanuman Chalisa audio" }
    : t.missing
      ? { tone: "warn", value: "A file is missing", sub: "upload it again" }
      : t.source.kind === "youtube"
        ? { tone: "warn", value: "Link only", sub: "YouTube cannot play in the background" }
        : { tone: "ok", value: t.source.kind === "library" ? `${files} file${files === 1 ? "" : "s"}` : "Audio link", sub: `volume ${Math.round((t.volume || 0) * 100)}%${t.autoplay ? " · starts by itself" : ""}` };

  const au = d.auto && Array.isArray(d.auto.duties) ? d.auto : null;
  const auOn = au ? au.systems.filter((x) => ["on", "learning", "standing-by", "click-only"].includes(x.state)).length : 0;
  const auBehind = au ? au.duties.filter((x) => x.state !== "ok") : [];
  const needsYou = au ? au.systems.some((x) => x.state === "needs-you") : false;
  const auto = !au
    ? { tone: "off", value: "…", sub: "everything that runs by itself" }
    : au.duties.some((x) => x.state === "failed")
      ? { tone: "error", value: "A catch-up failed", sub: auBehind.map((x) => x.name).join(", ") }
      : au.running
        ? { tone: "ok", value: "Catching up now", sub: (au.duties.find((x) => x.id === au.running.id) || {}).name || "" }
        : auBehind.length
          ? { tone: "warn", value: `${auBehind.length} catching up`, sub: auBehind.map((x) => x.name).join(", ") }
          : needsYou
            ? { tone: "warn", value: "Waiting for Zerodha", sub: "log in to Kite: the rest runs by itself" }
            : { tone: "ok", value: `${auOn} of ${au.systems.length} running`, sub: "nothing is behind · checked every minute" };

  // what is recorded by itself, what was learned from it, and (for the owner) the newest backup
  const rc = d.rec && d.rec.learner && d.rec.stored ? d.rec : null;
  const vt = d.vault && d.vault.settings ? d.vault : null;
  const learned = rc ? (rc.learner.on ? "order book & OI in use" : rc.learner.days ? `order book & OI: ${rc.learner.days} learned, not proven yet` : "order book & OI: learning starts after the first session") : "";
  const data = !rc
    ? { tone: "off", value: "…", sub: "what is recorded, learned and backed up" }
    : rc.state === "needs-zerodha"
      ? { tone: "warn", value: "Not recording", sub: "the market is open: log in to Kite" }
      : vt && vt.error
        ? { tone: "warn", value: "A backup failed", sub: String(vt.error).slice(0, 70) }
        : { tone: "ok", value: rc.state === "recording" ? `Recording · ${rc.today ? rc.today.taken : 0} min today` : `${rc.stored.sessions} session${rc.stored.sessions === 1 ? "" : "s"} recorded`, sub: `${learned}${vt ? ` · ${vt.last ? `backup ${ago(vt.last.at)}` : "no backup yet"}` : ""}` };

  const toggle = (id) => setOpen((o) => (o === id ? "" : id));
  const panels = { health: <HealthCard />, auto: <AutomationCard />, data: <DataCard />, wa: <WhatsAppCard />, tg: <NotifyCard />, mandir: <TempleCard /> };
  return (
    <div className="hm-sys">
      <ul className="hm-sys__row" data-n={isSuper ? 6 : 4} aria-label="System cards">
        <Tile id="health" icon="health" title="Site health" {...health} open={open === "health"} onToggle={() => toggle("health")} />
        <Tile id="auto" icon="auto" title="Automation" {...auto} open={open === "auto"} onToggle={() => toggle("auto")} />
        <Tile id="data" icon="data" title={"Data & backups"} {...data} open={open === "data"} onToggle={() => toggle("data")} />
        {isSuper && <Tile id="wa" icon="whatsapp" title="WhatsApp Trading" {...whatsapp} open={open === "wa"} onToggle={() => toggle("wa")} />}
        {isSuper && <Tile id="tg" icon="telegram" title="Alerts on your phone" {...telegram} open={open === "tg"} onToggle={() => toggle("tg")} />}
        <Tile id="mandir" icon="mandir" title="मंदिर · Mandir" {...mandir} open={open === "mandir"} onToggle={() => toggle("mandir")} />
      </ul>
      {open && (
        <div className="hm-sys__panel" id={`hm-sys-${open}`} role="region" aria-label="The full card">
          {panels[open]}
        </div>
      )}
    </div>
  );
}
