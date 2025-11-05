// src/theme.js
import { createTheme } from "@mui/material/styles";

export const buildTheme = (mode = "light") =>
  createTheme({
    palette: {
      mode,
      primary: { main: "#2563EB" },
      secondary: { main: "#10B981" },
      background:
        mode === "dark"
          ? { default: "#0B0F1A", paper: "#0F1524" }
          : { default: "#F7F9FC", paper: "#FFFFFF" },
    },
    shape: { borderRadius: 16 },
    typography: {
      fontFamily:
        "Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
      h1: { fontWeight: 800, letterSpacing: "-0.02em" },
      h2: { fontWeight: 800, letterSpacing: "-0.02em" },
      h3: { fontWeight: 700 },
      h4: { fontWeight: 700 },
      h5: { fontWeight: 700 },
      h6: { fontWeight: 600 },
      button: { textTransform: "none", fontWeight: 700 },
    },
    components: {
      MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
      MuiButton: { defaultProps: { disableElevation: true } },
      MuiChip: { styleOverrides: { root: { fontWeight: 600 } } },
      MuiLink: { defaultProps: { underline: "hover" } },
      MuiCssBaseline: {
        styleOverrides: {
          ":root": { colorScheme: mode },
          "html, body, #root": { height: "100%" },
          "a:focus-visible, button:focus-visible": {
            outline: `3px solid ${mode === "dark" ? "#8ab4f8" : "#2563EB"}`,
            outlineOffset: 2,
            borderRadius: 8,
          },
          "::-moz-selection": { background: "#bfdbfe" },
          "::selection": { background: "#bfdbfe" },
        },
      },
    },
  });

// Global styles you can pass into <GlobalStyles styles={globalStyles} />
export const globalStyles = {
  html: { scrollBehavior: "smooth" },
  "@media (prefers-reduced-motion: reduce)": {
    html: { scrollBehavior: "auto" },
  },
};

export default buildTheme;
