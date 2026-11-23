// The account menu (24 Nov 2026): your photo (or your initial) at the right end of every header — the private area's pages
// (Shell.jsx) and the trading terminal (TopBar.jsx). Pointing at it or pressing it opens a small soft card: your full name,
// your email and role, My profile (/me/account), whatever the page adds (the terminal adds Dashboard and Hover help), and
// Sign out. The owner's ask: no full name and no "Sign out" button standing in the header — the photo stands for you, and
// the rest is one press away.
//
// Keyboard: Enter, Space or ↓ opens it and moves to the first item; ↑ ↓ move between items; Escape closes it and returns
// to the photo. A pointer leaving the menu closes it after a short pause (so a slightly wobbly mouse does not shut it), a
// press anywhere else closes it at once. Touch screens open it with a tap.
import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "./api";
import { useAuth } from "./auth";
import { adminPath } from "./paths";
import { PrivacyToggle } from "./privacy";
import "./account-menu.css";

export const roleLabel = (u) => (!u ? "" : u.owner ? "Owner" : u.role === "superadmin" ? "Superadmin" : "Admin");
const initialOf = (u) => String((u && (u.name || u.email)) || "·").trim().slice(0, 1).toUpperCase();

/** The photo, or the initial on a soft disc. */
export function Avatar({ user, size = 32 }) {
  if (user && user.picture) return <img className="acm-av" src={user.picture} alt="" referrerPolicy="no-referrer" width={size} height={size} style={{ width: size, height: size }} />;
  return (
    <span className="acm-av acm-av--ph" aria-hidden="true" style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}>
      {initialOf(user)}
    </span>
  );
}

/**
 * @param extra  (close) => menu items to add between My profile and Sign out; each should carry role="menuitem" and call
 *               close() when it acts
 */
export default function AccountMenu({ extra = null, className = "" }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef(null);
  const btn = useRef(null);
  const menu = useRef(null);
  const leaveTimer = useRef(null);
  const id = useId();
  const menuId = `acm-${id.replace(/[^a-z0-9]/gi, "")}`;

  const close = useCallback((focusBack = false) => {
    setOpen(false);
    if (focusBack && btn.current) btn.current.focus();
  }, []);
  const items = () => (menu.current ? [...menu.current.querySelectorAll('[role^="menuitem"]')] : []);
  const focusItem = (i) => {
    const list = items();
    if (!list.length) return;
    list[(i + list.length) % list.length].focus();
  };

  // a press anywhere else closes it; Escape closes it and returns to the photo
  useEffect(() => {
    if (!open) return undefined;
    const off = (e) => box.current && !box.current.contains(e.target) && close();
    const key = (e) => {
      if (e.key === "Escape") close(true);
    };
    document.addEventListener("pointerdown", off);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", off);
      document.removeEventListener("keydown", key);
    };
  }, [open, close]);
  useEffect(() => () => clearTimeout(leaveTimer.current), []);

  if (!user) return null;
  const fine = () => typeof window !== "undefined" && window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const enter = () => {
    clearTimeout(leaveTimer.current);
    if (fine()) setOpen(true);
  };
  const leave = () => {
    if (!fine()) return;
    clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => setOpen(false), 220);
  };
  const onBtnKey = (e) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(true);
      setTimeout(() => focusItem(0), 0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setTimeout(() => focusItem(-1), 0);
    }
  };
  const onMenuKey = (e) => {
    const list = items();
    const i = list.indexOf(document.activeElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusItem(i + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusItem(i - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusItem(0);
    } else if (e.key === "End") {
      e.preventDefault();
      focusItem(-1);
    } else if (e.key === "Tab") {
      close();
    }
  };
  const logout = async () => {
    setBusy(true);
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.assign(adminPath());
    }
  };
  const role = roleLabel(user);

  return (
    <div className={`acm ${open ? "is-open" : ""} ${className}`.trim()} ref={box} onMouseEnter={enter} onMouseLeave={leave}>
      <button
        ref={btn}
        type="button"
        className="acm__btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Account menu: ${user.name || user.email || "you"}`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onBtnKey}
        data-tip=""
      >
        <Avatar user={user} size={32} />
      </button>
      {open && (
        <div className="acm__menu" role="menu" id={menuId} aria-label="Account" ref={menu} onKeyDown={onMenuKey}>
          <div className="acm__who">
            <Avatar user={user} size={44} />
            <div className="acm__whotxt">
              <b>{user.name || "Signed in"}</b>
              {user.email && <small>{user.email}</small>}
              {role && <span className={`acm__role acm__role--${role.toLowerCase()}`}>{role}</span>}
            </div>
          </div>
          <Link role="menuitem" className="acm__item" to={adminPath("/account")} onClick={() => close()}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6" />
            </svg>
            <span>My profile</span>
          </Link>
          {typeof extra === "function" ? extra(() => close()) : extra}
          <PrivacyToggle variant="item" />
          <button type="button" role="menuitem" className="acm__item acm__item--out" onClick={logout} disabled={busy}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10" />
            </svg>
            <span>{busy ? "Signing out…" : "Sign out"}</span>
          </button>
        </div>
      )}
    </div>
  );
}
