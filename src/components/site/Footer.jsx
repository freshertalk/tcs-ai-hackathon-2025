// src/components/site/Footer.jsx
import React from "react";
import { Link } from "react-router-dom";
import { PUBLISHER } from "../../data/books";

export default function Footer({ note }) {
  const year = new Date().getFullYear();
  return (
    <div className="shell">
      <footer className="foot">
        <span>© {year} Vinay Kumar Tiwari</span>
        <span className="foot__hi">{note ? `${PUBLISHER.name} · ${note}` : PUBLISHER.name}</span>
        <span className="foot__links">
          <Link className="tlink" to="/">
            Home
          </Link>
          <Link className="tlink" to="/library">
            Books
          </Link>
          <Link className="tlink" to="/read/do-kulhad-chai">
            Read
          </Link>
          {/* plain <a>, not <Link>: a static file must not be routed by React */}
          <a className="tlink" href="/sitemap.xml">
            Sitemap
          </a>
        </span>
      </footer>
    </div>
  );
}
