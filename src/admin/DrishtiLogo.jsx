// The DrishtiAI logo: an eye (drishti means "sight") whose pupil is a rising price path. ONE drawing —
// public/drishti-logo.svg — used wherever the trading area shows its mark: the header of every private page, the
// terminal's top bar, the /me page, TradeAI's avatar, the browser tab's icon and the link previews. Change the file and
// it changes everywhere. It carries its own dark badge, so it reads the same on the dark theme and the light one.
import React from "react";

export const LOGO_SRC = "/drishti-logo.svg";

export default function DrishtiLogo({ size = 36, className = "", ...rest }) {
  return <img className={`dr-logo ${className}`.trim()} src={LOGO_SRC} alt="" width={size} height={size} decoding="async" draggable="false" {...rest} />;
}
