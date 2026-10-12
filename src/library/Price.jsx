// src/library/Price.jsx
// The E-Book price: the list price struck through, and the price it sells at
// beside it.
//
// The figures live in BOOK.price (src/data/books.js) — change them there.
// A price is shown only for the book it belongs to.

import React from "react";
import { BOOK } from "../data/books";

const fmt = (n) => `₹ ${n}/= only`;

export default function Price({ slug = BOOK.slug, className = "" }) {
  const p = BOOK.price;
  if (!p || slug !== BOOK.slug) return null;

  return (
    <p className={`price ${className}`}>
      <span className="price__lbl">ई-बुक · विशेष मूल्य:</span>
      <s className="price__mrp">
        <span className="sr-only">पहले का मूल्य </span>
        {fmt(p.mrp)}
      </s>
      <b className="price__now">
        <span className="sr-only">अब का मूल्य </span>
        {fmt(p.selling)}
      </b>
    </p>
  );
}
