import React, { useEffect, useRef, useState } from "react";
import { RotateCcw, Download } from "lucide-react";
import { api, toast } from "./core.jsx";

// "Actualizează site-ul" — for the Owner on the aistoica.ro server (also from the Windows app connected to it). The
// site only asks; the server's own update service (deploy/hetzner/install-updater.sh) runs update.sh, which rebuilds
// the site, so the page waits for it to come back and then reloads with the new version.
const when = (iso) => { try { return new Date(iso).toLocaleString("ro-RO", { dateStyle: "short", timeStyle: "short" }); } catch { return ""; } };

export function ServerUpdate() {
  const [info, setInfo] = useState(null), [busy, setBusy] = useState(false), [waiting, setWaiting] = useState(false);
  const before = useRef("");
  async function load() {
    try { const r = await api("/api/server/update"); setInfo(r.data || { enabled: false }); return r.data; }
    catch { return null; }
  }
  useEffect(() => { load().then((d) => { if (d?.status?.state === "running" || d?.pending) { before.current = d?.status?.finishedAt || ""; setWaiting(true); } }); }, []);
  // While it runs the site restarts; keep asking until the result is written, then reload with the new version.
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(async () => {
      const d = await load();
      if (!d || d.pending || d.status?.state === "running" || (d.status?.finishedAt || "") === before.current) return;
      setWaiting(false);
      if (d.status?.state === "ok") { toast(`Site-ul a fost actualizat${d.status.version ? " la versiunea " + d.status.version : ""}. Pagina se reîncarcă.`, "ok"); setTimeout(() => window.location.reload(), 1500); }
      else toast("Actualizarea site-ului a eșuat. Detaliile sunt în Setări → General.");
    }, 5000);
    return () => clearInterval(t);
  }, [waiting]);
  if (!info?.enabled) return null;

  async function start() {
    if (busy || waiting) return;
    if (!confirm("Actualizezi site-ul acum? Serverul descarcă ultima versiune de pe GitHub și repornește site-ul (1–5 minute, timp în care nu răspunde).")) return;
    setBusy(true);
    try { before.current = info.status?.finishedAt || ""; await api("/api/server/update", { method: "POST", body: "{}" }); setWaiting(true); await load(); }
    catch (e) { toast("Actualizare: " + e.message); }
    finally { setBusy(false); }
  }
  async function setAuto(auto) {
    try { await api("/api/server/update", { method: "PATCH", body: JSON.stringify({ auto }) }); await load(); toast(auto ? "Site-ul se va actualiza singur când apare o versiune nouă (verificare o dată pe oră)." : "Actualizarea automată a site-ului e oprită.", "ok"); }
    catch (e) { toast("Actualizare automată: " + e.message); }
  }

  const a = info.available, s = info.status;
  const installed = s?.version || a?.current?.version || "";
  const newer = a?.behind > 0 ? (a.latest?.version && a.latest.version !== installed ? `Versiunea ${a.latest.version} e disponibilă.` : "Există modificări noi pe GitHub.") : a ? "Site-ul are ultima versiune." : "";
  return <div className="settingsPrefs serverUpdate">
    <h4>Actualizare site (aistoica.ro)</h4>
    {!info.installed && <p className="settingsHelp">{info.setupHint}</p>}
    {info.installed && <>
      <p className="settingsHelp">
        {installed ? `Versiunea de pe server: ${installed}. ` : ""}{newer}
        {a?.checkedAt ? ` Verificat: ${when(a.checkedAt)}.` : ""}{a?.error ? " " + a.error : ""}
      </p>
      {waiting && <div className="micStatus" role="status">Se actualizează site-ul… durează 1–5 minute; pagina se reîncarcă singură.</div>}
      {!waiting && s?.state === "ok" && s.finishedAt && <div className="micStatus" role="status">Ultima actualizare: {when(s.finishedAt)}, reușită.</div>}
      {!waiting && s?.state === "error" && <details className="micStatus serverUpdateError"><summary>Ultima actualizare ({when(s.finishedAt)}) a eșuat — detalii</summary><pre>{s.log || ""}</pre></details>}
      <div className="settingsButtons">
        <button type="button" className="primary" onClick={start} disabled={busy || waiting}>{waiting ? <RotateCcw size={15} className="spin"/> : <Download size={15}/>} {waiting ? "Se actualizează…" : "Actualizează site-ul acum"}</button>
      </div>
      <label className="toggleRow"><div><b>Actualizare automată a site-ului</b><span>Serverul verifică o dată pe oră GitHub și instalează singur versiunea nouă.</span></div><input type="checkbox" checked={!!info.auto} onChange={(e) => setAuto(e.target.checked)}/></label>
    </>}
  </div>;
}
