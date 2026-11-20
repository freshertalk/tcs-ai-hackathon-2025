// The brand of the trading area: the DrishtiAI logo, the name "DrishtiAI" in the display face, and a small spaced line
// under it ("AI Trading Advisor"). Shown in the header of every private page (Shell.jsx) and in the terminal's top bar
// (TopBar.jsx). The public website keeps its own brand (the owner's photo and name).
import React from "react";
import { BRAND } from "./brand";
import DrishtiLogo from "./DrishtiLogo";
import "./brandmark.css";

export default function BrandMark({ kicker = BRAND.line, size = "" }) {
  return (
    <span className={`vk-brand ${size ? `vk-brand--${size}` : ""}`}>
      <span className="vk-brand__mark">
        <DrishtiLogo size={size === "sm" ? 34 : 38} aria-hidden="true" />
      </span>
      <span className="vk-brand__name">
        <span className="vk-brand__word">
          Drishti<b>AI</b>
        </span>
        {kicker && <small>{kicker}</small>}
      </span>
    </span>
  );
}
