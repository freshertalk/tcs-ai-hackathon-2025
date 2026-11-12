import React from "react";

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": "true",
};

export const IconKey = () => (
  <svg {...base}>
    <circle cx="8" cy="15" r="4" />
    <path d="m11 12 8-8M16 7l3 3M14 9l2 2" />
  </svg>
);
export const IconUsers = () => (
  <svg {...base}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.900 2.100 6.500 5.500" />
    <path d="M16 4.700a3.500 3.500 0 0 1 0 6.600M18 14.800c1.800.7 3 2.400 3.500 5.200" />
  </svg>
);
export const IconChart = () => (
  <svg {...base}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </svg>
);
export const IconGlobe = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.600 2.600 3.900 5.600 3.900 9s-1.300 6.400-3.900 9c-2.600-2.600-3.900-5.600-3.900-9S9.400 5.600 12 3z" />
  </svg>
);
export const IconArrow = () => (
  <svg {...base} strokeWidth={2}>
    <path d="M7 17 17 7M8 7h9v9" />
  </svg>
);
export const IconShield = () => (
  <svg {...base}>
    <path d="M12 3 4.500 6v5.500c0 4.500 3.100 8 7.500 9.500 4.400-1.500 7.500-5 7.500-9.500V6L12 3z" />
    <path d="m9 12 2.200 2.200L15 10.500" />
  </svg>
);
export const IconGoogle = () => (
  <svg viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.500c3.540 0 6.710 1.220 9.210 3.600l6.850-6.850C35.900 2.380 30.470 0 24 0 14.620 0 6.510 5.380 2.560 13.220l7.980 6.190C12.430 13.720 17.740 9.500 24 9.500z" />
    <path fill="#4285F4" d="M46.980 24.550c0-1.570-.15-3.090-.38-4.550H24v9.020h12.940c-.58 2.960-2.260 5.480-4.780 7.180l7.730 6c4.510-4.180 7.090-10.360 7.090-17.650z" />
    <path fill="#FBBC05" d="M10.530 28.590A14.500 14.500 0 0 1 9.500 24c0-1.590.28-3.140.76-4.590l-7.980-6.190A23.990 23.990 0 0 0 0 24c0 3.770.9 7.350 2.560 10.780l7.970-6.190z" />
    <path fill="#34A853" d="M24 48c6.480 0 11.930-2.130 15.890-5.810l-7.730-6c-2.150 1.450-4.920 2.300-8.160 2.300-6.260 0-11.570-4.220-13.470-9.910l-7.980 6.190C6.510 42.620 14.620 48 24 48z" />
  </svg>
);
export const IconClock = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.500 2" />
  </svg>
);
