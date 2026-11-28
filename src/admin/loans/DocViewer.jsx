// A kept loan document, shown inside the app (28 Nov 2026): a PDF or a picture as it is, a sheet as its rows, a Word or
// text file as its words — with Download beside it. The file is read from the database only when asked for.
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { Alert } from "../ui";
import { URL_, useHidden, when } from "./shared";

const SHOWABLE = /^(application\/pdf|image\/(png|jpeg|gif|webp))$/;

export default function DocViewer({ loan, doc, onClose }) {
  const [view, setView] = useState(null);
  const [url, setUrl] = useState("");
  const [err, setErr] = useState("");
  const box = useRef(null);
  const h = useHidden();
  const href = `${URL_}/${loan.id}/documents/${doc.id}`;

  useEffect(() => {
    let alive = true;
    let made = "";
    (async () => {
      try {
        const v = await api(`${href}/view`);
        if (!alive) return;
        if (v.show === "pdf" || v.show === "image") {
          const res = await fetch(href, { credentials: "same-origin" });
          if (!res.ok) throw new Error(`The server answered ${res.status}.`);
          // shown only as a PDF or a picture, whatever else it might claim to be
          const type = v.show === "pdf" ? "application/pdf" : SHOWABLE.test(v.mime) ? v.mime : "image/jpeg";
          made = URL.createObjectURL(new Blob([await res.arrayBuffer()], { type }));
          if (!alive) return URL.revokeObjectURL(made);
          setUrl(made);
        }
        setView(v);
      } catch (e) {
        if (alive) setErr(`The document could not be opened: ${e.message}`);
      }
      return undefined;
    })();
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [href]);

  useEffect(() => {
    const key = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => box.current && box.current.focus(), 30);
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = before;
      clearTimeout(t);
    };
  }, [onClose]);

  const node = (
    <div className="tr-modal lo-modal lo-viewer" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section ref={box} tabIndex={-1} className="tr-dialog lo-view" role="dialog" aria-modal="true" aria-label={`Document: ${doc.name}`}>
        <header>
          <div>
            <h3>{doc.name}</h3>
            <p className="lo-note">
              {doc.docLabel} · {loan.name} · saved {when(doc.uploadedAt)}
            </p>
          </div>
          <span className="lo-acts">
            {url && (
              <a className="adm-btn adm-btn--ghost adm-btn--sm" href={url} target="_blank" rel="noopener noreferrer">
                Open in a new tab
              </a>
            )}
            <a className="adm-btn adm-btn--ghost adm-btn--sm" href={href} download>
              Download
            </a>
            <button type="button" className="adm-btn adm-btn--solid adm-btn--sm" onClick={onClose}>
              Close
            </button>
          </span>
        </header>
        <Alert>{err}</Alert>
        {!view && !err && <p className="lo-note">Opening from the database…</p>}
        {view && view.show === "pdf" && url && (
          <>
            {view.locked && <p className="lo-note">This PDF is kept as it came, locked: the viewer asks for its password.</p>}
            <iframe className="lo-view__frame" title={doc.name} src={url} />
          </>
        )}
        {view && view.show === "image" && url && <img className="lo-view__img" src={url} alt={doc.name} />}
        {view && view.show === "table" && (
          <div className="lo-view__scroll">
            <table className="lo-view__table">
              <caption className="adm-sr">{doc.name}</caption>
              <tbody>
                {view.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((c, j) => (
                      <td key={j}>{h(c)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {view.more ? <p className="lo-note">{view.more} more rows are in the file: download it to see them.</p> : null}
          </div>
        )}
        {view && view.show === "text" && <pre className="lo-view__text">{h(view.text)}</pre>}
        {view && view.show === "none" && <p className="lo-note">This file cannot be shown here ({view.why.replace(/\.$/, "")}). Download it to open it on your computer.</p>}
      </section>
    </div>
  );
  const root = typeof document !== "undefined" ? document.querySelector(".adm") : null;
  return root ? createPortal(node, root) : node;
}
