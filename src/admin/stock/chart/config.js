// What the chart can show: chart types, indicators (on the price or in a pane of their own)
// and drawing tools. Kept apart from the component so the menus and the drawing code agree.

export const CHART_TYPES = [
  { id: "candles", label: "Candles" },
  { id: "hollow", label: "Hollow candles" },
  { id: "heikin", label: "Heikin-Ashi" },
  { id: "bars", label: "OHLC bars" },
  { id: "line", label: "Line" },
  { id: "area", label: "Area" },
  { id: "baseline", label: "Baseline" },
];

// overlays sit on the price; panes get a strip of their own under it
export const STUDIES = [
  { id: "vol", label: "Volume", group: "Volume", kind: "volume" },
  { id: "sma20", label: "SMA 20", group: "Moving averages", kind: "overlay", color: "#f5a623" },
  { id: "sma50", label: "SMA 50", group: "Moving averages", kind: "overlay", color: "#4a90e2" },
  { id: "sma200", label: "SMA 200", group: "Moving averages", kind: "overlay", color: "#bd10e0" },
  { id: "ema9", label: "EMA 9", group: "Moving averages", kind: "overlay", color: "#50e3c2" },
  { id: "ema20", label: "EMA 20", group: "Moving averages", kind: "overlay", color: "#7ed321" },
  { id: "ema50", label: "EMA 50", group: "Moving averages", kind: "overlay", color: "#f8e71c" },
  { id: "ema200", label: "EMA 200", group: "Moving averages", kind: "overlay", color: "#d0021b" },
  { id: "wma20", label: "WMA 20", group: "Moving averages", kind: "overlay", color: "#9b9b9b" },
  { id: "bb", label: "Bollinger Bands (20, 2)", group: "Bands & trend", kind: "overlay", color: "#8e7cc3" },
  { id: "vwap", label: "VWAP", group: "Bands & trend", kind: "overlay", color: "#ff6f61" },
  { id: "st", label: "Supertrend (10, 3)", group: "Bands & trend", kind: "overlay" },
  { id: "rsi", label: "RSI (14)", group: "Oscillators", kind: "pane", color: "#9c27b0" },
  { id: "macd", label: "MACD (12, 26, 9)", group: "Oscillators", kind: "pane" },
  { id: "stoch", label: "Stochastic (14, 3)", group: "Oscillators", kind: "pane" },
  { id: "cci", label: "CCI (20)", group: "Oscillators", kind: "pane", color: "#00897b" },
  { id: "willr", label: "Williams %R (14)", group: "Oscillators", kind: "pane", color: "#6d4c41" },
  { id: "roc", label: "Rate of change (12)", group: "Oscillators", kind: "pane", color: "#3949ab" },
  { id: "adx", label: "ADX / DMI (14)", group: "Trend strength", kind: "pane" },
  { id: "atr", label: "ATR (14)", group: "Trend strength", kind: "pane", color: "#ef6c00" },
  { id: "obv", label: "On-balance volume", group: "Volume", kind: "pane", color: "#5e35b1" },
];
export const studyOf = (id) => STUDIES.find((s) => s.id === id);
export const DEFAULT_STUDIES = ["vol", "ema20", "ema50"];

export const TOOLS = [
  { id: "cursor", label: "Cursor", icon: "↖", tip: "Point and read: the crosshair shows the bar under it." },
  { id: "hline", label: "Horizontal line", icon: "—", tip: "Click once to draw a horizontal line at that price." },
  { id: "trend", label: "Trend line", icon: "╱", tip: "Click two points to draw a trend line." },
  { id: "fib", label: "Fibonacci retracement", icon: "𝐅", tip: "Click a swing low and a swing high (or the reverse) to draw the retracement levels." },
  { id: "measure", label: "Measure", icon: "⇕", tip: "Click two points to measure the move: price, percent and bars." },
];
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
