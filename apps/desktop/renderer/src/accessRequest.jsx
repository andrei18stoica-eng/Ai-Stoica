import React, { useEffect, useState } from "react";
import { Bell, BellOff, Check, Send, X } from "lucide-react";
import { GATEWAY, IS_WEB, Modal, api } from "./core.jsx";
import { BRAND_NAME, BRAND_DOMAIN } from "./brand.js";
import { t as tr, useLanguage } from "./i18n.jsx";

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
  useLanguage();
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
      setResult(decision === "allow" ? tr("{name} ({email}) can now use {brand}.", { name: d.name, email: d.email, brand: BRAND_NAME }) : tr("{name} ({email}) will not be able to use {brand}.", { name: d.name, email: d.email, brand: BRAND_NAME }));
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  if (!open) return null;
  return <Modal title={tr("New access request")} className="modal smallModal accessRequestModal" onClose={close}>
    {result ? <p className="accessRequestText">{result}</p>
      : request ? <p className="accessRequestText"><b>{request.name}</b> {tr("({email}) wants to join {brand}. Allow?", { email: request.email, brand: BRAND_NAME })}</p>
      : !error && <p className="muted">{tr("Loading the request…")}</p>}
    {error && <div className="authError" role="alert">{error}</div>}
    <div className="modalActions">
      {request && !result ? <>
        <button className="secondary" disabled={busy} onClick={() => decide("deny")}><X size={15}/> {tr("Deny")}</button>
        <button className="primary" disabled={busy} onClick={() => decide("allow")}><Check size={15}/> {tr("Allow")}</button>
      </> : <button className="secondary" onClick={close}>{tr("Close")}</button>}
    </div>
  </Modal>;
}

// Setări → Notificări pe telefon (Owner, web). One switch per device; the server keeps up to ten phones.
export function PhoneNotifications() {
  useLanguage();
  const [state, setState] = useState({ loading: true, subscribed: false, devices: 0, permission: pushSupported() ? Notification.permission : "unsupported" });
  const [status, setStatus] = useState(""), [busy, setBusy] = useState(false);
  async function refresh() {
    try {
      const info = await api("/api/admin/push");
      let subscribed = false;
      if (pushSupported()) { const reg = await navigator.serviceWorker.getRegistration(); subscribed = !!(await reg?.pushManager.getSubscription()); }
      setState({ loading: false, subscribed, devices: info.devices || 0, publicKey: info.publicKey, permission: pushSupported() ? Notification.permission : "unsupported" });
    } catch (e) { setState(s => ({ ...s, loading: false })); setStatus(tr("Could not read the notification status:") + " " + e.message); }
  }
  useEffect(() => { refresh(); }, []);
  async function enable() {
    setBusy(true); setStatus("");
    try {
      if (Notification.permission !== "granted" && (await Notification.requestPermission()) !== "granted") throw new Error(tr("Notifications were not allowed. You can turn them on in the phone's settings, under {brand}.", { brand: BRAND_NAME }));
      const reg = await navigator.serviceWorker.register("./sw.js").then(() => navigator.serviceWorker.ready);
      const key = state.publicKey || (await api("/api/admin/push")).publicKey;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
      const r = await api("/api/admin/push/subscribe", { method: "POST", body: JSON.stringify({ subscription: sub.toJSON() }) });
      setStatus(tr(r.devices === 1 ? "Done. This device will get the access requests (1 device in total)." : "Done. This device will get the access requests ({n} devices in total).", { n: r.devices }));
      await refresh();
    } catch (e) { setStatus(e.message); }
    finally { setBusy(false); }
  }
  async function disable() {
    setBusy(true); setStatus("");
    try {
      const reg = await navigator.serviceWorker.getRegistration(); const sub = await reg?.pushManager.getSubscription();
      if (sub) { await api("/api/admin/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint: sub.endpoint }) }); await sub.unsubscribe(); }
      setStatus(tr("Notifications are off on this device."));
      await refresh();
    } catch (e) { setStatus(e.message); }
    finally { setBusy(false); }
  }
  async function test() {
    setBusy(true); setStatus("");
    try { const r = await api("/api/admin/push/test", { method: "POST", body: "{}" }); setStatus(r.delivered ? tr(r.delivered === 1 ? "Notification sent to 1 device." : "Notification sent to {n} devices.", { n: r.delivered }) : tr("No device got it. Turn on notifications above.")); }
    catch (e) { setStatus(e.message); }
    finally { setBusy(false); }
  }
  const iosNeedsInstall = isIos() && !isStandalone();
  return <>
    <h3>{tr("Phone notifications")}</h3>
    <p className="settingsHelp">{tr("When someone signs up, your phone shows who wants to join {brand} and asks if you allow it. On Android you answer from the notification with Allow or Deny; on iPhone you tap it and choose in the app. The request waits until you answer.", { brand: BRAND_NAME })}</p>
    {!pushSupported() || iosNeedsInstall
      ? <div className="settingsPrefs"><p className="settingsHelp">{iosNeedsInstall
          ? tr("On iPhone, notifications work only from the installed app: open {domain} in Safari → Share → Add to Home Screen, then open {brand} from the screen and come back here.", { domain: BRAND_DOMAIN, brand: BRAND_NAME })
          : tr("This browser cannot get notifications. Use the {brand} app installed on the phone (Chrome on Android or Safari on iPhone).", { brand: BRAND_NAME })}</p></div>
      : <div className="settingsButtons">
          {state.subscribed
            ? <button type="button" className="secondary" disabled={busy} onClick={disable}><BellOff size={15}/> {tr("Turn off on this device")}</button>
            : <button type="button" className="primary" disabled={busy || state.loading} onClick={enable}><Bell size={15}/> {tr("Turn on for this device")}</button>}
          <button type="button" className="secondary" disabled={busy || !state.devices} onClick={test}><Send size={15}/> {tr("Send a test notification")}</button>
        </div>}
    {state.permission === "denied" && <p className="settingsHelp">{tr("Notifications are blocked for {brand}. Turn them on in the phone's settings (Notifications → {brand}) and press again.", { brand: BRAND_NAME })}</p>}
    {!state.loading && <p className="settingsHelp">{tr("Devices that get the requests: {n}.", { n: state.devices })}</p>}
    {status && <div className="micStatus" role="status">{status}</div>}
  </>;
}
