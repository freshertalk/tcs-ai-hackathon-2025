// src/library/BookCard.jsx
// The cover and the card — shared by the home shelf, the library and the
// book page, so a book looks like the same book everywhere.

import React from "react";
import { Link } from "react-router-dom";
import { contentUrl } from "./api";
import { useProgress } from "./hooks";
import { fmtMinutes } from "../reader/util";
import { IconEye } from "../reader/icons";

/** Cover art, or a typographic stand-in if a book was published without one. */
export function Cover({ book, eager = false, sizes = "(max-width: 700px) 70vw, 340px", className = "" }) {
  const small = book.coverSmall || book.cover;
  const full = book.cover || small;

  if (!small) {
    return (
      <div className={`bcover bcover--plain ${className}`} role="img" aria-label={book.title}>
        <span className="bcover__t">{book.title}</span>
        <span className="bcover__a">{book.author}</span>
      </div>
    );
  }

  const srcSmall = contentUrl(book.slug, small);
  const srcFull = contentUrl(book.slug, full);
  const mid = book.art && book.art.frontMd ? contentUrl(book.slug, book.art.frontMd) : null;
  const srcSet = srcSmall === srcFull
    ? undefined
    : mid
    ? `${srcSmall} 640w, ${mid} 1000w, ${srcFull} 2000w`
    : `${srcSmall} 640w, ${srcFull} 2000w`;

  return (
    <img
      className={`bcover ${className}`}
      src={srcSmall}
      srcSet={srcSet}
      sizes={sizes}
      width="640"
      height="898"
      alt={`${book.title} — ${book.author} — आवरण`}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={eager ? "high" : undefined}
    />
  );
}

export function percentRead(progress) {
  if (!progress || typeof progress.overall !== "number") return 0;
  return Math.min(100, Math.max(0, Math.round(progress.overall * 100)));
}

/** "Start reading" / "Continue" — the reader itself resumes from the address. */
export function ReadButton({ book, className = "btn btn--solid", children }) {
  const progress = useProgress(book.slug);
  const pct = percentRead(progress);
  const started = pct > 0;

  return (
    <Link className={className} to={`/read/${book.slug}`} data-cursor="पढ़िए">
      <IconEye width={20} height={20} />
      {children || (started ? `पढ़ना जारी रखें · ${pct}%` : "पढ़ें")}
    </Link>
  );
}

export function BookCard({ book }) {
  const progress = useProgress(book.slug);
  const pct = percentRead(progress);

  return (
    <article className="bcard">
      <Link to={`/books/${book.slug}`} className="bcard__cover" aria-label={`${book.title} — विवरण`}>
        <Cover book={book} />
      </Link>

      <div className="bcard__body">
        <h3 className="bcard__title">
          <Link to={`/books/${book.slug}`}>{book.title}</Link>
        </h3>
        <p className="bcard__by">{book.author}</p>
        <p className="bcard__meta">
          {book.chapters} अध्याय · {fmtMinutes(book.minutes)}
        </p>

        {pct > 0 && (
          <div className="bcard__prog" role="img" aria-label={`${pct} प्रतिशत पढ़ा गया`}>
            <i style={{ width: `${pct}%` }} />
          </div>
        )}

        <div className="bcard__actions">
          <ReadButton book={book} className="btn btn--solid btn--sm" />
          <Link className="btn btn--sm" to={`/books/${book.slug}`}>
            विवरण
          </Link>
        </div>
      </div>
    </article>
  );
}
