// The brand of the private area, the same as the public site's navbar (src/components/site/Nav.jsx): Vinay's photo in a
// circle, his name in the display face, and a small spaced kicker under it — here the product's name.
import React from "react";
import Picture from "../components/ui/Picture";
import { BRAND } from "./brand";
import "./brandmark.css";

export default function BrandMark({ kicker = `${BRAND.name} · AI Trading Advisor`, size = "" }) {
  return (
    <span className={`vk-brand ${size ? `vk-brand--${size}` : ""}`}>
      <span className="vk-brand__mark">
        <Picture name="vinay-avatar-sm" alt="" width="200" height="200" loading="eager" aria-hidden="true" />
      </span>
      <span className="vk-brand__name">
        Vinay Kumar Tiwari
        {kicker && <small>{kicker}</small>}
      </span>
    </span>
  );
}
