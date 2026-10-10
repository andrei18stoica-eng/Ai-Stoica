import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Menu, Plus, Search, Folder, Bot, Settings, LogOut, Share2, MoreHorizontal,
  Paperclip, Mic, ArrowUp, Copy, ThumbsUp, ThumbsDown, RotateCcw, X,
  ChevronDown, User, Check, Wifi, WifiOff, Sparkles, SquarePen, Square,
  CalendarClock, Plug, Library, Brain, Upload, Trash2, Play, Pin, PinOff,
  FileText, Image as ImageIcon, HardDrive, ToggleLeft, ToggleRight,
  Compass, Map as MapIcon, Globe2, Archive, ArchiveRestore, ExternalLink, SlidersHorizontal, Volume2,
  PanelTopOpen, ShieldCheck, UserCheck, Download, Lock, Pencil, Palette, Clapperboard, Eye, Maximize2, LoaderCircle, SquareTerminal
} from "lucide-react";
import "./styles.css";
import {
  DEFAULT_GATEWAY, TOKEN_KEY, USER_KEY, PERMISSIONS_KEY, MODEL_CACHE_KEY, MODEL_SELECTED_KEY, MANUAL_MODEL_KEY, RESPONSE_MODE_KEY, GITHUB_BACKUP_KEY,
  FIRST_RUN_KEY, SIDEBAR_COLLAPSED_KEY, ACCOUNT_KEYS, storage, cleanGatewayUrl, GATEWAY, setGatewayUrl, toast, isAuthLost, apiError, authHeaders, api,
  deniedMessage, AccessContext, useAccess, uploadFileToLibrary, formatBytes, plural, cx, uid, writeClipboardText, openLink, downloadGeneratedFile,
  downloadLibraryFile, fmtTime, mediaKind, kindLabel, fetchLibraryBlob, modalStack, useModal, useDismiss, ToolShell, Modal, Markdown, useAuthedBlobUrl,
  isHttpUrl, setAuthLostHandler, IS_WEB
} from "./core.jsx";
import { InstallApp } from "./install.jsx";
import { FileViewer, canView } from "./viewer.jsx";
import { ServerUpdate } from "./serverUpdate.jsx";
import { ScheduledPage } from "./pages/Scheduled.jsx";
import { CodePage } from "./pages/Code.jsx";
import { requestedMediaGeneration } from "./mediaIntent.mjs";
import { normalizeIntent, FILE_FORMATS, FORMAT_CANDIDATES, requestedDocumentFormat } from "./documentIntent.mjs";
import { PluginsPage } from "./pages/Plugins.jsx";
import { MemoryPage, PreferenceSwitches } from "./pages/Memory.jsx";
import { LibraryPage } from "./pages/Library.jsx";
import { DesignPage } from "./pages/Design.jsx";
import { splitQuestions, QuestionCard, QuestionsPending } from "./questions.jsx";

let DICTATION_LANG = "ro";
const SPEECH_LOCALES = {ro:"ro-RO",en:"en-US",fr:"fr-FR"};
function speechLocale(){return SPEECH_LOCALES[DICTATION_LANG]||"ro-RO";}


class ErrorBoundary extends React.Component {
  constructor(props){super(props);this.state={error:null};}
  static getDerivedStateFromError(error){return {error};}
  componentDidCatch(error,info){console.error("AI Stoica renderer error",error,info);}
  render(){
    if(this.state.error){
      return <div className="crashScreen">
        <div>
          <h1>AI Stoica a întâmpinat o problemă</h1>
          <p>Fereastra nu a putut afișa această parte a aplicației. Apasă „Reîncarcă”. Dacă problema reapare, copiază detaliile de mai jos și trimite-le administratorului aplicației.</p>
          <pre>{String(this.state.error?.stack||this.state.error?.message||this.state.error)}</pre>
          <button className="primary" onClick={()=>location.reload()}>Reîncarcă AI Stoica</button>
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
  return <div className="routeBadge" title={info.servedBy?`Ai ales ${info.model}; OmniRoute a trimis întrebarea la ${info.servedBy}.`:"AI Stoica a folosit "+provider+" · "+info.model}>
    <Sparkles size={12}/><span><b>{info.servedBy&&/\//.test(info.servedBy)?providerLabel("",info.servedBy):provider}</b><em>{info.model}{served}</em></span><small>{routeTaskLabel(info.task)}</small>
  </div>;
}
function friendlyError(raw){
  const msg=String(raw||"Eroare necunoscută.").trim();
  let friendly="";
  if(/HTTP 429|rate.?limit|quota|too many requests/i.test(msg))friendly="Limita gratuită a providerului AI a fost atinsă. Alege alt model sau încearcă din nou mai târziu.";
  else if(/HTTP 40[13]\b|invalid.{0,12}api.?key|unauthorized|incorrect api key/i.test(msg))friendly="Cheia API a providerului este greșită sau nu are acces la acest model.";
  else if(/timeout|timed out|TimeoutError/i.test(msg))friendly="Providerul AI nu a răspuns la timp. Încearcă din nou.";
  else if(/failed to fetch|networkerror|load failed/i.test(msg))friendly="Nu pot contacta serviciul AI Stoica. Verifică dacă aplicația rulează și conexiunea la internet.";
  else if(/^Niciun model selectat de AI Stoica nu a putut răspunde/i.test(msg))friendly="Niciun AI configurat nu a putut răspunde acum. Verifică modelul ales sau cheile API.";
  if(!friendly)return msg;
  return `${friendly}\n\n_Detalii tehnice: ${msg.slice(0,600)}_`;
}

function safeFileTitle(value){return String(value||"AI Stoica").replace(/[\\/:*?"<>|]+/g," ").replace(/\s+/g," ").trim().slice(0,90)||"AI Stoica";}
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
  if (days <= 0) return "Azi";
  if (days === 1) return "Ieri";
  if (days <= 7) return "Ultimele 7 zile";
  if (days <= 30) return "Ultimele 30 de zile";
  return "Mai vechi";
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
    if(Number(d.size||0)<=20*1024*1024)return {...base,type:"image",part:{type:"image_url",image_url:{url:`aistoica-library://${d.id}`}}};
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
  return {...base,type:"stored",part:{type:"text",text:`Fișier atașat: ${d.name} (${formatBytes(d.size)}). Este salvat în Biblioteca AI Stoica, dar ${why}.`}};
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

function AuthScreen({ onAuth, notice:initialNotice="" }) {
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
      const data = await api(mode==="login"?"/auth/login":"/auth/register",{method:"POST",body:JSON.stringify(mode==="login"?{email,password}:{name,email,password})});
      if(data?.status==="pending"&&!data?.token){
        setNotice(data.message||"Contul a fost creat și așteaptă aprobarea Owner-ului.");
        setMode("login"); setPassword(""); return;
      }
      if(!data?.token||!data?.user) throw new Error("Serverul nu a returnat o sesiune validă.");
      storage.set(TOKEN_KEY,data.token); storage.set(USER_KEY,JSON.stringify(data.user)); storage.set(PERMISSIONS_KEY,JSON.stringify(data.permissions||{}));
      onAuth(data.user,data.permissions||{});
    } catch(e2){ setError(e2.message); if(/failed to fetch|networkerror|load failed/i.test(e2.message))setNetworkIssue(true); } finally { setBusy(false); }
  }
  function resetGateway(){setGatewayUrl(DEFAULT_GATEWAY);Promise.resolve(window.AIStoica?.setConfig?.({gatewayUrl:DEFAULT_GATEWAY})).catch(()=>{});setNetworkIssue(false);setError("");setNotice("Am revenit la serviciul local implicit. Încearcă din nou autentificarea.");}
  return <div className="authShell"><div className="authGlow"/>
    <div className="authBrand"><img src="./stoica-enterprises-ai-768.webp" alt="Stoica Enterprises AI"/><h1>AI Stoica</h1><p>Stoica Enterprises AI</p>
      <div className="authFeature"><Sparkles size={17}/> Chat AI profesional, memorie, fișiere, design și sarcini programate.</div>
      <div className="authFeature"><Wifi size={17}/> Conectare prin OmniRoute sau prin API-uri directe.</div>
      <div className="authFeature"><User size={17}/> {cloud?"Cont personal cu aprobare Owner.":"Cont personal protejat cu parolă."}</div>
    </div>
    <form className="authCard" onSubmit={submit}>
      <div className="authTabs" role="tablist"><button type="button" role="tab" aria-selected={mode==="login"} className={mode==="login"?"active":""} onClick={()=>{setMode("login");setError("");}}>Autentificare</button><button type="button" role="tab" aria-selected={mode==="register"} className={mode==="register"?"active":""} onClick={()=>{setMode("register");setError("");setNotice("");}}>Creează cont</button></div>
      <h2>{mode==="login"?"Bine ai revenit":"Creează contul AI Stoica"}</h2>
      <p className="muted">{mode==="register"?(cloud?"Conturile noi trebuie aprobate de Owner înainte de prima utilizare.":IS_WEB?"Contul se creează pe serverul AI Stoica.":"Contul se creează pe acest calculator și îl poți folosi imediat."):"Folosește emailul contului tău AI Stoica."}</p>
      {mode==="register"&&<label>Nume<input value={name} onChange={e=>setName(e.target.value)} placeholder="Numele tău" autoComplete="name"/></label>}
      <label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="nume@email.ro" required autoComplete="email"/></label>
      <label>Parolă<input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder={mode==="register"?"Minimum 10 caractere":"Parola contului"} required minLength={mode==="register"?10:undefined} autoComplete={mode==="register"?"new-password":"current-password"}/></label>
      {notice&&<div className="authNotice" role="status"><UserCheck size={17}/><span>{notice}</span></div>}
      {error&&<div className="authError" role="alert">{error}</div>}
      {networkIssue&&GATEWAY!==DEFAULT_GATEWAY&&<button type="button" className="secondary wideBtn" onClick={resetGateway}>Folosește serviciul local implicit</button>}
      <button className="primaryWide" disabled={busy}>{busy?"Se procesează…":mode==="login"?"Intră în AI Stoica":(cloud?"Trimite cererea de acces":"Creează contul")}</button>
      <div className="localNote">{cloud?"Owner-ul controlează aprobarea conturilor și permisiunile serviciilor AI.":IS_WEB?"Conturile și conversațiile sunt păstrate pe serverul AI Stoica.":"Conturile și conversațiile sunt păstrate pe acest calculator."}</div>
      <InstallApp/>
    </form>
  </div>;
}

function BrandMark({small=false}) { return <div className={cx("brandMark",small&&"small")}><img src="./stoica-enterprises-ai-mark.webp" alt="AI Stoica"/></div>; }

const TOOL_ITEMS=[["explore",Compass,"Explorează",null],["code",SquareTerminal,"Code AI Stoica","code"],["automations",CalendarClock,"Scheduled","automations"],["plugins",Plug,"Pluginuri","plugins"],["library",Library,"Bibliotecă",null],["design",Palette,"Design","document_generation"],["memory",Brain,"Memorie",null]];
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
  return <aside className={cx("sidebar",open&&"open")} aria-label="Navigare">
    <div className="sideTop"><div className="brandLine"><BrandMark small/><div><b>AI Stoica</b><span>Enterprises AI</span></div></div><button className="iconOnly mobileClose" onClick={()=>setOpen(false)} aria-label="Închide meniul" title="Închide meniul"><X size={20}/></button></div>
    <button className="newChat" onClick={onNew}><SquarePen size={17}/> Conversație nouă</button>
    <div className="searchBox"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>{if(e.key==="Escape"&&search){e.preventDefault();setSearch("")}}} placeholder="Caută în conversații" aria-label="Caută în conversații"/>{search&&<button className="searchClear" onClick={()=>setSearch("")} title="Șterge căutarea" aria-label="Șterge căutarea"><X size={14}/></button>}</div>
    <div className="sideScroll">
      <div className="sideSection"><div className="sectionHead"><span>Instrumente</span></div>
        {TOOL_ITEMS.filter(([name])=>name!=="code"||can("code")).map(([name,Icon,label,perm])=>{const locked=perm&&!can(perm);return <button key={name} className={cx("sideItem",name==="explore"?"exploreItem":"toolItem",locked&&"locked")} onClick={()=>onTool(name)} title={locked?deniedMessage(perm):label}><Icon size={16}/> {label}{locked&&<Lock size={13} className="lockIcon"/>}</button>})}
        {isOwner&&<button className="sideItem ownerItem" onClick={()=>onTool("admin")}><ShieldCheck size={16}/> Control Center</button>}
      </div>
      <div className="sideSection"><div className="sectionHead"><span>Proiecte</span><button onClick={onNewProject} aria-label="Proiect nou" title="Proiect nou"><Plus size={15}/></button></div>
        <button className={cx("sideItem",selectedProject===null&&"active")} onClick={()=>setSelectedProject(null)}><Folder size={16}/> Toate conversațiile</button>
        {projects.map(p=><div key={p.id} className={cx("sideRow",selectedProject===p.id&&"active")}><button className={cx("sideItem",selectedProject===p.id&&"active")} onClick={()=>setSelectedProject(p.id)} title={p.name}><Folder size={16}/><span className="sideLabel">{p.name}</span></button><button className="sideEdit" onClick={()=>onEditProject(p)} aria-label={`Editează proiectul ${p.name}`} title="Editează proiectul"><Pencil size={13}/></button></div>)}
      </div>
      <div className="sideSection"><div className="sectionHead"><span>Asistenți</span><button onClick={onNewAssistant} aria-label="Asistent nou" title="Asistent nou"><Plus size={15}/></button></div>
        {assistants.map(a=><div key={a.id} className={cx("sideRow",activeAssistantId===a.id&&"active")}><button className={cx("sideItem",activeAssistantId===a.id&&"active")} onClick={()=>onUseAssistant(a.id)} title={`Conversație nouă cu ${a.name}`}><Bot size={16}/><span className="sideLabel">{a.name}</span></button>{!a.builtIn&&<button className="sideEdit" onClick={()=>onEditAssistant(a)} aria-label={`Editează asistentul ${a.name}`} title="Editează asistentul"><Pencil size={13}/></button>}</div>)}
        {!assistants.length&&<div className="sideEmpty">Nu ai asistenți personalizați.</div>}
      </div>
      <div className="sideSection historySection">
        <div className="sectionHead"><span>{searchQuery?"Rezultate căutare":"Conversații"}</span>{searchQuery&&<small>{searchResults.length}</small>}</div>
        {searchQuery?<>
          {currentId&&<button className="currentConversationReturn" onClick={()=>{onSelect(currentId);setSearch("")}}><RotateCcw size={15}/><span><b>Conversația curentă</b><small>Revino la conversația în care erai</small></span></button>}
          <div className="conversationSearchResults">
            {searchResults.map(({conversation:c,snippet})=><button key={c.id} className={cx("conversationSearchResult",currentId===c.id&&"current")} onClick={()=>{onSelect(c.id);setSearch("")}}>
              <div className="conversationSearchHead"><b>{c.title||"Conversație"}</b>{currentId===c.id?<span>Curentă</span>:c.archived?<span>Arhivată</span>:null}</div>
              {snippet&&<p>{snippet}</p>}
              <small><Search size={12}/> Deschide conversația</small>
            </button>)}
            {!searchResults.length&&<div className="searchNoResults"><Search size={18}/><span>Nu am găsit textul în conversațiile tale.</span></div>}
          </div>
        </>:<>
          {groups.map(([g,items])=><div key={g} className="historyGroup"><div className="historyLabel">{g}</div>{items.map(c=><div className={cx("historyRow",currentId===c.id&&"active")} key={c.id}><button className="historyItem" onClick={()=>onSelect(c.id)} title={c.title}>{busySet.has(c.id)&&<span className="historyBusy" aria-label="Răspuns în curs"/>}{c.title||"Conversație"}</button><button className="historyDelete" title="Șterge conversația" aria-label={`Șterge conversația ${c.title||""}`} onClick={e=>{e.stopPropagation();onDeleteConversation(c.id)}}><Trash2 size={14}/></button></div>)}</div>)}
          {!groups.length&&<div className="sideEmpty">{selectedProject?"Nicio conversație în acest proiect. Scrie un mesaj pentru a începe una.":anyVisible?"Nu există conversații de afișat.":"Nu ai încă nicio conversație."}</div>}
          {archived.length>0&&<div className="archivedBlock">
            <button className="archivedToggle" onClick={()=>setShowArchived(v=>!v)} aria-expanded={showArchived}><Archive size={14}/> Arhivate ({archived.length}) <ChevronDown size={14} className={showArchived?"open":""}/></button>
            {showArchived&&archived.map(c=><div className={cx("historyRow archivedRow",currentId===c.id&&"active")} key={c.id}><button className="historyItem" onClick={()=>onSelect(c.id)} title={c.title}>{c.title||"Conversație"}</button><button className="historyDelete" title="Restaurează conversația" aria-label={`Restaurează conversația ${c.title||""}`} onClick={e=>{e.stopPropagation();onUnarchive(c.id)}}><ArchiveRestore size={14}/></button></div>)}
          </div>}
        </>}
      </div>
    </div>
    <div className="accountArea"><div className="accountBadge"><div className="accountAvatar">{(user?.name||user?.email||"S")[0].toUpperCase()}</div><div className="accountText"><b>{user?.name||"Cont Stoica"}</b><span>{user?.email}{user?.role==="owner"?" · Owner":""}</span></div></div><div className="accountButtons"><button onClick={onSettings}><Settings size={17}/> Setări</button><button onClick={onLogout}><LogOut size={17}/> Deconectare</button></div></div>
  </aside>;
}

const MODEL_PROVIDERS=[["cerebras","Cerebras"],["groq","Groq"],["gemini","Gemini"],["mistral","Mistral"],["nvidia","NVIDIA"],["github","GitHub Models"],["openrouter","OpenRouter"],["cloudflare","Cloudflare Workers AI"],["cohere","Cohere"],["huggingface","Hugging Face"],["openai","OpenAI"]];
// Combinations (names without "provider/") first, then one group per direct provider, then the rest of OmniRoute.
const COMBO_CACHE_KEY="aiStoicaComboModelsV1";
let COMBO_IDS=new Set(storage.json(COMBO_CACHE_KEY,[])||[]);
function groupModels(list){
  const groups=new Map();
  const add=(key,name,x,opts)=>{if(!groups.has(key))groups.set(key,{name,items:[],...opts});groups.get(key).items.push(x)};
  for(const x of list){
    const id=String(x||"");
    if(COMBO_IDS.has(id)||!id.includes("/")){add("combo","Combinații OmniRoute",id,{combo:true,short:v=>v});continue;}
    const prefix=id.split("/")[0].toLowerCase(),known=MODEL_PROVIDERS.find(([k])=>k===prefix);
    if(known)add(known[0],known[1],id,{short:v=>v.slice(prefix.length+1)});
    else add("omni","Alte modele OmniRoute",id,{short:v=>v});
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
  const notAllowed=x=>toast(`«${x}» nu îți este permis de Owner.${lockedMap.get(x)?" "+lockedMap.get(x):""} Cere-i acces sau alege alt model.`);
  function onListKey(e){
    if(e.key!=="ArrowDown"&&e.key!=="ArrowUp")return;
    const items=[...(listRef.current?.querySelectorAll(".modelOption")||[])];if(!items.length)return;
    e.preventDefault();const i=items.indexOf(document.activeElement);
    const next=e.key==="ArrowDown"?items[Math.min(items.length-1,i+1)]:items[Math.max(0,i-1)];next?.focus();
  }
  return <div className="modelSelectCluster" ref={ref}>
    <div className="modelPicker">
      <button className={cx("modelPickerButton",open&&"open")} onClick={()=>setOpen(v=>!v)} aria-haspopup="listbox" aria-expanded={open} aria-label={`Model AI: ${model||"neales"}`}>
        <span className="modelPickerDot"/>
        <span className="modelPickerText"><b>{model||"Alege AI"}</b><small>{list.length?plural(list.length,"model disponibil","modele disponibile"):"Niciun model disponibil"}{lockedMap.size?` · ${lockedMap.size} nepermise`:policyEnforced?" · stabilite de Owner":""}</small></span>
        <ChevronDown size={15}/>
      </button>
    {open&&<div className="modelPickerMenu" onKeyDown={onListKey}>
      <div className="modelPickerHead"><div><b>Alege AI-ul</b><span>Schimbarea se aplică acestei conversații.</span></div><button className="modelRefresh" onClick={async e=>{e.stopPropagation();await onRefresh?.()}} disabled={refreshing} title="Actualizează lista de modele" aria-label="Actualizează lista de modele"><RotateCcw size={14} className={refreshing?"spin":""}/></button></div>
      {all.length>7&&<div className="modelSearch"><Search size={14}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Caută model" aria-label="Caută model"/></div>}
      <div className="modelPickerList" role="listbox" ref={listRef}>
        {groupModels(filtered).map(g=><div className="modelGroup" key={g.name} role="group" aria-label={g.name}>
          <div className="modelGroupName">{g.name}</div>
          {g.items.map(x=>lockedMap.has(x)?<button key={x} className="modelOption locked" onClick={()=>notAllowed(x)} role="option" aria-selected={false} aria-disabled="true" title={lockedMap.get(x)||"Nepermis de Owner"}>
            <span className="modelOptionIcon"><Lock size={15}/></span>
            <span className="modelOptionCopy"><b>{g.short(x)}</b><small>Nepermis de Owner</small></span>
          </button>:<button key={x} className={cx("modelOption",x===model&&"active")} onClick={()=>{onSelect(x);setOpen(false)}} role="option" aria-selected={x===model}>
            <span className="modelOptionIcon"><Sparkles size={15}/></span>
            <span className="modelOptionCopy"><b>{g.short(x)}</b><small>{x===model?"Selectat acum":g.combo?"Combinație OmniRoute":"Folosește acest AI"}</small></span>
            {x===model&&<Check size={16}/>}
          </button>)}
        </div>)}
        {!all.length&&<div className="modelEmpty">Nu există modele disponibile. {policyEnforced?"Cere Owner-ului acces la cel puțin un model.":IS_WEB?"Owner-ul serverului trebuie să adauge o cheie AI (în fișierul .env de pe server).":"Pornește OmniRoute sau adaugă o cheie API în Setări."}</div>}
        {all.length>0&&!filtered.length&&<div className="modelEmpty">Nu am găsit modelul căutat.</div>}
      </div>
      <div className="modelPickerFoot">{refreshing?"Actualizez lista de modele…":policyEnforced||lockedMap.size?"Owner-ul stabilește ce modele sunt disponibile pentru contul tău."+(lockedMap.size?" Cele cu lacăt nu îți sunt permise de Owner.":deniedCount>0?` ${plural(deniedCount,"model OmniRoute este ascuns","modele OmniRoute sunt ascunse")} de Owner.`:""):(IS_WEB?"Modelele vin din OmniRoute și din API-urile configurate pe server.":"Modelele vin din OmniRoute și din API-urile configurate pe acest PC.")}</div>
    </div>}
    </div>
  </div>;
}

function Header({deniedCount,lockedModels=[],onMenu,model,onSelectModel,models,onRefreshModels,refreshingModels,policyEnforced,omni,showOmni,onShare,current,projects,onDetach,onMoveProject,onFiles,onGitHub,onGitHubRollback,hasGitHubBackup,onArchive,onUnarchive,onDelete}) {
  const {isOwner}=useAccess();
  const [more,setMore]=useState(false),[moveOpen,setMoveOpen]=useState(false);
  const moreRef=useRef(null);
  useDismiss(more,()=>{setMore(false);setMoveOpen(false)},moreRef);
  const close=()=>{setMore(false);setMoveOpen(false)};
  return <header className="topbar">
    <button className="iconOnly menuBtn" onClick={onMenu} aria-label="Afișează sau ascunde meniul" title="Meniu"><Menu size={20}/></button>
    <ModelPicker model={model} onSelect={onSelectModel} models={models} onRefresh={onRefreshModels} refreshing={refreshingModels} policyEnforced={policyEnforced} deniedCount={deniedCount} locked={lockedModels}/>
    <div className="topSpacer"/>
    {showOmni&&<div className={cx("connection",omni===true?"ok":"bad")} title={omni===true?"OmniRoute răspunde.":omni==="key"?"OmniRoute rulează, dar cere cheia API: creează una în OmniRoute → API Manager și pune-o în Setări → AI & OmniRoute. Până atunci răspund modelele API-urilor directe (Groq, Gemini…), dacă le alegi din listă.":"OmniRoute nu răspunde. Alege din listă un model al API-urilor directe configurate (Groq, Gemini…) sau pornește «Rezervă automată»."}>{omni===true?<Wifi size={15}/>:<WifiOff size={15}/>} {omni===true?"OmniRoute conectat":omni==="key"?"OmniRoute cere cheie API":"OmniRoute oprit"}</div>}
    <button className="topAction" onClick={onShare} disabled={!current} title="Copiază conversația în clipboard"><Share2 size={16}/> Copiază conversația</button>
    <div className="moreWrap" ref={moreRef}>
      <button className="iconOnly" onClick={()=>{setMore(v=>!v);setMoveOpen(false)}} aria-label="Opțiuni conversație" title="Opțiuni conversație" aria-haspopup="menu" aria-expanded={more}><MoreHorizontal size={20}/></button>
      {more&&<div className="conversationMenu" role="menu">
        <button role="menuitem" disabled={!current?.projectId} onClick={()=>{onDetach();close()}}><PanelTopOpen size={18}/> Scoate din proiect</button>
        <div className="menuSubWrap">
          <button role="menuitem" disabled={!current} onClick={()=>setMoveOpen(v=>!v)} aria-expanded={moveOpen}><Folder size={18}/> Mută în proiect <span className="menuChevron">›</span></button>
          {moveOpen&&<div className="projectSubmenu">
            <button onClick={()=>{onMoveProject(null);close()}}>Fără proiect</button>
            {projects.map(p=><button key={p.id} onClick={()=>{onMoveProject(p.id);close()}}>{p.name}</button>)}
            {!projects.length&&<span className="menuNote">Nu ai proiecte. Creează unul din bara laterală.</span>}
          </div>}
        </div>
        <div className="menuDivider"/>
        <button role="menuitem" disabled={!current} onClick={()=>{onFiles();close()}}><Library size={18}/> Vizualizare fișiere din conversație</button>
        {isOwner&&<button role="menuitem" onClick={()=>{onGitHub();close()}}><Globe2 size={18}/> GitHub Solve</button>}
        {isOwner&&hasGitHubBackup&&<button role="menuitem" onClick={()=>{onGitHubRollback();close()}}><RotateCcw size={18}/> Revino la ultima modificare GitHub</button>}
        <div className="menuDivider"/>
        {current?.archived
          ?<button role="menuitem" onClick={()=>{onUnarchive();close()}}><ArchiveRestore size={18}/> Restaurează din arhivă</button>
          :<button role="menuitem" disabled={!current} onClick={()=>{onArchive();close()}}><Archive size={18}/> Arhivează</button>}
        <button role="menuitem" className="dangerMenuItem" disabled={!current} onClick={()=>{onDelete();close()}}><Trash2 size={18}/> Șterge</button>
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
      {src?(kind==="image"?<img src={src} alt={attachment.name||"Imagine generată de AI Stoica"} className="zoomable" onClick={()=>setViewing(true)} title="Deschide pe tot ecranul"/>:kind==="video"?<video controls preload="metadata" src={src}/>:<audio controls preload="metadata" src={src}/>)
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
    {attachment.transcript&&<small>Pista audio a fost transcrisă pentru AI Stoica.</small>}
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
function ConversationView({conversation,busy,busyStage,busySteps,onRegenerate,onRate,onCodeResult,canRunCode,onAnswer,onOpenSettings}) {
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
      const report=["Rezultat real de rulare AI Stoica:",`Limbaj: ${r.language||contextMenu.language}`,`Cod de ieșire: ${r.code}`,r.timedOut?"Timp depășit: DA":"Timp depășit: NU",r.stdout?`STDOUT:\n${r.stdout}`:"STDOUT: (gol)",r.stderr?`STDERR:\n${r.stderr}`:"STDERR: (gol)"].join("\n");
      onCodeResult?.(report);setContextMenu(null);toast("Codul a fost rulat. Rezultatul a fost pus în caseta de mesaj.","ok");
    }catch(e){toast("Rulare cod: "+e.message)}
    finally{setRunning(false)}
  }
  if(!conversation||!conversation.messages?.length)return <div className="welcome"><BrandMark/><h1>Cu ce lucrăm astăzi?</h1><p>Întreabă orice. AI Stoica poate folosi memoria, internetul, contextul proiectului, biblioteca, pluginurile și sarcinile programate (Scheduled).{isOwner?" Ca Owner, poți rula cod direct din blocurile de cod (clic dreapta pe cod).":""}</p></div>;
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

const VIDEO_PROVIDERS_TEXT="Încearcă pe rând providerii video configurați (Pollinations, OpenRouter, Gemini Veo, fal.ai, Replicate); e nevoie de o cheie și de permisiunea pentru costuri din Setări → Video.";
function imageProvidersText(policy){return `Încearcă pe rând: Cloudflare și Pollinations (dacă ai cheie), Pollinations fără cheie, Hugging Face${policy?.imagePaid?", apoi providerii cu plată configurați":""}.`;}
function Composer({centered,draft,setDraft,onSend,onStop,busy,attachments,setAttachments,onOpenLibrary,responseMode,setResponseMode,mediaMode,setMediaMode,mentionsVersion,mediaPolicy}) {
  const {can,deny}=useAccess();
  const ta=useRef(null),fileInput=useRef(null),imageInput=useRef(null),videoInput=useRef(null),audioInput=useRef(null),recorderRef=useRef(null),streamRef=useRef(null),chunksRef=useRef([]),attachRef=useRef(null),mountedRef=useRef(true),autoSendRef=useRef(false);
  const [menu,setMenu]=useState(false),[recording,setRecording]=useState(false),[transcribing,setTranscribing]=useState(false),[uploading,setUploading]=useState(0),[mentions,setMentions]=useState([]),[mentionIndex,setMentionIndex]=useState(0),[mentionClosedFor,setMentionClosedFor]=useState(null),[dragOver,setDragOver]=useState(false);
  const pluginsOk=can("plugins"),automationsOk=can("automations");
  useDismiss(menu,()=>setMenu(false),attachRef);
  useEffect(()=>{if(ta.current){ta.current.style.height="0px";ta.current.style.height=Math.min(ta.current.scrollHeight,190)+"px"}},[draft]);
  useEffect(()=>{
    mountedRef.current=true;
    return()=>{
      mountedRef.current=false;
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
    if(failed.length)toast("Nu am putut atașa: "+failed.join(" · "));
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
  function fallbackSpeech(){
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR)throw new Error("Recunoașterea vocală nu este disponibilă.");
    const r=new SR();r.lang=speechLocale();r.interimResults=false;
    r.onresult=e=>setDraft(v=>(v?v+" ":"")+e.results[0][0].transcript);
    r.onerror=e=>toast("Microfon: "+(e.error==="network"?"recunoașterea vocală online nu este disponibilă":e.error||"eroare de recunoaștere"));
    r.start();
  }
  async function mic(){
    if(recording&&recorderRef.current){recorderRef.current.stop();return;}
    if(!can("file_upload")){deny("file_upload");return;}
    try{
      if(!navigator.mediaDevices?.getUserMedia){fallbackSpeech();return;}
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});streamRef.current=stream;chunksRef.current=[];
      const candidates=["audio/webm;codecs=opus","audio/webm","audio/ogg;codecs=opus"];
      const mime=candidates.find(x=>window.MediaRecorder?.isTypeSupported?.(x))||"";
      const rec=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);recorderRef.current=rec;
      const stopTracks=()=>{try{stream.getTracks().forEach(t=>t.stop())}catch{};streamRef.current=null;};
      rec.ondataavailable=e=>{if(e.data?.size)chunksRef.current.push(e.data)};
      rec.onerror=()=>{setRecording(false);stopTracks();toast("Înregistrarea vocală a eșuat.")};
      rec.onstop=async()=>{
        stopTracks();
        if(!mountedRef.current)return;
        setRecording(false);setTranscribing(true);
        try{
          const blob=new Blob(chunksRef.current,{type:rec.mimeType||"audio/webm"});
          if(!blob.size)throw new Error("Înregistrarea este goală.");
          const ext=blob.type.includes("ogg")?"ogg":"webm";
          const stamp=new Date().toISOString().replace(/[:.]/g,"-");
          const voiceFile=new File([blob],`Vocal_AI_Stoica_${stamp}.${ext}`,{type:blob.type});
          const item=await uploadFileToLibrary(voiceFile);
          const attachment=await libraryItemToAttachment(item);
          if(!mountedRef.current)return;
          // Voice message: the spoken text is written in the box and sent; the recording stays in the Library.
          if(attachment.transcript){autoSendRef.current=true;setDraft(v=>(v?v+" ":"")+attachment.transcript);}
          else{setAttachments(v=>[...v,attachment]);toast("Vocalul a fost salvat și atașat, dar transcrierea automată nu a reușit.","info");}
        }catch(e){
          toast("Vocalul nu a putut fi salvat sau transcris: "+e.message);
        }finally{if(mountedRef.current)setTranscribing(false);}
      };
      rec.start();setRecording(true);
    }catch{
      try{fallbackSpeech()}catch{toast("Accesul la microfon a fost refuzat sau microfonul nu este disponibil.")}
    }
  }
  const hasContent=!!draft.trim()||attachments.some(a=>a.part||a.parts?.length);
  useEffect(()=>{if(autoSendRef.current&&!transcribing&&draft.trim()){autoSendRef.current=false;trySend();}},[draft,transcribing]);
  function trySend(){
    if(busy)return;
    if(uploading){toast("Așteaptă să se termine încărcarea fișierului.","info");return;}
    if(recording){toast("Oprește mai întâi înregistrarea vocală.","info");return;}
    if(transcribing){toast("Aștept să se termine transcrierea vocalului.","info");return;}
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
  const placeholder=uploading?"Se încarcă fișierul…":recording?"Ascult… apasă microfonul pentru oprire":transcribing?"Transcriu vocea…":mediaMode==="image"?"Descrie poza pe care vrei s-o creez…":mediaMode==="video"?"Descrie videoclipul pe care vrei să-l creez…":"Mesaj pentru AI Stoica";
  const hint=uploading?"Fișierul se salvează în Biblioteca AI Stoica (maxim 2 GB per fișier)…":recording?"Microfon activ — vorbește acum":transcribing?"AI Stoica transcrie înregistrarea…":mediaMode==="image"?"Mod Poză: următorul mesaj creează o imagine. Apasă din nou „Poză” pentru a renunța.":mediaMode==="video"?"Mod Video: următorul mesaj creează un videoclip. Apasă din nou „Video” pentru a renunța.":"AI Stoica poate greși. Verifică informațiile importante.";
  return <div className={cx("composerDock",centered&&"centered")} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
    {mentionOptions.length>0&&<div className="mentionMenu" role="listbox" aria-label="Pluginuri și sarcini programate">{mentionOptions.map((x,i)=><button key={x.type+x.trigger+i} role="option" aria-selected={i===mentionIndex} className={cx(i===mentionIndex&&"active")} onMouseDown={e=>e.preventDefault()} onClick={()=>insertMention(x)}><span className={cx("mentionType",x.type)}>{x.type==="plugin"?<Plug size={14}/>:<CalendarClock size={14}/>}</span><span><b>{x.name}</b><small>{x.type==="plugin"?"Plugin":"Sarcină programată"} · {x.trigger}</small></span></button>)}</div>}
    <div className={cx("composerCard",dragOver&&"dragOver")}>
      {dragOver&&<div className="dropHint">{uploadLocked?deniedMessage("file_upload"):"Eliberează pentru a atașa fișierele"}</div>}
      {attachments.length>0&&<div className="attachmentTray">{attachments.map((a,i)=><TrayChip key={(a.libraryId||a.name)+i} attachment={a} onRemove={()=>setAttachments(v=>v.filter((_,j)=>j!==i))}/>)}</div>}
      <input ref={fileInput} type="file" hidden multiple onChange={filesChosen}/>
      <input ref={imageInput} type="file" hidden multiple accept="image/png,image/jpeg,image/webp,image/gif" onChange={filesChosen}/>
      <input ref={videoInput} type="file" hidden multiple accept="video/mp4,video/webm,video/quicktime,.mp4,.mov,.m4v,.avi,.mkv,.mpeg,.mpg" onChange={filesChosen}/>
      <input ref={audioInput} type="file" hidden multiple accept="audio/mpeg,audio/mp3,audio/mp4,audio/x-m4a,audio/aac,audio/wav,audio/x-wav,audio/ogg,audio/flac,audio/opus,.mp3,.m4a,.aac,.wav,.ogg,.flac,.opus" onChange={filesChosen}/>
      <div className="composerLine">
        <textarea ref={ta} value={draft} onChange={e=>{setDraft(e.target.value);setMentionClosedFor(null)}} onPaste={pasteIntoComposer} spellCheck={true} aria-label="Mesaj pentru AI Stoica" placeholder={placeholder} onKeyDown={onKeyDown}/>
      </div>
      {/* One toolbar under the text, as in the big chat apps: attach and modes on the left, voice and send on the right. */}
      <div className="composerTools">
        <div className="attachWrap" ref={attachRef}><button className="composerIcon" onClick={()=>setMenu(v=>!v)} title="Fișiere și unelte" aria-label="Fișiere și unelte" aria-haspopup="menu" aria-expanded={menu}><Plus size={20}/></button>{menu&&<div className="attachMenu" role="menu">
          <button role="menuitem" className={cx(uploadLocked&&"locked")} onClick={lockedItem("file_upload",()=>{setMenu(false);imageInput.current?.click()})}><ImageIcon size={16}/> Încarcă poze{uploadLocked&&<Lock size={12} className="lockIcon"/>}</button>
          <button role="menuitem" className={cx(uploadLocked&&"locked")} onClick={lockedItem("file_upload",()=>{setMenu(false);videoInput.current?.click()})}><Play size={16}/> Încarcă video{uploadLocked&&<Lock size={12} className="lockIcon"/>}</button>
          <button role="menuitem" className={cx(uploadLocked&&"locked")} onClick={lockedItem("file_upload",()=>{setMenu(false);audioInput.current?.click()})}><Volume2 size={16}/> Încarcă audio{uploadLocked&&<Lock size={12} className="lockIcon"/>}</button>
          <button role="menuitem" className={cx(uploadLocked&&"locked")} onClick={lockedItem("file_upload",()=>{setMenu(false);fileInput.current?.click()})}><Upload size={16}/> Încarcă orice fișier{uploadLocked&&<Lock size={12} className="lockIcon"/>}</button>
          <button role="menuitem" onClick={()=>{setMenu(false);onOpenLibrary()}}><Library size={16}/> Alege din Bibliotecă</button>
          <div className="menuDivider"/>
          <button role="menuitem" className={cx(!can("web_search")&&"locked")} onClick={lockedItem("web_search",()=>toolPrompt("Caută pe internet informații actuale despre "))}><Globe2 size={16}/> Căutare web{!can("web_search")&&<Lock size={12} className="lockIcon"/>}</button>
          <button role="menuitem" className={cx(!can("deep_research")&&"locked")} onClick={lockedItem("deep_research",()=>toolPrompt("Fă deep research, verifică mai multe surse și explică-mi complet: "))}><Search size={16}/> Deep Research{!can("deep_research")&&<Lock size={12} className="lockIcon"/>}</button>
        </div>}</div>
        <button className={cx("mediaMake",mediaMode==="image"&&"active",!can("image_generation")&&"locked")} aria-pressed={mediaMode==="image"} aria-label="Poză" title={can("image_generation")?`Poză: următorul mesaj creează o imagine. ${imageProvidersText(mediaPolicy)}`:deniedMessage("image_generation")} onClick={()=>toggleMedia("image")}><ImageIcon size={16}/><span>Poză</span></button>
        <button className={cx("mediaMake",mediaMode==="video"&&"active",!can("video_generation")&&"locked")} aria-pressed={mediaMode==="video"} aria-label="Video" title={can("video_generation")?`Video: următorul mesaj creează un videoclip. ${VIDEO_PROVIDERS_TEXT}`:deniedMessage("video_generation")} onClick={()=>toggleMedia("video")}><Clapperboard size={16}/><span>Video</span></button>
        <button className={cx("mediaMake thinkToggle",responseMode==="thinking"&&"active")} aria-pressed={responseMode==="thinking"} aria-label="Gândire" title={responseMode==="thinking"?"Gândire pornită: răspunsuri mai atente, puțin mai lente. Apasă pentru modul Rapid.":"Mod Rapid. Apasă pentru Gândire: răspunsuri mai atente, puțin mai lente."} onClick={()=>setResponseMode(responseMode==="thinking"?"rapid":"thinking")}><Brain size={16}/><span>Gândire</span></button>
        <span className="composerSpacer"/>
        <button className={cx("composerIcon",recording&&"recording",uploadLocked&&"locked")} onClick={mic} title={uploadLocked?deniedMessage("file_upload"):recording?"Oprește vocalul":"Înregistrează vocal"} aria-label={recording?"Oprește înregistrarea vocală":"Înregistrează vocal"} aria-pressed={recording} disabled={transcribing}><Mic size={19}/></button>
        {busy
          ? <button className="sendButton stopButton" onClick={onStop} title="Oprește răspunsul" aria-label="Oprește răspunsul"><Square size={15} fill="currentColor"/></button>
          : <button className="sendButton" disabled={!!uploading||recording||transcribing||!hasContent} onClick={trySend} title="Trimite" aria-label="Trimite mesajul"><ArrowUp size={20}/></button>}
      </div>
    </div>
    <div className="composerHint" aria-live="polite">{hint}</div>
  </div>;
}

const ADMIN_STATUS_LABELS={pending:"În așteptare",active:"Activ",rejected:"Respins",suspended:"Suspendat",blocked:"Blocat"};
const AUDIT_LABELS={"admin.user_status":"Status cont modificat","admin.permissions":"Permisiuni modificate","admin.sessions_revoke":"Sesiuni închise","admin.paid_ai":"AI plătit modificat","auth.register":"Cont nou","auth.login":"Autentificare","auth.logout":"Deconectare"};
function AdminPanel({onClose}) {
  const permissionLabels={
    chat:"Chat AI",cerebras:"Cerebras",gemini:"Gemini",groq:"Groq",cloudflare:"Cloudflare AI",
    openrouter:"OpenRouter (poate genera costuri)",image_generation:"Generare imagini",video_generation:"Generare videoclipuri",document_generation:"Fișiere: PDF / Word / PowerPoint / Excel / CSV / ZIP / cod",
    file_upload:"Încărcare fișiere",web_search:"Căutare web",deep_research:"Deep Research",
    automations:"Scheduled (sarcini programate)",plugins:"Pluginuri",github_access:"GitHub",openai:"OpenAI (plătit)",anthropic:"Claude / Anthropic (plătit)",
    code:"Code AI Stoica (prin API-urile OpenAI / Claude, nu prin abonamentele tale)"
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
  return <ToolShell title="AI Stoica Control Center" subtitle="Owner: utilizatori, aprobări, permisiuni, sesiuni și servicii AI." onClose={onClose}>
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
          {!visible.length&&<div className="stoicaPluginEmpty">{busy?"Se încarcă utilizatorii…":"Nu există utilizatori în această categorie."}</div>}
        </div>
        <div className="adminDetail">
          {!selected?<div className="stoicaPluginEmpty">Selectează un utilizator.</div>:<>
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
    <div className="conversationFiles">{files.length===0?<div className="emptyState"><Paperclip size={28}/>Nu există fișiere în această conversație.</div>:files.map((x,i)=><div className="conversationFile" key={i}><FileText size={20}/><div><b>{x.name}</b><span>{x.fromAssistant?"Generat de AI Stoica":"Atașat de tine"} · {kindLabel(x.kind||x.type||mediaKind(x.mime||x.mimeType,x.name),x.mime||x.mimeType,x.name)} · {fmtTime(x.createdAt)}</span></div>{(x.libraryId||x.id)&&<button className="smallBtn" onClick={()=>download(x,i)} disabled={busy!==null}><Download size={14}/> {busy===i?"Se descarcă…":"Descarcă"}</button>}</div>)}</div>
  </ToolShell>;
}
// Windows only: Settings shows saved keys masked, so this copies them for the server's setup script (aistoica.ro).
function ServerKeysBox() {
  const [state,setState]=useState({busy:false,text:"",bad:false});
  if(!window.AIStoica?.copyServerKeys)return null;
  async function run(){
    setState({busy:true,text:"",bad:false});
    try{
      const r=await window.AIStoica.copyServerKeys();
      const skipped=r?.skipped?.length?` Nu am copiat ${r.skipped.join(", ")}: au caractere pe care serverul nu le acceptă.`:"";
      setState({busy:false,bad:!r?.ok,text:r?.ok?`Am copiat ${r.count===1?"o cheie":r.count+" chei"} pentru server. Lipește-le când scriptul de pe server îți cere (click dreapta). Se șterg din clipboard în 2 minute.${skipped}`:(r?.error||"Cheile nu au putut fi copiate.")});
    }catch(e){setState({busy:false,bad:true,text:e.message})}
  }
  return <div className="providerTest">
    <div className="providerTestHead"><div><b>Cheile pentru server</b><span>Copiază cheile salvate pe acest PC, ca site-ul aistoica.ro să aibă aceleași modele.</span></div>
      <button className="secondary" onClick={run} disabled={state.busy}>{state.busy?"Se copiază…":"Copiază cheile pentru server"}</button></div>
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
    <div className="providerTestHead"><div><b>Testează cheile</b><span>Verifică OmniRoute (cheia și câte un model Gemini, Grok, OpenAI, Claude) și fiecare API salvat. Salvează setările înainte de test.</span></div>
      <button className="secondary" onClick={run} disabled={state.busy}>{state.busy?"Se testează…":"Testează acum"}</button></div>
    {state.error&&<div className="providerRow bad"><X size={15}/><span>{state.error}</span></div>}
    {state.omni&&<div className={cx("providerRow",state.omni.ok?"good":"bad")}>{state.omni.ok?<Check size={15}/>:<X size={15}/>}<b>OmniRoute</b><span>{state.omni.ok?`cheia e bună · ${state.omni.models} modele, ${state.omni.combos} combinații · ${(state.omni.ms/1000).toFixed(1)} s`:state.omni.error}</span></div>}
    {state.omni?.expired?.length>0&&<div className="providerRow bad omniExpired"><X size={15}/><b>Reconectează în OmniRoute</b><span>Loginul a expirat la: {state.omni.expired.map(x=>OMNI_CONNECTIONS[x]||x).join(", ")}. Panoul OmniRoute de pe server → Providers → fiecare cont → Reconnect (sau pune o cheie API).</span></div>}
    {(state.omni?.checks||[]).map(c=><div key={c.model} className={cx("providerRow omniCheck",c.ok?"good":"bad")}>{c.ok?<Check size={15}/>:<X size={15}/>}<b>{c.model}</b><span>{c.ok?`răspunde · ${(c.ms/1000).toFixed(1)} s`:c.error||("HTTP "+c.status)}</span></div>)}
    {state.data&&!state.data.length&&!state.omni?.ok&&<div className="providerRow bad"><X size={15}/><span>Nu ai nicio cheie de chat salvată. Adaugă de exemplu o cheie Gemini sau Groq și salvează.</span></div>}
    {(state.data||[]).map(x=><div key={x.provider} className={cx("providerRow",x.ok?"good":"bad")}>{x.ok?<Check size={15}/>:<X size={15}/>}<b>{x.label}</b><span>{x.model}{x.ok?` · ${(x.ms/1000).toFixed(1)} s`:` · ${x.error||("HTTP "+x.status)}`}{x.paid?" · cu plată":""}</span></div>)}
    {state.data&&state.media.length>0&&<div className="providerMedia">Imagini și video (nu se generează la test, pentru a nu consuma credite): {state.media.map(m=>`${m.label} ${m.configured?"✓":"—"}`).join(" · ")}</div>}
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
      const saved=await window.AIStoica?.setConfig?.({geminiApiKey:clean});
      if(!saved)throw new Error("Setările pot fi salvate doar din aplicația AI Stoica.");
      const d=await api("/api/providers/test",{method:"POST",body:"{}"});
      const gem=(d.data||[]).find(x=>x.provider==="gemini");
      if(!mounted.current)return;
      if(gem?.ok){setStatus("Gata! Cheia funcționează.");setTimeout(()=>onDone(true),700)}
      else setStatus("Cheia nu a funcționat: "+(gem?.error||"verifică dacă ai copiat-o complet."));
    }catch(err){if(mounted.current)setStatus(err.message)}finally{if(mounted.current)setBusy(false)}
  }
  return <Modal title="Bun venit în AI Stoica" subtitle="3 pași, gratuit, fără card. Durează un minut." className="modal firstRun" onClose={()=>onDone(false)}>
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
  return <div className="providerGroup"><div className="providerGroupTop"><b>{name}</b>{url&&<button type="button" className="providerKeyLink" onClick={()=>openLink(url)}>Ia cheia gratuită <ExternalLink size={12}/></button>}</div><small>{children}</small></div>;
}
// Settings → API-uri AI: which companies' models the chat uses. Unticked = their models leave the list and never answer
// (not even as a fallback). Cerebras starts unticked.
const CHAT_FAMILIES=[["openai","OpenAI (ChatGPT, Codex)"],["anthropic","Claude (Anthropic, Claude Code)"],["gemini","Google Gemini"],["xai","Grok (xAI)"],["groq","Groq"],["cerebras","Cerebras"],["mistral","Mistral"],["openrouter","OpenRouter"],["nvidia","NVIDIA"],["github","GitHub Models"],["cloudflare","Cloudflare"],["cohere","Cohere"],["huggingface","Hugging Face"]];
function ProviderUseList({cfg,set}) {
  const blocked=new Set(String(cfg.blockedProviders??"cerebras").split(",").map(x=>x.trim()).filter(Boolean));
  const toggle=(id,on)=>{const next=new Set(blocked);if(on)next.delete(id);else next.add(id);set({blockedProviders:[...next].join(",")})};
  return <fieldset className="providerUse"><legend>Furnizori folosiți în chat</legend>
    <p className="settingsHelp">Debifat: modelele lui nu apar în listă și nu răspund, nici ca rezervă. Combinațiile OmniRoute („Ai principal”) rămân; ce modele conțin le alegi în panoul OmniRoute.</p>
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
  return <fieldset className="providerUse"><legend>Combinații pentru toate conturile</legend>
    <p className="settingsHelp">Celelalte conturi folosesc toate modelele gratuite (Gemini, Groq, Mistral, OpenRouter :free…). Abonamentele tale (Codex, Claude Code, Copilot, Kiro, conturile web) rămân doar ale tale: condițiile lor nu permit împărțirea contului. O combinație OmniRoute o folosesc și ei doar dacă o bifezi aici; bifează doar combinații făcute din modele gratuite.</p>
    {combos===null?<p className="settingsHelp">Încarc combinațiile…</p>:names.length?<div className="providerUseGrid">{names.map(name=><label key={name} className="providerUseItem"><input type="checkbox" checked={has(name)} onChange={e=>toggle(name,e.target.checked)}/><span>{name}</span></label>)}</div>:<p className="settingsHelp">OmniRoute nu are încă nicio combinație.</p>}
  </fieldset>;
}
// Poze / Video → «Făcute de»: Gemini only by default (Nano Banana, Veo); "" lets every provider in, the free ones too.
const MEDIA_MAKERS={
  image:[["gemini","Doar Gemini · Nano Banana"],["gemini,openai,xai","Gemini, OpenAI și Grok"],["","Toți furnizorii, și cei gratuiți"]],
  video:[["gemini","Doar Gemini · Veo"],["gemini,openai,xai","Gemini, OpenAI (Sora) și Grok"],["","Toți furnizorii, și cei gratuiți"]]
};
const GEMINI_MEDIA_MODELS={
  image:[["gemini-3.1-flash-image","Nano Banana 2 · gemini-3.1-flash-image"],["gemini-3-pro-image-preview","Nano Banana Pro · gemini-3-pro-image-preview"],["gemini-2.5-flash-image","Nano Banana · gemini-2.5-flash-image"]],
  video:[["veo-3.1-fast-generate-preview","Veo 3.1 Fast · veo-3.1-fast-generate-preview"],["veo-3.1-generate-preview","Veo 3.1 · veo-3.1-generate-preview"],["veo-3.0-fast-generate-001","Veo 3 Fast · veo-3.0-fast-generate-001"]]
};
function MediaMakers({kind,cfg,set,paidOff}) {
  const field=kind==="image"?"imageProviders":"videoProviders",modelField=kind==="image"?"geminiImageModel":"geminiVideoModel";
  const value=String(cfg[field]??"gemini").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean).join(",");
  const options=MEDIA_MAKERS[kind].some(([v])=>v===value)?MEDIA_MAKERS[kind]:[...MEDIA_MAKERS[kind],[value,"Ales de tine: "+value]];
  const model=String(cfg[modelField]||GEMINI_MEDIA_MODELS[kind][0][0]);
  const models=GEMINI_MEDIA_MODELS[kind].some(([v])=>v===model)?GEMINI_MEDIA_MODELS[kind]:[...GEMINI_MEDIA_MODELS[kind],[model,model]];
  const geminiOnly=value==="gemini";
  return <fieldset className="providerUse"><legend>{kind==="image"?"Poze făcute de":"Video făcut de"}</legend>
    <label>Furnizori<select value={value} onChange={e=>set({[field]:e.target.value})}>{options.map(([v,l])=><option key={v||"all"} value={v}>{l}</option>)}</select></label>
    <label>{kind==="image"?"Model Gemini (Nano Banana)":"Model Gemini (Veo)"}<select value={model} onChange={e=>set({[modelField]:e.target.value})}>{models.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
    <p className="settingsHelp">{geminiOnly
      ?`Doar Gemini: prin Gemini conectat în OmniRoute (abonament, fără API) sau prin cheia Gemini de la API-uri AI. Ceilalți furnizori de mai jos nu sunt folosiți.${paidOff?" Gemini prin API e cu plată: ca să meargă cu cheia, alege mai jos «Permite provideri cu plată».":""}`
      :"Dacă modelul Gemini ales nu există pentru cheia ta, AI Stoica încearcă singur celelalte nume Gemini, apoi furnizorii permiși aici."}
      {" "}Când în chat ai ales un model Gemini, ChatGPT sau Grok, {kind==="image"?"poza o face":"videoclipul îl face"} compania acelui model: întâi abonamentul conectat în OmniRoute, apoi API-ul ei. Setarea de aici e pentru combinații („Ai principal”) și modelele care nu fac {kind==="image"?"poze":"video"}.</p>
  </fieldset>;
}
function KeyField({label,name,cfg,keys,setKeys,placeholder,token=false}) {
  const pending=keys[name]||"",clearing=pending==="__CLEAR__",saved=!!cfg?.[name];
  const savedText=token?"Token salvat — lasă gol pentru a-l păstra":"Cheie salvată — lasă gol pentru a o păstra";
  return <label>{label}<span className="keyRow">
    <input type="password" value={clearing?"":pending} disabled={clearing} onChange={e=>setKeys(k=>({...k,[name]:e.target.value}))} placeholder={clearing?"Va fi ștearsă la salvare":saved?savedText:placeholder} autoComplete="off"/>
    {saved&&(clearing
      ?<button type="button" className="smallBtn" onClick={()=>setKeys(k=>({...k,[name]:""}))}>Anulează</button>
      :<button type="button" className="smallBtn dangerSmall" onClick={()=>setKeys(k=>({...k,[name]:"__CLEAR__"}))} title={`Șterge ${token?"tokenul salvat":"cheia salvată"}`}>Șterge</button>)}
  </span></label>;
}

// On the web site the Owner's settings live on the server (/api/server/settings, lib/serversettings.cjs); in Windows,
// in the app (Electron). Both answer the same shape, so the same Settings window serves both.
const WEB_SETTINGS={
  getConfig:async()=>(await api("/api/server/settings")).data,
  setConfig:async(payload)=>{const r=await api("/api/server/settings",{method:"PUT",body:JSON.stringify(payload)});return {ok:true,config:r.config};}
};
function SettingsModal({onClose,onSaved,user,machineSettingsAllowed=true,initialTab="general",preferences,onPreferences,prefBusy}) {
  const {isOwner}=useAccess();
  const bridge=window.AIStoica?.getConfig?window.AIStoica:IS_WEB&&isOwner?WEB_SETTINGS:null;
  const webServer=bridge===WEB_SETTINGS;
  const [cfg,setCfg]=useState(null),[keys,setKeys]=useState({}),[tab,setTab]=useState(initialTab),[status,setStatus]=useState(null),[micStatus,setMicStatus]=useState(""),[toolStatus,setToolStatus]=useState(""),[error,setError]=useState(""),[saving,setSaving]=useState(false),[updateStatus,setUpdateStatus]=useState("");
  const {ref,backdropProps}=useModal(onClose);
  const mounted=useRef(true);
  useEffect(()=>()=>{mounted.current=false},[]);
  useEffect(()=>{
    if(!bridge){setError(IS_WEB?"Cheile AI și OmniRoute le configurează Owner-ul pe server. Aici poți schimba preferințele contului tău.":"Setările sunt disponibile doar în aplicația AI Stoica pentru Windows.");return;}
    Promise.all([bridge.getConfig(),bridge.systemStatus?.().catch(()=>null)])
      .then(([c,s])=>{if(mounted.current){setCfg(c||{});setStatus(s)}})
      .catch(e=>{if(mounted.current)setError("Nu am putut citi setările: "+e.message)});
  },[]);
  useEffect(()=>{if(!machineSettingsAllowed&&["ai","chatapis","images","video"].includes(tab))setTab("general")},[machineSettingsAllowed,tab]);
  const set=patch=>setCfg(c=>({...c,...patch}));
  async function save(){
    if(saving||!cfg)return;
    setError("");
    const gw=webServer?GATEWAY:cleanGatewayUrl(cfg.gatewayUrl||DEFAULT_GATEWAY);
    if(machineSettingsAllowed&&!gw){setError("Adresa serviciului local nu este validă. Exemplu: "+DEFAULT_GATEWAY);setTab("ai");return;}
    const ownerEmail=String(cfg.ownerEmail||"").trim().toLowerCase();
    if(machineSettingsAllowed&&!webServer&&ownerEmail&&!/^\S+@\S+\.\S+$/.test(ownerEmail)){setError("Emailul Owner nu este valid.");setTab("account");return;}
    setSaving(true);
    try{
      if(machineSettingsAllowed&&gw!==GATEWAY){
        try{const r=await fetch(`${gw}/health`,{signal:AbortSignal.timeout(5000)});if(!r.ok)throw new Error("HTTP "+r.status)}
        catch{throw new Error(`Nu pot contacta serviciul AI Stoica la ${gw}. Verifică adresa sau folosește ${DEFAULT_GATEWAY}.`)}
      }
      const changedKeys=Object.fromEntries(Object.entries(keys).filter(([,v])=>v));
      const payload={...cfg,...(machineSettingsAllowed&&!webServer?{gatewayUrl:gw,ownerEmail}:{}),...changedKeys};
      const r=await bridge.setConfig(payload);
      if(r&&r.ok===false)throw new Error(r.error||"Setările nu au putut fi salvate.");
      if(machineSettingsAllowed&&!webServer)setGatewayUrl(gw);
      DICTATION_LANG=String(payload.speechLanguage||"ro");
      onSaved?.(r?.config||payload);
      toast("Setările au fost salvate.","ok");
      onClose();
    }catch(e){if(mounted.current)setError(e.message)}
    finally{if(mounted.current)setSaving(false)}
  }
  async function testMic(){setMicStatus("Se verifică…");try{const s=await navigator.mediaDevices.getUserMedia({audio:true});s.getTracks().forEach(t=>t.stop());setMicStatus("Microfon disponibil și permis ✓")}catch{setMicStatus("Microfon indisponibil sau fără permisiune")}}
  async function testServer(){setToolStatus("Testez conexiunea SSH…");try{const d=await api("/api/tools/server/check",{method:"POST",body:JSON.stringify({serverHost:cfg.serverHost,serverPort:cfg.serverPort,serverUser:cfg.serverUser,serverKeyPath:cfg.serverKeyPath})});setToolStatus(d?.output||"Server conectat ✓")}catch(e){setToolStatus("Server: "+e.message)}}
  async function checkUpdate(){
    if(!window.AIStoica?.checkUpdate)return;
    setUpdateStatus("Caut actualizări…");
    try{const r=await window.AIStoica.checkUpdate();setUpdateStatus(!r?.ok?`Nu am putut verifica: ${r?.error||"eroare"}`:r.available===false||!r.version?"Folosești ultima versiune.":r.available===true?`Versiunea ${r.version} este disponibilă. Se descarcă automat; vei primi o notificare când e gata.`:`Ultima versiune publicată: ${r.version}.`)}
    catch(e){setUpdateStatus("Nu am putut verifica: "+e.message)}
  }
  const keyProps={cfg,keys,setKeys};
  // The site's server allows paid pictures when nothing was chosen (no imageCostPolicy in .env); Windows saves "free_only".
  const imageCost=cfg?.imageCostPolicy||(webServer?"allow_paid":"free_only");
  const tabs=[["general",SlidersHorizontal,"General",true],["ai",Bot,"AI & OmniRoute",machineSettingsAllowed],["chatapis",Plug,"API-uri AI",machineSettingsAllowed],["images",ImageIcon,"Poze",machineSettingsAllowed],["video",Play,"Video",machineSettingsAllowed],["voice",Volume2,"Voce și microfon",true],["account",User,"Cont și date",true]];
  return <div className="modalBackdrop" {...backdropProps}><div className="settingsModal" ref={ref} role="dialog" aria-modal="true" aria-label="Setări AI Stoica" tabIndex={-1}><div className="modalHead"><div><h2>Setări AI Stoica</h2><p>Aplicația, vocea, serviciile AI și actualizările.</p></div><button className="iconOnly" onClick={onClose} aria-label="Închide" title="Închide"><X size={20}/></button></div>
    {!cfg?<div className="settingsLoading">{error||"Se încarcă setările…"}{error&&onPreferences&&<div className="settingsPrefs"><h3>Memorie și conversații</h3><PreferenceSwitches preferences={preferences} onChange={onPreferences} busyKey={prefBusy}/></div>}{error&&<ServerUpdate/>}</div>:<>
    <div className="settingsBody"><div className="settingsNav" role="tablist" aria-orientation="vertical">
      {tabs.filter(t=>t[3]).map(([k,Icon,label])=><button key={k} role="tab" aria-selected={tab===k} className={tab===k?"active":""} onClick={()=>setTab(k)}><Icon size={17}/> {label}</button>)}
    </div>
    <div className="settingsPane">
      {tab==="general"&&<><h3>General</h3>
        {onPreferences&&<div className="settingsPrefs"><h4>Memorie și conversații</h4><p className="settingsHelp">Se aplică imediat, pentru contul tău.</p><PreferenceSwitches preferences={preferences} onChange={onPreferences} busyKey={prefBusy}/></div>}
        {!IS_WEB&&<>
        <label className="toggleRow"><div><b>Pornește AI Stoica cu Windows</b><span>Aplicația pornește automat și poate rămâne în fundal.</span></div><input type="checkbox" checked={!!cfg.startWithWindows} onChange={e=>set({startWithWindows:e.target.checked})}/></label>
        <label className="toggleRow"><div><b>Închidere în zona de notificare</b><span>Butonul X ascunde aplicația fără să oprească serviciile.</span></div><input type="checkbox" checked={cfg.closeToTray!==false} onChange={e=>set({closeToTray:e.target.checked})}/></label>
        <label className="toggleRow"><div><b>Actualizări automate (aplicația Windows)</b><span>La pornire, AI Stoica descarcă singur versiunea nouă din GitHub Releases și te anunță când e gata de instalat.</span></div><input type="checkbox" checked={cfg.autoUpdate!==false} onChange={e=>set({autoUpdate:e.target.checked})}/></label>
        {window.AIStoica?.checkUpdate&&<div className="settingsButtons"><button type="button" className="secondary" onClick={checkUpdate}><RotateCcw size={15}/> Caută actualizări acum</button></div>}
        {updateStatus&&<div className="micStatus" role="status">{updateStatus}</div>}
        </>}
        <ServerUpdate/>
      </>}
      {tab==="ai"&&<><h3>AI & OmniRoute</h3>
        {webServer&&<p className="settingsHelp">Setările site-ului: se salvează pe server și se aplică imediat pentru toate conturile. Cheile rămân pe server și se văd doar mascat. Emailul Owner și înregistrarea conturilor rămân în fișierul <code>.env</code> de pe server.</p>}
        {!webServer&&<>
        <label>Adresa serviciului AI Stoica<input value={cfg.gatewayUrl||DEFAULT_GATEWAY} onChange={e=>set({gatewayUrl:e.target.value})} placeholder={DEFAULT_GATEWAY}/></label>
        <p className="settingsHelp">Lasă {DEFAULT_GATEWAY} dacă nu folosești un server AI Stoica separat. Adresa este verificată înainte de salvare.</p>
        <label>AI Stoica Cloud API<input value={cfg.controlApiUrl||""} onChange={e=>set({controlApiUrl:e.target.value})} placeholder="https://api.aistoica.ro"/></label>
        <p className="settingsHelp">Cu Cloud API configurat, conturile, aprobările și permisiunile sunt gestionate central de Owner. Lasă câmpul gol pentru folosire doar pe acest PC.</p>
        </>}
        <label>Adresa OmniRoute<input value={cfg.baseUrl||""} onChange={e=>set({baseUrl:e.target.value})}/></label>
        <KeyField label="Cheie API OmniRoute" name="apiKey" placeholder="Cheie OmniRoute" {...keyProps}/>
        <p className="settingsHelp">OmniRoute 3.8 nu răspunde fără cheie. Creeaz-o în OmniRoute: <button type="button" className="linkBtn" onClick={()=>openLink(String(cfg.baseUrl||"http://127.0.0.1:20128/v1").replace(/\/v1\/?$/,"")+"/dashboard/api-manager")}>API Manager → Create API Key</button>, lipește-o aici și apasă „Testează cheile”.</p>
        <label><span className="labelLine">Model preferat <span className="optional">folosit când nu ai ales altul în lista de sus</span></span><input value={cfg.model||""} onChange={e=>set({model:e.target.value})} placeholder="Ex. gemini/gemini-3.5-flash"/></label>
        <label><span className="labelLine">Model generare imagini <span className="optional">opțional</span></span><input value={cfg.imageModel||""} onChange={e=>set({imageModel:e.target.value})} placeholder="Automat — primul model de imagine disponibil"/></label>
        <details className="mediaProviderSettings"><summary>Internet live, GitHub{isOwner?" și server":""}</summary>
          <p className="settingsHelp">Aceste unelte permit AI Stoica să verifice informații actuale și să aducă fragmente relevante dintr-un repository GitHub.{isOwner?" Rularea de cod și SSH sunt disponibile doar pentru Owner.":" Rularea de cod, GitHub Solve și SSH sunt disponibile doar pentru contul Owner (vezi „Email Owner pe acest PC” în tabul Cont și date)."}</p>
          <label className="toggleRow"><div><b>Internet în timp real</b><span>Caută automat surse actuale pentru cereri despre informații recente, versiuni și API-uri.</span></div><input type="checkbox" checked={cfg.webSearchEnabled!==false} onChange={e=>set({webSearchEnabled:e.target.checked})}/></label>
          <label className="toggleRow"><div><b>Context între conversațiile proiectului</b><span>Folosește conversațiile relevante din același proiect fără să le copiezi manual.</span></div><input type="checkbox" checked={cfg.projectContextEnabled!==false} onChange={e=>set({projectContextEnabled:e.target.checked})}/></label>
          <label className="toggleRow"><div><b>Caută automat în GitHub</b><span>Pentru întrebări de cod, caută fișiere relevante din repository înainte de răspuns.</span></div><input type="checkbox" checked={cfg.githubAutoContext!==false} onChange={e=>set({githubAutoContext:e.target.checked})}/></label>
          <label>GitHub repository<input value={cfg.githubRepo||""} onChange={e=>set({githubRepo:e.target.value})} placeholder="owner/repository"/></label>
          <label>GitHub branch<input value={cfg.githubBranch||"main"} onChange={e=>set({githubBranch:e.target.value})} placeholder="main"/></label>
          <KeyField label="Token GitHub (pentru repository privat)" name="githubToken" placeholder="github_pat_... sau ghp_..." token {...keyProps}/>
          {isOwner&&!webServer&&<>
            <label>Server SSH · adresă<input value={cfg.serverHost||""} onChange={e=>set({serverHost:e.target.value})} placeholder="IP sau domeniu"/></label>
            <div className="claudeFormRow"><label>Utilizator SSH<input value={cfg.serverUser||"root"} onChange={e=>set({serverUser:e.target.value})}/></label><label>Port SSH<input type="number" min="1" max="65535" value={cfg.serverPort||22} onChange={e=>set({serverPort:Number(e.target.value)||22})}/></label></div>
            <label>Calea cheii private SSH<input value={cfg.serverKeyPath||""} onChange={e=>set({serverKeyPath:e.target.value})} placeholder="C:\Users\Nume\.ssh\id_ed25519"/></label>
            <button type="button" className="secondary testMicBtn" onClick={testServer}>Testează serverul</button>{toolStatus&&<div className="micStatus" role="status">{toolStatus}</div>}
          </>}
        </details>
        <p className="settingsHelp">Când ceri o poză sau un videoclip, AI Stoica returnează fișierul real în chat, cu buton de descărcare.</p>
        {!webServer&&<>
        <label>Comandă OmniRoute<input value={cfg.omniCommand||"omniroute.cmd"} onChange={e=>set({omniCommand:e.target.value})}/></label>
        <label className="toggleRow"><div><b>Pornește OmniRoute automat</b><span>Dacă serviciul cade, AI Stoica încearcă să îl repornească.</span></div><input type="checkbox" checked={!!cfg.autoStartOmniRoute} onChange={e=>set({autoStartOmniRoute:e.target.checked})}/></label>
        <div className="statusGrid"><div><span>Serviciul AI Stoica</span><b>{status?.gatewayRunning?"Pornit":"Indisponibil"}</b></div><div><span>OmniRoute</span><b>{status?.omniRunning?"Conectat":status?.omniInstalled===false?"Neinstalat — npm install -g omniroute":"Indisponibil"}</b></div></div>
        </>}
      </>}
      {tab==="chatapis"&&<><div className="settingsSectionTitle"><div className="settingsSectionIcon"><Plug size={22}/></div><div><h3>API-uri AI</h3><p>Modelele lor apar în listă și răspund direct, fără OmniRoute.</p></div></div>
        <ProviderTestBox/>
        <ServerKeysBox/>
        <label className="toggleRow"><div><b>Folosește API-urile directe</b><span>Modelele lor apar în listă (Groq, Gemini, Cerebras…). Răspund când le alegi sau când nu ai ales niciun model.</span></div><input type="checkbox" checked={cfg.directChatEnabled!==false} onChange={e=>set({directChatEnabled:e.target.checked})}/></label>
        <label className="toggleRow"><div><b>Rezervă automată</b><span>Dacă modelul ales nu răspunde, trece singur la API-urile directe. Oprit: răspunde doar modelul ales, iar altfel vezi eroarea.</span></div><input type="checkbox" checked={cfg.chatFallbackOnFailure===true} onChange={e=>set({chatFallbackOnFailure:e.target.checked})}/></label>
        <ProviderUseList cfg={cfg} set={set}/>
        {(webServer||cfg.controlApiUrl)&&<SharedCombos cfg={cfg} set={set}/>}
        <label>Protecție costuri<select value={cfg.directChatCostPolicy||"free_only"} onChange={e=>set({directChatCostPolicy:e.target.value})}><option value="free_only">Doar provideri fără cost direct</option><option value="allow_paid">Permite și API-urile plătite (OpenAI, Grok)</option></select></label>
        <label>Ordinea de încercare<input value={cfg.directChatProviderOrder||"cerebras,groq,gemini,mistral,nvidia,github,openrouter,cloudflare,cohere,huggingface,openai,xai"} onChange={e=>set({directChatProviderOrder:e.target.value})}/></label>
        <p className="settingsHelp">Fiecare model din liste apare în lista de modele de sus. Dacă lipsește cheia, providerul răspunde cu 429/404/503 sau nu răspunde deloc, AI Stoica încearcă următorul model, apoi următorul provider.</p>
        <ProviderHead name="Cerebras" id="cerebras" cfg={cfg}>Compatibil OpenAI.</ProviderHead>
        <KeyField label="Cheie API Cerebras" name="cerebrasApiKey" placeholder="csk-..." {...keyProps}/>
        <label>Modele Cerebras · separate prin virgulă<input value={cfg.cerebrasModel||""} onChange={e=>set({cerebrasModel:e.target.value})}/></label>
        <ProviderHead name="Groq" id="groq" cfg={cfg}>Compatibil OpenAI, răspunsuri rapide.</ProviderHead>
        <KeyField label="Cheie API Groq" name="groqApiKey" placeholder="gsk_..." {...keyProps}/>
        <label>Modele Groq · separate prin virgulă<input value={cfg.groqModel||""} onChange={e=>set({groqModel:e.target.value})}/></label>
        <ProviderHead name="Gemini" id="gemini" cfg={cfg}>Încearcă modelele în ordine până găsește cotă disponibilă.</ProviderHead>
        <KeyField label="Cheie API Gemini" name="geminiApiKey" placeholder="AIza..." {...keyProps}/>
        <label>Modele Gemini · separate prin virgulă<input value={cfg.geminiModels||""} onChange={e=>set({geminiModels:e.target.value})}/></label>
        <ProviderHead name="Mistral" id="mistral" cfg={cfg}>Compatibil OpenAI.</ProviderHead>
        <KeyField label="Cheie API Mistral" name="mistralApiKey" placeholder="Cheie API" {...keyProps}/>
        <label>Modele Mistral · separate prin virgulă<input value={cfg.mistralModel||""} onChange={e=>set({mistralModel:e.target.value})}/></label>
        <ProviderHead name="NVIDIA" id="nvidia" cfg={cfg}>NVIDIA API / NIM, compatibil OpenAI.</ProviderHead>
        <KeyField label="Cheie API NVIDIA" name="nvidiaApiKey" placeholder="nvapi-..." {...keyProps}/>
        <label>Modele NVIDIA · separate prin virgulă<input value={cfg.nvidiaModel||""} onChange={e=>set({nvidiaModel:e.target.value})}/></label>
        <ProviderHead name="GitHub Models" id="github" cfg={cfg}>Token „fine-grained” cu permisiunea Models: Read. Același token e folosit și la GitHub.</ProviderHead>
        <KeyField label="Token GitHub" name="githubToken" placeholder="github_pat_..." token {...keyProps}/>
        <label>Modele GitHub · separate prin virgulă<input value={cfg.githubModelsModel||""} onChange={e=>set({githubModelsModel:e.target.value})}/></label>
        <ProviderHead name="OpenRouter" id="openrouter" cfg={cfg}>AUTO_FREE caută automat primul model gratuit disponibil.</ProviderHead>
        <KeyField label="Cheie API OpenRouter" name="openRouterApiKey" placeholder="sk-or-..." {...keyProps}/>
        <label>Model OpenRouter<input value={cfg.openRouterChatModel||"AUTO_FREE"} onChange={e=>set({openRouterChatModel:e.target.value})}/></label>
        <ProviderHead name="Cloudflare Workers AI" id="cloudflare" cfg={cfg}>Token cu șablonul „Workers AI”. Account ID e în dash.cloudflare.com → AI → Workers AI. Același token ca la Poze.</ProviderHead>
        <label>Cloudflare Account ID<input value={cfg.cloudflareAccountId||""} onChange={e=>set({cloudflareAccountId:e.target.value})}/></label>
        <KeyField label="Token API Cloudflare" name="cloudflareApiToken" placeholder="Token API" token {...keyProps}/>
        <label>Modele Cloudflare · separate prin virgulă<input value={cfg.cloudflareChatModel||""} onChange={e=>set({cloudflareChatModel:e.target.value})}/></label>
        <ProviderHead name="Cohere" id="cohere" cfg={cfg}>API de compatibilitate.</ProviderHead>
        <KeyField label="Cheie API Cohere" name="cohereApiKey" placeholder="Cheie API" {...keyProps}/>
        <label>Modele Cohere · separate prin virgulă<input value={cfg.cohereModel||""} onChange={e=>set({cohereModel:e.target.value})}/></label>
        <ProviderHead name="Hugging Face" id="huggingface" cfg={cfg}>Router compatibil OpenAI; același token ca la secțiunea Poze.</ProviderHead>
        <KeyField label="Token Hugging Face" name="hfToken" placeholder="hf_..." token {...keyProps}/>
        <label>Modele Hugging Face · separate prin virgulă<input value={cfg.huggingFaceChatModel||""} onChange={e=>set({huggingFaceChatModel:e.target.value})}/></label>
        <ProviderHead name="OpenAI" id="openai" cfg={cfg}>Inclus, dar blocat implicit de protecția costurilor.</ProviderHead>
        <KeyField label="Cheie API OpenAI" name="openAiApiKey" placeholder="sk-..." {...keyProps}/>
        <label>Modele OpenAI · separate prin virgulă<input value={cfg.openAiChatModels||""} onChange={e=>set({openAiChatModels:e.target.value})}/></label>
        <ProviderHead name="Grok (xAI)" id="xai" cfg={cfg}>Plătit pe consum; aceeași cheie face și poze și video Grok Imagine. Pornește-l cu „Permite și API-urile plătite”.</ProviderHead>
        <KeyField label="Cheie API xAI" name="xaiApiKey" placeholder="xai-..." {...keyProps}/>
        <label>Modele Grok · separate prin virgulă<input value={cfg.xaiModels||""} onChange={e=>set({xaiModels:e.target.value})} placeholder="grok-4.6,grok-4.3"/></label>
      </>}
      {tab==="images"&&<><div className="settingsSectionTitle"><div className="settingsSectionIcon"><ImageIcon size={22}/></div><div><h3>Poze</h3><p>Generare imagini, API-uri, modele și încercare automată a altui provider.</p></div></div>
        <MediaMakers kind="image" cfg={cfg} set={set} paidOff={imageCost!=="allow_paid"||cfg.imageProviderMode==="free"}/>
        <label><span className="labelLine">Model generare imagini <span className="optional">opțional</span></span><input value={cfg.imageModel||""} onChange={e=>set({imageModel:e.target.value})} placeholder="Automat — primul model de imagine disponibil"/></label>
        <details className="mediaProviderSettings" open><summary>Provideri de imagini</summary>
          <p className="settingsHelp">Poți conecta mai multe servicii. AI Stoica încearcă providerii în ordine și trece automat la următorul dacă unul eșuează. {webServer?"Cheile stau pe server și se văd doar mascat.":"Cheile sunt criptate pe acest PC."}</p>
          <label>Mod de alegere<select value={cfg.imageProviderMode||"auto"} onChange={e=>set({imageProviderMode:e.target.value})}><option value="auto">Automat — ordinea mea</option><option value="fast">⚡ Rapid</option><option value="quality">✨ Calitate</option><option value="free">🛡️ Doar gratuit</option></select></label>
          <label>Protecție costuri<select value={imageCost} onChange={e=>set({imageCostPolicy:e.target.value})}><option value="free_only">Nu permite costuri directe</option><option value="allow_paid">Permite provideri cu plată</option></select></label>
          <p className="settingsHelp">{imageCost==="free_only"?"Protecție activă: AI Stoica încearcă direct Cloudflare și Pollinations. Hugging Face, Together, OpenAI, Stability, fal.ai și Replicate sunt blocate dacă ar putea consuma credit plătit. La OpenRouter se verifică prețul înainte de apel.":"Atenție: providerii configurați pot consuma credit conform tarifelor lor."}</p>
          <label>Ordinea de încercare<input value={cfg.imageProviderOrder||"cloudflare,pollinations,huggingface,together,openrouter,fal,replicate,stability,openai,gemini,xai"} onChange={e=>set({imageProviderOrder:e.target.value})}/></label>
          <div className="providerGroup"><b>Cloudflare Workers AI</b><small>FLUX.1 Schnell · provider prioritar în modul gratuit.</small></div>
          <label>Cloudflare Account ID<input value={cfg.cloudflareAccountId||""} onChange={e=>set({cloudflareAccountId:e.target.value})} placeholder="Account ID"/></label>
          <KeyField label="Token API Cloudflare" name="cloudflareApiToken" placeholder="Token API" token {...keyProps}/>
          <div className="providerGroup"><b>Hugging Face</b><small>FLUX.1 Schnell prin HF Inference Router, doar dacă protecția costurilor permite.</small></div>
          <KeyField label="Token Hugging Face" name="hfToken" placeholder="hf_..." token {...keyProps}/>
          <div className="providerGroup"><b>Together AI</b><small>FLUX.1 Schnell. Creditele promoționale pot fi limitate.</small></div>
          <KeyField label="Cheie API Together" name="togetherApiKey" placeholder="Cheie API" {...keyProps}/>
          <div className="providerGroup"><b>OpenRouter</b><small>Mai multe modele de imagine printr-o singură cheie.</small></div>
          <KeyField label="Cheie API OpenRouter" name="openRouterApiKey" placeholder="sk-or-..." {...keyProps}/>
          <label>Model imagine OpenRouter<input value={cfg.openRouterImageModel||"google/gemini-3.1-flash-image"} onChange={e=>set({openRouterImageModel:e.target.value})}/></label>
          <div className="providerGroup"><b>OpenAI</b><small>GPT Image prin API OpenAI.</small></div>
          <KeyField label="Cheie API OpenAI" name="openAiApiKey" placeholder="sk-..." {...keyProps}/>
          <label>Model imagine OpenAI<input value={cfg.openAiImageModel||"gpt-image-1-mini"} onChange={e=>set({openAiImageModel:e.target.value})}/></label>
          <div className="providerGroup"><b>Google Gemini</b><small>„Nano Banana”; modelul îl alegi sus, la «Poze făcute de». Aceeași cheie ca la API-uri AI și Video.</small></div>
          <KeyField label="Cheie API Gemini" name="geminiApiKey" placeholder="AIza..." {...keyProps}/>
          <div className="providerGroup"><b>Grok Imagine (xAI)</b><small>Prin cheia xAI de la API-uri AI.</small></div>
          <label>Model imagine Grok<input value={cfg.xaiImageModel||"grok-imagine-image"} onChange={e=>set({xaiImageModel:e.target.value})}/></label>
          <div className="providerGroup"><b>Stability AI</b><small>Stable Image REST API.</small></div>
          <KeyField label="Cheie API Stability" name="stabilityApiKey" placeholder="sk-..." {...keyProps}/>
          <label>Motor Stability<select value={cfg.stabilityImageEngine||"core"} onChange={e=>set({stabilityImageEngine:e.target.value})}><option value="core">Core</option><option value="ultra">Ultra</option><option value="sd3">SD3</option></select></label>
          <div className="providerGroup"><b>fal.ai</b><small>Modele rapide de generare prin fal.run.</small></div>
          <KeyField label="Cheie API fal" name="falApiKey" placeholder="FAL_KEY" {...keyProps}/>
          <label>Model fal.ai<input value={cfg.falImageModel||"fal-ai/z-image/turbo"} onChange={e=>set({falImageModel:e.target.value})}/></label>
          <div className="providerGroup"><b>Replicate</b><small>Modele oficiale și din comunitate prin Predictions API.</small></div>
          <KeyField label="Token API Replicate" name="replicateApiToken" placeholder="r8_..." token {...keyProps}/>
          <label>Model Replicate<input value={cfg.replicateImageModel||"black-forest-labs/flux-schnell"} onChange={e=>set({replicateImageModel:e.target.value})}/></label>
          <div className="providerGroup"><b>Pollinations</b><small>Provider media de rezervă.</small></div>
          <KeyField label="Cheie API Pollinations" name="pollinationsApiKey" placeholder="sk_..." {...keyProps}/>
          <label>Model Pollinations<input value={cfg.pollinationsImageModel||"black-forest-labs/flux.1-schnell"} onChange={e=>set({pollinationsImageModel:e.target.value})}/></label>
        </details>
        <p className="settingsHelp">Când ceri o poză, AI Stoica încearcă providerii în ordinea stabilită, pune fișierul real în chat și îl salvează în Bibliotecă.</p>
      </>}
      {tab==="video"&&<><div className="settingsSectionTitle"><div className="settingsSectionIcon"><Play size={22}/></div><div><h3>Video</h3><p>Generare videoclipuri, API-uri, modele și încercare automată a altui provider.</p></div></div>
        <MediaMakers kind="video" cfg={cfg} set={set} paidOff={cfg.videoCostPolicy!=="allow_paid"||cfg.videoMode==="free"}/>
        <label>Mod video<select value={cfg.videoMode||"fast"} onChange={e=>{const videoMode=e.target.value;const quality=videoMode==="quality";set({videoMode,videoModel:quality?"bytedance/seedance-2.5":"bytedance/seedance-2.0-fast",openRouterVideoModel:quality?"bytedance/seedance-2.5":"bytedance/seedance-2.0-fast",geminiVideoModel:quality?"veo-3.1-generate-preview":"veo-3.1-fast-generate-preview"})}}><option value="fast">⚡ Rapid</option><option value="quality">🎬 Calitate</option><option value="free">🛡️ Doar gratuit</option></select></label>
        <label>Protecție costuri<select value={cfg.videoCostPolicy||"free_only"} onChange={e=>set({videoCostPolicy:e.target.value})}><option value="free_only">Nu porni joburi cu plată</option><option value="allow_paid">Permite provideri cu plată</option></select></label>
        <p className="settingsHelp">{(cfg.videoCostPolicy||"free_only")==="free_only"?"AI Stoica verifică prețul publicat când este disponibil și nu pornește generarea dacă nu poate confirma costul zero. Gemini Veo, fal.ai și Replicate rămân blocate în acest mod.":"Atenție: generarea video poate consuma rapid credit. Costul depinde de model, durată și rezoluție."}</p>
        <label>Ordinea de încercare<input value={cfg.videoProviderOrder||"pollinations,openrouter,gemini,fal,replicate,openai,xai"} onChange={e=>set({videoProviderOrder:e.target.value})}/></label>
        <div className="providerGroup"><b>Pollinations Video</b><small>Cheia este comună cu secțiunea Poze.</small></div>
        <KeyField label="Cheie API Pollinations" name="pollinationsApiKey" placeholder="sk_..." {...keyProps}/>
        <label>Model video Pollinations<input value={cfg.pollinationsVideoModel||"google/veo-3.1-fast"} onChange={e=>set({pollinationsVideoModel:e.target.value})}/></label>
        <div className="providerGroup"><b>OpenRouter Video</b><small>Seedance, Veo, Wan și alte modele prin același API.</small></div>
        <KeyField label="Cheie API OpenRouter" name="openRouterApiKey" placeholder="sk-or-..." {...keyProps}/>
        <label>Model video OpenRouter<input value={cfg.openRouterVideoModel||(cfg.videoMode==="quality"?"bytedance/seedance-2.5":"bytedance/seedance-2.0-fast")} onChange={e=>set({openRouterVideoModel:e.target.value})}/></label>
        <div className="providerGroup"><b>Gemini · Veo</b><small>Veo prin aceeași cheie Gemini folosită la chat; modelul îl alegi sus, la «Video făcut de».</small></div>
        <KeyField label="Cheie API Gemini" name="geminiApiKey" placeholder="AIza..." {...keyProps}/>
        <div className="providerGroup"><b>OpenAI · Sora</b><small>Prin cheia OpenAI de la API-uri AI; videoclipuri de 4, 8 sau 12 secunde.</small></div>
        <label>Model video OpenAI<input value={cfg.openAiVideoModel||"sora-2"} onChange={e=>set({openAiVideoModel:e.target.value})}/></label>
        <div className="providerGroup"><b>Grok Imagine Video (xAI)</b><small>Prin cheia xAI de la API-uri AI; 1–15 secunde.</small></div>
        <label>Model video Grok<input value={cfg.xaiVideoModel||"grok-imagine-video"} onChange={e=>set({xaiVideoModel:e.target.value})}/></label>
        <div className="providerGroup"><b>fal.ai Video</b><small>LTX Video. Poate folosi creditele inițiale, apoi credit plătit.</small></div>
        <KeyField label="Cheie API fal" name="falApiKey" placeholder="FAL_KEY" {...keyProps}/>
        <label>Model video fal<input value={cfg.falVideoModel||"fal-ai/ltx-video"} onChange={e=>set({falVideoModel:e.target.value})}/></label>
        <div className="providerGroup"><b>Replicate Video</b><small>Modele video oficiale prin Predictions API.</small></div>
        <KeyField label="Token API Replicate" name="replicateApiToken" placeholder="r8_..." token {...keyProps}/>
        <label>Model video Replicate<input value={cfg.replicateVideoModel||"wan-video/wan-2.2-t2v-fast"} onChange={e=>set({replicateVideoModel:e.target.value})}/></label>
        <p className="settingsHelp">Când ceri un videoclip, AI Stoica încearcă providerii în ordine, descarcă fișierul MP4 real, îl pune în chat și îl salvează în Bibliotecă.</p>
      </>}
      {tab==="voice"&&<><h3>Voce și microfon</h3>
        <label>Limba dictării, a transcrierii și a citirii cu voce<select value={cfg.speechLanguage||"ro"} onChange={e=>set({speechLanguage:e.target.value})}><option value="ro">Română</option><option value="en">English</option><option value="fr">Français</option></select></label>
        {machineSettingsAllowed&&<label>Model transcriere<input value={cfg.speechModel||"openai/whisper-1"} onChange={e=>set({speechModel:e.target.value})}/></label>}
        <button type="button" className="secondary testMicBtn" onClick={testMic}><Mic size={16}/> Testează microfonul</button>{micStatus&&<div className="micStatus" role="status">{micStatus}</div>}
        <p className="settingsHelp">Apasă microfonul o dată pentru a începe înregistrarea și încă o dată pentru a o opri. AI Stoica salvează vocalul în Bibliotecă și îl transcrie automat.</p>
      </>}
      {tab==="account"&&<><h3>Cont și date</h3>
        <div className="accountSettingsCard"><div className="accountAvatar big">{(user?.name||user?.email||"S")[0].toUpperCase()}</div><div><b>{user?.name||"Cont AI Stoica"}</b><span>{user?.email}{user?.role==="owner"?" · Owner":""}</span></div></div>
        <p className="settingsHelp">Conversațiile, memoria, biblioteca, designurile, proiectele, pluginurile și sarcinile programate sunt păstrate {IS_WEB?"pe serverul AI Stoica":"pe acest calculator"}.</p>
        {machineSettingsAllowed&&!webServer&&<>
          <label><span className="labelLine">Email Owner pe acest PC <span className="optional">opțional</span></span><input type="email" value={cfg.ownerEmail||""} onChange={e=>set({ownerEmail:e.target.value})} placeholder="nume@email.ro" autoComplete="off"/></label>
          <p className="settingsHelp">Contul local cu acest email primește drepturi de Owner: rulare de cod, GitHub Solve, verificare server. Se aplică doar când AI Stoica Cloud nu este configurat. Reautentifică-te după schimbare.</p>
        </>}
      </>}
      {error&&<div className="inlineError" role="alert">{error}</div>}
    </div></div>
    <div className="modalActions"><button className="secondary" onClick={onClose}>Anulează</button><button className="primary" onClick={save} disabled={saving}>{saving?"Se salvează…":"Salvează setările"}</button></div>
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
      const a=await api("/api/github/apply",{method:"POST",body:JSON.stringify({path:result.path,content:result.proposal,sha:result.sha,branch:result.branch,message:"AI Stoica: rezolvare "+result.path})});
      if(a.data?.backupId)onBackup?.({id:a.data.backupId,path:a.data.path,branch:a.data.branch,commit:a.data.commit,createdAt:Date.now()});
      toast("Modificarea a fost aplicată în GitHub. Commit: "+(a.data?.commit||"creat"),"ok");
      onClose();
    }catch(err){if(mounted.current){setError(err.message);setBusy("")}}
  }
  const failedCheck=result?.check?.supported&&!result.check.ok;
  return <Modal title="GitHub Solve" subtitle="AI Stoica citește fișierul din repository-ul configurat și propune o corectură." className="modal githubModal" onClose={onClose}>
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
  // The model AI Stoica picked by itself (first in the list: your OmniRoute combination). Unlike a model you chose, it is
  // replaced as soon as a better one appears, so a direct API picked while OmniRoute was offline does not stay selected.
  const autoPickRef=useRef("");
  const [selectedProject,setSelectedProject]=useState(null),[selectedAssistant,setSelectedAssistant]=useState(null);
  const [draft,setDraft]=useState(""),[attachmentsState,setAttachments]=useState([]),[responseMode,setResponseModeState]=useState(()=>storage.get(RESPONSE_MODE_KEY,"rapid")==="thinking"?"thinking":"rapid"),[mediaModeState,setMediaMode]=useState(null);
  const [generations,setGenerations]=useState({});
  const [search,setSearch]=useState(""),[sidebar,setSidebar]=useState(false),[sidebarCollapsed,setSidebarCollapsed]=useState(()=>storage.get(SIDEBAR_COLLAPSED_KEY)==="1");
  const [omni,setOmni]=useState(false),[cloudConfigured,setCloudConfigured]=useState(null),[showJumpBottom,setShowJumpBottom]=useState(false);
  const [settings,setSettings]=useState(false),[prefBusy,setPrefBusy]=useState(""),[entityModal,setEntityModal]=useState(null),[toolPanel,setToolPanel]=useState(null),[filesPanel,setFilesPanel]=useState(false),[githubModal,setGithubModal]=useState(false);
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
  function stopGeneration(){const c=controllersRef.current.get(currentId);if(c&&!c.signal.aborted)c.abort("user-stop")}
  function abortAll(reason){for(const c of controllersRef.current.values()){try{c.abort(reason)}catch{}}controllersRef.current.clear();setGenerations({})}
  function showConversation(conv){setConversations(v=>v.map(x=>x.id===conv.id?conv:x))}

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
    window.addEventListener("ai-stoica:file-renamed",renamed);
    return()=>window.removeEventListener("ai-stoica:file-renamed",renamed);
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
        const cfg=await window.AIStoica?.getConfig?.();
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
    const off=window.AIStoica?.onUpdateReady?.(()=>setUpdateReady(true));
    return()=>{if(typeof off==="function")off()};
  },[]);
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
    if(!current){const manual=storage.get(MANUAL_MODEL_KEY);if(manual&&(!modelPolicyEnforced||models.includes(manual)))setModel(manual);}
  },[currentId,modelPolicyEnforced,models.join("|")]);

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
    let answer="",routeInfo=null,started=false,streamError="",flushTimer=null;
    const assistantMessage={id:uid(),role:"assistant",content:"",createdAt:Date.now(),streaming:true};
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
      const r=await fetch(`${GATEWAY}/api/chat/stream`,{method:"POST",headers:authHeaders({"Content-Type":"application/json"}),body:JSON.stringify({model:effectiveModel,conversationId:baseConv.id||null,assistantId:baseConv.assistantId||null,projectId:baseConv.projectId||null,responseMode,messages:payload}),signal:controller.signal});
      if(!r.ok){const text=await r.text().catch(()=>"");throw apiError(r.status,text,"/api/chat/stream")}
      setGen(convId,{stage:"Așteaptă răspunsul AI-ului ales…"});
      const handleLine=line=>{
        if(!line.startsWith("data:"))return;
        const raw=line.slice(5).trim();if(!raw||raw==="[DONE]")return;
        let j;try{j=JSON.parse(raw)}catch{return}
        if(j?.error){streamError=String(j.error?.message||j.error);return}
        if(j?.ai_stoica_route){
          routeInfo=j.ai_stoica_route;
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
            const exported=await api("/api/export",{method:"POST",body:JSON.stringify({format,title:safeFileTitle(working.title||"AI Stoica - fișier"),content})});
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
    }catch(e){
      clearTimeout(flushTimer);
      const reason=controller.signal.reason;
      if(reason==="deleted"||reason==="logout"||reason==="replaced")return;
      const aborted=controller.signal.aborted||e?.name==="AbortError";
      const finalMessage=aborted
        ?{...assistantMessage,routeInfo,content:answer,streaming:false,stopped:true}
        :{...assistantMessage,routeInfo,content:`Eroare: ${friendlyError(e.message)}`,streaming:false,error:true};
      working={...working,messages:[...messages,finalMessage],updatedAt:Date.now()};
      showConversation(working);
      if(storage.get(TOKEN_KEY)){try{await saveConversation(working)}catch(saveError){if(!isAuthLost(saveError.status,saveError.message))toast("Conversația nu a putut fi salvată: "+saveError.message)}}
    }finally{finishGeneration(convId,controller)}
  }
  // A picture or video (asked for in the chat or with the Poză / Video button) is made by the company of the chosen
  // model (Gemini, ChatGPT, Grok); with a combination or a model that cannot make pictures, by Setări → Poze / Video.
  async function generateMediaAssistant(baseConv,messages,kind,prompt){
    const convId=baseConv.id;
    const controller=startGeneration(convId);
    setGen(convId,{stage:kind==="video"?"Generează videoclipul… poate dura câteva minute":"Creează imaginea și pregătește fișierul…"});
    const base={id:uid(),role:"assistant",createdAt:Date.now(),streaming:false,mediaKind:kind,mediaPrompt:prompt};
    try{
      let message;
      try{
        const d=await api(kind==="video"?"/api/generate/video":"/api/generate/image",{method:"POST",body:JSON.stringify({prompt,via:baseConv.model||model||""}),signal:controller.signal});
        const file={...d.data,type:d.data?.kind||kind,kind:d.data?.kind||kind};
        message={...base,content:"",attachments:[file],routeInfo:{task:kind==="video"?"video_generation":"image_generation",model:file.model||"",provider:inferModelProvider(file.model||"")}};
      }catch(e){
        const reason=controller.signal.reason;
        if(reason==="deleted"||reason==="logout"||reason==="replaced")return;
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
  async function share(){if(!current)return;const ok=await writeClipboardText(current.messages.map(m=>`${m.role==="user"?"Eu":"AI Stoica"}:\n${messageText(m)}`).join("\n\n"));toast(ok?"Conversația a fost copiată în clipboard.":"Nu am putut copia conversația în clipboard.",ok?"ok":"error")}
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
  // Code AI Stoica: the new Code conversation opens with its code model chosen.
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
    Promise.resolve(window.AIStoica?.setConfig?.({gatewayUrl:DEFAULT_GATEWAY})).catch(()=>{});
    loadData();
  }

  if(boot)return <div className="loadingScreen"><BrandMark/><span>Se pornește AI Stoica…</span></div>;
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
      {updateReady&&!updateDismissed&&<div className="updateBanner" role="status"><button className="updateInstall" onClick={()=>window.AIStoica?.installUpdate?.()}>Actualizare AI Stoica disponibilă — instalează acum</button><button className="updateClose" onClick={()=>setUpdateDismissed(true)} aria-label="Ascunde notificarea" title="Mai târziu"><X size={14}/></button></div>}
      <div className="chatScroll" ref={chatRef} onScroll={updateChatScrollState}><ConversationView conversation={current} busy={busy} busyStage={currentGen?.stage} busySteps={currentGen?.steps||[]} onRegenerate={regenerate} onRate={rate} canRunCode={isOwner} onCodeResult={text=>setDraft(v=>(v?v+"\n\n":"")+text)} onAnswer={text=>send(text)} onOpenSettings={tab=>setSettings(tab||true)}/></div>
      {showJumpBottom&&hasMessages&&<button className="jumpToLatest" onClick={()=>jumpToLatest({smooth:true})} title="Mergi la ultimul mesaj" aria-label="Mergi la ultimul mesaj"><ChevronDown size={19}/><span>Ultimul mesaj</span></button>}
      <Composer centered={!hasMessages} draft={draft} setDraft={setDraft} onSend={send} onStop={stopGeneration} busy={busy} attachments={attachmentsState} setAttachments={setAttachments} onOpenLibrary={()=>openTool("library","all")} responseMode={responseMode} setResponseMode={setResponseMode} mediaMode={mediaModeState} setMediaMode={setMediaMode} mentionsVersion={mentionsVersion} mediaPolicy={{imagePaid:machineCfgRef.current?.imageCostPolicy==="allow_paid"}}/>
    </main>
    {settings&&<SettingsModal user={user} initialTab={typeof settings==="string"?settings:"general"} preferences={user?.preferences} onPreferences={updatePreferences} prefBusy={prefBusy} machineSettingsAllowed={machineSettingsAllowed} onClose={()=>setSettings(false)} onSaved={cfg=>{machineCfgRef.current={...(machineCfgRef.current||{}),...cfg};setCloudConfigured(!!String(cfg?.controlApiUrl||"").trim());Promise.resolve(window.AIStoica?.ensureOmni?.()).catch(()=>{});setTimeout(()=>loadData(),800)}}/>}
    {entityModal&&<EntityModal type={entityModal.type} item={entityModal.item} onClose={()=>setEntityModal(null)} onSave={saveEntity} onDelete={entityModal.item&&!entityModal.item.builtIn?deleteEntity:null}/>}
    {toolPanel?.name==="explore"&&<ExplorePanel onClose={closeTool} assistants={assistants} onUseAssistant={startWithAssistant} onImageMode={startImageMode} onOpenLibrary={filter=>openTool("library",filter)}/>}
    {toolPanel?.name==="library"&&<LibraryPage onClose={closeTool} onAttach={attachFromLibrary} toAttachment={libraryItemToAttachment} initialFilter={toolPanel.filter||"all"} onOpenDesign={id=>openTool("design",id)}/>}
    {toolPanel?.name==="design"&&can("document_generation")&&<DesignPage onClose={closeTool} model={model} models={models} initialId={toolPanel.filter||null}/>}
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
createRoot(document.getElementById("root")).render(<ErrorBoundary><App/></ErrorBoundary>);
