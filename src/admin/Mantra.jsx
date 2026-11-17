import React from "react";
import { HANUMAN_BEEJ } from "./mantraText";

/** The mantra strip: red on white. `className` places it (tm-mantra in the terminal's bar, adm-mantra in the page header). */
export default function Mantra({ className = "" }) {
  return (
    <p className={className} lang="hi" aria-label={`हनुमान बीज मंत्र: ${HANUMAN_BEEJ}`}>
      <b>{HANUMAN_BEEJ}</b>
    </p>
  );
}
