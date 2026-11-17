// The Mandir card under Settings on the dashboard: the player for everyone — play, pause, previous, next,
// volume, the Auto switch, the list of files (tap one to play it) and, for a video, its picture on request
// — and, for the superadmin, adding files (several at once, uploaded one after another), putting the list
// in order, removing files, a link instead, the default volume and starting by itself.

import React, { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { useDialog } from "../dialog/DialogProvider";
import { Alert } from "../ui";
import { useTemple, stateText, pct, VERSES, DEFAULT_VOLUME } from "./Temple";

const PART = 2 * 1024 * 1024;
const hex16 = () => Array.from(window.crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
const mb = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : n >= 1024 * 1024 * 1024 ? `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB` : `${(n / (1024 * 1024)).toFixed(1)} MB`);
const MEDIA_ACCEPT = "audio/*,video/*,.mp3,.m4a,.ogg,.wav,.webm,.flac,.mp4,.m4v,.mov,.mkv";

/** Upload one file in 2 MB parts; returns the server's last answer. */
async function sendFile(file, onPct) {
  const id = hex16();
  const of = Math.max(1, Math.ceil(file.size / PART));
  let last = null;
  for (let i = 0; i < of; i += 1) {
    const body = file.slice(i * PART, Math.min(file.size, (i + 1) * PART));
    const q = new URLSearchParams({ id, part: String(i), of: String(of), name: file.name.slice(0, 120), type: file.type || "" });
    const res = await fetch(`/api/admin/temple/upload?${q}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/octet-stream", "X-Requested-With": "vpt", Accept: "application/json" }, body });
    const d = await res.json().catch(() => null);
    if (!res.ok) throw new Error((d && d.message) || `Upload failed (${res.status}).`);
    last = d;
    onPct(Math.round(((i + 1) / of) * 100));
  }
  return last;
}

/** Add files: pick several; they upload one after another and join the end of the list. */
function AddFiles({ t }) {
  const [queue, setQueue] = useState([]); // { key, name, size, state: waiting|uploading|done|error, pct, error }
  const busy = queue.some((x) => x.state === "waiting" || x.state === "uploading");
  const limits = (t.settings && t.settings.limits) || { maxFile: 200 * 1024 * 1024 };
  const pick = async (files) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    const stamp = Date.now();
    const items = list.map((f, i) => ({ key: `${stamp}-${i}`, file: f, name: f.name, size: f.size, state: f.size > limits.maxFile ? "error" : "waiting", pct: 0, error: f.size > limits.maxFile ? `${mb(f.size)} — the limit is ${mb(limits.maxFile)}` : "" }));
    setQueue((q) => [...q.filter((x) => x.state !== "done"), ...items.map(({ file, ...x }) => x)]);
    for (const it of items) {
      if (it.state === "error") continue;
      const upd = (patch) => setQueue((q) => q.map((x) => (x.key === it.key ? { ...x, ...patch } : x)));
      upd({ state: "uploading" });
      try {
        const d = await sendFile(it.file, (p) => upd({ pct: p }));
        upd({ state: "done", pct: 100 });
        if (d && d.settings) t.apply(d.settings);
      } catch (e) {
        upd({ state: "error", error: e.message });
      }
    }
  };
  return (
    <div className="mdr-add">
      <label className={`adm-btn adm-btn--solid adm-btn--sm mdr-file ${busy ? "is-busy" : ""}`} data-tip="Pick one or many audio or video files. They upload one after another and join the end of the list.">
        {busy ? "Uploading…" : "＋ Add files"}
        <input type="file" multiple accept={MEDIA_ACCEPT} disabled={busy} onChange={(e) => pick(e.target.files).then(() => (e.target.value = ""))} />
      </label>
      {queue.length > 0 && (
        <ul className="mdr-queue" aria-label="Uploads">
          {queue.map((x) => (
            <li key={x.key} className={`is-${x.state}`}>
              <span className="mdr-queue__name">{x.name}</span>
              <small>
                {x.state === "uploading" ? `${x.pct}%` : x.state === "waiting" ? "waiting" : x.state === "done" ? "added ✓" : x.error} · {mb(x.size)}
              </small>
              {x.state === "uploading" && (
                <span className="mdr-bar" role="progressbar" aria-valuenow={x.pct} aria-valuemin="0" aria-valuemax="100">
                  <span style={{ width: `${x.pct}%` }} />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The list of uploaded files: tap to play; the owner can move and remove. */
function Playlist({ t, isSuper }) {
  const ask = useDialog();
  const [err, setErr] = useState("");
  const s = t.settings;
  const lib = (s && s.library) || [];
  const listPlaying = s && s.source && s.source.kind === "library";
  const call = async (url, opts) => {
    setErr("");
    try {
      const d = await api(url, opts);
      t.apply(d);
    } catch (e) {
      setErr(e.message);
    }
  };
  const move = (i, dir) => {
    const ids = lib.map((x) => x.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    call("/api/admin/temple/library/order", { method: "PUT", body: { ids } });
  };
  const remove = async (x) => {
    const yes = await ask({ tone: "danger", title: "Remove this file?", body: `“${x.label}” is taken out of the list and deleted from the server.`, confirmText: "Remove it", cancelText: "Keep it" });
    if (yes) call(`/api/admin/temple/library/${encodeURIComponent(x.id)}`, { method: "DELETE" });
  };
  if (!lib.length) return isSuper ? <p className="mdr-dim">No files yet. Add one or more bhajans — audio or video — and they play here one after another.</p> : null;
  return (
    <div className="mdr-listwrap">
      <ol className="mdr-list" aria-label="Uploaded files">
        {lib.map((x, i) => {
          const on = listPlaying && t.current && t.current.id === x.id;
          return (
            <li key={x.id} className={`mdr-row ${on ? "is-on" : ""}`}>
              <button type="button" className="mdr-row__play" onClick={() => (listPlaying ? t.playItem(x.id) : call("/api/admin/temple", { method: "PUT", body: { useLibrary: true } }))} disabled={!listPlaying && !isSuper} aria-label={`Play ${x.label}`} aria-current={on ? "true" : undefined}>
                <span className="mdr-row__n">{on && t.state === "playing" ? "♪" : i + 1}</span>
                <span className="mdr-row__icon" aria-hidden="true">
                  {x.kind === "video" ? "🎬" : "🎵"}
                </span>
                <span className="mdr-row__t">
                  <b>{x.label}</b>
                  <small>
                    {x.kind} · {mb(x.size)}
                    {on ? ` · ${t.state === "playing" ? "playing" : stateText(t.state).toLowerCase()}` : ""}
                  </small>
                </span>
              </button>
              {isSuper && (
                <span className="mdr-row__tools">
                  <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${x.label} up`} data-tip="Earlier in the list">
                    ↑
                  </button>
                  <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => move(i, 1)} disabled={i === lib.length - 1} aria-label={`Move ${x.label} down`} data-tip="Later in the list">
                    ↓
                  </button>
                  <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => remove(x)} aria-label={`Remove ${x.label}`} data-tip="Remove from the list and the server">
                    ✕
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <p className="mdr-dim">
        {lib.length} file{lib.length === 1 ? "" : "s"} · {mb(s.usedBytes || 0)} of {mb((s.limits && s.limits.maxTotal) || 0)}
        {!listPlaying && " · the list is not playing now (a link is the source)"}
      </p>
      {err && <p className="mdr__err">{err}</p>}
    </div>
  );
}

/** An Auto ON/OFF switch. */
function AutoSwitch({ t }) {
  const many = t.items.length > 1;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={t.auto}
      className={`mdr-switch ${t.auto ? "is-on" : ""}`}
      onClick={() => t.setAuto(!t.auto)}
      disabled={!many}
      data-tip={many ? "Auto ON: every file plays one after another, then the list starts again. Auto OFF: the file playing repeats." : "Add a second file to play them one after another."}
    >
      <span className="mdr-switch__track" aria-hidden="true">
        <span className="mdr-switch__thumb" />
      </span>
      <span>
        Auto <b>{t.auto ? "ON" : "OFF"}</b>
      </span>
    </button>
  );
}

/** A video's picture, inside the card — the same element that plays it as sound. */
function VideoBox({ t }) {
  const box = useRef(null);
  const [shown, setShown] = useState(false);
  const isVideo = Boolean(t.current && t.current.kind === "video");
  const { showVideo, hideVideo } = t;
  useEffect(() => {
    if (shown && isVideo && box.current) showVideo(box.current);
    else hideVideo();
  }, [shown, isVideo, showVideo, hideVideo]);
  useEffect(() => () => hideVideo(), [hideVideo]);
  // the box stays mounted, so moving from a video to an audio file never tears the player out of the page
  return (
    <div className={`mdr-video ${isVideo ? "" : "is-none"}`}>
      {isVideo && (
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setShown((v) => !v)} aria-expanded={shown}>
          {shown ? "Hide video" : "Show video"}
        </button>
      )}
      <div className={`mdr-video__box ${shown && isVideo ? "is-on" : ""}`} ref={box} />
    </div>
  );
}

function Change({ t }) {
  const s = t.settings;
  const [link, setLink] = useState("");
  const [label, setLabel] = useState("");
  const [vol, setVol] = useState(Math.round((s && Number.isFinite(s.volume) ? s.volume : DEFAULT_VOLUME) * 100));
  const [autoplay, setAutoplay] = useState(s ? s.autoplay : true);
  const [busy, setBusy] = useState("");
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

  return (
    <details className="mdr-change">
      <summary>A link instead, the default volume or starting by itself</summary>
      <div className="mdr-change__grid">
        <section>
          <h4>Or a link</h4>
          <p className="mdr-dim">A direct https link to an audio file (it plays in the background). A YouTube link is kept only as a link: YouTube’s rules do not allow its sound to be played without its video, or to be downloaded. The uploaded list stays and can be played again.</p>
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
            <input type="checkbox" checked={autoplay} onChange={(e) => setAutoplay(e.target.checked)} /> Start by itself when a private page opens
          </label>
          <span className="mdr-actions">
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={Boolean(busy)} onClick={() => save({ volume: vol / 100, autoplay }, "Saved.", "vol")}>
              {busy === "vol" ? "Saving…" : "Save"}
            </button>
            {s.library && s.library.length > 0 && s.source.kind !== "library" && (
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={Boolean(busy)} onClick={() => save({ useLibrary: true }, "The uploaded list is playing again.", "lib")}>
                Play the uploaded list
              </button>
            )}
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={Boolean(busy)} onClick={() => save({ reset: true }, "Back to Shri Hanuman Chalisa on YouTube (the uploaded files are kept).", "reset")}>
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
  const cur = t.current;
  const title = cur ? cur.label : src.label || "Shri Hanuman Chalisa";
  const kindText =
    src.kind === "library"
      ? `${t.items.length > 1 ? `file ${t.index + 1} of ${t.items.length}` : "uploaded file"}${cur ? ` · ${cur.kind}` : ""} · plays from this server, in the background${t.items.length > 1 ? (t.auto ? " · Auto: one after another" : " · Auto off: this one repeats") : ""}`
      : src.kind === "url"
        ? "audio link · plays in the background"
        : "YouTube link · cannot play as background audio";
  return (
    <section className={`mdr ${playing ? "is-on" : ""}`} aria-labelledby="mdr-h">
      <div className="mdr__top">
        <img className="mdr__img" src="/logo/PanchmukhiHanuman_logo-192.png" alt="" width="72" height="72" />
        <div className="mdr__main">
          <p className="mdr__k">मंदिर · Mandir</p>
          <h3 id="mdr-h">{title}</h3>
          <p className="mdr__state">
            <span className={`mdr__dot ${playing ? "is-on" : ""}`} aria-hidden="true" /> {stateText(t.state)} · volume {pct(t.volume)}
          </p>
          <p className="mdr-dim">{kindText}</p>
        </div>
        <div className="mdr__ctl">
          {!t.playable ? null : t.state === "closed" ? (
            <button type="button" className="adm-btn adm-btn--solid adm-btn--sm" onClick={t.play}>
              Play again
            </button>
          ) : (
            <>
              {t.items.length > 1 && (
                <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={t.prev} aria-label="Previous file" data-tip="Previous">
                  ⏮
                </button>
              )}
              <button type="button" className="adm-btn adm-btn--solid adm-btn--sm" onClick={t.toggle}>
                {playing ? "Pause" : "Play"}
              </button>
              {t.items.length > 1 && (
                <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={t.next} aria-label="Next file" data-tip="Next">
                  ⏭
                </button>
              )}
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={t.volDown} aria-label="Volume down" disabled={t.volume <= 0}>
                −
              </button>
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={t.volUp} aria-label="Volume up" disabled={t.volume >= 1}>
                +
              </button>
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={t.close} data-tip="Stop it for this visit.">
                Stop
              </button>
            </>
          )}
          {src.kind === "library" && <AutoSwitch t={t} />}
        </div>
      </div>
      {src.kind === "library" && <VideoBox t={t} />}
      <p className="mdr__verse" lang="hi">
        {VERSES[0]}
      </p>
      {t.error && <p className="mdr__err">{t.error}</p>}
      {s.missing && <p className="mdr__err">A file of the list is missing from this server and was left out. Upload it again if you want it back.</p>}
      {src.kind === "youtube" && (
        <p className="mdr__note">
          <b>To hear it softly in the background on every page, upload the Chalisa as a file</b> (MP3, M4A or a video — a recording you own or may use){isSuper ? " with “Add files” below" : " (the superadmin can do this)"}. It is kept on this server and played from there: no window, and after the first play no internet. YouTube itself does not allow its sound to be played without its video, so the video link{" "}
          <a href={src.url} target="_blank" rel="noopener noreferrer">
            opens on YouTube
          </a>{" "}
          instead.
        </p>
      )}
      <div className="mdr-lib">
        <div className="mdr-lib__head">
          <h4>The list</h4>
          {isSuper && <AddFiles t={t} />}
        </div>
        {isSuper && <p className="mdr-dim">Audio (MP3, M4A, OGG, WAV, WEBM, FLAC) or video (MP4, MOV, WEBM, MKV), up to 200 MB each and 2 GB in all. Use recordings you own or may use. A video plays as sound in the background; “Show video” shows its picture here.</p>}
        <Playlist t={t} isSuper={isSuper} />
      </div>
      <p className="mdr-dim">The ॐ button in the header of every page plays or pauses it.</p>
      {isSuper && <Change t={t} />}
    </section>
  );
}
