// src/shop/CartButton.jsx
// The cart in the navigation bar. It appears only once something is in it.

import React from "react";
import { Link } from "react-router-dom";
import { IconCart } from "../components/ui/icons";
import { useCart } from "./store";

export default function CartButton({ className = "" }) {
  const cart = useCart();
  const n = cart.items.length;
  if (!n) return null;
  return (
    <Link className={`cartb ${className}`} to="/checkout" aria-label={`कार्ट — ${n} किताब`} title="कार्ट देखिए">
      <IconCart size={20} />
      <b>{n}</b>
    </Link>
  );
}
