// Languages (0.7.26). The interface is written in English; t("English text") gives the same text in the language the
// person picked in the top bar (stored on this device), or the English text when that phrase has no translation yet.
// Arabic switches the page to right-to-left. Romanian, Spanish, French and German travel with the app (locales.js);
// every other language, and any text those four do not cover yet, comes from the server (GET /api/i18n/:lang). The
// texts the screen showed without a translation are sent back (POST, signed in only), the server translates them once
// with the AI for every account, and the screen switches to them. The last copy is kept on this device.
import { useSyncExternalStore } from "react";
import { LOCALES } from "./locales.js";
import { GATEWAY, api, storage, TOKEN_KEY } from "./core.jsx";

export const LANGUAGES = [
  ["en", "English"], ["ro", "Română"], ["es", "Español"], ["fr", "Français"], ["de", "Deutsch"], ["it", "Italiano"],
  ["pt", "Português"], ["nl", "Nederlands"], ["pl", "Polski"], ["hu", "Magyar"], ["cs", "Čeština"], ["sv", "Svenska"],
  ["el", "Ελληνικά"], ["tr", "Türkçe"], ["ru", "Русский"], ["uk", "Українська"], ["ar", "العربية"], ["hi", "हिन्दी"],
  ["zh", "中文"], ["ja", "日本語"], ["ko", "한국어"], ["id", "Bahasa Indonesia"], ["vi", "Tiếng Việt"], ["th", "ไทย"]
];
const RTL = new Set(["ar"]);
const KEY = "serasmart-lang";
const known = (code) => LANGUAGES.some(([c]) => c === code);

function read() { try { const v = localStorage.getItem(KEY); return known(v) ? v : "en"; } catch { return "en"; } }
let current = read();
const listeners = new Set();
let version = 0;
const notify = () => { version++; listeners.forEach((fn) => fn()); };
const CACHE = "serasmart-i18n-";
const remote = {}; // lang → { English: translation } from the server
function loadCache(lang) { try { const d = JSON.parse(localStorage.getItem(CACHE + lang) || "null"); if (d && typeof d === "object") remote[lang] = d; } catch {} }
function saveCache(lang) { try { localStorage.setItem(CACHE + lang, JSON.stringify(remote[lang] || {})); } catch {} }
function merge(lang, data) {
  if (!data || typeof data !== "object") return;
  remote[lang] = { ...(remote[lang] || {}), ...data };
  saveCache(lang);
  if (lang === current) notify();
}
const fetched = new Set();
async function fetchRemote(lang) {
  if (lang === "en" || fetched.has(lang)) return;
  fetched.add(lang);
  try { const r = await fetch(`${GATEWAY}/api/i18n/${lang}`); if (r.ok) merge(lang, (await r.json()).data); } catch {}
}
// Texts shown without a translation, sent in one request a moment after the screen settles.
const missing = new Set();
const tried = new Set(); // "lang\ttext" already sent once this session, so a text the server could not translate is not asked again
let timer = null, asking = false;
function askLater() {
  if (timer || current === "en") return;
  timer = setTimeout(async () => {
    timer = null;
    if (asking || !storage.get(TOKEN_KEY) || !missing.size) return;
    const lang = current, keys = [...missing].slice(0, 300);
    keys.forEach((k) => tried.add(lang + "\t" + k));
    asking = true;
    try { merge(lang, (await api(`/api/i18n/${lang}`, { method: "POST", body: JSON.stringify({ keys }) })).data); }
    catch {}
    finally { asking = false; keys.forEach((k) => missing.delete(k)); if (missing.size) askLater(); }
  }, 2500);
}
function apply() {
  if (typeof document === "undefined") return;
  document.documentElement.lang = current;
  document.documentElement.dir = RTL.has(current) ? "rtl" : "ltr";
}
apply();
if (current !== "en") { loadCache(current); fetchRemote(current); }

export function getLanguage() { return current; }
export function setLanguage(code) {
  if (!known(code) || code === current) return;
  current = code;
  try { localStorage.setItem(KEY, code); } catch {}
  missing.clear();
  apply();
  if (code !== "en") { loadCache(code); fetchRemote(code); }
  notify();
}
function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// t("Hello, {name}", { name }) — the English text is the key.
export function t(text, vars) {
  let s = text;
  if (current !== "en" && typeof text === "string") {
    const found = LOCALES[current]?.[text] ?? remote[current]?.[text];
    if (found) s = found;
    else if (text.trim() && missing.size < 600 && !tried.has(current + "\t" + text)) { missing.add(text); askLater(); }
  }
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m)) : s;
}
// Re-renders the component when the language changes or new translations arrive.
const snapshot = () => `${current}:${version}`;
export function useLanguage() { useSyncExternalStore(subscribe, snapshot, snapshot); return current; }
