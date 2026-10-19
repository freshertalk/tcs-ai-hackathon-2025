/* eslint-disable no-console */
// scripts/prerender.js
// ---------------------------------------------------------------------------
// Turns the CRA single-page bundle into a real, crawlable HTML document.
//
// Why this exists
// ---------------
// `npm run build` ships <div id="root"></div> and nothing else. Googlebot will
// eventually render that, but it is a second-pass, best-effort job — and the
// answer engines this site is trying to reach (GPTBot, ClaudeBot,
// PerplexityBot, OAI-SearchBot, CCBot) generally do NOT execute JavaScript at
// all. To them an unrendered SPA is a blank page.
//
// So after the build we render the route to static HTML with the same React
// tree the browser uses and inject it into build/index.html  →  /
//
// React still hydrates on top, so behaviour is unchanged for real visitors.
//
// It also writes build/sitemap.xml from the same route list, so the sitemap can
// never drift from the pages that actually exist.
//
// This step is deliberately fail-soft: if anything goes wrong it warns and
// leaves the normal SPA build in place rather than breaking a deploy.
// ---------------------------------------------------------------------------

const fs = require("fs");
const { execSync } = require("child_process");
const path = require("path");
const Module = require("module");

const ROOT = path.resolve(__dirname, "..");
const BUILD = path.join(ROOT, "build");
const SRC = path.join(ROOT, "src");

const ORIGIN = "https://vinaytiwari.org";

const ROUTES = [
  {
    url: "/",
    out: "index.html",
    lang: "en",
    changefreq: "monthly",
    priority: "1.0",
    image: {
      loc: "/vinay-portrait.jpg",
      title: "Vinay Kumar Tiwari — SAP BTP Solution Architect and Hindi author",
    },
  },
];

/* ------------------------------------------------ compile src/ for node */
function installRequireHooks() {
  const { transform } = require("sucrase");
  const compileJs = Module._extensions[".js"];

  const tx = (mod, filename) => {
    const { code } = transform(fs.readFileSync(filename, "utf8"), {
      transforms: ["jsx", "imports"],
      jsxRuntime: "automatic",
      production: true,
      filePath: filename,
    });
    mod._compile(code, filename);
  };

  Module._extensions[".js"] = (m, f) => (f.startsWith(SRC) ? tx(m, f) : compileJs(m, f));
  Module._extensions[".jsx"] = tx;
  Module._extensions[".css"] = (m, f) => m._compile("module.exports={};", f);
  for (const ext of [".png", ".jpg", ".jpeg", ".svg", ".webp", ".avif", ".ico", ".gif"]) {
    Module._extensions[ext] = (m, f) => m._compile('module.exports="";', f);
  }
}

/* ------------------------------------------------------------- helpers */

// React 19 hoists <title>/<meta>/<link>/<script ld+json> to the front of the
// renderToString output. Peel those off so they can go in <head> where they
// belong, and keep the rest as the body markup.
function splitHeadAndBody(html) {
  const HEAD_TAG =
    /^\s*(?:<title>[\s\S]*?<\/title>|<meta\b[^>]*\/?>|<link\b[^>]*\/?>|<script type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>)/;
  let head = "";
  let rest = html;
  for (;;) {
    const m = rest.match(HEAD_TAG);
    if (!m) break;
    head += m[0].trim();
    rest = rest.slice(m[0].length);
  }
  return { head, body: rest };
}

// Remove tags the rendered head will supply, so nothing is duplicated.
function stripConflicting(template) {
  return template
    .replace(/<title>[\s\S]*?<\/title>\s*/i, "")
    .replace(/<meta\s+name="(description|keywords|robots|author)"[^>]*>\s*/gi, "")
    .replace(/<meta\s+(?:property|name)="(?:og|twitter|profile):[^"]*"[^>]*>\s*/gi, "")
    .replace(/<link\s+rel="canonical"[^>]*>\s*/gi, "")
    .replace(/<link\s+rel="alternate"\s+hreflang[^>]*>\s*/gi, "")
    .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>\s*/gi, "");
}

/* ------------------------------------------------------------- sitemap */
// lastmod is the date of the last commit that touched the site itself — not
// the build date — so it only moves when the content does. Search engines
// discount lastmod values that change without a reason.
function contentDate() {
  try {
    const d = execSync("git log -1 --format=%cs -- src public", {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  } catch (_) {
    /* not a git checkout — fall through */
  }
  return new Date().toISOString().slice(0, 10);
}

const esc = (t) =>
  String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function writeSitemap(routes) {
  const lastmod = contentDate();
  const urls = routes
    .map((r) => {
      const img = r.image
        ? `
    <image:image>
      <image:loc>${ORIGIN}${r.image.loc}</image:loc>
      <image:title>${esc(r.image.title)}</image:title>
    </image:image>`
        : "";
      return `  <url>
    <loc>${ORIGIN}${r.url}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${r.changefreq}</changefreq>
    <priority>${r.priority}</priority>${img}
  </url>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Generated by scripts/prerender.js from its ROUTES list. Do not edit by hand. -->
<urlset
  xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
>
${urls}
</urlset>
`;
  fs.writeFileSync(path.join(BUILD, "sitemap.xml"), xml, "utf8");
  console.log(`[prerender] sitemap.xml → ${routes.length} url(s), lastmod ${lastmod}`);
}

/* ---------------------------------------------------------------- main */
function main() {
  const templatePath = path.join(BUILD, "index.html");
  if (!fs.existsSync(templatePath)) {
    console.warn("[prerender] build/index.html not found — run `npm run build` first. Skipping.");
    return;
  }

  installRequireHooks();
  process.env.NODE_ENV = "production";
  process.env.PUBLIC_URL = process.env.PUBLIC_URL || "";

  const React = require("react");
  const { renderToString } = require("react-dom/server");
  const { StaticRouter } = require("react-router-dom");
  const App = require(path.join(SRC, "App.js")).default;

  const rawTemplate = fs.readFileSync(templatePath, "utf8");
  const template = stripConflicting(rawTemplate);

  if (!template.includes('<div id="root"></div>')) {
    console.warn('[prerender] could not find <div id="root"></div> — skipping.');
    return;
  }

  let ok = 0;
  for (const route of ROUTES) {
    try {
      const rendered = renderToString(
        React.createElement(
          StaticRouter,
          { location: route.url },
          React.createElement(App)
        )
      );
      const { head, body } = splitHeadAndBody(rendered);

      const html = template
        // React cannot hoist the <html lang> attribute, so set it here
        .replace(/<html([^>]*)\slang="[^"]*"/i, `<html$1 lang="${route.lang}"`)
        .replace("</head>", `${head}\n  </head>`)
        .replace('<div id="root"></div>', `<div id="root">${body}</div>`);

      const outPath = path.join(BUILD, route.out);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, html, "utf8");

      const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
      console.log(`[prerender] ${route.url.padEnd(11)} → ${route.out.padEnd(22)} ${kb} KB`);
      ok++;
    } catch (err) {
      console.warn(`[prerender] ${route.url} failed: ${err.message}`);
    }
  }
  console.log(`[prerender] ${ok}/${ROUTES.length} routes written as static HTML`);
  writeSitemap(ROUTES);
}

try {
  main();
} catch (err) {
  console.warn("[prerender] skipped:", err.message);
}
