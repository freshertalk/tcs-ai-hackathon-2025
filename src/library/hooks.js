// src/library/hooks.js
import { useEffect, useState } from "react";
import { peekCatalog, getCatalog, peekBook, getBookFresh } from "./api";
import { getProgress, onProgressChange } from "./progress";

/** { data, error } — data is available on the first render when seeded. */
export function useCatalog() {
  const [state, setState] = useState(() => ({ data: peekCatalog(), error: null }));

  useEffect(() => {
    if (state.data) return undefined;
    let live = true;
    getCatalog()
      .then((data) => live && setState({ data, error: null }))
      .catch((error) => live && setState({ data: null, error }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}

/**
 * One book's metadata. Whatever is seeded or cached is used immediately, then
 * revalidated against the server — so a replaced EPUB is picked up by the next
 * visit, and a stale prerendered page can never pin an old edition.
 */
export function useBook(slug) {
  const [state, setState] = useState(() => ({ slug, data: peekBook(slug), error: null }));

  useEffect(() => {
    let live = true;
    const hit = peekBook(slug);
    setState({ slug, data: hit, error: null });

    getBookFresh(slug)
      .then((data) => {
        if (!live) return;
        // same edition: keep the object we already render from
        setState((cur) =>
          cur.slug === slug && cur.data && cur.data.version === data.version
            ? cur
            : { slug, data, error: null }
        );
      })
      .catch((error) => live && !hit && setState({ slug, data: null, error }));

    return () => {
      live = false;
    };
  }, [slug]);

  // never hand back a previous book's data under a new slug
  return state.slug === slug ? state : { slug, data: peekBook(slug), error: null };
}

/** The saved reading position for one book, live across tabs. */
export function useProgress(slug) {
  const [p, setP] = useState(null);

  useEffect(() => {
    const read = () => setP(getProgress(slug));
    read();
    return onProgressChange(read);
  }, [slug]);

  return p;
}
