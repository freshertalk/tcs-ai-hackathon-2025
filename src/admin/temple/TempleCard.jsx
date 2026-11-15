// The Mandir card under Settings on the dashboard: the player's controls for everyone, and — for the
// superadmin — the choice of audio (upload a file, a link, YouTube), the default volume and autoplay.

import React, { useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { Alert } from "../ui";
import { useTemple, stateText, pct, VERSES } from "./Temple";

const PART = 2 * 1024 * 1024;
const hex16 = () => Array.from(window.crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
const mb = (n) => `${(n / (1024 * 1024)).toFixed(1)} MB`;

function Change({ t }) {
  const s = t.settings;
  const [link, setLink] = useState("");
  const [label, setLabel] = useState("");
  const [vol, setVol] = useState(Math.round((s ? s.volume : 0.15) * 100));
  const [auto, setAuto] = useState(s ? s.autoplay : true);
  const [busy, setBusy] = useState("");
  const [prog, setProg] = useState(0);
  const [msg, setMsg] = useState({ kind: "", text: "" });

  const save = async (body, ok, what) => {
    setBusy(what);
    setMsg({ kind: "", text: "" });
    try {
      const d = await api("/api/admin/temple", { method: "PUT", body });
      t.apply(d);
      setMsg({ kind: "ok", text: ok });
      if (body.link !== undefined) {
        setLink("");
        setLabel("");
      }
    } catch (e) {
      setMsg({ kind: "error", text: e.message });
    }
    setBusy("");
  };

  const upload = async (file) => {
    if (!file) return;
    if (file.size > 40 * 1024 * 1024) {
      setMsg({ kind: "error", text: `That file is ${mb(file.size)}; the limit is 40 MB.` });
      return;
    }
    setBusy("up");
    setMsg({ kind: "", text: "" });
    const id = hex16();
    const of = Math.max(1, Math.ceil(file.size / PART));
    try {
      let last = null;
      for (let i = 0; i < of; i += 1) {
        const body = file.slice(i * PART, Math.min(file.size, (i + 1) * PART));
        const q = new URLSearchParams({ id, part: String(i), of: String(of), name: file.name.slice(0, 120) });
        const res = await fetch(`/api/admin/temple/upload?${q}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/octet-stream", "X-Requested-With": "vpt", Accept: "application/json" }, body });
        const d = await res.json().catch(() => null);
        if (!res.ok) throw new Error((d && d.message) || `Upload failed (${res.status}).`);
        last = d;
        setProg(Math.round(((i + 1) / of) * 100));
      }
      if (last && last.settings) t.apply(last.settings);
      setMsg({ kind: "ok", text: `Uploaded “${file.name}” (${mb(file.size)}). It now plays on every page, from this server.` });
    } catch (e) {
      setMsg({ kind: "error", text: e.message });
    }
    setProg(0);
    setBusy("");
  };

  return (
    <details className="mdr-change">
      <summary>Change the audio, the default volume or autoplay</summary>
      <div className="mdr-change__grid">
        <section>
          <h4>Upload an audio file</h4>
          <p className="mdr-dim">MP3, M4A, OGG, WAV, WEBM or FLAC, up to 40 MB. Use a recording you own or are allowed to use. It is kept on this server and plays on every page; after the first play the browser keeps it, so it uses no more internet.</p>
          <label className={`adm-btn adm-btn--solid adm-btn--sm mdr-file ${busy ? "is-busy" : ""}`}>
            {busy === "up" ? `Uploading… ${prog}%` : "Choose a file"}
            <input type="file" accept="audio/*,.mp3,.m4a,.ogg,.wav,.webm,.flac" disabled={Boolean(busy)} onChange={(e) => upload(e.target.files && e.target.files[0])} />
          </label>
          {busy === "up" && (
            <div className="mdr-bar" role="progressbar" aria-valuenow={prog} aria-valuemin="0" aria-valuemax="100">
              <span style={{ width: `${prog}%` }} />
            </div>
          )}
        </section>
        <section>
          <h4>Or a link</h4>
          <p className="mdr-dim">A direct https link to an audio file, or a YouTube link. A YouTube video plays through YouTube’s own player (it streams from YouTube and must stay visible while it plays); its audio is never downloaded or copied.</p>
          <label className="mdr-field">
            <span>Link</span>
            <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://www.youtube.com/watch?v=… or https://…/bhajan.mp3" inputMode="url" />
          </label>
          <label className="mdr-field">
            <span>Name (optional)</span>
            <input value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} placeholder="Shri Hanuman Chalisa" />
          </label>
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={Boolean(busy) || !link.trim()} onClick={() => save({ link, label }, "The new audio is in place.", "link")}>
            {busy === "link" ? "Saving…" : "Use this link"}
          </button>
        </section>
        <section>
          <h4>For everyone</h4>
          <label className="mdr-field">
            <span>Default volume: {vol}%</span>
            <input type="range" min="0" max="100" step="1" value={vol} onChange={(e) => setVol(Number(e.target.value))} />
          </label>
          <label className="mdr-check">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Start by itself when a private page opens
          </label>
          <span className="mdr-actions">
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={Boolean(busy)} onClick={() => save({ volume: vol / 100, autoplay: auto }, "Saved.", "vol")}>
              {busy === "vol" ? "Saving…" : "Save"}
            </button>
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={Boolean(busy)} onClick={() => save({ reset: true }, "Back to Shri Hanuman Chalisa on YouTube.", "reset")}>
              Back to the default
            </button>
          </span>
          <p className="mdr-dim">A volume set with − and + on a device stays on that device.</p>
        </section>
      </div>
      <Alert kind={msg.kind === "ok" ? "ok" : "error"}>{msg.text}</Alert>
    </details>
  );
}

export default function TempleCard() {
  const t = useTemple();
  const { user } = useAuth() || {};
  if (!t || !t.ready) return null;
  const s = t.settings;
  const src = s.source || {};
  const playing = t.state === "playing";
  const isSuper = Boolean(user && user.role === "superadmin");
  const kindText = src.kind === "file" ? `uploaded file · ${mb(src.size || 0)} · plays from this server` : src.kind === "url" ? "audio link" : "YouTube · through YouTube’s own player";
  return (
    <section className={`mdr ${playing ? "is-on" : ""}`} aria-labelledby="mdr-h">
      <div className="mdr__top">
        <img className="mdr__img" src="/img/hanuman-icon-192.png" alt="" width="72" height="72" />
        <div className="mdr__main">
          <p className="mdr__k">मंदिर · Mandir</p>
          <h3 id="mdr-h">{src.label || "Shri Hanuman Chalisa"}</h3>
          <p className="mdr__state">
            <span className={`mdr__dot ${playing ? "is-on" : ""}`} aria-hidden="true" /> {stateText(t.state)} · volume {pct(t.volume)}
          </p>
          <p className="mdr-dim">{kindText}</p>
        </div>
        <div className="mdr__ctl">
          {t.state === "closed" ? (
            <button type="button" className="adm-btn adm-btn--solid adm-btn--sm" onClick={t.open}>
              Open the player
            </button>
          ) : (
            <>
              <button type="button" className="adm-btn adm-btn--solid adm-btn--sm" onClick={t.toggle}>
                {playing ? "Pause" : "Play"}
              </button>
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={t.volDown} aria-label="Volume down" disabled={t.volume <= 0}>
                −
              </button>
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={t.volUp} aria-label="Volume up" disabled={t.volume >= 1}>
                +
              </button>
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={t.close}>
                Close
              </button>
            </>
          )}
        </div>
      </div>
      <p className="mdr__verse" lang="hi">
        {VERSES[0]}
      </p>
      {t.error && <p className="mdr__err">{t.error}</p>}
      {s.missing && <p className="mdr__err">The uploaded file is missing from this server, so the default is playing. Upload it again.</p>}
      {src.kind === "youtube" && <p className="mdr-dim">To hear it on every page without streaming from YouTube, upload the audio file below{isSuper ? "" : " (the superadmin can do this)"}.</p>}
      {isSuper && <Change t={t} />}
    </section>
  );
}
