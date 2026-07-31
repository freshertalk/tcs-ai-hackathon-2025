// src/components/site/Nav.jsx
import React, { useEffect, useState } from "react";
import { motion, AnimatePresence, useScroll, useSpring } from "framer-motion";
import { EASE } from "../ui/motion";
import { scrollToId } from "../../hooks/useSmoothScroll";
import { PROFILE } from "../../data/profile";
import Picture from "../ui/Picture";

const LINKS = [
  { id: "intro", label: "About" },
  { id: "book", label: "The Novel" },
  { id: "craft", label: "Engineering" },
  { id: "work", label: "Experience" },
  { id: "projects", label: "Projects" },
  { id: "assistant", label: "Ask AI" },
  { id: "contact", label: "Contact" },
];

export default function Nav() {
  const [stuck, setStuck] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState("");

  const { scrollYProgress } = useScroll();
  const bar = useSpring(scrollYProgress, { stiffness: 260, damping: 40, mass: 0.3 });

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
    LINKS.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    document.body.classList.toggle("is-locked", open);
    return () => document.body.classList.remove("is-locked");
  }, [open]);

  // Escape closes the mobile menu; also close it if the viewport grows
  // past the breakpoint while it's open (rotate a phone into landscape).
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    const mql = window.matchMedia("(min-width: 901px)");
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
    setOpen(false);
    // let the menu close before scrolling
    setTimeout(() => scrollToId(id, 60), open ? 420 : 0);
  };

  return (
    <>
      <motion.div className="progress" style={{ scaleX: bar }} />

      <header className={`nav ${stuck ? "is-stuck" : ""}`}>
        <div className="nav__row">
          <a
            href="#top"
            className="nav__brand"
            onClick={(e) => {
              e.preventDefault();
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            data-cursor="Top"
          >
            <span className="nav__mark nav__mark--photo">
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
              Vinay <span style={{ color: "var(--ink-3)" }}>Kumar</span> Tiwari
            </span>
          </a>

          <nav className="nav__links" aria-label="Primary">
            {LINKS.map((l) => (
              <a
                key={l.id}
                href={`#${l.id}`}
                onClick={go(l.id)}
                className={`nav__link ${active === l.id ? "is-active" : ""}`}
              >
                {l.label}
              </a>
            ))}
            <a className="nav__cta" href="#contact" onClick={go("contact")}>
              <span className="hero__dot" />
              Available
            </a>
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
            transition={{ duration: 0.75, ease: EASE }}
          >
            {LINKS.map((l, i) => (
              <span className="reveal-mask" key={l.id}>
                <motion.a
                  href={`#${l.id}`}
                  onClick={go(l.id)}
                  className="menu__item reveal-line"
                  initial={{ y: "110%" }}
                  animate={{ y: "0%" }}
                  exit={{ y: "110%" }}
                  transition={{ duration: 0.7, ease: EASE, delay: 0.12 + i * 0.06 }}
                >
                  <span className="menu__idx">0{i + 1}</span>
                  {l.label}
                </motion.a>
              </span>
            ))}

            <motion.div
              className="menu__foot"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ delay: 0.45 }}
            >
              <a className="btn btn--solid menu__cta" href={`mailto:${PROFILE.email}`}>
                {PROFILE.email}
              </a>
              <a className="menu__meta" href={`tel:${PROFILE.phone}`}>
                {PROFILE.phone}
              </a>
              <span className="menu__meta">{PROFILE.location}</span>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
