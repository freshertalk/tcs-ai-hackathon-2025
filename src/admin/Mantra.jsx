import React from "react";
import { HANUMAN_BEEJ } from "./mantraText";

/**
 * The mantra: a white pill with red text that hugs the words, centred in the blank space of the header.
 * `className` places the (invisible) frame that takes the blank space: tm-mantra in the terminal's bar, adm-mantra in the
 * page header. The pill itself is the <b>.
 */
export default function Mantra({ className = "" }) {
  return (
    <p className={className} lang="hi" aria-label={`हनुमान बीज मंत्र: ${HANUMAN_BEEJ}`}>
      <b>{HANUMAN_BEEJ}</b>
    </p>
  );
}
