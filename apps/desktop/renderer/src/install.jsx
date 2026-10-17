import React, { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { IS_WEB, storage } from "./core.jsx";
import { BRAND_NAME, BRAND_DOMAIN } from "./brand.js";
import { t as tr, useLanguage } from "./i18n.jsx";

// Installable app (PWA) for the web version: free, no App Store / Google Play.
// Chrome / Edge / Android fire "beforeinstallprompt" once, often before React mounts, so it is caught here at load.
let deferredPrompt = null;
const listeners = new Set();
if (IS_WEB) {
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredPrompt = e; listeners.forEach(fn => fn()); });
  window.addEventListener("appinstalled", () => { deferredPrompt = null; listeners.forEach(fn => fn()); });
  // The service worker only adds an offline page; the interface itself always comes from the server.
  if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}

const isStandalone = () => window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
// On iPhone only Safari can add a site to the home screen; Chrome/Firefox/in-app browsers (WhatsApp, Instagram…) hide it.
const isIosSafari = () => isIos() && /safari/i.test(navigator.userAgent) && !/crios|fxios|edgios|opios|gsa\/|fban|fbav|instagram|whatsapp/i.test(navigator.userAgent);
const DISMISS_KEY = "serasmartInstallDismissedAt";
const DISMISS_DAYS = 7;

function useInstallState() {
  const [, refresh] = useState(0);
  useEffect(() => { const fn = () => refresh(n => n + 1); listeners.add(fn); return () => listeners.delete(fn); }, []);
  return () => refresh(n => n + 1);
}

async function promptInstall(refresh) {
  const prompt = deferredPrompt; if (!prompt) return false;
  deferredPrompt = null; refresh();
  try { await prompt.prompt(); await prompt.userChoice; } catch {}
  return true;
}

function InstallSteps() {
  if (isIos()) return <ol className="installSteps">
    {!isIosSafari() && <li>{tr("Open {domain} in Safari (on iPhone only Safari can install the app).",{domain:BRAND_DOMAIN})}</li>}
    <li>{tr("Press Share (the square with the arrow up), or ••• → Share.")}</li>
    <li>{tr("Scroll and choose Add to Home Screen, then Add.")}</li>
  </ol>;
  return <ol className="installSteps">
    <li>{tr("Open the browser menu (⋮ or ≡).")}</li>
    <li>{tr("Choose Install app or Add to Home screen.")}</li>
  </ol>;
}

// "Get Serasmart AI as an app": a card with the logo and the name, on the sign-in page and (until dismissed
// for a week) as a banner under the app's header, whenever Serasmart AI is open in a browser instead of as the installed
// app. The banner takes its own row, so it never covers the conversation or the side menu.
export function InstallApp({ banner = false }) {
  useLanguage();
  const refresh = useInstallState();
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(() => {
    if (!banner) return false;
    const at = Number(storage.get(DISMISS_KEY) || 0);
    return at > 0 && Date.now() - at < DISMISS_DAYS * 86400000;
  });
  if (!IS_WEB || isStandalone() || hidden) return null;
  async function install() { if (!(await promptInstall(refresh))) setOpen(v => !v); }
  function dismiss() { storage.set(DISMISS_KEY, String(Date.now())); setHidden(true); }
  return <div className={banner ? "installCard banner" : "installCard"} role="region" aria-label={tr("Install the {brand} app",{brand:BRAND_NAME})}>
    <img src="./icons/icon-192.png" alt="" width="44" height="44"/>
    <div className="installText">
      <b>{BRAND_NAME}</b>
      <span>{tr("Get {brand} as an app on your phone, free",{brand:BRAND_NAME})}</span>
      {open && <InstallSteps/>}
    </div>
    <button type="button" className="installBtn" onClick={install}><Download size={15}/> {deferredPrompt ? tr("Install") : open ? tr("Hide the steps") : tr("How to install")}</button>
    {banner && <button type="button" className="installClose" onClick={dismiss} aria-label={tr("Close")} title={tr("Close")}><X size={15}/></button>}
  </div>;
}
