// Dark or light (0.7.26). Dark is the default; "system" follows the device. Stored on this device and applied as
// <html data-theme="dark|light"> before the first paint (styles.css holds both sets of colors).
import { useSyncExternalStore } from "react";

const KEY = "serasmart-theme";
const CHOICES = ["dark", "light", "system"];
const media = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;
function read() { try { const v = localStorage.getItem(KEY); return CHOICES.includes(v) ? v : "dark"; } catch { return "dark"; } }
let choice = read();
const listeners = new Set();
export const resolvedTheme = () => (choice === "system" ? (media?.matches ? "light" : "dark") : choice);
function apply() {
  if (typeof document === "undefined") return;
  const t = resolvedTheme();
  document.documentElement.dataset.theme = t;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", t === "light" ? "#F5F7FB" : "#060A11");
}
apply();
media?.addEventListener?.("change", () => { if (choice === "system") { apply(); listeners.forEach((fn) => fn()); } });

export function getTheme() { return choice; }
export function setTheme(value) {
  if (!CHOICES.includes(value)) return;
  choice = value;
  try { localStorage.setItem(KEY, value); } catch {}
  apply();
  listeners.forEach((fn) => fn());
}
export function useTheme() { return useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, getTheme, getTheme); }
