// src/components/site/Nav.jsx
// One nav for the whole author site. Entries are either in-page anchors
// ({ id, label }) that scroll and track the section in view, or routes
// ({ to, label }) that navigate. `cta` is the one highlighted action.
//
// The bar has three parts: the brand, the links, and the person's own things
// (the action, the cart, the account, the social links). On a narrow screen
// the links fold into a menu that opens under the bar: the same links as
// rows, then the action, the account and the social links.
//
// The action follows the reader: someone who owns the book is offered the
// reader; anyone else, the way to buy it. (A "read" button that leads a
// visitor to a wall is not an action.)

import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { motion, AnimatePresence, useScroll, useSpring } from "framer-motion";
import { scrollToId } from "../../hooks/useSmoothScroll";
import ChaiMark from "./ChaiMark";
import SocialIcons from "./SocialIcons";
import { AccountButton } from "../../auth/Account";
import { signOut, useAuth } from "../../auth/google";
import { openSignIn } from "../../auth/SignInDialog";
import { useMe } from "../../account/me";
import CartButton from "../../shop/CartButton";
import { useOwns } from "../../shop/BuyBar";
import { addToCart } from "../../shop/store";
import { inrShort } from "../../shop/format";
import { IconEye } from "../../reader/icons";
import { IconCart, IconDashboard, IconShield, IconSignOut, IconUser } from "../ui/icons";
import { BOOK } from "../../data/books";

const WIDE = "(min-width: 1100px)"; // the links are in the bar from here up

/** The highlighted action: read, or — for someone who does not own the book — buy. */
function Action({ cta, owns, className, onGo }) {
  if (!cta) return null;
  const ours = String(cta.href).indexOf(`/read/${BOOK.slug}`) === 0;
  if (ours && owns === null) return null; // not known yet: say nothing rather than guess
  if (ours && owns === false && BOOK.price) {
    return (
      <Link
        className={className}
        to="/checkout?buy=1"
        onClick={() => {
          addToCart(BOOK.slug);
          if (onGo) onGo();
        }}
        data-cursor="खरीदिए"
      >
        <IconCart size={17} />
        खरीदिए · {inrShort(BOOK.price.selling)}
      </Link>
    );
  }
  return (
    <Link className={className} to={cta.href} onClick={onGo}>
      <IconEye width={17} height={17} />
      {cta.label}
    </Link>
  );
}

const Chevron = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 5l7 7-7 7" />
  </svg>
);

export default function Nav({
  links = [],
  kicker = "",
  cta = null,
  contact = {},
  tone = "light", // "dark": the page opens on a dark band, so type is light until it scrolls
}) {
  const [stuck, setStuck] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState("");
  const { pathname } = useLocation();
  const { user, configured } = useAuth();
  const { isAdmin } = useMe();
  const owns = useOwns(BOOK.slug);
  const burger = useRef(null);
  const panel = useRef(null);

  const { scrollYProgress } = useScroll();
  const bar = useSpring(scrollYProgress, {
    stiffness: 260,
    damping: 40,
    mass: 0.3,
  });

  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Track which section is in view, to mark its link.
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) setActive(en.target.id);
        });
      },
      { rootMargin: "-45% 0px -50% 0px" }
    );
    links.forEach(({ id }) => {
      const el = id && document.getElementById(id);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, [links]);

  useEffect(() => {
    document.body.classList.toggle("is-locked", open);
    return () => document.body.classList.remove("is-locked");
  }, [open]);

  // While the menu is open: Escape closes it (and hands focus back to its
  // button), and a screen that grows wide enough for the bar's own links
  // closes it too. Opening it moves focus into the sheet (the sheet itself, so
  // no row looks chosen), and Tab goes on to its first row.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      if (burger.current) burger.current.focus();
    };
    const mql = window.matchMedia(WIDE);
    const onWide = (e) => e.matches && setOpen(false);
    window.addEventListener("keydown", onKey);
    mql.addEventListener("change", onWide);
    if (panel.current) panel.current.focus({ preventScroll: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      mql.removeEventListener("change", onWide);
    };
  }, [open]);

  const close = () => setOpen(false);

  const go = (id) => (e) => {
    e.preventDefault();
    const wasOpen = open;
    setOpen(false);
    // the page is locked while the menu is open; scroll once it has let go
    setTimeout(() => scrollToId(id, 62), wasOpen ? 260 : 0);
  };

  const isHere = (l) => (l.to ? pathname === l.to : active === l.id);

  return (
    <>
      <motion.div className="progress" style={{ scaleX: bar }} />

      <header className={`nav ${stuck ? "is-stuck" : ""} ${open ? "is-open" : ""} ${tone === "dark" ? "nav--dark" : ""}`}>
        <div className="nav__row">
          <Link to="/" className="nav__brand" data-cursor="Home" onClick={close}>
            <span className="nav__cup" aria-hidden="true">
              <ChaiMark size={52} />
            </span>
            <span className="nav__name">
              दो कुल्हड़ चाय
              <small>{kicker || "विनय कुमार तिवारी"}</small>
            </span>
          </Link>

          <nav className="nav__links" aria-label="Primary">
            {links.map((l) =>
              l.to ? (
                <Link
                  key={l.to + l.label}
                  to={l.to}
                  className={`nav__link ${isHere(l) ? "is-active" : ""}`}
                  aria-current={isHere(l) ? "page" : undefined}
                >
                  {l.label}
                </Link>
              ) : (
                <a key={l.id} href={`#${l.id}`} onClick={go(l.id)} className={`nav__link ${isHere(l) ? "is-active" : ""}`}>
                  {l.label}
                </a>
              )
            )}
          </nav>

          <div className="nav__end">
            <Action cta={cta} owns={owns} className="nav__cta" />
            <CartButton className="nav__cart" />
            <AccountButton className="nav__acct" />
            <SocialIcons className="nav__social" size="sm" />
            <button
              ref={burger}
              type="button"
              className={`nav__burger ${open ? "is-open" : ""}`}
              onClick={() => setOpen((v) => !v)}
              aria-label={open ? "मेन्यू बंद कीजिए" : "मेन्यू खोलिए"}
              aria-expanded={open}
              aria-controls="site-menu"
            >
              <span />
              <span />
              <span />
            </button>
          </div>
        </div>
      </header>

      <AnimatePresence>
        {open && (
          <motion.div
            className="menu"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <button type="button" className="menu__scrim" aria-label="मेन्यू बंद कीजिए" tabIndex={-1} onClick={close} />

            <motion.div
              id="site-menu"
              className="menu__panel"
              ref={panel}
              tabIndex={-1}
              data-lenis-prevent
              initial={{ y: -12 }}
              animate={{ y: 0 }}
              exit={{ y: -12 }}
              transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            >
              <nav aria-label="मेन्यू">
                <ul className="menu__list">
                  {links.map((l) => (
                    <li key={l.id || l.to + l.label}>
                      {l.to ? (
                        <Link
                          to={l.to}
                          onClick={close}
                          className={`menu__item ${isHere(l) ? "is-active" : ""}`}
                          aria-current={isHere(l) ? "page" : undefined}
                        >
                          {l.label}
                          <Chevron />
                        </Link>
                      ) : (
                        <a href={`#${l.id}`} onClick={go(l.id)} className={`menu__item ${isHere(l) ? "is-active" : ""}`}>
                          {l.label}
                          <Chevron />
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </nav>

              <Action cta={cta} owns={owns} className="nav__cta menu__cta" onGo={close} />

              {configured && (
                <div className="menu__acct">
                  {user ? (
                    <>
                      <p className="menu__who">
                        {user.picture ? (
                          <img src={user.picture} alt="" width="40" height="40" referrerPolicy="no-referrer" />
                        ) : (
                          <span className="menu__ini" aria-hidden="true">
                            {String(user.name || "?").slice(0, 1)}
                          </span>
                        )}
                        <span>
                          <b>{user.name}</b>
                          <small>{user.email}</small>
                        </span>
                      </p>
                      <Link to="/account" className="menu__row" onClick={close}>
                        <IconDashboard size={19} /> मेरा खाता
                      </Link>
                      {isAdmin && (
                        <Link to="/admin" className="menu__row" onClick={close}>
                          <IconShield size={19} /> एडमिन डैशबोर्ड
                        </Link>
                      )}
                      <button
                        type="button"
                        className="menu__row menu__row--out"
                        onClick={() => {
                          close();
                          signOut();
                        }}
                      >
                        <IconSignOut size={19} /> साइन-आउट
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="menu__row"
                      onClick={() => {
                        close();
                        openSignIn();
                      }}
                    >
                      <IconUser size={19} /> साइन इन कीजिए
                    </button>
                  )}
                </div>
              )}

              <div className="menu__foot">
                <SocialIcons className="menu__social" size="sm" />
                {contact.email && <a href={`mailto:${contact.email}`}>{contact.email}</a>}
                {contact.phone && <a href={`tel:${contact.phone}`}>{contact.phone}</a>}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
