// src/components/site/Footer.jsx
import React from "react";
import { Link } from "react-router-dom";

export default function Footer({ note, switchTo }) {
  const year = new Date().getFullYear();
  return (
    <div className="shell">
      <footer className="foot">
        <span>© {year} Vinay Kumar Tiwari</span>
        {note && <span className="foot__hi">{note}</span>}
        <span className="foot__links">
          <Link className="tlink" to="/">
            Home
          </Link>
          {switchTo && (
            <Link className="tlink" to={switchTo.href}>
              {switchTo.label}
            </Link>
          )}
          <a
            className="tlink"
            href="https://btplearninghub.com"
            target="_blank"
            rel="noreferrer"
          >
            btplearninghub.com
          </a>
        </span>
      </footer>
    </div>
  );
}
