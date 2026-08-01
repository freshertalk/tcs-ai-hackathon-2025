// src/components/seo/Seo.jsx
// Per-route document metadata.
//
// React 19 hoists <title>, <meta> and <link> to <head> automatically wherever
// they are rendered, so this needs no helmet library. JSON-LD is emitted as a
// plain <script type="application/ld+json"> — valid anywhere in the document
// and read by Google, Bing and the answer engines alike.

import React, { useEffect } from "react";
import { PAGES, SITE, graphFor, url } from "../../data/seo";

export default function Seo({ page }) {
  const p = PAGES[page];

  // React does not hoist an <html lang> attribute, so set it per route.
  // The prerender script writes the same value into the static HTML.
  useEffect(() => {
    if (p) document.documentElement.lang = p.lang;
  }, [p]);

  if (!p) return null;

  const canonical = url(p.path);
  const image = `${SITE.origin}${SITE.ogImage}`;
  const graph = { "@context": "https://schema.org", "@graph": graphFor(page) };

  return (
    <>
      <title>{p.title}</title>
      <meta name="description" content={p.description} />
      <meta name="keywords" content={p.keywords.join(", ")} />
      <link rel="canonical" href={canonical} />

      <meta
        name="robots"
        content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1"
      />
      <meta name="googlebot" content="index, follow, max-snippet:-1, max-image-preview:large" />

      {/*
        No hreflang. It is only for equivalent pages in different languages;
        /technical (English) and /writings (Hindi) are different content, so
        annotating them would produce "no return tag" errors in Search Console
        for no gain. <html lang> above carries the language signal instead.
      */}

      {/* Open Graph */}
      <meta property="og:type" content={page === "writings" ? "book" : "profile"} />
      <meta property="og:site_name" content={SITE.name} />
      <meta property="og:title" content={p.title} />
      <meta property="og:description" content={p.description} />
      <meta property="og:url" content={canonical} />
      <meta property="og:image" content={image} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:image:alt" content={SITE.name} />
      <meta property="og:locale" content={p.lang === "hi" ? SITE.localeAlt : SITE.locale} />
      <meta
        property="og:locale:alternate"
        content={p.lang === "hi" ? SITE.locale : SITE.localeAlt}
      />
      {page !== "writings" && (
        <>
          <meta property="profile:first_name" content="Vinay" />
          <meta property="profile:last_name" content="Tiwari" />
        </>
      )}

      {/* Twitter / X */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={p.title} />
      <meta name="twitter:description" content={p.description} />
      <meta name="twitter:image" content={image} />
      <meta name="twitter:image:alt" content={SITE.name} />

      <meta name="author" content="Vinay Kumar Tiwari" />

      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
      />

      {/*
        A plain-prose summary of the page, visually hidden but fully present in
        the DOM and the prerendered HTML. Answer engines quote sentences, not
        keyword lists — and the visual design leads with stylised headings that
        do not spell the name out. This states it once, plainly, in the exact
        form someone would ask the question. It is not cloaking: the content
        matches the page and is read aloud by screen readers.
      */}
      {p.summary && (
        <p className="sr-only" data-nosnippet={false}>
          {p.summary}
        </p>
      )}
    </>
  );
}
