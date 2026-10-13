// src/sections/write/Teaser.jsx
// The back-cover moment.
//
// Three short beats land one after another, the question follows, and then
// the invitation. It closes the page: by now the reader has met the story,
// its lines, its readers and its author — this is where they are asked to
// commit. Someone who owns the book is offered the reader; everyone else,
// the way to buy it, with the first page one tap away.

import React from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Reveal, Magnetic, EASE } from "../../components/ui/motion";
import Kulhad from "../../components/site/Kulhad";
import { IconEye } from "../../reader/icons";
import { IconCart } from "../../components/ui/icons";
import { useOwns } from "../../shop/BuyBar";
import { addToCart } from "../../shop/store";
import { inrShort } from "../../shop/format";
import { BOOK } from "../../data/books";

const T = BOOK.teaser;

export default function Teaser() {
  const owns = useOwns(BOOK.slug);

  return (
    <section className="tz" id="teaser">
      <span className="tz__glow" aria-hidden="true" />

      <div className="shell shell--narrow tz__inner">
        {/* three beats, struck one at a time */}
        <p className="tz__beats">
          {T.beats.map((b, i) => (
            <motion.span
              className="tz__beat"
              key={b}
              initial={{ opacity: 0, y: 22, filter: "blur(6px)" }}
              whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              viewport={{ once: true, amount: 0.6 }}
              transition={{ duration: 0.8, delay: i * 0.28, ease: EASE }}
            >
              {b}
            </motion.span>
          ))}
        </p>

        <Reveal delay={0.9} y={24}>
          <p className="tz__q">{T.question}</p>
        </Reveal>

        <Reveal delay={1.05} y={20}>
          <div className="tz__cups" aria-hidden="true">
            <Kulhad size={54} steamColor="#f3d9b5" steamOpacity={0.42} />
            <Kulhad size={44} steamColor="#f3d9b5" steamOpacity={0.3} />
          </div>
        </Reveal>

        <Reveal delay={1.15} y={20}>
          <p className="tz__cta">
            {T.cta} — <strong>{T.ctaBook}</strong>
          </p>
          <p className="tz__by">{T.by}</p>
        </Reveal>

        <Reveal delay={1.3} className="tz__actions">
          <Magnetic>
            {owns ? (
              <Link className="btn btn--lg tz__btn tz__btn--main" to={`/read/${BOOK.slug}`} data-cursor="पढ़िए">
                <IconEye width={20} height={20} />
                उपन्यास पढ़ें
              </Link>
            ) : (
              <Link
                className="btn btn--lg tz__btn tz__btn--main"
                to="/checkout?buy=1"
                onClick={() => addToCart(BOOK.slug)}
                data-cursor="खरीदिए"
              >
                <IconCart size={19} />
                अभी खरीदिए · {inrShort(BOOK.price.selling)}
              </Link>
            )}
          </Magnetic>
          <a className="tz__alt" href="#opening">
            पहला पन्ना पढ़िए
          </a>
        </Reveal>
      </div>
    </section>
  );
}
