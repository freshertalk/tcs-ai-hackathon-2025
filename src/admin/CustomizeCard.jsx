// Customize — on /me: make the private area yours. Every choice is applied at once and saved on the server, so it is
// the same on every device you sign in on (src/admin/prefs.js applies it; server/prefs.js checks and keeps it).
//
//   Look         dark or light, the accent colour, the text size, comfortable or compact, movement on or off
//   Workspaces   which ones the terminal shows, in what order, and which one "Open the terminal" opens
//   The Desk     whether the day board starts open, how the positions dock behaves, the chart it starts with
//   This page    which blocks /me shows
// A preference arranges and hides; it cannot open a workspace your role does not allow.

import React from "react";
import { useAuth } from "./auth";
import { arrangeViews, usePrefs } from "./prefs";
import { workspacesFor } from "./workspaces";
import { useDialog } from "./dialog/DialogProvider";

const ACCENTS = [
  ["blue", "Zerodha blue", "#4987ee"],
  ["teal", "Teal", "#45c7c0"],
  ["green", "Green", "#8fd16a"],
  ["amber", "Amber", "#e7b24a"],
  ["rose", "Rose", "#f08aa6"],
  ["violet", "Violet", "#a99cf6"],
];
const TEXTS = [
  ["small", "Small"],
  ["normal", "Normal"],
  ["large", "Large"],
  ["larger", "Larger"],
];
const DOCKS = [
  ["auto", "By itself", "Open only while it holds a position."],
  ["open", "Open", "Always open when the Desk opens."],
  ["closed", "Closed", "Always closed when the Desk opens."],
];
const CHARTS = [
  ["pro", "Full chart"],
  ["m1", "1 minute"],
  ["m5", "5 minutes"],
  ["daily", "Daily"],
];

/** A row of choices, one of which is on. */
function Seg({ label, value, options, onPick, tip }) {
  return (
    <div className="cz-seg" role="group" aria-label={label} data-tip={tip}>
      {options.map(([id, text, hint]) => (
        <button key={id} type="button" aria-pressed={value === id} onClick={() => value !== id && onPick(id)} data-tip={hint || undefined}>
          {text}
        </button>
      ))}
    </div>
  );
}

function Row({ label, hint, children }) {
  return (
    <div className="cz-row">
      <b className="cz-row__k">{label}</b>
      <div className="cz-row__v">{children}</div>
      {hint && <small className="cz-row__h">{hint}</small>}
    </div>
  );
}

function Check({ label, checked, onChange, disabled, tip }) {
  return (
    <label className="cz-check" data-tip={tip}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}

export default function CustomizeCard() {
  const { user } = useAuth();
  const { prefs, save, reset, saving, error, ready } = usePrefs();
  const ask = useDialog();
  const mine = workspacesFor(user);
  const hidden = new Set(prefs.nav.hidden);
  // the full list in your order (hidden ones keep their place, so showing one again puts it back where it was)
  const rank = new Map(prefs.nav.order.map((id, i) => [id, i]));
  const ordered = mine.map((w, i) => ({ w, r: rank.has(w.id) ? rank.get(w.id) : 1000 + i })).sort((a, b) => a.r - b.r).map((x) => x.w);
  const shown = arrangeViews(mine, prefs);

  const move = (id, by) => {
    const ids = ordered.map((w) => w.id);
    const i = ids.indexOf(id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    save({ nav: { order: ids } });
  };
  const toggle = (id, on) => {
    const next = new Set(hidden);
    if (on) next.delete(id);
    else next.add(id);
    const patch = { nav: { hidden: [...next] } };
    if (!on && prefs.start === id) patch.start = "analyzer"; // the terminal cannot open on a workspace you have hidden
    save(patch);
  };
  const restore = async () => {
    const yes = await ask({ title: "Put everything back?", body: "The look, the workspaces and their order, the Desk's start and this page go back to how the site came. Nothing else changes: no data, no settings, no account.", confirmText: "Put it back", cancelText: "Keep mine" });
    if (yes) reset();
  };

  return (
    <section className="hm-card cz" aria-labelledby="cz-h" data-jump="Customize">
      <div className="cz-head">
        <div>
          <h2 id="cz-h" className="hm-h">
            Customize
          </h2>
          <p>Make it yours. Each choice applies at once and is saved for every device you sign in on.</p>
        </div>
        <span className="cz-state" role="status">
          {error ? `Not saved: ${error}` : saving ? "Saving…" : ready ? "Saved" : "Reading…"}
        </span>
      </div>

      <div className="cz-grid">
        <div className="cz-box">
          <h3>Look</h3>
          <Row label="Theme">
            <Seg
              label="Theme"
              value={prefs.theme}
              onPick={(theme) => save({ theme })}
              options={[
                ["dark", "Dark"],
                ["light", "Light"],
              ]}
            />
          </Row>
          <Row label="Accent" hint="What is selected, linked or live. Green and red still mean up and down.">
            <div className="cz-swatches" role="group" aria-label="Accent colour">
              {ACCENTS.map(([id, name, hex]) => (
                <button key={id} type="button" aria-pressed={prefs.accent === id} aria-label={name} data-tip={name} style={{ "--sw": hex }} onClick={() => prefs.accent !== id && save({ accent: id })} />
              ))}
            </div>
          </Row>
          <Row label="Text size">
            <Seg label="Text size" value={prefs.text} onPick={(text) => save({ text })} options={TEXTS} />
          </Row>
          <Row label="Spacing" hint="Compact fits more on a screen; nothing is hidden.">
            <Seg
              label="Spacing"
              value={prefs.density}
              onPick={(density) => save({ density })}
              options={[
                ["comfortable", "Comfortable"],
                ["compact", "Compact"],
              ]}
            />
          </Row>
          <Row label="Movement">
            <Check label="Pages and cards ease into place" checked={prefs.motion} onChange={(motion) => save({ motion })} tip="Off stops every animation and transition." />
          </Row>
        </div>

        <div className="cz-box">
          <h3>Workspaces</h3>
          <p className="cz-note">Untick to hide one from the terminal; the arrows change the order. {shown.length} of {mine.length} shown.</p>
          <ol className="cz-list" aria-label="Workspaces, in the terminal's order">
            {ordered.map((w, i) => {
              const on = !hidden.has(w.id);
              return (
                <li key={w.id} className={on ? "" : "is-off"}>
                  <Check label={w.label} checked={on} disabled={w.id === "analyzer"} onChange={(v) => toggle(w.id, v)} tip={w.id === "analyzer" ? "The Desk is the way in: it is always shown." : undefined} />
                  <span className="cz-move">
                    <button type="button" aria-label={`Move ${w.label} up`} disabled={i === 0} onClick={() => move(w.id, -1)}>
                      ↑
                    </button>
                    <button type="button" aria-label={`Move ${w.label} down`} disabled={i === ordered.length - 1} onClick={() => move(w.id, 1)}>
                      ↓
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
          <Row label="Opens on" hint="Where “Open the terminal” takes you.">
            <select aria-label="The workspace the terminal opens on" value={prefs.start} onChange={(e) => save({ start: e.target.value })}>
              {shown.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label}
                </option>
              ))}
            </select>
          </Row>
        </div>

        <div className="cz-box">
          <h3>The Desk</h3>
          <Row label="Day board">
            <Check label="Open when the Desk opens" checked={prefs.desk.board} onChange={(board) => save({ desk: { board } }, { desk: true })} tip="Session, market, radar and your checklist, under the watchlist." />
          </Row>
          <Row label="Positions dock">
            <Seg label="Positions dock" value={prefs.desk.dock} onPick={(dock) => save({ desk: { dock } }, { desk: true })} options={DOCKS} />
          </Row>
          <Row label="Chart">
            <Seg label="The chart the Desk starts with" value={prefs.desk.chart} onPick={(chart) => save({ desk: { chart } }, { desk: true })} options={CHARTS} />
          </Row>
          <p className="cz-note">The Desk still remembers what you last did on a device; these are what a new device starts with, and what this one switches to now.</p>
          <h3>This page</h3>
          <div className="cz-checks">
            <Check label="Status row" checked={prefs.home.status} onChange={(status) => save({ home: { status } })} />
            <Check label="Today" checked={prefs.home.today} onChange={(today) => save({ home: { today } })} />
            <Check label="Workspaces" checked={prefs.home.workspaces} onChange={(workspaces) => save({ home: { workspaces } })} />
          </div>
        </div>
      </div>

      <div className="cz-foot">
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={restore} disabled={saving}>
          Put everything back
        </button>
        <small>Only looks and arrangement live here. Hiding a workspace does not switch anything off, and showing one cannot open what your role does not allow.</small>
      </div>
    </section>
  );
}
