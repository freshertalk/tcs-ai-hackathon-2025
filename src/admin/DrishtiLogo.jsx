// The DrishtiAI logo: the sun's eye — an eye (drishti means "sight") inside a sun of twelve rays, whose pupil is a rising
// price path, in ruby, copper and gold (28 Nov 2026; before it, the same eye on a dark-blue badge). ONE drawing —
// public/drishti-logo.svg — used wherever the trading area shows its mark: the header of every private page, the
// terminal's top bar, the /me page, TradeAI's avatar, the browser tab's icon and the link previews. Change the file and
// it changes everywhere. It carries its own ruby badge with a gold rim, so it reads the same on the dark theme and the light one.
import React from "react";

// ?v=… changes with each new drawing, so a browser that kept the old one for its hour fetches the new one at once
export const LOGO_SRC = "/drishti-logo.svg?v=2";

export default function DrishtiLogo({ size = 36, className = "", ...rest }) {
  return <img className={`dr-logo ${className}`.trim()} src={LOGO_SRC} alt="" width={size} height={size} decoding="async" draggable="false" {...rest} />;
}
