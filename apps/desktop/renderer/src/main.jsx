import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Menu, Plus, Search, Folder, Bot, Settings, LogOut, Share2, MoreHorizontal,
  Paperclip, Mic, ArrowUp, Copy, ThumbsUp, ThumbsDown, RotateCcw, X,
  ChevronDown, User, Check, Wifi, WifiOff, Sparkles, SquarePen,
  CalendarClock, Plug, Library, Brain, Upload, Trash2, Play, Pin, PinOff,
  FileText, Image as ImageIcon, HardDrive, ToggleLeft, ToggleRight,
  Compass, Map, Globe2, Archive, ExternalLink, SlidersHorizontal, Volume2,
  PanelTopOpen, ShieldCheck, Users, UserCheck, UserX, Ban, Bell, Power, Download
} from "lucide-react";
import "./styles.css";

const GATEWAY_KEY = "aiStoicaGatewayUrlV1";
let GATEWAY = (localStorage.getItem(GATEWAY_KEY) || "http://127.0.0.1:8787").replace(/\/+$/,"");
function setGatewayUrl(url){
  const clean=String(url||"").trim().replace(/\/+$/,"");
  GATEWAY=clean||"http://127.0.0.1:8787";
  localStorage.setItem(GATEWAY_KEY,GATEWAY);
}
const TOKEN_KEY = "aiStoicaAuthTokenV3";
const USER_KEY = "aiStoicaUserV3";
const MODEL_CACHE_KEY = "aiStoicaModelsV1";
const MODEL_SELECTED_KEY = "aiStoicaSelectedModelV1";
const SMART_ROUTER_DEFAULT_KEY = "aiStoicaSmartRouterDefaultV1";
const AUTO_ROUTER_ENABLED_KEY = "aiStoicaAutoRouterEnabledV1";
const MANUAL_MODEL_KEY = "aiStoicaManualModelV1";

function cachedModels() {
  try {
    const v=JSON.parse(localStorage.getItem(MODEL_CACHE_KEY)||"[]");
    return Array.isArray(v)?v.filter(Boolean):[];
  } catch { return []; }
}
function uniqueModels(values) {
  return [...new Set((values||[]).map(x=>String(x||"").trim()).filter(Boolean))];
}

async function api(path, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY) || "";
  const r = await fetch(`${GATEWAY}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  const text = await r.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text || `HTTP ${r.status}` }; }
  if (!r.ok) throw new Error(data?.error?.message || data?.error || `HTTP ${r.status}`);
  return data;
}

async function uploadFileToLibrary(file) {
  const token=localStorage.getItem(TOKEN_KEY)||"";
  const r=await fetch(`${GATEWAY}/api/library/upload`,{
    method:"POST",
    headers:{
      "Content-Type":"application/octet-stream",
      "X-File-Name":encodeURIComponent(file.name),
      "X-File-Type":file.type||"application/octet-stream",
      "X-File-Size":String(file.size||0),
      ...(token?{Authorization:`Bearer ${token}`}:{})
    },
    body:file
  });
  const text=await r.text();let data;
  try{data=text?JSON.parse(text):{}}catch{data={error:text||`HTTP ${r.status}`}}
  if(!r.ok)throw new Error(data?.error||`HTTP ${r.status}`);
  return data.data;
}
function formatBytes(n){
  const v=Number(n||0);if(v<1024)return `${v} B`;
  if(v<1024**2)return `${(v/1024).toFixed(v<10240?1:0)} KB`;
  if(v<1024**3)return `${(v/1024**2).toFixed(v<10*1024**2?1:0)} MB`;
  return `${(v/1024**3).toFixed(2)} GB`;
}

class ErrorBoundary extends React.Component {
  constructor(props){super(props);this.state={error:null};}
  static getDerivedStateFromError(error){return {error};}
  componentDidCatch(error,info){console.error("AI Stoica renderer error",error,info);}
  render(){
    if(this.state.error){
      return <div style={{height:"100vh",background:"#05070b",color:"#e9eef7",display:"grid",placeItems:"center",fontFamily:"Segoe UI, sans-serif",padding:24}}>
        <div style={{maxWidth:720}}>
          <h1 style={{marginTop:0}}>AI Stoica a întâmpinat o eroare de interfață</h1>
          <p style={{color:"#9ba9bc",lineHeight:1.6}}>Aplicația nu mai rămâne pe ecran negru. Închide complet AI Stoica din system tray și pornește-o din nou. Dacă mesajul reapare, trimite-mi textul de mai jos.</p>
          <pre style={{whiteSpace:"pre-wrap",background:"#0d131d",border:"1px solid #26354a",borderRadius:12,padding:14,color:"#ffb0b8"}}>{String(this.state.error?.stack||this.state.error?.message||this.state.error)}</pre>
          <button onClick={()=>location.reload()} style={{border:"1px solid #2a8cff",background:"#126bd0",color:"white",borderRadius:10,padding:"10px 14px",cursor:"pointer"}}>Reîncarcă AI Stoica</button>
        </div>
      </div>;
    }
    return this.props.children;
  }
}

function cx(...v) { return v.filter(Boolean).join(" "); }
function uid() { return `${Date.now().toString(36)}${Math.random().toString(36).slice(2,8)}`; }
function titleFrom(text) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  return s.length > 48 ? `${s.slice(0,48)}…` : (s || "Conversație nouă");
}
function messageText(m) {
  if (m?.displayText) return m.displayText;
  if (typeof m?.content === "string") return m.content;
  if (Array.isArray(m?.content)) return m.content.filter(x => x?.type === "text").map(x => x.text).join("\n");
  return "";
}
function inferModelProvider(model,provider="") {
  const p=String(provider||"").toLowerCase();
  if(p)return p;
  const m=String(model||"").toLowerCase();
  const first=m.split("/")[0];
  const prefixMap={openai:"openai",anthropic:"anthropic",google:"gemini",gemini:"gemini",cerebras:"cerebras",groq:"groq",cloudflare:"cloudflare",openrouter:"openrouter",runway:"runway","@cf":"cloudflare"};
  if(prefixMap[first])return prefixMap[first];
  if(/groq/.test(m))return "groq";
  if(/cerebras/.test(m))return "cerebras";
  if(/cloudflare|@cf\//.test(m))return "cloudflare";
  if(/openrouter/.test(m))return "openrouter";
  if(/runway/.test(m))return "runway";
  if(/claude|anthropic/.test(m))return "anthropic";
  if(/gemini|google/.test(m))return "gemini";
  if(/openai|codex|\/o[134](?:\b|[-_.])/i.test(m)||(!/gpt[-_. ]?oss/.test(m)&&/gpt/.test(m)))return "openai";
  return p||"ai";
}
function providerLabel(provider,model="") {
  const p=inferModelProvider(model,provider);
  return ({openai:"OpenAI",anthropic:"Anthropic",gemini:"Google Gemini",cerebras:"Cerebras",groq:"Groq",cloudflare:"Cloudflare AI",openrouter:"OpenRouter",runway:"Runway",ai:"AI"})[p]||String(provider||"AI");
}
function routeTaskLabel(task) {
  return ({
    coding:"Programare",reasoning:"Matematică / logică",legal_analysis:"Analiză juridică",
    long_context:"Document / context lung",research:"Cercetare",creative:"Creativitate",
    vision:"Imagine / viziune",fast:"Răspuns rapid",general:"General",manual:"Model ales manual",
    image_generation:"Generare imagine",video_generation:"Generare video"
  })[task]||"General";
}
function RouteBadge({info}) {
  if(!info?.model)return null;
  const provider=providerLabel(info.provider,info.model);
  return <div className="routeBadge" title={"AI Stoica a folosit "+provider+" · "+info.model}>
    <Sparkles size={12}/><span><b>{provider}</b><em>{info.model}</em></span><small>{routeTaskLabel(info.task)}</small>
  </div>;
}

async function writeClipboardText(value) {
  const text=String(value??"");
  if(!text) return false;
  try {
    const result=await window.AIStoica?.writeClipboardText?.(text);
    if(result?.ok) return true;
  } catch {}
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {}
  try {
    const helper=document.createElement("textarea");
    helper.value=text;
    helper.setAttribute("readonly","");
    helper.style.position="fixed";
    helper.style.opacity="0";
    helper.style.pointerEvents="none";
    document.body.appendChild(helper);
    helper.select();
    const ok=document.execCommand("copy");
    helper.remove();
    return !!ok;
  } catch { return false; }
}

async function saveBlobDownload(blob,name) {
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;a.download=name||"AI-Stoica-file";
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
}
async function downloadGeneratedFile(file) {
  const token=localStorage.getItem(TOKEN_KEY)||"";
  const r=await fetch(`${GATEWAY}/api/files/${file.id}`,{headers:token?{Authorization:`Bearer ${token}`}:{}});
  if(!r.ok)throw new Error("Nu am putut descărca fișierul generat.");
  await saveBlobDownload(await r.blob(),file.name||"AI-Stoica-file");
}
async function downloadLibraryFile(file) {
  if(!file?.libraryId)return;
  const token=localStorage.getItem(TOKEN_KEY)||"";
  const r=await fetch(`${GATEWAY}/api/library/${file.libraryId}/content`,{headers:token?{Authorization:`Bearer ${token}`}:{}});
  if(!r.ok)throw new Error("Nu am putut descărca fișierul media.");
  await saveBlobDownload(await r.blob(),file.name||"AI-Stoica-media");
}
async function exportMessageFile(message,format) {
  const d=await api("/api/export",{method:"POST",body:JSON.stringify({format,title:"AI Stoica - răspuns",content:messageText(message)})});
  await downloadGeneratedFile(d.data);
}

function normalizeDocumentIntent(value){
  return String(value||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
}
const DOWNLOAD_FORMATS=["pdf","docx","pptx","xlsx","csv","json","md","txt","html","xml","rtf","zip","ipynb","svg","js","ts","jsx","tsx","py","java","c","cpp","cs","go","rs","php","rb","sh","ps1","sql","css","yaml","yml","toml","ini","tex"];
function requestedDocumentFormat(value){
  const t=normalizeDocumentIntent(value).trim();
  const asks=/(trimite|da-mi|dami|descarc|download|export|salveaz|fisier|document|format|creeaz|genereaz|fa-mi|fami|fa\s+un|make|create|save)/;
  const explicit=t.match(/\.(pdf|docx|pptx|xlsx|csv|json|md|txt|html|xml|rtf|zip|ipynb|svg|js|ts|jsx|tsx|py|java|c|cpp|cs|go|rs|php|rb|sh|ps1|sql|css|yaml|yml|toml|ini|tex)\b/);
  if(explicit&&asks.test(t))return explicit[1];
  const candidates=[
    ["pptx",/\bpptx\b|powerpoint|prezentare/],["docx",/\bdocx\b|\bword\b/],["xlsx",/\bxlsx\b|\bexcel\b|foaie de calcul|spreadsheet/],
    ["pdf",/\bpdf\b/],["csv",/\bcsv\b/],["json",/\bjson\b/],["html",/\bhtml\b/],["xml",/\bxml\b/],["rtf",/\brtf\b/],
    ["zip",/\bzip\b|arhiva/],["ipynb",/\bipynb\b|jupyter|notebook/],["svg",/\bsvg\b/],["md",/\bmarkdown\b|\bmd\b/],["txt",/\btxt\b|text simplu/],
    ["py",/\bpython\b/],["js",/\bjavascript\b/],["ts",/\btypescript\b/],["ps1",/\bpowershell\b/],["sql",/\bsql\b/],["yaml",/\byaml\b/],["tex",/\blatex\b/]
  ];
  const found=candidates.find(([,re])=>re.test(t));
  if(!found)return null;
  const simple=new RegExp("^\\s*(in\\s+)?("+found[0]+"|word|powerpoint|excel|markdown|python|javascript|typescript|jupyter|notebook)(\\s+te\\s+rog)?[.!]?\\s*$");
  return (simple.test(t)||asks.test(t))?found[0]:null;
}
function standaloneExportRequest(value){
  const t=normalizeDocumentIntent(value).replace(/[^a-z0-9.\s-]/g," ").replace(/\s+/g," ").trim();
  const format=requestedDocumentFormat(t);if(!format)return false;
  if(/de mai sus|raspunsul|mesajul anterior|acesta|aceasta|asta|ultimul/.test(t))return true;
  let stripped=t.replace(new RegExp("\\b("+DOWNLOAD_FORMATS.join("|")+"|word|powerpoint|excel|prezentare|document|fisier|format|markdown|jupyter|notebook)\\b","g")," ");
  stripped=stripped.replace(/\b(trimite|da-mi|dami|descarca|descarc|download|exporta|export|salveaza|salveaz|creeaza|creeaz|genereaza|genereaz|fa-mi|fami|fa|in|ca|te|rog|mi|un|o)\b/g," ").replace(/\s+/g," ").trim();
  return stripped.length<18;
}
function requestedMediaGeneration(value){
  const t=normalizeDocumentIntent(value).trim();
  if(!/(cree|crea|gener|fa-mi|fami|realiz|produc|make|generate|create)/.test(t))return null;
  if(/\b(video|videoclip|filmule|mp4|clip video|film)\b/.test(t))return "video";
  if(/\b(poza|fotografie|imagine|image|picture|png|jpe?g)\b/.test(t))return "image";
  return null;
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
function fmtTime(ts) {
  if (!ts) return "—";
  try { return new Date(ts).toLocaleString("ro-RO"); } catch { return "—"; }
}
function readDataUrl(file) {
  return new Promise((resolve,reject)=>{ const r=new FileReader(); r.onload=()=>resolve(r.result); r.onerror=reject; r.readAsDataURL(file); });
}
function mediaKind(mime,name="") {
  const m=String(mime||"").toLowerCase(),n=String(name||"").toLowerCase();
  if(m.startsWith("audio/")||/\.(mp3|m4a|aac|wav|ogg|oga|flac|opus|weba)$/i.test(n))return "audio";
  if(m.startsWith("video/")||/\.(mp4|mov|m4v|webm|avi|mkv|mpeg|mpg)$/i.test(n))return "video";
  if(m.startsWith("image/"))return "image";
  if(m.startsWith("text/")||/\.(txt|md|csv|json|js|ts|py|html|css|xml|yaml|yml)$/i.test(n))return "text";
  return "file";
}
async function fetchLibraryBlob(id) {
  const token=localStorage.getItem(TOKEN_KEY)||"";
  const r=await fetch(`${GATEWAY}/api/library/${id}/content`,{headers:token?{Authorization:`Bearer ${token}`}:{}});
  if(!r.ok)throw new Error("Conținutul fișierului nu poate fi citit.");
  return await r.blob();
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
async function fileToLibraryPayload(file) {
  const kind=mediaKind(file.type,file.name);
  if(kind==="text") return { name:file.name, mime:file.type, size:file.size, kind:"text", text:(await file.text()).slice(0,150000) };
  const dataUrl=await readDataUrl(file);
  return { name:file.name, mime:file.type, size:file.size, kind, dataUrl };
}
async function libraryItemToAttachment(item) {
  const d=(await api(`/api/library/${item.id}`)).data;
  const kind=mediaKind(d.mime,d.name)||d.kind;
  if(kind==="image"&&Number(d.size||0)<=20*1024*1024){
    const blob=await fetchLibraryBlob(d.id),dataUrl=await readDataUrl(blob);
    return {name:d.name,type:"image",mime:d.mime,size:d.size,libraryId:d.id,part:{type:"image_url",image_url:{url:dataUrl}}};
  }
  if(kind==="text"&&Number(d.size||0)<=10*1024*1024){
    const blob=await fetchLibraryBlob(d.id),text=(await blob.text()).slice(0,250000);
    return {name:d.name,type:"text",mime:d.mime,size:d.size,libraryId:d.id,part:{type:"text",text:`Conținutul fișierului ${d.name}:\n${text}`}};
  }
  if(kind==="audio"||kind==="video"){
    let transcript="",transcriptionError="";
    if(Number(d.size||0)<=25*1024*1024){
      try{const tr=await api(`/api/library/${d.id}/transcribe`,{method:"POST",body:JSON.stringify({language:"ro"})});transcript=String(tr.text||"").trim()}
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
    const parts=[{type:"text",text:details},...frames];
    return {name:d.name,type:kind,mime:d.mime,size:d.size,libraryId:d.id,transcript,part:parts[0],parts};
  }
  return {name:d.name,type:"stored",mime:d.mime,size:d.size,libraryId:d.id,part:{type:"text",text:`Fișier atașat: ${d.name} (${formatBytes(d.size)}). Fișierul este stocat în Biblioteca AI Stoica; conținutul integral nu este introdus automat în context dacă depășește limita modelului.`}};
}

function AuthScreen({ onAuth }) {
  const [mode,setMode]=useState("login"),[name,setName]=useState(""),[email,setEmail]=useState(""),[password,setPassword]=useState(""),[error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false);
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const data = await api(mode==="login"?"/auth/login":"/auth/register",{method:"POST",body:JSON.stringify({name,email,password})});
      if(data?.status==="pending"&&!data?.token){
        setNotice(data.message||"Contul a fost creat și așteaptă aprobarea Owner-ului.");
        setMode("login"); setPassword(""); return;
      }
      if(!data?.token||!data?.user) throw new Error("Serverul nu a returnat o sesiune validă.");
      localStorage.setItem(TOKEN_KEY,data.token); localStorage.setItem(USER_KEY,JSON.stringify(data.user)); onAuth(data.user);
    } catch(e2){ setError(e2.message); } finally { setBusy(false); }
  }
  return <div className="authShell"><div className="authGlow"/>
    <div className="authBrand"><img src="./stoica-enterprises-ai.png" alt="Stoica Enterprises AI"/><h1>AI Stoica</h1><p>Stoica Enterprises AI</p>
      <div className="authFeature"><Sparkles size={17}/> Chat AI profesional, memorie, fișiere și automatizări.</div>
      <div className="authFeature"><Wifi size={17}/> Conectare prin OmniRoute.</div>
      <div className="authFeature"><User size={17}/> Cont personal cu aprobare Owner.</div>
    </div>
    <form className="authCard" onSubmit={submit}>
      <div className="authTabs"><button type="button" className={mode==="login"?"active":""} onClick={()=>{setMode("login");setError("");}}>Autentificare</button><button type="button" className={mode==="register"?"active":""} onClick={()=>{setMode("register");setError("");setNotice("");}}>Creează cont</button></div>
      <h2>{mode==="login"?"Bine ai revenit":"Creează contul AI Stoica"}</h2>
      <p className="muted">{mode==="register"?"Conturile noi trebuie aprobate de Owner înainte de prima utilizare.":"Folosește emailul contului tău AI Stoica."}</p>
      {mode==="register"&&<label>Nume<input value={name} onChange={e=>setName(e.target.value)} placeholder="Numele tău"/></label>}
      <label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="nume@email.ro" required/></label>
      <label>Parolă<input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Minimum 10 caractere" required minLength={10}/></label>
      {notice&&<div className="authNotice"><UserCheck size={17}/><span>{notice}</span></div>}
      {error&&<div className="authError">{error}</div>}
      <button className="primaryWide" disabled={busy}>{busy?"Se procesează…":mode==="login"?"Intră în AI Stoica":"Trimite cererea de acces"}</button>
      <div className="localNote">Owner-ul controlează aprobarea conturilor și permisiunile serviciilor AI.</div>
    </form>
  </div>;
}

function BrandMark({small=false}) { return <div className={cx("brandMark",small&&"small")}><img src="./stoica-enterprises-ai.png" alt="S"/></div>; }

function Sidebar({open,setOpen,user,search,setSearch,projects,assistants,conversations,currentId,onSelect,onDeleteConversation,onNew,selectedProject,setSelectedProject,selectedAssistant,setSelectedAssistant,onNewProject,onNewAssistant,onTool,onExplore,onSettings,onLogout}) {
  const filtered=conversations.filter(c=>!c.archived&&(!search||(c.title||"").toLowerCase().includes(search.toLowerCase())));
  const groups=useMemo(()=>{const out={};filtered.forEach(c=>{const g=groupLabel(c.updatedAt);(out[g]||=[]).push(c)});return out},[filtered]);
  return <aside className={cx("sidebar",open&&"open")}>
    <div className="sideTop"><div className="brandLine"><BrandMark small/><div><b>AI Stoica</b><span>Enterprises AI</span></div></div><button className="iconOnly mobileClose" onClick={()=>setOpen(false)}><X size={20}/></button></div>
    <button className="newChat" onClick={onNew}><SquarePen size={17}/> Conversație nouă</button>
    <div className="searchBox"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Caută conversații"/></div>
    <div className="sideScroll">
      <div className="sideSection"><div className="sectionHead"><span>Instrumente</span></div>
        <button className="sideItem exploreItem" onClick={()=>onTool("explore")}><Compass size={16}/> Explorează</button>
        <button className="sideItem toolItem" onClick={()=>onTool("automations")}><CalendarClock size={16}/> Automatizări</button>
        <button className="sideItem toolItem" onClick={()=>onTool("plugins")}><Plug size={16}/> Pluginuri</button>
        <button className="sideItem toolItem" onClick={()=>onTool("library")}><Library size={16}/> Bibliotecă</button>
        <button className="sideItem toolItem" onClick={()=>onTool("memory")}><Brain size={16}/> Memorie</button>
        {user?.role==="owner"&&<button className="sideItem ownerItem" onClick={()=>onTool("admin")}><ShieldCheck size={16}/> Control Center</button>}
      </div>
      <div className="sideSection"><div className="sectionHead"><span>Proiecte</span><button onClick={onNewProject}><Plus size={15}/></button></div>
        <button className={cx("sideItem",selectedProject===null&&"active")} onClick={()=>setSelectedProject(null)}><Folder size={16}/> Toate conversațiile</button>
        {projects.map(p=><button key={p.id} className={cx("sideItem",selectedProject===p.id&&"active")} onClick={()=>setSelectedProject(p.id)}><Folder size={16}/>{p.name}</button>)}
      </div>
      <div className="sideSection"><div className="sectionHead"><span>Asistenți</span><button onClick={onNewAssistant}><Plus size={15}/></button></div>
        {assistants.map(a=><button key={a.id} className={cx("sideItem",selectedAssistant===a.id&&"active")} onClick={()=>setSelectedAssistant(a.id)}><Bot size={16}/>{a.name}</button>)}
      </div>
      <div className="sideSection historySection"><div className="sectionHead"><span>Conversații</span></div>
        {Object.entries(groups).map(([g,items])=><div key={g} className="historyGroup"><div className="historyLabel">{g}</div>{items.filter(c=>!selectedProject||c.projectId===selectedProject).map(c=><div className={cx("historyRow",currentId===c.id&&"active")} key={c.id}><button className="historyItem" onClick={()=>onSelect(c.id)} title={c.title}>{c.title||"Conversație"}</button><button className="historyDelete" title="Șterge conversația" onClick={e=>{e.stopPropagation();onDeleteConversation(c.id)}}><Trash2 size={14}/></button></div>)}</div>)}
      </div>
    </div>
    <div className="accountArea"><div className="accountBadge"><div className="accountAvatar">{(user?.name||user?.email||"S")[0].toUpperCase()}</div><div className="accountText"><b>{user?.name||"Cont Stoica"}</b><span>{user?.email}</span></div></div><div className="accountButtons"><button onClick={onSettings}><Settings size={17}/> Setări</button><button onClick={onLogout}><LogOut size={17}/> Deconectare</button></div></div>
  </aside>;
}

function ModelPicker({model,onSelect,models,onRefresh,refreshing}) {
  const [open,setOpen]=useState(false),[query,setQuery]=useState("");
  const ref=useRef(null);
  useEffect(()=>{
    const close=e=>{if(!ref.current?.contains(e.target))setOpen(false)};
    const key=e=>{if(e.key==="Escape")setOpen(false)};
    document.addEventListener("mousedown",close);window.addEventListener("keydown",key);
    return()=>{document.removeEventListener("mousedown",close);window.removeEventListener("keydown",key)};
  },[]);
  useEffect(()=>{if(!open)setQuery("")},[open]);
  const list=uniqueModels([model,...models]).filter(x=>!/^ai[ _-]*(principal|stoica)$/i.test(x));
  const filtered=list.filter(x=>!query||x.toLowerCase().includes(query.toLowerCase()));
  return <div className="modelSelectCluster" ref={ref}>
    <div className="modelPicker">
      <button className={cx("modelPickerButton",open&&"open")} onClick={()=>setOpen(v=>!v)} aria-haspopup="listbox" aria-expanded={open}>
        <span className="modelPickerDot"/>
        <span className="modelPickerText"><b>{model||"Alege AI"}</b><small>{list.length} {list.length===1?"model permis":"modele permise"} · acces stabilit de Owner</small></span>
        <ChevronDown size={15}/>
      </button>
    {open&&<div className="modelPickerMenu">
      <div className="modelPickerHead"><div><b>Alege AI-ul</b><span>Schimbarea se aplică acestei conversații.</span></div><button className="modelRefresh" onClick={async e=>{e.stopPropagation();await onRefresh?.()}} disabled={refreshing} title="Actualizează modelele"><RotateCcw size={14}/></button></div>
      {list.length>7&&<div className="modelSearch"><Search size={14}/><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="Caută model"/></div>}
      <div className="modelPickerList" role="listbox">
        {filtered.map(x=><button key={x} className={cx("modelOption",x===model&&"active")} onClick={()=>{onSelect(x);setOpen(false)}} role="option" aria-selected={x===model}>
          <span className="modelOptionIcon"><Sparkles size={15}/></span>
          <span className="modelOptionCopy"><b>{x}</b><small>{x===model?(x==="Ai principal"?"Selectat · alege automat AI-ul potrivit":"Selectat acum"):(x==="Ai principal"?"Alege automat AI-ul potrivit":"Folosește acest AI")}</small></span>
          {x===model&&<Check size={16}/>}
        </button>)}
        {!filtered.length&&<div className="modelEmpty">Nu am găsit modelul căutat.</div>}
      </div>
      <div className="modelPickerFoot">{refreshing?"Actualizez lista de la OmniRoute…":"Alegi manual AI-ul. Owner-ul stabilește ce modele sunt disponibile pentru cont."}</div>
    </div>}
    </div>
  </div>;
}

function Header({onMenu,model,onSelectModel,models,onRefreshModels,refreshingModels,omni,onShare,current,projects,onDetach,onMoveProject,onFiles,onGitHub,onArchive,onDelete}) {
  const [more,setMore]=useState(false),[moveOpen,setMoveOpen]=useState(false);
  return <header className="topbar">
    <button className="iconOnly menuBtn" onClick={onMenu}><Menu size={20}/></button>
    <ModelPicker model={model} onSelect={onSelectModel} models={models} onRefresh={onRefreshModels} refreshing={refreshingModels}/>
    <div className="topSpacer"/>
    <div className={cx("connection",omni?"ok":"bad")}>{omni?<Wifi size={15}/>:<WifiOff size={15}/>} {omni?"OmniRoute conectat":"OmniRoute se reconectează"}</div>
    <button className="topAction" onClick={onShare}><Share2 size={16}/> Distribuie</button>
    <div className="moreWrap">
      <button className="iconOnly" onClick={()=>{setMore(!more);setMoveOpen(false)}}><MoreHorizontal size={20}/></button>
      {more&&<div className="conversationMenu">
        <button disabled={!current?.projectId} onClick={()=>{onDetach();setMore(false)}}><PanelTopOpen size={18}/> Detașează</button>
        <div className="menuSubWrap">
          <button disabled={!current} onClick={()=>setMoveOpen(!moveOpen)}><Folder size={18}/> Mută în proiect <span className="menuChevron">›</span></button>
          {moveOpen&&<div className="projectSubmenu">
            <button onClick={()=>{onMoveProject(null);setMore(false)}}>Fără proiect</button>
            {projects.map(p=><button key={p.id} onClick={()=>{onMoveProject(p.id);setMore(false)}}>{p.name}</button>)}
          </div>}
        </div>
        <div className="menuDivider"/>
        <button disabled={!current} onClick={()=>{onFiles();setMore(false)}}><Library size={18}/> Vizualizare fișiere din conversație</button>
        <button onClick={()=>{onGitHub();setMore(false)}}><Globe2 size={18}/> GitHub Solve</button>
        <div className="menuDivider"/>
        <button disabled={!current} onClick={()=>{onArchive();setMore(false)}}><Archive size={18}/> Arhivează</button>
        <button className="dangerMenuItem" disabled={!current} onClick={()=>{onDelete();setMore(false)}}><Trash2 size={18}/> Șterge</button>
      </div>}
    </div>
  </header>;
}

function CopyMessageButton({message,className=""}) {
  const [copied,setCopied]=useState(false);
  async function copy(){
    const ok=await writeClipboardText(messageText(message));
    if(!ok){alert("Nu am putut copia textul în clipboard.");return;}
    setCopied(true);setTimeout(()=>setCopied(false),1200);
  }
  return <button className={className} onClick={copy} title={copied?"Copiat":"Copiază mesajul"} aria-label="Copiază mesajul">{copied?<Check size={15}/>:<Copy size={15}/>}</button>;
}

function MessageActions({message,onRegenerate,onRate}) {
  async function exp(format){try{await exportMessageFile(message,format)}catch(e){alert("Export: "+e.message)}}
  return <div className="messageActions">
    <CopyMessageButton message={message}/>
    <button onClick={()=>exp("pdf")} title="Descarcă PDF"><span style={{fontSize:10,fontWeight:800}}>PDF</span></button>
    <button onClick={()=>exp("docx")} title="Descarcă DOCX"><span style={{fontSize:9,fontWeight:800}}>DOCX</span></button>
    <button onClick={()=>exp("pptx")} title="Descarcă PPTX"><span style={{fontSize:9,fontWeight:800}}>PPTX</span></button>
    <button className={message.rating===1?"selected":""} onClick={()=>onRate(1)}><ThumbsUp size={15}/></button>
    <button className={message.rating===-1?"selected":""} onClick={()=>onRate(-1)}><ThumbsDown size={15}/></button>
    <button onClick={onRegenerate}><RotateCcw size={15}/></button>
  </div>;
}

function GeneratedAttachment({attachment}) {
  const [src,setSrc]=useState("");
  const kind=attachment?.kind||attachment?.type||(String(attachment?.mimeType||"").startsWith("image/")?"image":String(attachment?.mimeType||"").startsWith("video/")?"video":String(attachment?.mimeType||"").startsWith("audio/")?"audio":"file");
  useEffect(()=>{
    let active=true,url="";
    if(!attachment?.id||!["image","video","audio"].includes(kind))return()=>{};
    (async()=>{try{
      const token=localStorage.getItem(TOKEN_KEY)||"";
      const r=await fetch(`${GATEWAY}/api/files/${attachment.id}`,{headers:token?{Authorization:`Bearer ${token}`}:{}});
      if(!r.ok)throw new Error("Media indisponibilă");
      const blob=await r.blob();if(!active)return;url=URL.createObjectURL(blob);setSrc(url);
    }catch{}})();
    return()=>{active=false;if(url)URL.revokeObjectURL(url)};
  },[attachment?.id,kind]);
  if(["image","video","audio"].includes(kind)){
    return <div className={cx("generatedMedia",kind)}>
      {src&&(kind==="image"?<img src={src} alt={attachment.name||"Imagine generată de AI Stoica"}/>:kind==="video"?<video controls preload="metadata" src={src}/>:<audio controls preload="metadata" src={src}/>)}
      <div className="generatedMediaBar"><span><b>{attachment.name}</b><small>{(attachment.mimeType||kind).replace(/^.*\//,"").toUpperCase()} · {formatBytes(attachment.size)}</small></span><button onClick={()=>downloadGeneratedFile(attachment)}><Download size={17}/> Download</button></div>
    </div>;
  }
  return <button className="generatedDownload" onClick={()=>downloadGeneratedFile(attachment)} title={"Descarcă "+attachment.name}><span className="generatedFileIcon"><FileText size={20}/></span><span className="generatedFileMeta"><b>{attachment.name}</b><small>{(attachment.format||attachment.name?.split(".").pop()||"FIȘIER").toUpperCase()} · {formatBytes(attachment.size)}</small></span><span className="generatedDownloadAction"><Download size={18}/><em>Download</em></span></button>;
}

function MediaAttachment({attachment}) {
  const [src,setSrc]=useState("");
  const kind=attachment?.type;
  useEffect(()=>{
    let active=true,url="";
    if(!attachment?.libraryId||!(kind==="audio"||kind==="video"))return()=>{};
    (async()=>{try{const blob=await fetchLibraryBlob(attachment.libraryId);if(!active)return;url=URL.createObjectURL(blob);setSrc(url)}catch{}})();
    return()=>{active=false;if(url)URL.revokeObjectURL(url)};
  },[attachment?.libraryId,kind]);
  if(!(kind==="audio"||kind==="video"))return <span><Paperclip size={12}/>{attachment?.name}</span>;
  return <div className={cx("messageMedia",kind)}>
    <div className="messageMediaHead"><span>{kind==="audio"?<Volume2 size={15}/>:<Play size={15}/>}<b>{attachment.name}</b></span><button title="Download" onClick={()=>downloadLibraryFile(attachment).catch(e=>alert(e.message))}><Download size={15}/></button></div>
    {src&&(kind==="audio"?<audio controls preload="metadata" src={src}/>:<video controls preload="metadata" src={src}/>)}
    {attachment.transcript&&<small>Vocalul / pista audio a fost transcrisă pentru AI Stoica.</small>}
  </div>;
}

function ConversationView({conversation,busy,busyStage,onRegenerate,onRate}) {
  const [contextMenu,setContextMenu]=useState(null);
  useEffect(()=>{
    const close=()=>setContextMenu(null);
    window.addEventListener("click",close);
    window.addEventListener("blur",close);
    window.addEventListener("scroll",close,true);
    return()=>{window.removeEventListener("click",close);window.removeEventListener("blur",close);window.removeEventListener("scroll",close,true)};
  },[]);
  function openCopyMenu(e,message){
    e.preventDefault();e.stopPropagation();
    const pre=e.target?.closest?.("pre");
    const code=e.target?.closest?.("code");
    const selection=String(window.getSelection?.()?.toString?.()||"").trim();
    const codeText=pre?.innerText||(code&&!pre?code.innerText:"");
    setContextMenu({
      x:Math.min(e.clientX,window.innerWidth-235),
      y:Math.min(e.clientY,window.innerHeight-150),
      messageText:messageText(message),
      codeText:String(codeText||"").trim(),
      selection
    });
  }
  async function copyValue(value){if(!value)return;const ok=await writeClipboardText(value);if(!ok)alert("Nu am putut copia textul în clipboard.");setContextMenu(null)}
  if(!conversation||!conversation.messages?.length)return <div className="welcome"><BrandMark/><h1>Cu ce lucrăm astăzi?</h1><p>Întreabă orice. AI Stoica poate folosi memoria, biblioteca, pluginurile și automatizările tale.</p></div>;
  return <div className="messagesColumn">
    {conversation.messages.map((m,i)=>m.role==="user"
      ?<div key={m.id||i} className="userRow"><div className="userMessageWrap"><div className="userBubble copyByRightClick" onContextMenu={e=>openCopyMenu(e,m)}><div>{messageText(m)}</div>{m.attachments?.length>0&&<div className="inlineAttachments mediaAttachments">{m.attachments.map((a,j)=><MediaAttachment key={a.libraryId||j} attachment={a}/>)}</div>}</div><div className="userMessageActions"><CopyMessageButton message={m}/></div></div></div>
      :m.role==="assistant"
        ?<div key={m.id||i} className="assistantBlock"><div className="assistantMark">S</div><div className="assistantBody copyByRightClick" onContextMenu={e=>openCopyMenu(e,m)}>
          {m.routeInfo&&<RouteBadge info={m.routeInfo}/>}
          {!m.attachmentOnly&&String(m.content||"").trim()&&<ReactMarkdown remarkPlugins={[remarkGfm]}>{String(m.content||"")}</ReactMarkdown>}
          {m.attachments?.length>0&&<div className="generatedFiles">{m.attachments.map((a,j)=><GeneratedAttachment key={a.id||j} attachment={a}/>)}</div>}
          {!m.streaming&&!m.attachmentOnly&&<MessageActions message={m} onRegenerate={()=>onRegenerate(i)} onRate={v=>onRate(i,v)}/>}
        </div></div>
        :null)}
    {busy&&<div className="thinking"><div className="thinkingPulse"><span/><span/><span/></div><div className="thinkingCopy"><b>{busyStage||"Gândește și pregătește răspunsul…"}</b><small>AI Stoica afișează etapa de lucru, nu raționamentul intern.</small></div></div>}
    {contextMenu&&<div className="copyContextMenu" style={{left:contextMenu.x,top:contextMenu.y}} onClick={e=>e.stopPropagation()}>
      {contextMenu.codeText&&<button onClick={()=>copyValue(contextMenu.codeText)}><Copy size={15}/><span><b>Copiază codul</b><small>Doar blocul de cod selectat</small></span></button>}
      {contextMenu.selection&&<button onClick={()=>copyValue(contextMenu.selection)}><Copy size={15}/><span><b>Copiază selecția</b><small>Textul pe care l-ai selectat</small></span></button>}
      <button onClick={()=>copyValue(contextMenu.messageText)}><Copy size={15}/><span><b>Copiază mesajul</b><small>Mesajul complet</small></span></button>
    </div>}
  </div>;
}

function Composer({centered,draft,setDraft,onSend,busy,attachments,setAttachments,onOpenLibrary}) {
  const ta=useRef(null),fileInput=useRef(null),imageInput=useRef(null),videoInput=useRef(null),audioInput=useRef(null),recorderRef=useRef(null),streamRef=useRef(null),chunksRef=useRef([]);
  const [menu,setMenu]=useState(false),[recording,setRecording]=useState(false),[transcribing,setTranscribing]=useState(false),[uploading,setUploading]=useState(false),[mentions,setMentions]=useState([]);
  useEffect(()=>{if(ta.current){ta.current.style.height="0px";ta.current.style.height=Math.min(ta.current.scrollHeight,190)+"px"}},[draft]);
  useEffect(()=>{
    function focusComposerFromKeyboard(e){
      if(e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey||e.isComposing)return;
      if(document.querySelector(".modalBackdrop"))return;
      const target=e.target;
      if(target?.closest?.('input,textarea,select,button,a,[contenteditable="true"]'))return;
      if(typeof e.key!=="string"||e.key.length!==1)return;
      // ChatGPT-like behavior: start typing anywhere in the conversation.
      // This includes Space, so the user never has to click the composer first.
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
  },[]);
  useEffect(()=>{(async()=>{try{const [p,a]=await Promise.all([api("/api/plugins"),api("/api/automations")]);setMentions([...(p.data||[]).filter(x=>x.enabled!==false).map(x=>({type:"plugin",name:x.name,trigger:x.trigger||("@"+x.name.toLowerCase().replace(/\s+/g,"-"))})),...(a.data||[]).filter(x=>x.enabled!==false).map(x=>({type:"automation",name:x.title,trigger:x.trigger||("@"+x.title.toLowerCase().replace(/\s+/g,"-"))}))])}catch{}})()},[]);
  const mentionMatch=draft.match(/@([^\s@]*)$/);
  const mentionQuery=(mentionMatch?.[1]||"").toLowerCase();
  const mentionOptions=mentionMatch?mentions.filter(x=>x.name.toLowerCase().includes(mentionQuery)||x.trigger.toLowerCase().includes("@"+mentionQuery)).slice(0,8):[];
  function insertMention(x){setDraft(v=>v.replace(/@([^\s@]*)$/,(x.trigger||"@"+x.name)+" "));setTimeout(()=>ta.current?.focus(),0)}
  async function addComposerFiles(files){
    if(!files?.length)return;
    setUploading(true);
    try{
      const next=[];
      for(const f of files){
        const item=await uploadFileToLibrary(f);
        next.push(await libraryItemToAttachment(item));
      }
      setAttachments(v=>[...v,...next]);
    }catch(err){alert("Fișier: "+err.message)}
    finally{setUploading(false)}
  }
  async function filesChosen(e){
    const input=e.target;
    await addComposerFiles([...input.files]);
    input.value="";
    setMenu(false);
  }
  async function pasteIntoComposer(e){
    const files=[...(e.clipboardData?.files||[])];
    if(files.length){
      e.preventDefault();
      await addComposerFiles(files);
      return;
    }
    const text=e.clipboardData?.getData("text/plain");
    if(!text)return;
    e.preventDefault();
    const el=e.currentTarget;
    const start=typeof el.selectionStart==="number"?el.selectionStart:draft.length;
    const end=typeof el.selectionEnd==="number"?el.selectionEnd:draft.length;
    const next=draft.slice(0,start)+text+draft.slice(end);
    setDraft(next);
    requestAnimationFrame(()=>{
      try{el.focus();el.selectionStart=el.selectionEnd=start+text.length}catch{}
    });
  }
  async function fallbackSpeech(){
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR)throw new Error("Recunoașterea vocală nu este disponibilă.");
    const r=new SR();r.lang="ro-RO";r.interimResults=false;
    r.onresult=e=>setDraft(v=>(v?v+" ":"")+e.results[0][0].transcript);
    r.onerror=e=>alert("Microfon: "+(e.error||"eroare de recunoaștere"));
    r.start();
  }
  async function mic(){
    if(recording&&recorderRef.current){recorderRef.current.stop();return;}
    try{
      if(!navigator.mediaDevices?.getUserMedia){await fallbackSpeech();return;}
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});streamRef.current=stream;chunksRef.current=[];
      const candidates=["audio/webm;codecs=opus","audio/webm","audio/ogg;codecs=opus"];
      const mime=candidates.find(x=>window.MediaRecorder?.isTypeSupported?.(x))||"";
      const rec=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);recorderRef.current=rec;
      rec.ondataavailable=e=>{if(e.data?.size)chunksRef.current.push(e.data)};
      rec.onerror=()=>{setRecording(false);stream.getTracks().forEach(t=>t.stop())};
      rec.onstop=async()=>{
        setRecording(false);setTranscribing(true);
        try{
          const blob=new Blob(chunksRef.current,{type:rec.mimeType||"audio/webm"});
          const ext=blob.type.includes("ogg")?"ogg":"webm";
          const stamp=new Date().toISOString().replace(/[:.]/g,"-");
          const voiceFile=new File([blob],`Vocal_AI_Stoica_${stamp}.${ext}`,{type:blob.type});
          const item=await uploadFileToLibrary(voiceFile);
          const attachment=await libraryItemToAttachment(item);
          setAttachments(v=>[...v,attachment]);
          if(attachment.transcript)setDraft(v=>(v?v+" ":"")+attachment.transcript);
          else alert("Vocalul a fost salvat și atașat, dar transcrierea automată nu a reușit.");
        }catch(e){
          alert("Vocalul nu a putut fi salvat sau transcris: "+e.message);
        }finally{setTranscribing(false);stream.getTracks().forEach(t=>t.stop());streamRef.current=null;}
      };
      rec.start();setRecording(true);
    }catch(e){
      try{await fallbackSpeech()}catch{alert("Accesul la microfon a fost refuzat sau microfonul nu este disponibil.")}
    }
  }
  return <div className={cx("composerDock",centered&&"centered")}>
    {mentionOptions.length>0&&<div className="mentionMenu">{mentionOptions.map((x,i)=><button key={x.type+x.trigger+i} onClick={()=>insertMention(x)}><span className={cx("mentionType",x.type)}>{x.type==="plugin"?<Plug size={14}/>:<CalendarClock size={14}/>}</span><span><b>{x.name}</b><small>{x.type==="plugin"?"Plugin":"Automatizare"} · {x.trigger}</small></span></button>)}</div>}
    <div className="composerCard">
      {attachments.length>0&&<div className="attachmentTray">{attachments.map((a,i)=><span className={a.type==="unsupported"||a.type==="stored"?"unsupported":""} key={i}>{a.type==="audio"?<Volume2 size={13}/>:a.type==="video"?<Play size={13}/>:<Paperclip size={13}/>} {a.name}<button onClick={()=>setAttachments(attachments.filter((_,j)=>j!==i))}><X size={13}/></button></span>)}</div>}
      <div className="composerLine">
        <input ref={fileInput} type="file" hidden multiple onChange={filesChosen}/>
        <input ref={imageInput} type="file" hidden multiple accept="image/png,image/jpeg,image/webp,image/gif,.heic,.heif" onChange={filesChosen}/>
        <input ref={videoInput} type="file" hidden multiple accept="video/mp4,video/webm,video/quicktime,.mp4,.mov,.m4v,.avi,.mkv,.mpeg,.mpg" onChange={filesChosen}/>
        <input ref={audioInput} type="file" hidden multiple accept="audio/mpeg,audio/mp3,audio/mp4,audio/x-m4a,audio/aac,audio/wav,audio/x-wav,audio/ogg,audio/flac,audio/opus,.mp3,.m4a,.aac,.wav,.ogg,.flac,.opus" onChange={filesChosen}/>
        <div className="attachWrap"><button className="composerIcon" onClick={()=>setMenu(!menu)} title="Fișiere și bibliotecă"><Plus size={21}/></button>{menu&&<div className="attachMenu"><button onClick={()=>fileInput.current?.click()}><Upload size={16}/> Încarcă orice fișier</button><button onClick={()=>{setMenu(false);onOpenLibrary()}}><Library size={16}/> Alege din Bibliotecă</button></div>}</div>
        <div className="mediaQuickButtons">
          <button className="composerIcon mediaQuick" onClick={()=>imageInput.current?.click()} title="Încarcă imagine"><ImageIcon size={19}/></button>
          <button className="composerIcon mediaQuick" onClick={()=>videoInput.current?.click()} title="Încarcă video MP4 / MOV / WebM"><Play size={19}/></button>
          <button className="composerIcon mediaQuick" onClick={()=>audioInput.current?.click()} title="Încarcă audio MP3 / M4A / WAV / OGG"><Volume2 size={19}/></button>
        </div>
        <textarea ref={ta} value={draft} onChange={e=>setDraft(e.target.value)} onPaste={pasteIntoComposer} spellCheck={true} aria-label="Mesaj pentru AI Stoica" placeholder={uploading?"Încarc fișierul…":recording?"Ascult… apasă microfonul pentru oprire":transcribing?"Transcriu vocea…":"Mesaj pentru AI Stoica"} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey&&!mentionOptions.length){e.preventDefault();onSend()}}}/>
        <button className={cx("composerIcon",recording&&"recording")} onClick={mic} title={recording?"Oprește vocalul":"Înregistrează vocal"} disabled={transcribing}><Mic size={20}/></button>
        <button className="sendButton" disabled={busy||recording||transcribing||uploading||(!draft.trim()&&!attachments.some(a=>a.part||a.parts?.length))} onClick={onSend}><ArrowUp size={20}/></button>
      </div>
    </div><div className="composerHint">{uploading?"Fișierul se salvează în Biblioteca AI Stoica — fără limită software de dimensiune":recording?"Microfon activ — vorbește acum":transcribing?"AI Stoica transcrie înregistrarea…":"AI Stoica poate greși. Verifică informațiile importante."}</div></div>;
}

function ToolShell({title,subtitle,onClose,children}) {
  return <div className="modalBackdrop"><div className="toolModal"><div className="toolHead"><div><h2>{title}</h2><p>{subtitle}</p></div><button className="iconOnly" onClick={onClose}><X size={20}/></button></div>{children}</div></div>;
}

function LibraryPanel({onClose,onAttach}) {
  const [items,setItems]=useState([]),[busy,setBusy]=useState(false),input=useRef(null);
  async function load(){setItems((await api("/api/library")).data||[])}
  useEffect(()=>{load()},[]);
  async function upload(e){
    setBusy(true);
    try{for(const f of [...e.target.files])await uploadFileToLibrary(f);await load()}
    catch(err){alert("Încărcare fișier: "+err.message)}
    finally{setBusy(false);e.target.value=""}
  }
  async function remove(id){if(confirm("Ștergi acest fișier din Bibliotecă?")){await api(`/api/library/${id}`,{method:"DELETE"});await load()}}
  async function attach(item){const a=await libraryItemToAttachment(item);onAttach?.(a);onClose()}
  return <ToolShell title="Bibliotecă" subtitle="Păstrează fișierele tale și refolosește-le în conversații." onClose={onClose}>
    <div className="toolActions"><button className="primary" onClick={()=>input.current?.click()}><Upload size={16}/> Adaugă fișiere</button><input ref={input} type="file" multiple hidden onChange={upload}/><span className="toolNote">Fără limită software de dimensiune. Limita reală este spațiul disponibil pe PC/server și limitele sistemului de fișiere.</span></div>
    <div className="libraryGrid">{items.length===0?<div className="emptyState"><HardDrive size={30}/>Biblioteca este goală.</div>:items.map(x=><div className="libraryCard" key={x.id}><div className="fileIcon">{x.kind==="image"?<ImageIcon size={22}/>:x.kind==="audio"?<Volume2 size={22}/>:x.kind==="video"?<Play size={22}/>:<FileText size={22}/>}</div><div className="fileMeta"><b>{x.name}</b><span>{x.kind==="audio"?"Audio":x.kind==="video"?"Video":x.kind==="image"?"Imagine":"Fișier"} · {formatBytes(x.size)} · {fmtTime(x.createdAt)}</span></div><button className="smallBtn" onClick={()=>attach(x)}>Folosește</button><button className="iconDanger" onClick={()=>remove(x.id)}><Trash2 size={16}/></button></div>)}</div>
    {busy&&<div className="toolStatus">Se încarcă fișierul… pentru fișiere mari poate dura.</div>}
  </ToolShell>;
}

function MemoryPanel({onClose}) {
  const [items,setItems]=useState([]),[enabled,setEnabled]=useState(true),[query,setQuery]=useState(""),[text,setText]=useState("");
  async function load(q=""){const d=await api(`/api/memory${q?`?q=${encodeURIComponent(q)}`:""}`);setItems(d.data||[]);setEnabled(d.enabled!==false)}
  useEffect(()=>{load()},[]);
  async function toggle(){const d=await api("/api/memory/toggle",{method:"POST",body:JSON.stringify({enabled:!enabled})});setEnabled(d.enabled)}
  async function add(){if(!text.trim())return;await api("/api/memory",{method:"POST",body:JSON.stringify({text,pinned:true})});setText("");await load(query)}
  async function pin(x){await api(`/api/memory/${x.id}`,{method:"PATCH",body:JSON.stringify({pinned:!x.pinned})});await load(query)}
  async function remove(id){await api(`/api/memory/${id}`,{method:"DELETE"});await load(query)}
  async function clear(){if(confirm("Ștergi toate memoriile AI Stoica pentru acest cont?")){await api("/api/memory",{method:"DELETE"});await load()}}
  async function importHistory(){const d=await api("/api/memory/import-history",{method:"POST",body:"{}"});alert(`Au fost importate ${d.count} fragmente din istoricul conversațiilor.`);await load()}
  return <ToolShell title="Memorie" subtitle="AI Stoica poate reține conversațiile și folosi informațiile relevante în discuțiile viitoare." onClose={onClose}>
    <div className="memoryTop"><button className={cx("memoryToggle",enabled&&"on")} onClick={toggle}>{enabled?<ToggleRight size={22}/>:<ToggleLeft size={22}/>} Memorie {enabled?"activă":"oprită"}</button><button className="secondary" onClick={importHistory}>Importă istoricul</button><button className="dangerButton" onClick={clear}><Trash2 size={15}/> Șterge tot</button></div>
    <div className="memoryAdd"><textarea value={text} onChange={e=>setText(e.target.value)} placeholder="Adaugă manual ceva important pe care AI Stoica să-l țină minte…"/><button className="primary" onClick={add}>Salvează în memorie</button></div>
    <div className="memorySearch"><Search size={15}/><input value={query} onChange={e=>{setQuery(e.target.value);load(e.target.value)}} placeholder="Caută în memorie"/></div>
    <div className="memoryList">{items.map(x=><div className="memoryItem" key={x.id}><button className="pinBtn" onClick={()=>pin(x)}>{x.pinned?<Pin size={16}/>:<PinOff size={16}/>}</button><div><p>{x.text}</p><span>{x.source} · {fmtTime(x.createdAt)}</span></div><button className="iconDanger" onClick={()=>remove(x.id)}><Trash2 size={15}/></button></div>)}</div>
  </ToolShell>;
}

function PluginsPanel({onClose}) {
  const blank={name:"",description:"",url:"",method:"POST",trigger:"",apiKey:"",auto:false,oauthClientId:"",oauthClientSecret:""};

  const appLinks={
    "Gmail":"https://mail.google.com/",
    "Google Drive":"https://drive.google.com/",
    "GitHub":"https://github.com/login",
    "Outlook Email":"https://outlook.office.com/mail/",
    "Adobe":"https://account.adobe.com/",
    "Figma":"https://www.figma.com/login",
    "Canva":"https://www.canva.com/login/",
    "Shopify":"https://admin.shopify.com/",
    "Atlassian Rovo":"https://id.atlassian.com/login",
    "monday.com":"https://auth.monday.com/",
    "Notion":"https://www.notion.so/login",
    "Google Calendar":"https://calendar.google.com/",
    "Slack":"https://slack.com/signin",
    "Teams":"https://teams.microsoft.com/",
    "Zoom":"https://zoom.us/signin",
    "Hostinger Mail":"https://mail.hostinger.com/",
    "Higgsfield":"https://higgsfield.ai/",
    "Runway":"https://app.runwayml.com/",
    "Supabase":"https://supabase.com/dashboard",
    "Render":"https://dashboard.render.com/",
    "Vercel":"https://vercel.com/login",
    "Railway":"https://railway.com/login",
    "Spotify":"https://open.spotify.com/",
    "HubSpot":"https://app.hubspot.com/login",
    "PostHog":"https://app.posthog.com/",
    "Amplitude":"https://app.amplitude.com/",
    "Typeform":"https://admin.typeform.com/"
  };
  const oauthProfiles={
    "Gmail":{provider:"google",authUrl:"https://accounts.google.com/o/oauth2/v2/auth",tokenUrl:"https://oauth2.googleapis.com/token",scopes:"openid email https://www.googleapis.com/auth/gmail.readonly",apiUrl:"https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10",method:"GET"},
    "Google Drive":{provider:"google-drive",authUrl:"https://accounts.google.com/o/oauth2/v2/auth",tokenUrl:"https://oauth2.googleapis.com/token",scopes:"openid email https://www.googleapis.com/auth/drive.readonly",apiUrl:"https://www.googleapis.com/drive/v3/files?pageSize=20&fields=files(id,name,mimeType,modifiedTime,webViewLink)",method:"GET"},
    "Google Calendar":{provider:"google-calendar",authUrl:"https://accounts.google.com/o/oauth2/v2/auth",tokenUrl:"https://oauth2.googleapis.com/token",scopes:"openid email https://www.googleapis.com/auth/calendar.readonly",apiUrl:"https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=20&singleEvents=true&orderBy=startTime",method:"GET"},
    "GitHub":{provider:"github",authUrl:"https://github.com/login/oauth/authorize",tokenUrl:"https://github.com/login/oauth/access_token",scopes:"read:user repo",apiUrl:"https://api.github.com/user/repos?sort=updated&per_page=20",method:"GET"},
    "Outlook Email":{provider:"microsoft-mail",authUrl:"https://login.microsoftonline.com/common/oauth2/v2.0/authorize",tokenUrl:"https://login.microsoftonline.com/common/oauth2/v2.0/token",scopes:"openid profile offline_access Mail.Read",apiUrl:"https://graph.microsoft.com/v1.0/me/messages?$top=10",method:"GET"},
    "Teams":{provider:"microsoft-teams",authUrl:"https://login.microsoftonline.com/common/oauth2/v2.0/authorize",tokenUrl:"https://login.microsoftonline.com/common/oauth2/v2.0/token",scopes:"openid profile offline_access User.Read Team.ReadBasic.All",apiUrl:"https://graph.microsoft.com/v1.0/me/joinedTeams",method:"GET"},
    "Slack":{provider:"slack",authUrl:"https://slack.com/oauth/v2/authorize",tokenUrl:"https://slack.com/api/oauth.v2.access",scopes:"channels:read users:read",apiUrl:"https://slack.com/api/conversations.list?limit=100",method:"GET",requiresSecret:true},
    "Notion":{provider:"notion",authUrl:"https://api.notion.com/v1/oauth/authorize",tokenUrl:"https://api.notion.com/v1/oauth/token",scopes:"",apiUrl:"https://api.notion.com/v1/search",method:"POST",requiresSecret:true},
    "Spotify":{provider:"spotify",authUrl:"https://accounts.spotify.com/authorize",tokenUrl:"https://accounts.spotify.com/api/token",scopes:"user-read-private user-read-email",apiUrl:"https://api.spotify.com/v1/me",method:"GET"}
  };

  const catalog=[
    // Populare
    {name:"Gmail",description:"Read and manage Gmail",trigger:"@gmail",group:"Populare",mark:"M",slug:"gmail"},
    {name:"Google Drive",description:"Drive, Docs, Sheets or Slides",trigger:"@drive",group:"Populare",mark:"△",slug:"googledrive"},
    {name:"GitHub",description:"Triage PRs, issues, and publish flows",trigger:"@github",group:"Populare",mark:"GH",slug:"github"},
    {name:"Remote Desktop Commander",description:"Build and automate, anywhere",trigger:"@remote",group:"Populare",mark:"DC"},
    {name:"Health",description:"Explore your health data in AI Stoica",trigger:"@health",group:"Populare",mark:"♥"},
    {name:"Outlook Email",description:"Triage Outlook inboxes",trigger:"@outlook",group:"Populare",mark:"O",slug:"microsoftoutlook"},

    // Noi și remarcabile
    {name:"Adobe",description:"Design, combine, and edit",trigger:"@adobe",group:"Noi și remarcabile",mark:"A",slug:"adobe"},
    {name:"Figma",description:"Create designs, ship to code",trigger:"@figma",group:"Noi și remarcabile",mark:"F",slug:"figma"},
    {name:"MagicPath",description:"Design on a shared canvas",trigger:"@magicpath",group:"Noi și remarcabile",mark:"MP"},
    {name:"Canva",description:"Create, review, edit designs",trigger:"@canva",group:"Noi și remarcabile",mark:"C",slug:"canva"},
    {name:"Shopify",description:"Create and manage your store",trigger:"@shopify",group:"Noi și remarcabile",mark:"S",slug:"shopify"},
    {name:"Atlassian Rovo",description:"Jira, Confluence, Loom, & more",trigger:"@rovo",group:"Noi și remarcabile",mark:"A",slug:"atlassian"},

    // Productivitate
    {name:"Firecrawl",description:"Search and extract web data",trigger:"@firecrawl",group:"Productivitate",mark:"🔥"},
    {name:"Flaim Fantasy",description:"Fantasy Sports Analysis",trigger:"@flaim",group:"Productivitate",mark:"FF"},
    {name:"monday.com",description:"Manage projects, tasks & CRM",trigger:"@monday",group:"Productivitate",mark:"M",slug:"mondaydotcom"},
    {name:"Notion",description:"Notion docs and workflows",trigger:"@notion",group:"Productivitate",mark:"N",slug:"notion"},
    {name:"Google Calendar",description:"Manage Google Calendar events",trigger:"@calendar",group:"Productivitate",mark:"31",slug:"googlecalendar"},
    {name:"Metricool",description:"Analyze and schedule posts",trigger:"@metricool",group:"Productivitate",mark:"∞"},

    // Comunicare
    {name:"Slack",description:"Read and manage Slack",trigger:"@slack",group:"Comunicare",mark:"S",slug:"slack"},
    {name:"Teams",description:"Summarize Teams and follow up",trigger:"@teams",group:"Comunicare",mark:"T",slug:"microsoftteams"},
    {name:"Zoom",description:"Insights from Zoom",trigger:"@zoom",group:"Comunicare",mark:"Z",slug:"zoom"},
    {name:"Superhuman Mail",description:"Best email+calendar assistant",trigger:"@superhuman",group:"Comunicare",mark:"✉"},
    {name:"Hostinger Mail",description:"Use Hostinger Mail",trigger:"@hostinger",group:"Comunicare",mark:"H",slug:"hostinger"},
    {name:"Mailopoly Inbox",description:"Search, send emails & messages",trigger:"@mailopoly",group:"Comunicare",mark:"◇"},

    // Creativitate
    {name:"Canva",description:"Create, review, edit designs",trigger:"@canva",group:"Creativitate",mark:"C",slug:"canva"},
    {name:"Higgsfield",description:"Every image and video model",trigger:"@higgsfield",group:"Creativitate",mark:"HF"},
    {name:"Figma",description:"Create designs, ship to code",trigger:"@figma",group:"Creativitate",mark:"F",slug:"figma"},
    {name:"Viewmax",description:"Create videos with AI",trigger:"@viewmax",group:"Creativitate",mark:"▶"},
    {name:"Runway",description:"Generate with every AI model",trigger:"@runway",group:"Creativitate",mark:"R",slug:"runway"},
    {name:"invideo",description:"Create videos of any length",trigger:"@invideo",group:"Creativitate",mark:"IV"},

    // Instrumente pentru dezvoltatori
    {name:"Supabase",description:"Manage and query databases",trigger:"@supabase",group:"Instrumente pentru dezvoltatori",mark:"S",slug:"supabase"},
    {name:"Render",description:"Manage Render resources",trigger:"@render",group:"Instrumente pentru dezvoltatori",mark:"R",slug:"render"},
    {name:"WPVibe",description:"AI WordPress tools",trigger:"@wpvibe",group:"Instrumente pentru dezvoltatori",mark:"WP"},
    {name:"Exa",description:"Web search for AI agents",trigger:"@exa",group:"Instrumente pentru dezvoltatori",mark:"E"},
    {name:"Vercel",description:"Build and deploy web apps and agents",trigger:"@vercel",group:"Instrumente pentru dezvoltatori",mark:"▲",slug:"vercel"},
    {name:"Railway",description:"Build and deploy apps",trigger:"@railway",group:"Instrumente pentru dezvoltatori",mark:"R",slug:"railway"},

    // Sănătate
    {name:"COROS",description:"Training and health insights",trigger:"@coros",group:"Sănătate",mark:"C",slug:"coros"},
    {name:"Tredict",description:"Analyze workouts, create plans",trigger:"@tredict",group:"Sănătate",mark:"T"},
    {name:"freddy",description:"Ask about your health data",trigger:"@freddy",group:"Sănătate",mark:"F"},
    {name:"Fitness AI Connector",description:"AI coach for your Garmin data",trigger:"@fitness",group:"Sănătate",mark:"AI"},
    {name:"Calorie Tracker",description:"Track your food and calories",trigger:"@calories",group:"Sănătate",mark:"CT"},
    {name:"LiftTrack",description:"Weightlifting For Garmin",trigger:"@lifttrack",group:"Sănătate",mark:"LT"},

    // Divertisment
    {name:"Destiny AI Astrology",description:"Birth Charts & Horoscopes",trigger:"@destiny",group:"Divertisment",mark:"D"},
    {name:"Smart Chess:Train+Learn to win",description:"Play+improve: coach+strategy",trigger:"@chess",group:"Divertisment",mark:"♞"},
    {name:"Spotify",description:"Music and podcasts for you",trigger:"@spotify",group:"Divertisment",mark:"●",slug:"spotify"},
    {name:"Chessy",description:"Play Chess Against AI Stoica",trigger:"@chessy",group:"Divertisment",mark:"♘"},
    {name:"SoundBreak",description:"Create AI Music with Artists",trigger:"@soundbreak",group:"Divertisment",mark:"◉"},
    {name:"PocketMind: Texas Hold'em",description:"Play Texas Hold'em with AI",trigger:"@pocketmind",group:"Divertisment",mark:"♠"},

    // Educație
    {name:"Consensus",description:"Explore scientific research",trigger:"@consensus",group:"Educație",mark:"C"},
    {name:"SciSpace",description:"For science and research",trigger:"@scispace",group:"Educație",mark:"S"},
    {name:"Acumen by Talarion",description:"Keep your AI up to date.",trigger:"@acumen",group:"Educație",mark:"T"},
    {name:"Explain Video Generator",description:"Free AI explainer video maker",trigger:"@explain",group:"Educație",mark:"▶"},
    {name:"Scite",description:"Search scientific literature",trigger:"@scite",group:"Educație",mark:"S"},
    {name:"Tarteel",description:"Explore Quranic resources",trigger:"@tarteel",group:"Educație",mark:"◇"},

    // Business și operațiuni
    {name:"HubSpot",description:"Insights to action in HubSpot",trigger:"@hubspot",group:"Business și operațiuni",mark:"H",slug:"hubspot"},
    {name:"Windsor.ai",description:"Connect 350+ data sources",trigger:"@windsor",group:"Business și operațiuni",mark:"W"},
    {name:"Adspirer",description:"Create, launch & analyze ads",trigger:"@adspirer",group:"Business și operațiuni",mark:"AD"},
    {name:"Shopify",description:"Create and manage your store",trigger:"@shopify",group:"Business și operațiuni",mark:"S",slug:"shopify"},
    {name:"vidIQ",description:"YouTube stats and keywords",trigger:"@vidiq",group:"Business și operațiuni",mark:"IQ"},
    {name:"Ubersuggest",description:"SEO research tools",trigger:"@ubersuggest",group:"Business și operațiuni",mark:"U"},

    // Date și analiză
    {name:"PostHog",description:"Analyze your product data",trigger:"@posthog",group:"Date și analiză",mark:"PH",slug:"posthog"},
    {name:"Helium 10",description:"Access your Helium 10 data",trigger:"@helium",group:"Date și analiză",mark:"H10"},
    {name:"Blockscout Blockchain Data",description:"Find & analyze blockchain data",trigger:"@blockscout",group:"Date și analiză",mark:"B",slug:"blockscout"},
    {name:"Data",description:"Answer questions with data",trigger:"@data",group:"Date și analiză",mark:"▥"},
    {name:"Amplitude",description:"Analyze your product data",trigger:"@amplitude",group:"Date și analiză",mark:"A",slug:"amplitude"},
    {name:"Typeform",description:"Build forms, analyze responses",trigger:"@typeform",group:"Date și analiză",mark:"T",slug:"typeform"},

    // Cercetare științifică
    {name:"Undermind",description:"Find and read research papers",trigger:"@undermind",group:"Cercetare științifică",mark:"U"},
    {name:"Inductive",description:"State-of-the-art ADMET models",trigger:"@inductive",group:"Cercetare științifică",mark:"I"},
    {name:"Boltz",description:"Predict structures, screen molecules and proteins",trigger:"@boltz",group:"Cercetare științifică",mark:"B"},
    {name:"Tamarind Bio",description:"Protein and molecular design",trigger:"@tamarind",group:"Cercetare științifică",mark:"TB"},
    {name:"Proto",description:"Biological AI models and tools",trigger:"@proto",group:"Cercetare științifică",mark:"P"},
    {name:"Rowan",description:"Chemistry & Biology Simulation",trigger:"@rowan",group:"Cercetare științifică",mark:"R"},

    // Securitate
    {name:"Codex Security",description:"Security scanning for your codebase",trigger:"@codexsecurity",group:"Securitate",mark:"CS"},
    {name:"PrivacyHawk",description:"Protect your personal data",trigger:"@privacyhawk",group:"Securitate",mark:"PH"},
    {name:"Soluvery",description:"Audit Google Drive Permissions",trigger:"@soluvery",group:"Securitate",mark:"S"},
    {name:"Malwarebytes",description:"Verify links, domains, phones.",trigger:"@malwarebytes",group:"Securitate",mark:"M",slug:"malwarebytes"},
    {name:"AJAXX Data Scrubber",description:"Remove exposed personal data",trigger:"@ajaxx",group:"Securitate",mark:"AX"},
    {name:"Ansvar Gateway",description:"Laws, Security and Compliance",trigger:"@ansvar",group:"Securitate",mark:"AI"},

    // Altele
    {name:"Tarot",description:"Tarot Reading & Divination",trigger:"@tarot",group:"Altele",mark:"✦"},
    {name:"Astrologic",description:"Birth charts and horoscopes",trigger:"@astrologic",group:"Altele",mark:"☾"},
    {name:"Kleinanzeigen",description:"Echte Deals. Echte Menschen.",trigger:"@kleinanzeigen",group:"Altele",mark:"K",slug:"kleinanzeigen"},
    {name:"Ask Tarot Cards",description:"Tarot card readings",trigger:"@asktarot",group:"Altele",mark:"☀"},
    {name:"Steer Astro",description:"Your Personal AI Astrologer",trigger:"@steerastro",group:"Altele",mark:"◎"},
    {name:"Astro Scope Tarot",description:"Daily & 3-card tarot reads",trigger:"@astroscope",group:"Altele",mark:"◇"}
  ];

  const categoryOrder=[
    "Populare","Noi și remarcabile","Productivitate","Comunicare","Creativitate",
    "Instrumente pentru dezvoltatori","Sănătate","Divertisment","Educație",
    "Business și operațiuni","Date și analiză","Cercetare științifică","Securitate","Altele"
  ];
  const skills=[
    {name:"Căutare web",description:"Caută informații actuale și surse online.",mark:"W"},
    {name:"Documente",description:"Generează și lucrează cu PDF, DOCX și PPTX.",mark:"D"},
    {name:"Cod",description:"Analizează cod și lucrează cu GitHub.",mark:"</>"},
    {name:"Imagini",description:"Creează și editează imagini cu AI.",mark:"I"},
    {name:"Date",description:"Analizează fișiere, tabele și rezultate.",mark:"∑"},
    {name:"Automatizări",description:"Rulează sarcini programate și monitorizări.",mark:"A"}
  ];

  const [items,setItems]=useState([]),[form,setForm]=useState(blank),[result,setResult]=useState("");
  const [topTab,setTopTab]=useState("plugins"),[scope,setScope]=useState("public"),[query,setQuery]=useState(""),[selected,setSelected]=useState(null);

  async function load(){setItems((await api("/api/plugins")).data||[])}
  useEffect(()=>{load()},[]);

  async function add(){
    if(!form.name.trim()||!form.url.trim())return;
    await api("/api/plugins",{method:"POST",body:JSON.stringify(form)});
    setForm(blank);setSelected(null);await load()
  }
  async function patch(x,p){await api(`/api/plugins/${x.id}`,{method:"PATCH",body:JSON.stringify(p)});await load()}
  async function test(x){try{const d=await api(`/api/plugins/${x.id}/test`,{method:"POST",body:JSON.stringify({message:"Test conexiune AI Stoica"})});setResult(`${x.name}: ${d.result}`)}catch(e){setResult(`${x.name}: Eroare — ${e.message}`)}}
  async function remove(id){if(confirm("Ștergi această conexiune?")){await api(`/api/plugins/${id}`,{method:"DELETE"});await load()}}
  async function connectOAuth(){
    if(!selected?.oauth)return;
    if(!form.oauthClientId.trim()){setResult(`${selected.name}: lipsește OAuth Client ID.`);return}
    if(selected.oauth.requiresSecret&&!form.oauthClientSecret.trim()){setResult(`${selected.name}: acest serviciu necesită și OAuth Client Secret.`);return}
    try{
      const d=await api("/api/plugins/oauth/start",{method:"POST",body:JSON.stringify({
        name:form.name||selected.name,description:form.description||selected.description,trigger:form.trigger||selected.trigger,auto:form.auto,
        clientId:form.oauthClientId.trim(),clientSecret:form.oauthClientSecret.trim(),...selected.oauth
      })});
      const opened=await window.AIStoica?.openExternal?.(d.authorizeUrl);
      if(opened&&!opened.ok)throw new Error(opened.error||"Nu am putut deschide pagina OAuth.");
      setResult(`${selected.name}: autentificarea OAuth s-a deschis în browser. Finalizează autorizarea; AI Stoica va salva conexiunea automat.`);
      const started=Date.now();
      const timer=setInterval(async()=>{
        try{
          const fresh=(await api("/api/plugins")).data||[];
          const connected=fresh.find(x=>String(x.name).toLowerCase()===String(selected.name).toLowerCase()&&x.oauthConnected);
          if(connected||Date.now()-started>120000){
            clearInterval(timer);
            await load();
            if(connected){setResult(`${selected.name}: conectat cu succes.`);closeSetup()}
          }
        }catch{}
      },2000);
    }catch(e){setResult(`${selected.name}: Eroare OAuth — ${e.message}`)}
  }
  function chooseCatalog(x){setSelected({...x,appUrl:appLinks[x.name]||"",oauth:oauthProfiles[x.name]||null});setForm({...blank,name:x.name,description:x.description,trigger:x.trigger})}
  function closeSetup(){setSelected(null);setForm(blank)}
  function iconUrl(x){return x.slug?`https://cdn.simpleicons.org/${x.slug}`:null}
  async function openProviderApp(){
    const url=selected?.appUrl;
    if(!url)return;
    try{
      await api("/api/plugins/direct",{method:"POST",body:JSON.stringify({
        name:selected.name,description:selected.description,trigger:selected.trigger,appUrl:url
      })});
      await load();
      const r=await window.AIStoica?.openExternal?.(url);
      if(r&&!r.ok)throw new Error(r.error||"Nu am putut deschide aplicația.");
      setResult(`${selected.name}: conectat pentru deschidere directă, fără OAuth. Autentifică-te normal în aplicația oficială.`);
      closeSetup();
    }catch(e){setResult(`${selected.name}: ${e.message}`)}
  }
  async function runInstalledPlugin(x){
    if(x.mode==="direct_app"&&(x.appUrl||x.url)){
      const r=await window.AIStoica?.openExternal?.(x.appUrl||x.url);
      if(r&&!r.ok)setResult(`${x.name}: nu am putut deschide aplicația — ${r.error||"eroare"}`);
      else setResult(`${x.name}: aplicația a fost deschisă.`);
      return;
    }
    await test(x);
  }

  const installedNames=new Set(items.map(x=>String(x.name||"").toLowerCase()));
  const normalized=query.trim().toLowerCase();
  const filtered=catalog.filter(x=>!normalized||x.name.toLowerCase().includes(normalized)||x.description.toLowerCase().includes(normalized)||x.group.toLowerCase().includes(normalized));
  const groups=categoryOrder.map(group=>({group,items:filtered.filter(x=>x.group===group)})).filter(x=>x.items.length);

  return <ToolShell title="" subtitle="" onClose={onClose}>
    <div className="stoicaPluginStore">
      <div className="stoicaPluginTop">
        <div className="stoicaPluginMainTabs">
          <button className={topTab==="plugins"?"active":""} onClick={()=>setTopTab("plugins")}>Pluginuri</button>
          <button className={topTab==="skills"?"active":""} onClick={()=>setTopTab("skills")}>Competențe</button>
        </div>
        <button className="stoicaAddButton" onClick={()=>chooseCatalog({name:"Plugin personalizat",description:"Conectează orice API, endpoint sau webhook compatibil.",trigger:"@plugin",group:"Personal",mark:"+"})}><Plus size={15}/> Adaugă</button>
      </div>

      <div className="stoicaPluginSearch"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder={topTab==="plugins"?"Caută pluginuri":"Caută competențe"}/></div>

      {topTab==="plugins"?<>
        {!!items.length&&<section className="stoicaInstalled">
          <button className="stoicaSectionTitle" onClick={()=>{}}>Instalate <span>›</span></button>
          <div className="stoicaInstalledIcons">
            {items.slice(0,8).map(x=><button key={x.id} className="stoicaInstalledIcon" title={x.name} onClick={()=>runInstalledPlugin(x)}>
              <span>{String(x.name||"P").slice(0,2).toUpperCase()}</span>
            </button>)}
          </div>
          {result&&<div className="pluginResult claudeResult">{result}</div>}
        </section>}

        <div className="stoicaScopeTabs">
          <button className={scope==="public"?"active":""} onClick={()=>setScope("public")}>Publice</button>
          <button className={scope==="personal"?"active":""} onClick={()=>setScope("personal")}>Personale</button>
        </div>

        {scope==="personal"?<div className="stoicaPersonalList">
          {!items.length?<div className="stoicaPluginEmpty">Nu ai încă pluginuri personale configurate. Apasă „Adaugă” pentru a conecta unul.</div>:
          items.map(x=><div className="stoicaManageRow" key={x.id}>
            <div className="stoicaPluginLogo"><span>{String(x.name||"P").slice(0,2).toUpperCase()}</span></div>
            <div className="stoicaPluginInfo"><b>{x.name}</b><small>{x.description||x.url}</small></div>
            <button className="smallBtn" onClick={()=>runInstalledPlugin(x)}>{x.mode==="direct_app"?"Deschide":"Testează"}</button>
            <button className={cx("claudeToggle",x.enabled&&"on")} onClick={()=>patch(x,{enabled:!x.enabled})}><span/></button>
            <button className="iconDanger" onClick={()=>remove(x.id)}><Trash2 size={16}/></button>
          </div>)}
        </div>:
        <div className="stoicaCatalog">
          {groups.map(({group,items:groupItems})=><section className="stoicaPluginSection" key={group}>
            <button className="stoicaSectionTitle">{group} <span>›</span></button>
            <div className="stoicaPluginGrid">
              {groupItems.map((x,i)=>{
                const connected=installedNames.has(x.name.toLowerCase());
                const src=iconUrl(x);
                return <button className="stoicaPluginCard" key={x.group+x.name+i} onClick={()=>chooseCatalog(x)}>
                  <span className="stoicaPluginLogo">
                    {src?<img src={src} alt="" onError={e=>{e.currentTarget.style.display="none";e.currentTarget.nextSibling.style.display="grid"}}/>:null}
                    <span style={{display:src?"none":"grid"}}>{x.mark}</span>
                  </span>
                  <span className="stoicaPluginInfo"><b>{x.name}</b><small>{x.description}</small></span>
                  <span className={cx("stoicaPluginAdd",connected&&"connected")}>{connected?<Check size={15}/>:<Plus size={18}/>}</span>
                </button>
              })}
            </div>
          </section>)}
          {!groups.length&&<div className="stoicaPluginEmpty">Nu am găsit pluginul căutat.</div>}
        </div>}
      </>:
      <div className="stoicaSkillsGrid">
        {skills.filter(x=>!normalized||x.name.toLowerCase().includes(normalized)||x.description.toLowerCase().includes(normalized)).map(x=><div className="stoicaSkillCard" key={x.name}>
          <span className="stoicaPluginLogo"><span>{x.mark}</span></span>
          <div><b>{x.name}</b><small>{x.description}</small></div>
          <Check size={16}/>
        </div>)}
      </div>}

      {selected&&<div className="claudeSetupBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget)closeSetup()}}>
        <div className="claudeSetupPanel">
          <div className="claudeSetupHead">
            <div className="claudePluginLogo large">{selected.mark}</div>
            <div><h3>{selected.name}</h3><p>{selected.description}</p></div>
            <button className="iconOnly" onClick={closeSetup}><X size={18}/></button>
          </div>
          <div className="claudeSetupNotice"><Plug size={16}/><span>Poți folosi pluginul fără OAuth pentru deschiderea directă a aplicației. OAuth/API rămâne opțional doar când vrei ca AI Stoica să citească sau să modifice date private din acel serviciu.</span></div>
          {selected.appUrl&&<div className="pluginDirectConnect">
            <button className="primary" onClick={openProviderApp}><ExternalLink size={16}/> Conectează fără OAuth și deschide {selected.name}</button>
            <small>AI Stoica salvează pluginul ca legătură directă și deschide aplicația oficială. Te autentifici normal în browser/aplicație.</small>
          </div>}
          <div className="claudeSetupForm">
            <label>Nume<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
            {selected.oauth&&<>
              <label>OAuth Client ID<input placeholder="Client ID al aplicației AI Stoica" value={form.oauthClientId} onChange={e=>setForm({...form,oauthClientId:e.target.value})}/></label>
              <label>OAuth Client Secret <span className="optional">{selected.oauth.requiresSecret?"necesar":"opțional / PKCE"}</span><input type="password" placeholder="Client Secret" value={form.oauthClientSecret} onChange={e=>setForm({...form,oauthClientSecret:e.target.value})}/></label>
              <button type="button" className="secondary pluginOAuthButton" onClick={connectOAuth}><ExternalLink size={15}/> OAuth avansat pentru acces la date</button>
            </>}
            <label>Endpoint / webhook / API personalizat<input placeholder="https://…" value={form.url} onChange={e=>setForm({...form,url:e.target.value})}/></label>
            <div className="claudeFormRow"><label>Trigger<input placeholder="@gmail" value={form.trigger} onChange={e=>setForm({...form,trigger:e.target.value})}/></label><label>Metodă<select value={form.method} onChange={e=>setForm({...form,method:e.target.value})}><option>POST</option><option>GET</option></select></label></div>
            <label>API key <span className="optional">opțional</span><input type="password" placeholder="Cheie / token" value={form.apiKey} onChange={e=>setForm({...form,apiKey:e.target.value})}/></label>
            <label className="claudeAutoRow"><span><b>Folosește automat</b><small>Permite pluginului să fie inclus automat când este relevant.</small></span><input type="checkbox" checked={form.auto} onChange={e=>setForm({...form,auto:e.target.checked})}/></label>
          </div>
          <div className="claudeSetupActions"><button className="secondary" onClick={closeSetup}>Anulează</button><button className="primary" disabled={!form.name.trim()||!form.url.trim()} onClick={add}>Conectează API personalizat</button></div>
        </div>
      </div>}
    </div>
  </ToolShell>;
}

function AdminPanel({onClose}) {
  const permissionLabels={
    chat:"Chat AI",cerebras:"Cerebras",gemini:"Gemini",groq:"Groq",cloudflare:"Cloudflare AI",
    openrouter:"OpenRouter (poate genera costuri)",image_generation:"Generare imagini",video_generation:"Generare videoclipuri",document_generation:"Fișiere: PDF / Word / PowerPoint / Excel / CSV / ZIP / cod",
    file_upload:"Încărcare fișiere",web_search:"Căutare web",deep_research:"Deep Research",
    automations:"Automatizări",plugins:"Pluginuri",github_access:"GitHub",openai:"OpenAI (plătit)",anthropic:"Claude / Anthropic (plătit)"
  };
  const statusLabels={pending:"În așteptare",active:"Activ",rejected:"Respins",suspended:"Suspendat",blocked:"Blocat"};
  const [users,setUsers]=useState([]),[selectedId,setSelectedId]=useState(null),[filter,setFilter]=useState("all");
  const [paidAi,setPaidAi]=useState(false),[auditRows,setAuditRows]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState("");
  async function load(){
    setBusy(true);setError("");
    try{
      const [u,a,l]=await Promise.all([
        api("/api/admin/users"),
        api("/api/admin/ai"),
        api("/api/admin/audit?limit=50")
      ]);
      const rows=u.data||[];setUsers(rows);setPaidAi(!!a.paidAiEnabled);setAuditRows(l.data||[]);
      setSelectedId(v=>v&&rows.some(x=>x.id===v)?v:(rows.find(x=>x.status==="pending"&&x.role!=="owner")?.id||rows.find(x=>x.role!=="owner")?.id||null));
    }catch(e){setError(e.message)}finally{setBusy(false)}
  }
  useEffect(()=>{load()},[]);
  const selected=users.find(x=>x.id===selectedId)||null;
  const pendingCount=users.filter(x=>x.status==="pending").length;
  const activeCount=users.filter(x=>x.status==="active").length;
  const visible=users.filter(x=>filter==="all"||x.status===filter);

  async function setStatus(user,status){
    if(!user||user.role==="owner")return;
    if((status==="blocked"||status==="rejected")&&!confirm(`Confirmi statusul „${statusLabels[status]}” pentru ${user.email}?`))return;
    try{
      await api(`/api/admin/users/${user.id}/status`,{method:"PATCH",body:JSON.stringify({status})});
      await load();
    }catch(e){alert("Administrare: "+e.message)}
  }
  async function togglePermission(user,key,value){
    if(!user||user.role==="owner")return;
    try{
      const d=await api(`/api/admin/users/${user.id}/permissions`,{method:"PATCH",body:JSON.stringify({permissions:{[key]:value}})});
      setUsers(rows=>rows.map(x=>x.id===user.id?{...x,permissions:d.permissions||x.permissions}:x));
    }catch(e){alert("Permisiuni: "+e.message)}
  }
  async function revokeSessions(user){
    if(!user||user.role==="owner")return;
    if(!confirm(`Închizi toate sesiunile active pentru ${user.email}?`))return;
    try{await api(`/api/admin/users/${user.id}/sessions/revoke`,{method:"POST",body:"{}"});await load()}
    catch(e){alert("Sesiuni: "+e.message)}
  }
  async function togglePaid(){
    const next=!paidAi;
    const message=next
      ?"Activezi comutatorul principal pentru AI plătit? Utilizatorii NU primesc automat acces: fiecare are nevoie în continuare de permisiunile OpenAI / Claude / OpenRouter acordate de Owner."
      :"Dezactivezi explicit AI-ul plătit la nivel global? Aceasta va bloca modelele plătite pentru toate conturile până când le reactivezi din Control Center.";
    if(!confirm(message))return;
    try{
      const d=await api("/api/admin/ai",{method:"PATCH",body:JSON.stringify({paidAiEnabled:next})});
      setPaidAi(!!d.paidAiEnabled);
    }catch(e){alert("AI plătit: "+e.message)}
  }

  return <ToolShell title="AI Stoica Control Center" subtitle="Owner: utilizatori, aprobări, permisiuni, sesiuni și servicii AI." onClose={onClose}>
    <div className="adminPanel">
      {error&&<div className="authError">{error}</div>}
      <div className="adminSummary">
        <div><span>Utilizatori</span><b>{users.length}</b></div>
        <div className={pendingCount?"warn":""}><span>În așteptare</span><b>{pendingCount}</b></div>
        <div><span>Activi</span><b>{activeCount}</b></div>
        <button className={cx("adminPaidAi",paidAi&&"on")} onClick={togglePaid} title="Comutator principal. Accesul individual se acordă separat fiecărui utilizator."><span>AI plătit · MASTER</span><b>{paidAi?"PORNIT":"OPRIT"}</b></button>
      </div>

      <div className="adminToolbar">
        <div className="adminFilters">
          {[["all","Toți"],["pending","În așteptare"],["active","Activi"],["suspended","Suspendați"],["blocked","Blocați"]].map(([k,label])=><button key={k} className={filter===k?"active":""} onClick={()=>setFilter(k)}>{label}</button>)}
        </div>
        <button className="secondary" onClick={load} disabled={busy}><RotateCcw size={15}/> {busy?"Actualizez…":"Actualizează"}</button>
      </div>

      <div className="adminLayout">
        <div className="adminUsers">
          {visible.map(u=><button key={u.id} className={cx("adminUserRow",selectedId===u.id&&"active")} onClick={()=>setSelectedId(u.id)}>
            <span className="accountAvatar">{(u.name||u.email||"U")[0].toUpperCase()}</span>
            <span className="adminUserCopy"><b>{u.name||u.email}</b><small>{u.email}</small></span>
            <span className={cx("adminStatus","s-"+u.status)}>{u.role==="owner"?"Owner":statusLabels[u.status]||u.status}</span>
          </button>)}
          {!visible.length&&<div className="stoicaPluginEmpty">Nu există utilizatori în această categorie.</div>}
        </div>

        <div className="adminDetail">
          {!selected?<div className="stoicaPluginEmpty">Selectează un utilizator.</div>:<>
            <div className="adminIdentity">
              <div className="accountAvatar big">{(selected.name||selected.email||"U")[0].toUpperCase()}</div>
              <div><h3>{selected.name||"Utilizator"}</h3><p>{selected.email}</p><small>{selected.role==="owner"?"Owner":"Utilizator"} · {statusLabels[selected.status]||selected.status} · {Number(selected.active_sessions||0)} sesiuni active</small></div>
            </div>

            {selected.role!=="owner"&&<div className="adminApprovalActions">
              {selected.status!=="active"&&<button className="primary" onClick={()=>setStatus(selected,"active")}><Check size={15}/> Aprobă / Reactivează</button>}
              {selected.status!=="suspended"&&<button className="secondary" onClick={()=>setStatus(selected,"suspended")}>Suspendă</button>}
              {selected.status!=="blocked"&&<button className="dangerButton" onClick={()=>setStatus(selected,"blocked")}>Blochează</button>}
              {selected.status==="pending"&&<button className="secondary" onClick={()=>setStatus(selected,"rejected")}><X size={15}/> Respinge</button>}
              <button className="secondary" onClick={()=>revokeSessions(selected)}>Închide sesiunile</button>
            </div>}

            <div className="adminPermissionHead"><div><h4>Permisiuni</h4><p>Se aplică server-side pentru acest cont.</p></div></div>
            <div className="adminPermissions">
              {Object.entries(permissionLabels).map(([key,label])=>{
                const checked=selected.role==="owner"?true:selected.permissions?.[key]===true;
                return <label key={key} className={cx("adminPermission",selected.role==="owner"&&"locked")}>
                  <span><b>{label}</b><small>{key}</small></span>
                  <input type="checkbox" checked={checked} disabled={selected.role==="owner"} onChange={e=>togglePermission(selected,key,e.target.checked)}/>
                </label>
              })}
            </div>
          </>}
        </div>
      </div>

      <details className="adminAudit">
        <summary>Jurnal administrativ ({auditRows.length})</summary>
        <div className="adminAuditList">
          {auditRows.map((x,i)=><div key={x.id||i}><b>{x.action}</b><span>{x.actor_email||"sistem"} → {x.target_email||"—"}</span><small>{fmtTime(x.created_at)}</small></div>)}
        </div>
      </details>
    </div>
  </ToolShell>;
}

function AutomationsPanel({onClose,model}) {
  const blank={title:"",prompt:"",trigger:"",frequency:"daily",time:"09:00",weekday:1,days:[1,2,3,4,5,6,0],runAt:""};
  const dayNames=[[1,"L"],[2,"Ma"],[3,"Mi"],[4,"J"],[5,"V"],[6,"S"],[0,"D"]];
  const [items,setItems]=useState([]),[form,setForm]=useState(blank),[busy,setBusy]=useState(false);
  async function load(){setItems((await api("/api/automations")).data||[])}
  useEffect(()=>{load()},[]);
  async function add(){if(!form.title.trim()||!form.prompt.trim())return;await api("/api/automations",{method:"POST",body:JSON.stringify({...form,runAt:form.frequency==="once"?Date.parse(form.runAt||""):null,model})});setForm(blank);await load()}
  async function patch(x,p){await api(`/api/automations/${x.id}`,{method:"PATCH",body:JSON.stringify(p)});await load()}
  async function run(x){setBusy(true);try{await api(`/api/automations/${x.id}/run`,{method:"POST",body:"{}"});await load()}finally{setBusy(false)}}
  async function remove(id){await api(`/api/automations/${id}`,{method:"DELETE"});await load()}
  function toggleDay(d){setForm(v=>({...v,days:v.days.includes(d)?v.days.filter(x=>x!==d):[...v.days,d]}))}
  return <ToolShell title="Automatizări" subtitle="Creează sarcini recurente. În chat scrie @ și poți insera automatizarea după nume." onClose={onClose}>
    <div className="automationForm"><input placeholder="Titlu, ex. Rezumat zilnic" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/><input placeholder="Trigger opțional, ex. @rezumat-zilnic" value={form.trigger} onChange={e=>setForm({...form,trigger:e.target.value})}/><textarea placeholder="Ce trebuie să facă AI Stoica?" value={form.prompt} onChange={e=>setForm({...form,prompt:e.target.value})}/><div className="automationRow"><select value={form.frequency} onChange={e=>setForm({...form,frequency:e.target.value})}><option value="hourly">La fiecare oră</option><option value="daily">În fiecare zi</option><option value="selected_days">În anumite zile</option><option value="weekly">O dată pe săptămână</option><option value="once">O singură dată</option></select>{form.frequency!=="hourly"&&form.frequency!=="once"&&<input type="time" value={form.time} onChange={e=>setForm({...form,time:e.target.value})}/>} {form.frequency==="once"&&<input type="datetime-local" value={form.runAt} onChange={e=>setForm({...form,runAt:e.target.value})}/>} {form.frequency==="weekly"&&<select value={form.weekday} onChange={e=>setForm({...form,weekday:Number(e.target.value)})}><option value={1}>Luni</option><option value={2}>Marți</option><option value={3}>Miercuri</option><option value={4}>Joi</option><option value={5}>Vineri</option><option value={6}>Sâmbătă</option><option value={0}>Duminică</option></select>}</div>{form.frequency==="selected_days"&&<div className="dayPicker">{dayNames.map(([d,n])=><button type="button" key={d} className={form.days.includes(d)?"active":""} onClick={()=>toggleDay(d)}>{n}</button>)}</div>}<button className="primary" onClick={add}><Plus size={16}/> Creează automatizare</button></div>
    <div className="automationList">{items.map(x=><div className="automationCard" key={x.id}><div className="automationIcon"><CalendarClock size={20}/></div><div className="automationInfo"><b>{x.title}</b><span>{x.trigger||"@automatizare"} · {x.frequency} · următoarea: {fmtTime(x.nextRunAt)}</span><p>{x.prompt}</p>{x.lastResult&&<details><summary>Ultimul rezultat · {fmtTime(x.lastRunAt)}</summary><div className="lastResult">{x.lastResult}</div></details>}</div><button className="iconOnly" disabled={busy} onClick={()=>run(x)} title="Rulează acum"><Play size={16}/></button><button className="smallBtn" onClick={()=>patch(x,{enabled:!x.enabled})}>{x.enabled?"Activ":"Oprit"}</button><button className="iconDanger" onClick={()=>remove(x.id)}><Trash2 size={16}/></button></div>)}</div>
  </ToolShell>;
}

function ExplorePanel({onClose,assistants,models,onUseAssistant,onImagePrompt,onOpenLibrary}) {
  const [mapQuery,setMapQuery]=useState(""),[site,setSite]=useState("");
  async function open(url){const r=await window.AIStoica.openExternal(url);if(r&&!r.ok)alert(r.error||"Nu am putut deschide pagina.")}
  function openMap(provider){
    const q=mapQuery.trim();if(!q)return;
    if(provider==="osm")open(`https://www.openstreetmap.org/search?query=${encodeURIComponent(q)}`);
    else open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`);
  }
  function openSite(){
    let u=site.trim();if(!u)return;if(!/^https?:\/\//i.test(u))u=`https://${u}`;open(u);
  }
  const imageModel=models.find(x=>/image|imagine|flux|banana/i.test(x));
  return <ToolShell title="Explorează" subtitle="Un singur loc pentru hărți, imagini, GPT-uri și site-uri." onClose={onClose}>
    <div className="exploreGrid">
      <section className="exploreCard"><div className="exploreIcon"><Map size={22}/></div><h3>Hărți</h3><p>Caută o adresă, localitate sau punct de interes.</p><input value={mapQuery} onChange={e=>setMapQuery(e.target.value)} placeholder="Ex. Primăria Cornetu"/><div className="exploreActions"><button className="primary" onClick={()=>openMap("google")}>Google Maps</button><button className="secondary" onClick={()=>openMap("osm")}>OpenStreetMap</button></div></section>
      <section className="exploreCard"><div className="exploreIcon"><ImageIcon size={22}/></div><h3>Imagini</h3><p>Pornește direct o conversație pentru generare sau lucru cu imagini.</p><button className="primary" onClick={()=>onImagePrompt(imageModel)}>Creează o imagine</button><button className="secondary" onClick={onOpenLibrary}>Deschide biblioteca de imagini</button>{imageModel&&<small>Model detectat: {imageModel}</small>}</section>
      <section className="exploreCard wide"><div className="exploreIcon"><Bot size={22}/></div><h3>GPT-uri / Asistenți</h3><p>Alege rapid un asistent personalizat.</p><div className="gptGrid">{assistants.map(a=><button key={a.id} className="gptCard" onClick={()=>onUseAssistant(a.id)}><span className="gptAvatar">{a.icon||a.name?.[0]||"A"}</span><span><b>{a.name}</b><small>{a.builtIn?"Asistent principal":"Asistent personalizat"}</small></span></button>)}</div></section>
      <section className="exploreCard"><div className="exploreIcon"><Globe2 size={22}/></div><h3>Site-uri</h3><p>Deschide rapid un site sau o adresă web.</p><div className="quickSites"><button onClick={()=>open("https://www.google.com")}>Google</button><button onClick={()=>open("https://www.wikipedia.org")}>Wikipedia</button><button onClick={()=>open("https://www.youtube.com")}>YouTube</button><button onClick={()=>open("https://github.com")}>GitHub</button></div><div className="siteOpen"><input value={site} onChange={e=>setSite(e.target.value)} placeholder="exemplu.ro"/><button className="smallBtn" onClick={openSite}><ExternalLink size={14}/> Deschide</button></div></section>
    </div>
  </ToolShell>;
}

function ConversationFilesPanel({conversation,onClose}) {
  const files=(conversation?.messages||[]).flatMap(m=>(m.attachments||[]).map(a=>({...a,messageRole:m.role,createdAt:m.createdAt})));
  return <ToolShell title="Fișiere din conversație" subtitle="Toate fișierele atașate în conversația curentă." onClose={onClose}>
    <div className="conversationFiles">{files.length===0?<div className="emptyState"><Paperclip size={28}/>Nu există fișiere atașate în această conversație.</div>:files.map((x,i)=><div className="conversationFile" key={i}><FileText size={20}/><div><b>{x.name}</b><span>{x.type||"fișier"} · {fmtTime(x.createdAt)}</span></div></div>)}</div>
  </ToolShell>;
}

function SettingsModal({onClose,onSaved,user}) {
  const [cfg,setCfg]=useState(null),[key,setKey]=useState(""),[tab,setTab]=useState("general"),[status,setStatus]=useState(null),[micStatus,setMicStatus]=useState("");
  useEffect(()=>{Promise.all([window.AIStoica.getConfig(),window.AIStoica.systemStatus()]).then(([c,s])=>{setCfg(c);setStatus(s)})},[]);
  if(!cfg)return null;
  async function save(){await window.AIStoica.setConfig({...cfg,apiKey:key||cfg.apiKey});onSaved?.();onClose()}
  async function testMic(){setMicStatus("Se verifică…");try{const s=await navigator.mediaDevices.getUserMedia({audio:true});s.getTracks().forEach(t=>t.stop());setMicStatus("Microfon disponibil și permis ✓")}catch{setMicStatus("Microfon indisponibil sau fără permisiune")}}
  return <div className="modalBackdrop"><div className="settingsModal"><div className="modalHead"><div><h2>Setări AI Stoica</h2><p>Controlează aplicația, vocea, OmniRoute și actualizările.</p></div><button className="iconOnly" onClick={onClose}><X size={20}/></button></div>
    <div className="settingsBody"><div className="settingsNav">
      <button className={tab==="general"?"active":""} onClick={()=>setTab("general")}><SlidersHorizontal size={17}/> General</button>
      <button className={tab==="ai"?"active":""} onClick={()=>setTab("ai")}><Bot size={17}/> AI & OmniRoute</button>
      <button className={tab==="voice"?"active":""} onClick={()=>setTab("voice")}><Volume2 size={17}/> Voce și microfon</button>
      <button className={tab==="account"?"active":""} onClick={()=>setTab("account")}><User size={17}/> Cont și date</button>
    </div>
    <div className="settingsPane">
      {tab==="general"&&<><h3>General</h3><div className="toggleRow"><div><b>Pornește AI Stoica cu Windows</b><span>Aplicația pornește automat și poate rămâne în fundal.</span></div><input type="checkbox" checked={!!cfg.startWithWindows} onChange={e=>setCfg({...cfg,startWithWindows:e.target.checked})}/></div><div className="toggleRow"><div><b>Închidere în system tray</b><span>Butonul X ascunde aplicația fără să oprească serviciile.</span></div><input type="checkbox" checked={cfg.closeToTray!==false} onChange={e=>setCfg({...cfg,closeToTray:e.target.checked})}/></div><div className="toggleRow"><div><b>Actualizări automate</b><span>AI Stoica caută versiuni noi la pornire.</span></div><input type="checkbox" checked={cfg.autoUpdate!==false} onChange={e=>setCfg({...cfg,autoUpdate:e.target.checked})}/></div></>}
      {tab==="ai"&&<><h3>AI & OmniRoute</h3><label>Gateway local AI Stoica<input value={cfg.gatewayUrl||"http://127.0.0.1:8787"} onChange={e=>setCfg({...cfg,gatewayUrl:e.target.value})} placeholder="http://127.0.0.1:8787"/></label><label>AI Stoica Cloud API<input value={cfg.controlApiUrl||""} onChange={e=>setCfg({...cfg,controlApiUrl:e.target.value})} placeholder="https://api.aistoica.ro"/></label><p className="settingsHelp">Control Center, aprobarea conturilor și permisiunile folosesc PostgreSQL-ul central atunci când Cloud API este configurat. Până la activarea domeniului, poți lăsa câmpul gol.</p><label>Base URL OmniRoute<input value={cfg.baseUrl} onChange={e=>setCfg({...cfg,baseUrl:e.target.value})}/></label><label>Cheie API<input type="password" value={key} onChange={e=>setKey(e.target.value)} placeholder={cfg.apiKey?"Cheie salvată — lasă gol pentru a o păstra":"Cheie OmniRoute"}/></label><label>Model implicit pentru conversații noi<input value={cfg.model||""} onChange={e=>setCfg({...cfg,model:e.target.value})} placeholder="Alege din selectorul de sus"/></label><label>Model generare imagini <span className="optional">opțional</span><input value={cfg.imageModel||""} onChange={e=>setCfg({...cfg,imageModel:e.target.value})} placeholder="Auto — primul model de imagine disponibil"/></label><label>Model generare video <span className="optional">opțional</span><input value={cfg.videoModel||""} onChange={e=>setCfg({...cfg,videoModel:e.target.value})} placeholder="Auto — model video disponibil"/></label><p className="settingsHelp">Când ceri o poză sau un videoclip, AI Stoica generează fișierul real, îl afișează în chat și îl salvează în Bibliotecă.</p><label>Comandă OmniRoute<input value={cfg.omniCommand||"omniroute.cmd"} onChange={e=>setCfg({...cfg,omniCommand:e.target.value})}/></label><div className="toggleRow"><div><b>Pornește OmniRoute automat</b><span>Dacă serviciul cade, AI Stoica încearcă să îl repornească.</span></div><input type="checkbox" checked={!!cfg.autoStartOmniRoute} onChange={e=>setCfg({...cfg,autoStartOmniRoute:e.target.checked})}/></div><div className="statusGrid"><div><span>Gateway local</span><b>{status?.gatewayRunning?"Conectat":"Indisponibil"}</b></div><div><span>OmniRoute</span><b>{status?.omniRunning?"Conectat":"Indisponibil"}</b></div></div></>}
      {tab==="voice"&&<><h3>Voce și microfon</h3><label>Limba dictării<select value={cfg.speechLanguage||"ro"} onChange={e=>setCfg({...cfg,speechLanguage:e.target.value})}><option value="ro">Română</option><option value="en">English</option><option value="fr">Français</option></select></label><label>Model transcriere<input value={cfg.speechModel||"openai/whisper-1"} onChange={e=>setCfg({...cfg,speechModel:e.target.value})}/></label><button className="secondary testMicBtn" onClick={testMic}><Mic size={16}/> Testează microfonul</button>{micStatus&&<div className="micStatus">{micStatus}</div>}<p className="settingsHelp">La microfon: apeși o dată pentru a începe înregistrarea și încă o dată pentru a o opri. AI Stoica trimite apoi sunetul către transcriere prin OmniRoute.</p></>}
      {tab==="account"&&<><h3>Cont și date</h3><div className="accountSettingsCard"><div className="accountAvatar big">{(user?.name||user?.email||"S")[0].toUpperCase()}</div><div><b>{user?.name||"Cont AI Stoica"}</b><span>{user?.email}</span></div></div><p className="settingsHelp">Conversațiile, memoria, biblioteca, proiectele, pluginurile și automatizările sunt în prezent păstrate local. După mutarea pe AI Stoica Cloud, acestea vor putea fi sincronizate între PC și telefon.</p></>}
    </div></div>
    <div className="modalActions"><button className="secondary" onClick={onClose}>Anulează</button><button className="primary" onClick={save}>Salvează setările</button></div>
  </div></div>;
}

function CreateModal({type,onClose,onCreate}) {
  const [name,setName]=useState(""),[prompt,setPrompt]=useState("");
  return <div className="modalBackdrop"><div className="modal smallModal"><div className="modalHead"><h2>{type==="project"?"Proiect nou":"Asistent personalizat"}</h2><button className="iconOnly" onClick={onClose}><X size={20}/></button></div><label>Nume<input autoFocus value={name} onChange={e=>setName(e.target.value)} placeholder={type==="project"?"Ex. Proiecte Primărie":"Ex. Profesor de matematică"}/></label>{type==="assistant"&&<label>Instrucțiuni pentru asistent<textarea className="promptArea" value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder="Cum vrei să lucreze acest asistent?"/></label>}<div className="modalActions"><button className="secondary" onClick={onClose}>Anulează</button><button className="primary" disabled={!name.trim()} onClick={()=>onCreate({name:name.trim(),systemPrompt:prompt.trim()})}>Creează</button></div></div></div>;
}

function App() {
  const [user,setUser]=useState(()=>{try{return JSON.parse(localStorage.getItem(USER_KEY)||"null")}catch{return null}});
  const initialModels=useMemo(()=>cachedModels().filter(x=>!/^ai[ _-]*(principal|stoica)$/i.test(x)),[]);
  const [boot,setBoot]=useState(true),[conversations,setConversations]=useState([]),[projects,setProjects]=useState([]),[assistants,setAssistants]=useState([]),[models,setModels]=useState(initialModels);
  const initialManualModel=useMemo(()=>localStorage.getItem(MANUAL_MODEL_KEY)||localStorage.getItem(MODEL_SELECTED_KEY)||initialModels.find(x=>!/^ai[ _-]*(principal|stoica)$/i.test(x))||"",[initialModels]);
  const [currentId,setCurrentId]=useState(null),[model,setModel]=useState(initialManualModel),[selectedProject,setSelectedProject]=useState(null),[selectedAssistant,setSelectedAssistant]=useState(null);
  const [draft,setDraft]=useState(""),[attachments,setAttachments]=useState([]),[busy,setBusy]=useState(false),[busyStage,setBusyStage]=useState(""),[search,setSearch]=useState(""),[sidebar,setSidebar]=useState(false),[omni,setOmni]=useState(false),[refreshingModels,setRefreshingModels]=useState(false),[modelPolicyEnforced,setModelPolicyEnforced]=useState(false);
  const [settings,setSettings]=useState(false),[createType,setCreateType]=useState(null),[toolPanel,setToolPanel]=useState(null),[filesPanel,setFilesPanel]=useState(false),[updateReady,setUpdateReady]=useState(false),[sidebarCollapsed,setSidebarCollapsed]=useState(false);
  const chatRef=useRef(null);
  const current=conversations.find(c=>c.id===currentId)||null;

  async function refreshModels({silent=false}={}){
    if(!silent)setRefreshingModels(true);
    try{
      const ms=await api("/api/models");
      const live=uniqueModels((ms.manualModels||ms.data||[]).map(x=>typeof x==="string"?x:x?.id)).filter(x=>!/^ai[ _-]*(principal|stoica)$/i.test(x));
      const enforced=ms.policyEnforced===true;
      setModelPolicyEnforced(enforced);
      const previous=cachedModels().filter(x=>!/^ai[ _-]*(principal|stoica)$/i.test(x));
      const merged=uniqueModels([...live,...previous,model]).filter(x=>!/^ai[ _-]*(principal|stoica)$/i.test(x));
      setModels(merged);
      localStorage.setItem(MODEL_CACHE_KEY,JSON.stringify(merged));
      if(enforced){
        const selected=merged.includes(model)?model:(merged[0]||"");
        setModel(selected);
        if(selected)localStorage.setItem(MODEL_SELECTED_KEY,selected);else localStorage.removeItem(MODEL_SELECTED_KEY);
      }
      return merged;
    }catch{
      if(modelPolicyEnforced)return models;
      const fallback=uniqueModels([...cachedModels(),model]);
      if(fallback.length)setModels(fallback);
      return fallback;
    }finally{if(!silent)setRefreshingModels(false)}
  }
  async function chooseModel(next){
    const value=String(next||"").trim();if(!value||/^ai[ _-]*(principal|stoica)$/i.test(value))return;
    if(modelPolicyEnforced&&!models.includes(value))return;
    setModel(value);
    localStorage.setItem(MANUAL_MODEL_KEY,value);
    localStorage.setItem(MODEL_SELECTED_KEY,value);
    setModels(v=>{const nextModels=uniqueModels([value,...v]);localStorage.setItem(MODEL_CACHE_KEY,JSON.stringify(nextModels));return nextModels});
    if(current){
      setConversations(v=>v.map(x=>x.id===current.id?{...x,model:value}:x));
      api(`/api/conversations/${current.id}`,{method:"PUT",body:JSON.stringify({...current,model:value})}).then(d=>{
        if(d?.data)setConversations(v=>v.map(x=>x.id===current.id?d.data:x));
      }).catch(()=>{});
    }
  }

  async function loadData(){
    if(!localStorage.getItem(TOKEN_KEY)){setBoot(false);return}
    try{
      const [me,cs,ps,as,ms]=await Promise.all([api("/auth/me"),api("/api/conversations"),api("/api/projects"),api("/api/assistants"),api("/api/models").catch(()=>({data:[],policyEnforced:true}))]);
      if(me.token)localStorage.setItem(TOKEN_KEY,me.token);setUser(me.user);localStorage.setItem(USER_KEY,JSON.stringify(me.user));setConversations(cs.data||[]);setProjects(ps.data||[]);setAssistants(as.data||[]);
      const ids=uniqueModels((ms.manualModels||ms.data||[]).map(x=>typeof x==="string"?x:x?.id)).filter(x=>!/^ai[ _-]*(principal|stoica)$/i.test(x));
      const prior=cachedModels().filter(x=>!/^ai[ _-]*(principal|stoica)$/i.test(x));
      const remembered=localStorage.getItem(MODEL_SELECTED_KEY)||"";
      const enforced=ms.policyEnforced===true;
      setModelPolicyEnforced(enforced);
      const merged=uniqueModels([...ids,...prior,remembered]).filter(x=>!/^ai[ _-]*(principal|stoica)$/i.test(x));
      setModels(merged);localStorage.setItem(MODEL_CACHE_KEY,JSON.stringify(merged));
      const manualCandidates=merged.filter(x=>!/^ai[ _-]*(principal|stoica)$/i.test(x));
      const rememberedManual=localStorage.getItem(MANUAL_MODEL_KEY)||remembered;
      const preferred=rememberedManual&&manualCandidates.includes(rememberedManual)?rememberedManual:(manualCandidates[0]||"");
      setModel(preferred);
      if(preferred){localStorage.setItem(MANUAL_MODEL_KEY,preferred);localStorage.setItem(MODEL_SELECTED_KEY,preferred)}else localStorage.removeItem(MODEL_SELECTED_KEY);
      localStorage.setItem(AUTO_ROUTER_ENABLED_KEY,"0");
      localStorage.setItem(SMART_ROUTER_DEFAULT_KEY,"0");
      if((as.data||[]).length&&!selectedAssistant)setSelectedAssistant(as.data[0].id);if((cs.data||[]).length&&!currentId)setCurrentId(cs.data[0].id);
    }catch(e){if(/Autentificare|Sesiune|401/i.test(e.message))logout()}finally{setBoot(false)}
  }
  useEffect(()=>{
    let active=true;
    (async()=>{
      try{
        const cfg=await window.AIStoica?.getConfig?.();
        if(cfg?.gatewayUrl)setGatewayUrl(cfg.gatewayUrl);
      }catch{}
      if(active)await loadData();
    })();
    window.AIStoica?.onUpdateReady(()=>setUpdateReady(true));
    return()=>{active=false};
  },[user?.id]);
  useEffect(()=>{const poll=async()=>{try{const h=await fetch(`${GATEWAY}/health`).then(r=>r.json());setOmni(!!h.omni)}catch{setOmni(false);window.AIStoica?.ensureOmni?.().catch(()=>{})}};poll();const id=setInterval(poll,8000);return()=>clearInterval(id)},[]);
  useEffect(()=>{setTimeout(()=>chatRef.current?.scrollTo({top:chatRef.current.scrollHeight,behavior:"smooth"}),30)},[current?.messages?.length,busy,current?.messages?.at(-1)?.content]);
  useEffect(()=>{
    if(!current?.model)return;
    const isSmart=/^ai[ _-]*(principal|stoica)$/i.test(current.model);
    if(isSmart){
      const fallback=localStorage.getItem(MANUAL_MODEL_KEY)||models.find(x=>!/^ai[ _-]*(principal|stoica)$/i.test(x))||"";
      if(fallback){setModel(fallback);localStorage.setItem(MODEL_SELECTED_KEY,fallback)}
      return;
    }
    if(modelPolicyEnforced&&!models.includes(current.model)){
      const fallback=models.find(x=>!/^ai[ _-]*(principal|stoica)$/i.test(x))||"";
      setModel(fallback);
      if(fallback){localStorage.setItem(MANUAL_MODEL_KEY,fallback);localStorage.setItem(MODEL_SELECTED_KEY,fallback)}else localStorage.removeItem(MODEL_SELECTED_KEY);
      return;
    }
    setModel(current.model);
    localStorage.setItem(MANUAL_MODEL_KEY,current.model);
    localStorage.setItem(MODEL_SELECTED_KEY,current.model);
    if(!modelPolicyEnforced)setModels(v=>uniqueModels([current.model,...v]));
  },[currentId,modelPolicyEnforced,models.join("|")]);

  function logout(){localStorage.removeItem(TOKEN_KEY);localStorage.removeItem(USER_KEY);setUser(null);setConversations([]);setCurrentId(null)}
  function newConversation(){setCurrentId(null);setDraft("");setAttachments([]);setSidebar(false)}
  async function saveConversation(conv){if(conv.id){const d=await api(`/api/conversations/${conv.id}`,{method:"PUT",body:JSON.stringify(conv)});setConversations(v=>v.map(x=>x.id===conv.id?d.data:x));return d.data}const d=await api("/api/conversations",{method:"POST",body:JSON.stringify(conv)});setConversations(v=>[d.data,...v]);setCurrentId(d.data.id);return d.data}
  async function streamAssistant(baseConv,messages){
    const lastUser=[...messages].reverse().find(m=>m.role==="user");
    const requestedFormat=requestedDocumentFormat(messageText(lastUser));
    const fileMode=!!requestedFormat;
    const desiredModel=String(baseConv.model||model||"").trim();
    const manualModel=modelPolicyEnforced?(models.includes(desiredModel)?desiredModel:(models.includes(model)?model:(models.find(x=>!/^ai[ _-]*(principal|stoica)$/i.test(x))||""))):desiredModel;
    const effectiveModel=manualModel;
    setBusy(true);setBusyStage("Analizează cererea și identifică tipul sarcinii…");const assistantMessage={id:uid(),role:"assistant",content:"",attachmentOnly:fileMode,createdAt:Date.now(),streaming:true};let working={...baseConv,model:manualModel||baseConv.model||model,messages:[...messages,assistantMessage],updatedAt:Date.now()};setConversations(v=>v.map(x=>x.id===working.id?working:x));
    try{
      if(!effectiveModel)throw new Error("Nu există niciun model AI permis pentru acest cont.");
      if(!omni){setBusyStage("Pornește și verifică OmniRoute…");await window.AIStoica.ensureOmni();await new Promise(r=>setTimeout(r,1200))}
      setBusyStage("Pregătește AI-ul ales manual…");
      const token=localStorage.getItem(TOKEN_KEY)||"",r=await fetch(`${GATEWAY}/api/chat/stream`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({model:effectiveModel,assistantId:working.assistantId,messages})});
      if(!r.ok){let e;try{e=await r.json()}catch{e={error:await r.text()}};throw new Error(e?.error||`HTTP ${r.status}`)}
      const reader=r.body.getReader(),dec=new TextDecoder();let buf="",answer="",routeInfo=null,startedAnswer=false;
      while(true){const {value,done}=await reader.read();if(done)break;buf+=dec.decode(value,{stream:true});const events=buf.split("\n\n");buf=events.pop()||"";for(const ev of events)for(const line of ev.split("\n")){if(!line.startsWith("data:"))continue;const raw=line.slice(5).trim();if(!raw||raw==="[DONE]")continue;try{
        const j=JSON.parse(raw);
        if(j?.ai_stoica_route){
          routeInfo=j.ai_stoica_route;
          setBusyStage(`A ales ${providerLabel(routeInfo.provider,routeInfo.model)} · ${routeInfo.model} pentru ${routeTaskLabel(routeInfo.task)}…`);
          working={...working,messages:[...messages,{...assistantMessage,routeInfo,content:fileMode?"":answer,streaming:true}]};
          setConversations(v=>v.map(x=>x.id===working.id?working:x));
          continue;
        }
        const delta=j?.choices?.[0]?.delta?.content||j?.choices?.[0]?.message?.content||"";
        if(delta){
          if(!startedAnswer){startedAnswer=true;setBusyStage("Gândește și generează răspunsul…")}
          answer+=delta;working={...working,messages:[...messages,{...assistantMessage,routeInfo,content:fileMode?"":answer,streaming:true}]};setConversations(v=>v.map(x=>x.id===working.id?working:x))
        }
      }catch{}}}
      let generatedAttachments=[];
      if(requestedFormat){
        setBusyStage(`Creează fișierul ${requestedFormat.toUpperCase()} și pregătește Download…`);
        try{
          const previousAssistant=[...messages].reverse().find(m=>m.role==="assistant");
          const previousSource=previousAssistant?.artifactSource||messageText(previousAssistant);
          const exportContent=standaloneExportRequest(messageText(lastUser))&&previousSource
            ? previousSource
            : (answer||"Nu am primit răspuns.");
          const exported=await api("/api/export",{method:"POST",body:JSON.stringify({
            format:requestedFormat,
            title:working.title||"AI Stoica - fișier",
            content:exportContent
          })});
          if(exported?.data)generatedAttachments=[exported.data];
        }catch(exportError){
          console.warn("Export file failed",exportError);
        }
      }
      const attachmentOnly=!!requestedFormat&&generatedAttachments.length>0;
      working={...working,messages:[...messages,{...assistantMessage,routeInfo,content:attachmentOnly?"":(answer||"Nu am primit răspuns."),artifactSource:attachmentOnly?answer:undefined,attachments:generatedAttachments,attachmentOnly,streaming:false}],updatedAt:Date.now()};const saved=await saveConversation(working);
      api("/api/memory/capture",{method:"POST",body:JSON.stringify({conversationId:saved.id,userText:messageText(lastUser),assistantText:answer})}).catch(()=>{});
    }catch(e){working={...working,messages:[...messages,{...assistantMessage,content:`Eroare: ${e.message}`,streaming:false}],updatedAt:Date.now()};await saveConversation(working)}finally{setBusy(false);setBusyStage("")}
  }
  async function generateMediaAssistant(baseConv,messages,kind,prompt){
    setBusy(true);setBusyStage(kind==="video"?"Creează videoclipul și pregătește fișierul MP4…":"Creează imaginea și pregătește fișierul pentru Download…");
    try{
      if(!omni){await window.AIStoica.ensureOmni();await new Promise(r=>setTimeout(r,900))}
      const endpoint=kind==="video"?"/api/generate/video":"/api/generate/image";
      const d=await api(endpoint,{method:"POST",body:JSON.stringify({prompt})});
      const file={...d.data,type:d.data?.kind||kind,kind:d.data?.kind||kind};
      const routeInfo={task:kind==="video"?"video_generation":"image_generation",model:file.model||"",provider:inferModelProvider(file.model||"")};
      const assistantMessage={id:uid(),role:"assistant",content:"",attachments:[file],routeInfo,attachmentOnly:true,createdAt:Date.now(),streaming:false};
      const saved=await saveConversation({...baseConv,messages:[...messages,assistantMessage],updatedAt:Date.now()});
      api("/api/memory/capture",{method:"POST",body:JSON.stringify({conversationId:saved.id,userText:prompt,assistantText:`${kind==="video"?"Videoclip":"Imagine"} generată: ${file.name}`})}).catch(()=>{});
    }catch(e){
      console.warn(`Generarea ${kind} nu a fost disponibilă; continui cu AI-ul ales manual.`,e);
      setBusy(false);
      setBusyStage("Generarea media nu este disponibilă; continuă cu AI-ul ales manual…");
      await streamAssistant(baseConv,messages);
      return;
    }finally{setBusy(false);setBusyStage("")}
  }
  async function send(){
    const text=draft.trim(),usable=attachments.filter(a=>a.part||a.parts?.length);if((!text&&!usable.length)||busy)return;
    const attachmentParts=usable.flatMap(a=>Array.isArray(a.parts)&&a.parts.length?a.parts:[a.part].filter(Boolean));
    const parts=[...(text?[{type:"text",text}]:[]),...attachmentParts],content=parts.length===1&&parts[0].type==="text"?parts[0].text:parts;
    const userMsg={id:uid(),role:"user",content,displayText:text||"Fișier media atașat",attachments:attachments.map(a=>({name:a.name,type:a.type,mime:a.mime||"",size:a.size||0,libraryId:a.libraryId||null,transcript:a.transcript||""})),createdAt:Date.now()};
    let conv=current?{...current}:{title:titleFrom(text||attachments[0]?.name),projectId:selectedProject,assistantId:selectedAssistant,model,messages:[]};
    conv={...conv,title:conv.messages?.length?conv.title:titleFrom(text||attachments[0]?.name),projectId:conv.projectId??selectedProject,assistantId:conv.assistantId??selectedAssistant,model,messages:[...(conv.messages||[]),userMsg],updatedAt:Date.now()};
    setDraft("");setAttachments([]);const saved=await saveConversation(conv);
    const mediaIntent=attachments.length===0?requestedMediaGeneration(text):null;
    if(mediaIntent)await generateMediaAssistant(saved,saved.messages,mediaIntent,text);
    else await streamAssistant(saved,saved.messages);
  }
  async function regenerate(index){if(busy||!current)return;const msgs=current.messages.slice(0,index),saved=await saveConversation({...current,messages:msgs});await streamAssistant(saved,msgs)}
  async function rate(index,value){if(!current)return;const msgs=current.messages.map((m,i)=>i===index?{...m,rating:m.rating===value?0:value}:m);await saveConversation({...current,messages:msgs})}
  async function createItem(data){if(createType==="project"){const d=await api("/api/projects",{method:"POST",body:JSON.stringify(data)});setProjects(v=>[d.data,...v]);setSelectedProject(d.data.id)}else{const d=await api("/api/assistants",{method:"POST",body:JSON.stringify(data)});setAssistants(v=>[...v,d.data]);setSelectedAssistant(d.data.id)}setCreateType(null)}
  async function share(){if(!current)return;await navigator.clipboard.writeText(current.messages.map(m=>`${m.role==="user"?"Eu":"AI Stoica"}:\n${messageText(m)}`).join("\n\n"));alert("Conversația a fost copiată în clipboard.")}
  async function githubSolve(){
    const path=prompt("Calea fișierului din GitHub (ex: apps/mobile/app/index.js):","");
    if(!path)return;
    const instruction=prompt("Ce trebuie să rezolve AI Stoica în acest fișier?","Analizează fișierul, identifică problema și corectează-l.");
    if(instruction===null)return;
    try{
      const d=await api("/api/github/solve",{method:"POST",body:JSON.stringify({path,instruction})});
      const proposal=d.data?.proposal||"";
      await writeClipboardText(proposal);
      const apply=confirm("Rezolvarea a fost generată și copiată în clipboard.\n\nVrei să o aplic direct în GitHub?");
      if(apply){
        const a=await api("/api/github/apply",{method:"POST",body:JSON.stringify({
          path:d.data.path,content:proposal,sha:d.data.sha,branch:d.data.branch,
          message:"AI Stoica: rezolvare "+d.data.path
        })});
        alert("Modificarea a fost aplicată în GitHub. Commit: "+(a.data?.commit||"creat"));
      }
    }catch(e){alert("GitHub: "+e.message)}
  }
  function openTool(name){setSidebar(false);setToolPanel(name)}
  function attachFromLibrary(a){setAttachments(v=>[...v,a])}
  async function moveCurrent(projectId){if(!current)return;const saved=await saveConversation({...current,projectId});setSelectedProject(projectId);return saved}
  async function archiveCurrent(){if(!current)return;await saveConversation({...current,archived:true});setCurrentId(null)}
  async function deleteConversation(id){const conv=conversations.find(x=>x.id===id);if(!conv)return;if(!confirm(`Ștergi definitiv conversația „${conv.title||"Conversație"}”?`))return;await api(`/api/conversations/${id}`,{method:"DELETE"});setConversations(v=>v.filter(x=>x.id!==id));if(currentId===id)setCurrentId(null)}
  async function deleteCurrent(){if(current)await deleteConversation(current.id)}
  function toggleMenu(){if(window.innerWidth<=900)setSidebar(v=>!v);else setSidebarCollapsed(v=>!v)}
  function useAssistant(id){setSelectedAssistant(id);setCurrentId(null);setDraft("");setToolPanel(null)}
  function startImagePrompt(imageModel){if(imageModel)chooseModel(imageModel);setCurrentId(null);setDraft("Creează o imagine cu ");setToolPanel(null)}

  if(boot)return <div className="loadingScreen"><BrandMark/><span>Se pornește AI Stoica…</span></div>;
  if(!user)return <AuthScreen onAuth={setUser}/>;
  const hasMessages=!!current?.messages?.length;
  return <div className={cx("appShell",sidebarCollapsed&&"sidebarCollapsed")}>
    <Sidebar open={sidebar} setOpen={setSidebar} user={user} search={search} setSearch={setSearch} projects={projects} assistants={assistants} conversations={conversations} currentId={currentId} onSelect={id=>{setCurrentId(id);setSidebar(false)}} onDeleteConversation={deleteConversation} onNew={newConversation} selectedProject={selectedProject} setSelectedProject={setSelectedProject} selectedAssistant={selectedAssistant} setSelectedAssistant={setSelectedAssistant} onNewProject={()=>setCreateType("project")} onNewAssistant={()=>setCreateType("assistant")} onTool={openTool} onExplore={()=>openTool("explore")} onSettings={()=>setSettings(true)} onLogout={logout}/>
    {sidebar&&<div className="mobileScrim" onClick={()=>setSidebar(false)}/>}
    <main className="mainArea"><Header onMenu={toggleMenu} model={model} onSelectModel={chooseModel} models={models} onRefreshModels={()=>refreshModels()} refreshingModels={refreshingModels} omni={omni} onShare={share} current={current} projects={projects} onDetach={()=>moveCurrent(null)} onMoveProject={moveCurrent} onFiles={()=>setFilesPanel(true)} onGitHub={githubSolve} onArchive={archiveCurrent} onDelete={deleteCurrent}/>{updateReady&&<button className="updateBanner" onClick={()=>window.AIStoica.installUpdate()}>Actualizare AI Stoica disponibilă — instalează acum</button>}<div className="chatScroll" ref={chatRef}><ConversationView conversation={current} busy={busy} busyStage={busyStage} onRegenerate={regenerate} onRate={rate}/></div><Composer centered={!hasMessages} draft={draft} setDraft={setDraft} onSend={send} busy={busy} attachments={attachments} setAttachments={setAttachments} onOpenLibrary={()=>setToolPanel("library")}/></main>
    {settings&&<SettingsModal user={user} onClose={()=>setSettings(false)} onSaved={()=>{window.AIStoica.ensureOmni();setTimeout(loadData,1000)}}/>}
    {createType&&<CreateModal type={createType} onClose={()=>setCreateType(null)} onCreate={createItem}/>}
    {toolPanel==="explore"&&<ExplorePanel onClose={()=>setToolPanel(null)} assistants={assistants} models={models} onUseAssistant={useAssistant} onImagePrompt={startImagePrompt} onOpenLibrary={()=>setToolPanel("library")}/>} 
    {toolPanel==="library"&&<LibraryPanel onClose={()=>setToolPanel(null)} onAttach={attachFromLibrary}/>} 
    {toolPanel==="memory"&&<MemoryPanel onClose={()=>setToolPanel(null)}/>}
    {toolPanel==="admin"&&user?.role==="owner"&&<AdminPanel onClose={()=>setToolPanel(null)}/>}
    {toolPanel==="plugins"&&<PluginsPanel onClose={()=>setToolPanel(null)}/>} 
    {toolPanel==="admin"&&user?.role==="owner"&&<AdminPanel onClose={()=>setToolPanel(null)}/>} 
    {toolPanel==="automations"&&<AutomationsPanel onClose={()=>setToolPanel(null)} model={model}/>}
  </div>;
}
createRoot(document.getElementById("root")).render(<ErrorBoundary><App/></ErrorBoundary>);
