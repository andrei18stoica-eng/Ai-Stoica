import React, { useEffect, useRef, useState } from "react";
import { Download, Trash2, LogOut, KeyRound, Monitor, Smartphone } from "lucide-react";
import { api, toast, storage, TOKEN_KEY, GATEWAY, authHeaders, saveBlobDownload, Switch, cx } from "../core.jsx";
import { PreferenceSwitches } from "./Memory.jsx";
import { BRAND_NAME } from "../brand.js";
import { t as tr, useLanguage } from "../i18n.jsx";

// Settings of each account (0.7.23, phase 3): profile and personalisation, notifications, privacy and security. Saved on
// the server for this account only; the machine settings (keys, OmniRoute, media) stay in the other tabs, for the Owner.
const TONES = [["default", "Default"], ["professional", "Professional"], ["friendly", "Friendly"], ["direct", "Direct and honest"], ["concise", "Short and to the point"], ["detailed", "Detailed"], ["creative", "Creative"]];
const LANGS = [["auto", "The language I write in"], ["ro", "Always in Romanian"], ["en", "Always in English"]];
const KEEP = [[0, "Forever"], [30, "30 days"], [90, "90 days"], [365, "One year"]];

export function useAccountSettings() {
  const [data, setData] = useState(null), [error, setError] = useState("");
  const load = () => api("/api/me/settings").then((d) => setData(d.data)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  async function save(patch, ok = tr("Saved.")) {
    const d = await api("/api/me/settings", { method: "PATCH", body: JSON.stringify(patch) });
    setData(d.data); if (ok) toast(ok, "ok"); return d.data;
  }
  return { data, error, save, reload: load };
}

export function ProfileTab({ account, models = [], preferences, onPreferences, prefBusy }) {
  const { data, error, save } = account;
  useLanguage();
  const [f, setF] = useState(null), [busy, setBusy] = useState(false);
  useEffect(() => { if (data && !f) setF(data); }, [data]);
  if (error) return <div className="inlineError">{error}</div>;
  if (!f) return <div className="settingsLoading">{tr("Loading the profile…")}</div>;
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const dirty = ["name", "nickname", "occupation", "about", "customInstructions", "tone", "responseLanguage", "preferredModel"].some((k) => f[k] !== data[k]);
  async function submit(e) {
    e.preventDefault(); if (busy) return; setBusy(true);
    try { await save({ name: f.name, nickname: f.nickname, occupation: f.occupation, about: f.about, customInstructions: f.customInstructions, tone: f.tone, responseLanguage: f.responseLanguage, preferredModel: f.preferredModel }, tr("Profile saved.")); }
    catch (err) { toast(err.message); } finally { setBusy(false); }
  }
  const modelList = [...new Set([f.preferredModel, ...models].filter(Boolean))];
  return <form className="accountForm" onSubmit={submit}>
    <h3>{tr("Profile")}</h3>
    <div className="accountGrid">
      <label>{tr("Name")}<input value={f.name} onChange={(e) => set("name", e.target.value)} maxLength={80} required /></label>
      <label>{tr("Email")}<input value={f.email} disabled /></label>
      <label><span className="labelLine">{tr("What the AI calls you")} <span className="optional">{tr("optional")}</span></span><input value={f.nickname} onChange={(e) => set("nickname", e.target.value)} maxLength={60} placeholder={tr("e.g. a name or a nickname")} /></label>
      <label><span className="labelLine">{tr("What you do")} <span className="optional">{tr("optional")}</span></span><input value={f.occupation} onChange={(e) => set("occupation", e.target.value)} maxLength={120} placeholder={tr("e.g. student, web designer, accountant")} /></label>
    </div>
    <label><span className="labelLine">{tr("About you")} <span className="optional">{tr("optional")}</span></span><textarea rows={3} value={f.about} onChange={(e) => set("about", e.target.value)} maxLength={1500} placeholder={tr("What would help the AI to know about you: interests, projects, level of experience.")} /></label>
    <h3>{tr("How the AI answers")}</h3>
    <div className="accountGrid">
      <label>{tr("Tone")}<select value={f.tone} onChange={(e) => set("tone", e.target.value)}>{TONES.map(([k, l]) => <option key={k} value={k}>{tr(l)}</option>)}</select></label>
      <label>{tr("Answer language")}<select value={f.responseLanguage} onChange={(e) => set("responseLanguage", e.target.value)}>{LANGS.map(([k, l]) => <option key={k} value={k}>{tr(l)}</option>)}</select></label>
      <label className="span2">{tr("Model for new chats")}<select value={f.preferredModel} onChange={(e) => set("preferredModel", e.target.value)}><option value="">{tr("Chosen automatically")}</option>{modelList.map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
    </div>
    <label><span className="labelLine">{tr("Custom instructions")} <span className="optional">{tr("optional")}</span></span><textarea rows={5} value={f.customInstructions} onChange={(e) => set("customInstructions", e.target.value)} maxLength={3000} placeholder={tr("How you want it to answer you, every time. e.g. «Explain briefly, with examples. When you write code, comment it.»")} /></label>
    <p className="settingsHelp">{tr("{brand} uses this only to answer you better; you can see and change it here any time.",{brand:BRAND_NAME})}</p>
    <div className="formActions"><button className="primary" disabled={busy || !dirty}>{busy ? tr("Saving…") : tr("Save profile")}</button></div>
    {onPreferences && <><h3>{tr("Memory and chats")}</h3><PreferenceSwitches preferences={preferences} onChange={onPreferences} busyKey={prefBusy} /></>}
  </form>;
}

export function NotifyTab({ account, children }) {
  const { data, error, save } = account;
  useLanguage();
  if (error) return <div className="inlineError">{error}</div>;
  if (!data) return <div className="settingsLoading">{tr("Loading…")}</div>;
  const row = (k, title, desc) => <div className="prefRow" key={k}><div className="prefText"><b>{tr(title)}</b><span>{tr(desc)}</span></div>
    <Switch checked={data[k] !== false} label={tr(title)} onChange={(v) => save({ [k]: v }, "").catch((e) => toast(e.message))} /></div>;
  return <div>
    <h3>{tr("Notifications")}</h3>
    <div className="prefList">
      {row("notifyAutomations", "Automation results", "A message in the app (and on the phone, if it is subscribed) when an automation finishes.")}
      {row("notifyCredits", "Credit warnings", "A message at 25, 50, 75 and 90% of the week's credits. The 100% message always appears.")}
    </div>
    {children}
  </div>;
}

export function PrivacyTab({ account, onDataDeleted }) {
  const { data, error, save } = account;
  useLanguage();
  const [busy, setBusy] = useState("");
  if (error) return <div className="inlineError">{error}</div>;
  if (!data) return <div className="settingsLoading">{tr("Loading…")}</div>;
  async function exportData() {
    setBusy("export");
    try {
      const r = await fetch(`${GATEWAY}/api/me/export`, { headers: authHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await saveBlobDownload(await r.blob(), `data-${new Date().toISOString().slice(0, 10)}.json`);
    } catch (e) { toast(tr("The export failed:") + " " + e.message); } finally { setBusy(""); }
  }
  async function wipe(scope, label) {
    const word = prompt(tr("Delete {what}? This cannot be undone. Type DELETE to confirm.", { what: tr(label) }));
    if (word === null) return;
    setBusy(scope);
    try { await api("/api/me/delete-data", { method: "POST", body: JSON.stringify({ scope, confirm: word }) }); toast(tr("Deleted: {what}.", { what: tr(label) }), "ok"); onDataDeleted?.(scope); }
    catch (e) { toast(e.message); } finally { setBusy(""); }
  }
  return <div>
    <h3>{tr("Privacy and data")}</h3>
    <label className="accountInline">{tr("Keep chats")}<select value={data.retentionDays} onChange={(e) => save({ retentionDays: Number(e.target.value) }, tr("Saved.")).catch((er) => toast(er.message))}>{KEEP.map(([d, l]) => <option key={d} value={d}>{tr(l)}</option>)}</select></label>
    <p className="settingsHelp">{tr("Chats older than this are deleted on their own (pinned ones stay). Your data stays on the {brand} server and is never sold or used for ads.",{brand:BRAND_NAME})}</p>
    <div className="accountActions">
      <button className="secondary" onClick={exportData} disabled={!!busy}><Download size={15} /> {busy === "export" ? tr("Preparing…") : tr("Download all my data")}</button>
    </div>
    <h4>{tr("Delete data")}</h4>
    <div className="accountActions">
      <button className="secondary" onClick={() => wipe("conversations", "all chats")} disabled={!!busy}><Trash2 size={15} /> {tr("Chats")}</button>
      <button className="secondary" onClick={() => wipe("memories", "all memory")} disabled={!!busy}><Trash2 size={15} /> {tr("Memory")}</button>
      <button className="secondary" onClick={() => wipe("library", "all files in the Library")} disabled={!!busy}><Trash2 size={15} /> {tr("Files")}</button>
      <button className="iconDanger wide" onClick={() => wipe("all", "all the account's data (chats, memory, files, projects, assistants, skills, automations, apps, designs)")} disabled={!!busy}><Trash2 size={15} /> {tr("All data")}</button>
    </div>
  </div>;
}

const deviceLabel = (ua = "") => /iphone|ipad|android|mobile/i.test(ua) ? tr("Phone") : /electron/i.test(ua) ? tr("Windows app") : /windows/i.test(ua) ? "Windows" : /mac os/i.test(ua) ? "Mac" : /linux/i.test(ua) ? "Linux" : tr("Device");
const browserLabel = (ua = "") => /edg\//i.test(ua) ? "Edge" : /chrome\//i.test(ua) ? "Chrome" : /firefox\//i.test(ua) ? "Firefox" : /safari\//i.test(ua) ? "Safari" : "";

export function SecurityTab({ account, onAccountDeleted }) {
  const { data } = account;
  const lang = useLanguage();
  const [sessions, setSessions] = useState(null), [local, setLocal] = useState(false), [pw, setPw] = useState({ current: "", next: "", again: "" }), [busy, setBusy] = useState("");
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const load = () => api("/api/me/sessions").then((d) => { if (mounted.current) { setSessions(d.data || []); setLocal(!!d.local); } }).catch((e) => toast(e.message));
  useEffect(() => { load(); }, []);
  const keepToken = (d) => { if (d?.token) storage.set(TOKEN_KEY, d.token); };
  async function revoke(id) { setBusy(id); try { await api(`/api/me/sessions/${id}`, { method: "DELETE" }); await load(); } catch (e) { toast(e.message); } finally { setBusy(""); } }
  async function revokeOthers() {
    setBusy("others");
    try { const d = await api("/api/me/sessions/revoke-others", { method: "POST", body: "{}" }); keepToken(d); toast(tr("The other devices were signed out."), "ok"); await load(); }
    catch (e) { toast(e.message); } finally { setBusy(""); }
  }
  async function changePassword(e) {
    e.preventDefault();
    if (pw.next.length < 8) { toast(tr("The new password needs at least 8 characters.")); return; }
    if (pw.next !== pw.again) { toast(tr("The two new passwords are not the same.")); return; }
    setBusy("pw");
    try { const d = await api("/api/me/password", { method: "POST", body: JSON.stringify({ current: pw.current, next: pw.next }) }); keepToken(d); setPw({ current: "", next: "", again: "" }); toast(tr("Password changed. The other devices have to sign in again."), "ok"); load(); }
    catch (er) { toast(er.message); } finally { setBusy(""); }
  }
  async function deleteAccount() {
    const password = prompt(tr("Delete the account and all its data? This cannot be undone. Type the account's password to confirm."));
    if (!password) return;
    setBusy("delete");
    try { await api("/api/me", { method: "DELETE", body: JSON.stringify({ password }) }); toast(tr("Account deleted."), "ok"); onAccountDeleted?.(); }
    catch (e) { toast(e.message); } finally { setBusy(""); }
  }
  return <div>
    <h3>{tr("Security")}</h3>
    <h4>{tr("Active sessions")}</h4>
    {!sessions ? <div className="settingsLoading">{tr("Loading…")}</div> : <div className="sessionList">
      {sessions.map((s) => <div key={s.id} className={cx("sessionRow", s.current && "current")}>
        {/iphone|android|mobile/i.test(s.userAgent) ? <Smartphone size={18} /> : <Monitor size={18} />}
        <div><b>{deviceLabel(s.userAgent)}{browserLabel(s.userAgent) ? ` · ${browserLabel(s.userAgent)}` : ""}{s.current && <span className="sessionNow">{tr("this one")}</span>}</b>
          <small>{[s.ip, s.createdAt && tr("since {when}", { when: new Date(s.createdAt).toLocaleString(lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) })].filter(Boolean).join(" · ")}</small></div>
        {!s.current && !local && <button className="smallBtn" onClick={() => revoke(s.id)} disabled={!!busy}><LogOut size={13} /> {tr("Sign out")}</button>}
      </div>)}
    </div>}
    <div className="accountActions"><button className="secondary" onClick={revokeOthers} disabled={!!busy}><LogOut size={15} /> {busy === "others" ? tr("Signing out…") : tr("Sign out the other devices")}</button></div>
    <h4>{tr("Password")}</h4>
    <form className="accountGrid" onSubmit={changePassword}>
      <label>{tr("Current password")}<input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required /></label>
      <span />
      <label>{tr("New password")}<input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} minLength={8} required /></label>
      <label>{tr("Again")}<input type="password" autoComplete="new-password" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} minLength={8} required /></label>
      <div className="formActions span2"><button className="secondary" disabled={busy === "pw"}><KeyRound size={15} /> {busy === "pw" ? tr("Changing…") : tr("Change password")}</button></div>
    </form>
    {data?.role !== "owner" && <>
      <h4>{tr("Delete the account")}</h4>
      <p className="settingsHelp">{tr("The account and all its data (chats, memory, files, settings) are deleted for good.")}</p>
      <div className="accountActions"><button className="iconDanger wide" onClick={deleteAccount} disabled={!!busy}><Trash2 size={15} /> {busy === "delete" ? tr("Deleting…") : tr("Delete the account")}</button></div>
    </>}
  </div>;
}
