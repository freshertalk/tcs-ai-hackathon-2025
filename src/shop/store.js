// src/shop/store.js
// The cart. It lives in this browser only — a slug and, if one was typed, a
// coupon code. It holds no price: every amount is worked out by the collector
// (scripts/reviews-apps-script.gs) when the checkout page asks for a quote, so
// nothing kept here can change what is charged.

import { useSyncExternalStore } from "react";
import { BOOK } from "../data/books";

const KEY = "vkt.cart.v1";
const EMPTY = Object.freeze({ items: Object.freeze([]), coupon: "" });

function load() {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY));
    if (v && Array.isArray(v.items)) {
      return {
        items: v.items.filter((i) => i && typeof i.slug === "string").slice(0, 5).map((i) => ({ slug: i.slug })),
        coupon: typeof v.coupon === "string" ? v.coupon.toUpperCase().slice(0, 24) : "",
      };
    }
  } catch {
    /* an empty cart */
  }
  return EMPTY;
}

let state = typeof window === "undefined" ? EMPTY : load();
const subs = new Set();

function set(next) {
  state = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* kept for this visit only */
  }
  subs.forEach((fn) => fn());
}

export const cartSnapshot = () => state;

export function inCart(slug = BOOK.slug) {
  return state.items.some((i) => i.slug === slug);
}

export function addToCart(slug = BOOK.slug) {
  if (!inCart(slug)) set({ ...state, items: [...state.items, { slug }] });
}

export function removeFromCart(slug = BOOK.slug) {
  const items = state.items.filter((i) => i.slug !== slug);
  set({ items, coupon: items.length ? state.coupon : "" });
}

export function setCartCoupon(code) {
  const c = String(code || "").toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 24);
  if (c !== state.coupon) set({ ...state, coupon: c });
}

export function clearCart() {
  set(EMPTY);
}

function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

if (typeof window !== "undefined") {
  // another tab changed the cart
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) {
      state = load();
      subs.forEach((fn) => fn());
    }
  });
}

export function useCart() {
  return useSyncExternalStore(subscribe, cartSnapshot, () => EMPTY);
}
