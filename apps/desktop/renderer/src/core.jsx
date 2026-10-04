import React, { useContext, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { X, Check, Copy } from "lucide-react";

// Web version / installed phone app (PWA): the page is served by the AI Stoica server itself, so that server is the gateway.
// The Windows app (preload bridge, file://) and the Vite dev server (port 5173) keep the local service.
export const IS_WEB = typeof window!=="undefined" && !window.AIStoica && /^https?:$/.test(window.location.protocol) && window.location.port!=="5173";
export const DEFAULT_GATEWAY = IS_WEB ? window.location.origin : "http://127.0.0.1:8787";
export const GATEWAY_KEY = "aiStoicaGatewayUrlV1";
export const TOKEN_KEY = "aiStoicaAuthTokenV3";
export const USER_KEY = "aiStoicaUserV3";
export const PERMISSIONS_KEY = "aiStoicaPermissionsV1";
export const MODEL_CACHE_KEY = "aiStoicaModelsV1";
export const MODEL_SELECTED_KEY = "aiStoicaSelectedModelV1";
export const MANUAL_MODEL_KEY = "aiStoicaManualModelV1";
export const RESPONSE_MODE_KEY = "ai-stoica-response-mode";
export const GITHUB_BACKUP_KEY = "ai-stoica-last-github-backup";
export const FIRST_RUN_KEY = "ai-stoica-first-run-done";
export const SIDEBAR_COLLAPSED_KEY = "aiStoicaSidebarCollapsedV1";
export const ACCOUNT_KEYS = [TOKEN_KEY,USER_KEY,PERMISSIONS_KEY,MODEL_CACHE_KEY,MODEL_SELECTED_KEY,MANUAL_MODEL_KEY,GITHUB_BACKUP_KEY,"aiStoicaSmartRouterDefaultV1","aiStoicaAutoRouterEnabledV1"];
export const OAUTH_REDIRECT_PATH = "/api/plugins/oauth/callback";

export const storage = {
  get(key,fallback=""){try{const v=localStorage.getItem(key);return v===null?fallback:v}catch{return fallback}},
  set(key,value){try{localStorage.setItem(key,value)}catch{}},
  remove(key){try{localStorage.removeItem(key)}catch{}},
  json(key,fallback=null){try{const v=JSON.parse(localStorage.getItem(key)||"null");return v===null?fallback:v}catch{return fallback}}
};

export function cleanGatewayUrl(url){
  const s=String(url||"").trim().replace(/\/+$/,"");
  return /^https?:\/\/[^\s/?#]+$/i.test(s)?s:"";
}
export let GATEWAY = IS_WEB ? DEFAULT_GATEWAY : (cleanGatewayUrl(storage.get(GATEWAY_KEY)) || DEFAULT_GATEWAY);
export function setGatewayUrl(url){
  GATEWAY=cleanGatewayUrl(url)||DEFAULT_GATEWAY;
  storage.set(GATEWAY_KEY,GATEWAY);
}
export function toast(message,kind="error"){
  const text=String(message||"").trim();if(!text)return;
  try{if(typeof window.aiStoicaToast==="function"){window.aiStoicaToast(text,kind);return;}}catch{}
  alert(text);
}

let authLostHandler = null;
export function isAuthLost(status,message){
  return status===401||(status===403&&/Contul nu este activ|așteaptă aprobarea|asteapta aprobarea/i.test(String(message||"")));
}
export function httpMessage(status){
  if(status===413)return "Fișierul sau mesajul este prea mare pentru serviciul AI Stoica (HTTP 413).";
  if(status===404)return "Serviciul AI Stoica nu a găsit resursa cerută (HTTP 404).";
  if(status>=500)return `Serviciul AI Stoica a întâmpinat o eroare (HTTP ${status}).`;
  return `Cererea nu a reușit (HTTP ${status}).`;
}
export function errorFromBody(text,status){
  let data=null;try{data=text?JSON.parse(text):null}catch{}
  const e=data&&typeof data==="object"?data.error:null;
  if(typeof e==="string"&&e.trim())return e.trim();
  if(e&&typeof e==="object")return String(e.message||JSON.stringify(e)).slice(0,600);
  return httpMessage(status);
}
export function apiError(status,text,path=""){
  const message=errorFromBody(text,status);
  const err=new Error(message);err.status=status;
  if(isAuthLost(status,message)&&!/^\/auth\/(login|register|logout)/.test(path)&&storage.get(TOKEN_KEY)&&authLostHandler)authLostHandler(message);
  return err;
}
export function authHeaders(extra={}){const token=storage.get(TOKEN_KEY);return {...(token?{Authorization:`Bearer ${token}`}:{}),...extra};}
export async function api(path, options = {}) {
  const r = await fetch(`${GATEWAY}${path}`, {...options,headers:authHeaders({"Content-Type":"application/json",...(options.headers||{})})});
  const text = await r.text();
  if (!r.ok) throw apiError(r.status,text,path);
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new Error(`Răspuns invalid de la serviciul AI Stoica (HTTP ${r.status}).`); }
}
export async function authedFetch(path,init={}){
  const r=await fetch(`${GATEWAY}${path}`,{...init,headers:authHeaders(init.headers||{})});
  if(!r.ok){const text=await r.text().catch(()=>"");throw apiError(r.status,text,path);}
  return r;
}

export const PERMISSION_LABELS = {image_generation:"Generare imagini",video_generation:"Generare video",document_generation:"Fișiere descărcabile",file_upload:"Încărcare fișiere",web_search:"Căutare web",deep_research:"Deep Research",automations:"Scheduled",plugins:"Pluginuri",github_access:"GitHub"};
export function deniedMessage(key){return `Funcția „${PERMISSION_LABELS[key]||key}” este dezactivată de Owner pentru contul tău.`;}
export const AccessContext = React.createContext({can:()=>true,deny:()=>{},isOwner:false});
export function useAccess(){return useContext(AccessContext);}

export async function uploadFileToLibrary(file) {
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
export function formatBytes(n){
  const v=Number(n||0);if(v<1024)return `${v} B`;
  if(v<1024**2)return `${(v/1024).toFixed(v<10240?1:0)} KB`;
  if(v<1024**3)return `${(v/1024**2).toFixed(v<10*1024**2?1:0)} MB`;
  return `${(v/1024**3).toFixed(2)} GB`;
}
export function plural(n,one,many){
  const v=Math.abs(Number(n)||0),de=v>=20&&(v%100===0||v%100>=20);
  return `${v} ${v===1?one:(de?"de ":"")+many}`;
}
export function cx(...v) { return v.filter(Boolean).join(" "); }
export function uid() { return `${Date.now().toString(36)}${Math.random().toString(36).slice(2,8)}`; }
export async function writeClipboardText(value) {
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
export function openLink(href){
  const url=String(href||"").trim();
  if(!/^(https?:|mailto:)/i.test(url)){toast("Acest link nu poate fi deschis din AI Stoica.");return;}
  if(!window.AIStoica?.openExternal){window.open(url,"_blank","noopener,noreferrer");return;}
  Promise.resolve(window.AIStoica.openExternal(url)).then(r=>{if(r&&r.ok===false)toast(r.error||"Nu am putut deschide linkul în browser.")}).catch(e=>toast("Nu am putut deschide linkul: "+e.message));
}

export async function saveBlobDownload(blob,name) {
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;a.download=name||"AI-Stoica-fisier";
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),4000);
}
export async function downloadGeneratedFile(file) {
  if(!file?.id)throw new Error("Fișierul nu mai este disponibil.");
  const r=await authedFetch(`/api/files/${file.id}`);
  await saveBlobDownload(await r.blob(),file.name||"AI-Stoica-fisier");
}
export async function downloadLibraryFile(file) {
  const id=file?.libraryId||file?.id;
  if(!id)throw new Error("Fișierul nu mai este disponibil.");
  const r=await authedFetch(`/api/library/${id}/content`);
  await saveBlobDownload(await r.blob(),file.name||"AI-Stoica-fisier");
}
export function fmtTime(ts) {
  if (!ts) return "—";
  try { return new Date(ts).toLocaleString("ro-RO"); } catch { return "—"; }
}
export function mediaKind(mime,name="") {
  const m=String(mime||"").toLowerCase(),n=String(name||"").toLowerCase();
  if(m.startsWith("audio/")||/\.(mp3|m4a|aac|wav|ogg|oga|flac|opus|weba)$/i.test(n))return "audio";
  if(m.startsWith("video/")||/\.(mp4|mov|m4v|webm|avi|mkv|mpeg|mpg)$/i.test(n))return "video";
  if(m.startsWith("image/")||/\.(png|jpe?g|webp|gif|heic|heif|bmp)$/i.test(n))return "image";
  if(m.startsWith("text/")||/\.(txt|md|csv|json|js|ts|py|html|css|xml|yaml|yml)$/i.test(n))return "text";
  return "file";
}
export const KIND_LABELS={image:"Imagine",audio:"Audio",video:"Video",text:"Text",document:"Document",file:"Fișier",stored:"Fișier"};
export function kindLabel(kind,mime="",name=""){
  if((kind==="file"||kind==="document")&&(/pdf|word|officedocument|presentation|spreadsheet|msword|excel/i.test(String(mime))||/\.(pdf|docx?|pptx?|xlsx?)$/i.test(String(name))))return "Document";
  return KIND_LABELS[kind]||"Fișier";
}
export async function fetchLibraryBlob(id) {
  const r=await authedFetch(`/api/library/${id}/content`);
  return await r.blob();
}
export const modalStack=[];
export const FOCUSABLE='a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
export function useModal(onClose){
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
export function useDismiss(open,onClose,ref){
  const closeRef=useRef(onClose);closeRef.current=onClose;
  useEffect(()=>{
    if(!open)return;
    const down=e=>{if(ref.current&&!ref.current.contains(e.target))closeRef.current?.()};
    const key=e=>{if(e.key==="Escape")closeRef.current?.()};
    document.addEventListener("mousedown",down);window.addEventListener("keydown",key);
    return()=>{document.removeEventListener("mousedown",down);window.removeEventListener("keydown",key)};
  },[open]);
}
export function ToolShell({title,subtitle,label,onClose,children,className="",actions=null}) {
  const {ref,backdropProps}=useModal(onClose);
  return <div className="modalBackdrop" {...backdropProps}><div className={cx("toolModal",className)} ref={ref} role="dialog" aria-modal="true" aria-label={title||label||"Panou"} tabIndex={-1}><div className="toolHead"><div><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div>{actions&&<div className="toolHeadActions">{actions}</div>}<button className="iconOnly" onClick={onClose} aria-label="Închide" title="Închide"><X size={20}/></button></div>{children}</div></div>;
}
export function Modal({title,subtitle,onClose,className="modal",children}) {
  const {ref,backdropProps}=useModal(onClose);
  return <div className="modalBackdrop" {...backdropProps}><div className={className} ref={ref} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
    <div className="modalHead"><div><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div><button className="iconOnly" onClick={onClose} aria-label="Închide" title="Închide"><X size={20}/></button></div>
    {children}
  </div></div>;
}

export function CodeBlock({children,...props}) {
  const ref=useRef(null),timer=useRef(null),[copied,setCopied]=useState(false);
  useEffect(()=>()=>clearTimeout(timer.current),[]);
  async function copy(){
    const ok=await writeClipboardText(ref.current?.innerText||"");
    if(!ok){toast("Nu am putut copia codul în clipboard.");return;}
    setCopied(true);clearTimeout(timer.current);timer.current=setTimeout(()=>setCopied(false),1400);
  }
  return <div className="codeBlock"><button type="button" className="codeCopy" onClick={copy} aria-label="Copiază codul">{copied?<Check size={13}/>:<Copy size={13}/>}<span>{copied?"Copiat":"Copiază"}</span></button><pre ref={ref} {...props}>{children}</pre></div>;
}
export const REMARK_PLUGINS=[remarkGfm];
export const MD_COMPONENTS={
  a({node,href,children,...props}){return <a {...props} href={href} title={href} rel="noreferrer noopener" onClick={e=>{e.preventDefault();if(!String(href||"").startsWith("#"))openLink(href)}}>{children}</a>;},
  table({node,...props}){return <div className="tableWrap"><table {...props}/></div>;},
  pre({node,children,...props}){return <CodeBlock {...props}>{children}</CodeBlock>;}
};
export function Markdown({text}){return <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MD_COMPONENTS}>{String(text||"")}</ReactMarkdown>;}
export function useAuthedBlobUrl(path){
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
export function isHttpUrl(value){try{const u=new URL(String(value||"").trim());return u.protocol==="https:"||u.protocol==="http:"}catch{return false}}
export function setAuthLostHandler(fn){authLostHandler=fn;}
export function Switch({checked,onChange,label,disabled=false,className=""}){
  return <button type="button" className={cx("claudeToggle",checked&&"on",className)} role="switch" aria-checked={!!checked} aria-label={label} title={label} disabled={disabled} onClick={()=>onChange?.(!checked)}><span/></button>;
}
const RO_MONTHS=["ian.","feb.","mar.","apr.","mai","iun.","iul.","aug.","sept.","oct.","nov.","dec."];
export function clockTime(ts){const d=new Date(ts);return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;}
export function shortDate(ts,withYear=null){
  const d=new Date(ts);if(!Number.isFinite(d.getTime()))return "—";
  const year=withYear===null?d.getFullYear()!==new Date().getFullYear():withYear;
  return `${d.getDate()} ${RO_MONTHS[d.getMonth()]}${year?" "+d.getFullYear():""}`;
}
export function relativeDay(ts){
  if(!ts)return "—";
  const d=new Date(ts);if(!Number.isFinite(d.getTime()))return "—";
  const today=new Date();today.setHours(0,0,0,0);
  const day=new Date(d);day.setHours(0,0,0,0);
  const diff=Math.round((day-today)/86400000);
  const label=diff===0?"azi":diff===1?"mâine":diff===-1?"ieri":shortDate(ts);
  return `${label}, ${clockTime(ts)}`;
}
export function useInView(rootMargin="200px"){
  const ref=useRef(null),[seen,setSeen]=useState(false);
  useEffect(()=>{
    if(seen||!ref.current)return;
    if(typeof IntersectionObserver==="undefined"){setSeen(true);return;}
    const io=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setSeen(true);io.disconnect();}},{rootMargin});
    io.observe(ref.current);
    return()=>io.disconnect();
  },[seen,rootMargin]);
  return [ref,seen];
}
