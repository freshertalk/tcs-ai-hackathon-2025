import React, { useEffect, useState } from "react";
import { api } from "./api";
import { adminPath } from "./paths";
import Shell from "./Shell";
import { Alert, Field, Loading } from "./ui";

/**
 * The AI strategist's connection: an Anthropic API key and a model.
 * The key is write-only — it can be set, replaced or removed, never read back.
 * Without a key every other part of the desk works exactly as before.
 */
export default function AiSettings() {
  const [s, setS] = useState(null);
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [msg, setMsg] = useState({ kind: "", text: "" });
  const [busy, setBusy] = useState("");
  const [live, setLive] = useState(null); // the co-pilot's limits, as typed
  const [liveMsg, setLiveMsg] = useState({ kind: "", text: "" });

  const apply = (d) => {
    setS(d);
    setModel(d.model);
    if (d.live) setLive({ ...d.live.settings });
  };

  useEffect(() => {
    api("/api/admin/ai/status")
      .then(apply)
      .catch((e) => setMsg({ kind: "error", text: e.message }));
  }, []);

  const run = async (what, fn, okText) => {
    setBusy(what);
    setMsg({ kind: "", text: "" });
    try {
      const d = await fn();
      apply(d);
      setMsg({ kind: d.test && !d.test.ok ? "error" : "ok", text: typeof okText === "function" ? okText(d) : okText });
    } catch (err) {
      setMsg({ kind: "error", text: err.message });
    }
    setBusy("");
  };

  const save = (e) => {
    e.preventDefault();
    const body = { model };
    if (key.trim()) body.apiKey = key.trim();
    run("save", () => api("/api/admin/ai/settings", { method: "PUT", body }), key.trim() ? "Saved. Press “Test the key” to check it works." : "Saved.").then(() => setKey(""));
  };

  const saveLive = async (e) => {
    e.preventDefault();
    setBusy("live");
    setLiveMsg({ kind: "", text: "" });
    try {
      apply(await api("/api/admin/ai/settings", { method: "PUT", body: { live: { model: live.model, minGapSec: Number(live.minGapSec), dailyCap: Number(live.dailyCap), refreshMin: Number(live.refreshMin) } } }));
      setLiveMsg({ kind: "ok", text: "Saved. The desk uses these limits from the next reading." });
    } catch (err) {
      setLiveMsg({ kind: "error", text: err.message });
    }
    setBusy("");
  };
  const liveSame = s && s.live && live && ["model", "minGapSec", "dailyCap", "refreshMin"].every((k) => String(live[k]) === String(s.live.settings[k]));

  return (
    <Shell crumb="AI strategist" narrow>
      <h1 className="adm-h1">AI strategist</h1>
      <p className="adm-lead">
        Connect an Anthropic API key and the trading desk can ask Claude to build a strategy for a stock — from the same live and historical Zerodha data
        you see on the page. It runs only when you press a button, and it can never place an order.
      </p>

      {!s && !msg.text && <Loading />}
      {!s && msg.text && <Alert>{msg.text}</Alert>}
      {s && (
        <>
          <form className="adm-card adm-form" onSubmit={save}>
            <p className="adm-status">
              <i className={s.configured ? "is-on" : ""} aria-hidden="true" />
              {s.configured ? (
                <>
                  On — key <code>{s.keyHint}</code>
                </>
              ) : (
                "Off — no key is set. The desk works without it."
              )}
            </p>
            <Field
              id="ai-key"
              label={s.configured ? "Replace the API key" : "Anthropic API key"}
              hint="Starts with sk-ant-. It is encrypted on the server and never shown again or sent back to a browser."
            >
              <input id="ai-key" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" spellCheck="false" autoComplete="off" />
            </Field>
            <Field id="ai-model" label="Model" hint={(s.models.find((m) => m.id === model) || {}).note}>
              <select id="ai-model" value={model} onChange={(e) => setModel(e.target.value)}>
                {s.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Field>
            <Alert kind={msg.kind === "ok" ? "ok" : "error"}>{msg.text}</Alert>
            {s.lastTest && !msg.text && (
              <p className="adm-small">
                Last test: {s.lastTest.ok ? "worked" : `failed — ${s.lastTest.message}`} ({new Date(s.lastTest.at).toLocaleString()}).
              </p>
            )}
            <div className="adm-actions">
              <button className="adm-btn adm-btn--solid" disabled={Boolean(busy) || (!key.trim() && model === s.model)}>
                {busy === "save" ? "Saving…" : "Save"}
              </button>
              {s.configured && (
                <button
                  type="button"
                  className="adm-btn adm-btn--ghost"
                  disabled={Boolean(busy)}
                  onClick={() => run("test", () => api("/api/admin/ai/test", { method: "POST" }), (d) => (d.test.ok ? `The key works with ${d.test.model}.` : d.test.message))}
                >
                  {busy === "test" ? "Testing…" : "Test the key"}
                </button>
              )}
              {s.configured && (
                <button
                  type="button"
                  className="adm-btn adm-btn--danger"
                  disabled={Boolean(busy)}
                  onClick={() => run("clear", () => api("/api/admin/ai/settings", { method: "PUT", body: { clear: true } }), "The key was removed. The AI strategist is off.")}
                >
                  Remove the key
                </button>
              )}
            </div>
          </form>

          {s.live && live && (
            <form className="adm-card adm-form" onSubmit={saveLive}>
              <h2>Live co-pilot</h2>
              <p className="adm-small">
                On the trading desk, “Go live” lets the model read the one stock you have open — again whenever its call changes, a level breaks or an early warning appears. It is
                never a loop: these limits bound what it can spend, and it stops when you switch it off, change stock or leave the page.
              </p>
              <Field id="cp-model" label="Model for the co-pilot" hint="A faster model answers sooner. The strategist keeps the model chosen above.">
                <select id="cp-model" value={live.model} onChange={(e) => setLive({ ...live, model: e.target.value })}>
                  <option value="">Same as the strategist</option>
                  {s.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="cp-gap" label="Shortest time between readings (seconds)" hint="30 to 900. However much happens, one stock is not read more often than this.">
                <input id="cp-gap" type="number" min="30" max="900" step="1" value={live.minGapSec} onChange={(e) => setLive({ ...live, minGapSec: e.target.value })} />
              </Field>
              <Field id="cp-cap" label="Most readings in a day" hint="1 to 500, across all stocks. When it is reached the co-pilot stops until tomorrow; the rest of the desk carries on.">
                <input id="cp-cap" type="number" min="1" max="500" step="1" value={live.dailyCap} onChange={(e) => setLive({ ...live, dailyCap: e.target.value })} />
              </Field>
              <Field id="cp-refresh" label="Look again after this many quiet minutes" hint="0 to 60. 0 means it reads only when something happens.">
                <input id="cp-refresh" type="number" min="0" max="60" step="1" value={live.refreshMin} onChange={(e) => setLive({ ...live, refreshMin: e.target.value })} />
              </Field>
              <Alert kind={liveMsg.kind === "ok" ? "ok" : "error"}>{liveMsg.text}</Alert>
              <p className="adm-small">
                Today: {s.live.usage.used} of {s.live.usage.cap} readings, {(s.live.usage.inputTokens + s.live.usage.outputTokens).toLocaleString("en-IN")} tokens.{" "}
                {s.live.record.allTime.scored > 0
                  ? `Its record since ${s.live.record.allTime.since}: ${s.live.record.allTime.right} right, ${s.live.record.allTime.wrong} wrong, ${s.live.record.allTime.flat} flat of ${s.live.record.allTime.scored} scored.`
                  : "No reading has been scored yet."}
              </p>
              <div className="adm-actions">
                <button className="adm-btn adm-btn--solid" disabled={Boolean(busy) || liveSame}>
                  {busy === "live" ? "Saving…" : "Save the co-pilot’s limits"}
                </button>
              </div>
            </form>
          )}

          <section className="adm-card">
            <h2>Getting a key</h2>
            <ol className="adm-steps">
              <li>
                Sign in at <b>console.anthropic.com</b> (Anthropic’s developer console — separate from a claude.ai subscription).
              </li>
              <li>
                Add credits under <b>Billing</b>. The API is pay-as-you-go; consider setting a monthly spend limit there.
              </li>
              <li>
                Open <b>API keys</b>, create a key, and paste it above. Type it only into this page — never into a chat or an email.
              </li>
            </ol>
          </section>

          <section className="adm-card">
            <h2>What it does, and what it does not</h2>
            <ul className="adm-list">
              <li>
                <b>Only on request.</b> A call is made when you press “Build strategy”, “Score &amp; learn”, “Check the news” or “Ask now” on the{" "}
                <a href={adminPath("/stock-report")}>trading desk</a>. The live co-pilot is the one thing that asks by itself — only for the stock you have open, only
                while its switch is on and the page is in front of you, and only inside the limits above. Nothing runs on the server in the background, so
                nothing is spent while you are away. Each result shows the tokens it used.
              </li>
              <li>
                <b>What is sent to Anthropic.</b> Market data for the one stock (quote, today’s 1-minute and 5-minute bars, daily bars, indicators, levels,
                backtests, and for the co-pilot the five best levels of the order book), the rule engine’s reading, and your trading-skills file. The news
                check sends the symbol, the company’s name and today’s change. No name, email, account or holdings.
              </li>
              <li>
                <b>Every plan is checked.</b> The stop must be on the right side, levels inside the circuit limits, the risk a sensible size, the reward at
                least equal to the risk. A plan that fails is shown as rejected, with the reason.
              </li>
              <li>
                <b>It keeps score.</b> Plans are later scored against real prices by arithmetic. Only those results can become lessons in the skills file.
              </li>
              <li>
                <b>It cannot trade, and it cannot promise.</b> There is no order code anywhere in it. No model or method wins every trade; treat its output
                as a second opinion, not an instruction.
              </li>
            </ul>
          </section>
        </>
      )}
    </Shell>
  );
}
