// src/components/site/Nav.jsx
// One nav, two portfolios. Links, active-section tracking and the
// cross-portfolio switch are all driven by props from the page.

import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence, useScroll, useSpring } from "framer-motion";
import { EASE } from "../ui/motion";
import { scrollToId } from "../../hooks/useSmoothScroll";
import Picture from "../ui/Picture";

export default function Nav({
  links = [],
  kicker = "",
  switchTo = { href: "/", label: "Home" },
  contact = {},
}) {
  const [stuck, setStuck] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState("");

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

  // Track which section is in view for the nav underline.
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
      const el = document.getElementById(id);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, [links]);

  useEffect(() => {
    document.body.classList.toggle("is-locked", open);
    return () => document.body.classList.remove("is-locked");
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    const mql = window.matchMedia("(min-width: 981px)");
    const onWide = (e) => e.matches && setOpen(false);
    window.addEventListener("keydown", onKey);
    mql.addEventListener("change", onWide);
    return () => {
      window.removeEventListener("keydown", onKey);
      mql.removeEventListener("change", onWide);
    };
  }, [open]);

  const go = (id) => (e) => {
    e.preventDefault();
    const wasOpen = open;
    setOpen(false);
    setTimeout(() => scrollToId(id, 62), wasOpen ? 420 : 0);
  };

  return (
    <>
      <motion.div className="progress" style={{ scaleX: bar }} />

      <header className={`nav ${stuck ? "is-stuck" : ""}`}>
        <div className="nav__row">
          <Link to="/" className="nav__brand" data-cursor="Home">
            <span className="nav__mark">
              <Picture
                name="vinay-avatar-sm"
                alt=""
                width="200"
                height="200"
                loading="eager"
                aria-hidden="true"
              />
            </span>
            <span>
              Vinay Kumar Tiwari
              {kicker && <small>{kicker}</small>}
            </span>
          </Link>

          <nav className="nav__links" aria-label="Primary">
            {links.map((l) => (
              <a
                key={l.id}
                href={`#${l.id}`}
                onClick={go(l.id)}
                className={`nav__link ${active === l.id ? "is-active" : ""}`}
              >
                {l.label}
              </a>
            ))}
            <Link className="nav__switch" to={switchTo.href}>
              <i />
              {switchTo.label}
            </Link>
          </nav>

          <button
            className={`nav__burger ${open ? "is-open" : ""}`}
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
          >
            <span />
            <span />
          </button>
        </div>
      </header>

      <AnimatePresence>
        {open && (
          <motion.div
            className="menu"
            initial={{ clipPath: "inset(0 0 100% 0)" }}
            animate={{ clipPath: "inset(0 0 0% 0)" }}
            exit={{ clipPath: "inset(0 0 100% 0)" }}
            transition={{ duration: 0.7, ease: EASE }}
          >
            {links.map((l, i) => (
              <span className="reveal-mask" key={l.id}>
                <motion.a
                  href={`#${l.id}`}
                  onClick={go(l.id)}
                  className="menu__item reveal-line"
                  initial={{ y: "110%" }}
                  animate={{ y: "0%" }}
                  exit={{ y: "110%" }}
                  transition={{ duration: 0.65, ease: EASE, delay: 0.1 + i * 0.055 }}
                >
                  <span className="menu__idx">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {l.label}
                </motion.a>
              </span>
            ))}

            <motion.div
              className="menu__foot"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ delay: 0.4 }}
            >
              <Link
                className="btn btn--solid"
                to={switchTo.href}
                onClick={() => setOpen(false)}
              >
                {switchTo.label}
              </Link>
              {contact.email && (
                <a href={`mailto:${contact.email}`}>{contact.email}</a>
              )}
              {contact.phone && <a href={`tel:${contact.phone}`}>{contact.phone}</a>}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
