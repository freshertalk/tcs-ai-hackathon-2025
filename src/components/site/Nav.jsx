// src/components/site/Nav.jsx
// One nav for the whole author site. Entries are either in-page anchors
// ({ id, label }) that scroll and track the section in view, or routes
// ({ to, label }) that navigate. `cta` is the one highlighted action.

import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence, useScroll, useSpring } from "framer-motion";
import { EASE } from "../ui/motion";
import { scrollToId } from "../../hooks/useSmoothScroll";
import { KulhadPair } from "./Kulhad";
import SocialIcons from "./SocialIcons";
import { IconEye } from "../../reader/icons";

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
      const el = id && document.getElementById(id);
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

      <header className={`nav ${stuck ? "is-stuck" : ""} ${tone === "dark" ? "nav--dark" : ""}`}>
        <div className="nav__row">
          <Link to="/" className="nav__brand" data-cursor="Home">
            <span className="nav__cup" aria-hidden="true">
              <KulhadPair size={46} />
            </span>
            <span className="nav__name">
              दो कुल्हड़ चाय
              <small>{kicker || "विनय कुमार तिवारी"}</small>
            </span>
          </Link>

          <nav className="nav__links" aria-label="Primary">
            {links.map((l) =>
              l.to ? (
                <Link key={l.to + l.label} to={l.to} className="nav__link">
                  {l.label}
                </Link>
              ) : (
                <a
                  key={l.id}
                  href={`#${l.id}`}
                  onClick={go(l.id)}
                  className={`nav__link ${active === l.id ? "is-active" : ""}`}
                >
                  {l.label}
                </a>
              )
            )}
            {cta && (
              <Link className="nav__switch nav__switch--cta" to={cta.href}>
                <IconEye width={16} height={16} />
                {cta.label}
              </Link>
            )}
          </nav>

          <div className="nav__end">
            <SocialIcons className="nav__social" size="sm" />
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
              <span className="reveal-mask" key={l.id || l.to + l.label}>
                {l.to ? (
                  <motion.span
                    initial={{ y: "110%" }}
                    animate={{ y: "0%" }}
                    exit={{ y: "110%" }}
                    transition={{ duration: 0.65, ease: EASE, delay: 0.1 + i * 0.055 }}
                    style={{ display: "block" }}
                    className="reveal-line"
                  >
                    <Link to={l.to} onClick={() => setOpen(false)} className="menu__item">
                      <span className="menu__idx">{String(i + 1).padStart(2, "0")}</span>
                      {l.label}
                    </Link>
                  </motion.span>
                ) : (
                  <motion.a
                    href={`#${l.id}`}
                    onClick={go(l.id)}
                    className="menu__item reveal-line"
                    initial={{ y: "110%" }}
                    animate={{ y: "0%" }}
                    exit={{ y: "110%" }}
                    transition={{ duration: 0.65, ease: EASE, delay: 0.1 + i * 0.055 }}
                  >
                    <span className="menu__idx">{String(i + 1).padStart(2, "0")}</span>
                    {l.label}
                  </motion.a>
                )}
              </span>
            ))}

            <motion.div
              className="menu__foot"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ delay: 0.4 }}
            >
              <SocialIcons className="menu__social" />
              {cta && (
                <Link className="btn btn--solid" to={cta.href} onClick={() => setOpen(false)}>
                  {cta.label}
                </Link>
              )}
              {contact.email && <a href={`mailto:${contact.email}`}>{contact.email}</a>}
              {contact.phone && <a href={`tel:${contact.phone}`}>{contact.phone}</a>}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
