import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Menu, Plus, Search, Folder, Bot, Settings, LogOut, Share2, MoreHorizontal,
  Paperclip, Mic, ArrowUp, Copy, ThumbsUp, ThumbsDown, RotateCcw, X,
  ChevronDown, User, Check, Wifi, WifiOff, Sparkles, SquarePen, Square,
  CalendarClock, Plug, Library, Brain, Upload, Trash2, Play, Pin, PinOff,
  FileText, Image as ImageIcon, HardDrive, ToggleLeft, ToggleRight,
  Compass, Map as MapIcon, Globe2, Archive, ArchiveRestore, ExternalLink, SlidersHorizontal, Volume2,
  PanelTopOpen, ShieldCheck, UserCheck, Download, Bell, Lock, Pencil, Palette, Clapperboard, Eye, Maximize2, LoaderCircle, SquareTerminal, Gauge,
  Mail, Sun, Moon
} from "lucide-react";
import "@fontsource-variable/manrope";
import "@fontsource-variable/dm-sans";
import "./styles.css";
import { t as tr, LANGUAGES, getLanguage, setLanguage, useLanguage } from "./i18n.jsx";
import { useTheme, setTheme, resolvedTheme } from "./theme.js";
import {
  DEFAULT_GATEWAY, TOKEN_KEY, USER_KEY, PERMISSIONS_KEY, MODEL_CACHE_KEY, MODEL_SELECTED_KEY, MANUAL_MODEL_KEY, RESPONSE_MODE_KEY, GITHUB_BACKUP_KEY,
  FIRST_RUN_KEY, SIDEBAR_COLLAPSED_KEY, ACCOUNT_KEYS, storage, cleanGatewayUrl, GATEWAY, setGatewayUrl, toast, isAuthLost, apiError, authHeaders, api,
  deniedMessage, AccessContext, useAccess, uploadFileToLibrary, formatBytes, plural, cx, uid, writeClipboardText, openLink, downloadGeneratedFile,
  downloadLibraryFile, fmtTime, mediaKind, kindLabel, fetchLibraryBlob, modalStack, useModal, useDismiss, ToolShell, Modal, Markdown, useAuthedBlobUrl,
  isHttpUrl, setAuthLostHandler, IS_WEB, errorFromBody
} from "./core.jsx";
import { InstallApp } from "./install.jsx";
import { FileViewer, canView } from "./viewer.jsx";
import { ServerUpdate } from "./serverUpdate.jsx";
import { AccessRequestDialog, PhoneNotifications } from "./accessRequest.jsx";
import { ScheduledPage } from "./pages/Scheduled.jsx";
import { CodePage } from "./pages/Code.jsx";
import { requestedMediaGeneration } from "./mediaIntent.mjs";
import { normalizeIntent, FILE_FORMATS, FORMAT_CANDIDATES, requestedDocumentFormat } from "./documentIntent.mjs";
import { PluginsPage } from "./pages/Plugins.jsx";
import { MemoryPage, PreferenceSwitches } from "./pages/Memory.jsx";
import { SkillsPage } from "./pages/Skills.jsx";
import { UsagePage, CreditsDialog } from "./pages/Usage.jsx";
import { useAccountSettings, ProfileTab, NotifyTab, PrivacyTab, SecurityTab } from "./pages/AccountSettings.jsx";
import { LibraryPage } from "./pages/Library.jsx";
import { DesignPage } from "./pages/Design.jsx";
import { splitQuestions, QuestionCard, QuestionsPending } from "./questions.jsx";
import { BRAND_NAME, BRAND_SHORT, BRAND_DOMAIN } from "./brand.js";

let DICTATION_LANG = "ro";
const SPEECH_LOCALES = {ro:"ro-RO",en:"en-US",fr:"fr-FR"};
function speechLocale(){return SPEECH_LOCALES[DICTATION_LANG]||"ro-RO";}


class ErrorBoundary extends React.Component {
  constructor(props){super(props);this.state={error:null};}
  static getDerivedStateFromError(error){return {error};}
  componentDidCatch(error,info){console.error(`${BRAND_NAME} renderer error`,error,info);}
  render(){
    if(this.state.error){
      return <div className="crashScreen">
        <div>
          <h1>{BRAND_NAME} a întâmpinat o problemă</h1>
          <p>Fereastra nu a putut afișa această parte a aplicației. Apasă „Reîncarcă”. Dacă problema reapare, copiază detaliile de mai jos și trimite-le administratorului aplicației.</p>
          <pre>{String(this.state.error?.stack||this.state.error?.message||this.state.error)}</pre>
          <button className="primary" onClick={()=>location.reload()}>Reîncarcă {BRAND_NAME}</button>
        </div>
      </div>;
    }
    return this.props.children;
  }
}

function titleFrom(text) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  return s.length > 48 ? `${s.slice(0,48)}…` : (s || "Conversație nouă");
}
function messageText(m) {
  if (m?.displayText) return m.displayText;
  if (typeof m?.content === "string") return m.content || (m.attachmentOnly ? String(m.artifactSource||"") : "");
  if (Array.isArray(m?.content)) return m.content.filter(x => x?.type === "text").map(x => x.text).join("\n");
  return "";
}
function inferModelProvider(model,provider="") {
  const p=String(provider||"").toLowerCase();
  if(p)return p;
  const m=String(model||"").toLowerCase();
  const first=m.split("/")[0];
  // Subscription prefixes are shared (OmniRoute: gc/ is Gemini CLI and Grok Build): the model's name decides.
  if(/^(cx|codex|cc|claude-code|gc|gemini-cli|gh|kr|ag)$/.test(first)){
    if(/\bgrok/.test(m))return "xai";if(/claude/.test(m))return "anthropic";if(/gemini|gemma/.test(m))return "gemini";if(/codex|gpt/.test(m))return "openai";
  }
  const prefixMap={openai:"openai",anthropic:"anthropic",google:"gemini",gemini:"gemini",cerebras:"cerebras",groq:"groq",cloudflare:"cloudflare",openrouter:"openrouter",runway:"runway","@cf":"cloudflare",xai:"xai","x-ai":"xai",cx:"openai",codex:"openai",cc:"anthropic","claude-code":"anthropic",gc:"gemini","gemini-cli":"gemini"};
  if(prefixMap[first])return prefixMap[first];
  if(/groq/.test(m))return "groq";
  if(/cerebras/.test(m))return "cerebras";
  if(/cloudflare|@cf\//.test(m))return "cloudflare";
  if(/openrouter/.test(m))return "openrouter";
  if(/runway/.test(m))return "runway";
  if(/claude|anthropic/.test(m))return "anthropic";
  if(/gemini|google/.test(m))return "gemini";
  if(/openai|codex|\/o[134](?:\b|[-_.])/i.test(m)||(!/gpt[-_. ]?oss/.test(m)&&/gpt/.test(m)))return "openai";
  return "ai";
}
function providerLabel(provider,model="") {
  const p=inferModelProvider(model,provider);
  return ({openai:"OpenAI",anthropic:"Anthropic",gemini:"Google Gemini",cerebras:"Cerebras",groq:"Groq",xai:"Grok (xAI)",cloudflare:"Cloudflare AI",openrouter:"OpenRouter",runway:"Runway",ai:"AI"})[p]||String(provider||"AI");
}
function routeTaskLabel(task) {
  return ({
    coding:"Programare",reasoning:"Matematică / logică",legal_analysis:"Analiză juridică",
    long_context:"Document / context lung",research:"Cercetare",creative:"Creativitate",
    vision:"Imagine / viziune",fast:"Răspuns rapid",general:"General",manual:"Model ales manual",
    "direct-fallback":"Rezervă automată: API direct",direct:"API direct ales manual",auto:"Combinația principală (automat)",image_generation:"Generare imagine",video_generation:"Generare video"
  })[task]||"General";
}
function RouteBadge({info}) {
  if(!info?.model)return null;
  const provider=providerLabel(info.provider,info.model);
  const served=info.servedBy?` → ${info.servedBy}`:"";
  return <div className="routeBadge" title={info.servedBy?`Ai ales ${info.model}; OmniRoute a trimis întrebarea la ${info.servedBy}.`:`${BRAND_NAME} a folosit `+provider+" · "+info.model}>
    <Sparkles size={12}/><span><b>{info.servedBy&&/\//.test(info.servedBy)?providerLabel("",info.servedBy):provider}</b><em>{info.model}{served}</em></span><small>{routeTaskLabel(info.task)}</small>
  </div>;
}
function friendlyError(raw){
  const msg=String(raw||"Eroare necunoscută.").trim();
  let friendly="";
  if(/HTTP 429|rate.?limit|quota|too many requests/i.test(msg))friendly="Limita gratuită a providerului AI a fost atinsă. Alege alt model sau încearcă din nou mai târziu.";
  else if(/HTTP 40[13]\b|invalid.{0,12}api.?key|unauthorized|incorrect api key/i.test(msg))friendly="Cheia API a providerului este greșită sau nu are acces la acest model.";
  else if(/timeout|timed out|TimeoutError/i.test(msg))friendly="Providerul AI nu a răspuns la timp. Încearcă din nou.";
  else if(/failed to fetch|networkerror|load failed/i.test(msg))friendly=`Nu pot contacta serviciul ${BRAND_NAME}. Verifică dacă aplicația rulează și conexiunea la internet.`;
  else if(/^Niciun model selectat de .{1,40}? nu a putut răspunde/i.test(msg))friendly="Niciun AI configurat nu a putut răspunde acum. Verifică modelul ales sau cheile API.";
  if(!friendly)return msg;
  return `${friendly}\n\n_Detalii tehnice: ${msg.slice(0,600)}_`;
}

function safeFileTitle(value){return String(value||`${BRAND_NAME}`).replace(/[\\/:*?"<>|]+/g," ").replace(/\s+/g," ").trim().slice(0,90)||`${BRAND_NAME}`;}
async function exportMessageFile(message,format,title) {
  const d=await api("/api/export",{method:"POST",body:JSON.stringify({format,title:safeFileTitle(title),content:messageText(message)})});
  await downloadGeneratedFile(d.data);
}

function answerFormat(answerText,messages){
  const request=[...messages].reverse().find(m=>m.role==="user");
  const original=request?requestedDocumentFormat(messageText(request)):null;
  if(!original)return null;
  const t=normalizeIntent(answerText);
  const hit=FORMAT_CANDIDATES.find(([,re])=>re.test(t));
  return hit?hit[0]:/\bdocument\b/.test(t)?"docx":original;
}
function standaloneExportRequest(value){
  const t=normalizeIntent(value).replace(/[^a-z0-9.\s-]/g," ").replace(/\s+/g," ").trim();
  if(!requestedDocumentFormat(t))return false;
  if(/de mai sus|raspunsul|mesajul anterior|acesta|aceasta|asta|ultimul|tabelul|textul|lista|continutul|rezultatul|rezumatul|codul|conversatia/.test(t))return true;
  let stripped=t.replace(new RegExp("\\b("+FILE_FORMATS.join("|")+"|word|powerpoint|excel|prezentare|document|fisier|format|markdown|jupyter|notebook)\\b","g")," ");
  stripped=stripped.replace(/\b(trimite|da|dami|descarca|exporta|export|salveaza|creeaza|genereaza|fa|fami|in|ca|te|rog|mi|un|o|acum|si|imi|mie|format|fisier|fisierul|document|documentul)\b/g," ").replace(/[-.\s]+/g," ").trim();
  return !stripped;
}
function groupLabel(ts) {
  const d = new Date(ts || Date.now()), now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.floor((start - t) / 86400000);
  if (days <= 0) return tr("Today");
  if (days === 1) return tr("Yesterday");
  if (days <= 7) return tr("Previous 7 days");
  if (days <= 30) return tr("Previous 30 days");
  return tr("Older");
}
async function extractVideoFrames(blob,count=4) {
  if(typeof document==="undefined")return [];
  const url=URL.createObjectURL(blob),video=document.createElement("video");
  video.muted=true;video.preload="metadata";video.src=url;
  try{
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error("Video metadata timeout")),10000);
      video.onloadedmetadata=()=>{clearTimeout(timer);resolve()};
      video.onerror=()=>{clearTimeout(timer);reject(new Error("Video invalid"))};
      video.load();
    });
    const duration=Number(video.duration||0);
    if(!Number.isFinite(duration)||duration<=0||!video.videoWidth||!video.videoHeight)return [];
    const fractions=count===1?[0.5]:[0.08,0.34,0.62,0.9].slice(0,count);
    const out=[];
    for(const fraction of fractions){
      const target=Math.max(0.01,Math.min(duration-0.01,duration*fraction));
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error("Video seek timeout")),8000);
        const done=()=>{clearTimeout(timer);resolve()};
        video.onseeked=done;video.onerror=()=>{clearTimeout(timer);reject(new Error("Video seek error"))};
        video.currentTime=target;
      });
      const maxSide=768,scale=Math.min(1,maxSide/Math.max(video.videoWidth,video.videoHeight));
      const canvas=document.createElement("canvas");
      canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));
      const ctx=canvas.getContext("2d");ctx.drawImage(video,0,0,canvas.width,canvas.height);
      out.push({type:"image_url",image_url:{url:canvas.toDataURL("image/jpeg",0.72)}});
    }
    return out;
  } finally {URL.revokeObjectURL(url);video.removeAttribute("src");}
}
async function libraryItemToAttachment(item) {
  const d=(await api(`/api/library/${item.id}`)).data;
  if(!d?.id)throw new Error("Fișierul nu a fost găsit în Bibliotecă.");
  const kind=mediaKind(d.mime,d.name)||d.kind;
  const base={name:d.name,mime:d.mime||"",size:d.size||0,libraryId:d.id};
  if(kind==="image"){
    if(/heic|heif/i.test(`${d.mime} ${d.name}`))return {...base,type:"stored",part:{type:"text",text:`Imagine atașată: ${d.name}. Formatul HEIC/HEIF nu este acceptat de modelele AI; salvează poza ca JPG sau PNG și atașeaz-o din nou.`}};
    if(Number(d.size||0)<=20*1024*1024)return {...base,type:"image",part:{type:"image_url",image_url:{url:`serasmart-library://${d.id}`}}};
    return {...base,type:"stored",part:{type:"text",text:`Imagine atașată: ${d.name} (${formatBytes(d.size)}). Depășește 20 MB, așa că AI-ul nu o poate analiza direct.`}};
  }
  if(kind==="text"&&Number(d.size||0)<=10*1024*1024){
    const text=(await (await fetchLibraryBlob(d.id)).text()).slice(0,250000);
    return {...base,type:"text",part:{type:"text",text:`Conținutul fișierului ${d.name}:\n${text}`}};
  }
  if(kind==="audio"||kind==="video"){
    let transcript="",transcriptionError="";
    if(Number(d.size||0)<=25*1024*1024){
      try{const tr=await api(`/api/library/${d.id}/transcribe`,{method:"POST",body:JSON.stringify({language:DICTATION_LANG})});transcript=String(tr.text||"").trim()}
      catch(e){transcriptionError=e.message}
    }else transcriptionError="Fișierul depășește 25 MB pentru transcriere automată.";
    let frames=[];
    if(kind==="video"&&Number(d.size||0)<=100*1024*1024){
      try{frames=await extractVideoFrames(await fetchLibraryBlob(d.id),4)}catch{}
    }
    const details=[
      `Fișier ${kind==="video"?"video":"audio"} atașat: ${d.name} (${formatBytes(d.size)}).`,
      transcript?`Transcriere audio:\n${transcript}`:"",
      kind==="video"&&frames.length?`${frames.length} cadre reprezentative din videoclip sunt atașate după această descriere.`:"",
      !transcript&&transcriptionError?`Transcriere indisponibilă: ${transcriptionError}`:""
    ].filter(Boolean).join("\n\n");
    return {...base,type:kind,transcript,part:{type:"text",text:details},transientParts:frames};
  }
  if(typeof d.text==="string"&&d.text.trim()){
    const limit=120000,body=d.text.length>limit?d.text.slice(0,limit)+"\n[… document trunchiat]":d.text;
    return {...base,type:"document",part:{type:"text",text:`Conținutul fișierului ${d.name}:\n${body}`}};
  }
  const why=d.textStatus==="pending"?"textul este încă în curs de citire; încearcă din nou în câteva secunde":d.textStatus==="empty"?"fișierul nu conține text citibil (de exemplu un PDF scanat)":"conținutul acestui tip de fișier nu poate fi citit automat";
  return {...base,type:"stored",part:{type:"text",text:`Fișier atașat: ${d.name} (${formatBytes(d.size)}). Este salvat în Biblioteca ${BRAND_NAME}, dar ${why}.`}};
}
function toProviderMessages(messages,extra={}){
  return (messages||[]).map(m=>{
    if(!m||!["user","assistant","system"].includes(m.role)||m.error||m.mediaGenerationError)return null;
    let content=m.content;
    if(m.role==="assistant"&&typeof content==="string"&&!content.trim()&&m.attachmentOnly)content=String(m.artifactSource||"");
    if(m.role==="assistant"&&m.mediaKind&&m.attachments?.length&&!String(content||"").trim())content=`Am generat ${m.mediaKind==="video"?"videoclipul":"imaginea"} „${m.attachments[0]?.name||"fișier"}”.`;
    const more=extra[m.id];
    if(more?.length)content=[...(Array.isArray(content)?content:(String(content||"").trim()?[{type:"text",text:String(content)}]:[])),...more];
    if(Array.isArray(content)){
      content=content.filter(p=>p&&((p.type==="text"&&String(p.text||"").trim())||(p.type==="image_url"&&p.image_url?.url))).map(p=>p.type==="text"?{type:"text",text:String(p.text)}:{type:"image_url",image_url:{url:p.image_url.url}});
      if(!content.length)return null;
    }else{
      content=String(content??"");
      if(!content.trim())return null;
    }
    return {role:m.role,content};
  }).filter(Boolean);
}

function cachedModels() {
  const v=storage.json(MODEL_CACHE_KEY,[]);
  return Array.isArray(v)?v.filter(x=>typeof x==="string"&&x):[];
}
function uniqueModels(values) {
  return [...new Set((values||[]).map(x=>String(x||"").trim()).filter(Boolean))];
}

// Sign-in calls answer with more than an error: "verify_email" asks for the code sent by email.
async function authPost(path,body){
  const r=await fetch(`${GATEWAY}${path}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const text=await r.text();let data={};try{data=JSON.parse(text||"{}")}catch{}
  return {ok:r.ok,status:r.status,data,error:r.ok?"":errorFromBody(text,r.status)};
}
function AuthScreen({ onAuth, notice:initialNotice="" }) {
  const [code,setCode]=useState(""),[resendIn,setResendIn]=useState(0);
  useEffect(()=>{if(resendIn<=0)return;const t=setTimeout(()=>setResendIn(n=>n-1),1000);return()=>clearTimeout(t)},[resendIn]);
  const [mode,setMode]=useState("login"),[name,setName]=useState(""),[email,setEmail]=useState(""),[password,setPassword]=useState(""),[error,setError]=useState(""),[notice,setNotice]=useState(initialNotice),[busy,setBusy]=useState(false),[cloud,setCloud]=useState(null),[networkIssue,setNetworkIssue]=useState(false);
  useEffect(()=>{setNotice(initialNotice)},[initialNotice]);
  useEffect(()=>{
    let active=true;
    fetch(`${GATEWAY}/health`).then(r=>r.json()).then(h=>{if(active)setCloud(!!h.cloudConfigured)}).catch(()=>{if(active)setCloud(null)});
    return()=>{active=false};
  },[]);
  async function submit(e) {
    e.preventDefault(); if(busy)return; setBusy(true); setError(""); setNotice(""); setNetworkIssue(false);
    try {
      if(mode==="verify"){
        const v=await authPost("/auth/verify-email",{email,code:code.trim()});
        if(!v.ok)throw new Error(v.error);
        setNotice(v.data.message||"Email confirmat. Accesul așteaptă aprobarea Owner-ului.");setMode("login");setCode("");setPassword("");return;
      }
      const r = await authPost(mode==="login"?"/auth/login":"/auth/register",mode==="login"?{email,password}:{name,email,password});
      if(r.data?.status==="verify_email"){
        setMode("verify");setCode("");setNotice(r.ok?(r.data.message||"Ți-am trimis un cod pe email."):"Confirmă mai întâi emailul cu codul primit. Dacă nu-l găsești, uită-te și în Spam sau cere unul nou.");if(r.ok)setResendIn(60);return;
      }
      if(!r.ok)throw new Error(r.error);
      const data=r.data;
      if(data?.status==="pending"&&!data?.token){
        setNotice(data.message||"Contul a fost creat și așteaptă aprobarea Owner-ului.");
        setMode("login"); setPassword(""); return;
      }
      if(!data?.token||!data?.user) throw new Error("Serverul nu a returnat o sesiune validă.");
      storage.set(TOKEN_KEY,data.token); storage.set(USER_KEY,JSON.stringify(data.user)); storage.set(PERMISSIONS_KEY,JSON.stringify(data.permissions||{}));
      onAuth(data.user,data.permissions||{});
    } catch(e2){ setError(e2.message); if(/failed to fetch|networkerror|load failed/i.test(e2.message))setNetworkIssue(true); } finally { setBusy(false); }
  }
  async function resendCode(){
    if(busy||resendIn>0)return;setBusy(true);setError("");
    try{const r=await authPost("/auth/resend-code",{email});if(!r.ok)throw new Error(r.error);setNotice(r.data.message||"Ți-am trimis un cod nou.");setResendIn(60)}
    catch(e){setError(e.message)}finally{setBusy(false)}
  }
  function resetGateway(){setGatewayUrl(DEFAULT_GATEWAY);Promise.resolve(window.Serasmart?.setConfig?.({gatewayUrl:DEFAULT_GATEWAY})).catch(()=>{});setNetworkIssue(false);setError("");setNotice("Am revenit la serviciul local implicit. Încearcă din nou autentificarea.");}
  return <div className="authShell"><div className="authGlow"/>
    <div className="authBrand"><img src="./serasmart-ai-768.webp" alt={`${BRAND_NAME}`}/><h1>{BRAND_NAME}</h1><p>Asistentul tău AI</p>
      <div className="authFeature"><Sparkles size={17}/> Chat AI profesional, memorie, fișiere, design și sarcini programate.</div>
      <div className="authFeature"><Wifi size={17}/> Conectare prin OmniRoute sau prin API-uri directe.</div>
      <div className="authFeature"><User size={17}/> {cloud?"Cont personal cu aprobare Owner.":"Cont personal protejat cu parolă."}</div>
    </div>
    <form className="authCard" onSubmit={submit}>
      <div className="authTabs" role="tablist"><button type="button" role="tab" aria-selected={mode==="login"} className={mode==="login"?"active":""} onClick={()=>{setMode("login");setError("");}}>Autentificare</button><button type="button" role="tab" aria-selected={mode==="register"} className={mode==="register"?"active":""} onClick={()=>{setMode("register");setError("");setNotice("");}}>Creează cont</button></div>
      {mode==="verify"?<>
      <h2>Confirmă emailul</h2>
      <p className="muted">Am trimis un cod de 6 cifre la <b>{email}</b>. Dacă nu-l vezi, uită-te și în Spam. Codul expiră în 15 minute.</p>
      <label>Cod din email<input value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,"").slice(0,6))} placeholder="123456" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus className="codeInput"/></label>
      {notice&&<div className="authNotice" role="status"><UserCheck size={17}/><span>{notice}</span></div>}
      {error&&<div className="authError" role="alert">{error}</div>}
      <button className="primaryWide" disabled={busy||code.length!==6}>{busy?"Se procesează…":"Confirmă emailul"}</button>
      <div className="codeActions"><button type="button" className="linkBtn" disabled={busy||resendIn>0} onClick={resendCode}>{resendIn>0?`Retrimite codul (${resendIn}s)`:"Retrimite codul"}</button><button type="button" className="linkBtn" onClick={()=>{setMode("login");setError("");setNotice("")}}>Înapoi</button></div>
      </>:<>
      <h2>{mode==="login"?"Bine ai revenit":`Creează contul ${BRAND_NAME}`}</h2>
      <p className="muted">{mode==="register"?(cloud?"Primești un cod pe email ca să confirmi adresa, apoi contul e aprobat de Owner.":IS_WEB?`Contul se creează pe serverul ${BRAND_NAME}.`:"Contul se creează pe acest calculator și îl poți folosi imediat."):`Folosește emailul contului tău ${BRAND_NAME}.`}</p>
      {mode==="register"&&<label>Nume<input value={name} onChange={e=>setName(e.target.value)} placeholder="Numele tău" autoComplete="name"/></label>}
      <label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="nume@email.ro" required autoComplete="email"/></label>
      <label>Parolă<input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder={mode==="register"?"Minimum 10 caractere":"Parola contului"} required minLength={mode==="register"?10:undefined} autoComplete={mode==="register"?"new-password":"current-password"}/></label>
      {notice&&<div className="authNotice" role="status"><UserCheck size={17}/><span>{notice}</span></div>}
      {error&&<div className="authError" role="alert">{error}</div>}
      {networkIssue&&GATEWAY!==DEFAULT_GATEWAY&&<button type="button" className="secondary wideBtn" onClick={resetGateway}>Folosește serviciul local implicit</button>}
      <button className="primaryWide" disabled={busy}>{busy?"Se procesează…":mode==="login"?`Intră în ${BRAND_NAME}`:(cloud?"Trimite cererea de acces":"Creează contul")}</button>
      <div className="localNote">{cloud?"Owner-ul controlează aprobarea conturilor și permisiunile serviciilor AI.":IS_WEB?`Conturile și conversațiile sunt păstrate pe serverul ${BRAND_NAME}.`:"Conturile și conversațiile sunt păstrate pe acest calculator."}</div>
      </>}
      <InstallApp/>
    </form>
  </div>;
}

function BrandMark({small=false}) { return <div className={cx("brandMark",small&&"small")}><img src="./serasmart-ai-mark.webp" alt={`${BRAND_NAME}`}/></div>; }

// 0.7.26: the order of the approved mockup; labels in English, shown through tr().
const TOOL_ITEMS=[["explore",Compass,"Explore",null],["library",Library,"Library",null],["plugins",Plug,"Apps","plugins"],["skills",Sparkles,"Skills",null],["automations",CalendarClock,"Automations","automations"],["design",Palette,"Design","document_generation"],["memory",Brain,"Memory",null],["code",SquareTerminal,"Code","code"],["usage",Gauge,"Usage",null]];
// The plan's week under the menu (only when plans and credits are on and the account pays): opens Usage.
function SideUsage({onOpen}) {
  const [d,setD]=useState(null);
  useEffect(()=>{let live=true;const load=()=>api("/api/credits?peek=1").then(x=>{if(live)setD(x)}).catch(()=>{});load();window.addEventListener("focus",load);return()=>{live=false;window.removeEventListener("focus",load)}},[]);
  if(!d?.enabled||d.unlimited||!d.week)return null;
  const p=Math.max(0,Math.min(100,Number(d.week.percent)||0));
  return <button className="sideUsage" onClick={onOpen} aria-label={tr("{plan} plan: {percent}% of this week used",{plan:d.plan?.name||"",percent:p})}>
    <span className="sideUsageHead"><span>{d.plan?.name} · {tr("this week")}</span><b>{p}%</b></span>
    <span className="sideUsageBar"><span style={{width:`${p}%`}}/></span>
  </button>;
}
function Sidebar({open,setOpen,user,search,setSearch,projects,assistants,conversations,currentId,busyIds,onSelect,onDeleteConversation,onUnarchive,onNew,selectedProject,setSelectedProject,activeAssistantId,onUseAssistant,onNewProject,onNewAssistant,onEditProject,onEditAssistant,onTool,onSettings,onLogout}) {
  const {can,isOwner}=useAccess();
  const [showArchived,setShowArchived]=useState(false);
  const searchQuery=String(search||"").trim().toLowerCase();
  const archived=useMemo(()=>conversations.filter(c=>c.archived),[conversations]);
  const searchResults=useMemo(()=>{
    if(!searchQuery)return [];
    return conversations.map(c=>{
      const title=String(c.title||"Conversație");
      const titleHit=title.toLowerCase().includes(searchQuery);
      let snippet="",matchedAt=0;
      for(const m of c.messages||[]){
        const text=messageText(m);
        const idx=text.toLowerCase().indexOf(searchQuery);
        if(idx>=0){
          matchedAt=Number(m.createdAt||c.updatedAt||0);
          const from=Math.max(0,idx-70),to=Math.min(text.length,idx+searchQuery.length+110);
          snippet=(from>0?"…":"")+text.slice(from,to).replace(/\s+/g," ").trim()+(to<text.length?"…":"");
          break;
        }
      }
      if(!titleHit&&!snippet)return null;
      return {conversation:c,snippet,matchedAt};
    }).filter(Boolean).sort((a,b)=>(b.matchedAt||b.conversation.updatedAt||0)-(a.matchedAt||a.conversation.updatedAt||0));
  },[conversations,searchQuery]);
  const groups=useMemo(()=>{
    const out={};
    conversations.filter(c=>!c.archived&&(!selectedProject||c.projectId===selectedProject)).forEach(c=>{const g=groupLabel(c.updatedAt);(out[g]||=[]).push(c)});
    return Object.entries(out);
  },[conversations,selectedProject]);
  const anyVisible=conversations.some(c=>!c.archived);
  const busySet=new Set(busyIds||[]);
  useLanguage();
  const brandWords=BRAND_NAME.split(" "),brandLast=brandWords.length>1?brandWords.pop():"";
  return <aside className={cx("sidebar",open&&"open")} aria-label={tr("Navigation")}>
    <div className="sideTop"><div className="brandLine"><BrandMark small/><div><b className="wordmark">{brandWords.join(" ").toUpperCase()}{brandLast&&<> <em>{brandLast.toUpperCase()}</em></>}</b><span>{tr("Your AI, every model")}</span></div></div><button className="iconOnly mobileClose" onClick={()=>setOpen(false)} aria-label={tr("Close the menu")} title={tr("Close the menu")}><X size={20}/></button></div>
    <button className="newChat" onClick={onNew}><SquarePen size={17}/> {tr("New chat")}</button>
    <div className="searchBox"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>{if(e.key==="Escape"&&search){e.preventDefault();setSearch("")}}} placeholder={tr("Search chats")} aria-label={tr("Search chats")}/>{search&&<button className="searchClear" onClick={()=>setSearch("")} title={tr("Clear the search")} aria-label={tr("Clear the search")}><X size={14}/></button>}</div>
    <div className="sideScroll">
      <nav className="sideSection sideTools" aria-label={tr("Tools")}>
        {TOOL_ITEMS.filter(([name])=>name!=="code"||can("code")).map(([name,Icon,label,perm])=>{const locked=perm&&!can(perm);return <button key={name} className={cx("sideItem",name==="explore"?"exploreItem":"toolItem",locked&&"locked")} onClick={()=>onTool(name)} title={locked?deniedMessage(perm):tr(label)}><Icon size={17}/> {tr(label)}{locked&&<Lock size={13} className="lockIcon"/>}</button>})}
        {isOwner&&<button className="sideItem ownerItem" onClick={()=>onTool("admin")}><ShieldCheck size={17}/> Control Center</button>}
      </nav>
      <div className="sideSection"><div className="sectionHead"><span>{tr("Projects")}</span><button onClick={onNewProject} aria-label={tr("New project")} title={tr("New project")}><Plus size={15}/></button></div>
        <button className={cx("sideItem",selectedProject===null&&"active")} onClick={()=>setSelectedProject(null)}><Folder size={16}/> {tr("All chats")}</button>
        {projects.map(p=><div key={p.id} className={cx("sideRow",selectedProject===p.id&&"active")}><button className={cx("sideItem",selectedProject===p.id&&"active")} onClick={()=>setSelectedProject(p.id)} title={p.name}><Folder size={16}/><span className="sideLabel">{p.name}</span></button><button className="sideEdit" onClick={()=>onEditProject(p)} aria-label={tr("Edit the project {name}",{name:p.name})} title={tr("Edit the project")}><Pencil size={13}/></button></div>)}
      </div>
      <div className="sideSection"><div className="sectionHead"><span>{tr("Assistants")}</span><button onClick={onNewAssistant} aria-label={tr("New assistant")} title={tr("New assistant")}><Plus size={15}/></button></div>
        {assistants.map(a=><div key={a.id} className={cx("sideRow",activeAssistantId===a.id&&"active")}><button className={cx("sideItem",activeAssistantId===a.id&&"active")} onClick={()=>onUseAssistant(a.id)} title={tr("New chat with {name}",{name:a.name})}><Bot size={16}/><span className="sideLabel">{a.name}</span></button>{!a.builtIn&&<button className="sideEdit" onClick={()=>onEditAssistant(a)} aria-label={tr("Edit the assistant {name}",{name:a.name})} title={tr("Edit the assistant")}><Pencil size={13}/></button>}</div>)}
        {!assistants.length&&<div className="sideEmpty">{tr("No custom assistants yet.")}</div>}
      </div>
      <div className="sideSection historySection">
        <div className="sectionHead"><span>{searchQuery?tr("Search results"):tr("Chats")}</span>{searchQuery&&<small>{searchResults.length}</small>}</div>
        {searchQuery?<>
          {currentId&&<button className="currentConversationReturn" onClick={()=>{onSelect(currentId);setSearch("")}}><RotateCcw size={15}/><span><b>{tr("Current chat")}</b><small>{tr("Go back to the chat you were in")}</small></span></button>}
          <div className="conversationSearchResults">
            {searchResults.map(({conversation:c,snippet})=><button key={c.id} className={cx("conversationSearchResult",currentId===c.id&&"current")} onClick={()=>{onSelect(c.id);setSearch("")}}>
              <div className="conversationSearchHead"><b>{c.title||tr("Chat")}</b>{currentId===c.id?<span>{tr("Current")}</span>:c.archived?<span>{tr("Archived")}</span>:null}</div>
              {snippet&&<p>{snippet}</p>}
              <small><Search size={12}/> {tr("Open the chat")}</small>
            </button>)}
            {!searchResults.length&&<div className="searchNoResults"><Search size={18}/><span>{tr("This text is not in your chats.")}</span></div>}
          </div>
        </>:<>
          {groups.map(([g,items])=><div key={g} className="historyGroup"><div className="historyLabel">{g}</div>{items.map(c=><div className={cx("historyRow",currentId===c.id&&"active")} key={c.id}><button className="historyItem" onClick={()=>onSelect(c.id)} title={c.title}>{busySet.has(c.id)&&<span className="historyBusy" aria-label={tr("Answer in progress")}/>}{c.title||tr("Chat")}</button><button className="historyDelete" title={tr("Delete the chat")} aria-label={tr("Delete the chat {name}",{name:c.title||""})} onClick={e=>{e.stopPropagation();onDeleteConversation(c.id)}}><Trash2 size={14}/></button></div>)}</div>)}
          {!groups.length&&<div className="sideEmpty">{selectedProject?tr("No chats in this project yet. Write a message to start one."):anyVisible?tr("No chats to show."):tr("No chats yet.")}</div>}
          {archived.length>0&&<div className="archivedBlock">
            <button className="archivedToggle" onClick={()=>setShowArchived(v=>!v)} aria-expanded={showArchived}><Archive size={14}/> {tr("Archived")} ({archived.length}) <ChevronDown size={14} className={showArchived?"open":""}/></button>
            {showArchived&&archived.map(c=><div className={cx("historyRow archivedRow",currentId===c.id&&"active")} key={c.id}><button className="historyItem" onClick={()=>onSelect(c.id)} title={c.title}>{c.title||tr("Chat")}</button><button className="historyDelete" title={tr("Restore the chat")} aria-label={tr("Restore the chat {name}",{name:c.title||""})} onClick={e=>{e.stopPropagation();onUnarchive(c.id)}}><ArchiveRestore size={14}/></button></div>)}
          </div>}
        </>}
      </div>
    </div>
    <div className="accountArea">
      <SideUsage onOpen={()=>onTool("usage")}/>
      <div className="accountBadge"><div className="accountAvatar">{(user?.name||user?.email||"S")[0].toUpperCase()}</div><div className="accountText"><b>{user?.name||tr("{brand} account",{brand:BRAND_SHORT})}</b><span>{user?.email}{user?.role==="owner"?" · Owner":""}</span></div>
        <div className="accountButtons"><button onClick={onSettings} aria-label={tr("Settings")} title={tr("Settings")}><Settings size={17}/></button><button onClick={onLogout} aria-label={tr("Sign out")} title={tr("Sign out")}><LogOut size={17}/></button></div></div>
    </div>
  </aside>;
}

const MODEL_PROVIDERS=[["cerebras","Cerebras"],["groq","Groq"],["gemini","Gemini"],["mistral","Mistral"],["nvidia","NVIDIA"],["github","GitHub Models"],["openrouter","OpenRouter"],["cloudflare","Cloudflare Workers AI"],["cohere","Cohere"],["huggingface","Hugging Face"],["openai","OpenAI"]];
// Combinations (names without "provider/") first, then one group per direct provider, then the rest of OmniRoute.
const COMBO_CACHE_KEY="serasmartComboModelsV1";
let COMBO_IDS=new Set(storage.json(COMBO_CACHE_KEY,[])||[]);
function groupModels(list){
  const groups=new Map();
  const add=(key,name,x,opts)=>{if(!groups.has(key))groups.set(key,{name,items:[],...opts});groups.get(key).items.push(x)};
  for(const x of list){
    const id=String(x||"");
    if(COMBO_IDS.has(id)||!id.includes("/")){add("combo","OmniRoute combinations",id,{combo:true,short:v=>v});continue;}
    const prefix=id.split("/")[0].toLowerCase(),known=MODEL_PROVIDERS.find(([k])=>k===prefix);
    if(known)add(known[0],known[1],id,{short:v=>v.slice(prefix.length+1)});
    else add("omni","Other OmniRoute models",id,{short:v=>v});
  }
  // Your own combinations ("Ai principal" …) before OmniRoute's automatic auto/* ones.
  const combo=groups.get("combo");
  if(combo)combo.items=[...combo.items.filter(v=>!/^auto\//i.test(v)),...combo.items.filter(v=>/^auto\//i.test(v))];
  const order=["combo",...MODEL_PROVIDERS.map(([k])=>k),"omni"];
  return order.filter(k=>groups.has(k)).map(k=>groups.get(k));
}
function ModelPicker({model,onSelect,models,onRefresh,refreshing,policyEnforced,deniedCount=0,locked=[]}) {
  const [open,setOpen]=useState(false),[query,setQuery]=useState("");
  const ref=useRef(null),listRef=useRef(null);
  useDismiss(open,()=>setOpen(false),ref);
  useEffect(()=>{if(!open)setQuery("")},[open]);
  useEffect(()=>{if(open)setTimeout(()=>{const el=ref.current?.querySelector(".modelSearch input")||listRef.current?.querySelector(".modelOption.active")||listRef.current?.querySelector(".modelOption");el?.focus()},0)},[open]);
  const list=policyEnforced?uniqueModels(models):uniqueModels([model,...models]);
  // The models the Owner does not allow this account: listed too, locked; choosing one only says why.
  const lockedMap=new Map((locked||[]).filter(x=>x&&x.id&&!list.includes(x.id)).map(x=>[String(x.id),String(x.reason||"")]));
  const all=[...list,...lockedMap.keys()];
  const filtered=all.filter(x=>!query||x.toLowerCase().includes(query.toLowerCase()));
  const notAllowed=x=>toast(tr("«{model}» is not allowed for you by the Owner.",{model:x})+(lockedMap.get(x)?" "+lockedMap.get(x):"")+" "+tr("Ask for access or pick another model."));
  function onListKey(e){
    if(e.key!=="ArrowDown"&&e.key!=="ArrowUp")return;
    const items=[...(listRef.current?.querySelectorAll(".modelOption")||[])];if(!items.length)return;
    e.preventDefault();const i=items.indexOf(document.activeElement);
    const next=e.key==="ArrowDown"?items[Math.min(items.length-1,i+1)]:items[Math.max(0,i-1)];next?.focus();
  }
  return <div className="modelSelectCluster" ref={ref}>
    <div className="modelPicker">
      <button className={cx("modelPickerButton",open&&"open")} onClick={()=>setOpen(v=>!v)} aria-haspopup="listbox" aria-expanded={open} aria-label={tr("AI model: {model}",{model:model||tr("none")})}>
        <span className="modelPickerDot"/>
        <span className="modelPickerText"><b>{model||tr("Choose an AI")}</b><small>{list.length?tr(list.length===1?"{n} model available":"{n} models available",{n:list.length}):tr("No model available")}{lockedMap.size?" · "+tr("{n} not allowed",{n:lockedMap.size}):policyEnforced?" · "+tr("set by the Owner"):""}</small></span>
        <ChevronDown size={15}/>
      </button>
    {open&&<div className="modelPickerMenu" onKeyDown={onListKey}>
      <div className="modelPickerHead"><div><b>{tr("Choose the AI")}</b><span>{tr("The change applies to this chat.")}</span></div><button className="modelRefresh" onClick={async e=>{e.stopPropagation();await onRefresh?.()}} disabled={refreshing} title={tr("Refresh the list of models")} aria-label={tr("Refresh the list of models")}><RotateCcw size={14} className={refreshing?"spin":""}/></button></div>
      {all.length>7&&<div className="modelSearch"><Search size={14}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder={tr("Search models")} aria-label={tr("Search models")}/></div>}
      <div className="modelPickerList" role="listbox" ref={listRef}>
        {groupModels(filtered).map(g=><div className="modelGroup" key={g.name} role="group" aria-label={tr(g.name)}>
          <div className="modelGroupName">{tr(g.name)}</div>
          {g.items.map(x=>lockedMap.has(x)?<button key={x} className="modelOption locked" onClick={()=>notAllowed(x)} role="option" aria-selected={false} aria-disabled="true" title={lockedMap.get(x)||tr("Not allowed by the Owner")}>
            <span className="modelOptionIcon"><Lock size={15}/></span>
            <span className="modelOptionCopy"><b>{g.short(x)}</b><small>{tr("Not allowed by the Owner")}</small></span>
          </button>:<button key={x} className={cx("modelOption",x===model&&"active")} onClick={()=>{onSelect(x);setOpen(false)}} role="option" aria-selected={x===model}>
            <span className="modelOptionIcon"><Sparkles size={15}/></span>
            <span className="modelOptionCopy"><b>{g.short(x)}</b><small>{x===model?tr("Selected"):g.combo?tr("OmniRoute combination"):tr("Use this AI")}</small></span>
            {x===model&&<Check size={16}/>}
          </button>)}
        </div>)}
        {!all.length&&<div className="modelEmpty">{tr("No models available.")} {policyEnforced?tr("Ask the Owner for access to at least one model."):IS_WEB?tr("The server's Owner has to add an AI key."):tr("Start OmniRoute or add an API key in Settings.")}</div>}
        {all.length>0&&!filtered.length&&<div className="modelEmpty">{tr("No model matches.")}</div>}
      </div>
      <div className="modelPickerFoot">{refreshing?tr("Refreshing the list…"):policyEnforced||lockedMap.size?tr("The Owner decides which models your account can use.")+(lockedMap.size?" "+tr("The locked ones are not allowed for you."):deniedCount>0?" "+tr("{n} OmniRoute models are hidden by the Owner.",{n:deniedCount}):""):(IS_WEB?tr("The models come from OmniRoute and the APIs set up on the server."):tr("The models come from OmniRoute and the APIs set up on this PC."))}</div>
    </div>}
    </div>
  </div>;
}

// Dark / light (0.7.26), stored on this device.
function ThemeSwitch() {
  useTheme();useLanguage();
  const now=resolvedTheme();
  return <div className="themeSwitch" role="group" aria-label={tr("Theme")}>
    <button aria-pressed={now==="dark"} className={cx(now==="dark"&&"on")} onClick={()=>setTheme("dark")} title={tr("Dark")}><Moon size={15}/><span>{tr("Dark")}</span></button>
    <button aria-pressed={now==="light"} className={cx(now==="light"&&"on")} onClick={()=>setTheme("light")} title={tr("Light")}><Sun size={15}/><span>{tr("Light")}</span></button>
  </div>;
}
// The interface language (0.7.26): English by default, 24 languages, stored on this device.
function LanguageMenu() {
  const lang=useLanguage();
  const [open,setOpen]=useState(false),[q,setQ]=useState("");
  const ref=useRef(null);
  useDismiss(open,()=>setOpen(false),ref);
  useEffect(()=>{if(!open)setQ("")},[open]);
  const name=(LANGUAGES.find(([c])=>c===lang)||LANGUAGES[0])[1];
  const shown=LANGUAGES.filter(([c,n])=>!q||n.toLowerCase().includes(q.toLowerCase())||c.includes(q.toLowerCase()));
  return <div className="langWrap" ref={ref}>
    <button className={cx("langButton",open&&"open")} onClick={()=>setOpen(v=>!v)} aria-haspopup="menu" aria-expanded={open} aria-label={tr("Language: {name}",{name})} title={tr("Language")}><Globe2 size={16}/><span>{name}</span><ChevronDown size={14}/></button>
    {open&&<div className="langMenu" role="menu" aria-label={tr("Language")}>
      <label className="langSearch"><Search size={14}/><input autoFocus value={q} onChange={e=>setQ(e.target.value)} placeholder={tr("Search {n} languages",{n:LANGUAGES.length})} aria-label={tr("Search languages")}/></label>
      <div className="langGrid">{shown.map(([c,n])=><button key={c} role="menuitemradio" aria-checked={c===lang} lang={c} className={cx(c===lang&&"on")} onClick={()=>{setLanguage(c);setOpen(false)}}><span>{n}</span>{c===lang&&<Check size={14}/>}</button>)}</div>
    </div>}
  </div>;
}
function Header({deniedCount,lockedModels=[],onMenu,model,onSelectModel,models,onRefreshModels,refreshingModels,policyEnforced,omni,showOmni,onShare,current,projects,onDetach,onMoveProject,onFiles,onGitHub,onGitHubRollback,hasGitHubBackup,onArchive,onUnarchive,onDelete}) {
  const {isOwner}=useAccess();
  const [more,setMore]=useState(false),[moveOpen,setMoveOpen]=useState(false);
  const moreRef=useRef(null);
  useDismiss(more,()=>{setMore(false);setMoveOpen(false)},moreRef);
  const close=()=>{setMore(false);setMoveOpen(false)};
  useLanguage();
  return <header className="topbar">
    <button className="iconOnly menuBtn" onClick={onMenu} aria-label={tr("Show or hide the menu")} title={tr("Menu")}><Menu size={20}/></button>
    <ModelPicker model={model} onSelect={onSelectModel} models={models} onRefresh={onRefreshModels} refreshing={refreshingModels} policyEnforced={policyEnforced} deniedCount={deniedCount} locked={lockedModels}/>
    <div className="topSpacer"/>
    {showOmni&&<div className={cx("connection",omni===true?"ok":"bad")} title={omni===true?tr("OmniRoute is answering."):omni==="key"?tr("OmniRoute is running but needs an API key: make one in OmniRoute → API Manager and put it in Settings → AI & OmniRoute. Until then the direct APIs (Groq, Gemini…) answer, if you pick them in the list."):tr("OmniRoute is not answering. Pick a model from a direct API (Groq, Gemini…) in the list, or turn on the automatic fallback.")}>{omni===true?<Wifi size={15}/>:<WifiOff size={15}/>} {omni===true?tr("OmniRoute connected"):omni==="key"?tr("OmniRoute needs an API key"):tr("OmniRoute stopped")}</div>}
    <ThemeSwitch/>
    <LanguageMenu/>
    <button className="topAction" onClick={onShare} disabled={!current} title={tr("Copy the chat to the clipboard")}><Share2 size={16}/> <span>{tr("Copy chat")}</span></button>
    <div className="moreWrap" ref={moreRef}>
      <button className="iconOnly" onClick={()=>{setMore(v=>!v);setMoveOpen(false)}} aria-label={tr("Chat options")} title={tr("Chat options")} aria-haspopup="menu" aria-expanded={more}><MoreHorizontal size={20}/></button>
      {more&&<div className="conversationMenu" role="menu">
        <button role="menuitem" disabled={!current?.projectId} onClick={()=>{onDetach();close()}}><PanelTopOpen size={18}/> {tr("Remove from project")}</button>
        <div className="menuSubWrap">
          <button role="menuitem" disabled={!current} onClick={()=>setMoveOpen(v=>!v)} aria-expanded={moveOpen}><Folder size={18}/> {tr("Move to project")} <span className="menuChevron">›</span></button>
          {moveOpen&&<div className="projectSubmenu">
            <button onClick={()=>{onMoveProject(null);close()}}>{tr("No project")}</button>
            {projects.map(p=><button key={p.id} onClick={()=>{onMoveProject(p.id);close()}}>{p.name}</button>)}
            {!projects.length&&<span className="menuNote">{tr("No projects yet. Create one from the side menu.")}</span>}
          </div>}
        </div>
        <div className="menuDivider"/>
        <button role="menuitem" disabled={!current} onClick={()=>{onFiles();close()}}><Library size={18}/> {tr("Files in this chat")}</button>
        {isOwner&&<button role="menuitem" onClick={()=>{onGitHub();close()}}><Globe2 size={18}/> GitHub Solve</button>}
        {isOwner&&hasGitHubBackup&&<button role="menuitem" onClick={()=>{onGitHubRollback();close()}}><RotateCcw size={18}/> {tr("Undo the last GitHub change")}</button>}
        <div className="menuDivider"/>
        {current?.archived
          ?<button role="menuitem" onClick={()=>{onUnarchive();close()}}><ArchiveRestore size={18}/> {tr("Restore from archive")}</button>
          :<button role="menuitem" disabled={!current} onClick={()=>{onArchive();close()}}><Archive size={18}/> {tr("Archive")}</button>}
        <button role="menuitem" className="dangerMenuItem" disabled={!current} onClick={()=>{onDelete();close()}}><Trash2 size={18}/> {tr("Delete")}</button>
      </div>}
    </div>
  </header>;
}

function CopyMessageButton({message,className=""}) {
  const [copied,setCopied]=useState(false),timer=useRef(null);
  useEffect(()=>()=>clearTimeout(timer.current),[]);
  async function copy(){
    const ok=await writeClipboardText(messageText(message));
    if(!ok){toast("Nu am putut copia textul în clipboard.");return;}
    setCopied(true);clearTimeout(timer.current);timer.current=setTimeout(()=>setCopied(false),1200);
  }
  return <button className={className} onClick={copy} title={copied?"Copiat":"Copiază mesajul"} aria-label="Copiază mesajul">{copied?<Check size={15}/>:<Copy size={15}/>}</button>;
}

const EXPORT_FORMATS=[["pdf","PDF"],["docx","Word"],["pptx","PowerPoint"]];
function MessageActions({message,title,disabled,onRegenerate,onRate}) {
  const {can,deny}=useAccess();
  const [speaking,setSpeaking]=useState(false),[exporting,setExporting]=useState(""),[exportMenu,setExportMenu]=useState(false);
  const speakingRef=useRef(false),exportRef=useRef(null);
  useDismiss(exportMenu,()=>setExportMenu(false),exportRef);
  useEffect(()=>()=>{if(speakingRef.current){try{window.speechSynthesis.cancel()}catch{}}},[]);
  function stopSpeaking(){speakingRef.current=false;setSpeaking(false);}
  function speak(){
    const text=messageText(message);if(!text)return;
    try{
      window.speechSynthesis.cancel();
      if(speaking){stopSpeaking();return;}
      const u=new SpeechSynthesisUtterance(text);u.lang=speechLocale();u.rate=1;u.onend=stopSpeaking;u.onerror=stopSpeaking;
      speakingRef.current=true;setSpeaking(true);window.speechSynthesis.speak(u);
    }catch{stopSpeaking();toast("Citirea cu voce nu este disponibilă pe acest calculator.")}
  }
  async function exp(format){
    if(!can("document_generation")){deny("document_generation");return;}
    if(exporting)return;
    setExporting(format);
    try{await exportMessageFile(message,format,title)}catch(e){toast("Export: "+e.message)}finally{setExporting("")}
  }
  const exportLocked=!can("document_generation");
  return <div className="messageActions">
    <CopyMessageButton message={message}/>
    {/* PDF / Word / PowerPoint behind one "Descarcă" button instead of three format labels in the row. */}
    <div className="exportWrap" ref={exportRef}>
      <button className={cx(exportLocked&&"locked",exportMenu&&"selected")} onClick={()=>{if(exportLocked){deny("document_generation");return;}setExportMenu(v=>!v)}} disabled={!!exporting} title={exportLocked?deniedMessage("document_generation"):"Descarcă răspunsul (PDF, Word, PowerPoint)"} aria-label="Descarcă răspunsul" aria-haspopup="menu" aria-expanded={exportMenu}>{exporting?<LoaderCircle size={15} className="spin"/>:<Download size={15}/>}</button>
      {exportMenu&&<div className="exportMenu" role="menu">{EXPORT_FORMATS.map(([f,label])=><button key={f} role="menuitem" onClick={()=>{setExportMenu(false);exp(f)}}><FileText size={15}/><span>{label}</span><small>.{f}</small></button>)}</div>}
    </div>
    <button onClick={speak} title={speaking?"Oprește citirea":"Citește cu voce"} aria-label={speaking?"Oprește citirea":"Citește cu voce"} aria-pressed={speaking}><Volume2 size={15}/></button>
    <button className={message.rating===1?"selected":""} onClick={()=>onRate(1)} disabled={disabled} title="Răspuns util" aria-label="Răspuns util" aria-pressed={message.rating===1}><ThumbsUp size={15}/></button>
    <button className={message.rating===-1?"selected":""} onClick={()=>onRate(-1)} disabled={disabled} title="Răspuns slab" aria-label="Răspuns slab" aria-pressed={message.rating===-1}><ThumbsDown size={15}/></button>
    <button onClick={onRegenerate} disabled={disabled} title="Regenerează răspunsul" aria-label="Regenerează răspunsul"><RotateCcw size={15}/></button>
  </div>;
}

function GeneratedAttachment({attachment}) {
  const kind=attachment?.kind||attachment?.type||(String(attachment?.mimeType||"").startsWith("image/")?"image":String(attachment?.mimeType||"").startsWith("video/")?"video":String(attachment?.mimeType||"").startsWith("audio/")?"audio":"file");
  const media=["image","video","audio"].includes(kind);
  const {src,failed}=useAuthedBlobUrl(media&&attachment?.id?`/api/files/${attachment.id}`:"");
  const [downloading,setDownloading]=useState(false),[viewing,setViewing]=useState(false);
  async function download(){
    if(downloading)return;setDownloading(true);
    try{await downloadGeneratedFile(attachment)}catch(e){toast(e.message)}finally{setDownloading(false)}
  }
  const viewer=viewing&&<FileViewer file={{...attachment,libraryId:attachment.id}} onClose={()=>setViewing(false)}/>;
  if(media){
    return <div className={cx("generatedMedia",kind)}>
      {viewer}
      {src?(kind==="image"?<img src={src} alt={attachment.name||`Imagine generată de ${BRAND_NAME}`} className="zoomable" onClick={()=>setViewing(true)} title="Deschide pe tot ecranul"/>:kind==="video"?<video controls preload="metadata" src={src}/>:<audio controls preload="metadata" src={src}/>)
        :<div className="mediaPlaceholder">{failed?"Previzualizarea nu este disponibilă. Fișierul a fost probabil șters din Bibliotecă.":"Se încarcă previzualizarea…"}</div>}
      <div className="generatedMediaBar"><span><b>{attachment.name}</b><small>{(attachment.mimeType||kind).replace(/^.*\//,"").toUpperCase()} · {formatBytes(attachment.size)}{attachment.provider?` · ${attachment.provider}`:""}</small></span><button onClick={()=>setViewing(true)} title="Deschide" aria-label={"Deschide "+(attachment.name||"fișierul")}><Maximize2 size={15}/></button><button onClick={download} disabled={downloading}><Download size={17}/> {downloading?"Se descarcă…":"Descarcă"}</button></div>
    </div>;
  }
  const openable=canView(attachment);
  // A generated document (PDF, Word, Excel, PowerPoint…): the card downloads it; "Deschide" shows it without downloading.
  return <div className="generatedFile">{viewer}<button className="generatedDownload" onClick={download} disabled={downloading} title={"Descarcă "+(attachment?.name||"fișierul")}><span className="generatedFileIcon"><FileText size={20}/></span><span className="generatedFileMeta"><b>{attachment?.name}</b><small>{(attachment?.format||attachment?.name?.split(".").pop()||"FIȘIER").toUpperCase()} · {formatBytes(attachment?.size)}</small></span><span className="generatedDownloadAction"><Download size={18}/><em>{downloading?"Se descarcă…":"Descarcă"}</em></span></button>{openable&&<button className="generatedOpen" onClick={()=>setViewing(true)} title={"Deschide "+(attachment?.name||"fișierul")} aria-label="Deschide fără descărcare"><Eye size={18}/></button>}</div>;
}

function MediaAttachment({attachment}) {
  const kind=attachment?.type;
  const isMedia=["image","audio","video"].includes(kind)&&!!attachment?.libraryId;
  const {src,failed}=useAuthedBlobUrl(isMedia?`/api/library/${attachment.libraryId}/content`:"");
  const [viewing,setViewing]=useState(false);
  async function download(){try{await downloadLibraryFile(attachment)}catch(e){toast(e.message)}}
  const viewer=viewing&&<FileViewer file={attachment} onClose={()=>setViewing(false)}/>;
  if(!isMedia)return <span className="fileChip">{viewer}<Paperclip size={12}/>{attachment?.name}{attachment?.libraryId&&canView(attachment)&&<button onClick={()=>setViewing(true)} title="Deschide" aria-label={`Deschide ${attachment?.name||"fișierul"}`}><Eye size={12}/></button>}{attachment?.libraryId&&<button onClick={download} title="Descarcă" aria-label={`Descarcă ${attachment?.name||"fișierul"}`}><Download size={12}/></button>}</span>;
  const Icon=kind==="audio"?Volume2:kind==="video"?Play:ImageIcon;
  return <div className={cx("messageMedia",kind)}>
    {viewer}
    <div className="messageMediaHead"><span><Icon size={15}/><b>{attachment.name}</b></span><button title="Deschide" aria-label={`Deschide ${attachment.name}`} onClick={()=>setViewing(true)}><Maximize2 size={15}/></button><button title="Descarcă" aria-label={`Descarcă ${attachment.name}`} onClick={download}><Download size={15}/></button></div>
    {src?(kind==="image"?<img src={src} alt={attachment.name} className="zoomable" onClick={()=>setViewing(true)}/>:kind==="audio"?<audio controls preload="metadata" src={src}/>:<video controls preload="metadata" src={src}/>)
      :<div className="mediaPlaceholder small">{failed?"Fișierul nu mai este disponibil în Bibliotecă.":"Se încarcă…"}</div>}
    {attachment.transcript&&<small>Pista audio a fost transcrisă pentru {BRAND_NAME}.</small>}
  </div>;
}

function ThinkingActivity({stage,steps=[]}) {
  const [open,setOpen]=useState(false);
  const visible=(steps.length?steps:[stage]).filter(Boolean);
  const current=stage||visible.at(-1)||"Pregătește răspunsul…";
  function iconFor(text){
    const t=String(text||"").toLowerCase();
    if(/memorie|context/.test(t))return <Brain size={16}/>;
    if(/fișier|document|pdf|docx|pptx/.test(t))return <FileText size={16}/>;
    if(/imagine|video|media/.test(t))return <ImageIcon size={16}/>;
    if(/web|internet|verific/.test(t))return <Globe2 size={16}/>;
    return <Sparkles size={16}/>;
  }
  return <div className={cx("thinkingActivity",open&&"open")} aria-live="polite">
    <button className="thinkingActivityHead" onClick={()=>setOpen(v=>!v)} aria-expanded={open}>
      <span className="thinkingActivityIcon">{iconFor(current)}</span>
      <span className="thinkingActivityTitle">{current}</span>
      <span className="thinkingActivityPulse"><i/><i/><i/></span>
      <ChevronDown size={17} className="thinkingActivityChevron"/>
    </button>
    {open&&<div className="thinkingActivitySteps">
      {visible.map((x,i)=><div key={i} className={cx("thinkingActivityStep",i===visible.length-1&&"active")}>
        <span>{iconFor(x)}</span><b>{x}</b>
      </div>)}
      <small>Se afișează doar etapele de lucru, nu raționamentul intern al modelului.</small>
    </div>}
  </div>;
}

function guessCodeLanguage(code,className){
  const cls=String(className||"").match(/language-([\w+#-]+)/)?.[1]?.toLowerCase();
  if(cls)return cls;
  return /^\s*(def |import \w|from \S+ import |print\(|class \w+:|if __name__)/m.test(String(code||""))?"python":"javascript";
}
// The empty chat (0.7.26): a greeting with the account's own first name and four general starting points, no names,
// places or addresses in them.
const WELCOME_STARTS=[[Mail,"Write an email","Write a short, friendly email that "],[ImageIcon,"Make a picture",null,"image"],[FileText,"Summarize a document","Summarize the attached document in five clear points."],[CalendarClock,"Plan my week","Help me plan my week. My priorities are: "]];
function Welcome({user,onPick}) {
  useLanguage();
  const h=new Date().getHours(),part=h<5||h>=18?"Good evening":h<12?"Good morning":"Good afternoon";
  const first=String(user?.name||"").trim().split(/\s+/)[0];
  return <div className="welcome">
    <BrandMark/>
    <h1>{first?tr(part+", {name}",{name:first}):tr(part)}</h1>
    <p>{tr("What are we working on today?")}</p>
    <div className="welcomeStarts">{WELCOME_STARTS.map(([Icon,label,text,mode])=><button key={label} onClick={()=>onPick?.(text?tr(text):"",mode)}><Icon size={15}/>{tr(label)}</button>)}</div>
  </div>;
}
function ConversationView({conversation,busy,busyStage,busySteps,onRegenerate,onRate,onCodeResult,canRunCode,onAnswer,onOpenSettings,user,onPick}) {
  const {isOwner}=useAccess();
  const [contextMenu,setContextMenu]=useState(null),[running,setRunning]=useState(false);
  useEffect(()=>{
    const close=()=>setContextMenu(null);
    const key=e=>{if(e.key==="Escape")close()};
    window.addEventListener("click",close);
    window.addEventListener("blur",close);
    window.addEventListener("scroll",close,true);
    window.addEventListener("keydown",key);
    return()=>{window.removeEventListener("click",close);window.removeEventListener("blur",close);window.removeEventListener("scroll",close,true);window.removeEventListener("keydown",key)};
  },[]);
  function openCopyMenu(e,message){
    e.preventDefault();e.stopPropagation();
    const pre=e.target?.closest?.("pre");
    const code=e.target?.closest?.("code")||pre?.querySelector?.("code");
    const selection=String(window.getSelection?.()?.toString?.()||"").trim();
    const codeText=String(pre?.innerText||(code?code.innerText:"")||"").trim();
    setContextMenu({
      x:Math.max(8,Math.min(e.clientX,window.innerWidth-235)),
      y:Math.max(8,Math.min(e.clientY,window.innerHeight-170)),
      messageText:messageText(message),
      codeText,
      language:guessCodeLanguage(codeText,code?.className),
      selection
    });
  }
  async function copyValue(value){if(!value)return;const ok=await writeClipboardText(value);if(!ok)toast("Nu am putut copia textul în clipboard.");setContextMenu(null)}
  async function runCodeValue(){
    if(!contextMenu?.codeText||running)return;
    setRunning(true);
    try{
      const d=await api("/api/tools/code/run",{method:"POST",body:JSON.stringify({language:contextMenu.language||"javascript",code:contextMenu.codeText})});
      const r=d.data||{};
      const report=[`Rezultat real de rulare ${BRAND_NAME}:`,`Limbaj: ${r.language||contextMenu.language}`,`Cod de ieșire: ${r.code}`,r.timedOut?"Timp depășit: DA":"Timp depășit: NU",r.stdout?`STDOUT:\n${r.stdout}`:"STDOUT: (gol)",r.stderr?`STDERR:\n${r.stderr}`:"STDERR: (gol)"].join("\n");
      onCodeResult?.(report);setContextMenu(null);toast("Codul a fost rulat. Rezultatul a fost pus în caseta de mesaj.","ok");
    }catch(e){toast("Rulare cod: "+e.message)}
    finally{setRunning(false)}
  }
  if(!conversation||!conversation.messages?.length)return <Welcome user={user} onPick={onPick}/>;
  const lastIndex=conversation.messages.length-1;
  return <div className="messagesColumn">
    {conversation.messages.map((m,i)=>{
      if(m.role==="user")return <div key={m.id||i} className="userRow"><div className="userMessageWrap"><div className="userBubble copyByRightClick" onContextMenu={e=>openCopyMenu(e,m)}><div className="userText">{messageText(m)}</div>{m.attachments?.length>0&&<div className="inlineAttachments mediaAttachments">{m.attachments.map((a,j)=><MediaAttachment key={a.libraryId||j} attachment={a}/>)}</div>}</div><div className="userMessageActions"><CopyMessageButton message={m}/></div></div></div>;
      if(m.role!=="assistant")return null;
      const text=String(m.content||(m.attachmentOnly?m.artifactSource||"":"")).trim();
      const questions=!m.error&&!m.mediaKind?splitQuestions(text,m.streaming):null;
      const nextUser=questions&&!questions.pending?conversation.messages.slice(i+1).find(x=>x.role==="user"):null;
      return <div key={m.id||i} className={cx("assistantBlock",(m.error||m.mediaGenerationError)&&"errorMessage")}><div className="assistantMark" aria-hidden="true">S</div><div className="assistantBody copyByRightClick" onContextMenu={e=>openCopyMenu(e,m)}>
        {m.routeInfo&&<RouteBadge info={m.routeInfo}/>}
        {questions?<>
          {questions.before.trim()&&<Markdown text={questions.before}/>}
          {questions.pending?<QuestionsPending/>:<QuestionCard key={m.id||i} questions={questions.questions} answeredWith={nextUser?messageText(nextUser):null} disabled={busy} onSubmit={onAnswer}/>}
          {questions.after?.trim()&&<Markdown text={questions.after}/>}
        </>:text&&<Markdown text={text}/>}
        {(m.needsVideoSetup||(m.mediaGenerationError&&m.mediaKind==="video"&&/Setări\s*→\s*Video/.test(text)))&&<button className="secondary videoSetupButton" onClick={()=>onOpenSettings?.("video")}><Settings size={15}/> Deschide Setări → Video</button>}
        {m.stopped&&<div className="stoppedNote">{text?"Răspunsul a fost oprit înainte de final.":"Răspunsul a fost oprit."}</div>}
        {m.attachments?.length>0&&<div className="generatedFiles">{m.attachments.map((a,j)=><GeneratedAttachment key={a.id||j} attachment={a}/>)}</div>}
        {!m.streaming&&text&&<MessageActions message={m} title={conversation.title} disabled={busy} onRegenerate={()=>onRegenerate(i,i<lastIndex)} onRate={v=>onRate(i,v)}/>}
        {!m.streaming&&!text&&(m.mediaKind||m.stopped)&&<div className="messageActions"><button onClick={()=>onRegenerate(i,i<lastIndex)} disabled={busy} title={m.attachments?.length?"Generează din nou":"Încearcă din nou"} aria-label={m.attachments?.length?"Generează din nou":"Încearcă din nou"}><RotateCcw size={15}/></button></div>}
      </div></div>;
    })}
    {busy&&<ThinkingActivity stage={busyStage} steps={busySteps}/>}
    {contextMenu&&<div className="copyContextMenu" role="menu" style={{left:contextMenu.x,top:contextMenu.y}} onClick={e=>e.stopPropagation()}>
      {contextMenu.codeText&&<button role="menuitem" onClick={()=>copyValue(contextMenu.codeText)}><Copy size={15}/><span><b>Copiază codul</b><small>Doar blocul de cod selectat</small></span></button>}
      {canRunCode&&contextMenu.codeText&&<button role="menuitem" onClick={runCodeValue} disabled={running}><Play size={15}/><span><b>{running?"Se rulează…":"Rulează / testează codul"}</b><small>Owner · {contextMenu.language==="python"?"Python":"Node.js"} · rezultat real</small></span></button>}
      {contextMenu.selection&&<button role="menuitem" onClick={()=>copyValue(contextMenu.selection)}><Copy size={15}/><span><b>Copiază selecția</b><small>Textul pe care l-ai selectat</small></span></button>}
      <button role="menuitem" onClick={()=>copyValue(contextMenu.messageText)}><Copy size={15}/><span><b>Copiază mesajul</b><small>Mesajul complet</small></span></button>
    </div>}
  </div>;
}

function TrayChip({attachment,onRemove}) {
  const image=attachment.type==="image"&&attachment.libraryId;
  const {src}=useAuthedBlobUrl(image?`/api/library/${attachment.libraryId}/content`:"");
  const Icon=attachment.type==="audio"?Volume2:attachment.type==="video"?Play:attachment.type==="image"?ImageIcon:Paperclip;
  return <span className={cx(attachment.type==="stored"&&"unsupported")} title={attachment.type==="stored"?attachment.part?.text:attachment.name}>
    {src?<img className="trayThumb" src={src} alt=""/>:<Icon size={13}/>} {attachment.name}
    <button onClick={onRemove} aria-label={`Elimină ${attachment.name}`} title="Elimină"><X size={13}/></button>
  </span>;
}

const VIDEO_PROVIDERS_TEXT="Pick who makes the video under the message box, or Automatic: the free ones first, then Gemini Veo, Grok Imagine and the other keys (paid, if you allow them in Settings).";
function imageProvidersText(){return "Pick who makes the picture under the message box, or Automatic: the best one available.";}
// Who makes the picture / video (0.7.24): picked under the message box in the Poză / Video mode and remembered on this
// device for each kind; "" = Automat (the best one available, as in Settings → «Făcute de»).
const makerKey=(kind)=>`serasmart-media-maker-${kind}`;
function savedMaker(kind){try{return localStorage.getItem(makerKey(kind))||""}catch{return ""}}
function saveMaker(kind,value){try{if(value)localStorage.setItem(makerKey(kind),value);else localStorage.removeItem(makerKey(kind))}catch{}}
function MediaMakerPick({kind}) {
  const [options,setOptions]=useState(null),[value,setValue]=useState(()=>savedMaker(kind));
  useEffect(()=>{
    let live=true;setValue(savedMaker(kind));setOptions(null);
    api(`/api/media/options?kind=${kind}`).then(d=>{if(live)setOptions(Array.isArray(d?.data)?d.data:[])}).catch(()=>{if(live)setOptions([])});
    return ()=>{live=false};
  },[kind]);
  const list=options||[],groups=[...new Set(list.map(o=>o.group))];
  const shown=!value||list.some(o=>o.value===value&&!o.blocked)?value:"";
  useLanguage();
  return <label className="makerPick"><span>{kind==="image"?tr("Picture made by"):tr("Video made by")}</span>
    <select value={shown} disabled={options===null} onChange={e=>{setValue(e.target.value);saveMaker(kind,e.target.value)}}>
      <option value="">{options===null?tr("Loading…"):tr("Automatic · the best available")}</option>
      {groups.map(g=><optgroup key={g} label={g}>{list.filter(o=>o.group===g).map(o=><option key={o.value} value={o.value} disabled={!!o.blocked}>{o.label}{o.blocked?` (${o.blocked})`:""}</option>)}</optgroup>)}
    </select>
  </label>;
}
function Composer({centered,draft,setDraft,onSend,onStop,busy,attachments,setAttachments,onOpenLibrary,responseMode,setResponseMode,mediaMode,setMediaMode,mentionsVersion,mediaPolicy}) {
  const {can,deny}=useAccess();
  const ta=useRef(null),fileInput=useRef(null),imageInput=useRef(null),videoInput=useRef(null),audioInput=useRef(null),recorderRef=useRef(null),streamRef=useRef(null),chunksRef=useRef([]),attachRef=useRef(null),mountedRef=useRef(true),autoSendRef=useRef(false),speechRef=useRef(null),stoppedRef=useRef(false),startingRef=useRef(false),draftRef=useRef(draft);
  const [menu,setMenu]=useState(false),[voiceTick,setVoiceTick]=useState(0),[recording,setRecording]=useState(false),[transcribing,setTranscribing]=useState(false),[uploading,setUploading]=useState(0),[mentions,setMentions]=useState([]),[mentionIndex,setMentionIndex]=useState(0),[mentionClosedFor,setMentionClosedFor]=useState(null),[dragOver,setDragOver]=useState(false);
  const pluginsOk=can("plugins"),automationsOk=can("automations");
  useDismiss(menu,()=>setMenu(false),attachRef);
  useEffect(()=>{if(ta.current){ta.current.style.height="0px";ta.current.style.height=Math.min(ta.current.scrollHeight,190)+"px"}},[draft]);
  useEffect(()=>{
    mountedRef.current=true;
    return()=>{
      mountedRef.current=false;
      try{speechRef.current?.abort()}catch{}
      try{if(recorderRef.current&&recorderRef.current.state!=="inactive")recorderRef.current.stop()}catch{}
      try{streamRef.current?.getTracks().forEach(t=>t.stop())}catch{}
    };
  },[]);
  useEffect(()=>{
    function focusComposerFromKeyboard(e){
      if(e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey||e.isComposing)return;
      if(modalStack.length)return;
      const target=e.target;
      if(target?.closest?.('input,textarea,select,button,a,summary,[contenteditable="true"],[role="menu"],[role="listbox"]'))return;
      if(typeof e.key!=="string"||e.key.length!==1)return;
      e.preventDefault();
      setDraft(v=>v+e.key);
      requestAnimationFrame(()=>{
        ta.current?.focus();
        if(ta.current){
          const end=ta.current.value.length;
          try{ta.current.selectionStart=ta.current.selectionEnd=end}catch{}
        }
      });
    }
    window.addEventListener("keydown",focusComposerFromKeyboard);
    return()=>window.removeEventListener("keydown",focusComposerFromKeyboard);
  },[setDraft]);
  useEffect(()=>{
    let active=true;
    (async()=>{
      const [p,a]=await Promise.all([pluginsOk?api("/api/plugins").catch(()=>({data:[]})):{data:[]},automationsOk?api("/api/automations").catch(()=>({data:[]})):{data:[]}]);
      if(!active)return;
      setMentions([
        ...(p.data||[]).filter(x=>x.enabled!==false&&x.name).map(x=>({type:"plugin",name:x.name,trigger:x.trigger||("@"+x.name.toLowerCase().replace(/\s+/g,"-"))})),
        ...(a.data||[]).filter(x=>x.enabled!==false&&x.title).map(x=>({type:"automation",name:x.title,trigger:x.trigger||("@"+x.title.toLowerCase().replace(/\s+/g,"-"))}))
      ]);
    })();
    return()=>{active=false};
  },[mentionsVersion,pluginsOk,automationsOk]);
  const mentionMatch=draft.match(/(^|\s)@([^\s@]*)$/);
  const mentionQuery=(mentionMatch?.[2]||"").toLowerCase();
  const mentionOptions=mentionMatch&&mentionClosedFor!==draft?mentions.filter(x=>x.name.toLowerCase().includes(mentionQuery)||x.trigger.toLowerCase().includes("@"+mentionQuery)).slice(0,8):[];
  useEffect(()=>{setMentionIndex(0)},[mentionQuery,mentionOptions.length]);
  function insertMention(x){setDraft(v=>v.replace(/(^|\s)@([^\s@]*)$/,(_m,pre)=>`${pre}${x.trigger||"@"+x.name} `));setTimeout(()=>ta.current?.focus(),0)}
  function toolPrompt(text){setMenu(false);setDraft(text);setTimeout(()=>{ta.current?.focus();try{ta.current.selectionStart=ta.current.selectionEnd=text.length}catch{}},0)}
  async function addComposerFiles(files){
    if(!files?.length)return;
    if(!can("file_upload")){deny("file_upload");return;}
    setUploading(n=>n+1);
    const added=[],failed=[];
    for(const f of files){
      try{const item=await uploadFileToLibrary(f);added.push(await libraryItemToAttachment(item))}
      catch(err){failed.push(`${f.name}: ${err.message}`)}
    }
    if(added.length)setAttachments(v=>[...v,...added]);
    if(failed.length)toast(tr("Could not attach: ")+failed.join(" · "));
    if(mountedRef.current)setUploading(n=>Math.max(0,n-1));
  }
  async function filesChosen(e){
    const input=e.target,files=[...(input.files||[])];
    input.value="";setMenu(false);
    await addComposerFiles(files);
  }
  async function pasteIntoComposer(e){
    const files=[...(e.clipboardData?.files||[])];
    if(files.length){e.preventDefault();await addComposerFiles(files);return;}
    const text=e.clipboardData?.getData("text/plain");
    if(!text)return;
    e.preventDefault();
    const el=e.currentTarget;
    const start=typeof el.selectionStart==="number"?el.selectionStart:draft.length;
    const end=typeof el.selectionEnd==="number"?el.selectionEnd:draft.length;
    if(typeof document.execCommand==="function"&&document.execCommand("insertText",false,text))return;
    const next=draft.slice(0,start)+text+draft.slice(end);
    setDraft(next);
    requestAnimationFrame(()=>{try{el.focus();el.selectionStart=el.selectionEnd=start+text.length}catch{}});
  }
  function onDragOver(e){if(![...(e.dataTransfer?.types||[])].includes("Files"))return;e.preventDefault();e.dataTransfer.dropEffect=can("file_upload")?"copy":"none";setDragOver(true)}
  function onDragLeave(e){if(!e.currentTarget.contains(e.relatedTarget))setDragOver(false)}
  async function onDrop(e){if(![...(e.dataTransfer?.types||[])].includes("Files"))return;e.preventDefault();setDragOver(false);await addComposerFiles([...(e.dataTransfer.files||[])])}
  // Microphone: the words appear in the box while you speak (the browser's speech recognition) and the message is sent
  // when you stop. Where the browser has no recognition (the Windows app, Firefox) or it fails, the recording is sent to
  // Serasmart AI, which transcribes it (OmniRoute or Groq) and sends the text. No file permission is needed.
  function finishVoice(text){
    const t=String(text||"").trim();
    if(!t){toast(tr("I heard nothing. Press the microphone and speak again."),"info");return;}
    autoSendRef.current=true;setVoiceTick(n=>n+1);
  }
  function startSpeech(){
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR||window.Serasmart)return false;
    const r=new SR();r.lang=speechLocale();r.interimResults=true;r.continuous=true;
    const base=draftRef.current?draftRef.current.replace(/\s+$/,"")+" ":"";
    let finals="",heard="",failed="";stoppedRef.current=false;
    r.onresult=e=>{
      let interim="";
      for(let i=e.resultIndex;i<e.results.length;i++){const t=e.results[i][0].transcript;if(e.results[i].isFinal)finals+=t+" ";else interim+=t;}
      heard=(finals+interim).trim();
      setDraft(base+heard);
    };
    r.onerror=e=>{failed=e.error||"error";};
    r.onend=()=>{
      speechRef.current=null;
      if(!mountedRef.current)return;
      if(!(failed&&failed!=="no-speech"&&failed!=="aborted"&&!heard&&!stoppedRef.current&&failed!=="not-allowed"))setRecording(false);
      if(failed&&failed!=="no-speech"&&failed!=="aborted"){
        if(failed==="not-allowed"){toast("Microfonul este blocat. Permite accesul la microfon în browser.");return;}
        // Text already heard is kept for the user to check; it is not sent half-finished.
        if(heard){toast("Recunoașterea vocală s-a oprit; verifică textul și trimite-l.","info");return;}
        // The browser cannot recognise speech here (no connection to its service…): record instead, unless the user already stopped.
        if(stoppedRef.current){toast("Recunoașterea vocală nu a mers. Apasă microfonul și încearcă din nou.");return;}
        startRecorder();return;
      }
      finishVoice(heard);
    };
    try{r.start();}catch(e){console.warn("Recunoaștere vocală indisponibilă:",e?.message||e);return false;}
    speechRef.current=r;setRecording(true);return true;
  }
  async function startRecorder(){
    startingRef.current=true;
    try{
      if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw new Error("Browserul nu poate înregistra sunet.");
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});streamRef.current=stream;chunksRef.current=[];
      const mime=["audio/webm;codecs=opus","audio/webm","audio/ogg;codecs=opus","audio/mp4"].find(x=>window.MediaRecorder?.isTypeSupported?.(x))||"";
      const rec=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);recorderRef.current=rec;
      const stopTracks=()=>{try{stream.getTracks().forEach(t=>t.stop())}catch{};streamRef.current=null;};
      rec.ondataavailable=e=>{if(e.data?.size)chunksRef.current.push(e.data)};
      rec.onerror=()=>{setRecording(false);stopTracks();toast("Înregistrarea vocală a eșuat.")};
      rec.onstop=async()=>{
        stopTracks();recorderRef.current=null;
        if(!mountedRef.current)return;
        setRecording(false);setTranscribing(true);
        let text="",failedTranscript=true;
        try{
          const blob=new Blob(chunksRef.current,{type:rec.mimeType||"audio/webm"});
          if(!blob.size)throw new Error("Înregistrarea este goală.");
          const audio=await new Promise((ok,no)=>{const fr=new FileReader();fr.onload=()=>ok(String(fr.result).split(",")[1]||"");fr.onerror=()=>no(new Error("Nu pot citi înregistrarea."));fr.readAsDataURL(blob)});
          const d=await api("/api/transcribe",{method:"POST",body:JSON.stringify({audio,mime:blob.type,language:speechLocale().slice(0,2)})});
          text=String(d?.text||"").trim();
          if(text&&mountedRef.current)setDraft(v=>(v?v.replace(/\s+$/,"")+" ":"")+text);
          failedTranscript=false;
        }catch(e){toast("Vocalul nu a putut fi transcris: "+friendlyError(e.message))}
        finally{if(mountedRef.current){setTranscribing(false);if(!failedTranscript)finishVoice(text);}}
      };
      rec.start();setRecording(true);startingRef.current=false;
    }catch(e){
      startingRef.current=false;setRecording(false);
      toast(/denied|permission|NotAllowed/i.test(String(e?.name||e?.message))?"Accesul la microfon a fost refuzat. Permite microfonul în browser.":"Microfonul nu este disponibil: "+friendlyError(e.message));
    }
  }
  async function mic(){
    if(recording){
      if(speechRef.current){stoppedRef.current=true;try{speechRef.current.stop()}catch{}return;}
      if(recorderRef.current){try{recorderRef.current.stop()}catch{}return;}
      return;
    }
    if(startingRef.current)return;
    if(!startSpeech())await startRecorder();
  }
  const hasContent=!!draft.trim()||attachments.some(a=>a.part||a.parts?.length);
  draftRef.current=draft;
  useEffect(()=>{if(autoSendRef.current&&!transcribing&&!recording&&draft.trim()){if(busy){toast("Textul vocal e în câmp; trimite-l când AI-ul termină răspunsul.","info");autoSendRef.current=false;return;}autoSendRef.current=false;trySend();}},[draft,transcribing,voiceTick]);
  function trySend(){
    if(busy)return;
    if(uploading){toast(tr("Wait for the file to finish uploading."),"info");return;}
    if(recording){toast(tr("Stop the voice recording first."),"info");return;}
    if(transcribing){toast(tr("Waiting for the voice to be written out."),"info");return;}
    if(!hasContent)return;
    onSend();
  }
  function onKeyDown(e){
    if(mentionOptions.length){
      if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();setMentionIndex(i=>(i+(e.key==="ArrowDown"?1:-1)+mentionOptions.length)%mentionOptions.length);return;}
      if(e.key==="Enter"||e.key==="Tab"){e.preventDefault();insertMention(mentionOptions[Math.min(mentionIndex,mentionOptions.length-1)]);return;}
      if(e.key==="Escape"){e.preventDefault();setMentionClosedFor(draft);return;}
    }
    if(e.key==="Enter"&&!e.shiftKey&&!e.nativeEvent?.isComposing){e.preventDefault();trySend();}
  }
  function lockedItem(perm,action){return ()=>{if(perm&&!can(perm)){setMenu(false);deny(perm);return;}action();}}
  function toggleMedia(kind){
    const perm=kind==="image"?"image_generation":"video_generation";
    if(!can(perm)){deny(perm);return;}
    setMediaMode(m=>m===kind?null:kind);setMenu(false);setTimeout(()=>ta.current?.focus(),0);
  }
  const uploadLocked=!can("file_upload");
  useLanguage();
  const placeholder=uploading?tr("Uploading the file…"):recording?tr("Listening… press the microphone to stop"):transcribing?tr("Writing out your voice…"):mediaMode==="image"?tr("Describe the picture you want…"):mediaMode==="video"?tr("Describe the video you want…"):tr("Message {brand}",{brand:BRAND_NAME});
  const hint=uploading?tr("The file is saved in your Library (up to 2 GB a file)…"):recording?tr("Microphone on — speak now"):transcribing?tr("{brand} is writing out the recording…",{brand:BRAND_NAME}):mediaMode==="image"?tr("Picture mode: the next message makes a picture. Press Picture again to leave."):mediaMode==="video"?tr("Video mode: the next message makes a video. Press Video again to leave."):tr("{brand} can make mistakes. Check important information.",{brand:BRAND_NAME});
  return <div className={cx("composerDock",centered&&"centered")} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
    {mentionOptions.length>0&&<div className="mentionMenu" role="listbox" aria-label={tr("Apps and automations")}>{mentionOptions.map((x,i)=><button key={x.type+x.trigger+i} role="option" aria-selected={i===mentionIndex} className={cx(i===mentionIndex&&"active")} onMouseDown={e=>e.preventDefault()} onClick={()=>insertMention(x)}><span className={cx("mentionType",x.type)}>{x.type==="plugin"?<Plug size={14}/>:<CalendarClock size={14}/>}</span><span><b>{x.name}</b><small>{x.type==="plugin"?tr("App"):tr("Automation")} · {x.trigger}</small></span></button>)}</div>}
    <div className={cx("composerCard",dragOver&&"dragOver")}>
      {dragOver&&<div className="dropHint">{uploadLocked?deniedMessage("file_upload"):tr("Drop to attach the files")}</div>}
      {attachments.length>0&&<div className="attachmentTray">{attachments.map((a,i)=><TrayChip key={(a.libraryId||a.name)+i} attachment={a} onRemove={()=>setAttachments(v=>v.filter((_,j)=>j!==i))}/>)}</div>}
      <input ref={fileInput} type="file" hidden multiple onChange={filesChosen}/>
      <input ref={imageInput} type="file" hidden multiple accept="image/png,image/jpeg,image/webp,image/gif" onChange={filesChosen}/>
      <input ref={videoInput} type="file" hidden multiple accept="video/mp4,video/webm,video/quicktime,.mp4,.mov,.m4v,.avi,.mkv,.mpeg,.mpg" onChange={filesChosen}/>
      <input ref={audioInput} type="file" hidden multiple accept="audio/mpeg,audio/mp3,audio/mp4,audio/x-m4a,audio/aac,audio/wav,audio/x-wav,audio/ogg,audio/flac,audio/opus,.mp3,.m4a,.aac,.wav,.ogg,.flac,.opus" onChange={filesChosen}/>
      <div className="composerLine">
        <textarea ref={ta} value={draft} onChange={e=>{setDraft(e.target.value);setMentionClosedFor(null)}} onPaste={pasteIntoComposer} spellCheck={true} aria-label={tr("Message {brand}",{brand:BRAND_NAME})} placeholder={placeholder} onKeyDown={onKeyDown}/>
      </div>
      {mediaMode&&<div className="makerRow"><MediaMakerPick kind={mediaMode}/></div>}
      {/* One toolbar under the text, as in the big chat apps: attach and modes on the left, voice and send on the right. */}
      <div className="composerTools">
        <div className="attachWrap" ref={attachRef}><button className="composerIcon" onClick={()=>setMenu(v=>!v)} title={tr("Files and tools")} aria-label={tr("Files and tools")} aria-haspopup="menu" aria-expanded={menu}><Plus size={20}/></button>{menu&&<div className="attachMenu" role="menu">
          <button role="menuitem" className={cx(uploadLocked&&"locked")} onClick={lockedItem("file_upload",()=>{setMenu(false);imageInput.current?.click()})}><ImageIcon size={16}/> {tr("Upload pictures")}{uploadLocked&&<Lock size={12} className="lockIcon"/>}</button>
          <button role="menuitem" className={cx(uploadLocked&&"locked")} onClick={lockedItem("file_upload",()=>{setMenu(false);videoInput.current?.click()})}><Play size={16}/> {tr("Upload video")}{uploadLocked&&<Lock size={12} className="lockIcon"/>}</button>
          <button role="menuitem" className={cx(uploadLocked&&"locked")} onClick={lockedItem("file_upload",()=>{setMenu(false);audioInput.current?.click()})}><Volume2 size={16}/> {tr("Upload audio")}{uploadLocked&&<Lock size={12} className="lockIcon"/>}</button>
          <button role="menuitem" className={cx(uploadLocked&&"locked")} onClick={lockedItem("file_upload",()=>{setMenu(false);fileInput.current?.click()})}><Upload size={16}/> {tr("Upload any file")}{uploadLocked&&<Lock size={12} className="lockIcon"/>}</button>
          <button role="menuitem" onClick={()=>{setMenu(false);onOpenLibrary()}}><Library size={16}/> {tr("Choose from Library")}</button>
          <div className="menuDivider"/>
          <button role="menuitem" className={cx(!can("web_search")&&"locked")} onClick={lockedItem("web_search",()=>toolPrompt(tr("Search the web for the latest on ")))}><Globe2 size={16}/> {tr("Web search")}{!can("web_search")&&<Lock size={12} className="lockIcon"/>}</button>
          <button role="menuitem" className={cx(!can("deep_research")&&"locked")} onClick={lockedItem("deep_research",()=>toolPrompt(tr("Do deep research, check several sources and explain fully: ")))}><Search size={16}/> Deep Research{!can("deep_research")&&<Lock size={12} className="lockIcon"/>}</button>
        </div>}</div>
        <button className={cx("mediaMake",mediaMode==="image"&&"active",!can("image_generation")&&"locked")} aria-pressed={mediaMode==="image"} aria-label={tr("Picture")} title={can("image_generation")?tr("Picture: the next message makes a picture.")+" "+tr(imageProvidersText()):deniedMessage("image_generation")} onClick={()=>toggleMedia("image")}><ImageIcon size={16}/><span>{tr("Picture")}</span></button>
        <button className={cx("mediaMake",mediaMode==="video"&&"active",!can("video_generation")&&"locked")} aria-pressed={mediaMode==="video"} aria-label={tr("Video")} title={can("video_generation")?tr("Video: the next message makes a video.")+" "+tr(VIDEO_PROVIDERS_TEXT):deniedMessage("video_generation")} onClick={()=>toggleMedia("video")}><Clapperboard size={16}/><span>{tr("Video")}</span></button>
        <button className={cx("mediaMake thinkToggle",responseMode==="thinking"&&"active")} aria-pressed={responseMode==="thinking"} aria-label={tr("Think")} title={responseMode==="thinking"?tr("Think is on: more careful answers, a little slower. Press for Fast."):tr("Fast mode. Press for Think: more careful answers, a little slower.")} onClick={()=>setResponseMode(responseMode==="thinking"?"rapid":"thinking")}><Brain size={16}/><span>{tr("Think")}</span></button>
        <span className="composerSpacer"/>
        <button className={cx("composerIcon",recording&&"recording")} onClick={mic} title={recording?tr("Stop and send"):tr("Speak: the text appears in the box and is sent by itself")} aria-label={recording?tr("Stop the voice recording"):tr("Record your voice")} aria-pressed={recording} disabled={transcribing}><Mic size={19}/></button>
        {busy
          ? <button className="sendButton stopButton" onClick={onStop} title={tr("Stop the answer")} aria-label={tr("Stop the answer")}><Square size={15} fill="currentColor"/></button>
          : <button className="sendButton" disabled={!!uploading||recording||transcribing||!hasContent} onClick={trySend} title={tr("Send")} aria-label={tr("Send the message")}><ArrowUp size={20}/></button>}
      </div>
    </div>
    <div className="composerHint" aria-live="polite">{hint}</div>
  </div>;
}

const ADMIN_STATUS_LABELS={pending:"În așteptare",active:"Activ",rejected:"Respins",suspended:"Suspendat",blocked:"Blocat"};
const AUDIT_LABELS={"admin.user_status":"Status cont modificat","admin.permissions":"Permisiuni modificate","admin.model_override":"Model activat / blocat","admin.sessions_revoke":"Sesiuni închise","admin.paid_ai":"AI plătit modificat","auth.register":"Cont nou","auth.login":"Autentificare","auth.logout":"Deconectare"};
function AdminPanel({onClose}) {
  const permissionLabels={
    chat:"Chat AI",cerebras:"Cerebras",gemini:"Gemini",groq:"Groq",cloudflare:"Cloudflare AI",
    openrouter:"OpenRouter (poate genera costuri)",image_generation:"Generare imagini",video_generation:"Generare videoclipuri",document_generation:"Fișiere: PDF / Word / PowerPoint / Excel / CSV / ZIP / cod",
    file_upload:"Încărcare fișiere",web_search:"Căutare web",deep_research:"Deep Research",
    automations:"Scheduled (sarcini programate)",plugins:"Pluginuri",github_access:"GitHub",openai:"OpenAI (plătit)",anthropic:"Claude / Anthropic (plătit)",
    code:`Code ${BRAND_NAME} (prin API-urile OpenAI / Claude, nu prin abonamentele tale)`
  };
  const [users,setUsers]=useState([]),[selectedId,setSelectedId]=useState(null),[filter,setFilter]=useState("all");
  const [paidAi,setPaidAi]=useState(false),[auditRows,setAuditRows]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState(""),[pending,setPending]=useState({}),[actionBusy,setActionBusy]=useState(false);
  const mounted=useRef(true);
  useEffect(()=>()=>{mounted.current=false},[]);
  async function load(){
    setBusy(true);setError("");
    try{
      const [u,a,l]=await Promise.all([api("/api/admin/users"),api("/api/admin/ai"),api("/api/admin/audit?limit=50")]);
      if(!mounted.current)return;
      const rows=u.data||[];setUsers(rows);setPaidAi(!!a.paidAiEnabled);setAuditRows(l.data||[]);
      setSelectedId(v=>v&&rows.some(x=>x.id===v)?v:(rows.find(x=>x.status==="pending"&&x.role!=="owner")?.id||rows.find(x=>x.role!=="owner")?.id||null));
    }catch(e){if(mounted.current)setError(e.message)}finally{if(mounted.current)setBusy(false)}
  }
  useEffect(()=>{load()},[]);
  const selected=users.find(x=>x.id===selectedId)||null;
  const pendingCount=users.filter(x=>x.status==="pending").length;
  const activeCount=users.filter(x=>x.status==="active").length;
  const visible=users.filter(x=>filter==="all"||x.status===filter);
  async function setStatus(user,status){
    if(!user||user.role==="owner"||actionBusy)return;
    if(["blocked","rejected","suspended"].includes(status)&&!confirm(`Confirmi statusul „${ADMIN_STATUS_LABELS[status]}” pentru ${user.email}? Sesiunile active ale contului vor fi închise.`))return;
    setActionBusy(true);
    try{await api(`/api/admin/users/${user.id}/status`,{method:"PATCH",body:JSON.stringify({status})});await load();toast(`Statusul pentru ${user.email} este acum „${ADMIN_STATUS_LABELS[status]}”.`,"ok")}
    catch(e){toast("Administrare: "+e.message)}
    finally{if(mounted.current)setActionBusy(false)}
  }
  async function togglePermission(user,key,value){
    if(!user||user.role==="owner"||pending[`${user.id}:${key}`])return;
    setPending(p=>({...p,[`${user.id}:${key}`]:true}));
    try{
      const d=await api(`/api/admin/users/${user.id}/permissions`,{method:"PATCH",body:JSON.stringify({permissions:{[key]:value}})});
      if(mounted.current)setUsers(rows=>rows.map(x=>x.id===user.id?{...x,permissions:d.permissions||{...x.permissions,[key]:value}}:x));
    }catch(e){toast("Permisiuni: "+e.message)}
    finally{if(mounted.current)setPending(p=>{const n={...p};delete n[`${user.id}:${key}`];return n})}
  }
  const [modelIds,setModelIds]=useState(null),[modelQuery,setModelQuery]=useState(""),[modelsError,setModelsError]=useState(""),[modelsTry,setModelsTry]=useState(0),[personalIds,setPersonalIds]=useState(()=>new Set());
  useEffect(()=>{let live=true;api("/api/models").then(ms=>{if(!live)return;setPersonalIds(new Set((ms?.personalModels||[]).map(x=>String(x).toLowerCase())));setModelIds([...new Set((ms?.data||[]).map(x=>String(typeof x==="string"?x:x?.id||"")).filter(Boolean))].sort((a,b)=>a.localeCompare(b)))}).catch(e=>{if(live){setModelIds([]);setModelsError(e?.message||"eroare necunoscută")}});return()=>{live=false}},[modelsTry]);
  async function setModelMode(user,model,mode){
    if(!user||user.role==="owner")return;
    const k=`${user.id}:model:${model}`;
    if(pending[k])return;
    setPending(p=>({...p,[k]:true}));
    try{
      const d=await api(`/api/admin/users/${user.id}/models`,{method:"PATCH",body:JSON.stringify({model,mode})});
      if(mounted.current)setUsers(rows=>rows.map(x=>x.id===user.id?{...x,permissions:d.permissions||x.permissions}:x));
      toast(`${model}: ${{allow:"activat",deny:"blocat",default:"implicit"}[mode]} pentru ${user.email}.`,"ok");
    }catch(e){toast("Model: "+e.message)}
    finally{if(mounted.current)setPending(p=>{const n={...p};delete n[k];return n})}
  }
  async function revokeSessions(user){
    if(!user||user.role==="owner"||actionBusy)return;
    if(!confirm(`Închizi toate sesiunile active pentru ${user.email}?`))return;
    setActionBusy(true);
    try{await api(`/api/admin/users/${user.id}/sessions/revoke`,{method:"POST",body:"{}"});await load();toast("Sesiunile au fost închise.","ok")}
    catch(e){toast("Sesiuni: "+e.message)}
    finally{if(mounted.current)setActionBusy(false)}
  }
  async function togglePaid(){
    if(actionBusy)return;
    const next=!paidAi;
    const message=next
      ?"Permiți AI plătit și celorlalte conturi eligibile? Fiecare utilizator are nevoie în continuare de permisiunea individuală OpenAI / Claude / OpenRouter."
      :"Oprești AI-ul plătit pentru conturile normale? Owner-ul își păstrează accesul la modelele plătite.";
    if(!confirm(message))return;
    setActionBusy(true);
    try{const d=await api("/api/admin/ai",{method:"PATCH",body:JSON.stringify({paidAiEnabled:next})});setPaidAi(!!d.paidAiEnabled)}
    catch(e){toast("AI plătit: "+e.message)}
    finally{if(mounted.current)setActionBusy(false)}
  }
  return <ToolShell title={`${BRAND_SHORT} Control Center`} subtitle="Owner: utilizatori, aprobări, permisiuni, sesiuni și servicii AI." onClose={onClose}>
    <div className="adminPanel">
      {error&&<div className="authError" role="alert">{error}</div>}
      <div className="adminSummary">
        <div><span>Utilizatori</span><b>{users.length}</b></div>
        <div className={pendingCount?"warn":""}><span>În așteptare</span><b>{pendingCount}</b></div>
        <div><span>Activi</span><b>{activeCount}</b></div>
        <button className={cx("adminPaidAi",paidAi&&"on")} onClick={togglePaid} disabled={actionBusy} aria-pressed={paidAi} title="Controlează AI-ul plătit pentru conturile normale. Owner-ul rămâne permis."><span>AI plătit · utilizatori</span><b>{paidAi?"PORNIT":"OPRIT"}</b></button>
      </div>
      <div className="adminToolbar">
        <div className="adminFilters" role="tablist">
          {[["all","Toți"],["pending","În așteptare"],["active","Activi"],["suspended","Suspendați"],["blocked","Blocați"],["rejected","Respinși"]].map(([k,label])=><button key={k} role="tab" aria-selected={filter===k} className={filter===k?"active":""} onClick={()=>setFilter(k)}>{label}</button>)}
        </div>
        <button className="secondary" onClick={load} disabled={busy}><RotateCcw size={15}/> {busy?"Actualizez…":"Actualizează"}</button>
      </div>
      <div className="adminLayout">
        <div className="adminUsers">
          {visible.map(u=><button key={u.id} className={cx("adminUserRow",selectedId===u.id&&"active")} onClick={()=>setSelectedId(u.id)}>
            <span className="accountAvatar">{(u.name||u.email||"U")[0].toUpperCase()}</span>
            <span className="adminUserCopy"><b>{u.name||u.email}</b><small>{u.email}</small></span>
            <span className={cx("adminStatus","s-"+u.status)}>{u.role==="owner"?"Owner":ADMIN_STATUS_LABELS[u.status]||u.status}</span>
          </button>)}
          {!visible.length&&<div className="seraPluginEmpty">{busy?"Se încarcă utilizatorii…":"Nu există utilizatori în această categorie."}</div>}
        </div>
        <div className="adminDetail">
          {!selected?<div className="seraPluginEmpty">Selectează un utilizator.</div>:<>
            <div className="adminIdentity">
              <div className="accountAvatar big">{(selected.name||selected.email||"U")[0].toUpperCase()}</div>
              <div><h3>{selected.name||"Utilizator"}</h3><p>{selected.email}</p><small>{selected.role==="owner"?"Owner":"Utilizator"} · {ADMIN_STATUS_LABELS[selected.status]||selected.status} · {plural(Number(selected.active_sessions||0),"sesiune activă","sesiuni active")}</small></div>
            </div>
            {selected.role!=="owner"&&<div className="adminApprovalActions">
              {selected.status!=="active"&&<button className="primary" onClick={()=>setStatus(selected,"active")} disabled={actionBusy}><Check size={15}/> Aprobă / Reactivează</button>}
              {selected.status!=="suspended"&&<button className="secondary" onClick={()=>setStatus(selected,"suspended")} disabled={actionBusy}>Suspendă</button>}
              {selected.status!=="blocked"&&<button className="dangerButton" onClick={()=>setStatus(selected,"blocked")} disabled={actionBusy}>Blochează</button>}
              {selected.status==="pending"&&<button className="secondary" onClick={()=>setStatus(selected,"rejected")} disabled={actionBusy}><X size={15}/> Respinge</button>}
              <button className="secondary" onClick={()=>revokeSessions(selected)} disabled={actionBusy}>Închide sesiunile</button>
            </div>}
            <div className="adminPermissionHead"><div><h4>Permisiuni</h4><p>Se aplică pe server pentru acest cont.</p></div></div>
            <div className="adminPermissions">
              {Object.entries(permissionLabels).map(([key,label])=>{
                const checked=selected.role==="owner"?true:selected.permissions?.[key]===true;
                const busyKey=!!pending[`${selected.id}:${key}`];
                return <label key={key} className={cx("adminPermission",selected.role==="owner"&&"locked")}>
                  <span><b>{label}</b><small>{key}</small></span>
                  <input type="checkbox" checked={checked} disabled={selected.role==="owner"||busyKey} onChange={e=>togglePermission(selected,key,e.target.checked)}/>
                </label>;
              })}
            </div>
            {selected.role!=="owner"&&<>
              <div className="adminPermissionHead"><div><h4>Modele AI pentru acest cont</h4><p>«Implicit» urmează permisiunile de mai sus; «Activat» deschide modelul chiar dacă permisiunile îl țin închis; «Blocat» îl închide. Abonamentele personale ale Owner-ului rămân doar ale lui.</p></div></div>
              {selected.permissions?.chat!==true&&<div className="adminModelHint" role="note">«Activat» nu are efect cât timp «Chat AI» este oprit pentru acest cont: pornește întâi permisiunea Chat de mai sus.</div>}
              <input className="adminModelSearch" type="search" placeholder="Caută un model…" value={modelQuery} onChange={e=>setModelQuery(e.target.value)} aria-label="Caută un model"/>
              <div className="adminModels">
                {modelIds===null&&<div className="seraPluginEmpty">Se încarcă modelele…</div>}
                {modelIds!==null&&!modelIds.length&&<div className="seraPluginEmpty">{modelsError?`Nu am putut încărca lista de modele: ${modelsError}`:"Lista de modele este goală."} <button type="button" className="secondary" onClick={()=>{setModelIds(null);setModelsError("");setModelsTry(n=>n+1)}}>Reîncearcă</button></div>}
                {[...new Set([...(modelIds||[]),...Object.keys(selected.permissions?.model_overrides||{})])].sort((a,b)=>a.localeCompare(b)).filter(m=>m.toLowerCase().includes(modelQuery.trim().toLowerCase())).slice(0,200).map(m=>{
                  const ov=Object.entries(selected.permissions?.model_overrides||{}).find(([k])=>k.toLowerCase()===m.toLowerCase())?.[1];
                  const mode=ov==="allow"||ov==="deny"?ov:"default",busyKey=!!pending[`${selected.id}:model:${m}`],personal=personalIds.has(m.toLowerCase());
                  return <div key={m} className={cx("adminModelRow",mode)}>
                    <span title={personal?`${m}: abonamentul tău personal rămâne doar al tău (condițiile furnizorului nu permit împărțirea contului). Dă-i persoanei modelul prin API (openai/…, anthropic/…).`:m}>{m}{personal&&<small className="adminModelNote"> · doar Owner</small>}</span>
                    <div className="adminModelModes" role="group" aria-label={`Acces la ${m}`}>
                      {[["default","Implicit"],["allow","Activat"],["deny","Blocat"]].map(([v,label])=><button key={v} type="button" className={cx(mode===v&&"on")} aria-pressed={mode===v} disabled={busyKey||(personal&&v==="allow"&&mode!=="allow")} title={personal&&v==="allow"?"Abonamentele personale ale Owner-ului nu se pot da altor conturi.":undefined} onClick={()=>mode!==v&&setModelMode(selected,m,v)}>{label}</button>)}
                    </div>
                  </div>;
                })}
              </div>
            </>}
          </>}
        </div>
      </div>
      <details className="adminAudit">
        <summary>Jurnal administrativ ({auditRows.length})</summary>
        <div className="adminAuditList">
          {auditRows.map((x,i)=><div key={x.id||i}><b>{AUDIT_LABELS[x.action]||x.action}{x.details?.status?` · ${ADMIN_STATUS_LABELS[x.details.status]||x.details.status}`:""}</b><span>{x.actor_email||"sistem"} → {x.target_email||"—"}</span><small>{fmtTime(x.created_at)}</small></div>)}
          {!auditRows.length&&<div><span>Nu există înregistrări.</span></div>}
        </div>
      </details>
    </div>
  </ToolShell>;
}

function ExplorePanel({onClose,assistants,onUseAssistant,onImageMode,onOpenLibrary}) {
  const {can}=useAccess();
  const [mapQuery,setMapQuery]=useState(""),[site,setSite]=useState("");
  function openMap(provider){
    const q=mapQuery.trim();if(!q)return;
    openLink(provider==="osm"?`https://www.openstreetmap.org/search?query=${encodeURIComponent(q)}`:`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`);
  }
  function openSite(e){
    e?.preventDefault?.();
    let u=site.trim();if(!u)return;if(!/^https?:\/\//i.test(u))u=`https://${u}`;
    if(!isHttpUrl(u)){toast("Adresa nu este validă.");return;}
    openLink(u);
  }
  const imageOk=can("image_generation");
  return <ToolShell title="Explorează" subtitle="Un singur loc pentru hărți, imagini, asistenți și site-uri." onClose={onClose}>
    <div className="exploreGrid">
      <form className="exploreCard" onSubmit={e=>{e.preventDefault();openMap("google")}}><div className="exploreIcon"><MapIcon size={22}/></div><h3>Hărți</h3><p>Caută o adresă, localitate sau punct de interes.</p><input value={mapQuery} onChange={e=>setMapQuery(e.target.value)} placeholder="Ex. Primăria Cornetu" aria-label="Locul căutat"/><div className="exploreActions"><button className="primary" disabled={!mapQuery.trim()}>Google Maps</button><button type="button" className="secondary" disabled={!mapQuery.trim()} onClick={()=>openMap("osm")}>OpenStreetMap</button></div></form>
      <section className="exploreCard"><div className="exploreIcon"><ImageIcon size={22}/></div><h3>Imagini</h3><p>{imageOk?"Pornește direct o conversație pentru generarea unei imagini.":deniedMessage("image_generation")}</p><button className={cx("primary",!imageOk&&"locked")} onClick={onImageMode}>Creează o imagine</button><button className="secondary" onClick={()=>onOpenLibrary("image")}>Imaginile din Bibliotecă</button></section>
      <section className="exploreCard wide"><div className="exploreIcon"><Bot size={22}/></div><h3>Asistenți</h3><p>Alege rapid un asistent pentru o conversație nouă.</p><div className="gptGrid">{assistants.map(a=><button key={a.id} className="gptCard" onClick={()=>onUseAssistant(a.id)}><span className="gptAvatar">{a.icon||a.name?.[0]||"A"}</span><span><b>{a.name}</b><small>{a.builtIn?"Asistent principal":"Asistent personalizat"}</small></span></button>)}{!assistants.length&&<div className="emptyState small">Nu ai asistenți. Creează unul din bara laterală.</div>}</div></section>
      <form className="exploreCard" onSubmit={openSite}><div className="exploreIcon"><Globe2 size={22}/></div><h3>Site-uri</h3><p>Deschide rapid un site în browser.</p><div className="quickSites"><button type="button" onClick={()=>openLink("https://www.google.com")}>Google</button><button type="button" onClick={()=>openLink("https://www.wikipedia.org")}>Wikipedia</button><button type="button" onClick={()=>openLink("https://www.youtube.com")}>YouTube</button><button type="button" onClick={()=>openLink("https://github.com")}>GitHub</button></div><div className="siteOpen"><input value={site} onChange={e=>setSite(e.target.value)} placeholder="exemplu.ro" aria-label="Adresa site-ului"/><button className="smallBtn" disabled={!site.trim()}><ExternalLink size={14}/> Deschide</button></div></form>
    </div>
  </ToolShell>;
}

function ConversationFilesPanel({conversation,onClose}) {
  const files=(conversation?.messages||[]).flatMap(m=>(m.attachments||[]).map(a=>({...a,fromAssistant:m.role==="assistant",createdAt:m.createdAt})));
  const [busy,setBusy]=useState(null);
  async function download(x,i){
    if(busy!==null)return;setBusy(i);
    try{if(x.fromAssistant&&x.id)await downloadGeneratedFile(x);else await downloadLibraryFile(x)}catch(e){toast(e.message)}finally{setBusy(null)}
  }
  return <ToolShell title="Fișiere din conversație" subtitle="Toate fișierele atașate sau generate în conversația curentă." onClose={onClose}>
    <div className="conversationFiles">{files.length===0?<div className="emptyState"><Paperclip size={28}/>Nu există fișiere în această conversație.</div>:files.map((x,i)=><div className="conversationFile" key={i}><FileText size={20}/><div><b>{x.name}</b><span>{x.fromAssistant?`Generat de ${BRAND_NAME}`:"Atașat de tine"} · {kindLabel(x.kind||x.type||mediaKind(x.mime||x.mimeType,x.name),x.mime||x.mimeType,x.name)} · {fmtTime(x.createdAt)}</span></div>{(x.libraryId||x.id)&&<button className="smallBtn" onClick={()=>download(x,i)} disabled={busy!==null}><Download size={14}/> {busy===i?"Se descarcă…":"Descarcă"}</button>}</div>)}</div>
  </ToolShell>;
}
// Windows only: Settings shows saved keys masked, so this copies them for the server's setup script (aistoica.ro).
function ServerKeysBox() {
  const [state,setState]=useState({busy:false,text:"",bad:false});
  if(!window.Serasmart?.copyServerKeys)return null;
  async function run(){
    setState({busy:true,text:"",bad:false});
    try{
      const r=await window.Serasmart.copyServerKeys();
      const skipped=r?.skipped?.length?" "+tr("I did not copy {names}: they have characters the server does not accept.",{names:r.skipped.join(", ")}):"";
      setState({busy:false,bad:!r?.ok,text:r?.ok?tr(r.count===1?"I copied 1 key for the server. Paste it when the script on the server asks (right click). It is cleared from the clipboard in 2 minutes.":"I copied {n} keys for the server. Paste them when the script on the server asks (right click). They are cleared from the clipboard in 2 minutes.",{n:r.count})+skipped:(r?.error||tr("The keys could not be copied."))});
    }catch(e){setState({busy:false,bad:true,text:e.message})}
  }
  return <div className="providerTest">
    <div className="providerTestHead"><div><b>{tr("Keys for the server")}</b><span>{tr("Copies the keys saved on this PC, so the {domain} site has the same models.",{domain:BRAND_DOMAIN})}</span></div>
      <button className="secondary" onClick={run} disabled={state.busy}>{state.busy?tr("Copying…"):tr("Copy the keys for the server")}</button></div>
    {state.text&&<div className={cx("providerRow",state.bad?"bad":"good")}>{state.bad?<X size={15}/>:<Check size={15}/>}<span>{state.text}</span></div>}
  </div>;
}

// OmniRoute's connection names, as people know them.
const OMNI_CONNECTIONS={codex:"Codex (ChatGPT)","grok-cli":"Grok CLI",github:"GitHub Copilot","claude-code":"Claude Code",claude:"Claude Code","gemini-cli":"Gemini CLI",antigravity:"Antigravity","gemini-web":"Gemini Web","chatgpt-web":"ChatGPT Web"};
function ProviderTestBox() {
  const [state,setState]=useState({busy:false,data:null,media:[],omni:null,error:""});
  async function run(){
    setState({busy:true,data:null,media:[],omni:null,error:""});
    try{const d=await api("/api/providers/test",{method:"POST",body:"{}"});setState({busy:false,data:d.data||[],media:d.media||[],omni:d.omni||null,error:""})}
    catch(e){setState({busy:false,data:null,media:[],omni:null,error:e.message})}
  }
  return <div className="providerTest">
    <div className="providerTestHead"><div><b>{tr("Test the keys")}</b><span>{tr("Checks OmniRoute (the key and one Gemini, Grok, OpenAI and Claude model) and every saved API. Save the settings before testing.")}</span></div>
      <button className="secondary" onClick={run} disabled={state.busy}>{state.busy?tr("Testing…"):tr("Test now")}</button></div>
    {state.error&&<div className="providerRow bad"><X size={15}/><span>{state.error}</span></div>}
    {state.omni&&<div className={cx("providerRow",state.omni.ok?"good":"bad")}>{state.omni.ok?<Check size={15}/>:<X size={15}/>}<b>OmniRoute</b><span>{state.omni.ok?tr("the key works · {models} models, {combos} combinations · {s} s",{models:state.omni.models,combos:state.omni.combos,s:(state.omni.ms/1000).toFixed(1)}):state.omni.error}</span></div>}
    {state.omni?.expired?.length>0&&<div className="providerRow bad omniExpired"><X size={15}/><b>{tr("Reconnect in OmniRoute")}</b><span>{tr("The login expired for: {names}. OmniRoute panel on the server → Providers → each account → Reconnect (or add an API key).",{names:state.omni.expired.map(x=>OMNI_CONNECTIONS[x]||x).join(", ")})}</span></div>}
    {(state.omni?.checks||[]).map(c=><div key={c.model} className={cx("providerRow omniCheck",c.ok?"good":"bad")}>{c.ok?<Check size={15}/>:<X size={15}/>}<b>{c.model}</b><span>{c.ok?tr("answers · {s} s",{s:(c.ms/1000).toFixed(1)}):c.error||("HTTP "+c.status)}</span></div>)}
    {state.data&&!state.data.length&&!state.omni?.ok&&<div className="providerRow bad"><X size={15}/><span>{tr("No chat key is saved. Add, for example, a Gemini or Groq key and save.")}</span></div>}
    {(state.data||[]).map(x=><div key={x.provider} className={cx("providerRow",x.ok?"good":"bad")}>{x.ok?<Check size={15}/>:<X size={15}/>}<b>{x.label}</b><span>{x.model}{x.ok?` · ${(x.ms/1000).toFixed(1)} s`:` · ${x.error||("HTTP "+x.status)}`}{x.paid?" · "+tr("paid"):""}</span></div>)}
    {state.data&&state.media.length>0&&<div className="providerMedia">{tr("Pictures and video (not generated in the test, so no credit is used):")} {state.media.map(m=>`${m.label} ${m.configured?"✓":"—"}`).join(" · ")}</div>}
  </div>;
}
function FirstRunGuide({onDone,onOpenSettings}) {
  const [key,setKey]=useState(""),[status,setStatus]=useState(""),[busy,setBusy]=useState(false);
  const mounted=useRef(true);
  useEffect(()=>()=>{mounted.current=false},[]);
  function openKeys(){openLink("https://aistudio.google.com/apikey")}
  async function saveAndTest(e){
    e?.preventDefault?.();
    const clean=key.trim();if(!clean){setStatus("Lipește mai întâi cheia.");return}
    if(busy)return;
    setBusy(true);setStatus("Salvez cheia și o testez…");
    try{
      const saved=await window.Serasmart?.setConfig?.({geminiApiKey:clean});
      if(!saved)throw new Error(`Setările pot fi salvate doar din aplicația ${BRAND_NAME}.`);
      const d=await api("/api/providers/test",{method:"POST",body:"{}"});
      const gem=(d.data||[]).find(x=>x.provider==="gemini");
      if(!mounted.current)return;
      if(gem?.ok){setStatus("Gata! Cheia funcționează.");setTimeout(()=>onDone(true),700)}
      else setStatus("Cheia nu a funcționat: "+(gem?.error||"verifică dacă ai copiat-o complet."));
    }catch(err){if(mounted.current)setStatus(err.message)}finally{if(mounted.current)setBusy(false)}
  }
  return <Modal title={`Bun venit în ${BRAND_NAME}`} subtitle="3 pași, gratuit, fără card. Durează un minut." className="modal firstRun" onClose={()=>onDone(false)}>
    <form onSubmit={saveAndTest}>
      <ol className="firstRunSteps">
        <li><b>Creează o cheie Gemini gratuită</b><span>Se deschide pagina Google. Apasă „Create API key” și copiaz-o.</span><button type="button" className="secondary" onClick={openKeys}>Deschide pagina Google</button></li>
        <li><b>Lipește cheia aici</b><input value={key} onChange={e=>setKey(e.target.value)} placeholder="AIza…" aria-label="Cheia Gemini" autoComplete="off"/></li>
        <li><b>Salvează și testează</b><button className="primary" disabled={busy}>{busy?"Se verifică…":"Salvează și testează"}</button></li>
      </ol>
    </form>
    {status&&<div className="toolStatus" role="status">{status}</div>}
    <p className="settingsHelp">Poți adăuga oricând și alte API-uri gratuite (Groq, Cerebras, Cloudflare pentru imagini) din Setări → API-uri AI. <button type="button" className="linkBtn" onClick={onOpenSettings}>Deschide Setările</button></p>
  </Modal>;
}

function ProviderHead({name,id,cfg,children}) {
  const url=cfg?.providerKeyPages?.[id];
  return <div className="providerGroup"><div className="providerGroupTop"><b>{name}</b>{url&&<button type="button" className="providerKeyLink" onClick={()=>openLink(url)}>{tr("Get the free key")} <ExternalLink size={12}/></button>}</div><small>{children}</small></div>;
}
// Settings → API-uri AI: which companies' models the chat uses. Unticked = their models leave the list and never answer
// (not even as a fallback). Cerebras starts unticked.
const CHAT_FAMILIES=[["openai","OpenAI (ChatGPT, Codex)"],["anthropic","Claude (Anthropic, Claude Code)"],["gemini","Google Gemini"],["xai","Grok (xAI)"],["groq","Groq"],["cerebras","Cerebras"],["mistral","Mistral"],["openrouter","OpenRouter"],["nvidia","NVIDIA"],["github","GitHub Models"],["cloudflare","Cloudflare"],["cohere","Cohere"],["huggingface","Hugging Face"]];
function ProviderUseList({cfg,set}) {
  const blocked=new Set(String(cfg.blockedProviders??"cerebras").split(",").map(x=>x.trim()).filter(Boolean));
  const toggle=(id,on)=>{const next=new Set(blocked);if(on)next.delete(id);else next.add(id);set({blockedProviders:[...next].join(",")})};
  return <fieldset className="providerUse"><legend>{tr("Providers used in chat")}</legend>
    <p className="settingsHelp">{tr("Unticked: its models leave the list and never answer, not even as a fallback. OmniRoute combinations stay; you choose what they contain in the OmniRoute panel.")}</p>
    <div className="providerUseGrid">{CHAT_FAMILIES.map(([id,label])=><label key={id} className="providerUseItem"><input type="checkbox" checked={!blocked.has(id)} onChange={e=>toggle(id,e.target.checked)}/><span>{label}</span></label>)}</div>
  </fieldset>;
}
// Site accounts other than the Owner: every free model works for them; an OmniRoute combination only when shared here,
// since it may run on the Owner's subscriptions (Codex, Claude Code…), which their terms forbid sharing.
function SharedCombos({cfg,set}) {
  const [combos,setCombos]=useState(null);
  useEffect(()=>{let live=true;api("/api/models").then(ms=>{if(live)setCombos(Array.isArray(ms?.combos)?ms.combos.map(String):[])}).catch(()=>{if(live)setCombos([])});return()=>{live=false}},[]);
  const chosen=String(cfg.sharedCombos||"").split(",").map(x=>x.trim()).filter(Boolean);
  const has=name=>chosen.some(x=>x.toLowerCase()===name.toLowerCase());
  const toggle=(name,on)=>set({sharedCombos:(on?[...chosen.filter(x=>x.toLowerCase()!==name.toLowerCase()),name]:chosen.filter(x=>x.toLowerCase()!==name.toLowerCase())).join(",")});
  const names=[...new Set([...(combos||[]),...chosen])];
  return <fieldset className="providerUse"><legend>{tr("Combinations for every account")}</legend>
    <p className="settingsHelp">{tr("Other accounts use every free model (Gemini, Groq, Mistral, OpenRouter :free…). Your subscriptions (Codex, Claude Code, Copilot, Kiro, the web accounts) stay yours alone: their terms do not allow sharing the account. They use an OmniRoute combination only if you tick it here; tick only combinations made of free models.")}</p>
    {combos===null?<p className="settingsHelp">{tr("Loading the combinations…")}</p>:names.length?<div className="providerUseGrid">{names.map(name=><label key={name} className="providerUseItem"><input type="checkbox" checked={has(name)} onChange={e=>toggle(name,e.target.checked)}/><span>{name}</span></label>)}</div>:<p className="settingsHelp">{tr("OmniRoute has no combinations yet.")}</p>}
  </fieldset>;
}
// Poze / Video → «Făcute de» (0.7.24): every maker by default, best first; a list keeps only those. OpenAI makes no video
// any more (Sora closed on 24 September 2026).
const MEDIA_MAKERS={
  image:[["","All, the best first (ChatGPT, Gemini, Grok, free ones)"],["openai","ChatGPT only · GPT Image"],["gemini","Gemini only · Nano Banana"],["gemini,openai,xai","ChatGPT, Gemini and Grok"]],
  video:[["","All, the best first (free ones, Gemini Veo, Grok)"],["gemini","Gemini only · Veo"],["gemini,xai","Gemini and Grok"]]
};
const GEMINI_MEDIA_MODELS={
  image:[["gemini-3.1-flash-image","Nano Banana 2 · gemini-3.1-flash-image"],["gemini-3-pro-image-preview","Nano Banana Pro · gemini-3-pro-image-preview"],["gemini-2.5-flash-image","Nano Banana · gemini-2.5-flash-image"]],
  video:[["veo-3.1-fast-generate-preview","Veo 3.1 Fast · veo-3.1-fast-generate-preview"],["veo-3.1-generate-preview","Veo 3.1 · veo-3.1-generate-preview"],["veo-3.0-fast-generate-001","Veo 3 Fast · veo-3.0-fast-generate-001"]]
};
function MediaMakers({kind,cfg,set,paidOff}) {
  const field=kind==="image"?"imageProviders":"videoProviders",modelField=kind==="image"?"geminiImageModel":"geminiVideoModel";
  const value=String(cfg[field]??"").split(",").map(x=>x.trim().toLowerCase()).filter(x=>x&&!(kind==="video"&&x==="openai")).join(",");
  const options=MEDIA_MAKERS[kind].some(([v])=>v===value)?MEDIA_MAKERS[kind]:[...MEDIA_MAKERS[kind],[value,tr("Your choice: {value}",{value})]];
  const model=String(cfg[modelField]||GEMINI_MEDIA_MODELS[kind][0][0]);
  const models=GEMINI_MEDIA_MODELS[kind].some(([v])=>v===model)?GEMINI_MEDIA_MODELS[kind]:[...GEMINI_MEDIA_MODELS[kind],[model,model]];
  const geminiOnly=value==="gemini";
  return <fieldset className="providerUse"><legend>{kind==="image"?tr("Pictures made by"):tr("Videos made by")}</legend>
    <label>{tr("Providers")}<select value={value} onChange={e=>set({[field]:e.target.value})}>{options.map(([v,l])=><option key={v||"all"} value={v}>{tr(l)}</option>)}</select></label>
    <label>{kind==="image"?tr("Gemini model (Nano Banana)"):tr("Gemini model (Veo)")}<select value={model} onChange={e=>set({[modelField]:e.target.value})}>{models.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
    <p className="settingsHelp">{geminiOnly
      ?tr("Gemini only: through Gemini connected in OmniRoute (subscription, no API) or through the Gemini key under AI APIs. The other providers below are not used.")+(paidOff?" "+tr("Gemini through the API is paid: to use it with the key, choose «Allow paid providers» below."):"")
      :tr("If the chosen Gemini model does not exist for your key, {brand} tries the other Gemini names on its own, then the providers allowed here.",{brand:BRAND_NAME})}
      {" "}{kind==="image"?tr("Under the message box, in Picture mode, you can choose each time who makes it. On «Automatic», when you picked a Gemini, ChatGPT or Grok model in the chat, that model's company makes the picture (first the subscription in OmniRoute, then its API); otherwise this setting is used."):tr("Under the message box, in Video mode, you can choose each time who makes it. On «Automatic», when you picked a Gemini or Grok model in the chat, that model's company makes the video (first the subscription in OmniRoute, then its API); otherwise this setting is used.")}</p>
  </fieldset>;
}
function KeyField({label,name,cfg,keys,setKeys,placeholder,token=false}) {
  const pending=keys[name]||"",clearing=pending==="__CLEAR__",saved=!!cfg?.[name];
  const savedText=token?tr("Token saved — leave empty to keep it"):tr("Key saved — leave empty to keep it");
  return <label>{label}<span className="keyRow">
    <input type="password" value={clearing?"":pending} disabled={clearing} onChange={e=>setKeys(k=>({...k,[name]:e.target.value}))} placeholder={clearing?tr("It will be deleted when you save"):saved?savedText:placeholder} autoComplete="off"/>
    {saved&&(clearing
      ?<button type="button" className="smallBtn" onClick={()=>setKeys(k=>({...k,[name]:""}))}>{tr("Cancel")}</button>
      :<button type="button" className="smallBtn dangerSmall" onClick={()=>setKeys(k=>({...k,[name]:"__CLEAR__"}))} title={token?tr("Delete the saved token"):tr("Delete the saved key")}>{tr("Delete")}</button>)}
  </span></label>;
}

// On the web site the Owner's settings live on the server (/api/server/settings, lib/serversettings.cjs); in Windows,
// in the app (Electron). Both answer the same shape, so the same Settings window serves both.
const WEB_SETTINGS={
  getConfig:async()=>(await api("/api/server/settings")).data,
  setConfig:async(payload)=>{const r=await api("/api/server/settings",{method:"PUT",body:JSON.stringify(payload)});return {ok:true,config:r.config};}
};
// The tabs every account has (0.7.23): saved for the account on the server, each with its own buttons.
const ACCOUNT_TABS=["profile","notify","privacy","security"];
function SettingsModal({onClose,onSaved,user,machineSettingsAllowed=true,initialTab="general",preferences,onPreferences,prefBusy,models=[],onAccountDeleted,onDataDeleted}) {
  const {isOwner}=useAccess();
  const bridge=window.Serasmart?.getConfig?window.Serasmart:IS_WEB&&isOwner?WEB_SETTINGS:null;
  const webServer=bridge===WEB_SETTINGS;
  // Without machine settings (an account on the site that is not the Owner) only the account's own tabs are shown.
  const accountOnly=!bridge;
  const account=useAccountSettings();
  const [cfg,setCfg]=useState(null),[keys,setKeys]=useState({}),[tab,setTab]=useState(accountOnly&&!ACCOUNT_TABS.includes(initialTab)?"profile":initialTab),[status,setStatus]=useState(null),[micStatus,setMicStatus]=useState(""),[toolStatus,setToolStatus]=useState(""),[error,setError]=useState(""),[saving,setSaving]=useState(false),[updateStatus,setUpdateStatus]=useState("");
  const {ref,backdropProps}=useModal(onClose);
  const mounted=useRef(true);
  useEffect(()=>()=>{mounted.current=false},[]);
  useEffect(()=>{
    if(!bridge)return;
    Promise.all([bridge.getConfig(),bridge.systemStatus?.().catch(()=>null)])
      .then(([c,s])=>{if(mounted.current){setCfg(c||{});setStatus(s)}})
      .catch(e=>{if(mounted.current)setError(tr("Could not read the settings:")+" "+e.message)});
  },[]);
  useEffect(()=>{if(!machineSettingsAllowed&&["ai","chatapis","images","video"].includes(tab))setTab("general")},[machineSettingsAllowed,tab]);
  const set=patch=>setCfg(c=>({...c,...patch}));
  async function save(){
    if(saving||!cfg)return;
    setError("");
    const gw=webServer?GATEWAY:cleanGatewayUrl(cfg.gatewayUrl||DEFAULT_GATEWAY);
    if(machineSettingsAllowed&&!gw){setError(tr("The local service address is not valid. Example: {url}",{url:DEFAULT_GATEWAY}));setTab("ai");return;}
    const ownerEmail=String(cfg.ownerEmail||"").trim().toLowerCase();
    if(machineSettingsAllowed&&!webServer&&ownerEmail&&!/^\S+@\S+\.\S+$/.test(ownerEmail)){setError(tr("The Owner email is not valid."));setTab("account");return;}
    setSaving(true);
    try{
      if(machineSettingsAllowed&&gw!==GATEWAY){
        try{const r=await fetch(`${gw}/health`,{signal:AbortSignal.timeout(5000)});if(!r.ok)throw new Error("HTTP "+r.status)}
        catch{throw new Error(tr("I cannot reach the {brand} service at {url}. Check the address or use {local}.",{brand:BRAND_NAME,url:gw,local:DEFAULT_GATEWAY}))}
      }
      const changedKeys=Object.fromEntries(Object.entries(keys).filter(([,v])=>v));
      const payload={...cfg,...(machineSettingsAllowed&&!webServer?{gatewayUrl:gw,ownerEmail}:{}),...changedKeys};
      const r=await bridge.setConfig(payload);
      if(r&&r.ok===false)throw new Error(r.error||tr("The settings could not be saved."));
      if(machineSettingsAllowed&&!webServer)setGatewayUrl(gw);
      DICTATION_LANG=String(payload.speechLanguage||"ro");
      onSaved?.(r?.config||payload);
      toast(tr("Settings saved."),"ok");
      onClose();
    }catch(e){if(mounted.current)setError(e.message)}
    finally{if(mounted.current)setSaving(false)}
  }
  async function testMic(){setMicStatus(tr("Checking…"));try{const s=await navigator.mediaDevices.getUserMedia({audio:true});s.getTracks().forEach(t=>t.stop());setMicStatus(tr("Microphone available and allowed ✓"))}catch{setMicStatus(tr("Microphone unavailable or not allowed"))}}
  async function testServer(){setToolStatus(tr("Testing the SSH connection…"));try{const d=await api("/api/tools/server/check",{method:"POST",body:JSON.stringify({serverHost:cfg.serverHost,serverPort:cfg.serverPort,serverUser:cfg.serverUser,serverKeyPath:cfg.serverKeyPath})});setToolStatus(d?.output||tr("Server connected ✓"))}catch(e){setToolStatus("Server: "+e.message)}}
  async function checkUpdate(){
    if(!window.Serasmart?.checkUpdate)return;
    setUpdateStatus(tr("Looking for updates…"));
    try{const r=await window.Serasmart.checkUpdate();setUpdateStatus(!r?.ok?tr("Could not check:")+" "+(r?.error||tr("error")):r.available===false||!r.version?tr("You have the latest version."):r.available===true?tr("Version {v} is available. It downloads on its own; you get a notification when it is ready.",{v:r.version}):tr("Latest published version: {v}.",{v:r.version}))}
    catch(e){setUpdateStatus(tr("Could not check:")+" "+e.message)}
  }
  const keyProps={cfg,keys,setKeys};
  // The site's server allows paid pictures when nothing was chosen (no imageCostPolicy in .env); Windows saves "free_only".
  const imageCost=cfg?.imageCostPolicy||(webServer?"allow_paid":"free_only");
  const tabs=[["profile",User,"Profile",true],["general",SlidersHorizontal,"General",!!bridge],["ai",Bot,"AI & OmniRoute",machineSettingsAllowed&&!!bridge],["chatapis",Plug,"AI APIs",machineSettingsAllowed&&!!bridge],["images",ImageIcon,"Pictures",machineSettingsAllowed&&!!bridge],["video",Play,"Video",machineSettingsAllowed&&!!bridge],["voice",Volume2,"Voice and microphone",!!bridge],["notify",Bell,"Notifications",true],["privacy",ShieldCheck,"Privacy",true],["security",Lock,"Security",true],["account",HardDrive,"Owner on this PC",machineSettingsAllowed&&!webServer&&!!bridge]];
  const onAccountTab=accountOnly||ACCOUNT_TABS.includes(tab);
  return <div className="modalBackdrop" {...backdropProps}><div className="settingsModal" ref={ref} role="dialog" aria-modal="true" aria-label={tr("{brand} settings",{brand:BRAND_NAME})} tabIndex={-1}><div className="modalHead"><div><h2>{tr("{brand} settings",{brand:BRAND_NAME})}</h2><p>{accountOnly?tr("Your profile, how the AI answers you, notifications, privacy and security."):tr("Your account, the app, voice, the AI services and updates.")}</p></div><button className="iconOnly" onClick={onClose} aria-label={tr("Close")} title={tr("Close")}><X size={20}/></button></div>
    {!cfg&&!onAccountTab?<div className="settingsLoading">{error||tr("Loading the settings…")}{error&&<ServerUpdate/>}</div>:<>
    <div className="settingsBody"><div className="settingsNav" role="tablist" aria-orientation="vertical">
      {tabs.filter(t=>t[3]).map(([k,Icon,label])=><button key={k} role="tab" aria-selected={tab===k} className={tab===k?"active":""} onClick={()=>setTab(k)}><Icon size={17}/> {tr(label)}</button>)}
    </div>
    <div className="settingsPane">
      {tab==="profile"&&<ProfileTab account={account} models={models} preferences={preferences} onPreferences={onPreferences} prefBusy={prefBusy}/>}
      {tab==="privacy"&&<PrivacyTab account={account} onDataDeleted={onDataDeleted}/>}
      {tab==="security"&&<SecurityTab account={account} onAccountDeleted={onAccountDeleted}/>}
      {tab==="general"&&cfg&&<><h3>{tr("General")}</h3>
        {!IS_WEB&&<>
        <label className="toggleRow"><div><b>{tr("Start {brand} with Windows",{brand:BRAND_NAME})}</b><span>{tr("The app starts on its own and can stay in the background.")}</span></div><input type="checkbox" checked={!!cfg.startWithWindows} onChange={e=>set({startWithWindows:e.target.checked})}/></label>
        <label className="toggleRow"><div><b>{tr("Close to the notification area")}</b><span>{tr("The X button hides the app without stopping the services.")}</span></div><input type="checkbox" checked={cfg.closeToTray!==false} onChange={e=>set({closeToTray:e.target.checked})}/></label>
        <label className="toggleRow"><div><b>{tr("Automatic updates (Windows app)")}</b><span>{tr("At start, {brand} downloads the new version from GitHub Releases on its own and tells you when it is ready to install.",{brand:BRAND_NAME})}</span></div><input type="checkbox" checked={cfg.autoUpdate!==false} onChange={e=>set({autoUpdate:e.target.checked})}/></label>
        {window.Serasmart?.checkUpdate&&<div className="settingsButtons"><button type="button" className="secondary" onClick={checkUpdate}><RotateCcw size={15}/> {tr("Check for updates now")}</button></div>}
        {updateStatus&&<div className="micStatus" role="status">{updateStatus}</div>}
        </>}
        <ServerUpdate/>
      </>}
      {tab==="ai"&&cfg&&<><h3>{tr("AI & OmniRoute")}</h3>
        {webServer&&<p className="settingsHelp">{tr("The site's settings: saved on the server and applied at once for every account. The keys stay on the server and are only shown masked. The Owner email and sign-ups stay in the .env file on the server.")}</p>}
        {!webServer&&<>
        <label>{tr("{brand} service address",{brand:BRAND_NAME})}<input value={cfg.gatewayUrl||DEFAULT_GATEWAY} onChange={e=>set({gatewayUrl:e.target.value})} placeholder={DEFAULT_GATEWAY}/></label>
        <p className="settingsHelp">{tr("Leave {url} unless you use a separate {brand} server. The address is checked before saving.",{url:DEFAULT_GATEWAY,brand:BRAND_NAME})}</p>
        <label>{BRAND_SHORT} Cloud API<input value={cfg.controlApiUrl||""} onChange={e=>set({controlApiUrl:e.target.value})} placeholder="https://api.aistoica.ro"/></label>
        <p className="settingsHelp">{tr("With the Cloud API set, the Owner manages accounts, approvals and permissions centrally. Leave it empty to use this PC only.")}</p>
        </>}
        <label>{tr("OmniRoute address")}<input value={cfg.baseUrl||""} onChange={e=>set({baseUrl:e.target.value})}/></label>
        <KeyField label={tr("OmniRoute API key")} name="apiKey" placeholder={tr("OmniRoute key")} {...keyProps}/>
        <p className="settingsHelp">{tr("OmniRoute 3.8 does not answer without a key. Create it in OmniRoute:")} <button type="button" className="linkBtn" onClick={()=>openLink(String(cfg.baseUrl||"http://127.0.0.1:20128/v1").replace(/\/v1\/?$/,"")+"/dashboard/api-manager")}>API Manager → Create API Key</button>{tr(", paste it here and press «Test the keys».")}</p>
        <label><span className="labelLine">{tr("Preferred model")} <span className="optional">{tr("used when you did not pick another in the list at the top")}</span></span><input value={cfg.model||""} onChange={e=>set({model:e.target.value})} placeholder={tr("E.g. gemini/gemini-3.5-flash")}/></label>
        <label><span className="labelLine">{tr("Picture model")} <span className="optional">{tr("optional")}</span></span><input value={cfg.imageModel||""} onChange={e=>set({imageModel:e.target.value})} placeholder={tr("Automatic — the first picture model available")}/></label>
        <details className="mediaProviderSettings"><summary>{isOwner?tr("Live internet, GitHub and server"):tr("Live internet and GitHub")}</summary>
          <p className="settingsHelp">{tr("These tools let {brand} check current information and bring relevant parts of a GitHub repository.",{brand:BRAND_NAME})} {isOwner?tr("Running code and SSH are for the Owner only."):tr("Running code, GitHub Solve and SSH are for the Owner account only (see «Owner email on this PC»).")}</p>
          <label className="toggleRow"><div><b>{tr("Real-time internet")}</b><span>{tr("Searches current sources on its own for questions about recent information, versions and APIs.")}</span></div><input type="checkbox" checked={cfg.webSearchEnabled!==false} onChange={e=>set({webSearchEnabled:e.target.checked})}/></label>
          <label className="toggleRow"><div><b>{tr("Context across the project's chats")}</b><span>{tr("Uses the relevant chats of the same project without copying them by hand.")}</span></div><input type="checkbox" checked={cfg.projectContextEnabled!==false} onChange={e=>set({projectContextEnabled:e.target.checked})}/></label>
          <label className="toggleRow"><div><b>{tr("Search GitHub automatically")}</b><span>{tr("For code questions, looks for relevant files in the repository before answering.")}</span></div><input type="checkbox" checked={cfg.githubAutoContext!==false} onChange={e=>set({githubAutoContext:e.target.checked})}/></label>
          <label>GitHub repository<input value={cfg.githubRepo||""} onChange={e=>set({githubRepo:e.target.value})} placeholder="owner/repository"/></label>
          <label>GitHub branch<input value={cfg.githubBranch||"main"} onChange={e=>set({githubBranch:e.target.value})} placeholder="main"/></label>
          <KeyField label={tr("GitHub token (for a private repository)")} name="githubToken" placeholder={tr("github_pat_... or ghp_...")} token {...keyProps}/>
          {isOwner&&!webServer&&<>
            <label>{tr("SSH server · address")}<input value={cfg.serverHost||""} onChange={e=>set({serverHost:e.target.value})} placeholder={tr("IP or domain")}/></label>
            <div className="claudeFormRow"><label>{tr("SSH user")}<input value={cfg.serverUser||"root"} onChange={e=>set({serverUser:e.target.value})}/></label><label>Port SSH<input type="number" min="1" max="65535" value={cfg.serverPort||22} onChange={e=>set({serverPort:Number(e.target.value)||22})}/></label></div>
            <label>{tr("SSH private key path")}<input value={cfg.serverKeyPath||""} onChange={e=>set({serverKeyPath:e.target.value})} placeholder={tr("C:\\Users\\you\\.ssh\\id_ed25519")}/></label>
            <button type="button" className="secondary testMicBtn" onClick={testServer}>{tr("Test the server")}</button>{toolStatus&&<div className="micStatus" role="status">{toolStatus}</div>}
          </>}
        </details>
        <p className="settingsHelp">{tr("When you ask for a picture or a video, {brand} puts the real file in the chat, with a download button.",{brand:BRAND_NAME})}</p>
        {!webServer&&<>
        <label>{tr("OmniRoute command")}<input value={cfg.omniCommand||"omniroute.cmd"} onChange={e=>set({omniCommand:e.target.value})}/></label>
        <label className="toggleRow"><div><b>{tr("Start OmniRoute automatically")}</b><span>{tr("If the service stops, {brand} tries to restart it.",{brand:BRAND_NAME})}</span></div><input type="checkbox" checked={!!cfg.autoStartOmniRoute} onChange={e=>set({autoStartOmniRoute:e.target.checked})}/></label>
        <div className="statusGrid"><div><span>{tr("{brand} service",{brand:BRAND_NAME})}</span><b>{status?.gatewayRunning?tr("Running"):tr("Unavailable")}</b></div><div><span>OmniRoute</span><b>{status?.omniRunning?tr("Connected"):status?.omniInstalled===false?tr("Not installed — npm install -g omniroute"):tr("Unavailable")}</b></div></div>
        </>}
      </>}
      {tab==="chatapis"&&cfg&&<><div className="settingsSectionTitle"><div className="settingsSectionIcon"><Plug size={22}/></div><div><h3>{tr("AI APIs")}</h3><p>{tr("Their models appear in the list and answer directly, without OmniRoute.")}</p></div></div>
        <ProviderTestBox/>
        <ServerKeysBox/>
        <label className="toggleRow"><div><b>{tr("Use the direct APIs")}</b><span>{tr("Their models appear in the list (Groq, Gemini, Cerebras…). They answer when you pick them or when no model is picked.")}</span></div><input type="checkbox" checked={cfg.directChatEnabled!==false} onChange={e=>set({directChatEnabled:e.target.checked})}/></label>
        <label className="toggleRow"><div><b>{tr("Automatic fallback")}</b><span>{tr("If the chosen model does not answer, it moves to the direct APIs on its own. Off: only the chosen model answers, otherwise you see the error.")}</span></div><input type="checkbox" checked={cfg.chatFallbackOnFailure===true} onChange={e=>set({chatFallbackOnFailure:e.target.checked})}/></label>
        <ProviderUseList cfg={cfg} set={set}/>
        {(webServer||cfg.controlApiUrl)&&<SharedCombos cfg={cfg} set={set}/>}
        <label>{tr("Cost protection")}<select value={cfg.directChatCostPolicy||"free_only"} onChange={e=>set({directChatCostPolicy:e.target.value})}><option value="free_only">{tr("Only providers with no direct cost")}</option><option value="allow_paid">{tr("Also allow the paid APIs (OpenAI, Grok)")}</option></select></label>
        <label>{tr("Order to try")}<input value={cfg.directChatProviderOrder||"cerebras,groq,gemini,mistral,nvidia,github,openrouter,cloudflare,cohere,huggingface,openai,xai"} onChange={e=>set({directChatProviderOrder:e.target.value})}/></label>
        <p className="settingsHelp">{tr("Every model in these lists appears in the model list at the top. If the key is missing, or the provider answers 429/404/503 or not at all, {brand} tries the next model, then the next provider.",{brand:BRAND_NAME})}</p>
        <ProviderHead name="Cerebras" id="cerebras" cfg={cfg}>{tr("OpenAI compatible.")}</ProviderHead>
        <KeyField label={tr("Cerebras API key")} name="cerebrasApiKey" placeholder="csk-..." {...keyProps}/>
        <label>{tr("Cerebras models · separated by commas")}<input value={cfg.cerebrasModel||""} onChange={e=>set({cerebrasModel:e.target.value})}/></label>
        <ProviderHead name="Groq" id="groq" cfg={cfg}>{tr("OpenAI compatible, fast answers.")}</ProviderHead>
        <KeyField label={tr("Groq API key")} name="groqApiKey" placeholder="gsk_..." {...keyProps}/>
        <label>{tr("Groq models · separated by commas")}<input value={cfg.groqModel||""} onChange={e=>set({groqModel:e.target.value})}/></label>
        <ProviderHead name="Gemini" id="gemini" cfg={cfg}>{tr("Tries the models in order until one has quota left.")}</ProviderHead>
        <KeyField label={tr("Gemini API key")} name="geminiApiKey" placeholder="AIza..." {...keyProps}/>
        <label>{tr("Gemini models · separated by commas")}<input value={cfg.geminiModels||""} onChange={e=>set({geminiModels:e.target.value})}/></label>
        <ProviderHead name="Mistral" id="mistral" cfg={cfg}>{tr("OpenAI compatible.")}</ProviderHead>
        <KeyField label={tr("Mistral API key")} name="mistralApiKey" placeholder={tr("API key")} {...keyProps}/>
        <label>{tr("Mistral models · separated by commas")}<input value={cfg.mistralModel||""} onChange={e=>set({mistralModel:e.target.value})}/></label>
        <ProviderHead name="NVIDIA" id="nvidia" cfg={cfg}>{tr("NVIDIA API / NIM, OpenAI compatible.")}</ProviderHead>
        <KeyField label={tr("NVIDIA API key")} name="nvidiaApiKey" placeholder="nvapi-..." {...keyProps}/>
        <label>{tr("NVIDIA models · separated by commas")}<input value={cfg.nvidiaModel||""} onChange={e=>set({nvidiaModel:e.target.value})}/></label>
        <ProviderHead name="GitHub Models" id="github" cfg={cfg}>{tr("A fine-grained token with the Models: Read permission. The same token is used for GitHub.")}</ProviderHead>
        <KeyField label="Token GitHub" name="githubToken" placeholder="github_pat_..." token {...keyProps}/>
        <label>{tr("GitHub models · separated by commas")}<input value={cfg.githubModelsModel||""} onChange={e=>set({githubModelsModel:e.target.value})}/></label>
        <ProviderHead name="OpenRouter" id="openrouter" cfg={cfg}>{tr("AUTO_FREE finds the first free model available on its own.")}</ProviderHead>
        <KeyField label={tr("OpenRouter API key")} name="openRouterApiKey" placeholder="sk-or-..." {...keyProps}/>
        <label>{tr("OpenRouter model")}<input value={cfg.openRouterChatModel||"AUTO_FREE"} onChange={e=>set({openRouterChatModel:e.target.value})}/></label>
        <ProviderHead name="Cloudflare Workers AI" id="cloudflare" cfg={cfg}>{tr("A token with the «Workers AI» template. The Account ID is in dash.cloudflare.com → AI → Workers AI. The same token as for Pictures.")}</ProviderHead>
        <label>Cloudflare Account ID<input value={cfg.cloudflareAccountId||""} onChange={e=>set({cloudflareAccountId:e.target.value})}/></label>
        <KeyField label={tr("Cloudflare API token")} name="cloudflareApiToken" placeholder={tr("API token")} token {...keyProps}/>
        <label>{tr("Cloudflare models · separated by commas")}<input value={cfg.cloudflareChatModel||""} onChange={e=>set({cloudflareChatModel:e.target.value})}/></label>
        <ProviderHead name="Cohere" id="cohere" cfg={cfg}>{tr("Compatibility API.")}</ProviderHead>
        <KeyField label={tr("Cohere API key")} name="cohereApiKey" placeholder={tr("API key")} {...keyProps}/>
        <label>{tr("Cohere models · separated by commas")}<input value={cfg.cohereModel||""} onChange={e=>set({cohereModel:e.target.value})}/></label>
        <ProviderHead name="Hugging Face" id="huggingface" cfg={cfg}>{tr("OpenAI-compatible router; the same token as in Pictures.")}</ProviderHead>
        <KeyField label="Token Hugging Face" name="hfToken" placeholder="hf_..." token {...keyProps}/>
        <label>{tr("Hugging Face models · separated by commas")}<input value={cfg.huggingFaceChatModel||""} onChange={e=>set({huggingFaceChatModel:e.target.value})}/></label>
        <ProviderHead name="OpenAI" id="openai" cfg={cfg}>{tr("Included, but blocked by cost protection by default.")}</ProviderHead>
        <KeyField label={tr("OpenAI API key")} name="openAiApiKey" placeholder="sk-..." {...keyProps}/>
        <label>{tr("OpenAI models · separated by commas")}<input value={cfg.openAiChatModels||""} onChange={e=>set({openAiChatModels:e.target.value})}/></label>
        <ProviderHead name="Grok (xAI)" id="xai" cfg={cfg}>{tr("Paid per use; the same key also makes Grok Imagine pictures and videos. Turn it on with «Also allow the paid APIs».")}</ProviderHead>
        <KeyField label={tr("xAI API key")} name="xaiApiKey" placeholder="xai-..." {...keyProps}/>
        <label>{tr("Grok models · separated by commas")}<input value={cfg.xaiModels||""} onChange={e=>set({xaiModels:e.target.value})} placeholder="grok-4.6,grok-4.3"/></label>
      </>}
      {tab==="images"&&cfg&&<><div className="settingsSectionTitle"><div className="settingsSectionIcon"><ImageIcon size={22}/></div><div><h3>{tr("Pictures")}</h3><p>{tr("Picture generation, APIs, models and trying another provider on its own.")}</p></div></div>
        <MediaMakers kind="image" cfg={cfg} set={set} paidOff={imageCost!=="allow_paid"||cfg.imageProviderMode==="free"}/>
        <label><span className="labelLine">{tr("Picture model")} <span className="optional">{tr("optional")}</span></span><input value={cfg.imageModel||""} onChange={e=>set({imageModel:e.target.value})} placeholder={tr("Automatic — the first picture model available")}/></label>
        <details className="mediaProviderSettings" open><summary>{tr("Picture providers")}</summary>
          <p className="settingsHelp">{tr("You can connect several services. {brand} tries the providers in order and moves to the next one if one fails.",{brand:BRAND_NAME})} {webServer?tr("The keys stay on the server and are only shown masked."):tr("The keys are encrypted on this PC.")}</p>
          <label>{tr("How to choose")}<select value={cfg.imageProviderMode||"auto"} onChange={e=>set({imageProviderMode:e.target.value})}><option value="auto">{tr("Automatic — my order")}</option><option value="fast">{tr("⚡ Fast")}</option><option value="quality">{tr("✨ Quality")}</option><option value="free">{tr("🛡️ Free only")}</option></select></label>
          <label>{tr("Cost protection")}<select value={imageCost} onChange={e=>set({imageCostPolicy:e.target.value})}><option value="free_only">{tr("Do not allow direct costs")}</option><option value="allow_paid">{tr("Allow paid providers")}</option></select></label>
          <p className="settingsHelp">{imageCost==="free_only"?tr("Protection on: {brand} tries Cloudflare and Pollinations directly. Hugging Face, Together, OpenAI, Stability, fal.ai and Replicate are blocked if they could use paid credit. For OpenRouter the price is checked before the call.",{brand:BRAND_NAME}):tr("Careful: the providers you set up can use credit at their own prices.")}</p>
          <label>{tr("Order to try")}<input value={cfg.imageProviderOrder||"cloudflare,pollinations,huggingface,together,openrouter,fal,replicate,stability,openai,gemini,xai"} onChange={e=>set({imageProviderOrder:e.target.value})}/></label>
          <div className="providerGroup"><b>Cloudflare Workers AI</b><small>{tr("FLUX.1 Schnell · the first provider in free mode.")}</small></div>
          <label>Cloudflare Account ID<input value={cfg.cloudflareAccountId||""} onChange={e=>set({cloudflareAccountId:e.target.value})} placeholder="Account ID"/></label>
          <KeyField label={tr("Cloudflare API token")} name="cloudflareApiToken" placeholder={tr("API token")} token {...keyProps}/>
          <div className="providerGroup"><b>Hugging Face</b><small>{tr("FLUX.1 Schnell through the HF Inference Router, only if cost protection allows it.")}</small></div>
          <KeyField label="Token Hugging Face" name="hfToken" placeholder="hf_..." token {...keyProps}/>
          <div className="providerGroup"><b>Together AI</b><small>{tr("FLUX.1 Schnell. Promotional credits can be limited.")}</small></div>
          <KeyField label={tr("Together API key")} name="togetherApiKey" placeholder={tr("API key")} {...keyProps}/>
          <div className="providerGroup"><b>OpenRouter</b><small>{tr("Several picture models with one key.")}</small></div>
          <KeyField label={tr("OpenRouter API key")} name="openRouterApiKey" placeholder="sk-or-..." {...keyProps}/>
          <label>{tr("OpenRouter picture model")}<input value={cfg.openRouterImageModel||"google/gemini-3.1-flash-image"} onChange={e=>set({openRouterImageModel:e.target.value})}/></label>
          <div className="providerGroup"><b>OpenAI</b><small>{tr("GPT Image through the OpenAI API.")}</small></div>
          <KeyField label={tr("OpenAI API key")} name="openAiApiKey" placeholder="sk-..." {...keyProps}/>
          <label>{tr("OpenAI picture model")}<input value={cfg.openAiImageModel||"gpt-image-1-mini"} onChange={e=>set({openAiImageModel:e.target.value})}/></label>
          <div className="providerGroup"><b>Google Gemini</b><small>{tr("«Nano Banana»; you choose the model above, under «Pictures made by». The same key as for AI APIs and Video.")}</small></div>
          <KeyField label={tr("Gemini API key")} name="geminiApiKey" placeholder="AIza..." {...keyProps}/>
          <div className="providerGroup"><b>Grok Imagine (xAI)</b><small>{tr("With the xAI key from AI APIs.")}</small></div>
          <label>{tr("Grok picture model")}<input value={cfg.xaiImageModel||"grok-imagine-image"} onChange={e=>set({xaiImageModel:e.target.value})}/></label>
          <div className="providerGroup"><b>Stability AI</b><small>Stable Image REST API.</small></div>
          <KeyField label={tr("Stability API key")} name="stabilityApiKey" placeholder="sk-..." {...keyProps}/>
          <label>{tr("Stability engine")}<select value={cfg.stabilityImageEngine||"core"} onChange={e=>set({stabilityImageEngine:e.target.value})}><option value="core">Core</option><option value="ultra">Ultra</option><option value="sd3">SD3</option></select></label>
          <div className="providerGroup"><b>fal.ai</b><small>{tr("Fast generation models through fal.run.")}</small></div>
          <KeyField label={tr("fal API key")} name="falApiKey" placeholder="FAL_KEY" {...keyProps}/>
          <label>{tr("fal.ai model")}<input value={cfg.falImageModel||"fal-ai/z-image/turbo"} onChange={e=>set({falImageModel:e.target.value})}/></label>
          <div className="providerGroup"><b>Replicate</b><small>{tr("Official and community models through the Predictions API.")}</small></div>
          <KeyField label={tr("Replicate API token")} name="replicateApiToken" placeholder="r8_..." token {...keyProps}/>
          <label>{tr("Replicate model")}<input value={cfg.replicateImageModel||"black-forest-labs/flux-schnell"} onChange={e=>set({replicateImageModel:e.target.value})}/></label>
          <div className="providerGroup"><b>Pollinations</b><small>{tr("Fallback media provider.")}</small></div>
          <KeyField label={tr("Pollinations API key")} name="pollinationsApiKey" placeholder="sk_..." {...keyProps}/>
          <label>{tr("Pollinations model")}<input value={cfg.pollinationsImageModel||"black-forest-labs/flux.1-schnell"} onChange={e=>set({pollinationsImageModel:e.target.value})}/></label>
        </details>
        <p className="settingsHelp">{tr("When you ask for a picture, {brand} tries the providers in the order set, puts the real file in the chat and saves it in the Library.",{brand:BRAND_NAME})}</p>
      </>}
      {tab==="video"&&cfg&&<><div className="settingsSectionTitle"><div className="settingsSectionIcon"><Play size={22}/></div><div><h3>{tr("Video")}</h3><p>{tr("Video generation, APIs, models and trying another provider on its own.")}</p></div></div>
        <MediaMakers kind="video" cfg={cfg} set={set} paidOff={cfg.videoCostPolicy!=="allow_paid"||cfg.videoMode==="free"}/>
        <label>{tr("Video mode")}<select value={cfg.videoMode||"fast"} onChange={e=>{const videoMode=e.target.value;const quality=videoMode==="quality";set({videoMode,videoModel:quality?"bytedance/seedance-2.5":"bytedance/seedance-2.0-fast",openRouterVideoModel:quality?"bytedance/seedance-2.5":"bytedance/seedance-2.0-fast",geminiVideoModel:quality?"veo-3.1-generate-preview":"veo-3.1-fast-generate-preview"})}}><option value="fast">{tr("⚡ Fast")}</option><option value="quality">{tr("🎬 Quality")}</option><option value="free">{tr("🛡️ Free only")}</option></select></label>
        <label>{tr("Cost protection")}<select value={cfg.videoCostPolicy||"free_only"} onChange={e=>set({videoCostPolicy:e.target.value})}><option value="free_only">{tr("Do not start paid jobs")}</option><option value="allow_paid">{tr("Allow paid providers")}</option></select></label>
        <p className="settingsHelp">{(cfg.videoCostPolicy||"free_only")==="free_only"?tr("{brand} checks the published price when there is one and does not start if it cannot confirm a zero cost. Gemini Veo, fal.ai and Replicate stay blocked in this mode.",{brand:BRAND_NAME}):tr("Careful: video generation can use credit fast. The cost depends on the model, length and resolution.")}</p>
        <label>{tr("Order to try")}<input value={cfg.videoProviderOrder||"pollinations,openrouter,gemini,fal,replicate,openai,xai"} onChange={e=>set({videoProviderOrder:e.target.value})}/></label>
        <div className="providerGroup"><b>Pollinations Video</b><small>{tr("The key is shared with Pictures.")}</small></div>
        <KeyField label={tr("Pollinations API key")} name="pollinationsApiKey" placeholder="sk_..." {...keyProps}/>
        <label>{tr("Pollinations video model")}<input value={cfg.pollinationsVideoModel||"google/veo-3.1-fast"} onChange={e=>set({pollinationsVideoModel:e.target.value})}/></label>
        <div className="providerGroup"><b>OpenRouter Video</b><small>{tr("Seedance, Veo, Wan and other models through the same API.")}</small></div>
        <KeyField label={tr("OpenRouter API key")} name="openRouterApiKey" placeholder="sk-or-..." {...keyProps}/>
        <label>{tr("OpenRouter video model")}<input value={cfg.openRouterVideoModel||(cfg.videoMode==="quality"?"bytedance/seedance-2.5":"bytedance/seedance-2.0-fast")} onChange={e=>set({openRouterVideoModel:e.target.value})}/></label>
        <div className="providerGroup"><b>Gemini · Veo</b><small>{tr("Veo with the same Gemini key used for chat; you choose the model above, under «Videos made by».")}</small></div>
        <KeyField label={tr("Gemini API key")} name="geminiApiKey" placeholder="AIza..." {...keyProps}/>
        <p className="settingsHelp">{tr("OpenAI (ChatGPT) no longer makes videos: Sora closed on 24 September 2026, both the app and the API. ChatGPT pictures still work.")}</p>
        <div className="providerGroup"><b>Grok Imagine Video (xAI)</b><small>{tr("With the xAI key from AI APIs; 1–15 seconds.")}</small></div>
        <label>{tr("Grok video model")}<input value={cfg.xaiVideoModel||"grok-imagine-video"} onChange={e=>set({xaiVideoModel:e.target.value})}/></label>
        <div className="providerGroup"><b>fal.ai Video</b><small>{tr("LTX Video. Can use the starting credits, then paid credit.")}</small></div>
        <KeyField label={tr("fal API key")} name="falApiKey" placeholder="FAL_KEY" {...keyProps}/>
        <label>{tr("fal video model")}<input value={cfg.falVideoModel||"fal-ai/ltx-video"} onChange={e=>set({falVideoModel:e.target.value})}/></label>
        <div className="providerGroup"><b>Replicate Video</b><small>{tr("Official video models through the Predictions API.")}</small></div>
        <KeyField label={tr("Replicate API token")} name="replicateApiToken" placeholder="r8_..." token {...keyProps}/>
        <label>{tr("Replicate video model")}<input value={cfg.replicateVideoModel||"wan-video/wan-2.2-t2v-fast"} onChange={e=>set({replicateVideoModel:e.target.value})}/></label>
        <p className="settingsHelp">{tr("When you ask for a video, {brand} tries the providers in order, downloads the real MP4 file, puts it in the chat and saves it in the Library.",{brand:BRAND_NAME})}</p>
      </>}
      {tab==="voice"&&cfg&&<><h3>{tr("Voice and microphone")}</h3>
        <label>{tr("Language for dictation, transcription and reading aloud")}<select value={cfg.speechLanguage||"ro"} onChange={e=>set({speechLanguage:e.target.value})}><option value="ro">Română</option><option value="en">English</option><option value="fr">Français</option></select></label>
        {machineSettingsAllowed&&<label>{tr("Transcription model")}<input value={cfg.speechModel||"openai/whisper-1"} onChange={e=>set({speechModel:e.target.value})}/></label>}
        <button type="button" className="secondary testMicBtn" onClick={testMic}><Mic size={16}/> {tr("Test the microphone")}</button>{micStatus&&<div className="micStatus" role="status">{micStatus}</div>}
        <p className="settingsHelp">{tr("Press the microphone once to start recording and again to stop. {brand} writes out what you said and sends it.",{brand:BRAND_NAME})}</p>
      </>}
      {tab==="notify"&&<NotifyTab account={account}>{webServer&&<PhoneNotifications/>}</NotifyTab>}
      {tab==="account"&&cfg&&<><h3>{tr("Owner on this PC")}</h3>
        <div className="accountSettingsCard"><div className="accountAvatar big">{(user?.name||user?.email||"S")[0].toUpperCase()}</div><div><b>{user?.name||tr("{brand} account",{brand:BRAND_NAME})}</b><span>{user?.email}{user?.role==="owner"?" · Owner":""}</span></div></div>
        <p className="settingsHelp">{IS_WEB?tr("Chats, memory, the library, designs, projects, apps and automations are kept on the {brand} server.",{brand:BRAND_NAME}):tr("Chats, memory, the library, designs, projects, apps and automations are kept on this computer.")}</p>
        {machineSettingsAllowed&&!webServer&&<>
          <label><span className="labelLine">{tr("Owner email on this PC")} <span className="optional">{tr("optional")}</span></span><input type="email" value={cfg.ownerEmail||""} onChange={e=>set({ownerEmail:e.target.value})} placeholder={tr("name@example.com")} autoComplete="off"/></label>
          <p className="settingsHelp">{tr("The local account with this email gets Owner rights: running code, GitHub Solve, checking the server. It applies only when {brand} Cloud is not set up. Sign in again after the change.",{brand:BRAND_SHORT})}</p>
        </>}
      </>}
      {error&&<div className="inlineError" role="alert">{error}</div>}
    </div></div>
    {onAccountTab?<div className="modalActions"><button className="secondary" onClick={onClose}>{tr("Close")}</button></div>
    :<div className="modalActions"><button className="secondary" onClick={onClose}>{tr("Cancel")}</button><button className="primary" onClick={save} disabled={saving}>{saving?tr("Saving…"):tr("Save settings")}</button></div>}
    </>}
  </div></div>;
}

function EntityModal({type,item,onClose,onSave,onDelete}) {
  const isEdit=!!item;
  const [name,setName]=useState(item?.name||""),[prompt,setPrompt]=useState(item?.systemPrompt||""),[instructions,setInstructions]=useState(item?.instructions||""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const mounted=useRef(true);
  useEffect(()=>()=>{mounted.current=false},[]);
  async function submit(e){
    e.preventDefault();
    if(!name.trim()||busy)return;
    setBusy(true);setError("");
    try{await onSave({name:name.trim(),systemPrompt:prompt.trim(),instructions:instructions.trim()})}
    catch(err){if(mounted.current){setError(err.message);setBusy(false)}}
  }
  async function remove(){
    if(busy)return;
    const label=type==="project"?`proiectul „${item.name}”? Conversațiile lui rămân, dar nu vor mai aparține niciunui proiect.`:`asistentul „${item.name}”?`;
    if(!confirm(`Ștergi ${label}`))return;
    setBusy(true);setError("");
    try{await onDelete()}catch(err){if(mounted.current){setError(err.message);setBusy(false)}}
  }
  const title=type==="project"?(isEdit?"Editează proiectul":"Proiect nou"):(isEdit?"Editează asistentul":"Asistent personalizat");
  return <Modal title={title} className="modal smallModal" onClose={onClose}>
    <form onSubmit={submit}>
      <label>Nume<input value={name} onChange={e=>setName(e.target.value)} placeholder={type==="project"?"Ex. Proiecte Primărie":"Ex. Profesor de matematică"} maxLength={200} autoFocus/></label>
      {type==="assistant"&&<label>Instrucțiuni pentru asistent<textarea className="promptArea" value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder="Cum vrei să lucreze acest asistent?"/></label>}
      {type==="project"&&<label><span className="labelLine">Instrucțiuni comune proiectului <span className="optional">opțional</span></span><textarea className="promptArea" value={instructions} onChange={e=>setInstructions(e.target.value)} placeholder="Ex. Folosește documentele proiectului, păstrează ton administrativ și reține deciziile importante."/></label>}
      {error&&<div className="inlineError" role="alert">{error}</div>}
      <div className="modalActions">{isEdit&&onDelete&&<button type="button" className="dangerButton pushLeft" onClick={remove} disabled={busy}><Trash2 size={15}/> Șterge</button>}<button type="button" className="secondary" onClick={onClose}>Anulează</button><button className="primary" disabled={!name.trim()||busy}>{busy?"Se salvează…":isEdit?"Salvează":"Creează"}</button></div>
    </form>
  </Modal>;
}

function GithubSolveModal({model,onClose,onBackup}) {
  const [path,setPath]=useState(""),[instruction,setInstruction]=useState("Analizează fișierul, identifică problema și corectează-l."),[busy,setBusy]=useState(""),[result,setResult]=useState(null),[error,setError]=useState("");
  const mounted=useRef(true);
  useEffect(()=>()=>{mounted.current=false},[]);
  async function solve(e){
    e.preventDefault();
    if(!path.trim()||busy)return;
    setBusy("solve");setError("");setResult(null);
    try{const d=await api("/api/github/solve",{method:"POST",body:JSON.stringify({path:path.trim(),instruction:instruction.trim(),model})});if(mounted.current)setResult(d.data||{})}
    catch(err){if(mounted.current)setError(err.message)}
    finally{if(mounted.current)setBusy("")}
  }
  async function copy(){const ok=await writeClipboardText(result?.proposal||"");toast(ok?"Propunerea a fost copiată în clipboard.":"Nu am putut copia propunerea.",ok?"ok":"error")}
  async function apply(){
    if(!result?.proposal||busy)return;
    if(!confirm(`Aplic modificarea direct în GitHub pentru ${result.path} (ramura ${result.branch||"implicită"})? Se creează un backup local pentru revenire.`))return;
    setBusy("apply");setError("");
    try{
      const a=await api("/api/github/apply",{method:"POST",body:JSON.stringify({path:result.path,content:result.proposal,sha:result.sha,branch:result.branch,message:`${BRAND_NAME}: rezolvare `+result.path})});
      if(a.data?.backupId)onBackup?.({id:a.data.backupId,path:a.data.path,branch:a.data.branch,commit:a.data.commit,createdAt:Date.now()});
      toast("Modificarea a fost aplicată în GitHub. Commit: "+(a.data?.commit||"creat"),"ok");
      onClose();
    }catch(err){if(mounted.current){setError(err.message);setBusy("")}}
  }
  const failedCheck=result?.check?.supported&&!result.check.ok;
  return <Modal title="GitHub Solve" subtitle={`${BRAND_NAME} citește fișierul din repository-ul configurat și propune o corectură.`} className="modal githubModal" onClose={onClose}>
    <form onSubmit={solve}>
      <label>Calea fișierului din repository<input value={path} onChange={e=>setPath(e.target.value)} placeholder="ex. apps/mobile/app/index.js" autoFocus/></label>
      <label>Ce trebuie rezolvat<textarea className="promptArea" value={instruction} onChange={e=>setInstruction(e.target.value)}/></label>
      {error&&<div className="inlineError" role="alert">{error}</div>}
      <div className="modalActions"><button type="button" className="secondary" onClick={onClose}>Închide</button><button className="primary" disabled={!path.trim()||!!busy}>{busy==="solve"?"Se analizează…":"Generează rezolvarea"}</button></div>
    </form>
    {result&&<div className="githubResult">
      <div className={cx("providerRow",failedCheck?"bad":"good")}>{failedCheck?<X size={15}/>:<Check size={15}/>}<span>{failedCheck?"Verificarea de sintaxă a găsit o eroare. Propunerea NU poate fi aplicată.":result.check?.supported?"Verificarea de sintaxă a trecut.":"Propunere generată (fără verificare de sintaxă pentru acest tip de fișier)."} · {result.path}{result.branch?` · ${result.branch}`:""}</span></div>
      {failedCheck&&<pre className="proposalPreview error">{String(result.check.stderr||result.check.stdout||"Verificare eșuată").slice(0,2500)}</pre>}
      <pre className="proposalPreview">{String(result.proposal||"").slice(0,20000)}</pre>
      <div className="modalActions"><button type="button" className="secondary" onClick={copy}><Copy size={15}/> Copiază</button><button type="button" className="primary" onClick={apply} disabled={failedCheck||!!busy}>{busy==="apply"?"Se aplică…":"Aplică în GitHub"}</button></div>
    </div>}
  </Modal>;
}

function App() {
  const [user,setUser]=useState(()=>storage.json(USER_KEY,null));
  const [permissions,setPermissions]=useState(()=>storage.json(PERMISSIONS_KEY,{})||{});
  const [boot,setBoot]=useState(true),[loadError,setLoadError]=useState(""),[authNotice,setAuthNotice]=useState("");
  const [conversations,setConversations]=useState([]),[projects,setProjects]=useState([]),[assistants,setAssistants]=useState([]);
  const [models,setModels]=useState(()=>cachedModels()),[modelPolicyEnforced,setModelPolicyEnforced]=useState(false),[refreshingModels,setRefreshingModels]=useState(false),[deniedModels,setDeniedModels]=useState(0),[lockedModels,setLockedModels]=useState([]),[modelsChecked,setModelsChecked]=useState(false);
  const [currentId,setCurrentId]=useState(null),[model,setModel]=useState(()=>storage.get(MANUAL_MODEL_KEY)||"");
  // The model Serasmart AI picked by itself (first in the list: your OmniRoute combination). Unlike a model you chose, it is
  // replaced as soon as a better one appears, so a direct API picked while OmniRoute was offline does not stay selected.
  const autoPickRef=useRef("");
  const [selectedProject,setSelectedProject]=useState(null),[selectedAssistant,setSelectedAssistant]=useState(null);
  const [draft,setDraft]=useState(""),[attachmentsState,setAttachments]=useState([]),[responseMode,setResponseModeState]=useState(()=>storage.get(RESPONSE_MODE_KEY,"rapid")==="thinking"?"thinking":"rapid"),[mediaModeState,setMediaMode]=useState(null);
  const [generations,setGenerations]=useState({});
  const [search,setSearch]=useState(""),[sidebar,setSidebar]=useState(false),[sidebarCollapsed,setSidebarCollapsed]=useState(()=>storage.get(SIDEBAR_COLLAPSED_KEY)==="1");
  const [omni,setOmni]=useState(false),[cloudConfigured,setCloudConfigured]=useState(null),[showJumpBottom,setShowJumpBottom]=useState(false);
  const [creditsDialog,setCreditsDialog]=useState(null);
  const [preferredModel,setPreferredModel]=useState("");const preferredModelRef=useRef("");
  const [settings,setSettings]=useState(false),[prefBusy,setPrefBusy]=useState(""),[entityModal,setEntityModal]=useState(null),[toolPanel,setToolPanel]=useState(null),[filesPanel,setFilesPanel]=useState(false),[githubModal,setGithubModal]=useState(false);
  useEffect(()=>{if(!user?.id)return;api("/api/me/settings").then(d=>{const m=String(d?.data?.preferredModel||"");preferredModelRef.current=m;setPreferredModel(m)}).catch(()=>{})},[user?.id,settings]);
  const [updateReady,setUpdateReady]=useState(false),[updateDismissed,setUpdateDismissed]=useState(false);
  const [lastGithubBackup,setLastGithubBackup]=useState(()=>storage.json(GITHUB_BACKUP_KEY,null));
  const [firstRunDismissed,setFirstRunDismissed]=useState(()=>storage.get(FIRST_RUN_KEY)==="1");
  const [mentionsVersion,setMentionsVersion]=useState(0);
  const chatRef=useRef(null),stickToBottomRef=useRef(true),controllersRef=useRef(new Map()),generationsRef=useRef({}),machineCfgRef=useRef(null);
  generationsRef.current=generations;
  const current=conversations.find(c=>c.id===currentId)||null;
  const isOwner=user?.role==="owner";
  const access=useMemo(()=>({can:key=>isOwner||permissions?.[key]!==false,deny:key=>toast(deniedMessage(key)),isOwner}),[isOwner,permissions]);
  const {can,deny}=access;
  const currentGen=currentId?generations[currentId]:null;
  const busy=!!currentGen;
  const machineSettingsAllowed=isOwner||cloudConfigured===false;
  const showFirstRun=!IS_WEB&&!!user&&!boot&&modelsChecked&&!firstRunDismissed&&!refreshingModels&&models.length===0&&omni!==true&&(isOwner||cloudConfigured===false);
  function finishFirstRun(){storage.set(FIRST_RUN_KEY,"1");setFirstRunDismissed(true)}
  function setResponseMode(m){setResponseModeState(m);storage.set(RESPONSE_MODE_KEY,m)}

  function setGen(id,patch){setGenerations(g=>{if(!g[id])return g;const prev=g[id];const next={...prev,...patch};if(patch.stage&&prev.steps.at(-1)!==patch.stage)next.steps=[...prev.steps,patch.stage].slice(-8);return {...g,[id]:next}})}
  function startGeneration(id){
    const map=controllersRef.current;
    try{map.get(id)?.abort("replaced")}catch{}
    const controller=new AbortController();map.set(id,controller);
    setGenerations(g=>({...g,[id]:{stage:"",steps:[]}}));
    return controller;
  }
  function finishGeneration(id,controller){
    const map=controllersRef.current;
    if(map.get(id)!==controller)return;
    map.delete(id);
    setGenerations(g=>{if(!g[id])return g;const n={...g};delete n[id];return n});
  }
  // Stop tells the server first (the answer otherwise keeps going in the background and is saved), then stops here.
  function stopGeneration(){
    const c=controllersRef.current.get(currentId);if(!c||c.signal.aborted)return;
    if(c.requestId)api("/api/chat/cancel",{method:"POST",body:JSON.stringify({id:c.requestId})}).catch(()=>{});
    c.abort("user-stop");
  }
  function abortAll(reason){for(const c of controllersRef.current.values()){try{c.abort(reason)}catch{}}controllersRef.current.clear();setGenerations({})}
  function showConversation(conv){setConversations(v=>v.map(x=>x.id===conv.id?conv:x))}
  // Credits (0.7.22): after an answer, the warning at 25 / 50 / 75 / 90 / 100% of the week (shown once); at 100%, or when
  // a model is not in the plan, the "buy credits or wait" message.
  const creditsOnRef=useRef(true);
  async function checkCreditNotice(){
    if(!creditsOnRef.current)return;
    try{
      const d=await api("/api/credits");
      if(!d.enabled||d.unlimited){creditsOnRef.current=false;return}
      if(d.notice?.message)toast(d.notice.message,d.notice.level>=90?"error":"info");
    }catch{}
  }
  function creditProblem(e){
    if(!e?.code||!["credits_exhausted","free_limit","plan_required","plan_upgrade"].includes(e.code))return false;
    setCreditsDialog({code:e.code,message:e.message,credits:e.credits||{}});
    return true;
  }
  const upsertMessage=(list,msg)=>{const a=Array.isArray(list)?list:[];const i=a.findIndex(m=>m?.id===msg.id);return i>=0?a.map((m,k)=>k===i?{...m,...msg}:m):[...a,msg]};
  // An answer, picture or video that kept going on the server while the app was closed, minimised or in the background:
  // shown while it grows, then replaced by the conversation the server saved.
  async function followJob(convId,jobId){
    if(!convId||!jobId||controllersRef.current.get(convId))return;
    const controller=startGeneration(convId);controller.requestId=jobId;
    setGen(convId,{stage:"Răspunsul continuă pe server…"});
    let lastText="";
    try{
      while(!controller.signal.aborted){
        let j=null;
        try{j=(await api(`/api/chat/jobs/${jobId}`,{signal:controller.signal}))?.data||null}
        catch(e){if(controller.signal.aborted)break;if(e.status!==404)throw e}
        if(!j)break;
        if(j.kind==="chat"&&j.text){
          lastText=j.text;
          setGen(convId,{stage:"Scrie răspunsul…"});
          setConversations(v=>v.map(c=>c.id!==convId?c:{...c,messages:upsertMessage(c.messages,{id:jobId,role:"assistant",content:j.text,routeInfo:j.routeInfo||undefined,streaming:j.status==="running",createdAt:j.startedAt})}));
        }
        if(j.status!=="running")break;
        await new Promise(r=>setTimeout(r,1500));
      }
      const cs=await api("/api/conversations");
      const fresh=(cs.data||[]).find(c=>c.id===convId);
      if(!fresh)return;
      if(controller.signal.reason==="user-stop"){
        const conv={...fresh,messages:upsertMessage(fresh.messages,{id:jobId,role:"assistant",content:lastText,streaming:false,stopped:true,createdAt:Date.now()})};
        showConversation(conv);await saveConversation(conv);
      }else showConversation(fresh);
    }catch{}finally{finishGeneration(convId,controller)}
  }
  async function resumeServerJobs(){
    try{const d=await api("/api/chat/jobs");for(const j of d.data||[])if(j.status==="running")followJob(j.conversationId,j.id);}catch{}
  }

  async function refreshModels({silent=false}={}){
    if(!silent)setRefreshingModels(true);
    try{
      const ms=await api("/api/models");
      const live=uniqueModels((ms.manualModels||ms.data||[]).map(x=>typeof x==="string"?x:x?.id));
      if(Array.isArray(ms.combos)){COMBO_IDS=new Set(ms.combos.map(String));storage.set(COMBO_CACHE_KEY,JSON.stringify([...COMBO_IDS]));}
      const enforced=ms.policyEnforced===true;
      // The list is the one just received: a model that left OmniRoute (or never chatted) leaves the picker too. The
      // remembered list fills in only while OmniRoute does not answer.
      const merged=enforced||!ms.omniUnavailable?live:uniqueModels([...live,...cachedModels()]);
      setModelPolicyEnforced(enforced);setDeniedModels(enforced?Number(ms.deniedCount)||0:0);setModels(merged);
      setLockedModels(Array.isArray(ms.locked)?ms.locked.filter(x=>x&&typeof x.id==="string"&&!merged.includes(x.id)).map(x=>({id:x.id,reason:String(x.reason||"")})):[]);storage.set(MODEL_CACHE_KEY,JSON.stringify(merged));
      setModel(prev=>{
        const chosen=[prev&&prev!==autoPickRef.current?prev:"",storage.get(MANUAL_MODEL_KEY),machineCfgRef.current?.model];
        const pick=chosen.find(x=>x&&merged.includes(x))||merged[0]||"";
        autoPickRef.current=chosen.includes(pick)?"":pick;
        if(pick)storage.set(MODEL_SELECTED_KEY,pick);else storage.remove(MODEL_SELECTED_KEY);
        return pick;
      });
      return merged;
    }catch(e){
      if(!silent&&!isAuthLost(e.status,e.message))toast("Nu am putut actualiza lista de modele: "+e.message);
      return models;
    }finally{if(!silent)setRefreshingModels(false);setModelsChecked(true)}
  }
  async function chooseModel(next){
    const value=String(next||"").trim();if(!value)return;
    if(modelPolicyEnforced&&!models.includes(value))return;
    setModel(value);storage.set(MANUAL_MODEL_KEY,value);storage.set(MODEL_SELECTED_KEY,value);
    if(current){
      const id=current.id;
      setConversations(v=>v.map(x=>x.id===id?{...x,model:value}:x));
      patchConversation(id,{model:value}).catch(e=>toast("Modelul nu a putut fi salvat pentru conversație: "+e.message));
    }
  }
  // A file renamed in the Library or the viewer keeps its new name in the conversations on screen too.
  useEffect(()=>{
    const renamed=e=>{const {id,name}=e.detail||{};if(!id||!name)return;
      const fix=a=>a&&(a.libraryId===id||a.id===id)?{...a,name}:a;
      setConversations(cs=>cs.map(c=>(c.messages||[]).some(m=>m.attachments?.some(a=>a&&(a.libraryId===id||a.id===id)))?{...c,messages:c.messages.map(m=>m.attachments?{...m,attachments:m.attachments.map(fix)}:m)}:c));};
    window.addEventListener("serasmart:file-renamed",renamed);
    return()=>window.removeEventListener("serasmart:file-renamed",renamed);
  },[]);
  async function loadData({initial=false}={}){
    if(!storage.get(TOKEN_KEY)){setBoot(false);return}
    setLoadError("");
    try{
      const [me,cs,ps,as]=await Promise.all([api("/auth/me"),api("/api/conversations"),api("/api/projects"),api("/api/assistants")]);
      if(me.token)storage.set(TOKEN_KEY,me.token);
      if(me.user){setUser(me.user);storage.set(USER_KEY,JSON.stringify(me.user))}
      const perms=me.permissions&&typeof me.permissions==="object"?me.permissions:{};
      setPermissions(perms);storage.set(PERMISSIONS_KEY,JSON.stringify(perms));
      const convs=cs.data||[],projectList=ps.data||[],assistantList=as.data||[];
      const live=new Set(Object.keys(generationsRef.current));
      setConversations(local=>convs.map(c=>live.has(c.id)?(local.find(x=>x.id===c.id)||c):c));
      setProjects(projectList);setAssistants(assistantList);
      setSelectedProject(v=>v&&projectList.some(p=>p.id===v)?v:null);
      setSelectedAssistant(v=>v&&assistantList.some(a=>a.id===v)?v:(assistantList.find(a=>a.builtIn)?.id||assistantList[0]?.id||null));
      setCurrentId(v=>v&&convs.some(c=>c.id===v)?v:(initial?(convs.find(c=>!c.archived)?.id||null):null));
      // Answers still being written on the server (the app was closed or in the background) appear and keep growing.
      resumeServerJobs();
    }catch(e){if(!isAuthLost(e.status,e.message))setLoadError(e.message)}
    finally{setBoot(false)}
    refreshModels({silent:true});
  }
  function logout({notice="",skipServer=false}={}){
    const token=storage.get(TOKEN_KEY);
    if(token&&!skipServer)fetch(`${GATEWAY}/auth/logout`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:"{}"}).catch(()=>{});
    abortAll("logout");
    try{window.speechSynthesis?.cancel()}catch{}
    ACCOUNT_KEYS.forEach(k=>storage.remove(k));
    setUser(null);setPermissions({});setConversations([]);setProjects([]);setAssistants([]);setCurrentId(null);setSelectedProject(null);setSelectedAssistant(null);
    setModels([]);setModel("");setModelPolicyEnforced(false);setModelsChecked(false);
    setDraft("");setAttachments([]);setMediaMode(null);setSearch("");setSidebar(false);
    setSettings(false);setEntityModal(null);setToolPanel(null);setFilesPanel(false);setGithubModal(false);setLastGithubBackup(null);setLoadError("");
    setAuthNotice(notice);
  }
  useEffect(()=>{
    setAuthLostHandler(message=>{
      const text=String(message||"").trim();
      const notice=/așteaptă aprobarea|asteapta aprobarea|nu este activ/i.test(text)?text:/^(Autentificare necesară|Sesiune)/i.test(text)||!text?"Sesiunea ta a expirat sau a fost închisă. Autentifică-te din nou.":`${text.replace(/[.!]?$/,".")} Autentifică-te din nou.`;
      logout({skipServer:true,notice});
    });
    return()=>setAuthLostHandler(null);
  });
  useEffect(()=>{
    let active=true;
    (async()=>{
      try{
        const cfg=await window.Serasmart?.getConfig?.();
        if(cfg&&active){
          machineCfgRef.current=cfg;
          if(cleanGatewayUrl(cfg.gatewayUrl))setGatewayUrl(cfg.gatewayUrl);
          DICTATION_LANG=String(cfg.speechLanguage||"ro");
          setCloudConfigured(!!String(cfg.controlApiUrl||"").trim());
        }
      }catch{}
      if(active)await loadData({initial:true});
    })();
    return()=>{active=false};
  },[user?.id]);
  useEffect(()=>{
    const off=window.Serasmart?.onUpdateReady?.(()=>setUpdateReady(true));
    return()=>{if(typeof off==="function")off()};
  },[]);
  // Back from the background (phone unlocked, window restored): pick up the answers the server kept writing.
  useEffect(()=>{
    if(!user?.id)return;
    const onVisible=()=>{if(!document.hidden)resumeServerJobs()};
    document.addEventListener("visibilitychange",onVisible);
    window.addEventListener("focus",onVisible);
    return()=>{document.removeEventListener("visibilitychange",onVisible);window.removeEventListener("focus",onVisible)};
  },[user?.id]);
  // 0.7.18: the results of the automations (and the other notices of the account) arrive while the app is open; each
  // is shown once and marked as read. Without Serasmart Cloud the list is empty.
  useEffect(()=>{
    if(!user?.id||!cloudConfigured)return;
    let stopped=false;
    async function checkNotices(){
      if(document.hidden)return;
      try{
        const d=await api("/api/notifications");if(stopped)return;
        for(const n of (d?.data||[]).filter(x=>!x.read_at&&x.type==="automation").slice(0,3).reverse()){
          toast(`${n.title}: ${String(n.body||"").slice(0,180)}`,"info");
          api(`/api/notifications/${encodeURIComponent(n.id)}/read`,{method:"PATCH",body:"{}"}).catch(()=>{});
        }
      }catch{}
    }
    checkNotices();
    const id=setInterval(checkNotices,60000);
    return()=>{stopped=true;clearInterval(id)};
  },[user?.id,cloudConfigured]);
  useEffect(()=>{
    let stopped=false;
    async function poll(){
      if(document.hidden)return;
      try{const r=await fetch(`${GATEWAY}/health`,{signal:AbortSignal.timeout(7000)});const h=await r.json();if(stopped)return;setOmni(h.omni?true:h.omniNeedsKey?"key":false);setCloudConfigured(!!h.cloudConfigured)}
      catch{if(!stopped)setOmni(false)}
    }
    poll();
    const id=setInterval(poll,8000);
    const onVisible=()=>{if(!document.hidden)poll()};
    document.addEventListener("visibilitychange",onVisible);
    return()=>{stopped=true;clearInterval(id);document.removeEventListener("visibilitychange",onVisible)};
  },[]);
  function updateChatScrollState(){
    const el=chatRef.current;if(!el)return;
    const nearBottom=el.scrollHeight-el.scrollTop-el.clientHeight<120;
    stickToBottomRef.current=nearBottom;
    setShowJumpBottom(!nearBottom);
  }
  function jumpToLatest({smooth=true}={}){
    const el=chatRef.current;if(!el)return;
    stickToBottomRef.current=true;
    setShowJumpBottom(false);
    el.scrollTo({top:el.scrollHeight,behavior:smooth?"smooth":"auto"});
  }
  const lastMessage=current?.messages?.at(-1);
  useEffect(()=>{
    const id=setTimeout(()=>{if(stickToBottomRef.current)jumpToLatest({smooth:false});else updateChatScrollState()},30);
    return()=>clearTimeout(id);
  },[current?.messages?.length,busy,lastMessage?.content,currentGen?.stage]);
  useEffect(()=>{
    stickToBottomRef.current=true;
    setShowJumpBottom(false);
    try{window.speechSynthesis?.cancel()}catch{}
    const id=setTimeout(()=>jumpToLatest({smooth:false}),40);
    return()=>clearTimeout(id);
  },[currentId]);
  useEffect(()=>{
    if(current?.model&&(!modelPolicyEnforced||models.includes(current.model))){setModel(current.model);return;}
    if(!current){
      const manual=storage.get(MANUAL_MODEL_KEY);
      // 0.7.23: without a model picked by hand, new conversations start on the one chosen in Setări → Profil.
      const preferred=preferredModelRef.current;
      if(manual&&(!modelPolicyEnforced||models.includes(manual)))setModel(manual);
      else if(preferred&&models.includes(preferred))setModel(preferred);
    }
  },[currentId,modelPolicyEnforced,models.join("|"),preferredModel]);

  async function saveConversation(conv){
    const body=JSON.stringify({title:conv.title,projectId:conv.projectId??null,assistantId:conv.assistantId??null,model:conv.model??null,messages:conv.messages||[]});
    if(conv.id){
      const d=await api(`/api/conversations/${conv.id}`,{method:"PUT",body});
      const saved=d.data||conv;
      setConversations(v=>v.map(x=>x.id===conv.id?saved:x));
      return saved;
    }
    const d=await api("/api/conversations",{method:"POST",body});
    const saved=d.data;
    setConversations(v=>[saved,...v.filter(x=>x.id!==saved.id)]);
    setCurrentId(v=>v===null?saved.id:v);
    return saved;
  }
  async function patchConversation(id,patch){
    const d=await api(`/api/conversations/${id}`,{method:"PUT",body:JSON.stringify(patch)});
    if(d?.data)setConversations(v=>v.map(x=>x.id===id?{...x,...Object.fromEntries(Object.keys(patch).map(k=>[k,d.data[k]])),updatedAt:d.data.updatedAt||x.updatedAt}:x));
    return d?.data;
  }
  async function streamAssistant(baseConv,messages,{extra={},format=null}={}){
    const convId=baseConv.id;
    const lastUser=[...messages].reverse().find(m=>m.role==="user");
    const desiredModel=String(baseConv.model||model||"").trim();
    // A conversation keeps the model it was made with; when that model has left the list (OmniRoute no longer has it, or it
    // was never a chat model) the one chosen in the picker answers instead of an error.
    const effectiveModel=modelPolicyEnforced||models.length?(models.includes(desiredModel)?desiredModel:(models.includes(model)?model:(models[0]||""))):desiredModel;
    const controller=startGeneration(convId);
    let answer="",routeInfo=null,started=false,streamError="",flushTimer=null,resume=false;
    const assistantMessage={id:uid(),role:"assistant",content:"",createdAt:Date.now(),streaming:true};
    controller.requestId=assistantMessage.id;
    let working={...baseConv,model:effectiveModel||baseConv.model||model,messages:[...messages,assistantMessage],updatedAt:Date.now()};
    const flush=()=>{flushTimer=null;showConversation(working)};
    const scheduleFlush=()=>{if(!flushTimer)flushTimer=setTimeout(flush,40)};
    showConversation(working);
    setGen(convId,{stage:"Analizează cererea…"});
    try{
      if(!effectiveModel&&!isOwner&&cloudConfigured)throw new Error("Nu există niciun model AI permis pentru acest cont. Cere Owner-ului acces la un model.");
      const payload=toProviderMessages(messages,extra);
      if(!payload.some(m=>m.role==="user"))throw new Error("Mesajul este gol.");
      setGen(convId,{stage:"Verifică memoria, fișierele și contextul relevant…"});
      const r=await fetch(`${GATEWAY}/api/chat/stream`,{method:"POST",headers:authHeaders({"Content-Type":"application/json"}),body:JSON.stringify({model:effectiveModel,requestId:assistantMessage.id,conversationId:baseConv.id||null,assistantId:baseConv.assistantId||null,projectId:baseConv.projectId||null,responseMode,messages:payload}),signal:controller.signal});
      if(!r.ok){const text=await r.text().catch(()=>"");throw apiError(r.status,text,"/api/chat/stream")}
      setGen(convId,{stage:"Așteaptă răspunsul AI-ului ales…"});
      const handleLine=line=>{
        if(!line.startsWith("data:"))return;
        const raw=line.slice(5).trim();if(!raw||raw==="[DONE]")return;
        let j;try{j=JSON.parse(raw)}catch{return}
        if(j?.error){streamError=String(j.error?.message||j.error);return}
        if(j?.serasmart_route){
          routeInfo=j.serasmart_route;
          setGen(convId,{stage:`A ales ${providerLabel(routeInfo.provider,routeInfo.model)} · ${routeInfo.model}…`});
          working={...working,messages:[...messages,{...assistantMessage,routeInfo,content:answer,streaming:true}]};scheduleFlush();
          return;
        }
        // An OmniRoute combination ("Ai principal") answers with one of its members: show which one really answered.
        if(routeInfo?.model&&!routeInfo.servedBy&&typeof j?.model==="string"&&j.model&&!j.model.includes(String(routeInfo.model).split("/").pop()))routeInfo={...routeInfo,servedBy:j.model};
        const delta=j?.choices?.[0]?.delta?.content||j?.choices?.[0]?.message?.content||"";
        if(delta){
          if(!started){started=true;setGen(convId,{stage:format?`Scrie conținutul pentru fișierul ${format.toUpperCase()}…`:"Scrie răspunsul…"})}
          answer+=delta;working={...working,messages:[...messages,{...assistantMessage,routeInfo,content:answer,streaming:true}]};scheduleFlush();
        }
      };
      const reader=r.body.getReader(),dec=new TextDecoder();let buf="";
      while(true){
        const {value,done}=await reader.read();if(done)break;
        buf+=dec.decode(value,{stream:true});
        const events=buf.split(/\r?\n\r?\n/);buf=events.pop()||"";
        for(const ev of events)for(const line of ev.split(/\r?\n/))handleLine(line);
      }
      buf+=dec.decode();
      for(const line of buf.split(/\r?\n/))handleLine(line);
      if(streamError&&!answer)throw new Error(streamError);
      let note=streamError?`\n\n_Răspunsul a fost întrerupt: ${streamError}_`:"",files=[];
      if(format&&!splitQuestions(answer,false)){
        if(!can("document_generation"))note+=`\n\n_${deniedMessage("document_generation")}_`;
        else{
          setGen(convId,{stage:`Creează fișierul ${format.toUpperCase()}…`});
          try{
            const previousAssistant=[...messages].reverse().find(m=>m.role==="assistant"&&!m.error&&!m.mediaKind);
            const previousSource=previousAssistant?(previousAssistant.artifactSource||messageText(previousAssistant)):"";
            const content=standaloneExportRequest(messageText(lastUser))&&previousSource?previousSource:answer;
            if(!String(content||"").trim())throw new Error("nu există conținut pentru fișier");
            const exported=await api("/api/export",{method:"POST",body:JSON.stringify({format,title:safeFileTitle(working.title||`${BRAND_NAME} - fișier`),content})});
            if(exported?.data){
              files=[exported.data];
              // The file the user asked for is downloaded right away; the card under the answer stays for later.
              downloadGeneratedFile(exported.data).catch(()=>{});
            }
          }catch(err){note+=`\n\n_Fișierul ${format.toUpperCase()} nu a putut fi creat: ${err.message}. Poți încerca din nou cu butoanele de sub răspuns._`}
        }
      }
      clearTimeout(flushTimer);
      working={...working,messages:[...messages,{...assistantMessage,routeInfo,content:(answer||"Nu am primit răspuns.")+note,attachments:files,streaming:false}],updatedAt:Date.now()};
      showConversation(working);
      const saved=await saveConversation(working);
      api("/api/memory/capture",{method:"POST",body:JSON.stringify({conversationId:saved.id,userText:messageText(lastUser),assistantText:answer})}).catch(()=>{});
      checkCreditNotice();
    }catch(e){
      clearTimeout(flushTimer);
      const reason=controller.signal.reason;
      if(reason==="deleted"||reason==="logout"||reason==="replaced")return;
      const aborted=controller.signal.aborted||e?.name==="AbortError";
      // The connection broke (phone locked, app in the background, network change) but the server kept working.
      if(controller.signal.reason!=="user-stop"){
        try{const j=(await api(`/api/chat/jobs/${assistantMessage.id}`))?.data;if(j&&j.status!=="error"){resume=true;return}}catch{}
      }
      if(!aborted)creditProblem(e);
      const finalMessage=aborted
        ?{...assistantMessage,routeInfo,content:answer,streaming:false,stopped:true}
        :{...assistantMessage,routeInfo,content:`Eroare: ${friendlyError(e.message)}`,streaming:false,error:true};
      working={...working,messages:[...messages,finalMessage],updatedAt:Date.now()};
      showConversation(working);
      if(storage.get(TOKEN_KEY)){try{await saveConversation(working)}catch(saveError){if(!isAuthLost(saveError.status,saveError.message))toast("Conversația nu a putut fi salvată: "+saveError.message)}}
    }finally{finishGeneration(convId,controller)}
    if(resume)followJob(convId,assistantMessage.id);
  }
  // A picture or video (asked for in the chat or with the Poză / Video button) is made by the company of the chosen
  // model (Gemini, ChatGPT, Grok); with a combination or a model that cannot make pictures, by Setări → Poze / Video.
  async function generateMediaAssistant(baseConv,messages,kind,prompt){
    const convId=baseConv.id;
    const controller=startGeneration(convId);
    setGen(convId,{stage:kind==="video"?"Generează videoclipul… poate dura câteva minute":"Creează imaginea și pregătește fișierul…"});
    const base={id:uid(),role:"assistant",createdAt:Date.now(),streaming:false,mediaKind:kind,mediaPrompt:prompt};
    controller.requestId=base.id;
    let resume=false;
    try{
      let message;
      try{
        const d=await api(kind==="video"?"/api/generate/video":"/api/generate/image",{method:"POST",body:JSON.stringify({prompt,via:baseConv.model||model||"",maker:savedMaker(kind)||"auto",requestId:base.id,conversationId:convId}),signal:controller.signal});
        const file={...d.data,type:d.data?.kind||kind,kind:d.data?.kind||kind};
        message={...base,content:d.data?.note||"",attachments:[file],routeInfo:{task:kind==="video"?"video_generation":"image_generation",model:file.model||"",provider:inferModelProvider(file.model||"")}};
        checkCreditNotice();
      }catch(e){
        const reason=controller.signal.reason;
        if(reason==="deleted"||reason==="logout"||reason==="replaced")return;
        if(reason!=="user-stop"){try{const j=(await api(`/api/chat/jobs/${base.id}`))?.data;if(j&&j.status!=="error"){resume=true;return}}catch{}}
        if(!controller.signal.aborted)creditProblem(e);
        message=controller.signal.aborted
          ?{...base,content:"",stopped:true}
          :{...base,content:`Generarea ${kind==="video"?"videoclipului":"imaginii"} nu a reușit: ${friendlyError(e.message)}`,mediaGenerationError:true,...(kind==="video"&&/Setări\s*→\s*Video|nevoie de o cheie/i.test(e.message)?{needsVideoSetup:true}:{})};
      }
      const conv={...baseConv,messages:[...messages,message],updatedAt:Date.now()};
      showConversation(conv);
      if(!storage.get(TOKEN_KEY))return;
      try{
        const saved=await saveConversation(conv);
        if(!message.mediaGenerationError&&!message.stopped)api("/api/memory/capture",{method:"POST",body:JSON.stringify({conversationId:saved.id,userText:prompt,assistantText:`${kind==="video"?"Videoclip":"Imagine"} generată: ${message.attachments?.[0]?.name||""}`})}).catch(()=>{});
      }catch(err){if(!isAuthLost(err.status,err.message))toast("Conversația nu a putut fi salvată: "+err.message)}
    }finally{finishGeneration(convId,controller)}
    if(resume)followJob(convId,base.id);
  }
  async function send(answerText){
    const answer=typeof answerText==="string";
    const text=answer?answerText.trim():draft.trim();
    const attachments=answer?[]:attachmentsState,mediaMode=answer?null:mediaModeState;
    const usable=attachments.filter(a=>a.part||a.parts?.length);
    if(!text&&!usable.length)return;
    if(currentId&&generations[currentId])return;
    const media=mediaMode||(!answer&&attachments.length===0?requestedMediaGeneration(text):null);
    if(media){
      const perm=media==="video"?"video_generation":"image_generation";
      if(!can(perm)){deny(perm);return}
      if(!text){toast(media==="video"?"Descrie videoclipul pe care vrei să-l creez.":"Descrie imaginea pe care vrei s-o creez.","info");return}
    }
    const format=media?null:answer?answerFormat(text,current?.messages||[]):requestedDocumentFormat(text);
    const userId=uid();
    const parts=[...(text?[{type:"text",text}]:[]),...usable.flatMap(a=>Array.isArray(a.parts)&&a.parts.length?a.parts:[a.part].filter(Boolean))];
    const content=parts.length===1&&parts[0].type==="text"?parts[0].text:parts;
    const transient=usable.flatMap(a=>a.transientParts||[]);
    const extra=transient.length?{[userId]:transient}:{};
    const userMsg={id:userId,role:"user",content,displayText:text||`Fișier atașat: ${attachments.map(a=>a.name).join(", ")}`,attachments:attachments.map(a=>({name:a.name,type:a.type,mime:a.mime||"",size:a.size||0,libraryId:a.libraryId||null,transcript:a.transcript||""})),createdAt:Date.now()};
    const base=current?{...current}:{title:titleFrom(text||attachments[0]?.name),projectId:selectedProject,assistantId:selectedAssistant,model,messages:[]};
    const conv={...base,title:base.messages?.length?base.title:titleFrom(text||attachments[0]?.name),model,messages:[...(base.messages||[]),userMsg],updatedAt:Date.now()};
    const previous={draft,attachments,mediaMode};
    if(!answer){setDraft("");setAttachments([]);setMediaMode(null);}
    let saved;
    try{saved=await saveConversation(conv)}
    catch(e){if(!answer){setDraft(previous.draft);setAttachments(previous.attachments);setMediaMode(previous.mediaMode)}if(!isAuthLost(e.status,e.message))toast("Mesajul nu a putut fi trimis: "+e.message);return}
    if(base.archived)patchConversation(saved.id,{archived:false}).catch(()=>{});
    if(media)await generateMediaAssistant(saved,saved.messages||conv.messages,media,text);
    else await streamAssistant(saved,saved.messages||conv.messages,{extra,format});
  }
  async function regenerate(index,needsConfirm){
    if(!current||generations[current.id])return;
    if(needsConfirm&&!confirm("Regenerarea înlocuiește acest răspuns și șterge mesajele de după el. Continui?"))return;
    const target=current.messages[index];
    const msgs=current.messages.slice(0,index);
    const lastUser=[...msgs].reverse().find(m=>m.role==="user");
    if(!lastUser){toast("Nu există un mesaj de la tine pentru acest răspuns.");return}
    if(target?.mediaKind){const perm=target.mediaKind==="video"?"video_generation":"image_generation";if(!can(perm)){deny(perm);return}}
    let saved;
    try{saved=await saveConversation({...current,messages:msgs})}catch(e){toast(e.message);return}
    if(target?.mediaKind)await generateMediaAssistant(saved,saved.messages||msgs,target.mediaKind,target.mediaPrompt||messageText(lastUser));
    else await streamAssistant(saved,saved.messages||msgs,{format:requestedDocumentFormat(messageText(lastUser))});
  }
  async function rate(index,value){
    if(!current||generations[current.id])return;
    const msgs=current.messages.map((m,i)=>i===index?{...m,rating:m.rating===value?0:value}:m);
    try{await saveConversation({...current,messages:msgs})}catch(e){toast(e.message)}
  }
  async function saveEntity(data){
    const {type,item}=entityModal||{};
    if(type==="project"){
      if(item){const d=await api(`/api/projects/${item.id}`,{method:"PATCH",body:JSON.stringify({name:data.name,instructions:data.instructions})});setProjects(v=>v.map(p=>p.id===item.id?(d.data||{...p,name:data.name,instructions:data.instructions}):p))}
      else{const d=await api("/api/projects",{method:"POST",body:JSON.stringify({name:data.name,instructions:data.instructions})});setProjects(v=>[d.data,...v]);setSelectedProject(d.data.id)}
    }else{
      if(item){const d=await api(`/api/assistants/${item.id}`,{method:"PATCH",body:JSON.stringify({name:data.name,systemPrompt:data.systemPrompt})});setAssistants(v=>v.map(a=>a.id===item.id?(d.data||{...a,name:data.name,systemPrompt:data.systemPrompt}):a))}
      else{const d=await api("/api/assistants",{method:"POST",body:JSON.stringify({name:data.name,systemPrompt:data.systemPrompt})});setAssistants(v=>[...v,d.data]);startWithAssistant(d.data.id)}
    }
    setEntityModal(null);
  }
  async function deleteEntity(){
    const {type,item}=entityModal||{};if(!item)return;
    if(type==="project"){
      await api(`/api/projects/${item.id}`,{method:"DELETE"});
      setProjects(v=>v.filter(p=>p.id!==item.id));
      setConversations(v=>v.map(c=>c.projectId===item.id?{...c,projectId:null}:c));
      setSelectedProject(v=>v===item.id?null:v);
    }else{
      await api(`/api/assistants/${item.id}`,{method:"DELETE"});
      const fallback=assistants.find(a=>a.builtIn&&a.id!==item.id)?.id||null;
      setAssistants(v=>v.filter(a=>a.id!==item.id));
      setSelectedAssistant(v=>v===item.id?fallback:v);
    }
    setEntityModal(null);
  }
  async function share(){if(!current)return;const ok=await writeClipboardText(current.messages.map(m=>`${m.role==="user"?"Eu":`${BRAND_NAME}`}:\n${messageText(m)}`).join("\n\n"));toast(ok?"Conversația a fost copiată în clipboard.":"Nu am putut copia conversația în clipboard.",ok?"ok":"error")}
  function saveGithubBackup(backup){storage.set(GITHUB_BACKUP_KEY,JSON.stringify(backup));setLastGithubBackup(backup)}
  async function githubRollback(){
    const last=lastGithubBackup;
    if(!last?.id){toast("Nu există un backup GitHub recent.","info");return;}
    if(!confirm(`Revii la versiunea anterioară pentru ${last.path}?`))return;
    try{
      const d=await api(`/api/github/rollback/${last.id}`,{method:"POST",body:"{}"});
      storage.remove(GITHUB_BACKUP_KEY);setLastGithubBackup(null);
      toast("Revenire GitHub efectuată. Commit: "+(d.data?.commit||"creat"),"ok");
    }catch(e){toast("Revenire GitHub: "+e.message)}
  }
  function openTool(name,filter){
    if(name==="automations"&&!can("automations")){deny("automations");return}
    if(name==="design"&&!can("document_generation")){deny("document_generation");return}
    if(name==="plugins"&&!can("plugins")){deny("plugins");return}
    if(name==="admin"&&!isOwner)return;
    if(name==="code"&&!can("code")){deny("code");return}
    setSidebar(false);setToolPanel({name,filter});
  }
  function closeTool(){
    if(toolPanel?.name==="plugins"||toolPanel?.name==="automations")setMentionsVersion(v=>v+1);
    setToolPanel(null);
  }
  function attachFromLibrary(a){setAttachments(v=>[...v,a])}
  async function updatePreferences(patch){
    const before=user?.preferences||{};
    const apply=prefs=>setUser(u=>{if(!u)return u;const next={...u,preferences:{...(u.preferences||{}),...prefs}};storage.set(USER_KEY,JSON.stringify(next));return next});
    setPrefBusy(Object.keys(patch)[0]||"");apply(patch);
    try{
      let d;
      try{d=await api("/api/me/preferences",{method:"PATCH",body:JSON.stringify(patch)})}
      catch(e){
        if(e.status!==404||!("memoryEnabled" in patch))throw e;
        const t=await api("/api/memory/toggle",{method:"POST",body:JSON.stringify({enabled:patch.memoryEnabled})});
        d={data:{preferences:{memoryEnabled:t.enabled!==false}}};
      }
      if(d?.data?.preferences)apply(d.data.preferences);
      return true;
    }catch(e){apply(before);toast("Setarea nu a putut fi salvată: "+e.message);return false}
    finally{setPrefBusy("")}
  }
  async function moveCurrent(projectId){if(!current)return;try{await patchConversation(current.id,{projectId});setSelectedProject(projectId)}catch(e){toast(e.message)}}
  async function archiveConversation(id){
    try{await patchConversation(id,{archived:true});if(currentId===id)setCurrentId(null);toast("Conversația a fost arhivată. O găsești în secțiunea „Arhivate” din bara laterală.","info")}
    catch(e){toast(e.message)}
  }
  async function unarchiveConversation(id){try{await patchConversation(id,{archived:false});toast("Conversația a fost restaurată.","ok")}catch(e){toast(e.message)}}
  async function deleteConversation(id){
    const conv=conversations.find(x=>x.id===id);if(!conv)return;
    if(!confirm(`Ștergi definitiv conversația „${conv.title||"Conversație"}”?`))return;
    const controller=controllersRef.current.get(id);
    if(controller){try{controller.abort("deleted")}catch{}}
    try{await api(`/api/conversations/${id}`,{method:"DELETE"});setConversations(v=>v.filter(x=>x.id!==id));if(currentId===id)setCurrentId(null)}
    catch(e){toast("Ștergere: "+e.message)}
  }
  function toggleMenu(){
    if(window.innerWidth<=900){setSidebar(v=>!v);return;}
    setSidebarCollapsed(v=>{storage.set(SIDEBAR_COLLAPSED_KEY,v?"0":"1");return !v});
  }
  function focusComposer(){setTimeout(()=>document.querySelector(".composerLine textarea")?.focus(),0)}
  function newConversation(){setCurrentId(null);setDraft("");setAttachments([]);setMediaMode(null);setSidebar(false);focusComposer()}
  // Code Serasmart AI: the new Code conversation opens with its code model chosen.
  function startCode(conv,assistant){
    if(!conv?.id)return;
    if(assistant)setAssistants(v=>v.some(a=>a.id===assistant.id)?v:[...v,assistant]);
    setConversations(v=>[conv,...v.filter(x=>x.id!==conv.id)]);
    if(conv.model){setModel(conv.model);storage.set(MANUAL_MODEL_KEY,conv.model);storage.set(MODEL_SELECTED_KEY,conv.model);}
    setCurrentId(conv.id);setDraft("");setMediaMode(null);setToolPanel(null);setSidebar(false);focusComposer();
  }
  function startWithAssistant(id){setSelectedAssistant(id);setCurrentId(null);setDraft("");setMediaMode(null);setToolPanel(null);setSidebar(false);focusComposer()}
  function startImageMode(){
    if(!can("image_generation")){deny("image_generation");return}
    setCurrentId(null);setDraft("");setMediaMode("image");setToolPanel(null);focusComposer();
  }
  function onAuth(nextUser,perms){setAuthNotice("");setPermissions(perms||{});setUser(nextUser)}
  function resetGatewayAndReload(){
    setGatewayUrl(DEFAULT_GATEWAY);
    Promise.resolve(window.Serasmart?.setConfig?.({gatewayUrl:DEFAULT_GATEWAY})).catch(()=>{});
    loadData();
  }

  if(boot)return <div className="loadingScreen"><BrandMark/><span>Se pornește {BRAND_NAME}…</span></div>;
  if(!user)return <AuthScreen onAuth={onAuth} notice={authNotice}/>;
  const hasMessages=!!current?.messages?.length;
  const activeAssistantId=current?current.assistantId:selectedAssistant;
  return <AccessContext.Provider value={access}><div className={cx("appShell",sidebarCollapsed&&"sidebarCollapsed")}>
    <Sidebar open={sidebar} setOpen={setSidebar} user={user} search={search} setSearch={setSearch} projects={projects} assistants={assistants} conversations={conversations} currentId={currentId} busyIds={Object.keys(generations)} onSelect={id=>{setCurrentId(id);setSidebar(false)}} onDeleteConversation={deleteConversation} onUnarchive={unarchiveConversation} onNew={newConversation} selectedProject={selectedProject} setSelectedProject={setSelectedProject} activeAssistantId={activeAssistantId} onUseAssistant={startWithAssistant} onNewProject={()=>setEntityModal({type:"project",item:null})} onNewAssistant={()=>setEntityModal({type:"assistant",item:null})} onEditProject={p=>setEntityModal({type:"project",item:p})} onEditAssistant={a=>setEntityModal({type:"assistant",item:a})} onTool={name=>openTool(name)} onSettings={()=>setSettings(true)} onLogout={()=>logout()}/>
    {sidebar&&<div className="mobileScrim" onClick={()=>setSidebar(false)}/>}
    <main className="mainArea">
      <Header deniedCount={deniedModels} lockedModels={lockedModels} onMenu={toggleMenu} model={model} onSelectModel={chooseModel} models={models} onRefreshModels={()=>refreshModels()} refreshingModels={refreshingModels} policyEnforced={modelPolicyEnforced} omni={omni} showOmni={machineSettingsAllowed} onShare={share} current={current} projects={projects} onDetach={()=>moveCurrent(null)} onMoveProject={moveCurrent} onFiles={()=>setFilesPanel(true)} onGitHub={()=>setGithubModal(true)} onGitHubRollback={githubRollback} hasGitHubBackup={!!lastGithubBackup} onArchive={()=>current&&archiveConversation(current.id)} onUnarchive={()=>current&&unarchiveConversation(current.id)} onDelete={()=>current&&deleteConversation(current.id)}/>
      <InstallApp banner/>
      {loadError&&<div className="loadErrorBanner" role="alert"><span>Nu am putut încărca datele: {loadError}</span><button onClick={()=>loadData()}>Reîncearcă</button>{GATEWAY!==DEFAULT_GATEWAY&&<button onClick={resetGatewayAndReload}>Folosește serviciul local implicit</button>}</div>}
      {updateReady&&!updateDismissed&&<div className="updateBanner" role="status"><button className="updateInstall" onClick={()=>window.Serasmart?.installUpdate?.()}>Actualizare {BRAND_NAME} disponibilă — instalează acum</button><button className="updateClose" onClick={()=>setUpdateDismissed(true)} aria-label="Ascunde notificarea" title="Mai târziu"><X size={14}/></button></div>}
      <div className="chatScroll" ref={chatRef} onScroll={updateChatScrollState}><ConversationView user={user} onPick={(text,mode)=>{if(mode)setMediaMode(mode);else{setMediaMode(null);setDraft(text)}}} conversation={current} busy={busy} busyStage={currentGen?.stage} busySteps={currentGen?.steps||[]} onRegenerate={regenerate} onRate={rate} canRunCode={isOwner} onCodeResult={text=>setDraft(v=>(v?v+"\n\n":"")+text)} onAnswer={text=>send(text)} onOpenSettings={tab=>setSettings(tab||true)}/></div>
      {showJumpBottom&&hasMessages&&<button className="jumpToLatest" onClick={()=>jumpToLatest({smooth:true})} title={tr("Go to the latest message")} aria-label={tr("Go to the latest message")}><ChevronDown size={19}/><span>{tr("Latest message")}</span></button>}
      <Composer centered={!hasMessages} draft={draft} setDraft={setDraft} onSend={send} onStop={stopGeneration} busy={busy} attachments={attachmentsState} setAttachments={setAttachments} onOpenLibrary={()=>openTool("library","all")} responseMode={responseMode} setResponseMode={setResponseMode} mediaMode={mediaModeState} setMediaMode={setMediaMode} mentionsVersion={mentionsVersion} mediaPolicy={{imagePaid:machineCfgRef.current?.imageCostPolicy==="allow_paid"}}/>
    </main>
    {settings&&<SettingsModal user={user} models={models} onDataDeleted={()=>loadData()} onAccountDeleted={()=>{setSettings(false);logout({skipServer:true,notice:"Contul a fost șters."})}} initialTab={typeof settings==="string"?settings:"general"} preferences={user?.preferences} onPreferences={updatePreferences} prefBusy={prefBusy} machineSettingsAllowed={machineSettingsAllowed} onClose={()=>setSettings(false)} onSaved={cfg=>{machineCfgRef.current={...(machineCfgRef.current||{}),...cfg};setCloudConfigured(!!String(cfg?.controlApiUrl||"").trim());Promise.resolve(window.Serasmart?.ensureOmni?.()).catch(()=>{});setTimeout(()=>loadData(),800)}}/>}
    {entityModal&&<EntityModal type={entityModal.type} item={entityModal.item} onClose={()=>setEntityModal(null)} onSave={saveEntity} onDelete={entityModal.item&&!entityModal.item.builtIn?deleteEntity:null}/>}
    {toolPanel?.name==="explore"&&<ExplorePanel onClose={closeTool} assistants={assistants} onUseAssistant={startWithAssistant} onImageMode={startImageMode} onOpenLibrary={filter=>openTool("library",filter)}/>}
    {toolPanel?.name==="library"&&<LibraryPage onClose={closeTool} onAttach={attachFromLibrary} toAttachment={libraryItemToAttachment} initialFilter={toolPanel.filter||"all"} onOpenDesign={id=>openTool("design",id)}/>}
    {toolPanel?.name==="design"&&can("document_generation")&&<DesignPage onClose={closeTool} model={model} models={models} initialId={toolPanel.filter||null}/>}
    {toolPanel?.name==="skills"&&<SkillsPage onClose={closeTool}/>}
    {toolPanel?.name==="usage"&&<UsagePage onClose={closeTool}/>}
    {creditsDialog&&<CreditsDialog info={creditsDialog} onClose={()=>setCreditsDialog(null)} onBuy={()=>{setCreditsDialog(null);openTool("usage")}}/>}
    {toolPanel?.name==="memory"&&<MemoryPage onClose={closeTool} preferences={user?.preferences} onPreferences={updatePreferences} prefBusy={prefBusy}/>}
    {toolPanel?.name==="admin"&&isOwner&&<AdminPanel onClose={closeTool}/>}
    {toolPanel?.name==="plugins"&&can("plugins")&&<PluginsPage onClose={closeTool}/>}
    {toolPanel?.name==="code"&&can("code")&&<CodePage onClose={closeTool} onStart={startCode}/>}
    {toolPanel?.name==="automations"&&can("automations")&&<ScheduledPage onClose={closeTool} model={model} models={models}/>}
    {filesPanel&&<ConversationFilesPanel conversation={current} onClose={()=>setFilesPanel(false)}/>}
    {githubModal&&isOwner&&<GithubSolveModal model={model} onClose={()=>setGithubModal(false)} onBackup={saveGithubBackup}/>}
    {showFirstRun&&<FirstRunGuide onOpenSettings={()=>{finishFirstRun();setSettings(true)}} onDone={ok=>{finishFirstRun();if(ok)refreshModels()}}/>}
  </div></AccessContext.Provider>;
}
document.title=BRAND_NAME;
createRoot(document.getElementById("root")).render(<ErrorBoundary><App/><AccessRequestDialog/></ErrorBoundary>);
