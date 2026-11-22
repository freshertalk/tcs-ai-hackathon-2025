// src/components/site/Nav.jsx
// One nav for the one-page site. Links, active-section tracking and the
// call-to-action pill are all driven by props from the page.

import React, { useEffect, useState } from "react";
import { motion, AnimatePresence, useScroll, useSpring } from "framer-motion";
import { EASE } from "../ui/motion";
import { scrollToId } from "../../hooks/useSmoothScroll";
import Picture from "../ui/Picture";

const ICON_KEY = "vpt.loginIcon";

/**
 * Whether the personal sign-in icon is shown. The owner switches it under /me → Personal; the server tells the public site through
 * /api/public-config. The last answer is remembered in this browser so the icon does not flicker on the next visit. Hiding the icon
 * hides only the icon: /me itself always opens.
 */
function useLoginIcon() {
  const [show, setShow] = useState(() => {
    try {
      return window.localStorage.getItem(ICON_KEY) !== "off";
    } catch (_) {
      return true;
    }
  });
  useEffect(() => {
    let alive = true;
    const apply = (on) => {
      if (!alive || typeof on !== "boolean") return;
      setShow(on);
      try {
        window.localStorage.setItem(ICON_KEY, on ? "on" : "off");
      } catch (_) {
        /* private window: no memory */
      }
    };
    const read = () =>
      fetch("/api/public-config", { credentials: "same-origin", headers: { Accept: "application/json" } })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && apply(d.loginIcon))
        .catch(() => {});
    read();
    // INSTANT: the server pushes the owner's switch over one small stream (it carries only this on/off), so an open page changes
    // the moment it is pressed. A slow re-read every minute (and when the tab comes back into view) is the safety net.
    let es = null;
    if (typeof window.EventSource === "function") {
      try {
        es = new window.EventSource("/api/public-stream");
        es.addEventListener("icon", (e) => {
          try {
            apply(JSON.parse(e.data).loginIcon);
          } catch (_) {
            /* a bad message changes nothing */
          }
        });
      } catch (_) {
        es = null;
      }
    }
    const timer = setInterval(() => document.visibilityState !== "hidden" && read(), 60000);
    const onVisible = () => document.visibilityState === "visible" && read();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      if (es) es.close();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return show;
}

export default function Nav({
  links = [],
  kicker = "",
  cta = null, // { id, label } — a pill that scrolls to a section
  contact = {},
}) {
  const [stuck, setStuck] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState("");
  const ctaId = cta?.id;
  const loginIcon = useLoginIcon();

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
    // the CTA's section is observed too, so the underline clears once the
    // reader is past the last link (it matches no link, so nothing is lit)
    [...links.map((l) => l.id), ctaId].filter(Boolean).forEach((id) => {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, [links, ctaId]);

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
          <a href="#top" className="nav__brand" data-cursor="Top" onClick={go("top")}>
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
          </a>

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
            {cta && (
              <a
                className="nav__switch"
                href={`#${cta.id}`}
                onClick={go(cta.id)}
              >
                <i />
                {cta.label}
              </a>
            )}
          </nav>

          <div className="nav__end">
            {/* the personal door: a plain link, so it works before anything has loaded; the page it opens says plainly that it is private */}
            {loginIcon && (
            <a
              className="nav__me"
              href="/me"
              aria-label="Sign in — Vinay's private room"
              title="Private room — sign in"
              rel="nofollow"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="8.2" r="3.6" />
                <path d="M4.6 20c.6-3.8 3.6-6 7.4-6s6.8 2.2 7.4 6" />
              </svg>
            </a>
            )}
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
              {cta && (
                <a
                  className="btn btn--solid"
                  href={`#${cta.id}`}
                  onClick={go(cta.id)}
                >
                  {cta.label}
                </a>
              )}
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
