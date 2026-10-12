// src/sections/write/StickyRead.jsx
// On a phone, the Read button scrolls away with the hero. This keeps one
// within thumb's reach for the rest of the page — but only once the real
// button is out of sight, so the two are never on screen together.

import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Cover, percentRead } from "../../library/BookCard";
import { useProgress } from "../../library/hooks";
import { IconEye } from "../../reader/icons";
import { IconCart } from "../../components/ui/icons";
import { BOOK } from "../../data/books";
import { useOwns } from "../../shop/BuyBar";
import { addToCart } from "../../shop/store";
import { inrShort } from "../../shop/format";

export default function StickyRead({ targetRef }) {
  const [away, setAway] = useState(false);
  const progress = useProgress(BOOK.slug);
  const pct = percentRead(progress);
  const owns = useOwns(BOOK.slug);

  useEffect(() => {
    const el = targetRef.current;
    if (!el || !("IntersectionObserver" in window)) return undefined;
    const io = new IntersectionObserver(
      ([entry]) => {
        // on a phone the big cover pushes the button below the first
        // screen, so "away" means out of view in either direction
        setAway(!entry.isIntersecting);
      },
      { threshold: 0 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [targetRef]);

  return (
    <AnimatePresence>
      {away && (
        <motion.div
          className="sread"
          initial={{ y: "110%" }}
          animate={{ y: 0 }}
          exit={{ y: "110%" }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        >
          <span className="sread__cover" aria-hidden="true">
            <Cover
              book={{ slug: BOOK.slug, title: BOOK.title, author: BOOK.byline, cover: "cover.jpg", coverSmall: "cover-sm.jpg" }}
              sizes="40px"
            />
          </span>
          <span className="sread__text">
            <b>{BOOK.title}</b>
            <small>{BOOK.byline}</small>
          </span>
          {owns === false ? (
            <Link className="btn btn--solid sread__btn" to="/checkout?buy=1" onClick={() => addToCart(BOOK.slug)}>
              <IconCart size={18} />
              खरीदिए · {inrShort(BOOK.price.selling)}
            </Link>
          ) : (
            <Link className="btn btn--solid sread__btn" to={`/read/${BOOK.slug}`}>
              <IconEye width={18} height={18} />
              {pct > 0 ? `जारी रखें · ${pct}%` : "पढ़ें"}
            </Link>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
