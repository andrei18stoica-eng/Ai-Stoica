import React, { useEffect, useRef, useState } from "react";
import { Download, Trash2, LogOut, KeyRound, Monitor, Smartphone } from "lucide-react";
import { api, toast, storage, TOKEN_KEY, GATEWAY, authHeaders, saveBlobDownload, Switch, cx } from "../core.jsx";
import { PreferenceSwitches } from "./Memory.jsx";
import { BRAND_NAME } from "../brand.js";

// Settings of each account (0.7.23, phase 3): profile and personalisation, notifications, privacy and security. Saved on
// the server for this account only; the machine settings (keys, OmniRoute, media) stay in the other tabs, for the Owner.
const TONES = [["default", "Implicit"], ["professional", "Profesional"], ["friendly", "Prietenos"], ["direct", "Direct și sincer"], ["concise", "Scurt, la obiect"], ["detailed", "Detaliat"], ["creative", "Creativ"]];
const LANGS = [["auto", "Limba în care scriu"], ["ro", "Mereu în română"], ["en", "Mereu în engleză"]];
const KEEP = [[0, "Pentru totdeauna"], [30, "30 de zile"], [90, "90 de zile"], [365, "Un an"]];

export function useAccountSettings() {
  const [data, setData] = useState(null), [error, setError] = useState("");
  const load = () => api("/api/me/settings").then((d) => setData(d.data)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  async function save(patch, ok = "Salvat.") {
    const d = await api("/api/me/settings", { method: "PATCH", body: JSON.stringify(patch) });
    setData(d.data); if (ok) toast(ok, "ok"); return d.data;
  }
  return { data, error, save, reload: load };
}

export function ProfileTab({ account, models = [], preferences, onPreferences, prefBusy }) {
  const { data, error, save } = account;
  const [f, setF] = useState(null), [busy, setBusy] = useState(false);
  useEffect(() => { if (data && !f) setF(data); }, [data]);
  if (error) return <div className="inlineError">{error}</div>;
  if (!f) return <div className="settingsLoading">Se încarcă profilul…</div>;
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const dirty = ["name", "nickname", "occupation", "about", "customInstructions", "tone", "responseLanguage", "preferredModel"].some((k) => f[k] !== data[k]);
  async function submit(e) {
    e.preventDefault(); if (busy) return; setBusy(true);
    try { await save({ name: f.name, nickname: f.nickname, occupation: f.occupation, about: f.about, customInstructions: f.customInstructions, tone: f.tone, responseLanguage: f.responseLanguage, preferredModel: f.preferredModel }, "Profilul a fost salvat."); }
    catch (err) { toast(err.message); } finally { setBusy(false); }
  }
  const modelList = [...new Set([f.preferredModel, ...models].filter(Boolean))];
  return <form className="accountForm" onSubmit={submit}>
    <h3>Profil</h3>
    <div className="accountGrid">
      <label>Nume<input value={f.name} onChange={(e) => set("name", e.target.value)} maxLength={80} required /></label>
      <label>Email<input value={f.email} disabled /></label>
      <label><span className="labelLine">Cum să-ți spună AI-ul <span className="optional">opțional</span></span><input value={f.nickname} onChange={(e) => set("nickname", e.target.value)} maxLength={60} placeholder="ex. un nume sau o poreclă" /></label>
      <label><span className="labelLine">Ce faci <span className="optional">opțional</span></span><input value={f.occupation} onChange={(e) => set("occupation", e.target.value)} maxLength={120} placeholder="ex. elev, web designer, contabil" /></label>
    </div>
    <label><span className="labelLine">Despre tine <span className="optional">opțional</span></span><textarea rows={3} value={f.about} onChange={(e) => set("about", e.target.value)} maxLength={1500} placeholder="Ce ar fi util ca AI-ul să știe despre tine: interese, proiecte, nivelul de experiență." /></label>
    <h3>Cum răspunde AI-ul</h3>
    <div className="accountGrid">
      <label>Ton<select value={f.tone} onChange={(e) => set("tone", e.target.value)}>{TONES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label>Limba răspunsurilor<select value={f.responseLanguage} onChange={(e) => set("responseLanguage", e.target.value)}>{LANGS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label className="span2">Modelul pentru conversațiile noi<select value={f.preferredModel} onChange={(e) => set("preferredModel", e.target.value)}><option value="">Cel ales automat</option>{modelList.map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
    </div>
    <label><span className="labelLine">Instrucțiuni personalizate <span className="optional">opțional</span></span><textarea rows={5} value={f.customInstructions} onChange={(e) => set("customInstructions", e.target.value)} maxLength={3000} placeholder="Cum vrei să-ți răspundă, de fiecare dată. ex. „Explică-mi pe scurt, cu exemple. Folosește diacritice. Când scrii cod, comentează-l.”" /></label>
    <p className="settingsHelp">{BRAND_NAME} folosește aceste informații doar ca să-ți răspundă mai bine; le vezi și le schimbi oricând aici.</p>
    <div className="formActions"><button className="primary" disabled={busy || !dirty}>{busy ? "Se salvează…" : "Salvează profilul"}</button></div>
    {onPreferences && <><h3>Memorie și conversații</h3><PreferenceSwitches preferences={preferences} onChange={onPreferences} busyKey={prefBusy} /></>}
  </form>;
}

export function NotifyTab({ account, children }) {
  const { data, error, save } = account;
  if (error) return <div className="inlineError">{error}</div>;
  if (!data) return <div className="settingsLoading">Se încarcă…</div>;
  const row = (k, title, desc) => <div className="prefRow" key={k}><div className="prefText"><b>{title}</b><span>{desc}</span></div>
    <Switch checked={data[k] !== false} label={title} onChange={(v) => save({ [k]: v }, "").catch((e) => toast(e.message))} /></div>;
  return <div>
    <h3>Notificări</h3>
    <div className="prefList">
      {row("notifyAutomations", "Rezultatele sarcinilor programate", "Un mesaj în aplicație (și pe telefon, dacă e abonat) când o sarcină programată termină.")}
      {row("notifyCredits", "Avertizări de credite", "Mesaj la 25, 50, 75 și 90% din creditele săptămânii. Mesajul de la 100% apare oricum.")}
    </div>
    {children}
  </div>;
}

export function PrivacyTab({ account, onDataDeleted }) {
  const { data, error, save } = account;
  const [busy, setBusy] = useState("");
  if (error) return <div className="inlineError">{error}</div>;
  if (!data) return <div className="settingsLoading">Se încarcă…</div>;
  async function exportData() {
    setBusy("export");
    try {
      const r = await fetch(`${GATEWAY}/api/me/export`, { headers: authHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await saveBlobDownload(await r.blob(), `date-${new Date().toISOString().slice(0, 10)}.json`);
    } catch (e) { toast("Exportul nu a reușit: " + e.message); } finally { setBusy(""); }
  }
  async function wipe(scope, label) {
    const word = prompt(`Ștergi ${label}? Nu poate fi anulat. Scrie STERGE ca să confirmi.`);
    if (word === null) return;
    setBusy(scope);
    try { await api("/api/me/delete-data", { method: "POST", body: JSON.stringify({ scope, confirm: word }) }); toast(`Am șters ${label}.`, "ok"); onDataDeleted?.(scope); }
    catch (e) { toast(e.message); } finally { setBusy(""); }
  }
  return <div>
    <h3>Confidențialitate și date</h3>
    <label className="accountInline">Păstrează conversațiile<select value={data.retentionDays} onChange={(e) => save({ retentionDays: Number(e.target.value) }, "Salvat.").catch((er) => toast(er.message))}>{KEEP.map(([d, l]) => <option key={d} value={d}>{l}</option>)}</select></label>
    <p className="settingsHelp">Conversațiile mai vechi de atât se șterg singure (cele fixate rămân). Datele tale stau pe serverul {BRAND_NAME} și nu sunt vândute sau folosite pentru reclame.</p>
    <div className="accountActions">
      <button className="secondary" onClick={exportData} disabled={!!busy}><Download size={15} /> {busy === "export" ? "Se pregătește…" : "Descarcă toate datele mele"}</button>
    </div>
    <h4>Șterge date</h4>
    <div className="accountActions">
      <button className="secondary" onClick={() => wipe("conversations", "toate conversațiile")} disabled={!!busy}><Trash2 size={15} /> Conversațiile</button>
      <button className="secondary" onClick={() => wipe("memories", "toată memoria")} disabled={!!busy}><Trash2 size={15} /> Memoria</button>
      <button className="secondary" onClick={() => wipe("library", "toate fișierele din Bibliotecă")} disabled={!!busy}><Trash2 size={15} /> Fișierele</button>
      <button className="iconDanger wide" onClick={() => wipe("all", "toate datele contului (conversații, memorie, fișiere, proiecte, asistenți, skill-uri, automatizări, pluginuri, designuri)")} disabled={!!busy}><Trash2 size={15} /> Toate datele</button>
    </div>
  </div>;
}

const deviceLabel = (ua = "") => /iphone|ipad|android|mobile/i.test(ua) ? "Telefon" : /electron/i.test(ua) ? "Aplicația Windows" : /windows/i.test(ua) ? "Windows" : /mac os/i.test(ua) ? "Mac" : /linux/i.test(ua) ? "Linux" : "Dispozitiv";
const browserLabel = (ua = "") => /edg\//i.test(ua) ? "Edge" : /chrome\//i.test(ua) ? "Chrome" : /firefox\//i.test(ua) ? "Firefox" : /safari\//i.test(ua) ? "Safari" : "";

export function SecurityTab({ account, onAccountDeleted }) {
  const { data } = account;
  const [sessions, setSessions] = useState(null), [local, setLocal] = useState(false), [pw, setPw] = useState({ current: "", next: "", again: "" }), [busy, setBusy] = useState("");
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const load = () => api("/api/me/sessions").then((d) => { if (mounted.current) { setSessions(d.data || []); setLocal(!!d.local); } }).catch((e) => toast(e.message));
  useEffect(() => { load(); }, []);
  const keepToken = (d) => { if (d?.token) storage.set(TOKEN_KEY, d.token); };
  async function revoke(id) { setBusy(id); try { await api(`/api/me/sessions/${id}`, { method: "DELETE" }); await load(); } catch (e) { toast(e.message); } finally { setBusy(""); } }
  async function revokeOthers() {
    setBusy("others");
    try { const d = await api("/api/me/sessions/revoke-others", { method: "POST", body: "{}" }); keepToken(d); toast("Celelalte dispozitive au fost deconectate.", "ok"); await load(); }
    catch (e) { toast(e.message); } finally { setBusy(""); }
  }
  async function changePassword(e) {
    e.preventDefault();
    if (pw.next.length < 8) { toast("Parola nouă trebuie să aibă cel puțin 8 caractere."); return; }
    if (pw.next !== pw.again) { toast("Cele două parole noi nu sunt la fel."); return; }
    setBusy("pw");
    try { const d = await api("/api/me/password", { method: "POST", body: JSON.stringify({ current: pw.current, next: pw.next }) }); keepToken(d); setPw({ current: "", next: "", again: "" }); toast("Parola a fost schimbată. Celelalte dispozitive se autentifică din nou.", "ok"); load(); }
    catch (er) { toast(er.message); } finally { setBusy(""); }
  }
  async function deleteAccount() {
    const password = prompt("Ștergi contul și toate datele lui? Nu poate fi anulat. Scrie parola contului ca să confirmi.");
    if (!password) return;
    setBusy("delete");
    try { await api("/api/me", { method: "DELETE", body: JSON.stringify({ password }) }); toast("Contul a fost șters.", "ok"); onAccountDeleted?.(); }
    catch (e) { toast(e.message); } finally { setBusy(""); }
  }
  return <div>
    <h3>Securitate</h3>
    <h4>Sesiuni active</h4>
    {!sessions ? <div className="settingsLoading">Se încarcă…</div> : <div className="sessionList">
      {sessions.map((s) => <div key={s.id} className={cx("sessionRow", s.current && "current")}>
        {/iphone|android|mobile/i.test(s.userAgent) ? <Smartphone size={18} /> : <Monitor size={18} />}
        <div><b>{deviceLabel(s.userAgent)}{browserLabel(s.userAgent) ? ` · ${browserLabel(s.userAgent)}` : ""}{s.current && <span className="sessionNow">acesta</span>}</b>
          <small>{[s.ip, s.createdAt && `din ${new Date(s.createdAt).toLocaleString("ro-RO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`].filter(Boolean).join(" · ")}</small></div>
        {!s.current && !local && <button className="smallBtn" onClick={() => revoke(s.id)} disabled={!!busy}><LogOut size={13} /> Deconectează</button>}
      </div>)}
    </div>}
    <div className="accountActions"><button className="secondary" onClick={revokeOthers} disabled={!!busy}><LogOut size={15} /> {busy === "others" ? "Se deconectează…" : "Deconectează celelalte dispozitive"}</button></div>
    <h4>Parola</h4>
    <form className="accountGrid" onSubmit={changePassword}>
      <label>Parola actuală<input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required /></label>
      <span />
      <label>Parola nouă<input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} minLength={8} required /></label>
      <label>Din nou<input type="password" autoComplete="new-password" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} minLength={8} required /></label>
      <div className="formActions span2"><button className="secondary" disabled={busy === "pw"}><KeyRound size={15} /> {busy === "pw" ? "Se schimbă…" : "Schimbă parola"}</button></div>
    </form>
    {data?.role !== "owner" && <>
      <h4>Șterge contul</h4>
      <p className="settingsHelp">Contul și toate datele lui (conversații, memorie, fișiere, setări) se șterg definitiv.</p>
      <div className="accountActions"><button className="iconDanger wide" onClick={deleteAccount} disabled={!!busy}><Trash2 size={15} /> {busy === "delete" ? "Se șterge…" : "Șterge contul"}</button></div>
    </>}
  </div>;
}
