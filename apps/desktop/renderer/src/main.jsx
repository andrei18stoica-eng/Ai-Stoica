import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Menu, Plus, Search, Folder, Bot, Settings, LogOut, Share2, MoreHorizontal,
  Paperclip, Mic, ArrowUp, Copy, ThumbsUp, ThumbsDown, RotateCcw, X,
  ChevronDown, User, Check, Wifi, WifiOff, Sparkles, SquarePen, Square,
  CalendarClock, Plug, Library, Brain, Upload, Trash2, Play, Pin, PinOff,
  FileText, Image as ImageIcon, HardDrive, ToggleLeft, ToggleRight,
  Compass, Map as MapIcon, Globe2, Archive, ArchiveRestore, ExternalLink, SlidersHorizontal, Volume2,
  PanelTopOpen, ShieldCheck, UserCheck, Download, Lock, Pencil, Video
} from "lucide-react";
import "./styles.css";

const DEFAULT_GATEWAY = "http://127.0.0.1:8787";
const GATEWAY_KEY = "aiStoicaGatewayUrlV1";
const TOKEN_KEY = "aiStoicaAuthTokenV3";
const USER_KEY = "aiStoicaUserV3";
const PERMISSIONS_KEY = "aiStoicaPermissionsV1";
const MODEL_CACHE_KEY = "aiStoicaModelsV1";
const MODEL_SELECTED_KEY = "aiStoicaSelectedModelV1";
const MANUAL_MODEL_KEY = "aiStoicaManualModelV1";
const RESPONSE_MODE_KEY = "ai-stoica-response-mode";
const GITHUB_BACKUP_KEY = "ai-stoica-last-github-backup";
const FIRST_RUN_KEY = "ai-stoica-first-run-done";
const SIDEBAR_COLLAPSED_KEY = "aiStoicaSidebarCollapsedV1";
const ACCOUNT_KEYS = [TOKEN_KEY,USER_KEY,PERMISSIONS_KEY,MODEL_CACHE_KEY,MODEL_SELECTED_KEY,MANUAL_MODEL_KEY,GITHUB_BACKUP_KEY,"aiStoicaSmartRouterDefaultV1","aiStoicaAutoRouterEnabledV1"];
const OAUTH_REDIRECT_PATH = "/api/plugins/oauth/callback";

const storage = {
  get(key,fallback=""){try{const v=localStorage.getItem(key);return v===null?fallback:v}catch{return fallback}},
  set(key,value){try{localStorage.setItem(key,value)}catch{}},
  remove(key){try{localStorage.removeItem(key)}catch{}},
  json(key,fallback=null){try{const v=JSON.parse(localStorage.getItem(key)||"null");return v===null?fallback:v}catch{return fallback}}
};

function cleanGatewayUrl(url){
  const s=String(url||"").trim().replace(/\/+$/,"");
  return /^https?:\/\/[^\s/?#]+$/i.test(s)?s:"";
}
let GATEWAY = cleanGatewayUrl(storage.get(GATEWAY_KEY)) || DEFAULT_GATEWAY;
function setGatewayUrl(url){
  GATEWAY=cleanGatewayUrl(url)||DEFAULT_GATEWAY;
  storage.set(GATEWAY_KEY,GATEWAY);
}
let DICTATION_LANG = "ro";
const SPEECH_LOCALES = {ro:"ro-RO",en:"en-US",fr:"fr-FR"};
function speechLocale(){return SPEECH_LOCALES[DICTATION_LANG]||"ro-RO";}

function toast(message,kind="error"){
  const text=String(message||"").trim();if(!text)return;
  try{if(typeof window.aiStoicaToast==="function"){window.aiStoicaToast(text,kind);return;}}catch{}
  alert(text);
}

let authLostHandler = null;
function isAuthLost(status,message){
  return status===401||(status===403&&/Contul nu este activ|așteaptă aprobarea|asteapta aprobarea/i.test(String(message||"")));
}
function httpMessage(status){
  if(status===413)return "Fișierul sau mesajul este prea mare pentru serviciul AI Stoica (HTTP 413).";
  if(status===404)return "Serviciul AI Stoica nu a găsit resursa cerută (HTTP 404).";
  if(status>=500)return `Serviciul AI Stoica a întâmpinat o eroare (HTTP ${status}).`;
  return `Cererea nu a reușit (HTTP ${status}).`;
}
function errorFromBody(text,status){
  let data=null;try{data=text?JSON.parse(text):null}catch{}
  const e=data&&typeof data==="object"?data.error:null;
  if(typeof e==="string"&&e.trim())return e.trim();
  if(e&&typeof e==="object")return String(e.message||JSON.stringify(e)).slice(0,600);
  return httpMessage(status);
}
function apiError(status,text,path=""){
  const message=errorFromBody(text,status);
  const err=new Error(message);err.status=status;
  if(isAuthLost(status,message)&&!/^\/auth\/(login|register|logout)/.test(path)&&storage.get(TOKEN_KEY)&&authLostHandler)authLostHandler(message);
  return err;
}
function authHeaders(extra={}){const token=storage.get(TOKEN_KEY);return {...(token?{Authorization:`Bearer ${token}`}:{}),...extra};}
async function api(path, options = {}) {
  const r = await fetch(`${GATEWAY}${path}`, {...options,headers:authHeaders({"Content-Type":"application/json",...(options.headers||{})})});
  const text = await r.text();
  if (!r.ok) throw apiError(r.status,text,path);
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new Error(`Răspuns invalid de la serviciul AI Stoica (HTTP ${r.status}).`); }
}
async function authedFetch(path,init={}){
  const r=await fetch(`${GATEWAY}${path}`,{...init,headers:authHeaders(init.headers||{})});
  if(!r.ok){const text=await r.text().catch(()=>"");throw apiError(r.status,text,path);}
  return r;
}

const PERMISSION_LABELS = {image_generation:"Generare imagini",video_generation:"Generare video",document_generation:"Fișiere descărcabile",file_upload:"Încărcare fișiere",web_search:"Căutare web",deep_research:"Deep Research",automations:"Automatizări",plugins:"Pluginuri",github_access:"GitHub"};
function deniedMessage(key){return `Funcția „${PERMISSION_LABELS[key]||key}” este dezactivată de Owner pentru contul tău.`;}
const AccessContext = React.createContext({can:()=>true,deny:()=>{},isOwner:false});
function useAccess(){return useContext(AccessContext);}

async function uploadFileToLibrary(file) {
  const r=await authedFetch("/api/library/upload",{
    method:"POST",
    headers:{"Content-Type":"application/octet-stream","X-File-Name":encodeURIComponent(file.name||"fisier"),"X-File-Type":file.type||"application/octet-stream","X-File-Size":String(file.size||0)},
    body:file
  });
  const text=await r.text();let data={};
  try{data=text?JSON.parse(text):{}}catch{throw new Error("Răspuns invalid la încărcarea fișierului.")}
  if(!data?.data?.id)throw new Error("Serviciul nu a confirmat salvarea fișierului.");
  return data.data;
}
function formatBytes(n){
  const v=Number(n||0);if(v<1024)return `${v} B`;
  if(v<1024**2)return `${(v/1024).toFixed(v<10240?1:0)} KB`;
  if(v<1024**3)return `${(v/1024**2).toFixed(v<10*1024**2?1:0)} MB`;
  return `${(v/1024**3).toFixed(2)} GB`;
}
function plural(n,one,many){
  const v=Math.abs(Number(n)||0),de=v>=20&&(v%100===0||v%100>=20);
  return `${v} ${v===1?one:(de?"de ":"")+many}`;
}

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

function cx(...v) { return v.filter(Boolean).join(" "); }
function uid() { return `${Date.now().toString(36)}${Math.random().toString(36).slice(2,8)}`; }
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
  return "ai";
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
    "direct-fallback":"API direct",image_generation:"Generare imagine",video_generation:"Generare video"
  })[task]||"General";
}
function RouteBadge({info}) {
  if(!info?.model)return null;
  const provider=providerLabel(info.provider,info.model);
  return <div className="routeBadge" title={"AI Stoica a folosit "+provider+" · "+info.model}>
    <Sparkles size={12}/><span><b>{provider}</b><em>{info.model}</em></span><small>{routeTaskLabel(info.task)}</small>
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
function openLink(href){
  const url=String(href||"").trim();
  if(!/^(https?:|mailto:)/i.test(url)){toast("Acest link nu poate fi deschis din AI Stoica.");return;}
  if(!window.AIStoica?.openExternal){window.open(url,"_blank","noopener,noreferrer");return;}
  Promise.resolve(window.AIStoica.openExternal(url)).then(r=>{if(r&&r.ok===false)toast(r.error||"Nu am putut deschide linkul în browser.")}).catch(e=>toast("Nu am putut deschide linkul: "+e.message));
}

async function saveBlobDownload(blob,name) {
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;a.download=name||"AI-Stoica-fisier";
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),4000);
}
async function downloadGeneratedFile(file) {
  if(!file?.id)throw new Error("Fișierul nu mai este disponibil.");
  const r=await authedFetch(`/api/files/${file.id}`);
  await saveBlobDownload(await r.blob(),file.name||"AI-Stoica-fisier");
}
async function downloadLibraryFile(file) {
  const id=file?.libraryId||file?.id;
  if(!id)throw new Error("Fișierul nu mai este disponibil.");
  const r=await authedFetch(`/api/library/${id}/content`);
  await saveBlobDownload(await r.blob(),file.name||"AI-Stoica-fisier");
}
function safeFileTitle(value){return String(value||"AI Stoica").replace(/[\\/:*?"<>|]+/g," ").replace(/\s+/g," ").trim().slice(0,90)||"AI Stoica";}
async function exportMessageFile(message,format,title) {
  const d=await api("/api/export",{method:"POST",body:JSON.stringify({format,title:safeFileTitle(title),content:messageText(message)})});
  await downloadGeneratedFile(d.data);
}

function normalizeIntent(value){
  return String(value||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/\s+/g," ").trim();
}
const QUESTION_START=/^(cum|ce|de ce|cand|care|cine|unde|cat|cata|cati|cate|explica|explicati|explica-mi|poti sa-mi explici|poti sa imi explici|ma poti ajuta sa inteleg|how|what|why|when|which|explain)\b/;
function isQuestion(t){return t.includes("?")||QUESTION_START.test(t);}
const FILE_FORMATS=["pdf","docx","pptx","xlsx","csv","json","md","txt","html","xml","rtf","zip","ipynb","svg","js","ts","jsx","tsx","py","java","c","cpp","cs","go","rs","php","rb","sh","ps1","sql","css","yaml","yml","toml","ini","tex"];
const FILE_VERB=/^(?:te rog,? )?(trimite(?:-mi)?|da-mi|dami|exporta(?:-mi)?|salveaza(?:-mi)?|fa-mi|fami|creeaza(?:-mi)?|genereaza(?:-mi)?|descarca(?:-mi)?|pune(?:-mi)?|transforma|converteste|export|save|make|create|generate|download|send)\b/;
const FORMAT_CANDIDATES=[
  ["pptx",/\bpptx\b|powerpoint|prezentare/],["docx",/\bdocx\b|\bword\b/],["xlsx",/\bxlsx\b|\bexcel\b|foaie de calcul|spreadsheet/],
  ["pdf",/\bpdf\b/],["csv",/\bcsv\b/],["json",/\bjson\b/],["html",/\bhtml\b/],["xml",/\bxml\b/],["rtf",/\brtf\b/],
  ["zip",/\bzip\b|arhiva/],["ipynb",/\bipynb\b|jupyter|notebook/],["svg",/\bsvg\b/],["md",/\bmarkdown\b|\bmd\b/],["txt",/\btxt\b|text simplu/],
  ["py",/\bpython\b/],["js",/\bjavascript\b/],["ts",/\btypescript\b/],["ps1",/\bpowershell\b/],["sql",/\bsql\b/],["yaml",/\byaml\b/],["tex",/\blatex\b/]
];
function requestedDocumentFormat(value){
  const t=normalizeIntent(value);
  if(!t||isQuestion(t))return null;
  const explicit=t.match(new RegExp("\\.("+FILE_FORMATS.join("|")+")\\b"));
  const found=explicit?[explicit[1]]:FORMAT_CANDIDATES.find(([,re])=>re.test(t));
  if(!found)return null;
  const onlyFormat=new RegExp("^(in |ca )?("+found[0]+"|word|powerpoint|excel|markdown|python|javascript|typescript|jupyter|notebook)( te rog)?[.!]?$");
  return (FILE_VERB.test(t)||onlyFormat.test(t))?found[0]:null;
}
function standaloneExportRequest(value){
  const t=normalizeIntent(value).replace(/[^a-z0-9.\s-]/g," ").replace(/\s+/g," ").trim();
  if(!requestedDocumentFormat(t))return false;
  if(/de mai sus|raspunsul|mesajul anterior|acesta|aceasta|asta|ultimul|tabelul|textul|lista|continutul|rezultatul|rezumatul|codul|conversatia/.test(t))return true;
  let stripped=t.replace(new RegExp("\\b("+FILE_FORMATS.join("|")+"|word|powerpoint|excel|prezentare|document|fisier|format|markdown|jupyter|notebook)\\b","g")," ");
  stripped=stripped.replace(/\b(trimite|da|dami|descarca|exporta|export|salveaza|creeaza|genereaza|fa|fami|in|ca|te|rog|mi|un|o|acum|si|imi|mie|format|fisier|fisierul|document|documentul)\b/g," ").replace(/[-.\s]+/g," ").trim();
  return !stripped;
}
const MEDIA_COMMAND=/^(?:(?:creeaza|genereaza|deseneaza)(?:-mi)?|fa[- ]?mi|make|generate|create|draw)\s+(?:(?:o|un|mi|me|an|a)\s+)?(imagine|poza|fotografie|logo|desen|ilustratie|video|videoclip|animatie|image|picture|photo|drawing|illustration|animation)\b/;
function requestedMediaGeneration(value){
  const t=normalizeIntent(value);
  if(!t||t.includes("?"))return null;
  if(/\b(script|scenariu|text|plan|idee|idei|descriere|prompt|titlu|caption)\b/.test(t))return null;
  const m=t.match(MEDIA_COMMAND);
  if(!m)return null;
  return /^(video|videoclip|animatie|animation)$/.test(m[1])?"video":"image";
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
function mediaKind(mime,name="") {
  const m=String(mime||"").toLowerCase(),n=String(name||"").toLowerCase();
  if(m.startsWith("audio/")||/\.(mp3|m4a|aac|wav|ogg|oga|flac|opus|weba)$/i.test(n))return "audio";
  if(m.startsWith("video/")||/\.(mp4|mov|m4v|webm|avi|mkv|mpeg|mpg)$/i.test(n))return "video";
  if(m.startsWith("image/")||/\.(png|jpe?g|webp|gif|heic|heif|bmp)$/i.test(n))return "image";
  if(m.startsWith("text/")||/\.(txt|md|csv|json|js|ts|py|html|css|xml|yaml|yml)$/i.test(n))return "text";
  return "file";
}
const KIND_LABELS={image:"Imagine",audio:"Audio",video:"Video",text:"Text",document:"Document",file:"Fișier",stored:"Fișier"};
function kindLabel(kind,mime="",name=""){
  if((kind==="file"||kind==="document")&&(/pdf|word|officedocument|presentation|spreadsheet|msword|excel/i.test(String(mime))||/\.(pdf|docx?|pptx?|xlsx?)$/i.test(String(name))))return "Document";
  return KIND_LABELS[kind]||"Fișier";
}
async function fetchLibraryBlob(id) {
  const r=await authedFetch(`/api/library/${id}/content`);
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

const modalStack=[];
const FOCUSABLE='a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
function useModal(onClose){
  const ref=useRef(null),closeRef=useRef(onClose),downRef=useRef(false);
  closeRef.current=onClose;
  useEffect(()=>{
    const token={};modalStack.push(token);
    const previous=document.activeElement,node=ref.current;
    const items=()=>node?[...node.querySelectorAll(FOCUSABLE)].filter(el=>el.getClientRects().length):[];
    const timer=setTimeout(()=>{if(node&&!node.contains(document.activeElement))(items()[0]||node).focus?.()},0);
    function onKey(e){
      if(modalStack[modalStack.length-1]!==token)return;
      if(e.key==="Escape"){e.preventDefault();e.stopPropagation();closeRef.current?.();return;}
      if(e.key!=="Tab"||!node)return;
      const list=items();if(!list.length){e.preventDefault();node.focus?.();return;}
      const first=list[0],last=list[list.length-1],active=document.activeElement;
      if(!node.contains(active)){e.preventDefault();first.focus();}
      else if(e.shiftKey&&active===first){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&active===last){e.preventDefault();first.focus();}
    }
    window.addEventListener("keydown",onKey,true);
    return()=>{
      clearTimeout(timer);window.removeEventListener("keydown",onKey,true);
      const i=modalStack.indexOf(token);if(i>=0)modalStack.splice(i,1);
      try{if(previous&&document.contains(previous))previous.focus()}catch{}
    };
  },[]);
  const backdropProps={
    onMouseDown:e=>{downRef.current=e.target===e.currentTarget},
    onClick:e=>{if(downRef.current&&e.target===e.currentTarget)closeRef.current?.();downRef.current=false}
  };
  return {ref,backdropProps};
}
function useDismiss(open,onClose,ref){
  const closeRef=useRef(onClose);closeRef.current=onClose;
  useEffect(()=>{
    if(!open)return;
    const down=e=>{if(ref.current&&!ref.current.contains(e.target))closeRef.current?.()};
    const key=e=>{if(e.key==="Escape")closeRef.current?.()};
    document.addEventListener("mousedown",down);window.addEventListener("keydown",key);
    return()=>{document.removeEventListener("mousedown",down);window.removeEventListener("keydown",key)};
  },[open]);
}
function ToolShell({title,subtitle,label,onClose,children}) {
  const {ref,backdropProps}=useModal(onClose);
  return <div className="modalBackdrop" {...backdropProps}><div className="toolModal" ref={ref} role="dialog" aria-modal="true" aria-label={title||label||"Panou"} tabIndex={-1}><div className="toolHead"><div><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div><button className="iconOnly" onClick={onClose} aria-label="Închide" title="Închide"><X size={20}/></button></div>{children}</div></div>;
}
function Modal({title,subtitle,onClose,className="modal",children}) {
  const {ref,backdropProps}=useModal(onClose);
  return <div className="modalBackdrop" {...backdropProps}><div className={className} ref={ref} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
    <div className="modalHead"><div><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div><button className="iconOnly" onClick={onClose} aria-label="Închide" title="Închide"><X size={20}/></button></div>
    {children}
  </div></div>;
}

function CodeBlock({children,...props}) {
  const ref=useRef(null),timer=useRef(null),[copied,setCopied]=useState(false);
  useEffect(()=>()=>clearTimeout(timer.current),[]);
  async function copy(){
    const ok=await writeClipboardText(ref.current?.innerText||"");
    if(!ok){toast("Nu am putut copia codul în clipboard.");return;}
    setCopied(true);clearTimeout(timer.current);timer.current=setTimeout(()=>setCopied(false),1400);
  }
  return <div className="codeBlock"><button type="button" className="codeCopy" onClick={copy} aria-label="Copiază codul">{copied?<Check size={13}/>:<Copy size={13}/>}<span>{copied?"Copiat":"Copiază"}</span></button><pre ref={ref} {...props}>{children}</pre></div>;
}
const REMARK_PLUGINS=[remarkGfm];
const MD_COMPONENTS={
  a({node,href,children,...props}){return <a {...props} href={href} title={href} rel="noreferrer noopener" onClick={e=>{e.preventDefault();if(!String(href||"").startsWith("#"))openLink(href)}}>{children}</a>;},
  table({node,...props}){return <div className="tableWrap"><table {...props}/></div>;},
  pre({node,children,...props}){return <CodeBlock {...props}>{children}</CodeBlock>;}
};
function Markdown({text}){return <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MD_COMPONENTS}>{String(text||"")}</ReactMarkdown>;}
function useAuthedBlobUrl(path){
  const [state,setState]=useState({src:"",failed:false});
  useEffect(()=>{
    let active=true,url="";
    setState({src:"",failed:false});
    if(!path)return()=>{};
    (async()=>{try{const r=await authedFetch(path);const blob=await r.blob();if(!active)return;url=URL.createObjectURL(blob);setState({src:url,failed:false})}catch{if(active)setState({src:"",failed:true})}})();
    return()=>{active=false;if(url)URL.revokeObjectURL(url)};
  },[path]);
  return state;
}
function cachedModels() {
  const v=storage.json(MODEL_CACHE_KEY,[]);
  return Array.isArray(v)?v.filter(x=>typeof x==="string"&&x&&!isSmartAlias(x)):[];
}
function uniqueModels(values) {
  return [...new Set((values||[]).map(x=>String(x||"").trim()).filter(Boolean))];
}
function isSmartAlias(value){return /^ai[ _-]*(principal|stoica)$/i.test(String(value||"").trim());}

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
      <div className="authFeature"><Sparkles size={17}/> Chat AI profesional, memorie, fișiere și automatizări.</div>
      <div className="authFeature"><Wifi size={17}/> Conectare prin OmniRoute sau prin API-uri directe.</div>
      <div className="authFeature"><User size={17}/> {cloud?"Cont personal cu aprobare Owner.":"Cont personal protejat cu parolă."}</div>
    </div>
    <form className="authCard" onSubmit={submit}>
      <div className="authTabs" role="tablist"><button type="button" role="tab" aria-selected={mode==="login"} className={mode==="login"?"active":""} onClick={()=>{setMode("login");setError("");}}>Autentificare</button><button type="button" role="tab" aria-selected={mode==="register"} className={mode==="register"?"active":""} onClick={()=>{setMode("register");setError("");setNotice("");}}>Creează cont</button></div>
      <h2>{mode==="login"?"Bine ai revenit":"Creează contul AI Stoica"}</h2>
      <p className="muted">{mode==="register"?(cloud?"Conturile noi trebuie aprobate de Owner înainte de prima utilizare.":"Contul se creează pe acest calculator și îl poți folosi imediat."):"Folosește emailul contului tău AI Stoica."}</p>
      {mode==="register"&&<label>Nume<input value={name} onChange={e=>setName(e.target.value)} placeholder="Numele tău" autoComplete="name"/></label>}
      <label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="nume@email.ro" required autoComplete="email"/></label>
      <label>Parolă<input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder={mode==="register"?"Minimum 10 caractere":"Parola contului"} required minLength={mode==="register"?10:undefined} autoComplete={mode==="register"?"new-password":"current-password"}/></label>
      {notice&&<div className="authNotice" role="status"><UserCheck size={17}/><span>{notice}</span></div>}
      {error&&<div className="authError" role="alert">{error}</div>}
      {networkIssue&&GATEWAY!==DEFAULT_GATEWAY&&<button type="button" className="secondary wideBtn" onClick={resetGateway}>Folosește serviciul local implicit</button>}
      <button className="primaryWide" disabled={busy}>{busy?"Se procesează…":mode==="login"?"Intră în AI Stoica":(cloud?"Trimite cererea de acces":"Creează contul")}</button>
      <div className="localNote">{cloud?"Owner-ul controlează aprobarea conturilor și permisiunile serviciilor AI.":"Conturile și conversațiile sunt păstrate pe acest calculator."}</div>
    </form>
  </div>;
}

function BrandMark({small=false}) { return <div className={cx("brandMark",small&&"small")}><img src="./stoica-enterprises-ai-mark.webp" alt="AI Stoica"/></div>; }

const TOOL_ITEMS=[["explore",Compass,"Explorează",null],["automations",CalendarClock,"Automatizări","automations"],["plugins",Plug,"Pluginuri","plugins"],["library",Library,"Bibliotecă",null],["memory",Brain,"Memorie",null]];
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
        {TOOL_ITEMS.map(([name,Icon,label,perm])=>{const locked=perm&&!can(perm);return <button key={name} className={cx("sideItem",name==="explore"?"exploreItem":"toolItem",locked&&"locked")} onClick={()=>onTool(name)} title={locked?deniedMessage(perm):label}><Icon size={16}/> {label}{locked&&<Lock size={13} className="lockIcon"/>}</button>})}
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

function ModelPicker({model,onSelect,models,onRefresh,refreshing,policyEnforced}) {
  const [open,setOpen]=useState(false),[query,setQuery]=useState("");
  const ref=useRef(null),listRef=useRef(null);
  useDismiss(open,()=>setOpen(false),ref);
  useEffect(()=>{if(!open)setQuery("")},[open]);
  useEffect(()=>{if(open)setTimeout(()=>{const el=ref.current?.querySelector(".modelSearch input")||listRef.current?.querySelector(".modelOption.active")||listRef.current?.querySelector(".modelOption");el?.focus()},0)},[open]);
  const list=(policyEnforced?uniqueModels(models):uniqueModels([model,...models])).filter(x=>!isSmartAlias(x));
  const filtered=list.filter(x=>!query||x.toLowerCase().includes(query.toLowerCase()));
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
        <span className="modelPickerText"><b>{model||"Alege AI"}</b><small>{list.length?plural(list.length,"model disponibil","modele disponibile"):"Niciun model disponibil"}{policyEnforced?" · stabilite de Owner":""}</small></span>
        <ChevronDown size={15}/>
      </button>
    {open&&<div className="modelPickerMenu" onKeyDown={onListKey}>
      <div className="modelPickerHead"><div><b>Alege AI-ul</b><span>Schimbarea se aplică acestei conversații.</span></div><button className="modelRefresh" onClick={async e=>{e.stopPropagation();await onRefresh?.()}} disabled={refreshing} title="Actualizează lista de modele" aria-label="Actualizează lista de modele"><RotateCcw size={14} className={refreshing?"spin":""}/></button></div>
      {list.length>7&&<div className="modelSearch"><Search size={14}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Caută model" aria-label="Caută model"/></div>}
      <div className="modelPickerList" role="listbox" ref={listRef}>
        {filtered.map(x=><button key={x} className={cx("modelOption",x===model&&"active")} onClick={()=>{onSelect(x);setOpen(false)}} role="option" aria-selected={x===model}>
          <span className="modelOptionIcon"><Sparkles size={15}/></span>
          <span className="modelOptionCopy"><b>{x}</b><small>{x===model?"Selectat acum":"Folosește acest AI"}</small></span>
          {x===model&&<Check size={16}/>}
        </button>)}
        {!list.length&&<div className="modelEmpty">Nu există modele disponibile. {policyEnforced?"Cere Owner-ului acces la cel puțin un model.":"Pornește OmniRoute sau adaugă o cheie API în Setări."}</div>}
        {list.length>0&&!filtered.length&&<div className="modelEmpty">Nu am găsit modelul căutat.</div>}
      </div>
      <div className="modelPickerFoot">{refreshing?"Actualizez lista de modele…":policyEnforced?"Owner-ul stabilește ce modele sunt disponibile pentru contul tău.":"Modelele vin din OmniRoute și din API-urile configurate pe acest PC."}</div>
    </div>}
    </div>
  </div>;
}

function Header({onMenu,model,onSelectModel,models,onRefreshModels,refreshingModels,policyEnforced,omni,showOmni,onShare,current,projects,onDetach,onMoveProject,onFiles,onGitHub,onGitHubRollback,hasGitHubBackup,onArchive,onUnarchive,onDelete}) {
  const {isOwner}=useAccess();
  const [more,setMore]=useState(false),[moveOpen,setMoveOpen]=useState(false);
  const moreRef=useRef(null);
  useDismiss(more,()=>{setMore(false);setMoveOpen(false)},moreRef);
  const close=()=>{setMore(false);setMoveOpen(false)};
  return <header className="topbar">
    <button className="iconOnly menuBtn" onClick={onMenu} aria-label="Afișează sau ascunde meniul" title="Meniu"><Menu size={20}/></button>
    <ModelPicker model={model} onSelect={onSelectModel} models={models} onRefresh={onRefreshModels} refreshing={refreshingModels} policyEnforced={policyEnforced}/>
    <div className="topSpacer"/>
    {showOmni&&<div className={cx("connection",omni?"ok":"bad")} title={omni?"OmniRoute răspunde.":"OmniRoute nu răspunde. Chatul continuă prin API-urile directe configurate, dacă există."}>{omni?<Wifi size={15}/>:<WifiOff size={15}/>} {omni?"OmniRoute conectat":"OmniRoute oprit"}</div>}
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

function MessageActions({message,title,disabled,onRegenerate,onRate}) {
  const {can,deny}=useAccess();
  const [speaking,setSpeaking]=useState(false),[exporting,setExporting]=useState("");
  const speakingRef=useRef(false);
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
    {["pdf","docx","pptx"].map(f=><button key={f} className={cx(exportLocked&&"locked")} onClick={()=>exp(f)} disabled={!!exporting} title={exportLocked?deniedMessage("document_generation"):`Descarcă ${f.toUpperCase()}`} aria-label={`Descarcă răspunsul ca ${f.toUpperCase()}`}><span className="formatTag">{exporting===f?"…":f.toUpperCase()}</span></button>)}
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
  const [downloading,setDownloading]=useState(false);
  async function download(){
    if(downloading)return;setDownloading(true);
    try{await downloadGeneratedFile(attachment)}catch(e){toast(e.message)}finally{setDownloading(false)}
  }
  if(media){
    return <div className={cx("generatedMedia",kind)}>
      {src?(kind==="image"?<img src={src} alt={attachment.name||"Imagine generată de AI Stoica"}/>:kind==="video"?<video controls preload="metadata" src={src}/>:<audio controls preload="metadata" src={src}/>)
        :<div className="mediaPlaceholder">{failed?"Previzualizarea nu este disponibilă. Fișierul a fost probabil șters din Bibliotecă.":"Se încarcă previzualizarea…"}</div>}
      <div className="generatedMediaBar"><span><b>{attachment.name}</b><small>{(attachment.mimeType||kind).replace(/^.*\//,"").toUpperCase()} · {formatBytes(attachment.size)}{attachment.provider?` · ${attachment.provider}`:""}</small></span><button onClick={download} disabled={downloading}><Download size={17}/> {downloading?"Se descarcă…":"Descarcă"}</button></div>
    </div>;
  }
  return <button className="generatedDownload" onClick={download} disabled={downloading} title={"Descarcă "+(attachment?.name||"fișierul")}><span className="generatedFileIcon"><FileText size={20}/></span><span className="generatedFileMeta"><b>{attachment?.name}</b><small>{(attachment?.format||attachment?.name?.split(".").pop()||"FIȘIER").toUpperCase()} · {formatBytes(attachment?.size)}</small></span><span className="generatedDownloadAction"><Download size={18}/><em>{downloading?"Se descarcă…":"Descarcă"}</em></span></button>;
}

function MediaAttachment({attachment}) {
  const kind=attachment?.type;
  const isMedia=["image","audio","video"].includes(kind)&&!!attachment?.libraryId;
  const {src,failed}=useAuthedBlobUrl(isMedia?`/api/library/${attachment.libraryId}/content`:"");
  async function download(){try{await downloadLibraryFile(attachment)}catch(e){toast(e.message)}}
  if(!isMedia)return <span className="fileChip"><Paperclip size={12}/>{attachment?.name}{attachment?.libraryId&&<button onClick={download} title="Descarcă" aria-label={`Descarcă ${attachment?.name||"fișierul"}`}><Download size={12}/></button>}</span>;
  const Icon=kind==="audio"?Volume2:kind==="video"?Play:ImageIcon;
  return <div className={cx("messageMedia",kind)}>
    <div className="messageMediaHead"><span><Icon size={15}/><b>{attachment.name}</b></span><button title="Descarcă" aria-label={`Descarcă ${attachment.name}`} onClick={download}><Download size={15}/></button></div>
    {src?(kind==="image"?<img src={src} alt={attachment.name}/>:kind==="audio"?<audio controls preload="metadata" src={src}/>:<video controls preload="metadata" src={src}/>)
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
function ConversationView({conversation,busy,busyStage,busySteps,onRegenerate,onRate,onCodeResult,canRunCode}) {
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
  if(!conversation||!conversation.messages?.length)return <div className="welcome"><BrandMark/><h1>Cu ce lucrăm astăzi?</h1><p>Întreabă orice. AI Stoica poate folosi memoria, internetul, contextul proiectului, biblioteca, pluginurile și automatizările tale.{isOwner?" Ca Owner, poți rula cod direct din blocurile de cod (clic dreapta pe cod).":""}</p></div>;
  const lastIndex=conversation.messages.length-1;
  return <div className="messagesColumn">
    {conversation.messages.map((m,i)=>{
      if(m.role==="user")return <div key={m.id||i} className="userRow"><div className="userMessageWrap"><div className="userBubble copyByRightClick" onContextMenu={e=>openCopyMenu(e,m)}><div className="userText">{messageText(m)}</div>{m.attachments?.length>0&&<div className="inlineAttachments mediaAttachments">{m.attachments.map((a,j)=><MediaAttachment key={a.libraryId||j} attachment={a}/>)}</div>}</div><div className="userMessageActions"><CopyMessageButton message={m}/></div></div></div>;
      if(m.role!=="assistant")return null;
      const text=String(m.content||(m.attachmentOnly?m.artifactSource||"":"")).trim();
      return <div key={m.id||i} className={cx("assistantBlock",(m.error||m.mediaGenerationError)&&"errorMessage")}><div className="assistantMark" aria-hidden="true">S</div><div className="assistantBody copyByRightClick" onContextMenu={e=>openCopyMenu(e,m)}>
        {m.routeInfo&&<RouteBadge info={m.routeInfo}/>}
        {text&&<Markdown text={text}/>}
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

function Composer({centered,draft,setDraft,onSend,onStop,busy,attachments,setAttachments,onOpenLibrary,responseMode,setResponseMode,mediaMode,setMediaMode,mentionsVersion}) {
  const {can,deny}=useAccess();
  const ta=useRef(null),fileInput=useRef(null),imageInput=useRef(null),videoInput=useRef(null),audioInput=useRef(null),recorderRef=useRef(null),streamRef=useRef(null),chunksRef=useRef([]),attachRef=useRef(null),mountedRef=useRef(true);
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
          setAttachments(v=>[...v,attachment]);
          if(attachment.transcript)setDraft(v=>(v?v+" ":"")+attachment.transcript);
          else toast("Vocalul a fost salvat și atașat, dar transcrierea automată nu a reușit.","info");
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
  const placeholder=uploading?"Se încarcă fișierul…":recording?"Ascult… apasă microfonul pentru oprire":transcribing?"Transcriu vocea…":mediaMode==="image"?"Descrie imaginea pe care vrei s-o creez…":mediaMode==="video"?"Descrie videoclipul pe care vrei să-l creez…":"Mesaj pentru AI Stoica";
  const hint=uploading?"Fișierul se salvează în Biblioteca AI Stoica (maxim 2 GB per fișier)…":recording?"Microfon activ — vorbește acum":transcribing?"AI Stoica transcrie înregistrarea…":mediaMode==="image"?"Mod Imagine: următorul mesaj generează o imagine. Apasă din nou „Imagine” pentru a renunța.":mediaMode==="video"?"Mod Video: următorul mesaj generează un videoclip. Apasă din nou „Video” pentru a renunța.":"AI Stoica poate greși. Verifică informațiile importante.";
  return <div className={cx("composerDock",centered&&"centered")} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
    {mentionOptions.length>0&&<div className="mentionMenu" role="listbox" aria-label="Pluginuri și automatizări">{mentionOptions.map((x,i)=><button key={x.type+x.trigger+i} role="option" aria-selected={i===mentionIndex} className={cx(i===mentionIndex&&"active")} onMouseDown={e=>e.preventDefault()} onClick={()=>insertMention(x)}><span className={cx("mentionType",x.type)}>{x.type==="plugin"?<Plug size={14}/>:<CalendarClock size={14}/>}</span><span><b>{x.name}</b><small>{x.type==="plugin"?"Plugin":"Automatizare"} · {x.trigger}</small></span></button>)}</div>}
    <div className={cx("composerCard",dragOver&&"dragOver")}>
      {dragOver&&<div className="dropHint">{uploadLocked?deniedMessage("file_upload"):"Eliberează pentru a atașa fișierele"}</div>}
      {attachments.length>0&&<div className="attachmentTray">{attachments.map((a,i)=><TrayChip key={(a.libraryId||a.name)+i} attachment={a} onRemove={()=>setAttachments(v=>v.filter((_,j)=>j!==i))}/>)}</div>}
      <div className="composerLine">
        <input ref={fileInput} type="file" hidden multiple onChange={filesChosen}/>
        <input ref={imageInput} type="file" hidden multiple accept="image/png,image/jpeg,image/webp,image/gif" onChange={filesChosen}/>
        <input ref={videoInput} type="file" hidden multiple accept="video/mp4,video/webm,video/quicktime,.mp4,.mov,.m4v,.avi,.mkv,.mpeg,.mpg" onChange={filesChosen}/>
        <input ref={audioInput} type="file" hidden multiple accept="audio/mpeg,audio/mp3,audio/mp4,audio/x-m4a,audio/aac,audio/wav,audio/x-wav,audio/ogg,audio/flac,audio/opus,.mp3,.m4a,.aac,.wav,.ogg,.flac,.opus" onChange={filesChosen}/>
        <div className="attachWrap" ref={attachRef}><button className="composerIcon" onClick={()=>setMenu(v=>!v)} title="Fișiere și unelte" aria-label="Fișiere și unelte" aria-haspopup="menu" aria-expanded={menu}><Plus size={21}/></button>{menu&&<div className="attachMenu" role="menu">
          <button role="menuitem" className={cx(!can("web_search")&&"locked")} onClick={lockedItem("web_search",()=>toolPrompt("Caută pe internet informații actuale despre "))}><Globe2 size={16}/> Căutare web{!can("web_search")&&<Lock size={12} className="lockIcon"/>}</button>
          <button role="menuitem" className={cx(!can("deep_research")&&"locked")} onClick={lockedItem("deep_research",()=>toolPrompt("Fă deep research, verifică mai multe surse și explică-mi complet: "))}><Search size={16}/> Deep Research{!can("deep_research")&&<Lock size={12} className="lockIcon"/>}</button>
          <button role="menuitem" className={cx(!can("image_generation")&&"locked")} onClick={()=>toggleMedia("image")}><ImageIcon size={16}/> Creează imagine{!can("image_generation")&&<Lock size={12} className="lockIcon"/>}</button>
          <button role="menuitem" className={cx(!can("video_generation")&&"locked")} onClick={()=>toggleMedia("video")}><Video size={16}/> Creează video{!can("video_generation")&&<Lock size={12} className="lockIcon"/>}</button>
          <div className="menuDivider"/>
          <button role="menuitem" className={cx(uploadLocked&&"locked")} onClick={lockedItem("file_upload",()=>fileInput.current?.click())}><Upload size={16}/> Încarcă orice fișier{uploadLocked&&<Lock size={12} className="lockIcon"/>}</button>
          <button role="menuitem" onClick={()=>{setMenu(false);onOpenLibrary()}}><Library size={16}/> Alege din Bibliotecă</button>
        </div>}</div>
        <div className="mediaQuickButtons">
          <button className={cx("composerIcon mediaQuick",uploadLocked&&"locked")} onClick={lockedItem("file_upload",()=>imageInput.current?.click())} title={uploadLocked?deniedMessage("file_upload"):"Încarcă imagine"} aria-label="Încarcă imagine"><ImageIcon size={19}/></button>
          <button className={cx("composerIcon mediaQuick",uploadLocked&&"locked")} onClick={lockedItem("file_upload",()=>videoInput.current?.click())} title={uploadLocked?deniedMessage("file_upload"):"Încarcă video MP4 / MOV / WebM"} aria-label="Încarcă video"><Play size={19}/></button>
          <button className={cx("composerIcon mediaQuick",uploadLocked&&"locked")} onClick={lockedItem("file_upload",()=>audioInput.current?.click())} title={uploadLocked?deniedMessage("file_upload"):"Încarcă audio MP3 / M4A / WAV / OGG"} aria-label="Încarcă audio"><Volume2 size={19}/></button>
        </div>
        <textarea ref={ta} value={draft} onChange={e=>{setDraft(e.target.value);setMentionClosedFor(null)}} onPaste={pasteIntoComposer} spellCheck={true} aria-label="Mesaj pentru AI Stoica" placeholder={placeholder} onKeyDown={onKeyDown}/>
        <button className={cx("composerIcon",recording&&"recording",uploadLocked&&"locked")} onClick={mic} title={uploadLocked?deniedMessage("file_upload"):recording?"Oprește vocalul":"Înregistrează vocal"} aria-label={recording?"Oprește înregistrarea vocală":"Înregistrează vocal"} aria-pressed={recording} disabled={transcribing}><Mic size={20}/></button>
        {busy
          ? <button className="sendButton stopButton" onClick={onStop} title="Oprește răspunsul" aria-label="Oprește răspunsul"><Square size={15} fill="currentColor"/></button>
          : <button className="sendButton" disabled={!!uploading||recording||transcribing||!hasContent} onClick={trySend} title="Trimite" aria-label="Trimite mesajul"><ArrowUp size={20}/></button>}
      </div>
    </div>
    <div className="composerModeRow">
      <button className={cx("modeChip",responseMode==="rapid"&&"active")} aria-pressed={responseMode==="rapid"} onClick={()=>setResponseMode("rapid")}><Sparkles size={13}/> Rapid</button>
      <button className={cx("modeChip",responseMode==="thinking"&&"active")} aria-pressed={responseMode==="thinking"} onClick={()=>setResponseMode("thinking")}><Brain size={13}/> Gândire</button>
      <span className="modeDivider" aria-hidden="true"/>
      <button className={cx("modeChip media",mediaMode==="image"&&"active",!can("image_generation")&&"locked")} aria-pressed={mediaMode==="image"} title={can("image_generation")?"Următorul mesaj generează o imagine":deniedMessage("image_generation")} onClick={()=>toggleMedia("image")}><ImageIcon size={13}/> Imagine</button>
      <button className={cx("modeChip media",mediaMode==="video"&&"active",!can("video_generation")&&"locked")} aria-pressed={mediaMode==="video"} title={can("video_generation")?"Următorul mesaj generează un videoclip":deniedMessage("video_generation")} onClick={()=>toggleMedia("video")}><Video size={13}/> Video</button>
    </div>
    <div className="composerHint" aria-live="polite">{hint}</div>
  </div>;
}

function libraryCategory(x){const k=mediaKind(x.mime,x.name);return k==="image"||k==="audio"||k==="video"?k:"document";}
const LIBRARY_FILTERS=[["all","Toate"],["image","Imagini"],["document","Documente"],["audio","Audio"],["video","Video"]];
function LibraryPanel({onClose,onAttach,initialFilter="all"}) {
  const {can,deny}=useAccess();
  const [items,setItems]=useState([]),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState(""),[uploading,setUploading]=useState(false),[attaching,setAttaching]=useState(null),[filter,setFilter]=useState(initialFilter),[query,setQuery]=useState("");
  const input=useRef(null),mounted=useRef(true);
  useEffect(()=>()=>{mounted.current=false},[]);
  async function load(){
    try{const d=await api("/api/library");if(mounted.current){setItems(d.data||[]);setLoadError("")}}
    catch(e){if(mounted.current)setLoadError(e.message)}
    finally{if(mounted.current)setLoading(false)}
  }
  useEffect(()=>{load()},[]);
  async function upload(e){
    const files=[...(e.target.files||[])];e.target.value="";
    if(!files.length)return;
    if(!can("file_upload")){deny("file_upload");return;}
    setUploading(true);
    const failed=[];
    for(const f of files){try{await uploadFileToLibrary(f)}catch(err){failed.push(`${f.name}: ${err.message}`)}}
    if(failed.length)toast("Încărcare fișier: "+failed.join(" · "));
    else toast(files.length===1?"Fișierul a fost adăugat în Bibliotecă.":`${plural(files.length,"fișier","fișiere")} adăugate în Bibliotecă.`,"ok");
    if(mounted.current){setUploading(false);await load();}
  }
  async function remove(x){
    if(!confirm(`Ștergi „${x.name}” din Bibliotecă? Fișierul nu va mai putea fi descărcat nici din conversațiile în care a fost folosit.`))return;
    try{await api(`/api/library/${x.id}`,{method:"DELETE"});await load()}catch(e){toast("Ștergere: "+e.message)}
  }
  async function attach(x){
    if(attaching)return;
    setAttaching(x.id);
    try{const a=await libraryItemToAttachment(x);onAttach?.(a);onClose()}
    catch(e){toast("Atașare: "+e.message)}
    finally{if(mounted.current)setAttaching(null)}
  }
  const visible=items.filter(x=>(filter==="all"||libraryCategory(x)===filter)&&(!query.trim()||String(x.name||"").toLowerCase().includes(query.trim().toLowerCase())));
  const uploadLocked=!can("file_upload");
  return <ToolShell title="Bibliotecă" subtitle="Păstrează fișierele tale și refolosește-le în conversații." onClose={onClose}>
    <div className="toolActions"><button className={cx("primary",uploadLocked&&"locked")} onClick={()=>uploadLocked?deny("file_upload"):input.current?.click()} disabled={uploading}><Upload size={16}/> {uploading?"Se încarcă…":"Adaugă fișiere"}</button><input ref={input} type="file" multiple hidden onChange={upload}/><span className="toolNote">Maxim 2 GB per fișier. Fișierele sunt păstrate pe acest calculator.</span></div>
    <div className="libraryFilters">
      <div className="chipRow" role="tablist">{LIBRARY_FILTERS.map(([k,label])=><button key={k} role="tab" aria-selected={filter===k} className={cx("filterChip",filter===k&&"active")} onClick={()=>setFilter(k)}>{label}</button>)}</div>
      <div className="memorySearch librarySearch"><Search size={15}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Caută după nume" aria-label="Caută în Bibliotecă"/></div>
    </div>
    {loadError&&<div className="inlineError" role="alert">{loadError} <button className="linkBtn" onClick={()=>{setLoading(true);load()}}>Reîncearcă</button></div>}
    <div className="libraryGrid">{loading?<div className="emptyState"><HardDrive size={30}/>Se încarcă biblioteca…</div>:visible.length===0?<div className="emptyState"><HardDrive size={30}/>{items.length?"Niciun fișier nu corespunde filtrului.":"Biblioteca este goală."}</div>:visible.map(x=>{
      const cat=libraryCategory(x);
      return <div className="libraryCard" key={x.id}><div className="fileIcon">{cat==="image"?<ImageIcon size={22}/>:cat==="audio"?<Volume2 size={22}/>:cat==="video"?<Play size={22}/>:<FileText size={22}/>}</div><div className="fileMeta"><b title={x.name}>{x.name}</b><span>{kindLabel(mediaKind(x.mime,x.name),x.mime,x.name)} · {formatBytes(x.size)} · {fmtTime(x.createdAt)}</span></div><div className="libraryActions"><button className="smallBtn" onClick={()=>attach(x)} disabled={!!attaching}>{attaching===x.id?"Se pregătește…":"Folosește"}</button><button className="iconOnly smallIcon" onClick={()=>downloadLibraryFile({libraryId:x.id,name:x.name}).catch(e=>toast(e.message))} aria-label={`Descarcă ${x.name}`} title="Descarcă"><Download size={16}/></button><button className="iconDanger" onClick={()=>remove(x)} aria-label={`Șterge ${x.name}`} title="Șterge"><Trash2 size={16}/></button></div></div>;
    })}</div>
    {uploading&&<div className="toolStatus" role="status">Se încarcă fișierul… pentru fișiere mari poate dura.</div>}
  </ToolShell>;
}

const MEMORY_SOURCES={manual:"adăugată manual",automatic:"reținută automat",history:"import din istoric",automation:"din automatizare"};
function MemoryPanel({onClose}) {
  const [items,setItems]=useState([]),[loading,setLoading]=useState(true),[enabled,setEnabled]=useState(true),[query,setQuery]=useState(""),[text,setText]=useState(""),[summary,setSummary]=useState(null),[busy,setBusy]=useState(""),[error,setError]=useState("");
  const seq=useRef(0),mounted=useRef(true);
  useEffect(()=>()=>{mounted.current=false},[]);
  async function load(q=query){
    const id=++seq.current;
    try{
      const [d,sm]=await Promise.all([api(`/api/memory${q?`?q=${encodeURIComponent(q)}`:""}`),api("/api/memory/summary").catch(()=>({data:null}))]);
      if(id!==seq.current||!mounted.current)return;
      setItems(d.data||[]);setEnabled(d.enabled!==false);setSummary(sm.data||null);setError("");
    }catch(e){if(id===seq.current&&mounted.current)setError(e.message)}
    finally{if(id===seq.current&&mounted.current)setLoading(false)}
  }
  useEffect(()=>{const t=setTimeout(()=>load(query.trim()),query.trim()?300:0);return()=>clearTimeout(t)},[query]);
  async function run(kind,fn){if(busy)return;setBusy(kind);try{await fn()}catch(e){toast(e.message)}finally{if(mounted.current)setBusy("")}}
  const toggle=()=>run("toggle",async()=>{const d=await api("/api/memory/toggle",{method:"POST",body:JSON.stringify({enabled:!enabled})});setEnabled(d.enabled!==false)});
  const add=()=>{if(!text.trim())return;run("add",async()=>{await api("/api/memory",{method:"POST",body:JSON.stringify({text:text.trim(),pinned:true})});setText("");toast("Informația a fost salvată și fixată în memorie.","ok");await load()})};
  const pin=x=>run("pin",async()=>{await api(`/api/memory/${x.id}`,{method:"PATCH",body:JSON.stringify({pinned:!x.pinned})});await load()});
  const remove=x=>{if(!confirm("Ștergi această informație din memorie?"))return;run("remove",async()=>{await api(`/api/memory/${x.id}`,{method:"DELETE"});await load()})};
  const clear=()=>{if(!confirm("Ștergi toate memoriile AI Stoica pentru acest cont? Operația nu poate fi anulată."))return;run("clear",async()=>{await api("/api/memory",{method:"DELETE"});setQuery("");await load("")})};
  const importHistory=()=>{if(!confirm("Import din istoricul conversațiilor informațiile durabile (preferințe, decizii, detalii de proiect)?"))return;run("import",async()=>{const d=await api("/api/memory/import-history",{method:"POST",body:"{}"});toast(`Am importat ${plural(d.count||0,"informație","informații")} din istoric.`,"ok");await load()})};
  return <ToolShell title="Memorie" subtitle="Reține automat informațiile durabile și relevante, fără să salveze fiecare replică." onClose={onClose}>
    <div className="memoryTop"><button className={cx("memoryToggle",enabled&&"on")} onClick={toggle} disabled={!!busy} aria-pressed={enabled}>{enabled?<ToggleRight size={22}/>:<ToggleLeft size={22}/>} Memorie {enabled?"activă":"oprită"}</button><button className="secondary" onClick={importHistory} disabled={!!busy}>{busy==="import"?"Se importă…":"Importă istoricul relevant"}</button><button className="dangerButton" onClick={clear} disabled={!!busy}><Trash2 size={15}/> Șterge tot</button></div>
    {summary&&<div className="memorySummary">
      <div><span>Total memorii</span><b>{summary.count||0}</b></div>
      <div><span>Fixate</span><b>{summary.pinned||0}</b></div>
      <div><span>Categorii</span><b>{Object.keys(summary.categories||{}).length}</b></div>
      <small>AI Stoica extrage automat preferințe, decizii și detalii de proiect și le folosește doar când sunt relevante.</small>
    </div>}
    <div className="memoryAdd"><textarea value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&(e.ctrlKey||e.metaKey)){e.preventDefault();add()}}} placeholder="Adaugă manual ceva important pe care AI Stoica să-l țină minte… (Ctrl+Enter salvează)" aria-label="Informație nouă pentru memorie"/><button className="primary" onClick={add} disabled={!text.trim()||!!busy}>{busy==="add"?"Se salvează…":"Salvează și fixează"}</button></div>
    <div className="memorySearch"><Search size={15}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Caută în memorie" aria-label="Caută în memorie"/></div>
    {error&&<div className="inlineError" role="alert">{error}</div>}
    <div className="memoryList">{loading?<div className="emptyState small">Se încarcă memoria…</div>:items.length===0?<div className="emptyState small">{query.trim()?"Nu am găsit nimic pentru această căutare.":"Memoria este goală. AI Stoica va reține automat preferințele și deciziile importante."}</div>:items.map(x=><div className="memoryItem" key={x.id}><button className="pinBtn" onClick={()=>pin(x)} disabled={!!busy} aria-label={x.pinned?"Anulează fixarea":"Fixează informația"} title={x.pinned?"Fixată — apasă pentru a anula":"Fixează"}>{x.pinned?<Pin size={16}/>:<PinOff size={16}/>}</button><div><p>{x.text}</p><span>{x.category||"detaliu"} · {MEMORY_SOURCES[x.source]||x.source||"memorie"} · {fmtTime(x.updatedAt||x.createdAt)}</span></div><button className="iconDanger" onClick={()=>remove(x)} disabled={!!busy} aria-label="Șterge informația" title="Șterge"><Trash2 size={15}/></button></div>)}</div>
  </ToolShell>;
}

const PLUGIN_APP_LINKS={
  "Gmail":"https://mail.google.com/","Google Drive":"https://drive.google.com/","GitHub":"https://github.com/login","Outlook Email":"https://outlook.office.com/mail/",
  "Adobe":"https://account.adobe.com/","Figma":"https://www.figma.com/login","Canva":"https://www.canva.com/login/","Shopify":"https://admin.shopify.com/",
  "Atlassian Rovo":"https://id.atlassian.com/login","monday.com":"https://auth.monday.com/","Notion":"https://www.notion.so/login","Google Calendar":"https://calendar.google.com/",
  "Slack":"https://slack.com/signin","Teams":"https://teams.microsoft.com/","Zoom":"https://zoom.us/signin","Hostinger Mail":"https://mail.hostinger.com/",
  "Higgsfield":"https://higgsfield.ai/","Runway":"https://app.runwayml.com/","Supabase":"https://supabase.com/dashboard","Render":"https://dashboard.render.com/",
  "Vercel":"https://vercel.com/login","Railway":"https://railway.com/login","Spotify":"https://open.spotify.com/","HubSpot":"https://app.hubspot.com/login",
  "PostHog":"https://app.posthog.com/","Amplitude":"https://app.amplitude.com/","Typeform":"https://admin.typeform.com/"
};
const PLUGIN_OAUTH={
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
const PLUGIN_CATALOG=[
  ["Populare","Gmail","Citește și organizează emailurile din Gmail","@gmail","M","gmail"],
  ["Populare","Google Drive","Documente, foi de calcul și prezentări din Drive","@drive","△","googledrive"],
  ["Populare","GitHub","Issues, pull requests și depozite de cod","@github","GH","github"],
  ["Populare","Remote Desktop Commander","Automatizări și control de la distanță","@remote","DC"],
  ["Populare","Health","Datele tale de sănătate","@health","♥"],
  ["Populare","Outlook Email","Emailurile din Outlook","@outlook","O","microsoftoutlook"],
  ["Noi și remarcabile","Adobe","Creează, combină și editează documente și grafică","@adobe","A","adobe"],
  ["Noi și remarcabile","Figma","Design de interfețe și prototipuri","@figma","F","figma"],
  ["Noi și remarcabile","MagicPath","Design pe o pânză comună","@magicpath","MP"],
  ["Noi și remarcabile","Canva","Creează și editează design-uri","@canva","C","canva"],
  ["Noi și remarcabile","Shopify","Administrează magazinul online","@shopify","S","shopify"],
  ["Noi și remarcabile","Atlassian Rovo","Jira, Confluence, Loom și altele","@rovo","A","atlassian"],
  ["Productivitate","Firecrawl","Caută și extrage date de pe web","@firecrawl","🔥"],
  ["Productivitate","Flaim Fantasy","Analize pentru sporturi fantasy","@flaim","FF"],
  ["Productivitate","monday.com","Proiecte, sarcini și CRM","@monday","M","mondaydotcom"],
  ["Productivitate","Notion","Documente și fluxuri de lucru Notion","@notion","N","notion"],
  ["Productivitate","Google Calendar","Evenimentele din Google Calendar","@calendar","31","googlecalendar"],
  ["Productivitate","Metricool","Analizează și programează postări","@metricool","∞"],
  ["Comunicare","Slack","Canale și mesaje Slack","@slack","S","slack"],
  ["Comunicare","Teams","Echipe și conversații Microsoft Teams","@teams","T","microsoftteams"],
  ["Comunicare","Zoom","Informații din întâlnirile Zoom","@zoom","Z","zoom"],
  ["Comunicare","Superhuman Mail","Asistent pentru email și calendar","@superhuman","✉"],
  ["Comunicare","Hostinger Mail","Emailul găzduit la Hostinger","@hostinger","H","hostinger"],
  ["Comunicare","Mailopoly Inbox","Caută și trimite emailuri și mesaje","@mailopoly","◇"],
  ["Creativitate","Higgsfield","Modele AI pentru imagini și video","@higgsfield","HF"],
  ["Creativitate","Viewmax","Videoclipuri create cu AI","@viewmax","▶"],
  ["Creativitate","Runway","Generare video cu modele AI","@runway","R","runway"],
  ["Creativitate","invideo","Videoclipuri de orice durată","@invideo","IV"],
  ["Instrumente pentru dezvoltatori","Supabase","Administrează și interoghează baze de date","@supabase","S","supabase"],
  ["Instrumente pentru dezvoltatori","Render","Resursele tale de pe Render","@render","R","render"],
  ["Instrumente pentru dezvoltatori","WPVibe","Unelte AI pentru WordPress","@wpvibe","WP"],
  ["Instrumente pentru dezvoltatori","Exa","Căutare web pentru agenți AI","@exa","E"],
  ["Instrumente pentru dezvoltatori","Vercel","Construiește și publică aplicații web","@vercel","▲","vercel"],
  ["Instrumente pentru dezvoltatori","Railway","Construiește și publică aplicații","@railway","R","railway"],
  ["Sănătate","COROS","Antrenamente și date de sănătate","@coros","C","coros"],
  ["Sănătate","Tredict","Analizează antrenamente și creează planuri","@tredict","T"],
  ["Sănătate","freddy","Întrebări despre datele tale de sănătate","@freddy","F"],
  ["Sănătate","Fitness AI Connector","Antrenor AI pentru datele Garmin","@fitness","AI"],
  ["Sănătate","Calorie Tracker","Urmărește alimentația și caloriile","@calories","CT"],
  ["Sănătate","LiftTrack","Antrenamente de forță pentru Garmin","@lifttrack","LT"],
  ["Divertisment","Destiny AI Astrology","Hărți natale și horoscop","@destiny","D"],
  ["Divertisment","Smart Chess","Joacă șah și învață strategie","@chess","♞"],
  ["Divertisment","Spotify","Muzică și podcasturi","@spotify","●","spotify"],
  ["Divertisment","Chessy","Joacă șah cu AI Stoica","@chessy","♘"],
  ["Divertisment","SoundBreak","Muzică AI alături de artiști","@soundbreak","◉"],
  ["Divertisment","PocketMind: Texas Hold'em","Poker Texas Hold'em cu AI","@pocketmind","♠"],
  ["Educație","Consensus","Explorează cercetarea științifică","@consensus","C"],
  ["Educație","SciSpace","Pentru știință și cercetare","@scispace","S"],
  ["Educație","Acumen by Talarion","Ține AI-ul la curent cu noutățile","@acumen","T"],
  ["Educație","Explain Video Generator","Videoclipuri explicative create cu AI","@explain","▶"],
  ["Educație","Scite","Caută în literatura științifică","@scite","S"],
  ["Educație","Tarteel","Resurse pentru studiul Coranului","@tarteel","◇"],
  ["Business și operațiuni","HubSpot","Date și acțiuni din HubSpot","@hubspot","H","hubspot"],
  ["Business și operațiuni","Windsor.ai","Conectează peste 350 de surse de date","@windsor","W"],
  ["Business și operațiuni","Adspirer","Creează, lansează și analizează reclame","@adspirer","AD"],
  ["Business și operațiuni","vidIQ","Statistici și cuvinte cheie YouTube","@vidiq","IQ"],
  ["Business și operațiuni","Ubersuggest","Cercetare SEO","@ubersuggest","U"],
  ["Date și analiză","PostHog","Analizează datele produsului","@posthog","PH","posthog"],
  ["Date și analiză","Helium 10","Datele tale Helium 10","@helium","H10"],
  ["Date și analiză","Blockscout","Analizează date blockchain","@blockscout","B","blockscout"],
  ["Date și analiză","Data","Răspunsuri pe baza datelor tale","@data","▥"],
  ["Date și analiză","Amplitude","Analizează comportamentul utilizatorilor","@amplitude","A","amplitude"],
  ["Date și analiză","Typeform","Formulare și analiza răspunsurilor","@typeform","T","typeform"],
  ["Cercetare științifică","Undermind","Găsește și citește articole științifice","@undermind","U"],
  ["Cercetare științifică","Inductive","Modele ADMET de ultimă generație","@inductive","I"],
  ["Cercetare științifică","Boltz","Structuri, molecule și proteine","@boltz","B"],
  ["Cercetare științifică","Tamarind Bio","Design proteic și molecular","@tamarind","TB"],
  ["Cercetare științifică","Proto","Modele AI pentru biologie","@proto","P"],
  ["Cercetare științifică","Rowan","Simulări de chimie și biologie","@rowan","R"],
  ["Securitate","Codex Security","Scanare de securitate pentru cod","@codexsecurity","CS"],
  ["Securitate","PrivacyHawk","Protejează datele personale","@privacyhawk","PH"],
  ["Securitate","Soluvery","Auditează permisiunile Google Drive","@soluvery","S"],
  ["Securitate","Malwarebytes","Verifică linkuri, domenii și numere de telefon","@malwarebytes","M","malwarebytes"],
  ["Securitate","AJAXX Data Scrubber","Elimină datele personale expuse","@ajaxx","AX"],
  ["Securitate","Ansvar Gateway","Legi, securitate și conformitate","@ansvar","AI"],
  ["Altele","Tarot","Citiri de tarot","@tarot","✦"],
  ["Altele","Astrologic","Hărți natale și horoscop","@astrologic","☾"],
  ["Altele","Kleinanzeigen","Anunțuri de vânzare din Germania","@kleinanzeigen","K","kleinanzeigen"],
  ["Altele","Steer Astro","Astrolog AI personal","@steerastro","◎"]
].map(([group,name,description,trigger,mark,slug])=>({group,name,description,trigger,mark,slug}));
const PLUGIN_GROUPS=["Populare","Noi și remarcabile","Productivitate","Comunicare","Creativitate","Instrumente pentru dezvoltatori","Sănătate","Divertisment","Educație","Business și operațiuni","Date și analiză","Cercetare științifică","Securitate","Altele"];
const SKILLS=[
  {name:"Căutare web",description:"Caută informații actuale și surse online.",mark:"W",perm:"web_search"},
  {name:"Documente",description:"Generează și lucrează cu PDF, DOCX și PPTX.",mark:"D",perm:"document_generation"},
  {name:"Cod și GitHub",description:"Analizează cod și lucrează cu GitHub.",mark:"</>",perm:"github_access"},
  {name:"Imagini",description:"Creează imagini cu AI.",mark:"I",perm:"image_generation"},
  {name:"Fișiere și date",description:"Analizează fișiere, tabele și documente încărcate.",mark:"∑",perm:"file_upload"},
  {name:"Automatizări",description:"Rulează sarcini programate și monitorizări.",mark:"A",perm:"automations"}
];
function pluginHasIntegration(x){return !!(PLUGIN_APP_LINKS[x.name]||PLUGIN_OAUTH[x.name]);}
function isHttpUrl(value){try{const u=new URL(String(value||"").trim());return u.protocol==="https:"||u.protocol==="http:"}catch{return false}}

function SetupOverlay({onClose,children}) {
  const {ref,backdropProps}=useModal(onClose);
  return <div className="claudeSetupBackdrop" {...backdropProps}><div className="claudeSetupPanel" ref={ref} role="dialog" aria-modal="true" aria-label="Configurare plugin" tabIndex={-1}>{children}</div></div>;
}
function ResultNote({result}){return result?<div className={cx("pluginResult claudeResult",result.kind)} role={result.kind==="error"?"alert":"status"}>{result.text}</div>:null;}

function PluginsPanel({onClose}) {
  const {can}=useAccess();
  const blank={name:"",description:"",url:"",method:"POST",trigger:"",apiKey:"",auto:false,oauthClientId:"",oauthClientSecret:""};
  const [items,setItems]=useState([]),[loading,setLoading]=useState(true),[form,setForm]=useState(blank),[result,setResult]=useState(null),[setupResult,setSetupResult]=useState(null),[saving,setSaving]=useState(""),[testing,setTesting]=useState(null);
  const [topTab,setTopTab]=useState("plugins"),[scope,setScope]=useState("public"),[query,setQuery]=useState(""),[selected,setSelected]=useState(null),[redirectUri,setRedirectUri]=useState("");
  const oauthTimer=useRef(null),mounted=useRef(true);
  useEffect(()=>()=>{mounted.current=false;clearInterval(oauthTimer.current)},[]);
  async function load(){
    try{const d=await api("/api/plugins");if(mounted.current)setItems(d.data||[])}
    catch(e){if(mounted.current)setResult({kind:"error",text:"Nu am putut încărca pluginurile: "+e.message})}
    finally{if(mounted.current)setLoading(false)}
  }
  useEffect(()=>{load()},[]);
  async function add(e){
    e?.preventDefault?.();
    if(saving)return;
    if(!form.name.trim()){setSetupResult({kind:"error",text:"Scrie un nume pentru plugin."});return;}
    if(!isHttpUrl(form.url)){setSetupResult({kind:"error",text:"Adresa API trebuie să fie un link complet, de exemplu https://exemplu.ro/webhook."});return;}
    setSaving("api");setSetupResult(null);
    try{
      await api("/api/plugins",{method:"POST",body:JSON.stringify({...form,name:form.name.trim(),url:form.url.trim()})});
      setResult({kind:"ok",text:`${form.name.trim()}: pluginul a fost conectat.`});
      closeSetup();await load();
    }catch(err){setSetupResult({kind:"error",text:err.message})}
    finally{if(mounted.current)setSaving("")}
  }
  async function patch(x,p){try{await api(`/api/plugins/${x.id}`,{method:"PATCH",body:JSON.stringify(p)});await load()}catch(e){toast(e.message)}}
  async function test(x){
    if(testing)return;setTesting(x.id);
    try{const d=await api(`/api/plugins/${x.id}/test`,{method:"POST",body:JSON.stringify({message:"Test conexiune AI Stoica"})});setResult({kind:"ok",text:`${x.name}: ${d.result||"conexiune reușită"}`})}
    catch(e){setResult({kind:"error",text:`${x.name}: eroare — ${e.message}`})}
    finally{if(mounted.current)setTesting(null)}
  }
  async function remove(x){
    if(!confirm(`Ștergi pluginul „${x.name}”?`))return;
    try{await api(`/api/plugins/${x.id}`,{method:"DELETE"});await load()}catch(e){toast(e.message)}
  }
  async function connectOAuth(){
    if(!selected?.oauth||saving)return;
    if(!form.oauthClientId.trim()){setSetupResult({kind:"error",text:"Lipsește OAuth Client ID."});return;}
    if(selected.oauth.requiresSecret&&!form.oauthClientSecret.trim()){setSetupResult({kind:"error",text:"Acest serviciu necesită și OAuth Client Secret."});return;}
    setSaving("oauth");setSetupResult(null);
    try{
      const d=await api("/api/plugins/oauth/start",{method:"POST",body:JSON.stringify({
        name:form.name||selected.name,description:form.description||selected.description,trigger:form.trigger||selected.trigger,auto:form.auto,
        clientId:form.oauthClientId.trim(),clientSecret:form.oauthClientSecret.trim(),...selected.oauth
      })});
      if(d.redirectUri)setRedirectUri(d.redirectUri);
      const opened=await window.AIStoica?.openExternal?.(d.authorizeUrl);
      if(opened&&!opened.ok)throw new Error(opened.error||"Nu am putut deschide pagina OAuth.");
      setSetupResult({kind:"info",text:"Autorizarea s-a deschis în browser. Finalizează-o acolo; AI Stoica salvează conexiunea automat."});
      const name=String(selected.name).toLowerCase(),started=Date.now();
      clearInterval(oauthTimer.current);
      oauthTimer.current=setInterval(async()=>{
        try{
          const fresh=(await api("/api/plugins")).data||[];
          const connected=fresh.find(x=>String(x.name).toLowerCase()===name&&x.oauthConnected);
          if(connected||Date.now()-started>120000){
            clearInterval(oauthTimer.current);oauthTimer.current=null;
            if(!mounted.current)return;
            setItems(fresh);
            if(connected){setResult({kind:"ok",text:`${connected.name}: conectat cu succes.`});closeSetup();}
            else setSetupResult({kind:"error",text:"Autorizarea nu a fost finalizată în 2 minute. Încearcă din nou."});
          }
        }catch{}
      },2000);
    }catch(e){setSetupResult({kind:"error",text:`Eroare OAuth — ${e.message}`})}
    finally{if(mounted.current)setSaving("")}
  }
  function chooseCatalog(x){setSelected({...x,appUrl:PLUGIN_APP_LINKS[x.name]||"",oauth:PLUGIN_OAUTH[x.name]||null});setForm({...blank,name:x.name,description:x.description,trigger:x.trigger});setSetupResult(null);setRedirectUri("")}
  function closeSetup(){setSelected(null);setForm(blank);setSetupResult(null)}
  function iconUrl(x){return x.slug?`https://cdn.simpleicons.org/${x.slug}`:null}
  async function openProviderApp(){
    const url=selected?.appUrl;
    if(!url||saving)return;
    setSaving("direct");
    try{
      await api("/api/plugins/direct",{method:"POST",body:JSON.stringify({name:selected.name,description:selected.description,trigger:selected.trigger,appUrl:url})});
      await load();
      const r=await window.AIStoica?.openExternal?.(url);
      if(r&&!r.ok)throw new Error(r.error||"Nu am putut deschide aplicația.");
      setResult({kind:"ok",text:`${selected.name}: salvat pentru deschidere directă, fără OAuth. Autentifică-te normal în aplicația oficială.`});
      closeSetup();
    }catch(e){setSetupResult({kind:"error",text:e.message})}
    finally{if(mounted.current)setSaving("")}
  }
  async function runInstalledPlugin(x){
    if(x.mode==="direct_app"&&(x.appUrl||x.url)){
      const r=await window.AIStoica?.openExternal?.(x.appUrl||x.url);
      setResult(r&&!r.ok?{kind:"error",text:`${x.name}: nu am putut deschide aplicația — ${r.error||"eroare"}`}:{kind:"ok",text:`${x.name}: aplicația a fost deschisă.`});
      return;
    }
    await test(x);
  }
  const installedNames=new Set(items.map(x=>String(x.name||"").toLowerCase()));
  const normalized=query.trim().toLowerCase();
  const filtered=PLUGIN_CATALOG.filter(x=>!normalized||x.name.toLowerCase().includes(normalized)||x.description.toLowerCase().includes(normalized)||x.group.toLowerCase().includes(normalized));
  const groups=PLUGIN_GROUPS.map(group=>({group,items:filtered.filter(x=>x.group===group)})).filter(x=>x.items.length);
  const redirectShown=redirectUri||`${String(GATEWAY).replace(/\/+$/,"")}${OAUTH_REDIRECT_PATH}`;
  return <ToolShell title="" label="Pluginuri" onClose={onClose}>
    <div className="stoicaPluginStore">
      <div className="stoicaPluginTop">
        <div className="stoicaPluginMainTabs" role="tablist">
          <button role="tab" aria-selected={topTab==="plugins"} className={topTab==="plugins"?"active":""} onClick={()=>setTopTab("plugins")}>Pluginuri</button>
          <button role="tab" aria-selected={topTab==="skills"} className={topTab==="skills"?"active":""} onClick={()=>setTopTab("skills")}>Competențe</button>
        </div>
        <button className="stoicaAddButton" onClick={()=>chooseCatalog({name:"Plugin personalizat",description:"Conectează orice API, endpoint sau webhook compatibil.",trigger:"@plugin",group:"Personal",mark:"+"})}><Plus size={15}/> Adaugă</button>
      </div>
      <div className="stoicaPluginSearch"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder={topTab==="plugins"?"Caută pluginuri":"Caută competențe"} aria-label="Caută"/></div>
      <ResultNote result={result}/>
      {topTab==="plugins"?<>
        {!!items.length&&<section className="stoicaInstalled">
          <button className="stoicaSectionTitle linkish" onClick={()=>setScope("personal")}>Instalate ({items.length}) <span>›</span></button>
          <div className="stoicaInstalledIcons">
            {items.slice(0,8).map(x=><button key={x.id} className="stoicaInstalledIcon" title={`${x.name} — ${x.mode==="direct_app"?"deschide aplicația":"testează conexiunea"}`} aria-label={x.name} onClick={()=>runInstalledPlugin(x)} disabled={testing===x.id}>
              <span>{String(x.name||"P").slice(0,2).toUpperCase()}</span>
            </button>)}
            {items.length>8&&<button className="stoicaInstalledIcon more" onClick={()=>setScope("personal")} aria-label="Vezi toate pluginurile instalate"><span>+{items.length-8}</span></button>}
          </div>
        </section>}
        <div className="stoicaScopeTabs" role="tablist">
          <button role="tab" aria-selected={scope==="public"} className={scope==="public"?"active":""} onClick={()=>setScope("public")}>Publice</button>
          <button role="tab" aria-selected={scope==="personal"} className={scope==="personal"?"active":""} onClick={()=>setScope("personal")}>Personale</button>
        </div>
        {scope==="personal"?<div className="stoicaPersonalList">
          {loading?<div className="stoicaPluginEmpty">Se încarcă pluginurile…</div>:!items.length?<div className="stoicaPluginEmpty">Nu ai încă pluginuri personale configurate. Apasă „Adaugă” pentru a conecta unul.</div>:
          items.filter(x=>!normalized||String(x.name||"").toLowerCase().includes(normalized)).map(x=><div className="stoicaManageRow" key={x.id}>
            <div className="stoicaPluginLogo"><span>{String(x.name||"P").slice(0,2).toUpperCase()}</span></div>
            <div className="stoicaPluginInfo"><b>{x.name}</b><small>{x.description||x.url}</small></div>
            <button className="smallBtn" onClick={()=>runInstalledPlugin(x)} disabled={testing===x.id}>{x.mode==="direct_app"?"Deschide":testing===x.id?"Se testează…":"Testează"}</button>
            <button className={cx("claudeToggle",x.enabled&&"on")} role="switch" aria-checked={!!x.enabled} aria-label={`${x.enabled?"Dezactivează":"Activează"} ${x.name}`} title={x.enabled?"Activ":"Oprit"} onClick={()=>patch(x,{enabled:!x.enabled})}><span/></button>
            <button className="iconDanger" onClick={()=>remove(x)} aria-label={`Șterge ${x.name}`} title="Șterge"><Trash2 size={16}/></button>
          </div>)}
        </div>:
        <div className="stoicaCatalog">
          {groups.map(({group,items:groupItems})=><section className="stoicaPluginSection" key={group}>
            <h3 className="stoicaSectionTitle">{group}</h3>
            <div className="stoicaPluginGrid">
              {groupItems.map((x,i)=>{
                const connected=installedNames.has(x.name.toLowerCase());
                const src=iconUrl(x);
                return <button className="stoicaPluginCard" key={x.group+x.name+i} onClick={()=>chooseCatalog(x)}>
                  <span className="stoicaPluginLogo">
                    {src?<img src={src} alt="" onError={e=>{e.currentTarget.style.display="none";if(e.currentTarget.nextSibling)e.currentTarget.nextSibling.style.display="grid"}}/>:null}
                    <span style={{display:src?"none":"grid"}}>{x.mark}</span>
                  </span>
                  <span className="stoicaPluginInfo"><b>{x.name}</b><small>{x.description}{!pluginHasIntegration(x)&&<em className="apiOnlyTag"> · doar prin API</em>}</small></span>
                  <span className={cx("stoicaPluginAdd",connected&&"connected")} aria-hidden="true">{connected?<Check size={15}/>:<Plus size={18}/>}</span>
                </button>;
              })}
            </div>
          </section>)}
          {!groups.length&&<div className="stoicaPluginEmpty">Nu am găsit pluginul căutat.</div>}
        </div>}
      </>:
      <div className="stoicaSkillsGrid">
        {SKILLS.filter(x=>!normalized||x.name.toLowerCase().includes(normalized)||x.description.toLowerCase().includes(normalized)).map(x=>{const ok=can(x.perm);return <div className={cx("stoicaSkillCard",!ok&&"locked")} key={x.name} title={ok?"Disponibilă pentru contul tău":deniedMessage(x.perm)}>
          <span className="stoicaPluginLogo"><span>{x.mark}</span></span>
          <div><b>{x.name}</b><small>{ok?x.description:"Dezactivată de Owner pentru contul tău."}</small></div>
          {ok?<Check size={16} aria-label="Disponibilă"/>:<Lock size={15} aria-label="Dezactivată"/>}
        </div>})}
      </div>}

      {selected&&<SetupOverlay onClose={closeSetup}>
          <div className="claudeSetupHead">
            <div className="claudePluginLogo large">{selected.mark}</div>
            <div><h3>{selected.name}</h3><p>{selected.description}</p></div>
            <button className="iconOnly" onClick={closeSetup} aria-label="Închide" title="Închide"><X size={18}/></button>
          </div>
          <ResultNote result={setupResult}/>
          {selected.group!=="Personal"&&!pluginHasIntegration(selected)
            ?<div className="claudeSetupNotice"><Plug size={16}/><span>AI Stoica nu are încă o conexiune directă pentru {selected.name}. Îl poți conecta doar prin API-ul sau webhook-ul oferit de furnizor, completând câmpurile de mai jos.</span></div>
            :<div className="claudeSetupNotice"><Plug size={16}/><span>Poți folosi pluginul fără OAuth pentru deschiderea directă a aplicației. OAuth/API este necesar doar când vrei ca AI Stoica să citească sau să modifice date private din acel serviciu.</span></div>}
          {selected.appUrl&&<div className="pluginDirectConnect">
            <button className="primary" onClick={openProviderApp} disabled={!!saving}><ExternalLink size={16}/> {saving==="direct"?"Se deschide…":`Conectează fără OAuth și deschide ${selected.name}`}</button>
            <small>AI Stoica salvează pluginul ca legătură directă și deschide aplicația oficială. Te autentifici normal în browser.</small>
          </div>}
          <form className="claudeSetupForm" onSubmit={add}>
            <label>Nume<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
            {selected.oauth&&<div className="oauthBox">
              <label>OAuth Client ID<input placeholder="Client ID al aplicației create la furnizor" value={form.oauthClientId} onChange={e=>setForm({...form,oauthClientId:e.target.value})}/></label>
              <label><span className="labelLine">OAuth Client Secret <span className="optional">{selected.oauth.requiresSecret?"necesar":"opțional / PKCE"}</span></span><input type="password" placeholder="Client Secret" value={form.oauthClientSecret} onChange={e=>setForm({...form,oauthClientSecret:e.target.value})}/></label>
              <small className="settingsHelp">Adresa de redirecționare pe care trebuie s-o înregistrezi la furnizor: <code>{redirectShown}</code></small>
              <button type="button" className="secondary pluginOAuthButton" onClick={connectOAuth} disabled={!!saving}><ExternalLink size={15}/> {saving==="oauth"?"Se pregătește…":"Conectează prin OAuth (acces la date)"}</button>
            </div>}
            <label>Endpoint / webhook / API personalizat<input placeholder="https://…" value={form.url} onChange={e=>setForm({...form,url:e.target.value})} inputMode="url"/></label>
            <div className="claudeFormRow"><label>Trigger<input placeholder="@gmail" value={form.trigger} onChange={e=>setForm({...form,trigger:e.target.value})}/></label><label>Metodă<select value={form.method} onChange={e=>setForm({...form,method:e.target.value})}><option>POST</option><option>GET</option></select></label></div>
            <label><span className="labelLine">Cheie API <span className="optional">opțional</span></span><input type="password" placeholder="Cheie / token" value={form.apiKey} onChange={e=>setForm({...form,apiKey:e.target.value})} autoComplete="off"/></label>
            <label className="claudeAutoRow"><span><b>Folosește automat</b><small>Permite pluginului să fie inclus automat când este relevant.</small></span><input type="checkbox" checked={form.auto} onChange={e=>setForm({...form,auto:e.target.checked})}/></label>
            <div className="claudeSetupActions"><button type="button" className="secondary" onClick={closeSetup}>Anulează</button><button className="primary" disabled={!form.name.trim()||!form.url.trim()||!!saving}>{saving==="api"?"Se conectează…":"Conectează API personalizat"}</button></div>
          </form>
      </SetupOverlay>}
    </div>
  </ToolShell>;
}

const ADMIN_STATUS_LABELS={pending:"În așteptare",active:"Activ",rejected:"Respins",suspended:"Suspendat",blocked:"Blocat"};
const AUDIT_LABELS={"admin.user_status":"Status cont modificat","admin.permissions":"Permisiuni modificate","admin.sessions_revoke":"Sesiuni închise","admin.paid_ai":"AI plătit modificat","auth.register":"Cont nou","auth.login":"Autentificare","auth.logout":"Deconectare"};
function AdminPanel({onClose}) {
  const permissionLabels={
    chat:"Chat AI",cerebras:"Cerebras",gemini:"Gemini",groq:"Groq",cloudflare:"Cloudflare AI",
    openrouter:"OpenRouter (poate genera costuri)",image_generation:"Generare imagini",video_generation:"Generare videoclipuri",document_generation:"Fișiere: PDF / Word / PowerPoint / Excel / CSV / ZIP / cod",
    file_upload:"Încărcare fișiere",web_search:"Căutare web",deep_research:"Deep Research",
    automations:"Automatizări",plugins:"Pluginuri",github_access:"GitHub",openai:"OpenAI (plătit)",anthropic:"Claude / Anthropic (plătit)"
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

const FREQ_LABELS={once:"O singură dată",hourly:"La fiecare oră",interval:"La fiecare N ore",daily:"Zilnic",weekly:"Săptămânal",selected_days:"În anumite zile",monthly:"Lunar"};
const DAY_NAMES=["duminică","luni","marți","miercuri","joi","vineri","sâmbătă"];
const AUTOMATION_STATUS={created:"Creată",updated:"Modificată",delivered:"Rulată",checked_no_change:"Verificată, fără schimbări",error:"Eroare",needs_login:"Așteaptă autentificarea",permission_denied:"Oprită de Owner",disabled_after_errors:"Oprită după erori"};
function localTimeZone(){try{return Intl.DateTimeFormat().resolvedOptions().timeZone||""}catch{return ""}}
function describeSchedule(x){
  const t=x.time||"09:00";
  switch(x.frequency){
    case "once":return `O singură dată · ${fmtTime(x.runAt)}`;
    case "hourly":return "La fiecare oră";
    case "interval":return `La fiecare ${plural(Number(x.intervalHours||1),"oră","ore")}`;
    case "weekly":return `Săptămânal, ${DAY_NAMES[Number(x.weekday)]||"luni"} la ${t}`;
    case "selected_days":return `${(x.days||[]).map(d=>DAY_NAMES[Number(d)]).filter(Boolean).join(", ")||"nicio zi"} la ${t}`;
    case "monthly":return `Lunar, în ziua ${x.monthday||1} la ${t}`;
    default:return `Zilnic la ${t}`;
  }
}
function validateAutomation(f){
  if(!f.title.trim())return "Scrie un titlu pentru automatizare.";
  if(f.title.trim().length>120)return "Titlul poate avea maximum 120 de caractere.";
  if(!f.prompt.trim())return "Scrie ce trebuie să facă AI Stoica.";
  if(f.prompt.trim().length>8000)return "Instrucțiunea poate avea maximum 8000 de caractere.";
  if(!["hourly","interval","once"].includes(f.frequency)&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(f.time||""))return "Alege o oră validă (00:00–23:59).";
  if(f.frequency==="interval"&&!(Number.isInteger(Number(f.intervalHours))&&f.intervalHours>=1&&f.intervalHours<=168))return "Intervalul trebuie să fie între 1 și 168 de ore.";
  if(f.frequency==="monthly"&&!(Number.isInteger(Number(f.monthday))&&f.monthday>=1&&f.monthday<=28))return "Ziua lunii trebuie să fie între 1 și 28.";
  if(f.frequency==="selected_days"&&!f.days.length)return "Alege cel puțin o zi a săptămânii.";
  if(f.frequency==="once"){const at=Date.parse(f.runAt||"");if(!Number.isFinite(at))return "Alege data și ora pentru sarcina unică.";if(at<=Date.now()+30000)return "Alege o dată și o oră din viitor.";}
  return "";
}
function AutomationsPanel({onClose,model}) {
  const blank={title:"",prompt:"",trigger:"",frequency:"daily",time:"09:00",weekday:1,days:[1,2,3,4,5],runAt:"",intervalHours:1,monthday:1,timingMode:"exact_schedule",notify:true};
  const dayNames=[[1,"L"],[2,"Ma"],[3,"Mi"],[4,"J"],[5,"V"],[6,"S"],[0,"D"]];
  const [items,setItems]=useState([]),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState(""),[form,setForm]=useState(blank),[formError,setFormError]=useState(""),[saving,setSaving]=useState(false),[running,setRunning]=useState(null),[busyId,setBusyId]=useState(null);
  const mounted=useRef(true);
  useEffect(()=>()=>{mounted.current=false},[]);
  async function load(){
    try{const d=await api("/api/automations");if(mounted.current){setItems(d.data||[]);setLoadError("")}}
    catch(e){if(mounted.current)setLoadError(e.message)}
    finally{if(mounted.current)setLoading(false)}
  }
  useEffect(()=>{load();const id=setInterval(()=>{if(!document.hidden)load()},30000);return()=>clearInterval(id)},[]);
  async function add(e){
    e.preventDefault();
    if(saving)return;
    const problem=validateAutomation(form);
    if(problem){setFormError(problem);return;}
    setFormError("");setSaving(true);
    try{
      await api("/api/automations",{method:"POST",body:JSON.stringify({...form,title:form.title.trim(),prompt:form.prompt.trim(),trigger:form.trigger.trim(),runAt:form.frequency==="once"?Date.parse(form.runAt):null,model,timeZone:localTimeZone(),enabled:true})});
      setForm(blank);toast("Automatizarea a fost creată.","ok");await load();
    }catch(err){setFormError(err.message)}
    finally{if(mounted.current)setSaving(false)}
  }
  async function patch(x,p){
    if(busyId)return;setBusyId(x.id);
    try{await api(`/api/automations/${x.id}`,{method:"PATCH",body:JSON.stringify({...p,timeZone:localTimeZone()})});await load()}
    catch(e){toast(e.message)}
    finally{if(mounted.current)setBusyId(null)}
  }
  async function run(x){
    if(running)return;setRunning(x.id);
    try{await api(`/api/automations/${x.id}/run`,{method:"POST",body:"{}"});toast(`„${x.title}” a rulat. Rezultatul este afișat în listă.`,"ok");await load()}
    catch(e){toast(`„${x.title}”: ${e.message}`)}
    finally{if(mounted.current)setRunning(null)}
  }
  async function remove(x){
    if(!confirm(`Ștergi automatizarea „${x.title}”?`))return;
    try{await api(`/api/automations/${x.id}`,{method:"DELETE"});await load()}catch(e){toast(e.message)}
  }
  function toggleDay(d){setForm(v=>({...v,days:v.days.includes(d)?v.days.filter(x=>x!==d):[...v.days,d]}))}
  const watch=form.timingMode==="condition_watch";
  return <ToolShell title="Automatizări" subtitle="Memento-uri, sarcini recurente și verificări condiționale care rulează în fundal cât AI Stoica este pornit." onClose={onClose}>
    <div className="automationModeTabs" role="tablist">
      {[["exact_schedule","La oră exactă"],["flexible_schedule","Flexibil"],["condition_watch","Când se schimbă ceva"]].map(([k,label])=><button key={k} role="tab" aria-selected={form.timingMode===k} className={form.timingMode===k?"active":""} onClick={()=>setForm(v=>({...v,timingMode:k,frequency:k==="condition_watch"&&v.frequency!=="interval"?"hourly":v.frequency}))}>{label}</button>)}
    </div>
    <form className="automationForm" onSubmit={add} noValidate>
      <input placeholder="Titlu, ex. Rezumat zilnic" value={form.title} maxLength={120} onChange={e=>setForm({...form,title:e.target.value})} aria-label="Titlu"/>
      <input placeholder="Trigger opțional, ex. @rezumat-zilnic" value={form.trigger} onChange={e=>setForm({...form,trigger:e.target.value})} aria-label="Trigger"/>
      <textarea placeholder={watch?"Ce condiție trebuie verificată și când să te notific?":"Ce trebuie să facă AI Stoica?"} value={form.prompt} maxLength={8000} onChange={e=>setForm({...form,prompt:e.target.value})} aria-label="Instrucțiune"/>
      <div className="automationRow">
        <select value={form.frequency} onChange={e=>setForm({...form,frequency:e.target.value})} aria-label="Frecvență">
          {Object.entries(FREQ_LABELS).map(([k,label])=><option key={k} value={k}>{label}</option>)}
        </select>
        {form.frequency==="interval"&&<label className="inlineField">la fiecare<input type="number" min="1" max="168" value={form.intervalHours} onChange={e=>setForm({...form,intervalHours:Math.max(1,Math.min(168,Math.round(Number(e.target.value)||1)))})}/>ore</label>}
        {!["hourly","interval","once"].includes(form.frequency)&&<input type="time" value={form.time} onChange={e=>setForm({...form,time:e.target.value})} aria-label="Ora"/>}
        {form.frequency==="once"&&<input type="datetime-local" value={form.runAt} onChange={e=>setForm({...form,runAt:e.target.value})} aria-label="Data și ora"/>}
        {form.frequency==="weekly"&&<select value={form.weekday} onChange={e=>setForm({...form,weekday:Number(e.target.value)})} aria-label="Ziua săptămânii"><option value={1}>Luni</option><option value={2}>Marți</option><option value={3}>Miercuri</option><option value={4}>Joi</option><option value={5}>Vineri</option><option value={6}>Sâmbătă</option><option value={0}>Duminică</option></select>}
        {form.frequency==="monthly"&&<label className="inlineField">ziua<input type="number" min="1" max="28" value={form.monthday} onChange={e=>setForm({...form,monthday:Math.max(1,Math.min(28,Math.round(Number(e.target.value)||1)))})}/></label>}
      </div>
      {form.frequency==="selected_days"&&<div className="dayPicker">{dayNames.map(([d,n])=><button type="button" key={d} aria-pressed={form.days.includes(d)} aria-label={DAY_NAMES[d]} className={form.days.includes(d)?"active":""} onClick={()=>toggleDay(d)}>{n}</button>)}</div>}
      <label className="automationNotify"><input type="checkbox" checked={form.notify} onChange={e=>setForm({...form,notify:e.target.checked})}/><span><b>Notifică-mă când are rezultat</b><small>{watch?"La verificările condiționale nu notifică dacă nu s-a schimbat nimic.":"Afișează o notificare desktop când sarcina rulează."}</small></span></label>
      {formError&&<div className="inlineError" role="alert">{formError}</div>}
      <button className="primary" disabled={saving}><Plus size={16}/> {saving?"Se creează…":"Creează automatizare"}</button>
    </form>
    {loadError&&<div className="inlineError" role="alert">Nu am putut încărca automatizările: {loadError}</div>}
    <div className="automationList">
      {loading?<div className="emptyState small">Se încarcă automatizările…</div>:!items.length?<div className="emptyState small">Nu ai încă automatizări. Completează formularul de mai sus pentru a crea prima.</div>:items.map(x=><div className="automationCard" key={x.id}><div className="automationIcon"><CalendarClock size={20}/></div><div className="automationInfo"><b>{x.title}</b><span>{x.timingMode==="condition_watch"?"Monitorizare":x.timingMode==="flexible_schedule"?"Program flexibil":"Program exact"} · {describeSchedule(x)} · următoarea: {x.enabled?fmtTime(x.nextRunAt):"oprită"}</span><p>{x.prompt}</p>{x.lastResult&&<details><summary>{AUTOMATION_STATUS[x.lastStatus]||"Ultimul rezultat"} · {fmtTime(x.lastRunAt)}</summary><div className="lastResult">{x.lastResult}</div></details>}</div><button className="iconOnly" disabled={!!running} onClick={()=>run(x)} title="Rulează acum" aria-label={`Rulează acum ${x.title}`}>{running===x.id?<RotateCcw size={16} className="spin"/>:<Play size={16}/>}</button><button className={cx("claudeToggle",x.enabled&&"on")} role="switch" aria-checked={!!x.enabled} disabled={busyId===x.id} onClick={()=>patch(x,{enabled:!x.enabled})} title={x.enabled?"Activă — apasă pentru a o opri":"Oprită — apasă pentru a o porni"} aria-label={`${x.enabled?"Oprește":"Pornește"} ${x.title}`}><span/></button><button className="iconDanger" onClick={()=>remove(x)} title="Șterge" aria-label={`Șterge ${x.title}`}><Trash2 size={16}/></button></div>)}
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
function ProviderTestBox() {
  const [state,setState]=useState({busy:false,data:null,media:[],error:""});
  async function run(){
    setState({busy:true,data:null,media:[],error:""});
    try{const d=await api("/api/providers/test",{method:"POST",body:"{}"});setState({busy:false,data:d.data||[],media:d.media||[],error:""})}
    catch(e){setState({busy:false,data:null,media:[],error:e.message})}
  }
  return <div className="providerTest">
    <div className="providerTestHead"><div><b>Testează cheile</b><span>Verifică fiecare API salvat. Salvează setările înainte de test.</span></div>
      <button className="secondary" onClick={run} disabled={state.busy}>{state.busy?"Se testează…":"Testează acum"}</button></div>
    {state.error&&<div className="providerRow bad"><X size={15}/><span>{state.error}</span></div>}
    {state.data&&!state.data.length&&<div className="providerRow bad"><X size={15}/><span>Nu ai nicio cheie de chat salvată. Adaugă de exemplu o cheie Gemini sau Groq și salvează.</span></div>}
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

function SettingsModal({onClose,onSaved,user,machineSettingsAllowed=true}) {
  const {isOwner}=useAccess();
  const [cfg,setCfg]=useState(null),[keys,setKeys]=useState({}),[tab,setTab]=useState("general"),[status,setStatus]=useState(null),[micStatus,setMicStatus]=useState(""),[toolStatus,setToolStatus]=useState(""),[error,setError]=useState(""),[saving,setSaving]=useState(false),[updateStatus,setUpdateStatus]=useState("");
  const {ref,backdropProps}=useModal(onClose);
  const mounted=useRef(true);
  useEffect(()=>()=>{mounted.current=false},[]);
  useEffect(()=>{
    if(!window.AIStoica?.getConfig){setError("Setările sunt disponibile doar în aplicația AI Stoica pentru Windows.");return;}
    Promise.all([window.AIStoica.getConfig(),window.AIStoica.systemStatus?.().catch(()=>null)])
      .then(([c,s])=>{if(mounted.current){setCfg(c||{});setStatus(s)}})
      .catch(e=>{if(mounted.current)setError("Nu am putut citi setările: "+e.message)});
  },[]);
  useEffect(()=>{if(!machineSettingsAllowed&&["ai","chatapis","images","video"].includes(tab))setTab("general")},[machineSettingsAllowed,tab]);
  const set=patch=>setCfg(c=>({...c,...patch}));
  async function save(){
    if(saving||!cfg)return;
    setError("");
    const gw=cleanGatewayUrl(cfg.gatewayUrl||DEFAULT_GATEWAY);
    if(machineSettingsAllowed&&!gw){setError("Adresa serviciului local nu este validă. Exemplu: "+DEFAULT_GATEWAY);setTab("ai");return;}
    const ownerEmail=String(cfg.ownerEmail||"").trim().toLowerCase();
    if(machineSettingsAllowed&&ownerEmail&&!/^\S+@\S+\.\S+$/.test(ownerEmail)){setError("Emailul Owner nu este valid.");setTab("account");return;}
    setSaving(true);
    try{
      if(machineSettingsAllowed&&gw!==GATEWAY){
        try{const r=await fetch(`${gw}/health`,{signal:AbortSignal.timeout(5000)});if(!r.ok)throw new Error("HTTP "+r.status)}
        catch{throw new Error(`Nu pot contacta serviciul AI Stoica la ${gw}. Verifică adresa sau folosește ${DEFAULT_GATEWAY}.`)}
      }
      const changedKeys=Object.fromEntries(Object.entries(keys).filter(([,v])=>v));
      const payload={...cfg,...(machineSettingsAllowed?{gatewayUrl:gw,ownerEmail}:{}),...changedKeys};
      const r=await window.AIStoica.setConfig(payload);
      if(r&&r.ok===false)throw new Error(r.error||"Setările nu au putut fi salvate.");
      if(machineSettingsAllowed)setGatewayUrl(gw);
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
  const tabs=[["general",SlidersHorizontal,"General",true],["ai",Bot,"AI & OmniRoute",machineSettingsAllowed],["chatapis",Plug,"API-uri AI",machineSettingsAllowed],["images",ImageIcon,"Poze",machineSettingsAllowed],["video",Play,"Video",machineSettingsAllowed],["voice",Volume2,"Voce și microfon",true],["account",User,"Cont și date",true]];
  return <div className="modalBackdrop" {...backdropProps}><div className="settingsModal" ref={ref} role="dialog" aria-modal="true" aria-label="Setări AI Stoica" tabIndex={-1}><div className="modalHead"><div><h2>Setări AI Stoica</h2><p>Aplicația, vocea, serviciile AI și actualizările.</p></div><button className="iconOnly" onClick={onClose} aria-label="Închide" title="Închide"><X size={20}/></button></div>
    {!cfg?<div className="settingsLoading">{error||"Se încarcă setările…"}</div>:<>
    <div className="settingsBody"><div className="settingsNav" role="tablist" aria-orientation="vertical">
      {tabs.filter(t=>t[3]).map(([k,Icon,label])=><button key={k} role="tab" aria-selected={tab===k} className={tab===k?"active":""} onClick={()=>setTab(k)}><Icon size={17}/> {label}</button>)}
    </div>
    <div className="settingsPane">
      {tab==="general"&&<><h3>General</h3>
        <label className="toggleRow"><div><b>Pornește AI Stoica cu Windows</b><span>Aplicația pornește automat și poate rămâne în fundal.</span></div><input type="checkbox" checked={!!cfg.startWithWindows} onChange={e=>set({startWithWindows:e.target.checked})}/></label>
        <label className="toggleRow"><div><b>Închidere în zona de notificare</b><span>Butonul X ascunde aplicația fără să oprească serviciile.</span></div><input type="checkbox" checked={cfg.closeToTray!==false} onChange={e=>set({closeToTray:e.target.checked})}/></label>
        <label className="toggleRow"><div><b>Actualizări automate</b><span>AI Stoica caută versiuni noi la pornire.</span></div><input type="checkbox" checked={cfg.autoUpdate!==false} onChange={e=>set({autoUpdate:e.target.checked})}/></label>
        {window.AIStoica?.checkUpdate&&<div className="settingsButtons"><button type="button" className="secondary" onClick={checkUpdate}><RotateCcw size={15}/> Caută actualizări acum</button></div>}
        {updateStatus&&<div className="micStatus" role="status">{updateStatus}</div>}
      </>}
      {tab==="ai"&&<><h3>AI & OmniRoute</h3>
        <label>Adresa serviciului AI Stoica<input value={cfg.gatewayUrl||DEFAULT_GATEWAY} onChange={e=>set({gatewayUrl:e.target.value})} placeholder={DEFAULT_GATEWAY}/></label>
        <p className="settingsHelp">Lasă {DEFAULT_GATEWAY} dacă nu folosești un server AI Stoica separat. Adresa este verificată înainte de salvare.</p>
        <label>AI Stoica Cloud API<input value={cfg.controlApiUrl||""} onChange={e=>set({controlApiUrl:e.target.value})} placeholder="https://api.aistoica.ro"/></label>
        <p className="settingsHelp">Cu Cloud API configurat, conturile, aprobările și permisiunile sunt gestionate central de Owner. Lasă câmpul gol pentru folosire doar pe acest PC.</p>
        <label>Adresa OmniRoute<input value={cfg.baseUrl||""} onChange={e=>set({baseUrl:e.target.value})}/></label>
        <KeyField label="Cheie API OmniRoute" name="apiKey" placeholder="Cheie OmniRoute" {...keyProps}/>
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
          {isOwner&&<>
            <label>Server SSH · adresă<input value={cfg.serverHost||""} onChange={e=>set({serverHost:e.target.value})} placeholder="IP sau domeniu"/></label>
            <div className="claudeFormRow"><label>Utilizator SSH<input value={cfg.serverUser||"root"} onChange={e=>set({serverUser:e.target.value})}/></label><label>Port SSH<input type="number" min="1" max="65535" value={cfg.serverPort||22} onChange={e=>set({serverPort:Number(e.target.value)||22})}/></label></div>
            <label>Calea cheii private SSH<input value={cfg.serverKeyPath||""} onChange={e=>set({serverKeyPath:e.target.value})} placeholder="C:\Users\Nume\.ssh\id_ed25519"/></label>
            <button type="button" className="secondary testMicBtn" onClick={testServer}>Testează serverul</button>{toolStatus&&<div className="micStatus" role="status">{toolStatus}</div>}
          </>}
        </details>
        <p className="settingsHelp">Când ceri o poză sau un videoclip, AI Stoica returnează fișierul real în chat, cu buton de descărcare.</p>
        <label>Comandă OmniRoute<input value={cfg.omniCommand||"omniroute.cmd"} onChange={e=>set({omniCommand:e.target.value})}/></label>
        <label className="toggleRow"><div><b>Pornește OmniRoute automat</b><span>Dacă serviciul cade, AI Stoica încearcă să îl repornească.</span></div><input type="checkbox" checked={!!cfg.autoStartOmniRoute} onChange={e=>set({autoStartOmniRoute:e.target.checked})}/></label>
        <div className="statusGrid"><div><span>Serviciul AI Stoica</span><b>{status?.gatewayRunning?"Pornit":"Indisponibil"}</b></div><div><span>OmniRoute</span><b>{status?.omniRunning?"Conectat":"Indisponibil"}</b></div></div>
      </>}
      {tab==="chatapis"&&<><div className="settingsSectionTitle"><div className="settingsSectionIcon"><Plug size={22}/></div><div><h3>API-uri AI</h3><p>Folosite direct pentru chat când OmniRoute nu răspunde.</p></div></div>
        <ProviderTestBox/>
        <label className="toggleRow"><div><b>Folosește API-urile directe</b><span>Dacă OmniRoute nu răspunde, conversația continuă prin providerii configurați pe acest PC.</span></div><input type="checkbox" checked={cfg.directChatEnabled!==false} onChange={e=>set({directChatEnabled:e.target.checked})}/></label>
        <label>Protecție costuri<select value={cfg.directChatCostPolicy||"free_only"} onChange={e=>set({directChatCostPolicy:e.target.value})}><option value="free_only">Doar provideri fără cost direct</option><option value="allow_paid">Permite și OpenAI</option></select></label>
        <label>Ordinea de încercare<input value={cfg.directChatProviderOrder||"cerebras,groq,gemini,mistral,nvidia,github,openrouter,cloudflare,cohere,huggingface,openai"} onChange={e=>set({directChatProviderOrder:e.target.value})}/></label>
        <p className="settingsHelp">Dacă lipsește cheia, providerul răspunde cu 429/404/503 sau nu răspunde deloc, AI Stoica încearcă următorul provider din listă.</p>
        <div className="providerGroup"><b>Cerebras</b><small>Compatibil OpenAI.</small></div>
        <KeyField label="Cheie API Cerebras" name="cerebrasApiKey" placeholder="csk-..." {...keyProps}/>
        <label>Model Cerebras<input value={cfg.cerebrasModel||"gpt-oss-120b"} onChange={e=>set({cerebrasModel:e.target.value})}/></label>
        <div className="providerGroup"><b>Groq</b><small>Compatibil OpenAI, răspunsuri rapide.</small></div>
        <KeyField label="Cheie API Groq" name="groqApiKey" placeholder="gsk_..." {...keyProps}/>
        <label>Model Groq<input value={cfg.groqModel||"llama-3.3-70b-versatile"} onChange={e=>set({groqModel:e.target.value})}/></label>
        <div className="providerGroup"><b>Gemini</b><small>Încearcă modelele în ordine până găsește cotă disponibilă.</small></div>
        <KeyField label="Cheie API Gemini" name="geminiApiKey" placeholder="AIza..." {...keyProps}/>
        <label>Modele Gemini · separate prin virgulă<input value={cfg.geminiModels||"gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite"} onChange={e=>set({geminiModels:e.target.value})}/></label>
        <div className="providerGroup"><b>Mistral</b><small>Compatibil OpenAI.</small></div>
        <KeyField label="Cheie API Mistral" name="mistralApiKey" placeholder="Cheie API" {...keyProps}/>
        <label>Model Mistral<input value={cfg.mistralModel||"mistral-small-latest"} onChange={e=>set({mistralModel:e.target.value})}/></label>
        <div className="providerGroup"><b>NVIDIA</b><small>NVIDIA API / NIM, compatibil OpenAI.</small></div>
        <KeyField label="Cheie API NVIDIA" name="nvidiaApiKey" placeholder="nvapi-..." {...keyProps}/>
        <label>Model NVIDIA<input value={cfg.nvidiaModel||"meta/llama-3.3-70b-instruct"} onChange={e=>set({nvidiaModel:e.target.value})}/></label>
        <div className="providerGroup"><b>GitHub Models</b><small>Folosește tokenul GitHub salvat; tokenul trebuie să aibă acces la Models.</small></div>
        <KeyField label="Token GitHub" name="githubToken" placeholder="github_pat_..." token {...keyProps}/>
        <label>Model GitHub<input value={cfg.githubModelsModel||"openai/gpt-4.1-mini"} onChange={e=>set({githubModelsModel:e.target.value})}/></label>
        <div className="providerGroup"><b>OpenRouter</b><small>AUTO_FREE caută automat primul model gratuit disponibil.</small></div>
        <KeyField label="Cheie API OpenRouter" name="openRouterApiKey" placeholder="sk-or-..." {...keyProps}/>
        <label>Model OpenRouter<input value={cfg.openRouterChatModel||"AUTO_FREE"} onChange={e=>set({openRouterChatModel:e.target.value})}/></label>
        <div className="providerGroup"><b>Cloudflare Workers AI</b><small>Același Account ID și token ca la secțiunea Poze.</small></div>
        <label>Cloudflare Account ID<input value={cfg.cloudflareAccountId||""} onChange={e=>set({cloudflareAccountId:e.target.value})}/></label>
        <KeyField label="Token API Cloudflare" name="cloudflareApiToken" placeholder="Token API" token {...keyProps}/>
        <label>Model Cloudflare<input value={cfg.cloudflareChatModel||"@cf/meta/llama-3.3-70b-instruct-fp8-fast"} onChange={e=>set({cloudflareChatModel:e.target.value})}/></label>
        <div className="providerGroup"><b>Cohere</b><small>API de compatibilitate.</small></div>
        <KeyField label="Cheie API Cohere" name="cohereApiKey" placeholder="Cheie API" {...keyProps}/>
        <label>Model Cohere<input value={cfg.cohereModel||"command-a-03-2025"} onChange={e=>set({cohereModel:e.target.value})}/></label>
        <div className="providerGroup"><b>Hugging Face</b><small>Router compatibil OpenAI; același token ca la secțiunea Poze.</small></div>
        <KeyField label="Token Hugging Face" name="hfToken" placeholder="hf_..." token {...keyProps}/>
        <label>Model Hugging Face<input value={cfg.huggingFaceChatModel||"meta-llama/Llama-3.3-70B-Instruct"} onChange={e=>set({huggingFaceChatModel:e.target.value})}/></label>
        <div className="providerGroup"><b>OpenAI</b><small>Inclus, dar blocat implicit de protecția costurilor.</small></div>
        <KeyField label="Cheie API OpenAI" name="openAiApiKey" placeholder="sk-..." {...keyProps}/>
        <label>Modele OpenAI · separate prin virgulă<input value={cfg.openAiChatModels||"gpt-5-mini,gpt-5-nano"} onChange={e=>set({openAiChatModels:e.target.value})}/></label>
      </>}
      {tab==="images"&&<><div className="settingsSectionTitle"><div className="settingsSectionIcon"><ImageIcon size={22}/></div><div><h3>Poze</h3><p>Generare imagini, API-uri, modele și încercare automată a altui provider.</p></div></div>
        <label><span className="labelLine">Model generare imagini <span className="optional">opțional</span></span><input value={cfg.imageModel||""} onChange={e=>set({imageModel:e.target.value})} placeholder="Automat — primul model de imagine disponibil"/></label>
        <details className="mediaProviderSettings" open><summary>Provideri de imagini</summary>
          <p className="settingsHelp">Poți conecta mai multe servicii. AI Stoica încearcă providerii în ordine și trece automat la următorul dacă unul eșuează. Cheile sunt criptate pe acest PC.</p>
          <label>Mod de alegere<select value={cfg.imageProviderMode||"auto"} onChange={e=>set({imageProviderMode:e.target.value})}><option value="auto">Automat — ordinea mea</option><option value="fast">⚡ Rapid</option><option value="quality">✨ Calitate</option><option value="free">🛡️ Doar gratuit</option></select></label>
          <label>Protecție costuri<select value={cfg.imageCostPolicy||"free_only"} onChange={e=>set({imageCostPolicy:e.target.value})}><option value="free_only">Nu permite costuri directe</option><option value="allow_paid">Permite provideri cu plată</option></select></label>
          <p className="settingsHelp">{(cfg.imageCostPolicy||"free_only")==="free_only"?"Protecție activă: AI Stoica încearcă direct Cloudflare și Pollinations. Hugging Face, Together, OpenAI, Stability, fal.ai și Replicate sunt blocate dacă ar putea consuma credit plătit. La OpenRouter se verifică prețul înainte de apel.":"Atenție: providerii configurați pot consuma credit conform tarifelor lor."}</p>
          <label>Ordinea de încercare<input value={cfg.imageProviderOrder||"cloudflare,pollinations,huggingface,together,openrouter,fal,replicate,stability,openai"} onChange={e=>set({imageProviderOrder:e.target.value})}/></label>
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
        <label>Mod video<select value={cfg.videoMode||"fast"} onChange={e=>{const videoMode=e.target.value;const quality=videoMode==="quality";set({videoMode,videoModel:quality?"bytedance/seedance-2.5":"bytedance/seedance-2.0-fast",openRouterVideoModel:quality?"bytedance/seedance-2.5":"bytedance/seedance-2.0-fast",geminiVideoModel:quality?"veo-3.1-generate-preview":"veo-3.1-fast-generate-preview"})}}><option value="fast">⚡ Rapid</option><option value="quality">🎬 Calitate</option><option value="free">🛡️ Doar gratuit</option></select></label>
        <label>Protecție costuri<select value={cfg.videoCostPolicy||"free_only"} onChange={e=>set({videoCostPolicy:e.target.value})}><option value="free_only">Nu porni joburi cu plată</option><option value="allow_paid">Permite provideri cu plată</option></select></label>
        <p className="settingsHelp">{(cfg.videoCostPolicy||"free_only")==="free_only"?"AI Stoica verifică prețul publicat când este disponibil și nu pornește generarea dacă nu poate confirma costul zero. Gemini Veo, fal.ai și Replicate rămân blocate în acest mod.":"Atenție: generarea video poate consuma rapid credit. Costul depinde de model, durată și rezoluție."}</p>
        <label>Ordinea de încercare<input value={cfg.videoProviderOrder||"pollinations,openrouter,gemini,fal,replicate"} onChange={e=>set({videoProviderOrder:e.target.value})}/></label>
        <div className="providerGroup"><b>Pollinations Video</b><small>Cheia este comună cu secțiunea Poze.</small></div>
        <KeyField label="Cheie API Pollinations" name="pollinationsApiKey" placeholder="sk_..." {...keyProps}/>
        <label>Model video Pollinations<input value={cfg.pollinationsVideoModel||"google/veo-3.1-fast"} onChange={e=>set({pollinationsVideoModel:e.target.value})}/></label>
        <div className="providerGroup"><b>OpenRouter Video</b><small>Seedance, Veo, Wan și alte modele prin același API.</small></div>
        <KeyField label="Cheie API OpenRouter" name="openRouterApiKey" placeholder="sk-or-..." {...keyProps}/>
        <label>Model video OpenRouter<input value={cfg.openRouterVideoModel||(cfg.videoMode==="quality"?"bytedance/seedance-2.5":"bytedance/seedance-2.0-fast")} onChange={e=>set({openRouterVideoModel:e.target.value})}/></label>
        <div className="providerGroup"><b>Gemini · Veo</b><small>Veo 3.1 prin aceeași cheie Gemini folosită la chat.</small></div>
        <KeyField label="Cheie API Gemini" name="geminiApiKey" placeholder="AIza..." {...keyProps}/>
        <label>Model video Gemini<input value={cfg.geminiVideoModel||"veo-3.1-fast-generate-preview"} onChange={e=>set({geminiVideoModel:e.target.value})}/></label>
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
        <p className="settingsHelp">Conversațiile, memoria, biblioteca, proiectele, pluginurile și automatizările sunt păstrate pe acest calculator.</p>
        {machineSettingsAllowed&&<>
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
  const [models,setModels]=useState(()=>cachedModels()),[modelPolicyEnforced,setModelPolicyEnforced]=useState(false),[refreshingModels,setRefreshingModels]=useState(false),[modelsChecked,setModelsChecked]=useState(false);
  const [currentId,setCurrentId]=useState(null),[model,setModel]=useState(()=>storage.get(MANUAL_MODEL_KEY)||storage.get(MODEL_SELECTED_KEY)||"");
  const [selectedProject,setSelectedProject]=useState(null),[selectedAssistant,setSelectedAssistant]=useState(null);
  const [draft,setDraft]=useState(""),[attachments,setAttachments]=useState([]),[responseMode,setResponseModeState]=useState(()=>storage.get(RESPONSE_MODE_KEY,"rapid")==="thinking"?"thinking":"rapid"),[mediaMode,setMediaMode]=useState(null);
  const [generations,setGenerations]=useState({});
  const [search,setSearch]=useState(""),[sidebar,setSidebar]=useState(false),[sidebarCollapsed,setSidebarCollapsed]=useState(()=>storage.get(SIDEBAR_COLLAPSED_KEY)==="1");
  const [omni,setOmni]=useState(false),[cloudConfigured,setCloudConfigured]=useState(null),[showJumpBottom,setShowJumpBottom]=useState(false);
  const [settings,setSettings]=useState(false),[entityModal,setEntityModal]=useState(null),[toolPanel,setToolPanel]=useState(null),[filesPanel,setFilesPanel]=useState(false),[githubModal,setGithubModal]=useState(false);
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
  const showFirstRun=!!user&&!boot&&modelsChecked&&!firstRunDismissed&&!refreshingModels&&models.length===0&&!omni&&(isOwner||cloudConfigured===false);
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
      const live=uniqueModels((ms.manualModels||ms.data||[]).map(x=>typeof x==="string"?x:x?.id)).filter(x=>!isSmartAlias(x));
      const enforced=ms.policyEnforced===true;
      const merged=enforced?live:uniqueModels([...live,...cachedModels()]);
      setModelPolicyEnforced(enforced);setModels(merged);storage.set(MODEL_CACHE_KEY,JSON.stringify(merged));
      setModel(prev=>{
        const pick=[prev,storage.get(MANUAL_MODEL_KEY),machineCfgRef.current?.model].find(x=>x&&merged.includes(x))||merged[0]||"";
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
    const value=String(next||"").trim();if(!value||isSmartAlias(value))return;
    if(modelPolicyEnforced&&!models.includes(value))return;
    setModel(value);storage.set(MANUAL_MODEL_KEY,value);storage.set(MODEL_SELECTED_KEY,value);
    if(current){
      const id=current.id;
      setConversations(v=>v.map(x=>x.id===id?{...x,model:value}:x));
      patchConversation(id,{model:value}).catch(e=>toast("Modelul nu a putut fi salvat pentru conversație: "+e.message));
    }
  }
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
    authLostHandler=message=>{
      const text=String(message||"").trim();
      const notice=/așteaptă aprobarea|asteapta aprobarea|nu este activ/i.test(text)?text:/^(Autentificare necesară|Sesiune)/i.test(text)||!text?"Sesiunea ta a expirat sau a fost închisă. Autentifică-te din nou.":`${text.replace(/[.!]?$/,".")} Autentifică-te din nou.`;
      logout({skipServer:true,notice});
    };
    return()=>{authLostHandler=null};
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
      try{const r=await fetch(`${GATEWAY}/health`,{signal:AbortSignal.timeout(7000)});const h=await r.json();if(stopped)return;setOmni(!!h.omni);setCloudConfigured(!!h.cloudConfigured)}
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
    if(current?.model&&!isSmartAlias(current.model)&&(!modelPolicyEnforced||models.includes(current.model))){setModel(current.model);return;}
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
    const effectiveModel=modelPolicyEnforced?(models.includes(desiredModel)?desiredModel:(models.includes(model)?model:(models[0]||""))):desiredModel;
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
      const r=await fetch(`${GATEWAY}/api/chat/stream`,{method:"POST",headers:authHeaders({"Content-Type":"application/json"}),body:JSON.stringify({model:effectiveModel,assistantId:baseConv.assistantId||null,projectId:baseConv.projectId||null,responseMode,messages:payload}),signal:controller.signal});
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
      if(format){
        if(!can("document_generation"))note+=`\n\n_${deniedMessage("document_generation")}_`;
        else{
          setGen(convId,{stage:`Creează fișierul ${format.toUpperCase()}…`});
          try{
            const previousAssistant=[...messages].reverse().find(m=>m.role==="assistant"&&!m.error&&!m.mediaKind);
            const previousSource=previousAssistant?(previousAssistant.artifactSource||messageText(previousAssistant)):"";
            const content=standaloneExportRequest(messageText(lastUser))&&previousSource?previousSource:answer;
            if(!String(content||"").trim())throw new Error("nu există conținut pentru fișier");
            const exported=await api("/api/export",{method:"POST",body:JSON.stringify({format,title:safeFileTitle(working.title||"AI Stoica - fișier"),content})});
            if(exported?.data)files=[exported.data];
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
  async function generateMediaAssistant(baseConv,messages,kind,prompt){
    const convId=baseConv.id;
    const controller=startGeneration(convId);
    setGen(convId,{stage:kind==="video"?"Generează videoclipul… poate dura câteva minute":"Creează imaginea și pregătește fișierul…"});
    const base={id:uid(),role:"assistant",createdAt:Date.now(),streaming:false,mediaKind:kind,mediaPrompt:prompt};
    try{
      let message;
      try{
        const d=await api(kind==="video"?"/api/generate/video":"/api/generate/image",{method:"POST",body:JSON.stringify({prompt}),signal:controller.signal});
        const file={...d.data,type:d.data?.kind||kind,kind:d.data?.kind||kind};
        message={...base,content:"",attachments:[file],routeInfo:{task:kind==="video"?"video_generation":"image_generation",model:file.model||"",provider:inferModelProvider(file.model||"")}};
      }catch(e){
        const reason=controller.signal.reason;
        if(reason==="deleted"||reason==="logout"||reason==="replaced")return;
        message=controller.signal.aborted
          ?{...base,content:"",stopped:true}
          :{...base,content:`Generarea ${kind==="video"?"videoclipului":"imaginii"} nu a reușit: ${friendlyError(e.message)}`,mediaGenerationError:true};
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
  async function send(){
    const text=draft.trim();
    const usable=attachments.filter(a=>a.part||a.parts?.length);
    if(!text&&!usable.length)return;
    if(currentId&&generations[currentId])return;
    const media=mediaMode||(attachments.length===0?requestedMediaGeneration(text):null);
    if(media){
      const perm=media==="video"?"video_generation":"image_generation";
      if(!can(perm)){deny(perm);return}
      if(!text){toast(media==="video"?"Descrie videoclipul pe care vrei să-l creez.":"Descrie imaginea pe care vrei s-o creez.","info");return}
    }
    const format=media?null:requestedDocumentFormat(text);
    const userId=uid();
    const parts=[...(text?[{type:"text",text}]:[]),...usable.flatMap(a=>Array.isArray(a.parts)&&a.parts.length?a.parts:[a.part].filter(Boolean))];
    const content=parts.length===1&&parts[0].type==="text"?parts[0].text:parts;
    const transient=usable.flatMap(a=>a.transientParts||[]);
    const extra=transient.length?{[userId]:transient}:{};
    const userMsg={id:userId,role:"user",content,displayText:text||`Fișier atașat: ${attachments.map(a=>a.name).join(", ")}`,attachments:attachments.map(a=>({name:a.name,type:a.type,mime:a.mime||"",size:a.size||0,libraryId:a.libraryId||null,transcript:a.transcript||""})),createdAt:Date.now()};
    const base=current?{...current}:{title:titleFrom(text||attachments[0]?.name),projectId:selectedProject,assistantId:selectedAssistant,model,messages:[]};
    const conv={...base,title:base.messages?.length?base.title:titleFrom(text||attachments[0]?.name),model,messages:[...(base.messages||[]),userMsg],updatedAt:Date.now()};
    const previous={draft,attachments,mediaMode};
    setDraft("");setAttachments([]);setMediaMode(null);
    let saved;
    try{saved=await saveConversation(conv)}
    catch(e){setDraft(previous.draft);setAttachments(previous.attachments);setMediaMode(previous.mediaMode);if(!isAuthLost(e.status,e.message))toast("Mesajul nu a putut fi trimis: "+e.message);return}
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
    if(name==="plugins"&&!can("plugins")){deny("plugins");return}
    if(name==="admin"&&!isOwner)return;
    setSidebar(false);setToolPanel({name,filter});
  }
  function closeTool(){
    if(toolPanel?.name==="plugins"||toolPanel?.name==="automations")setMentionsVersion(v=>v+1);
    setToolPanel(null);
  }
  function attachFromLibrary(a){setAttachments(v=>[...v,a])}
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
      <Header onMenu={toggleMenu} model={model} onSelectModel={chooseModel} models={models} onRefreshModels={()=>refreshModels()} refreshingModels={refreshingModels} policyEnforced={modelPolicyEnforced} omni={omni} showOmni={machineSettingsAllowed} onShare={share} current={current} projects={projects} onDetach={()=>moveCurrent(null)} onMoveProject={moveCurrent} onFiles={()=>setFilesPanel(true)} onGitHub={()=>setGithubModal(true)} onGitHubRollback={githubRollback} hasGitHubBackup={!!lastGithubBackup} onArchive={()=>current&&archiveConversation(current.id)} onUnarchive={()=>current&&unarchiveConversation(current.id)} onDelete={()=>current&&deleteConversation(current.id)}/>
      {loadError&&<div className="loadErrorBanner" role="alert"><span>Nu am putut încărca datele: {loadError}</span><button onClick={()=>loadData()}>Reîncearcă</button>{GATEWAY!==DEFAULT_GATEWAY&&<button onClick={resetGatewayAndReload}>Folosește serviciul local implicit</button>}</div>}
      {updateReady&&!updateDismissed&&<div className="updateBanner" role="status"><button className="updateInstall" onClick={()=>window.AIStoica?.installUpdate?.()}>Actualizare AI Stoica disponibilă — instalează acum</button><button className="updateClose" onClick={()=>setUpdateDismissed(true)} aria-label="Ascunde notificarea" title="Mai târziu"><X size={14}/></button></div>}
      <div className="chatScroll" ref={chatRef} onScroll={updateChatScrollState}><ConversationView conversation={current} busy={busy} busyStage={currentGen?.stage} busySteps={currentGen?.steps||[]} onRegenerate={regenerate} onRate={rate} canRunCode={isOwner} onCodeResult={text=>setDraft(v=>(v?v+"\n\n":"")+text)}/></div>
      {showJumpBottom&&hasMessages&&<button className="jumpToLatest" onClick={()=>jumpToLatest({smooth:true})} title="Mergi la ultimul mesaj" aria-label="Mergi la ultimul mesaj"><ChevronDown size={19}/><span>Ultimul mesaj</span></button>}
      <Composer centered={!hasMessages} draft={draft} setDraft={setDraft} onSend={send} onStop={stopGeneration} busy={busy} attachments={attachments} setAttachments={setAttachments} onOpenLibrary={()=>openTool("library","all")} responseMode={responseMode} setResponseMode={setResponseMode} mediaMode={mediaMode} setMediaMode={setMediaMode} mentionsVersion={mentionsVersion}/>
    </main>
    {settings&&<SettingsModal user={user} machineSettingsAllowed={machineSettingsAllowed} onClose={()=>setSettings(false)} onSaved={cfg=>{machineCfgRef.current={...(machineCfgRef.current||{}),...cfg};setCloudConfigured(!!String(cfg?.controlApiUrl||"").trim());Promise.resolve(window.AIStoica?.ensureOmni?.()).catch(()=>{});setTimeout(()=>loadData(),800)}}/>}
    {entityModal&&<EntityModal type={entityModal.type} item={entityModal.item} onClose={()=>setEntityModal(null)} onSave={saveEntity} onDelete={entityModal.item&&!entityModal.item.builtIn?deleteEntity:null}/>}
    {toolPanel?.name==="explore"&&<ExplorePanel onClose={closeTool} assistants={assistants} onUseAssistant={startWithAssistant} onImageMode={startImageMode} onOpenLibrary={filter=>openTool("library",filter)}/>}
    {toolPanel?.name==="library"&&<LibraryPanel onClose={closeTool} onAttach={attachFromLibrary} initialFilter={toolPanel.filter||"all"}/>}
    {toolPanel?.name==="memory"&&<MemoryPanel onClose={closeTool}/>}
    {toolPanel?.name==="admin"&&isOwner&&<AdminPanel onClose={closeTool}/>}
    {toolPanel?.name==="plugins"&&can("plugins")&&<PluginsPanel onClose={closeTool}/>}
    {toolPanel?.name==="automations"&&can("automations")&&<AutomationsPanel onClose={closeTool} model={model}/>}
    {filesPanel&&<ConversationFilesPanel conversation={current} onClose={()=>setFilesPanel(false)}/>}
    {githubModal&&isOwner&&<GithubSolveModal model={model} onClose={()=>setGithubModal(false)} onBackup={saveGithubBackup}/>}
    {showFirstRun&&<FirstRunGuide onOpenSettings={()=>{finishFirstRun();setSettings(true)}} onDone={ok=>{finishFirstRun();if(ok)refreshModels()}}/>}
  </div></AccessContext.Provider>;
}
createRoot(document.getElementById("root")).render(<ErrorBoundary><App/></ErrorBoundary>);
