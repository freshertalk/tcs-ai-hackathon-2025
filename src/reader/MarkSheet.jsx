// src/reader/MarkSheet.jsx
// What opens when a paragraph is pressed and held: pick a colour, write a
// note, or take the mark off. It sits where the settings panel does — a small
// card on wide screens, a bottom sheet on phones.

import React, { useEffect, useRef, useState } from "react";
import { HL_COLORS } from "./annotations";
import { IconClose, IconTrash } from "./icons";

export default function MarkSheet({ text, mark, onColor, onNote, onRemove, onClose }) {
  const [note, setNote] = useState(mark ? mark.note || "" : "");
  const saved = useRef(mark ? mark.note || "" : "");
  const latest = useRef(note);
  latest.current = note;
  const onNoteRef = useRef(onNote);
  onNoteRef.current = onNote;

  // save as they type, and once more when the card goes away
  useEffect(() => {
    if (note === saved.current) return undefined;
    const t = setTimeout(() => {
      saved.current = note;
      onNoteRef.current(note);
    }, 350);
    return () => clearTimeout(t);
  }, [note]);

  useEffect(
    () => () => {
      if (latest.current !== saved.current) onNoteRef.current(latest.current);
    },
    []
  );

  const color = mark ? mark.color : "y";
  const snippet = text.length > 150 ? `${text.slice(0, 150)}…` : text;

  return (
    <div className="rdp rdp--right mk" role="dialog" aria-modal="true" aria-label="चिह्न और टिप्पणी">
      <div className="rdp__head">
        <h2 className="rdp__title">चिह्न</h2>
        <button type="button" className="rdp__x" onClick={onClose} aria-label="बंद करें">
          <IconClose />
        </button>
      </div>

      <div className="rdp__scroll mk__body" data-lenis-prevent>
        <p className={`mk__quote hl-${color}`} lang="hi">
          {snippet}
        </p>

        <div className="mk__colors" role="radiogroup" aria-label="रंग">
          {HL_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={color === c.id}
              aria-label={c.label}
              title={c.label}
              className={`mk__dot mk__dot--${c.id} ${color === c.id ? "is-on" : ""}`}
              onClick={() => onColor(c.id)}
            />
          ))}
        </div>

        <label className="mk__label" htmlFor="mk-note">
          आपकी टिप्पणी
        </label>
        <textarea
          id="mk-note"
          className="mk__note"
          rows={4}
          lang="hi"
          placeholder="यहाँ कुछ लिखिए…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        <div className="mk__actions">
          <button type="button" className="rd__btn rd__btn--ghost" onClick={onRemove}>
            <IconTrash width={18} height={18} /> हटाएँ
          </button>
          <button type="button" className="rd__btn" onClick={onClose}>
            हो गया
          </button>
        </div>
      </div>
    </div>
  );
}
