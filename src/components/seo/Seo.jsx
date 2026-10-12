// src/components/seo/Seo.jsx
// Per-route document metadata.
//
// React 19 hoists <title>, <meta> and <link> to <head> automatically wherever
// they are rendered, so this needs no helmet library. JSON-LD is emitted as a
// plain <script type="application/ld+json"> — valid anywhere in the document
// and read by Google, Bing and the answer engines alike.
//
// Two ways to use it:
//   <Seo page="home" />                      a fixed page from data/seo.js
//   <Seo page="book" book={bookJson} />      a book page, built from its book.json
//   <Seo meta={{ title, path, noindex }} />  anything else (the reader)

import React, { useEffect } from "react";
import { PAGES, SITE, bookMeta, graphFor, url } from "../../data/seo";

export default function Seo({ page, book, meta }) {
  const p = meta || (page === "book" && book ? bookMeta(book) : PAGES[page]);
  const lang = p ? p.lang || "hi" : null;

  // React does not hoist an <html lang> attribute, so set it per route.
  // The prerender script writes the same value into the static HTML.
  useEffect(() => {
    if (lang) document.documentElement.lang = lang;
  }, [lang]);

  if (!p) return null;

  const canonical = url(p.path);
  const image = p.image || `${SITE.origin}${SITE.ogImage}`;
  const robots = p.noindex
    ? "noindex, follow"
    : "index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1";
  const graph = meta
    ? null
    : { "@context": "https://schema.org", "@graph": graphFor(page, book) };
  const type = p.type || "website";

  return (
    <>
      <title>{p.title}</title>
      {p.description && <meta name="description" content={p.description} />}
      {p.keywords && <meta name="keywords" content={p.keywords.join(", ")} />}
      <link rel="canonical" href={canonical} />

      <meta name="robots" content={robots} />
      {!p.noindex && (
        <meta name="googlebot" content="index, follow, max-snippet:-1, max-image-preview:large" />
      )}

      {/*
        No hreflang. It is only for equivalent pages in different languages;
        this site's pages are not translations of one another, so annotating
        them would produce "no return tag" errors in Search Console for no
        gain. <html lang> above carries the language signal instead.
      */}

      {/* Open Graph */}
      <meta property="og:type" content={type} />
      <meta property="og:site_name" content={SITE.name} />
      <meta property="og:title" content={p.title} />
      {p.description && <meta property="og:description" content={p.description} />}
      <meta property="og:url" content={canonical} />
      <meta property="og:image" content={image} />
      {!p.image && (
        <>
          <meta property="og:image:width" content="1200" />
          <meta property="og:image:height" content="630" />
        </>
      )}
      <meta property="og:image:alt" content={SITE.name} />
      <meta property="og:locale" content={lang === "hi" ? SITE.locale : SITE.localeAlt} />
      <meta
        property="og:locale:alternate"
        content={lang === "hi" ? SITE.localeAlt : SITE.locale}
      />

      {/* Twitter / X */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={p.title} />
      {p.description && <meta name="twitter:description" content={p.description} />}
      <meta name="twitter:image" content={image} />
      <meta name="twitter:image:alt" content={SITE.name} />

      <meta name="author" content="Vinay Kumar Tiwari" />

      {graph && (
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
        />
      )}

      {/*
        A plain-prose summary of the page, visually hidden but fully present in
        the DOM and the prerendered HTML. Answer engines quote sentences, not
        keyword lists — and the visual design leads with stylised headings that
        do not spell the name out. This states it once, plainly, in the exact
        form someone would ask the question. It is not cloaking: the content
        matches the page and is read aloud by screen readers.
      */}
      {p.summary && <p className="sr-only">{p.summary}</p>}
    </>
  );
}
