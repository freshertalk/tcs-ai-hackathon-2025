import React, { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { adminPath } from "./paths";
import Shell from "./Shell";
import { Alert, Loading } from "./ui";
import { publishAiStatus, useAiStatus, loadAiStatus } from "./aiStatus";
import "./ai.css";

/**
 * The AI strategist's connection: which AI company, which of its models, and its API key.
 *
 * Each company keeps its own key and its own model on the server, so switching back to a company
 * never asks for its key again — only when a test of that key fails. A choice made here is saved
 * at once and pushed to every open page (and other tabs); the server builds every AI request from
 * these settings at the moment it is made. Keys are write-only: never shown again or sent back.
 */
export default function AiSettings() {
  const shared = useAiStatus();
  const [s, setS] = useState(null);
  const [pick, setPick] = useState(""); // the company shown in the form
  const [key, setKey] = useState("");
  const [askKey, setAskKey] = useState(false); // "Replace key" pressed, or the last test failed
  const [msg, setMsg] = useState({ kind: "", text: "" });
  const [busy, setBusy] = useState("");
  const [live, setLive] = useState(null); // the co-pilot's limits, as typed
  const [liveMsg, setLiveMsg] = useState({ kind: "", text: "" });

  // follow the shared copy: a change made in another tab shows here too
  useEffect(() => {
    if (!shared) return;
    setS(shared);
    setPick((p) => p || shared.provider);
    setLive((l) => l || (shared.live ? { ...shared.live.settings } : null));
  }, [shared]);
  useEffect(() => {
    loadAiStatus(true).catch((e) => setMsg({ kind: "error", text: e.message }));
  }, []);

  const apply = (d) => {
    publishAiStatus(d);
    setS(d);
    if (d.live) setLive({ ...d.live.settings });
  };

  const co = useMemo(() => (s ? s.providers.find((p) => p.id === pick) || s.providers[0] : null), [s, pick]);
  const inUse = Boolean(s && co && s.provider === co.id && s.configured);
  const showKey = co && (!co.configured || askKey || (co.lastTest && co.lastTest.ok === false));

  const run = async (what, fn, okText) => {
    setBusy(what);
    setMsg({ kind: "", text: "" });
    try {
      const d = await fn();
      apply(d);
      const text = typeof okText === "function" ? okText(d) : okText;
      setMsg({ kind: d.test && !d.test.ok ? "error" : "ok", text });
      return d;
    } catch (err) {
      setMsg({ kind: "error", text: err.message });
      return null;
    } finally {
      setBusy("");
    }
  };
  const put = (body) => api("/api/admin/ai/settings", { method: "PUT", body });

  // picking a company: if its key is saved, it is used at once; if not, its key is asked for first
  const chooseCompany = (id) => {
    setPick(id);
    setKey("");
    setAskKey(false);
    setMsg({ kind: "", text: "" });
    const c = s.providers.find((p) => p.id === id);
    if (c && c.configured && s.provider !== id) run("switch", () => put({ provider: id }), (d) => `Now using ${d.providerName} · ${d.modelName}. Every page uses it from the next request.`);
  };

  // picking a model: saved at once when the company's key is saved
  const chooseModel = (id) => {
    if (!co.configured) {
      run("model", () => put({ provider: co.id, model: id, use: false }), "Model kept. Add the key to start using it.");
      return;
    }
    run("model", () => put({ provider: co.id, model: id }), (d) => `Now using ${d.providerName} · ${d.modelName}. Every page uses it from the next request.`);
  };

  // a new key: saved, then tested; if it works its live model list is read and the company is used
  const saveKey = async (e) => {
    e.preventDefault();
    const k = key.trim();
    if (!k) return;
    const saved = await run("save", () => put({ provider: co.id, apiKey: k, model: co.model }), "Saved. Testing it…");
    if (!saved) return;
    setKey("");
    const t = await run("test", () => api("/api/admin/ai/test", { method: "POST", body: { provider: co.id } }), (d) => (d.test.ok ? `The key works with ${d.test.model}. Now using ${d.providerName}.` : d.test.message));
    if (t && t.test && t.test.ok) {
      setAskKey(false);
      refreshModels(`The key works with ${t.test.model}. Now using ${t.providerName}.`);
    }
  };

  // the model list as the company gives it to this key; a failure here keeps the suggested list
  const refreshModels = (before = "") =>
    run("models", () => api("/api/admin/ai/models", { method: "POST", body: { provider: co.id } }), (d) => {
      const c = d.providers.find((p) => p.id === co.id);
      return `${before ? `${before} ` : ""}${c.models.length} model${c.models.length === 1 ? "" : "s"} available to this key.`;
    });

  const test = () =>
    run("test", () => api("/api/admin/ai/test", { method: "POST", body: { provider: co.id } }), (d) => {
      if (!d.test.ok) setAskKey(true);
      return d.test.ok ? `The key works with ${d.test.model}.` : `${d.test.message} Paste a new key below if it has changed.`;
    });

  const saveLive = async (e) => {
    e.preventDefault();
    setBusy("live");
    setLiveMsg({ kind: "", text: "" });
    try {
      apply(await put({ live: { model: live.model, minGapSec: Number(live.minGapSec), dailyCap: Number(live.dailyCap), refreshMin: Number(live.refreshMin) } }));
      setLiveMsg({ kind: "ok", text: "Saved. Used from the next reading." });
    } catch (err) {
      setLiveMsg({ kind: "error", text: err.message });
    }
    setBusy("");
  };
  const liveSame = s && s.live && live && ["model", "minGapSec", "dailyCap", "refreshMin"].every((k) => String(live[k]) === String(s.live.settings[k]));
  const activeModels = s ? s.models : [];
  const note = co ? (co.models.find((m) => m.id === co.model) || {}).note : "";
  const free = co ? (co.models.find((m) => m.id === co.model) || {}).free : false;

  return (
    <Shell crumb="AI strategist" wide>
      <div className="ais">
        <header className="ais-head">
          <div>
            <h1 className="adm-h1">AI strategist</h1>
            <p className="ais-lead">Pick any AI company and model. Each keeps its own key; a change applies to every page at once. It runs only when you ask, and it can never place an order.</p>
          </div>
          {s && (
            <p className={`ais-pill ${s.configured ? "is-on" : ""}`} role="status" aria-live="polite">
              <i aria-hidden="true" />
              {s.configured ? (
                <>
                  <b>{s.providerName}</b> · {s.modelName}
                </>
              ) : (
                "Off — no key for the company in use"
              )}
            </p>
          )}
        </header>

        {!s && !msg.text && <Loading />}
        {!s && msg.text && <Alert>{msg.text}</Alert>}
        {s && co && (
          <div className="ais-grid">
            <section className="ais-card ais-main" aria-labelledby="ais-conn">
              <h2 id="ais-conn">Company &amp; model</h2>
              <div className="ais-row2">
                <label className="ais-field">
                  <span>AI company</span>
                  <select id="ai-company" value={co.id} onChange={(e) => chooseCompany(e.target.value)} disabled={Boolean(busy)}>
                    {[
                      ["Paid — billed by each company", s.providers.filter((p) => !p.free)],
                      ["FREE — hosted by NVIDIA, one nvapi- key", s.providers.filter((p) => p.free)],
                    ].map(([label, list]) => (
                      <optgroup key={label} label={label}>
                        {list.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.free ? "FREE · " : ""}
                            {p.name}
                            {p.name.includes(p.family) ? "" : ` (${p.family})`}
                            {p.configured ? " — key saved" : ""}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <label className="ais-field">
                  <span>
                    Model
                    <button type="button" className="ais-link" onClick={() => refreshModels()} disabled={Boolean(busy) || !co.configured} data-tip="Read the models this key can use from the company now (no tokens are spent).">
                      {busy === "models" ? "Reading…" : "↻ Refresh models"}
                    </button>
                  </span>
                  <select id="ai-model" value={co.model} onChange={(e) => chooseModel(e.target.value)} disabled={Boolean(busy)}>
                    {co.models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                        {m.free ? " — free" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="ais-note">
                {free && <em className="ais-free">Free</em>}
                {note || (co.listedAt ? `From ${co.name}'s own list, read ${new Date(co.listedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}.` : `${co.models.length} suggested — save the key to read ${co.name}'s current list.`)}
              </p>

              <div className="ais-chips" role="list" aria-label="Companies with a saved key">
                {s.providers.map((p) => (
                  <button key={p.id} type="button" role="listitem" className={`ais-chip ${p.id === co.id ? "is-picked" : ""} ${p.configured ? "has-key" : ""} ${s.provider === p.id && s.configured ? "is-used" : ""}`} onClick={() => chooseCompany(p.id)} disabled={Boolean(busy)} data-tip={p.configured ? `${p.name}: key saved${p.lastTest ? (p.lastTest.ok ? ", last test worked" : ", last test failed") : ""}.` : `${p.name}: no key saved yet.`}>
                    <i aria-hidden="true" />
                    {p.name}
                    {p.keyOf ? " (NVIDIA)" : ""}
                    {p.free && <em className="ais-free ais-free--chip">Free</em>}
                    {s.provider === p.id && s.configured && <small>in use</small>}
                  </button>
                ))}
              </div>

              <div className="ais-key">
                {co.configured && !showKey && (
                  <div className="ais-keyline">
                    <span>
                      Key saved <code>{co.keyHint}</code>
                      {co.lastTest && <small className={co.lastTest.ok ? "is-ok" : "is-bad"}>{co.lastTest.ok ? " · worked" : " · failed"} {new Date(co.lastTest.at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</small>}
                    </span>
                    <span className="ais-btns">
                      {!inUse && (
                        <button type="button" className="adm-btn adm-btn--solid adm-btn--sm" disabled={Boolean(busy)} onClick={() => chooseCompany(co.id)}>
                          Use {co.name}
                        </button>
                      )}
                      <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={Boolean(busy)} onClick={test}>
                        {busy === "test" ? "Testing…" : "Test"}
                      </button>
                      <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={Boolean(busy)} onClick={() => setAskKey(true)}>
                        Replace
                      </button>
                      <button
                        type="button"
                        className="adm-btn adm-btn--danger adm-btn--sm"
                        disabled={Boolean(busy)}
                        onClick={() => run("clear", () => put({ provider: co.id, clear: true, use: false }), `${co.free ? "The NVIDIA key (used by every FREE company) was removed." : `${co.name}'s key was removed.`}${s.provider === co.id ? " The AI is off until a key is added or another company is picked." : ""}`)}
                      >
                        Remove
                      </button>
                    </span>
                  </div>
                )}
                {showKey && (
                  <form className="ais-keyform" onSubmit={saveKey}>
                    <label className="ais-field">
                      <span>{co.free ? `${co.configured ? "New " : ""}NVIDIA API key — shared by every FREE company` : co.configured ? `New ${co.name} API key` : `${co.name} API key`}</span>
                      <input id="ai-key" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={co.keyExample} spellCheck="false" autoComplete="off" />
                    </label>
                    <button className="adm-btn adm-btn--solid" disabled={Boolean(busy) || !key.trim()}>
                      {busy === "save" ? "Saving…" : busy === "test" ? "Testing…" : "Save & use"}
                    </button>
                    {co.configured && (
                      <button type="button" className="adm-btn adm-btn--ghost" onClick={() => setAskKey(false)} disabled={Boolean(busy)}>
                        Cancel
                      </button>
                    )}
                    <p className="ais-note ais-span">
                      Encrypted on the server and never shown again or sent to a browser. Type it only here — never into a chat or an email.{" "}
                      <a href={co.consoleUrl} target="_blank" rel="noopener noreferrer">
                        Get a key at {co.console} ↗
                      </a>
                    </p>
                  </form>
                )}
              </div>
              <Alert kind={msg.kind === "ok" ? "ok" : "error"}>{msg.text}</Alert>
            </section>

            <aside className="ais-side">
              <section className="ais-card" aria-labelledby="ais-search">
                <h2 id="ais-search">Web search</h2>
                <p className="ais-note">
                  {s.searchBy ? (
                    <>
                      The world brief and the news check search the web with <b>{s.searchByName}</b>
                      {s.searchBy !== s.provider && s.configured ? `, because ${s.providerName} has none in its API` : ""}.
                    </>
                  ) : s.configured && s.free ? (
                    <>
                      <b>Off while a FREE model is in use.</b> The NVIDIA-hosted models have no web search, and the app never borrows a paid company&rsquo;s key for them, so nothing is billed. Pick Anthropic, OpenAI or Gemini for the world brief and news check.
                    </>
                  ) : s.configured ? (
                    <>{s.providerName} has no web search in its API. Save an Anthropic, OpenAI or Gemini key too and the world brief and news check will use it; the strategist stays on {s.providerName}.</>
                  ) : (
                    "Anthropic, OpenAI and Gemini can search the web; DeepSeek, Kimi and the FREE NVIDIA-hosted models cannot."
                  )}
                </p>
              </section>

              {s.live && live && (
                <form className="ais-card ais-live" onSubmit={saveLive} aria-labelledby="ais-live">
                  <h2 id="ais-live">Live co-pilot</h2>
                  <label className="ais-field">
                    <span>Model</span>
                    <select id="cp-model" value={activeModels.some((m) => m.id === live.model) ? live.model : ""} onChange={(e) => setLive({ ...live, model: e.target.value })}>
                      <option value="">Same as the strategist</option>
                      {activeModels.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="ais-row3">
                    <label className="ais-field" data-tip="30 to 900 seconds. One stock is never read more often than this.">
                      <span>Gap (s)</span>
                      <input id="cp-gap" type="number" min="30" max="900" step="1" value={live.minGapSec} onChange={(e) => setLive({ ...live, minGapSec: e.target.value })} />
                    </label>
                    <label className="ais-field" data-tip="1 to 500 readings a day across all stocks; then it stops until tomorrow.">
                      <span>Per day</span>
                      <input id="cp-cap" type="number" min="1" max="500" step="1" value={live.dailyCap} onChange={(e) => setLive({ ...live, dailyCap: e.target.value })} />
                    </label>
                    <label className="ais-field" data-tip="0 to 60 quiet minutes before it looks again; 0 reads only when something happens.">
                      <span>Quiet (min)</span>
                      <input id="cp-refresh" type="number" min="0" max="60" step="1" value={live.refreshMin} onChange={(e) => setLive({ ...live, refreshMin: e.target.value })} />
                    </label>
                  </div>
                  <p className="ais-note">
                    Today {s.live.usage.used}/{s.live.usage.cap} readings · {(s.live.usage.inputTokens + s.live.usage.outputTokens).toLocaleString("en-IN")} tokens
                    {s.live.record.allTime.scored > 0 ? ` · record ${s.live.record.allTime.right} right, ${s.live.record.allTime.wrong} wrong, ${s.live.record.allTime.flat} flat` : ""}
                  </p>
                  <Alert kind={liveMsg.kind === "ok" ? "ok" : "error"}>{liveMsg.text}</Alert>
                  <button className="adm-btn adm-btn--solid adm-btn--sm" disabled={Boolean(busy) || liveSame}>
                    {busy === "live" ? "Saving…" : "Save limits"}
                  </button>
                </form>
              )}
            </aside>

            <details className="ais-card ais-more">
              <summary>Getting {co.free ? "the free NVIDIA" : co.name === "Moonshot AI" ? "a Moonshot (Kimi)" : /^[AEIO]|^N[A-Z]/.test(co.name) ? `an ${co.name}` : `a ${co.name}`} key</summary>
              <ol className="adm-steps">
                {co.steps.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ol>
              <p className="ais-note">
                <a href={co.consoleUrl} target="_blank" rel="noopener noreferrer">
                  Open {co.console} ↗
                </a>{" "}
                {co.free ? "Free trial under NVIDIA's API Trial Terms. These requests go only to NVIDIA, with the NVIDIA key; when the trial's rate limit is reached the request fails with a clear message, and the app never switches to a paid company by itself." : "Pay-as-you-go companies bill per token; set a spend limit in their console."}
              </p>
            </details>

            <details className="ais-card ais-more">
              <summary>What it does, and what it does not</summary>
              <ul className="adm-list">
                <li>
                  <b>Only on request.</b> A call is made when you press a button on the <a href={adminPath("/stock-report")}>trading desk</a> (Build strategy, Score &amp; learn, Check the news,
                  Ask now, Write the debrief). The live co-pilot asks by itself only for the stock you have open, only while its switch is on, and only inside the limits above.
                </li>
                <li>
                  <b>What is sent to the AI company.</b> Market data for the one stock, the rule engine’s reading and your trading-skills file. The news check sends the symbol, the company’s
                  name and today’s change. No name, email, account or holdings.
                </li>
                <li>
                  <b>Every plan is checked</b> by arithmetic — stop side, circuit limits, risk size, reward at least equal to risk — whichever company wrote it. Plans are later scored against
                  real prices; only those results become lessons.
                </li>
                <li>
                  <b>It cannot trade, and it cannot promise.</b> There is no order code in it. No model wins every trade; treat its output as a second opinion.
                </li>
              </ul>
            </details>
          </div>
        )}
      </div>
    </Shell>
  );
}
