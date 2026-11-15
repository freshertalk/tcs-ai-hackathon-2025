"use strict";
// Reading the sources: news sites' RSS, Google News searches, YouTube channels, Reddit communities,
// NSE's own announcement feed, and posts of X accounts through X's official API.
//
// Every source is read the way its owner publishes it for reading: RSS and Atom feeds (made for
// exactly this) with an honest name in the User-Agent, and X through its API with the owner's own
// Bearer Token. Nothing here logs in to a site with a username and password or poses as a browser:
// platforms forbid automated logins, and they would put the owner's accounts at risk. Only the
// headline, a short excerpt, the time and the link are kept — the full article stays on its site.

const UA = "DrishtiAI-feeds/1.0 (private market dashboard; reads public RSS)";
const X_API = "https://api.x.com/2";
const MAX_TEXT = 600;

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…", rupee: "₹" };
function decode(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => (ENT[n.toLowerCase()] !== undefined ? ENT[n.toLowerCase()] : m));
}
/** Text without tags or extra space (the decode runs twice: feeds often escape their HTML). */
function plain(s, max = MAX_TEXT) {
  const t = decode(decode(s))
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
const tag = (block, name) => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i").exec(block);
  return m ? m[1] : "";
};
const attr = (block, name, a) => {
  const m = new RegExp(`<${name}\\b[^>]*\\b${a}=["']([^"']+)["'][^>]*\\/?>`, "i").exec(block);
  return m ? m[1] : "";
};
const isoOf = (s) => {
  const t = Date.parse(String(s || "").trim());
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/** RSS 2.0 items and Atom entries (YouTube, Reddit, many news sites), newest first. */
function parseFeed(xml) {
  const s = String(xml || "");
  const out = [];
  const blocks = s.match(/<item\b[\s\S]*?<\/item>/gi) || s.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks.slice(0, 60)) {
    const title = plain(tag(b, "title"), 300);
    let link = plain(tag(b, "link"), 1000);
    if (!/^https?:\/\//i.test(link)) link = attr(b, "link", "href");
    const guid = plain(tag(b, "guid") || tag(b, "id"), 500);
    const at = isoOf(tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date"));
    const text = plain(tag(b, "description") || tag(b, "summary") || tag(b, "media:description") || tag(b, "content:encoded") || tag(b, "content"));
    const author = plain(tag(b, "dc:creator") || tag(tag(b, "author"), "name") || tag(b, "author") || tag(b, "source"), 120);
    if (!title && !text) continue;
    out.push({ key: guid || link || title, title: title || text.slice(0, 140), link: /^https?:\/\//i.test(link) ? link : "", at, text: text && text !== title ? text : "", author });
  }
  return out.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
}

/* ------------------------------------------------------------------------------- source kinds */
const KINDS = {
  rss: { name: "News site (RSS)", hint: "The site's RSS feed address (https://…)" },
  google: { name: "Google News search", hint: "Words to search, e.g. Nifty Sensex stock market" },
  youtube: { name: "YouTube channel", hint: "The channel's address or id (UC…)" },
  reddit: { name: "Reddit community", hint: "The community's name, e.g. IndianStreetBets" },
  x: { name: "X account", hint: "The handle, e.g. NSEIndia (needs your X API Bearer Token)" },
};

/** The source's own value, checked and tidied: throws a plain-English error when it cannot be used. */
function cleanValue(type, raw) {
  const v = String(raw || "").trim();
  if (!KINDS[type]) throw Object.assign(new Error("Unknown kind of source."), { status: 400 });
  if (type === "rss") {
    let u;
    try {
      u = new URL(v);
    } catch (_) {
      throw Object.assign(new Error("Give the feed's full https address."), { status: 400 });
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") throw Object.assign(new Error("Only web addresses can be read."), { status: 400 });
    return u.toString();
  }
  if (type === "google") {
    if (v.length < 2 || v.length > 120) throw Object.assign(new Error("Search words: 2 to 120 characters."), { status: 400 });
    return v.replace(/\s+/g, " ");
  }
  if (type === "youtube") {
    const m = /(UC[A-Za-z0-9_-]{22})/.exec(v);
    if (!m) throw Object.assign(new Error("Give the channel's address with its id (it starts with UC), e.g. youtube.com/channel/UC…"), { status: 400 });
    return m[1];
  }
  if (type === "reddit") {
    const m = /^(?:https?:\/\/(?:www\.)?reddit\.com)?\/?(?:r\/)?([A-Za-z0-9_]{2,40})\/?$/.exec(v);
    if (!m) throw Object.assign(new Error("Give the community's name, e.g. IndianStreetBets."), { status: 400 });
    return m[1];
  }
  const m = /^(?:https?:\/\/(?:www\.)?(?:x|twitter)\.com\/)?@?([A-Za-z0-9_]{1,15})\/?$/.exec(v);
  if (!m) throw Object.assign(new Error("Give the X handle, e.g. NSEIndia."), { status: 400 });
  return m[1];
}

/** The address a feed is read from. */
function feedUrl(type, value) {
  if (type === "rss") return value;
  if (type === "google") return `https://news.google.com/rss/search?q=${encodeURIComponent(`${value} when:1d`)}&hl=en-IN&gl=IN&ceid=IN:en`;
  if (type === "youtube") return `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(value)}`;
  if (type === "reddit") return `https://www.reddit.com/r/${encodeURIComponent(value)}/new/.rss`;
  return null;
}

async function getText(fetchImpl, url, headers = {}) {
  const res = await fetchImpl(url, { headers: { "User-Agent": UA, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*", ...headers }, redirect: "follow", signal: AbortSignal.timeout(15000) });
  const head = (k) => (res.headers && typeof res.headers.get === "function" ? res.headers.get(k) : null);
  if (res.status === 304) return { ok: true, status: 304, text: "", etag: head("etag"), lastModified: head("last-modified") };
  const text = await res.text();
  return { ok: res.ok, status: res.status, text, etag: head("etag"), lastModified: head("last-modified") };
}

/** Google News titles end with " - Publisher": the publisher becomes the author, the title stays clean. */
function tidyGoogle(it) {
  const m = /\s[-–—]\s([^-–—]{2,60})$/.exec(it.title || "");
  if (!m) return it;
  const title = it.title.slice(0, m.index).trim();
  const text = it.text && it.text.toLowerCase().startsWith(title.toLowerCase().slice(0, 40)) ? "" : it.text;
  return { ...it, title, author: m[1].trim(), text };
}

/**
 * Read one source. Returns { items: [{ key, title, link, at, text, author, metrics? }], state, error }.
 * `state` is what the source remembers between reads (an X account's id and the newest post seen).
 */
async function readSource(source, { fetchImpl = globalThis.fetch, xToken = "" } = {}) {
  const state = { ...(source.state || {}) };
  try {
    if (source.type === "x") {
      if (!xToken) return { items: [], state, error: "Needs your X API Bearer Token (Social Media → Sources → Accounts and keys)." };
      const auth = { Authorization: `Bearer ${xToken}`, Accept: "application/json" };
      if (!state.userId) {
        const r = await fetchImpl(`${X_API}/users/by/username/${encodeURIComponent(source.value)}`, { headers: auth, signal: AbortSignal.timeout(15000) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.data) return { items: [], state, error: `X: ${(j.errors && j.errors[0] && (j.errors[0].detail || j.errors[0].message)) || j.detail || j.title || `HTTP ${r.status}`}`.slice(0, 200) };
        state.userId = j.data.id;
      }
      const q = new URLSearchParams({ max_results: "10", "tweet.fields": "created_at,public_metrics", exclude: "retweets,replies" });
      if (state.sinceId) q.set("since_id", state.sinceId);
      const r = await fetchImpl(`${X_API}/users/${state.userId}/tweets?${q}`, { headers: auth, signal: AbortSignal.timeout(15000) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return { items: [], state, error: `X: ${j.detail || j.title || `HTTP ${r.status}`}${r.status === 429 ? " (rate limit — it will try again later)" : ""}`.slice(0, 200) };
      const posts = Array.isArray(j.data) ? j.data : [];
      if (posts.length) state.sinceId = posts[0].id;
      return {
        state,
        error: "",
        items: posts.map((p) => ({ key: `x:${p.id}`, title: plain(p.text, 300), link: `https://x.com/${source.value}/status/${p.id}`, at: isoOf(p.created_at), text: "", author: `@${source.value}`, metrics: p.public_metrics ? { likes: p.public_metrics.like_count, reposts: p.public_metrics.retweet_count, replies: p.public_metrics.reply_count } : null })),
      };
    }
    const url = feedUrl(source.type, source.value);
    // a conditional request: when the feed has not changed the site answers 304 with no body, so a
    // source can be read every few minutes for almost nothing
    const cond = {};
    if (state.etag) cond["If-None-Match"] = state.etag;
    if (state.lastModified) cond["If-Modified-Since"] = state.lastModified;
    const r = await getText(fetchImpl, url, cond);
    if (r.status === 304) return { items: [], state, error: "", notModified: true };
    if (!r.ok) return { items: [], state, error: `The feed answered HTTP ${r.status}.` };
    let items = parseFeed(r.text);
    if (!items.length && !/<(rss|feed|rdf)/i.test(r.text)) return { items: [], state, error: "That address is not an RSS or Atom feed." };
    if (source.type === "google") items = items.map(tidyGoogle);
    if (r.etag) state.etag = r.etag;
    else delete state.etag;
    if (r.lastModified) state.lastModified = r.lastModified;
    else delete state.lastModified;
    return { items, state, error: "" };
  } catch (err) {
    return { items: [], state, error: err && err.name === "TimeoutError" ? "The source did not answer within 15 seconds." : String((err && err.message) || err).slice(0, 200) };
  }
}

module.exports = { parseFeed, readSource, cleanValue, feedUrl, plain, decode, tidyGoogle, KINDS, UA };
