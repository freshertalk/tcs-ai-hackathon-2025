// Files attached to a TradeAI question (26 Nov 2026): images, Word, Excel, PowerPoint, CSV and text — chosen with the paperclip,
// dropped on the box, or pasted (a screenshot from the clipboard, a copied file, or a very long text). Each goes to the server as soon
// as it is added (server/ai/attach.js reads it and says what it found); the question then carries only the ids.
export const ACCEPT = "image/*,.png,.jpg,.jpeg,.webp,.gif,.docx,.xlsx,.pptx,.csv,.tsv,.txt,.md,.json,.xml,.html,.log,.pdf,.doc,.xls,.ppt";
export const MAX_FILES = 6;
export const MAX_BYTES = 7 * 1024 * 1024;
export const LONG_PASTE = 3500; // a longer pasted text becomes a file, as in ChatGPT and Claude
const IMAGE = /^image\/(png|jpe?g|webp|gif)$/i;
const SHRINK_ABOVE = 700 * 1024;
const SIDE = 1600;

export const sizeText = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);
export const isImage = (f) => IMAGE.test(f.type || "") || /\.(png|jpe?g|webp|gif)$/i.test(f.name || "");

/** A pasted screenshot arrives as "image.png": give it a name that says when. */
export function nameOf(f, i = 0) {
  if (f.name && !/^image\.(png|jpe?g)$/i.test(f.name)) return f.name;
  const ext = /jpe?g/i.test(f.type || "") ? "jpg" : (String(f.type || "").split("/")[1] || "png").replace("jpeg", "jpg");
  const t = new Date();
  const pad = (x) => String(x).padStart(2, "0");
  return `pasted-image-${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}${i ? `-${i + 1}` : ""}.${ext}`;
}

/** A big picture is shrunk before it goes (a phone photo is several MB; the model needs far less). Falls back to the original. */
export async function prepareImage(file) {
  try {
    if (file.size <= SHRINK_ABOVE && IMAGE.test(file.type || "")) return file;
    if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, SIDE / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * k));
    c.height = Math.max(1, Math.round(bmp.height * k));
    const g = c.getContext("2d");
    if (!g) return file;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
    return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  } catch (_) {
    return file;
  }
}

/** Send one file; @returns the server's description { id, kind, name, chars?, truncated?, preview? } or throws with a sentence. */
export async function uploadFile(file) {
  const res = await fetch(`/api/admin/tradeai/attach?name=${encodeURIComponent(file.name)}`, { method: "POST", credentials: "same-origin", headers: { "X-Requested-With": "vpt", "Content-Type": "application/octet-stream", Accept: "application/json" }, body: file });
  const d = await res.json().catch(() => null);
  if (!res.ok) throw new Error((d && d.message) || `The file could not be attached (${res.status}).`);
  return d.file;
}

export async function dropFile(id) {
  try {
    await fetch(`/api/admin/tradeai/attach/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "same-origin", headers: { "X-Requested-With": "vpt", Accept: "application/json" } });
  } catch (_) {
    /* the server forgets it after a few hours anyway */
  }
}
