// src/components/site/Footer.jsx
import React from "react";
import { scrollToId } from "../../hooks/useSmoothScroll";
import { PROFILE } from "../../data/profile";

export default function Footer({ note }) {
  const year = new Date().getFullYear();
  return (
    <div className="shell">
      <footer className="foot">
        <span>© {year} Vinay Kumar Tiwari</span>
        {note && <span className="foot__hi">{note}</span>}
        <span className="foot__links">
          <a
            className="tlink"
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              scrollToId("top", 0);
            }}
          >
            Top
          </a>
          <a
            className="tlink"
            href="https://btplearninghub.com"
            target="_blank"
            rel="noreferrer"
          >
            btplearninghub.com
          </a>
          <a
            className="tlink"
            href={PROFILE.linkedin}
            target="_blank"
            rel="noreferrer"
          >
            LinkedIn
          </a>
          <a
            className="tlink"
            href={PROFILE.instagram}
            target="_blank"
            rel="noreferrer"
          >
            Instagram
          </a>
          {/* plain <a>, not <Link>: a static file must not be routed by React */}
          <a className="tlink" href="/sitemap.xml">
            Sitemap
          </a>
        </span>
      </footer>
    </div>
  );
}
