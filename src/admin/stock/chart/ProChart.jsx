// The terminal's full chart: every Kite interval from 1 minute to 1 month on real history,
// the live price folded into the last bar as it trades, seven chart types, twenty indicators
// (on the price or in panes of their own), drawing tools, a comparison symbol, candlestick
// patterns, pivot points, log and percent scales, a technical summary, a screenshot and full
// screen. Drawn with TradingView's open-source Lightweight Charts library.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AreaSeries,
  BarSeries,
  BaselineSeries,
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  PriceScaleMode,
} from "lightweight-charts";
import { api } from "../../api";
import { adminPath } from "../../paths";
import { useTick } from "../analyzer/liveTicks";
import { CHART_TYPES, DEFAULT_STUDIES, FIB_LEVELS, STUDIES, studyOf, TOOLS } from "./config";
import * as S from "./studies";
import TechSummary from "./TechSummary";
import "./chart.css";

const PREF = "vpt.chart.prefs";
// short marker labels, so the patterns stay readable on a busy chart
const SHORT = { "Bullish engulfing": "Engulf", "Bearish engulfing": "Engulf", "Morning star": "M★", "Evening star": "E★", Hammer: "Hammer", "Shooting star": "Star" };
const readPrefs = () => {
  try {
    return JSON.parse(window.localStorage.getItem(PREF) || "{}") || {};
  } catch (_) {
    return {};
  }
};
const savePrefs = (p) => {
  try {
    window.localStorage.setItem(PREF, JSON.stringify(p));
  } catch (_) {
    /* remembered for this visit only */
  }
};
const drawKey = (symbol) => `vpt.chart.draw.${symbol}`;
const readDrawings = (symbol) => {
  try {
    const a = JSON.parse(window.localStorage.getItem(drawKey(symbol)) || "[]");
    return Array.isArray(a) ? a : [];
  } catch (_) {
    return [];
  }
};

const fmt = (x, d = 2) => (typeof x === "number" && Number.isFinite(x) ? x.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—");
const fmtVol = (v) => (!v ? "—" : v >= 1e7 ? `${(v / 1e7).toFixed(2)} Cr` : v >= 1e5 ? `${(v / 1e5).toFixed(2)} L` : v >= 1e3 ? `${(v / 1e3).toFixed(1)} K` : String(v));
const line = (bars, values) => bars.map((b, i) => (values[i] === null || values[i] === undefined ? { time: b.time } : { time: b.time, value: values[i] }));

/** The desk's colours, read from the page so the chart follows the dark / light theme. */
function palette(el) {
  const cs = getComputedStyle(el);
  const v = (name, fb) => (cs.getPropertyValue(name) || "").trim() || fb;
  return { bg: v("--surface", "#131a23"), ink: v("--ink-2", "#b3bdc9"), grid: v("--line", "rgba(255,255,255,0.08)"), up: v("--up", "#2ebd85"), down: v("--down", "#f6465d"), accent: v("--accent", "#6aaeee") };
}

/**
 * @param standalone  the chart is the whole page (opened in its own tab): it fills the window and
 *                    has no "open in a new tab" button of its own
 */
export default function ProChart({ symbol, live = false, height = null, standalone = false }) {
  const prefs0 = useMemo(readPrefs, []);
  const [interval, setInterval_] = useState(prefs0.interval || "day");
  const [type, setType] = useState(prefs0.type || "candles");
  const [studies, setStudies] = useState(Array.isArray(prefs0.studies) ? prefs0.studies : DEFAULT_STUDIES);
  const [scale, setScale] = useState(prefs0.scale || "normal");
  const [showPatterns, setShowPatterns] = useState(Boolean(prefs0.patterns));
  const [showPivots, setShowPivots] = useState(Boolean(prefs0.pivots));
  const [tool, setTool] = useState("cursor");
  const [drawings, setDrawings] = useState(() => readDrawings(symbol));
  const [pending, setPending] = useState(null); // first click of a two-click tool
  const [measure, setMeasure] = useState(null);
  const [compare, setCompare] = useState({ symbol: "", bars: null, error: "" });
  const [raw, setRaw] = useState({ loading: true, bars: [], error: "", symbol: "" });
  const [legend, setLegend] = useState(null);
  const [menu, setMenu] = useState("");
  const [query, setQuery] = useState("");
  const [theme, setTheme] = useState(0);
  const [full, setFull] = useState(false);

  const box = useRef(null);
  const holder = useRef(null);
  const chartRef = useRef(null);
  const series = useRef({});
  const drawn = useRef([]);
  const iv = S.intervalOf(interval);
  const intraday = iv.sec < 86400;
  const tick = useTick(live ? symbol : null);

  useEffect(() => savePrefs({ interval, type, studies, scale, patterns: showPatterns, pivots: showPivots }), [interval, type, studies, scale, showPatterns, showPivots]);
  useEffect(() => {
    setDrawings(readDrawings(symbol));
    setPending(null);
    setMeasure(null);
  }, [symbol]);
  useEffect(() => {
    try {
      window.localStorage.setItem(drawKey(symbol), JSON.stringify(drawings));
    } catch (_) {
      /* not kept */
    }
  }, [drawings, symbol]);

  /* ---------------------------------------------------------------- data */
  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setRaw((r) => ({ ...r, loading: true, error: "" }));
      try {
        const d = await api(`/api/admin/market/candles/${encodeURIComponent(symbol)}?interval=${iv.kite}`);
        setRaw({ loading: false, bars: S.toBars(d.candles), error: "", symbol, kite: iv.kite, stale: d.stale });
      } catch (e) {
        setRaw((r) => ({ loading: false, bars: r.symbol === symbol ? r.bars : [], error: e.message, symbol }));
      }
    },
    [symbol, iv.kite]
  );
  useEffect(() => {
    load(false);
  }, [load]);
  // intraday charts re-read their history every minute, so a missed tick never leaves a gap
  useEffect(() => {
    if (!intraday) return undefined;
    const id = setInterval(() => document.visibilityState !== "hidden" && load(true), 60000);
    return () => clearInterval(id);
  }, [intraday, load]);

  const base = useMemo(() => (iv.group ? S.aggregate(raw.bars, iv.group) : raw.bars), [raw.bars, iv.group]);
  // the live price, folded into the last bar (throttled by the tick store's own pace)
  const bars = useMemo(() => {
    if (!tick || typeof tick.last !== "number" || !base.length) return base;
    const tickMs = tick.time ? Date.parse(`${String(tick.time).replace(" ", "T")}+05:30`) : Date.now();
    return S.applyTick(base, { price: tick.last, tickMs: Number.isFinite(tickMs) ? tickMs : Date.now() }, iv.sec);
  }, [base, tick, iv.sec]);
  const shown = useMemo(() => (type === "heikin" ? S.heikinAshi(bars) : bars), [bars, type]);

  // the comparison symbol
  useEffect(() => {
    if (!compare.symbol) return undefined;
    let alive = true;
    api(`/api/admin/market/candles/${encodeURIComponent(compare.symbol)}?interval=${iv.kite}`)
      .then((d) => alive && setCompare((c) => ({ ...c, bars: iv.group ? S.aggregate(S.toBars(d.candles), iv.group) : S.toBars(d.candles), error: "" })))
      .catch((e) => alive && setCompare((c) => ({ ...c, bars: null, error: e.message })));
    return () => {
      alive = false;
    };
  }, [compare.symbol, iv.kite, iv.group]);

  // follow the dark / light switch
  useEffect(() => {
    const adm = document.querySelector(".adm");
    if (!adm || typeof MutationObserver === "undefined") return undefined;
    const mo = new MutationObserver(() => setTheme((t) => t + 1));
    mo.observe(adm, { attributes: true, attributeFilter: ["data-desk"] });
    return () => mo.disconnect();
  }, []);
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === box.current);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  // a menu closes on a click outside it or on Escape
  useEffect(() => {
    if (!menu) return undefined;
    const off = (e) => {
      if (e.type === "keydown" ? e.key === "Escape" : !(e.target.closest && e.target.closest(".kc__menuwrap"))) setMenu("");
    };
    document.addEventListener("mousedown", off);
    document.addEventListener("keydown", off);
    return () => {
      document.removeEventListener("mousedown", off);
      document.removeEventListener("keydown", off);
    };
  }, [menu]);

  /* --------------------------------------------------------- build the chart */
  const paneStudies = studies.filter((id) => (studyOf(id) || {}).kind === "pane");
  const buildKey = `${type}|${studies.join(",")}|${scale}|${theme}|${intraday}|${compare.bars ? compare.symbol : ""}|${showPivots}`;

  useEffect(() => {
    const el = holder.current;
    if (!el) return undefined;
    const c = palette(box.current);
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { color: c.bg }, textColor: c.ink, fontFamily: "Open Sans, system-ui, sans-serif", fontSize: 11, attributionLogo: true, panes: { separatorColor: c.grid } },
      grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: c.grid, mode: compare.bars || scale === "percent" ? PriceScaleMode.Percentage : scale === "log" ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal },
      timeScale: { borderColor: c.grid, timeVisible: intraday, secondsVisible: false, rightOffset: 6 },
      localization: { priceFormatter: (p) => fmt(p) },
    });
    const sr = { overlays: [], panes: {} };
    const candleOpts = { upColor: c.up, downColor: c.down, borderUpColor: c.up, borderDownColor: c.down, wickUpColor: c.up, wickDownColor: c.down };
    if (type === "candles" || type === "heikin") sr.main = chart.addSeries(CandlestickSeries, candleOpts);
    else if (type === "hollow") sr.main = chart.addSeries(CandlestickSeries, { ...candleOpts, upColor: "rgba(0,0,0,0)" });
    else if (type === "bars") sr.main = chart.addSeries(BarSeries, { upColor: c.up, downColor: c.down, thinBars: false });
    else if (type === "line") sr.main = chart.addSeries(LineSeries, { color: c.accent, lineWidth: 2 });
    else if (type === "area") sr.main = chart.addSeries(AreaSeries, { lineColor: c.accent, topColor: "rgba(106,174,238,0.35)", bottomColor: "rgba(106,174,238,0.02)", lineWidth: 2 });
    else sr.main = chart.addSeries(BaselineSeries, { topLineColor: c.up, bottomLineColor: c.down, topFillColor1: "rgba(46,189,133,0.25)", bottomFillColor2: "rgba(246,70,93,0.25)" });

    const lineOpts = (color, extra = {}) => ({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, ...extra });
    for (const id of studies) {
      const st = studyOf(id);
      if (!st) continue;
      if (st.kind === "volume") {
        sr.vol = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
        sr.vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      } else if (st.kind === "overlay") {
        if (id === "bb") sr.overlays.push({ id, parts: [chart.addSeries(LineSeries, lineOpts(st.color)), chart.addSeries(LineSeries, lineOpts(st.color, { lineStyle: LineStyle.Dotted })), chart.addSeries(LineSeries, lineOpts(st.color))] });
        else if (id === "st") sr.overlays.push({ id, parts: [chart.addSeries(LineSeries, lineOpts(c.up, { lineWidth: 2 })), chart.addSeries(LineSeries, lineOpts(c.down, { lineWidth: 2 }))] });
        else sr.overlays.push({ id, parts: [chart.addSeries(LineSeries, lineOpts(st.color))] });
      }
    }
    paneStudies.forEach((id, k) => {
      const st = studyOf(id);
      const pane = k + 1;
      const add = (def, opts) => chart.addSeries(def, opts, pane);
      if (id === "macd") sr.panes[id] = [add(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }), add(LineSeries, lineOpts(c.accent)), add(LineSeries, lineOpts("#f5a623"))];
      else if (id === "stoch") sr.panes[id] = [add(LineSeries, lineOpts(c.accent)), add(LineSeries, lineOpts("#f5a623"))];
      else if (id === "adx") sr.panes[id] = [add(LineSeries, lineOpts("#ef6c00", { lineWidth: 2 })), add(LineSeries, lineOpts(c.up)), add(LineSeries, lineOpts(c.down))];
      else sr.panes[id] = [add(LineSeries, lineOpts(st.color, { lineWidth: 2, lastValueVisible: true }))];
      // the usual reference lines
      const ref = (price) => sr.panes[id][0].createPriceLine({ price, color: c.grid, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false });
      if (id === "rsi") [30, 70].forEach(ref);
      if (id === "stoch") [20, 80].forEach(ref);
      if (id === "cci") [-100, 100].forEach(ref);
      if (id === "willr") [-80, -20].forEach(ref);
      if (id === "adx") ref(25);
    });
    const panes = chart.panes();
    for (let i = 1; i < panes.length; i += 1) panes[i].setHeight(110);
    if (compare.bars) sr.compare = chart.addSeries(LineSeries, lineOpts("#f5a623", { lineWidth: 2, lastValueVisible: true, title: compare.symbol }));
    sr.markers = createSeriesMarkers(sr.main, []);

    chartRef.current = chart;
    series.current = sr;
    fill(shown, true);

    const onMove = (p) => setLegend(p && p.time !== undefined ? p.time : null);
    chart.subscribeCrosshairMove(onMove);
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      drawn.current = [];
      chart.remove();
      chartRef.current = null;
      series.current = {};
    };
    // fill and shown are read at build time only; data changes go through the effect below
  }, [buildKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Put the bars and every study into the series that exist. */
  const fill = useCallback(
    (data, fit = false) => {
      const sr = series.current;
      const chart = chartRef.current;
      if (!chart || !sr.main) return;
      const closes = data.map((b) => b.close);
      const c = palette(box.current);
      if (type === "line" || type === "area" || type === "baseline") sr.main.setData(data.map((b) => ({ time: b.time, value: b.close })));
      else sr.main.setData(data.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
      if (type === "baseline" && data.length) sr.main.applyOptions({ baseValue: { type: "price", price: data[0].close } });
      if (sr.vol) sr.vol.setData(data.map((b) => ({ time: b.time, value: b.volume, color: b.close >= b.open ? "rgba(46,189,133,0.45)" : "rgba(246,70,93,0.45)" })));
      for (const o of sr.overlays) {
        const n = Number(o.id.replace(/\D/g, ""));
        if (o.id.startsWith("sma")) o.parts[0].setData(line(data, S.sma(closes, n)));
        else if (o.id.startsWith("ema")) o.parts[0].setData(line(data, S.ema(closes, n)));
        else if (o.id.startsWith("wma")) o.parts[0].setData(line(data, S.wma(closes, n)));
        else if (o.id === "vwap") o.parts[0].setData(line(data, S.vwap(data, intraday)));
        else if (o.id === "bb") {
          const b = S.bollinger(closes, 20, 2);
          o.parts[0].setData(line(data, b.up));
          o.parts[1].setData(line(data, b.mid));
          o.parts[2].setData(line(data, b.lo));
        } else if (o.id === "st") {
          const t = S.supertrend(data, 10, 3);
          o.parts[0].setData(line(data, t.line.map((v, i) => (t.dir[i] === 1 ? v : null))));
          o.parts[1].setData(line(data, t.line.map((v, i) => (t.dir[i] === -1 ? v : null))));
        }
      }
      for (const [id, parts] of Object.entries(sr.panes)) {
        if (id === "rsi") parts[0].setData(line(data, S.rsi(closes, 14)));
        else if (id === "macd") {
          const m = S.macd(closes);
          parts[0].setData(data.map((b, i) => (m.hist[i] === null ? { time: b.time } : { time: b.time, value: m.hist[i], color: m.hist[i] >= 0 ? c.up : c.down })));
          parts[1].setData(line(data, m.line));
          parts[2].setData(line(data, m.signal));
        } else if (id === "stoch") {
          const s = S.stochastic(data, 14, 3);
          parts[0].setData(line(data, s.k));
          parts[1].setData(line(data, s.d));
        } else if (id === "adx") {
          const a = S.adx(data, 14);
          parts[0].setData(line(data, a.adx));
          parts[1].setData(line(data, a.pdi));
          parts[2].setData(line(data, a.mdi));
        } else if (id === "atr") parts[0].setData(line(data, S.atr(data, 14)));
        else if (id === "cci") parts[0].setData(line(data, S.cci(data, 20)));
        else if (id === "willr") parts[0].setData(line(data, S.williamsR(data, 14)));
        else if (id === "roc") parts[0].setData(line(data, S.roc(closes, 12)));
        else if (id === "obv") parts[0].setData(line(data, S.obv(data)));
      }
      if (sr.compare && compare.bars) {
        const byTime = new Map(compare.bars.map((b) => [b.time, b.close]));
        sr.compare.setData(data.filter((b) => byTime.has(b.time)).map((b) => ({ time: b.time, value: byTime.get(b.time) })));
      }
      sr.markers.setMarkers(
        showPatterns
          ? S.patterns(data)
              .filter((p) => p.kind !== "neutral") // dojis are everywhere: they would bury the chart
              .slice(-40)
              .map((p) => ({ time: p.time, position: p.kind === "bear" ? "aboveBar" : "belowBar", color: p.kind === "bull" ? c.up : p.kind === "bear" ? c.down : c.ink, shape: p.kind === "bull" ? "arrowUp" : "arrowDown", text: SHORT[p.text] || p.text }))
          : []
      );
      // pivot points from the previous session (intraday) or the previous bar
      if (sr.pivotLines) sr.pivotLines.forEach((pl) => sr.main.removePriceLine(pl));
      sr.pivotLines = [];
      if (showPivots && data.length > 2) {
        let prev;
        if (intraday) {
          const byDay = new Map();
          data.forEach((b) => {
            const d = Math.floor(b.time / 86400);
            const x = byDay.get(d);
            if (!x) byDay.set(d, { high: b.high, low: b.low, close: b.close });
            else Object.assign(x, { high: Math.max(x.high, b.high), low: Math.min(x.low, b.low), close: b.close });
          });
          const list = [...byDay.values()];
          prev = list.length >= 2 ? list[list.length - 2] : null;
        } else prev = data[data.length - 2];
        const pv = S.pivots(prev);
        if (pv)
          for (const [k, price] of Object.entries(pv)) {
            sr.pivotLines.push(sr.main.createPriceLine({ price, color: k === "p" ? c.accent : k.startsWith("r") ? c.down : c.up, lineStyle: LineStyle.Dotted, lineWidth: 1, axisLabelVisible: true, title: k.toUpperCase() }));
          }
      }
      if (fit && data.length) chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, data.length - (intraday ? 160 : 180)), to: data.length + 5 });
    },
    [type, intraday, compare.bars, showPatterns, showPivots]
  );

  // new data, or a new tick: refill without rebuilding (the view stays where it is)
  const lastFit = useRef("");
  useEffect(() => {
    // fit once the bars of the interval asked for have arrived — not to the previous interval's
    // bars that are still on screen while the new ones load
    const ready = raw.symbol === symbol && raw.kite === iv.kite;
    const key = `${symbol}|${iv.kite}|${iv.group || ""}|${type}`;
    fill(shown, ready && lastFit.current !== key);
    if (ready && shown.length) lastFit.current = key;
  }, [shown, fill, symbol, type, raw.symbol, raw.kite, iv.kite, iv.group]);

  /* ------------------------------------------------------------ drawings */
  useEffect(() => {
    const chart = chartRef.current;
    const sr = series.current;
    if (!chart || !sr.main) return;
    drawn.current.forEach((d) => (d.kind === "series" ? chart.removeSeries(d.obj) : sr.main.removePriceLine(d.obj)));
    drawn.current = [];
    const c = palette(box.current);
    for (const d of drawings) {
      if (d.type === "hline") drawn.current.push({ kind: "line", obj: sr.main.createPriceLine({ price: d.price, color: c.accent, lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: "" }) });
      else if (d.type === "trend" && d.a.time !== d.b.time) {
        const s = chart.addSeries(LineSeries, { color: c.accent, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, autoscaleInfoProvider: () => null });
        s.setData([d.a, d.b].sort((x, y) => x.time - y.time).map((p) => ({ time: p.time, value: p.price })));
        drawn.current.push({ kind: "series", obj: s });
      } else if (d.type === "fib") {
        const hi = Math.max(d.a.price, d.b.price);
        const lo = Math.min(d.a.price, d.b.price);
        const upMove = d.b.price > d.a.price;
        for (const f of FIB_LEVELS) {
          const price = upMove ? hi - (hi - lo) * f : lo + (hi - lo) * f;
          drawn.current.push({ kind: "line", obj: sr.main.createPriceLine({ price, color: f === 0.618 || f === 0.5 ? "#f5a623" : "#8e7cc3", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `${(f * 100).toFixed(1)}%` }) });
        }
      }
    }
  }, [drawings, buildKey]);

  // clicks on the chart feed the drawing tools
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return undefined;
    const onClick = (p) => {
      if (tool === "cursor" || !p || p.time === undefined || !p.point || !series.current.main) return;
      const price = series.current.main.coordinateToPrice(p.point.y);
      if (price === null) return;
      const pt = { time: p.time, price: Math.round(price * 100) / 100 };
      if (tool === "hline") {
        setDrawings((d) => [...d, { type: "hline", price: pt.price }]);
        return;
      }
      if (!pending) {
        setPending(pt);
        return;
      }
      if (tool === "measure") {
        const i0 = shown.findIndex((b) => b.time === pending.time);
        const i1 = shown.findIndex((b) => b.time === pt.time);
        setMeasure({ from: pending, to: pt, change: pt.price - pending.price, pct: ((pt.price - pending.price) / pending.price) * 100, bars: Math.abs(i1 - i0) });
      } else setDrawings((d) => [...d, { type: tool, a: pending, b: pt }]);
      setPending(null);
    };
    chart.subscribeClick(onClick);
    return () => chart.unsubscribeClick(onClick);
  }, [tool, pending, shown, buildKey]);

  /* --------------------------------------------------------------- legend */
  const at = legend !== null ? shown.find((b) => b.time === legend) : shown[shown.length - 1];
  const prevBar = at ? shown[shown.indexOf(at) - 1] : null;
  const chg = at && prevBar ? at.close - prevBar.close : null;

  const zoom = (factor) => {
    const chart = chartRef.current;
    if (!chart || !shown.length) return;
    const ts = chart.timeScale();
    const r = ts.getVisibleLogicalRange();
    if (!r) return;
    const width = r.to - r.from;
    const next = Math.max(10, Math.min(shown.length + 20, width * factor));
    ts.setVisibleLogicalRange({ from: r.to - next, to: r.to });
  };
  const resetView = () => {
    const chart = chartRef.current;
    if (!chart || !shown.length) return;
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, shown.length - (intraday ? 160 : 180)), to: shown.length + 5 });
    chart.priceScale("right").applyOptions({ autoScale: true });
  };
  const onKey = (e) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      zoom(0.7);
    } else if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      zoom(1 / 0.7);
    } else if (e.key === "0") {
      e.preventDefault();
      resetView();
    } else if (e.key === "Escape") {
      setTool("cursor");
      setPending(null);
    }
  };
  const newTab = adminPath(`/chart/${encodeURIComponent(symbol)}`);

  const toggleStudy = (id) => setStudies((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const shot = () => {
    const chart = chartRef.current;
    if (!chart) return;
    const canvas = chart.takeScreenshot();
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `${symbol}-${interval}-${new Date().toISOString().slice(0, 10)}.png`;
    a.click();
  };
  const goFull = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (box.current && box.current.requestFullscreen) box.current.requestFullscreen().catch(() => {});
  };
  const filtered = STUDIES.filter((s) => !query || s.label.toLowerCase().includes(query.toLowerCase()));
  const groups = [...new Set(filtered.map((s) => s.group))];
  const h = full ? "100%" : standalone ? undefined : height || undefined; // a page of its own sizes the plot in CSS

  return (
    <section className={`kc ${full ? "is-full" : ""} ${standalone ? "kc--page" : ""}`} ref={box} aria-label={`Chart of ${symbol}`}>
      <div className="kc__bar" role="toolbar" aria-label="Chart controls">
        <select className="kc__sel kc__ivsel" value={interval} onChange={(e) => setInterval_(e.target.value)} aria-label="Interval">
          {S.INTERVALS.map((x) => (
            <option key={x.id} value={x.id} disabled={!live && x.sec < 86400}>
              {x.label}
            </option>
          ))}
        </select>
        <div className="kc__iv kc__ivbtns" role="group" aria-label="Interval">
          {S.INTERVALS.map((x) => (
            <button key={x.id} type="button" aria-pressed={interval === x.id} disabled={!live && x.sec < 86400} onClick={() => setInterval_(x.id)} data-tip={x.sec < 86400 && !live ? "Intraday intervals need the Zerodha connection." : undefined}>
              {x.label}
            </button>
          ))}
        </div>
        <span className="kc__sep" />
        <select className="kc__sel" value={type} onChange={(e) => setType(e.target.value)} aria-label="Chart type">
          {CHART_TYPES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <div className="kc__menuwrap">
          <button type="button" className="kc__btn" aria-expanded={menu === "ind"} onClick={() => setMenu(menu === "ind" ? "" : "ind")}>
            ƒx Indicators{studies.length ? ` (${studies.length})` : ""}
          </button>
          {menu === "ind" && (
            <div className="kc__menu" role="dialog" aria-label="Indicators">
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search indicators" aria-label="Search indicators" />
              {groups.map((g) => (
                <div key={g}>
                  <b>{g}</b>
                  {filtered
                    .filter((s) => s.group === g)
                    .map((s) => (
                      <label key={s.id}>
                        <input type="checkbox" checked={studies.includes(s.id)} onChange={() => toggleStudy(s.id)} /> {s.label}
                      </label>
                    ))}
                </div>
              ))}
              <footer>
                <button type="button" onClick={() => setStudies([])}>
                  Clear all
                </button>
                <button type="button" onClick={() => setMenu("")}>
                  Done
                </button>
              </footer>
            </div>
          )}
        </div>
        <div className="kc__menuwrap">
          <button type="button" className="kc__btn" aria-expanded={menu === "cmp"} onClick={() => setMenu(menu === "cmp" ? "" : "cmp")} data-tip="Compare with another stock or index on a percent scale.">
            ⊕ Compare{compare.symbol ? `: ${compare.symbol}` : ""}
          </button>
          {menu === "cmp" && (
            <form
              className="kc__menu kc__menu--sm"
              onSubmit={(e) => {
                e.preventDefault();
                const v = new FormData(e.currentTarget).get("cmp");
                setCompare({ symbol: String(v || "").trim().toUpperCase(), bars: null, error: "" });
                setMenu("");
              }}
            >
              <input name="cmp" defaultValue={compare.symbol || "NIFTY 50"} placeholder="e.g. NIFTY 50 or INFY" aria-label="Symbol to compare" />
              <footer>
                <button type="button" onClick={() => {
                    setCompare({ symbol: "", bars: null, error: "" });
                    setMenu("");
                  }}>
                  Remove
                </button>
                <button type="submit">Compare</button>
              </footer>
            </form>
          )}
        </div>
        <div className="kc__menuwrap">
          <button type="button" className="kc__btn" aria-expanded={menu === "view"} onClick={() => setMenu(menu === "view" ? "" : "view")} data-tip="Candlestick patterns, pivot points and the price scale.">
            View{showPatterns || showPivots || scale !== "normal" ? " •" : ""}
          </button>
          {menu === "view" && (
            <div className="kc__menu kc__menu--sm" role="dialog" aria-label="View">
              <b>Marks</b>
              <label data-tip="Mark candlestick patterns: engulfing, hammer, shooting star, morning and evening star.">
                <input type="checkbox" checked={showPatterns} onChange={() => setShowPatterns((v) => !v)} /> Patterns
              </label>
              <label data-tip="Classic pivot points (P, R1–R3, S1–S3) from the previous session.">
                <input type="checkbox" checked={showPivots} onChange={() => setShowPivots((v) => !v)} /> Pivots
              </label>
              <b>Price scale</b>
              {[
                ["normal", "Auto"],
                ["log", "Log"],
                ["percent", "%"],
              ].map(([id, l]) => (
                <label key={id}>
                  <input type="radio" name="kc-scale" checked={scale === id} onChange={() => setScale(id)} /> {l === "%" ? "Percent (%)" : l === "Log" ? "Logarithmic (Log)" : "Auto"}
                </label>
              ))}
              <footer>
                <span />
                <button type="button" onClick={() => setMenu("")}>
                  Done
                </button>
              </footer>
            </div>
          )}
        </div>
        <span className="kc__grow" />
        <button type="button" className="kc__icon" onClick={() => chartRef.current && chartRef.current.timeScale().fitContent()} aria-label="Show all bars" data-tip="Zoom out to every bar loaded.">
          ⤢
        </button>
        <button type="button" className="kc__icon" onClick={shot} aria-label="Save a picture of the chart" data-tip="Save the chart as a PNG picture.">
          📷
        </button>
        <button type="button" className="kc__icon" onClick={goFull} aria-label={full ? "Leave full screen" : "Full screen"} data-tip="Full screen.">
          {full ? "⤡" : "⛶"}
        </button>
        {!standalone && (
          <a className="kc__icon" href={newTab} target="_blank" rel="noopener noreferrer" aria-label="Open this chart in a new tab" data-tip="Open this chart in a new tab, with every tool — like Kite's full chart.">
            ↗
          </a>
        )}
      </div>

      <div className="kc__body">
        <div className="kc__tools" role="toolbar" aria-label="Drawing tools">
          {TOOLS.map((t) => (
            <button key={t.id} type="button" aria-pressed={tool === t.id} onClick={() => {
                setTool(t.id);
                setPending(null);
                setMeasure(null);
              }} aria-label={t.label} data-tip={t.tip}>
              {t.icon}
            </button>
          ))}
          <button type="button" onClick={() => setDrawings((d) => d.slice(0, -1))} disabled={!drawings.length} aria-label="Undo the last drawing" data-tip="Undo the last drawing.">
            ↶
          </button>
          <button type="button" onClick={() => setDrawings([])} disabled={!drawings.length} aria-label="Remove all drawings" data-tip="Remove every drawing on this stock.">
            🗑
          </button>
        </div>
        <div className="kc__plot" style={{ height: h }} tabIndex={0} onKeyDown={onKey} aria-label={`${symbol} chart. Plus and minus zoom, 0 resets.`}>
          <div className="kc__zoom" role="group" aria-label="Zoom">
            <button type="button" onClick={() => zoom(1 / 0.7)} aria-label="Zoom out" data-tip="Zoom out (−)">
              −
            </button>
            <button type="button" onClick={() => zoom(0.7)} aria-label="Zoom in" data-tip="Zoom in (+)">
              +
            </button>
            <button type="button" onClick={resetView} aria-label="Reset the view" data-tip="Back to the latest bars, price scale on auto (0)">
              ⟲
            </button>
          </div>
          <div className="kc__legend" aria-live="off">
            <b>{symbol}</b>
            <span>{iv.label}</span>
            {at && (
              <>
                <span>
                  O <i>{fmt(at.open)}</i>
                </span>
                <span>
                  H <i>{fmt(at.high)}</i>
                </span>
                <span>
                  L <i>{fmt(at.low)}</i>
                </span>
                <span>
                  C <i className={chg > 0 ? "is-up" : chg < 0 ? "is-down" : ""}>{fmt(at.close)}</i>
                </span>
                {chg !== null && <em className={chg > 0 ? "is-up" : chg < 0 ? "is-down" : ""}>{`${chg > 0 ? "+" : ""}${fmt(chg)} (${chg > 0 ? "+" : ""}${fmt((chg / prevBar.close) * 100)}%)`}</em>}
                <span>
                  Vol <i>{fmtVol(at.volume)}</i>
                </span>
              </>
            )}
            {tick && live && <span className="kc__live">● live</span>}
          </div>
          {(pending || measure || compare.error || tool !== "cursor") && (
            <div className="kc__hint">
              {measure ? (
                <>
                  {measure.change > 0 ? "▲" : "▼"} {fmt(Math.abs(measure.change))} ({measure.pct > 0 ? "+" : ""}
                  {fmt(measure.pct)}%) over {measure.bars} bars
                  <button type="button" onClick={() => setMeasure(null)} aria-label="Close">
                    ×
                  </button>
                </>
              ) : compare.error ? (
                `Compare: ${compare.error}`
              ) : pending ? (
                "Now click the second point."
              ) : (
                (TOOLS.find((t) => t.id === tool) || {}).tip
              )}
            </div>
          )}
          <div className="kc__canvas" ref={holder} />
          {raw.loading && !raw.bars.length && <p className="kc__msg">Loading the chart…</p>}
          {raw.error && !raw.bars.length && <p className="kc__msg is-bad">{raw.error}</p>}
        </div>
      </div>
      <TechSummary bars={bars} interval={iv.label} />
      {/* the attribution the library's Apache-2.0 licence asks for (its NOTICE file), beside the logo link on the chart */}
      <p className="kc__credit">
        Chart: TradingView Lightweight Charts™, Copyright © 2025 TradingView, Inc.{" "}
        <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">
          tradingview.com
        </a>{" "}
        · Apache-2.0
      </p>
      {paneStudies.length > 0 && <p className="kc__note">Indicator panes sit under the price; drag the line between panes to resize them.</p>}
    </section>
  );
}
