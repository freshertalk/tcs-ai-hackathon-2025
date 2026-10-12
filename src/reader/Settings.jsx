// src/reader/Settings.jsx
// "Aa" — everything that changes how the text looks, in one panel.
// A popover on desktop, a bottom sheet on phones.

import React, { useEffect } from "react";
import { THEMES, WIDTHS, LINES, SIZE, TURNS } from "./prefs";
import { IconClose, IconScroll, IconPages } from "./icons";
import { AccountPanel } from "../auth/Account";
import { authConfigured } from "../auth/google";

function Seg({ label, value, options, onChange }) {
  return (
    <div className="set__row">
      <span className="set__label">{label}</span>
      <div className="seg" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={String(o.id)}
            type="button"
            role="radio"
            aria-checked={value === o.id}
            className={value === o.id ? "is-on" : ""}
            onClick={() => onChange(o.id)}
          >
            {o.icon}
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Settings({ prefs, update, reset, onClose, canFullscreen, fullscreen, onFullscreen }) {
  useEffect(() => {
    const prev = document.activeElement;
    return () => prev && prev.focus && prev.focus({ preventScroll: true });
  }, []);

  return (
    <div className="rdp rdp--right" role="dialog" aria-modal="true" aria-label="पढ़ने की सेटिंग">
      <div className="rdp__head">
        <h2 className="rdp__title">पढ़ने की सेटिंग</h2>
        <button type="button" className="rdp__x" onClick={onClose} aria-label="बंद करें">
          <IconClose />
        </button>
      </div>

      <div className="rdp__scroll set" data-lenis-prevent>
        {authConfigured && (
          <div className="set__row set__row--acct">
            <AccountPanel compact />
          </div>
        )}

        {/* reading mode */}
        <Seg
          label="पढ़ने का ढंग"
          value={prefs.mode}
          onChange={(mode) => update({ mode })}
          options={[
            { id: "scroll", label: "स्क्रॉल", icon: <IconScroll width={18} height={18} /> },
            { id: "paged", label: "पन्ने", icon: <IconPages width={18} height={18} /> },
          ]}
        />

        {/* theme */}
        <div className="set__row">
          <span className="set__label">रंग</span>
          <div className="swatches" role="radiogroup" aria-label="रंग">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={prefs.theme === t.id}
                className={`swatch ${prefs.theme === t.id ? "is-on" : ""}`}
                onClick={() => update({ theme: t.id })}
                title={t.note}
              >
                <i style={{ background: t.bg, color: t.fg }}>अ</i>
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* size */}
        <div className="set__row">
          <span className="set__label">
            अक्षर का आकार <b>{prefs.size}</b>
          </span>
          <div className="size">
            <button
              type="button"
              className="size__btn"
              onClick={() => update({ size: Math.max(SIZE.min, prefs.size - 1) })}
              aria-label="अक्षर छोटे करें"
              disabled={prefs.size <= SIZE.min}
            >
              <span style={{ fontSize: 15 }}>अ</span>
            </button>
            <input
              type="range"
              min={SIZE.min}
              max={SIZE.max}
              step={SIZE.step}
              value={prefs.size}
              onChange={(e) => update({ size: Number(e.target.value) })}
              aria-label="अक्षर का आकार"
            />
            <button
              type="button"
              className="size__btn"
              onClick={() => update({ size: Math.min(SIZE.max, prefs.size + 1) })}
              aria-label="अक्षर बड़े करें"
              disabled={prefs.size >= SIZE.max}
            >
              <span style={{ fontSize: 24 }}>अ</span>
            </button>
          </div>
        </div>

        <Seg
          label="पंक्तियों के बीच"
          value={prefs.line}
          onChange={(line) => update({ line })}
          options={LINES}
        />
        <Seg
          label="पाठ की चौड़ाई"
          value={prefs.width}
          onChange={(width) => update({ width })}
          options={WIDTHS}
        />
        <Seg
          label="संरेखण"
          value={prefs.align}
          onChange={(align) => update({ align })}
          options={[
            { id: "left", label: "बाएँ" },
            { id: "justify", label: "दोनों ओर" },
          ]}
        />

        {/* light: the brightness and warm-light controls of a reading device */}
        <div className="set__row">
          <span className="set__label">
            चमक <b>{Math.round(prefs.brightness * 100)}%</b>
          </span>
          <input
            type="range"
            className="set__slide"
            min={35}
            max={100}
            step={1}
            value={Math.round(prefs.brightness * 100)}
            onChange={(e) => update({ brightness: Number(e.target.value) / 100 })}
            aria-label="चमक"
          />
        </div>
        <div className="set__row">
          <span className="set__label">
            गर्म रोशनी <b>{Math.round(prefs.warm * 100)}%</b>
          </span>
          <input
            type="range"
            className="set__slide set__slide--warm"
            min={0}
            max={100}
            step={1}
            value={Math.round(prefs.warm * 100)}
            onChange={(e) => update({ warm: Number(e.target.value) / 100 })}
            aria-label="गर्म रोशनी"
          />
        </div>

        <div className="set__row set__row--switch">
          <span className="set__label">गाढ़े अक्षर</span>
          <button
            type="button"
            role="switch"
            aria-checked={prefs.bold}
            className={`switch ${prefs.bold ? "is-on" : ""}`}
            onClick={() => update({ bold: !prefs.bold })}
          >
            <span />
          </button>
        </div>

        {prefs.mode === "paged" && (
          <>
            <Seg
              label="पन्ना कैसे पलटे"
              value={prefs.turn}
              onChange={(turn) => update({ turn })}
              options={TURNS}
            />
            <div className="set__row set__row--switch">
              <span className="set__label">पन्ने की सरसराहट</span>
              <button
                type="button"
                role="switch"
                aria-checked={prefs.sound}
                className={`switch ${prefs.sound ? "is-on" : ""}`}
                onClick={() => update({ sound: !prefs.sound })}
              >
                <span />
              </button>
            </div>
            {"vibrate" in navigator && (
              <div className="set__row set__row--switch">
                <span className="set__label">पलटते समय हल्का कंपन</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={prefs.haptic}
                  className={`switch ${prefs.haptic ? "is-on" : ""}`}
                  onClick={() => update({ haptic: !prefs.haptic })}
                >
                  <span />
                </button>
              </div>
            )}
          </>
        )}

        {"wakeLock" in navigator && (
          <div className="set__row set__row--switch">
            <span className="set__label">पढ़ते समय स्क्रीन चालू रखें</span>
            <button
              type="button"
              role="switch"
              aria-checked={prefs.awake}
              className={`switch ${prefs.awake ? "is-on" : ""}`}
              onClick={() => update({ awake: !prefs.awake })}
            >
              <span />
            </button>
          </div>
        )}

        <div className="set__foot">
          {canFullscreen && (
            <button type="button" className="set__link" onClick={onFullscreen}>
              {fullscreen ? "पूर्ण-स्क्रीन से बाहर" : "पूर्ण-स्क्रीन"}
            </button>
          )}
          <button type="button" className="set__link" onClick={reset}>
            सेटिंग फिर से तय करें
          </button>
        </div>

        <p className="set__keys">
          कुंजियाँ: <kbd>←</kbd> <kbd>→</kbd> पन्ना/अध्याय · <kbd>T</kbd> अनुक्रम · <kbd>S</kbd> खोज ·{" "}
          <kbd>A</kbd> सेटिंग · <kbd>B</kbd> बुकमार्क · <kbd>+</kbd> <kbd>−</kbd> आकार · <kbd>Esc</kbd> बार छुपाएँ ·
          अनुच्छेद को दबाकर रखें: रेखांकन/टिप्पणी
        </p>
      </div>
    </div>
  );
}
