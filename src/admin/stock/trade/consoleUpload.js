// Sends one Zerodha Console file (.xlsx or .csv) to the server in parts and has it read by what it is — a tradebook or a
// ledger (the file's own headers say which). @returns the server's answer: { type: "tradebook" | "ledger", … }
import { api } from "../../api";

export const CONSOLE_FILE = /\.(csv|xlsx|txt)$/i;

export async function uploadConsoleFile(file, onPct = () => {}) {
  const st = await api("/api/admin/trading/journal/upload", { method: "POST", body: { name: file.name, size: file.size } });
  for (let i = 0, k = 0; i < file.size; i += st.partSize, k += 1) {
    const blob = file.slice(i, i + st.partSize);
    const res = await fetch(`/api/admin/trading/journal/upload/${st.id}/${k}`, { method: "PUT", credentials: "same-origin", headers: { "X-Requested-With": "vpt", "Content-Type": "application/octet-stream", Accept: "application/json" }, body: blob });
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      throw new Error((d && d.message) || `The upload failed (${res.status}).`);
    }
    onPct(Math.round(((i + blob.size) / file.size) * 100));
  }
  return api(`/api/admin/trading/journal/upload/${st.id}/finish-console`, { method: "POST", body: {} });
}
