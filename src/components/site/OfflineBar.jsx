// src/components/site/OfflineBar.jsx
// A thin notice while the device has no connection. Reading what is already
// on the device still works; anything that needs the collector will wait.

import React, { useEffect, useState } from "react";

export default function OfflineBar() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  if (online) return null;
  return (
    <div className="offline" role="status" aria-live="polite">
      इंटरनेट नहीं है — जो खुला है वह पढ़ सकते हैं; बाकी सब जुड़ने पर अपने-आप हो जाएगा।
    </div>
  );
}
