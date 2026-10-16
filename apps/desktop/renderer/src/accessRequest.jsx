import React, { useEffect, useState } from "react";
import { Bell, BellOff, Check, Send, X } from "lucide-react";
import { GATEWAY, IS_WEB, Modal, api } from "./core.jsx";
import { BRAND_NAME, BRAND_DOMAIN } from "./brand.js";

// Owner's phone notifications (Web Push) for new accounts, and the page the notification opens.
// The notification carries a one-time link (?access=<token>); Permite / Refuză work with it alone, even without login,
// because on iPhone a tap opens the app and on Android the buttons answer from the service worker.

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
const pushSupported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function keyBytes(base64) {
  const padded = (base64 + "=".repeat((4 - base64.length % 4) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

async function accessCall(token, init) {
  const r = await fetch(`${GATEWAY}/auth/access-requests/${encodeURIComponent(token)}`, { ...init, headers: { "Content-Type": "application/json" } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}

export function AccessRequestDialog() {
  const [token] = useState(() => IS_WEB ? new URLSearchParams(window.location.search).get("access") || "" : "");
  const [request, setRequest] = useState(null), [error, setError] = useState(""), [result, setResult] = useState(""), [busy, setBusy] = useState(false), [open, setOpen] = useState(!!token);
  useEffect(() => {
    if (!token) return;
    accessCall(token).then(d => setRequest(d.request)).catch(e => setError(e.message));
  }, [token]);
  function close() {
    setOpen(false);
    const url = new URL(window.location.href); url.searchParams.delete("access");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
  async function decide(decision) {
    setBusy(true); setError("");
    try {
      const d = await accessCall(token, { method: "POST", body: JSON.stringify({ decision }) });
      setResult(decision === "allow" ? `${d.name} (${d.email}) poate intra acum în ${BRAND_NAME}.` : `${d.name} (${d.email}) nu va putea intra în ${BRAND_NAME}.`);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  if (!open) return null;
  return <Modal title="Cerere nouă de acces" className="modal smallModal accessRequestModal" onClose={close}>
    {result ? <p className="accessRequestText">{result}</p>
      : request ? <p className="accessRequestText"><b>{request.name}</b> ({request.email}) vrea să se conecteze la {BRAND_NAME}. Permiți?</p>
      : !error && <p className="muted">Se încarcă cererea…</p>}
    {error && <div className="authError" role="alert">{error}</div>}
    <div className="modalActions">
      {request && !result ? <>
        <button className="secondary" disabled={busy} onClick={() => decide("deny")}><X size={15}/> Refuză</button>
        <button className="primary" disabled={busy} onClick={() => decide("allow")}><Check size={15}/> Permite</button>
      </> : <button className="secondary" onClick={close}>Închide</button>}
    </div>
  </Modal>;
}

// Setări → Notificări pe telefon (Owner, web). One switch per device; the server keeps up to ten phones.
export function PhoneNotifications() {
  const [state, setState] = useState({ loading: true, subscribed: false, devices: 0, permission: pushSupported() ? Notification.permission : "unsupported" });
  const [status, setStatus] = useState(""), [busy, setBusy] = useState(false);
  async function refresh() {
    try {
      const info = await api("/api/admin/push");
      let subscribed = false;
      if (pushSupported()) { const reg = await navigator.serviceWorker.getRegistration(); subscribed = !!(await reg?.pushManager.getSubscription()); }
      setState({ loading: false, subscribed, devices: info.devices || 0, publicKey: info.publicKey, permission: pushSupported() ? Notification.permission : "unsupported" });
    } catch (e) { setState(s => ({ ...s, loading: false })); setStatus("Nu am putut citi starea notificărilor: " + e.message); }
  }
  useEffect(() => { refresh(); }, []);
  async function enable() {
    setBusy(true); setStatus("");
    try {
      if (Notification.permission !== "granted" && (await Notification.requestPermission()) !== "granted") throw new Error(`Notificările nu au fost permise. Le poți porni din setările telefonului, la ${BRAND_NAME}.`);
      const reg = await navigator.serviceWorker.register("./sw.js").then(() => navigator.serviceWorker.ready);
      const key = state.publicKey || (await api("/api/admin/push")).publicKey;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
      const r = await api("/api/admin/push/subscribe", { method: "POST", body: JSON.stringify({ subscription: sub.toJSON() }) });
      setStatus(`Gata. Vei primi pe acest dispozitiv cererile de acces (${r.devices} ${r.devices === 1 ? "dispozitiv" : "dispozitive"} în total).`);
      await refresh();
    } catch (e) { setStatus(e.message); }
    finally { setBusy(false); }
  }
  async function disable() {
    setBusy(true); setStatus("");
    try {
      const reg = await navigator.serviceWorker.getRegistration(); const sub = await reg?.pushManager.getSubscription();
      if (sub) { await api("/api/admin/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint: sub.endpoint }) }); await sub.unsubscribe(); }
      setStatus("Notificările sunt oprite pe acest dispozitiv.");
      await refresh();
    } catch (e) { setStatus(e.message); }
    finally { setBusy(false); }
  }
  async function test() {
    setBusy(true); setStatus("");
    try { const r = await api("/api/admin/push/test", { method: "POST", body: "{}" }); setStatus(r.delivered ? `Notificare trimisă pe ${r.delivered} ${r.delivered === 1 ? "dispozitiv" : "dispozitive"}.` : "Niciun dispozitiv nu a primit-o. Activează notificările mai sus."); }
    catch (e) { setStatus(e.message); }
    finally { setBusy(false); }
  }
  const iosNeedsInstall = isIos() && !isStandalone();
  return <>
    <h3>Notificări pe telefon</h3>
    <p className="settingsHelp">Când cineva își face cont, primești pe telefon „Maria (maria@gmail.com) vrea să se conecteze la {BRAND_NAME}. Permiți?”. Pe Android răspunzi direct din notificare, cu <b>Permite</b> sau <b>Refuză</b>; pe iPhone o atingi și alegi în aplicație. Cererea așteaptă până răspunzi.</p>
    {!pushSupported() || iosNeedsInstall
      ? <div className="settingsPrefs"><p className="settingsHelp">{iosNeedsInstall
          ? `Pe iPhone, notificările merg doar din aplicația instalată: deschide ${BRAND_DOMAIN} în Safari → Distribuie → Adaugă pe ecranul principal, apoi deschide ${BRAND_NAME} de pe ecran și revino aici.`
          : `Acest browser nu poate primi notificări. Folosește aplicația ${BRAND_NAME} instalată pe telefon (Chrome pe Android sau Safari pe iPhone).`}</p></div>
      : <div className="settingsButtons">
          {state.subscribed
            ? <button type="button" className="secondary" disabled={busy} onClick={disable}><BellOff size={15}/> Oprește pe acest dispozitiv</button>
            : <button type="button" className="primary" disabled={busy || state.loading} onClick={enable}><Bell size={15}/> Activează pe acest dispozitiv</button>}
          <button type="button" className="secondary" disabled={busy || !state.devices} onClick={test}><Send size={15}/> Trimite o notificare de test</button>
        </div>}
    {state.permission === "denied" && <p className="settingsHelp">Notificările sunt blocate pentru {BRAND_NAME}. Pornește-le din setările telefonului (Notificări → {BRAND_NAME}) și apasă din nou.</p>}
    {!state.loading && <p className="settingsHelp">Dispozitive care primesc cererile: {state.devices}.</p>}
    {status && <div className="micStatus" role="status">{status}</div>}
  </>;
}
