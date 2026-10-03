import React, { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { IS_WEB } from "./core.jsx";

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

export function InstallApp() {
  const [, refresh] = useState(0);
  useEffect(() => { const fn = () => refresh(n => n + 1); listeners.add(fn); return () => listeners.delete(fn); }, []);
  if (!IS_WEB || isStandalone()) return null;
  async function install() {
    const prompt = deferredPrompt; if (!prompt) return;
    deferredPrompt = null; refresh(n => n + 1);
    try { await prompt.prompt(); await prompt.userChoice; } catch {}
  }
  if (deferredPrompt) return <button type="button" className="secondary wideBtn installApp" onClick={install}><Download size={16}/> Instalează aplicația AI Stoica (gratuit)</button>;
  if (isIos()) return <div className="installHint">Aplicația pe iPhone, gratuit: în Safari apasă <b>Distribuie</b> (pătratul cu săgeată), apoi <b>Adaugă pe ecranul principal</b>.</div>;
  return <div className="installHint">Aplicația, gratuit: din meniul browserului alege <b>Instalează aplicația</b> sau <b>Adaugă pe ecranul de pornire</b>.</div>;
}
