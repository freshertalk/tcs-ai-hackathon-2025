// src/shop/BuyBar.jsx
// "अभी खरीदिए" and "कार्ट में जोड़ें" — or, for someone who owns the book, the
// reading button. Ownership is the collector's word (me.access); until it has
// spoken for a signed-in person, a quiet placeholder holds the place so the
// button does not jump.

import React from "react";
import { Link } from "react-router-dom";
import { BOOK } from "../data/books";
import { useAuth } from "../auth/google";
import { useMe } from "../account/me";
import { ReadButton } from "../library/BookCard";
import { IconCart, IconCheck } from "../components/ui/icons";
import { addToCart, useCart } from "./store";
import { inrShort } from "./format";

/** Does the signed-in person own this book? null while that is not yet known. */
export function useOwns(slug = BOOK.slug) {
  const { user } = useAuth();
  const { me, status } = useMe();
  if (!user) return false;
  if (me && me.access) return Boolean(me.access[slug]);
  return status === "error" ? false : null;
}

export default function BuyBar({ book, slug = BOOK.slug, readClass, buyClass, cartClass }) {
  const owns = useOwns(slug);
  const cart = useCart();
  const there = cart.items.some((i) => i.slug === slug);

  if (owns) return <ReadButton book={book} className={readClass} />;
  if (owns === null) {
    return (
      <span className={`${buyClass} buy__wait`} aria-busy="true">
        <span className="sr-only">जाँच रहे हैं…</span>
      </span>
    );
  }

  return (
    <>
      <Link className={buyClass} to="/checkout?buy=1" onClick={() => addToCart(slug)} data-cursor="खरीदिए">
        <IconCart size={18} />
        अभी खरीदिए · {inrShort(BOOK.price.selling)}
      </Link>
      {there ? (
        <Link className={`${cartClass} is-in`} to="/checkout">
          <IconCheck size={16} strokeWidth={2.6} />
          कार्ट में है
        </Link>
      ) : (
        <button type="button" className={cartClass} onClick={() => addToCart(slug)}>
          <IconCart size={17} />
          कार्ट में जोड़ें
        </button>
      )}
    </>
  );
}
