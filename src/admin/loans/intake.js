// Sending loan documents to the desk (28 Nov 2026): the file's bytes, and a scanned page made small enough for the free
// vision models. The password travels in a header, never in the address.
import { URL_ } from "./shared";

export const ACCEPT = ".pdf,.xlsx,.xls,.csv,.tsv,.docx,.doc,.txt,image/png,image/jpeg,image/webp";
export const MAX_FILE = 7 * 1024 * 1024;
export const MAX_FILES = 12; // reviewed and saved together
export const MAX_TOTAL = 40 * 1024 * 1024;
const PHOTO_KEPT = 3.8 * 1024 * 1024; // a photo is kept as taken, unless it is larger than the desk takes
const PICTURE_MAX = 130 * 1024; // the free vision models take small pictures

/** A picture made small enough, kept as readable as that allows. */
export async function shrinkPicture(file, limit = PICTURE_MAX) {
  if (file.size <= limit || typeof createImageBitmap !== "function") return file;
  try {
    const bmp = await createImageBitmap(file);
    const big = limit > PICTURE_MAX;
    for (const [side, quality] of big ? [[3200, 0.85], [2600, 0.8], [2000, 0.75]] : [[1600, 0.8], [1400, 0.75], [1200, 0.72], [1100, 0.65], [1000, 0.6], [850, 0.55], [700, 0.5]]) {
      const k = Math.min(1, side / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(bmp.width * k));
      c.height = Math.max(1, Math.round(bmp.height * k));
      const g = c.getContext("2d");
      if (!g) return file;
      g.fillStyle = "#fff";
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", quality));
      if (blob && blob.size <= limit) return new File([blob], `${file.name.replace(/\.\w+$/, "")}.jpg`, { type: "image/jpeg" });
    }
  } catch (_) {
    /* the original goes, and the desk says if it is too large */
  }
  return file;
}

const failed = async (res, what) => {
  const d = await res.json().catch(() => null);
  const e = new Error((d && d.message) || `${what} (${res.status}).`);
  e.code = d && d.error;
  return e;
};
const SEND = { "X-Requested-With": "vpt", "Content-Type": "application/octet-stream", Accept: "application/json" };

export async function sendFile(file, { loanId = "", password = "", keep = false } = {}) {
  const res = await fetch(`${URL_}/documents/read?name=${encodeURIComponent(file.name)}${loanId ? `&loanId=${encodeURIComponent(loanId)}` : ""}${keep ? "&keep=1" : ""}`, { method: "POST", credentials: "same-origin", headers: { ...SEND, ...(password ? { "X-Doc-Password": encodeURIComponent(password) } : {}) }, body: file });
  if (!res.ok) throw await failed(res, "The file could not be read");
  return res.json();
}

/** The file as it is kept: a very large photo is made smaller first, everything else goes as it is. */
export const asKept = (file) => (/^image\//.test(file.type) && file.size > PHOTO_KEPT ? shrinkPicture(file, PHOTO_KEPT) : Promise.resolve(file));

/** One scanned page (or a photo): fetched (unless it is in hand), made small, and sent to be read by the free AI. */
export async function readPage(token, page, photo = null) {
  let picture = photo;
  if (!picture) {
    const got = await fetch(`${URL_}/documents/${token}/page/${page}`, { credentials: "same-origin" });
    if (!got.ok) throw await failed(got, `Page ${page} could not be taken out of the file`);
    const blob = await got.blob();
    picture = new File([blob], `page-${page}.${/png/.test(blob.type) ? "png" : "jpg"}`, { type: blob.type });
  }
  const small = await shrinkPicture(picture);
  const res = await fetch(`${URL_}/documents/${token}/page/${page}`, { method: "POST", credentials: "same-origin", headers: SEND, body: small });
  if (!res.ok) throw await failed(res, `Page ${page} could not be read`);
  return res.json();
}
