import { iconFor } from "./ButtonIcons";

test("each button's words call for their icon; symbols and unknown words get none", () => {
  const pairs = [
    ["Save", "save"], ["Save password", "save"], ["Refresh", "refresh"], ["Check sources", "refresh"], ["Download CSV", "download"], ["Import a tradebook", "upload"],
    ["Delete", "trash"], ["Sure? Delete", "trash"], ["+ Add my learning", "plus"], ["Add learning", "plus"], ["Edit", "edit"], ["Cancel", "close"], ["Not now", "close"],
    ["Open positions", "open"], ["Sign out of every device", "logout"], ["Log in to Kite", "login"], ["Write with AI", "sparkle"], ["Review this range", "sparkle"],
    ["Copy", "copy"], ["Email me the link", "send"], ["Measure MAE / MFE", "play"], ["Print", "print"], ["Got it", "save"], ["Save this view", "save"],
  ];
  for (const [t, ico] of pairs) expect([t, iconFor(t)]).toEqual([t, ico]);
  for (const t of ["×", "?", "☾", "‹", "", "Intraday", "Both"]) expect([t, iconFor(t)]).toEqual([t, ""]);
});
