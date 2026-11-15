"use strict";
// The Social Media watcher: keeps the feed and its organised picture fresh with no page open.
//
// Every 30 seconds it asks the social service (server/social/service.js) to read the sources that are
// due (each has its own interval: 3 minutes for a news site, 5 for Google News and Reddit, 15 for X),
// with conditional requests so an unchanged feed costs almost nothing. New items are organised by the
// rules at once and announced (the page's live stream, the news alerts). The AI model reads only the
// items that need it, within the hourly budget; the AI brief is rewritten by itself only when that is
// switched on (otherwise the rules' brief is always there, and the AI brief is a button).
//
// It only reads public feeds and X's API with the owner's own token. It never posts, never logs in to
// a platform, and never places an order. It lives outside server/ai, which holds no timers.

const EVERY_MS = 30000;
const BRIEF_EVERY_MS = 30 * 60000;
const BRIEF_MIN_NEW = 5;

class SocialWatch {
  constructor({ social, now = () => Date.now(), log = console, every = EVERY_MS }) {
    this.social = social;
    this.now = now;
    this.log = log;
    this.every = every;
    this.timer = null;
    this.busy = false;
    this.last = { at: null, read: 0, added: 0, aiRead: 0, brief: null, error: "" };
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch(() => {});
    }, this.every);
    if (this.timer.unref) this.timer.unref();
    // a first look shortly after the server starts
    const first = setTimeout(() => this.tick().catch(() => {}), 5000);
    if (first.unref) first.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  status() {
    return { running: Boolean(this.timer), everySec: Math.round(this.every / 1000), ...this.last };
  }

  /** One round: read the due sources, let the AI organise the new items, refresh the brief when stale. */
  async tick() {
    if (this.busy) return null;
    this.busy = true;
    const out = { at: new Date(this.now()).toISOString(), read: 0, added: 0, aiRead: 0, brief: null, error: "" };
    try {
      const p = await this.social.poll();
      out.read = p.read;
      out.added = p.added;
      const a = await this.social.process();
      out.aiRead = a.read;
      out.brief = await this._briefIfStale();
    } catch (err) {
      out.error = String((err && err.message) || err).slice(0, 200);
    } finally {
      this.busy = false;
    }
    this.last = out;
    if (out.added || out.aiRead) this.log.log(`[social] ${out.read} sources read · ${out.added} new · ${out.aiRead} organised by the AI${out.brief ? " · brief rewritten" : ""}`);
    return out;
  }

  async _briefIfStale() {
    const st = this.social.status();
    if (!st.aiOn || !st.aiBriefAuto || !st.aiReady || !st.aiAt) return null;
    const have = this.social.lastBrief();
    const at = have && have.at ? Date.parse(have.at) : 0;
    if (this.now() - at < BRIEF_EVERY_MS) return null;
    // the first brief as soon as a few items are organised; later ones once enough new ones came in
    if (this.social.aiReadSince(at) < (have ? BRIEF_MIN_NEW : 3)) return null;
    try {
      const b = await this.social.brief({ refresh: true });
      return b.at;
    } catch (_) {
      return null; // no market-related items yet, or the model did not answer: next round
    }
  }
}

module.exports = { SocialWatch, EVERY_MS };
