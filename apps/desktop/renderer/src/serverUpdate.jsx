import React, { useEffect, useRef, useState } from "react";
import { RotateCcw, Download } from "lucide-react";
import { api, toast } from "./core.jsx";
import { BRAND_DOMAIN } from "./brand.js";
import { t as tr, useLanguage, getLanguage } from "./i18n.jsx";

// "Actualizează site-ul" — for the Owner on the aistoica.ro server (also from the Windows app connected to it). The
// site only asks; the server's own update service (deploy/hetzner/install-updater.sh) runs update.sh, which rebuilds
// the site, so the page waits for it to come back and then reloads with the new version.
const when = (iso) => { try { return new Date(iso).toLocaleString(getLanguage(), { dateStyle: "short", timeStyle: "short" }); } catch { return ""; } };

export function ServerUpdate() {
  useLanguage();
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
      if (d.status?.state === "ok") { toast(d.status.version ? tr("The site was updated to version {v}. The page reloads.", { v: d.status.version }) : tr("The site was updated. The page reloads."), "ok"); setTimeout(() => window.location.reload(), 1500); }
      else toast(tr("The site update failed. The details are in Settings → General."));
    }, 5000);
    return () => clearInterval(t);
  }, [waiting]);
  if (!info?.enabled) return null;

  async function start() {
    if (busy || waiting) return;
    if (!confirm(tr("Update the site now? The server downloads the latest version from GitHub and restarts the site (1–5 minutes, during which it does not answer)."))) return;
    setBusy(true);
    try { before.current = info.status?.finishedAt || ""; await api("/api/server/update", { method: "POST", body: "{}" }); setWaiting(true); await load(); }
    catch (e) { toast(tr("Update:") + " " + e.message); }
    finally { setBusy(false); }
  }
  async function setAuto(auto) {
    try { await api("/api/server/update", { method: "PATCH", body: JSON.stringify({ auto }) }); await load(); toast(auto ? tr("The site will update itself when a new version appears (checked once an hour).") : tr("Automatic site updates are off."), "ok"); }
    catch (e) { toast(tr("Automatic update:") + " " + e.message); }
  }

  const a = info.available, s = info.status;
  const installed = s?.version || a?.current?.version || "";
  const newer = a?.behind > 0 ? (a.latest?.version && a.latest.version !== installed ? tr("Version {v} is available.", { v: a.latest.version }) : tr("There are new changes on GitHub.")) : a ? tr("The site has the latest version.") : "";
  return <div className="settingsPrefs serverUpdate">
    <h4>{tr("Site update ({domain})", { domain: BRAND_DOMAIN })}</h4>
    {!info.installed && <p className="settingsHelp">{info.setupHint}</p>}
    {info.installed && <>
      <p className="settingsHelp">
        {installed ? tr("Version on the server: {v}.", { v: installed }) + " " : ""}{newer}
        {a?.checkedAt ? " " + tr("Checked: {when}.", { when: when(a.checkedAt) }) : ""}{a?.error ? " " + a.error : ""}
      </p>
      {waiting && <div className="micStatus" role="status">{tr("Updating the site… it takes 1–5 minutes; the page reloads on its own.")}</div>}
      {!waiting && s?.state === "ok" && s.finishedAt && <div className="micStatus" role="status">{tr("Last update: {when}, successful.", { when: when(s.finishedAt) })}</div>}
      {!waiting && s?.state === "error" && <details className="micStatus serverUpdateError"><summary>{tr("The last update ({when}) failed — details", { when: when(s.finishedAt) })}</summary><pre>{s.log || ""}</pre></details>}
      <div className="settingsButtons">
        <button type="button" className="primary" onClick={start} disabled={busy || waiting}>{waiting ? <RotateCcw size={15} className="spin"/> : <Download size={15}/>} {waiting ? tr("Updating…") : tr("Update the site now")}</button>
      </div>
      <label className="toggleRow"><div><b>{tr("Automatic site update")}</b><span>{tr("The server checks GitHub once an hour and installs the new version on its own.")}</span></div><input type="checkbox" checked={!!info.auto} onChange={(e) => setAuto(e.target.checked)}/></label>
    </>}
  </div>;
}
