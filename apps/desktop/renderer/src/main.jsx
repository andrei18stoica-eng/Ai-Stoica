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
  PanelTopOpen
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
async function fileToLibraryPayload(file) {
  const textLike = file.type.startsWith("text/") || /\.(txt|md|csv|json|js|ts|py|html|css|xml|yaml|yml)$/i.test(file.name);
  if (textLike) return { name:file.name, mime:file.type, size:file.size, kind:"text", text:(await file.text()).slice(0,150000) };
  const dataUrl = await readDataUrl(file);
  return { name:file.name, mime:file.type, size:file.size, kind:file.type.startsWith("image/")?"image":"file", dataUrl };
}
async function libraryItemToAttachment(item) {
  const d=(await api(`/api/library/${item.id}`)).data;
  if(d.kind==="image"&&Number(d.size||0)<=20*1024*1024){
    const token=localStorage.getItem(TOKEN_KEY)||"";
    const r=await fetch(`${GATEWAY}/api/library/${d.id}/content`,{headers:token?{Authorization:`Bearer ${token}`}:{}});
    if(r.ok){const blob=await r.blob(),dataUrl=await readDataUrl(blob);return {name:d.name,type:"image",libraryId:d.id,part:{type:"image_url",image_url:{url:dataUrl}}};}
  }
  if(d.kind==="text"&&Number(d.size||0)<=10*1024*1024){
    const token=localStorage.getItem(TOKEN_KEY)||"";
    const r=await fetch(`${GATEWAY}/api/library/${d.id}/content`,{headers:token?{Authorization:`Bearer ${token}`}:{}});
    if(r.ok){const text=(await r.text()).slice(0,250000);return {name:d.name,type:"text",libraryId:d.id,part:{type:"text",text:`Conținutul fișierului ${d.name}:\n${text}`}};}
  }
  return {name:d.name,type:"stored",libraryId:d.id,part:{type:"text",text:`Fișier atașat: ${d.name} (${formatBytes(d.size)}). Fișierul este stocat în Biblioteca AI Stoica; conținutul integral nu este introdus automat în context dacă depășește limita modelului.`}};
}

function AuthScreen({ onAuth }) {
  const [mode,setMode]=useState("login"),[name,setName]=useState(""),[email,setEmail]=useState(""),[password,setPassword]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const data = await api(mode==="login"?"/auth/login":"/auth/register",{method:"POST",body:JSON.stringify({name,email,password})});
      localStorage.setItem(TOKEN_KEY,data.token); localStorage.setItem(USER_KEY,JSON.stringify(data.user)); onAuth(data.user);
    } catch(e2){ setError(e2.message); } finally { setBusy(false); }
  }
  return <div className="authShell"><div className="authGlow"/>
    <div className="authBrand"><img src="./stoica-enterprises-ai.png" alt="Stoica Enterprises AI"/><h1>AI Stoica</h1><p>Stoica Enterprises AI</p>
      <div className="authFeature"><Sparkles size={17}/> Chat AI profesional, memorie, fișiere și automatizări.</div>
      <div className="authFeature"><Wifi size={17}/> Conectare prin OmniRoute.</div>
      <div className="authFeature"><User size={17}/> Cont personal cu email.</div>
    </div>
    <form className="authCard" onSubmit={submit}>
      <div className="authTabs"><button type="button" className={mode==="login"?"active":""} onClick={()=>setMode("login")}>Autentificare</button><button type="button" className={mode==="register"?"active":""} onClick={()=>setMode("register")}>Creează cont</button></div>
      <h2>{mode==="login"?"Bine ai revenit":"Creează contul AI Stoica"}</h2>
      <p className="muted">Folosește emailul tău pentru contul AI Stoica.</p>
      {mode==="register"&&<label>Nume<input value={name} onChange={e=>setName(e.target.value)} placeholder="Numele tău"/></label>}
      <label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="nume@email.ro" required/></label>
      <label>Parolă<input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Minimum 8 caractere" required minLength={8}/></label>
      {error&&<div className="authError">{error}</div>}
      <button className="primaryWide" disabled={busy}>{busy?"Se conectează…":mode==="login"?"Intră în AI Stoica":"Creează cont"}</button>
      <div className="localNote">Datele sunt păstrate local pe acest PC până când publicăm Gateway-ul online.</div>
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

function Header({onMenu,model,setModel,models,omni,onShare,current,projects,onDetach,onMoveProject,onFiles,onArchive,onDelete}) {
  const [more,setMore]=useState(false),[moveOpen,setMoveOpen]=useState(false);
  return <header className="topbar">
    <button className="iconOnly menuBtn" onClick={onMenu}><Menu size={20}/></button>
    <div className="modelWrap"><select value={model} onChange={e=>setModel(e.target.value)}>{models.map(m=><option key={m} value={m}>{m}</option>)}</select><ChevronDown size={15}/></div>
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
  return <div className="messageActions"><CopyMessageButton message={message}/><button className={message.rating===1?"selected":""} onClick={()=>onRate(1)}><ThumbsUp size={15}/></button><button className={message.rating===-1?"selected":""} onClick={()=>onRate(-1)}><ThumbsDown size={15}/></button><button onClick={onRegenerate}><RotateCcw size={15}/></button></div>;
}

function ConversationView({conversation,busy,onRegenerate,onRate}) {
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
      ?<div key={m.id||i} className="userRow"><div className="userMessageWrap"><div className="userBubble copyByRightClick" onContextMenu={e=>openCopyMenu(e,m)}><div>{messageText(m)}</div>{m.attachments?.length>0&&<div className="inlineAttachments">{m.attachments.map((a,j)=><span key={j}><Paperclip size={12}/>{a.name}</span>)}</div>}</div><div className="userMessageActions"><CopyMessageButton message={m}/></div></div></div>
      :m.role==="assistant"
        ?<div key={m.id||i} className="assistantBlock"><div className="assistantMark">S</div><div className="assistantBody copyByRightClick" onContextMenu={e=>openCopyMenu(e,m)}><ReactMarkdown remarkPlugins={[remarkGfm]}>{String(m.content||"")}</ReactMarkdown>{!m.streaming&&<MessageActions message={m} onRegenerate={()=>onRegenerate(i)} onRate={v=>onRate(i,v)}/>}</div></div>
        :null)}
    {busy&&<div className="thinking"><span/><span/><span/></div>}
    {contextMenu&&<div className="copyContextMenu" style={{left:contextMenu.x,top:contextMenu.y}} onClick={e=>e.stopPropagation()}>
      {contextMenu.codeText&&<button onClick={()=>copyValue(contextMenu.codeText)}><Copy size={15}/><span><b>Copiază codul</b><small>Doar blocul de cod selectat</small></span></button>}
      {contextMenu.selection&&<button onClick={()=>copyValue(contextMenu.selection)}><Copy size={15}/><span><b>Copiază selecția</b><small>Textul pe care l-ai selectat</small></span></button>}
      <button onClick={()=>copyValue(contextMenu.messageText)}><Copy size={15}/><span><b>Copiază mesajul</b><small>Mesajul complet</small></span></button>
    </div>}
  </div>;
}

function Composer({centered,draft,setDraft,onSend,busy,attachments,setAttachments,onOpenLibrary}) {
  const ta=useRef(null),fileInput=useRef(null),recorderRef=useRef(null),streamRef=useRef(null),chunksRef=useRef([]);
  const [menu,setMenu]=useState(false),[recording,setRecording]=useState(false),[transcribing,setTranscribing]=useState(false),[uploading,setUploading]=useState(false),[mentions,setMentions]=useState([]);
  useEffect(()=>{if(ta.current){ta.current.style.height="0px";ta.current.style.height=Math.min(ta.current.scrollHeight,190)+"px"}},[draft]);
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
          const blob=new Blob(chunksRef.current,{type:rec.mimeType||"audio/webm"});const audio=await readDataUrl(blob);
          const d=await api("/api/transcribe",{method:"POST",body:JSON.stringify({audio,mime:blob.type,language:"ro"})});
          if(d.text)setDraft(v=>(v?v+" ":"")+d.text);
        }catch(e){
          try{await fallbackSpeech()}catch{alert("Microfonul nu a putut fi folosit. Verifică permisiunea de microfon în Windows și setările de voce din AI Stoica.")}
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
      {attachments.length>0&&<div className="attachmentTray">{attachments.map((a,i)=><span className={a.type==="unsupported"||a.type==="stored"?"unsupported":""} key={i}><Paperclip size={13}/>{a.name}<button onClick={()=>setAttachments(attachments.filter((_,j)=>j!==i))}><X size={13}/></button></span>)}</div>}
      <div className="composerLine"><input ref={fileInput} type="file" hidden multiple onChange={filesChosen}/><div className="attachWrap"><button className="composerIcon" onClick={()=>setMenu(!menu)} title="Fișiere și bibliotecă"><Plus size={21}/></button>{menu&&<div className="attachMenu"><button onClick={()=>fileInput.current?.click()}><Upload size={16}/> Încarcă de pe PC</button><button onClick={()=>{setMenu(false);onOpenLibrary()}}><Library size={16}/> Alege din Bibliotecă</button></div>}</div><textarea ref={ta} value={draft} onChange={e=>setDraft(e.target.value)} onPaste={pasteIntoComposer} spellCheck={true} aria-label="Mesaj pentru AI Stoica" placeholder={uploading?"Încarc fișierul…":recording?"Ascult… apasă microfonul pentru oprire":transcribing?"Transcriu vocea…":"Mesaj pentru AI Stoica"} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey&&!mentionOptions.length){e.preventDefault();onSend()}}}/><button className={cx("composerIcon",recording&&"recording")} onClick={mic} title={recording?"Oprește înregistrarea":"Dictare vocală"} disabled={transcribing}><Mic size={20}/></button><button className="sendButton" disabled={busy||recording||transcribing||uploading||(!draft.trim()&&!attachments.some(a=>a.part))} onClick={onSend}><ArrowUp size={20}/></button></div>
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
    <div className="libraryGrid">{items.length===0?<div className="emptyState"><HardDrive size={30}/>Biblioteca este goală.</div>:items.map(x=><div className="libraryCard" key={x.id}><div className="fileIcon">{x.kind==="image"?<ImageIcon size={22}/>:<FileText size={22}/>}</div><div className="fileMeta"><b>{x.name}</b><span>{formatBytes(x.size)} · {fmtTime(x.createdAt)}</span></div><button className="smallBtn" onClick={()=>attach(x)}>Folosește</button><button className="iconDanger" onClick={()=>remove(x.id)}><Trash2 size={16}/></button></div>)}</div>
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
  const blank={name:"",description:"",url:"",method:"POST",trigger:"",apiKey:"",auto:false};
  const catalog=[
    {name:"Gmail",description:"Caută, citește și lucrează cu emailurile tale Google.",trigger:"@gmail",group:"Google",mark:"G"},
    {name:"Google Calendar",description:"Vezi programul și lucrează cu evenimentele din calendar.",trigger:"@calendar",group:"Google",mark:"31"},
    {name:"Google Drive",description:"Folosește documente și fișiere din Google Drive.",trigger:"@drive",group:"Google",mark:"△"},
    {name:"GitHub",description:"Lucrează cu repository-uri, cod, issues și pull request-uri.",trigger:"@github",group:"Dezvoltare",mark:"GH"},
    {name:"Outlook",description:"Conectează emailul Microsoft Outlook.",trigger:"@outlook",group:"Microsoft",mark:"O"},
    {name:"OneDrive",description:"Accesează fișierele tale Microsoft OneDrive.",trigger:"@onedrive",group:"Microsoft",mark:"☁"},
    {name:"SharePoint",description:"Lucrează cu documente și site-uri SharePoint.",trigger:"@sharepoint",group:"Microsoft",mark:"S"},
    {name:"Microsoft Teams",description:"Mesaje, conversații și colaborare în Teams.",trigger:"@teams",group:"Microsoft",mark:"T"},
    {name:"Slack",description:"Folosește mesaje și canale din Slack.",trigger:"@slack",group:"Productivitate",mark:"S"},
    {name:"Dropbox",description:"Folosește fișiere și foldere din Dropbox.",trigger:"@dropbox",group:"Fișiere",mark:"D"},
    {name:"Box",description:"Accesează conținutul stocat în Box.",trigger:"@box",group:"Fișiere",mark:"B"},
    {name:"Notion",description:"Lucrează cu pagini și baze de date Notion.",trigger:"@notion",group:"Productivitate",mark:"N"},
    {name:"Trello",description:"Board-uri, liste și carduri Trello.",trigger:"@trello",group:"Productivitate",mark:"T"},
    {name:"Jira",description:"Issues, proiecte și fluxuri Jira.",trigger:"@jira",group:"Dezvoltare",mark:"J"},
    {name:"Asana",description:"Task-uri și proiecte Asana.",trigger:"@asana",group:"Productivitate",mark:"A"},
    {name:"Linear",description:"Issues și proiecte pentru echipe software.",trigger:"@linear",group:"Dezvoltare",mark:"L"},
    {name:"Zoom",description:"Întâlniri și informații din Zoom.",trigger:"@zoom",group:"Comunicare",mark:"Z"},
    {name:"HubSpot",description:"Date și activități din CRM-ul HubSpot.",trigger:"@hubspot",group:"Business",mark:"H"},
    {name:"Salesforce",description:"Lucrează cu date din Salesforce CRM.",trigger:"@salesforce",group:"Business",mark:"SF"},
    {name:"Discord",description:"Mesaje și comunități Discord.",trigger:"@discord",group:"Comunicare",mark:"D"}
  ];
  const [items,setItems]=useState([]),[form,setForm]=useState(blank),[result,setResult]=useState(""),[tab,setTab]=useState("discover"),[query,setQuery]=useState(""),[selected,setSelected]=useState(null);
  async function load(){setItems((await api("/api/plugins")).data||[])}
  useEffect(()=>{load()},[]);
  async function add(){
    if(!form.name.trim()||!form.url.trim())return;
    await api("/api/plugins",{method:"POST",body:JSON.stringify(form)});
    setForm(blank);setSelected(null);setTab("connected");await load()
  }
  async function patch(x,p){await api(`/api/plugins/${x.id}`,{method:"PATCH",body:JSON.stringify(p)});await load()}
  async function test(x){try{const d=await api(`/api/plugins/${x.id}/test`,{method:"POST",body:JSON.stringify({message:"Test conexiune AI Stoica"})});setResult(`${x.name}: ${d.result}`)}catch(e){setResult(`${x.name}: Eroare — ${e.message}`)}}
  async function remove(id){if(confirm("Ștergi această conexiune?")){await api(`/api/plugins/${id}`,{method:"DELETE"});await load()}}
  function chooseCatalog(x){setSelected(x);setForm({...blank,name:x.name,description:x.description,trigger:x.trigger})}
  function closeSetup(){setSelected(null);setForm(blank)}
  const normalized=query.trim().toLowerCase();
  const filtered=catalog.filter(x=>!normalized||x.name.toLowerCase().includes(normalized)||x.description.toLowerCase().includes(normalized)||x.group.toLowerCase().includes(normalized));
  const installedNames=new Set(items.map(x=>String(x.name||"").toLowerCase()));
  return <ToolShell title="Pluginuri" subtitle="Conectează serviciile pe care AI Stoica le poate folosi în conversații." onClose={onClose}>
    <div className="claudePlugins">
      <div className="claudePluginTabs">
        <button className={tab==="discover"?"active":""} onClick={()=>setTab("discover")}>Descoperă</button>
        <button className={tab==="connected"?"active":""} onClick={()=>setTab("connected")}>Conectate <span>{items.length}</span></button>
      </div>

      {tab==="discover"&&<>
        <div className="claudePluginSearch"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Caută integrări"/></div>
        <div className="claudePluginIntro">
          <div><h3>Conectează aplicațiile tale</h3><p>Adaugă servicii pe care AI Stoica le poate folosi atunci când îi ceri explicit sau printr-un trigger @.</p></div>
          <button className="secondary claudeCustomBtn" onClick={()=>chooseCatalog({name:"Plugin personalizat",description:"Conectează orice endpoint HTTP sau webhook.",trigger:"@plugin",group:"Personalizat",mark:"+"})}><Plus size={16}/> Adaugă personalizat</button>
        </div>
        <div className="claudePluginDirectory">
          {filtered.map(x=>{
            const connected=installedNames.has(x.name.toLowerCase());
            return <button className="claudePluginRow" key={x.name} onClick={()=>chooseCatalog(x)}>
              <span className="claudePluginLogo">{x.mark}</span>
              <span className="claudePluginCopy"><b>{x.name}</b><small>{x.description}</small></span>
              <span className="claudePluginGroup">{x.group}</span>
              <span className={cx("claudeConnectPill",connected&&"connected")}>{connected?<><Check size={14}/> Conectat</>:"Configurează"}</span>
            </button>
          })}
          {!filtered.length&&<div className="claudePluginEmpty">Nu am găsit nicio integrare pentru „{query}”.</div>}
        </div>
      </>}

      {tab==="connected"&&<>
        <div className="claudeConnectedHead"><div><h3>Conexiunile tale</h3><p>Controlează ce servicii poate folosi AI Stoica.</p></div><button className="secondary" onClick={()=>setTab("discover")}><Plus size={16}/> Adaugă conexiune</button></div>
        {result&&<div className="pluginResult claudeResult">{result}</div>}
        <div className="claudeConnectedList">
          {!items.length&&<div className="claudePluginEmpty">Nu ai încă nicio conexiune configurată.</div>}
          {items.map(x=><div className="claudeConnectedRow" key={x.id}>
            <div className="claudePluginLogo">{String(x.name||"P").slice(0,2).toUpperCase()}</div>
            <div className="claudeConnectedInfo"><b>{x.name}</b><span>{x.description||x.url}</span><small>{x.trigger||"Fără trigger"} {x.hasKey?"· autentificare salvată":""}</small></div>
            <div className="claudeConnectedActions">
              <button className="smallBtn" onClick={()=>test(x)}>Testează</button>
              <button className={cx("claudeToggle",x.enabled&&"on")} onClick={()=>patch(x,{enabled:!x.enabled})} aria-label={x.enabled?"Dezactivează":"Activează"}><span/></button>
              <button className="iconDanger" onClick={()=>remove(x.id)} title="Șterge"><Trash2 size={16}/></button>
            </div>
          </div>)}
        </div>
      </>}

      {selected&&<div className="claudeSetupBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget)closeSetup()}}>
        <div className="claudeSetupPanel">
          <div className="claudeSetupHead">
            <div className="claudePluginLogo large">{selected.mark}</div>
            <div><h3>{selected.name}</h3><p>{selected.description}</p></div>
            <button className="iconOnly" onClick={closeSetup}><X size={18}/></button>
          </div>
          <div className="claudeSetupNotice"><Plug size={16}/><span>Configurează conexiunea. Serviciile cu autentificare proprie necesită endpoint/OAuth sau API autorizat; AI Stoica nu primește acces fără autorizarea ta.</span></div>
          <div className="claudeSetupForm">
            <label>Nume<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
            <label>Endpoint sau webhook<input placeholder="https://…" value={form.url} onChange={e=>setForm({...form,url:e.target.value})}/></label>
            <div className="claudeFormRow"><label>Trigger<input placeholder="@gmail" value={form.trigger} onChange={e=>setForm({...form,trigger:e.target.value})}/></label><label>Metodă<select value={form.method} onChange={e=>setForm({...form,method:e.target.value})}><option>POST</option><option>GET</option></select></label></div>
            <label>API key <span className="optional">opțional</span><input type="password" placeholder="Cheie / token" value={form.apiKey} onChange={e=>setForm({...form,apiKey:e.target.value})}/></label>
            <label className="claudeAutoRow"><span><b>Folosește automat</b><small>Permite pluginului să fie inclus automat în contextul mesajelor.</small></span><input type="checkbox" checked={form.auto} onChange={e=>setForm({...form,auto:e.target.checked})}/></label>
          </div>
          <div className="claudeSetupActions"><button className="secondary" onClick={closeSetup}>Anulează</button><button className="primary" disabled={!form.name.trim()||!form.url.trim()} onClick={add}>Salvează conexiunea</button></div>
        </div>
      </div>}
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
      {tab==="ai"&&<><h3>AI & OmniRoute</h3><label>Gateway AI Stoica<input value={cfg.gatewayUrl||"http://127.0.0.1:8787"} onChange={e=>setCfg({...cfg,gatewayUrl:e.target.value})} placeholder="https://ai.exemplu.ro"/></label><label>Base URL OmniRoute<input value={cfg.baseUrl} onChange={e=>setCfg({...cfg,baseUrl:e.target.value})}/></label><label>Cheie API<input type="password" value={key} onChange={e=>setKey(e.target.value)} placeholder={cfg.apiKey?"Cheie salvată — lasă gol pentru a o păstra":"Cheie OmniRoute"}/></label><label>Model / combo implicit<input value={cfg.model} onChange={e=>setCfg({...cfg,model:e.target.value})}/></label><label>Comandă OmniRoute<input value={cfg.omniCommand||"omniroute.cmd"} onChange={e=>setCfg({...cfg,omniCommand:e.target.value})}/></label><div className="toggleRow"><div><b>Pornește OmniRoute automat</b><span>Dacă serviciul cade, AI Stoica încearcă să îl repornească.</span></div><input type="checkbox" checked={!!cfg.autoStartOmniRoute} onChange={e=>setCfg({...cfg,autoStartOmniRoute:e.target.checked})}/></div><div className="statusGrid"><div><span>Gateway local</span><b>{status?.gatewayRunning?"Conectat":"Indisponibil"}</b></div><div><span>OmniRoute</span><b>{status?.omniRunning?"Conectat":"Indisponibil"}</b></div></div></>}
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
  const [boot,setBoot]=useState(true),[conversations,setConversations]=useState([]),[projects,setProjects]=useState([]),[assistants,setAssistants]=useState([]),[models,setModels]=useState(["Ai principal"]);
  const [currentId,setCurrentId]=useState(null),[model,setModel]=useState("Ai principal"),[selectedProject,setSelectedProject]=useState(null),[selectedAssistant,setSelectedAssistant]=useState(null);
  const [draft,setDraft]=useState(""),[attachments,setAttachments]=useState([]),[busy,setBusy]=useState(false),[search,setSearch]=useState(""),[sidebar,setSidebar]=useState(false),[omni,setOmni]=useState(false);
  const [settings,setSettings]=useState(false),[createType,setCreateType]=useState(null),[toolPanel,setToolPanel]=useState(null),[filesPanel,setFilesPanel]=useState(false),[updateReady,setUpdateReady]=useState(false),[sidebarCollapsed,setSidebarCollapsed]=useState(false);
  const chatRef=useRef(null);
  const current=conversations.find(c=>c.id===currentId)||null;

  async function loadData(){
    if(!localStorage.getItem(TOKEN_KEY)){setBoot(false);return}
    try{
      const [me,cs,ps,as,ms]=await Promise.all([api("/auth/me"),api("/api/conversations"),api("/api/projects"),api("/api/assistants"),api("/api/models").catch(()=>({data:[]}))]);
      if(me.token)localStorage.setItem(TOKEN_KEY,me.token);setUser(me.user);localStorage.setItem(USER_KEY,JSON.stringify(me.user));setConversations(cs.data||[]);setProjects(ps.data||[]);setAssistants(as.data||[]);
      const ids=(ms.data||[]).map(x=>x.id).filter(Boolean);if(ids.length){setModels(ids);setModel(ids.find(x=>/ai[ _-]*principal/i.test(x))||ids[0])}
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

  function logout(){localStorage.removeItem(TOKEN_KEY);localStorage.removeItem(USER_KEY);setUser(null);setConversations([]);setCurrentId(null)}
  function newConversation(){setCurrentId(null);setDraft("");setAttachments([]);setSidebar(false)}
  async function saveConversation(conv){if(conv.id){const d=await api(`/api/conversations/${conv.id}`,{method:"PUT",body:JSON.stringify(conv)});setConversations(v=>v.map(x=>x.id===conv.id?d.data:x));return d.data}const d=await api("/api/conversations",{method:"POST",body:JSON.stringify(conv)});setConversations(v=>[d.data,...v]);setCurrentId(d.data.id);return d.data}
  async function streamAssistant(baseConv,messages){
    setBusy(true);const assistantMessage={id:uid(),role:"assistant",content:"",createdAt:Date.now(),streaming:true};let working={...baseConv,messages:[...messages,assistantMessage],updatedAt:Date.now()};setConversations(v=>v.map(x=>x.id===working.id?working:x));
    try{
      if(!omni){await window.AIStoica.ensureOmni();await new Promise(r=>setTimeout(r,1200))}
      const token=localStorage.getItem(TOKEN_KEY)||"",r=await fetch(`${GATEWAY}/api/chat/stream`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({model,assistantId:working.assistantId,messages})});
      if(!r.ok){let e;try{e=await r.json()}catch{e={error:await r.text()}};throw new Error(e?.error||`HTTP ${r.status}`)}
      const reader=r.body.getReader(),dec=new TextDecoder();let buf="",answer="";
      while(true){const {value,done}=await reader.read();if(done)break;buf+=dec.decode(value,{stream:true});const events=buf.split("\n\n");buf=events.pop()||"";for(const ev of events)for(const line of ev.split("\n")){if(!line.startsWith("data:"))continue;const raw=line.slice(5).trim();if(!raw||raw==="[DONE]")continue;try{const j=JSON.parse(raw),delta=j?.choices?.[0]?.delta?.content||j?.choices?.[0]?.message?.content||"";if(delta){answer+=delta;working={...working,messages:[...messages,{...assistantMessage,content:answer,streaming:true}]};setConversations(v=>v.map(x=>x.id===working.id?working:x))}}catch{}}}
      working={...working,messages:[...messages,{...assistantMessage,content:answer||"Nu am primit răspuns.",streaming:false}],updatedAt:Date.now()};const saved=await saveConversation(working);
      const lastUser=[...messages].reverse().find(m=>m.role==="user");api("/api/memory/capture",{method:"POST",body:JSON.stringify({conversationId:saved.id,userText:messageText(lastUser),assistantText:answer})}).catch(()=>{});
    }catch(e){working={...working,messages:[...messages,{...assistantMessage,content:`Eroare: ${e.message}`,streaming:false}],updatedAt:Date.now()};await saveConversation(working)}finally{setBusy(false)}
  }
  async function send(){
    const text=draft.trim(),usable=attachments.filter(a=>a.part);if((!text&&!usable.length)||busy)return;
    const parts=[...(text?[{type:"text",text}]:[]),...usable.map(a=>a.part)],content=parts.length===1&&parts[0].type==="text"?parts[0].text:parts;
    const userMsg={id:uid(),role:"user",content,displayText:text||"Fișier atașat",attachments:attachments.map(a=>({name:a.name,type:a.type,libraryId:a.libraryId||null})),createdAt:Date.now()};
    let conv=current?{...current}:{title:titleFrom(text||attachments[0]?.name),projectId:selectedProject,assistantId:selectedAssistant,model,messages:[]};
    conv={...conv,title:conv.messages?.length?conv.title:titleFrom(text||attachments[0]?.name),projectId:conv.projectId??selectedProject,assistantId:conv.assistantId??selectedAssistant,model,messages:[...(conv.messages||[]),userMsg],updatedAt:Date.now()};
    setDraft("");setAttachments([]);const saved=await saveConversation(conv);await streamAssistant(saved,saved.messages);
  }
  async function regenerate(index){if(busy||!current)return;const msgs=current.messages.slice(0,index),saved=await saveConversation({...current,messages:msgs});await streamAssistant(saved,msgs)}
  async function rate(index,value){if(!current)return;const msgs=current.messages.map((m,i)=>i===index?{...m,rating:m.rating===value?0:value}:m);await saveConversation({...current,messages:msgs})}
  async function createItem(data){if(createType==="project"){const d=await api("/api/projects",{method:"POST",body:JSON.stringify(data)});setProjects(v=>[d.data,...v]);setSelectedProject(d.data.id)}else{const d=await api("/api/assistants",{method:"POST",body:JSON.stringify(data)});setAssistants(v=>[...v,d.data]);setSelectedAssistant(d.data.id)}setCreateType(null)}
  async function share(){if(!current)return;await navigator.clipboard.writeText(current.messages.map(m=>`${m.role==="user"?"Eu":"AI Stoica"}:\n${messageText(m)}`).join("\n\n"));alert("Conversația a fost copiată în clipboard.")}
  function openTool(name){setSidebar(false);setToolPanel(name)}
  function attachFromLibrary(a){setAttachments(v=>[...v,a])}
  async function moveCurrent(projectId){if(!current)return;const saved=await saveConversation({...current,projectId});setSelectedProject(projectId);return saved}
  async function archiveCurrent(){if(!current)return;await saveConversation({...current,archived:true});setCurrentId(null)}
  async function deleteConversation(id){const conv=conversations.find(x=>x.id===id);if(!conv)return;if(!confirm(`Ștergi definitiv conversația „${conv.title||"Conversație"}”?`))return;await api(`/api/conversations/${id}`,{method:"DELETE"});setConversations(v=>v.filter(x=>x.id!==id));if(currentId===id)setCurrentId(null)}
  async function deleteCurrent(){if(current)await deleteConversation(current.id)}
  function toggleMenu(){if(window.innerWidth<=900)setSidebar(v=>!v);else setSidebarCollapsed(v=>!v)}
  function useAssistant(id){setSelectedAssistant(id);setCurrentId(null);setDraft("");setToolPanel(null)}
  function startImagePrompt(imageModel){if(imageModel)setModel(imageModel);setCurrentId(null);setDraft("Creează o imagine cu ");setToolPanel(null)}

  if(boot)return <div className="loadingScreen"><BrandMark/><span>Se pornește AI Stoica…</span></div>;
  if(!user)return <AuthScreen onAuth={setUser}/>;
  const hasMessages=!!current?.messages?.length;
  return <div className={cx("appShell",sidebarCollapsed&&"sidebarCollapsed")}>
    <Sidebar open={sidebar} setOpen={setSidebar} user={user} search={search} setSearch={setSearch} projects={projects} assistants={assistants} conversations={conversations} currentId={currentId} onSelect={id=>{setCurrentId(id);setSidebar(false)}} onDeleteConversation={deleteConversation} onNew={newConversation} selectedProject={selectedProject} setSelectedProject={setSelectedProject} selectedAssistant={selectedAssistant} setSelectedAssistant={setSelectedAssistant} onNewProject={()=>setCreateType("project")} onNewAssistant={()=>setCreateType("assistant")} onTool={openTool} onExplore={()=>openTool("explore")} onSettings={()=>setSettings(true)} onLogout={logout}/>
    {sidebar&&<div className="mobileScrim" onClick={()=>setSidebar(false)}/>}
    <main className="mainArea"><Header onMenu={toggleMenu} model={model} setModel={setModel} models={models} omni={omni} onShare={share} current={current} projects={projects} onDetach={()=>moveCurrent(null)} onMoveProject={moveCurrent} onFiles={()=>setFilesPanel(true)} onArchive={archiveCurrent} onDelete={deleteCurrent}/>{updateReady&&<button className="updateBanner" onClick={()=>window.AIStoica.installUpdate()}>Actualizare AI Stoica disponibilă — instalează acum</button>}<div className="chatScroll" ref={chatRef}><ConversationView conversation={current} busy={busy} onRegenerate={regenerate} onRate={rate}/></div><Composer centered={!hasMessages} draft={draft} setDraft={setDraft} onSend={send} busy={busy} attachments={attachments} setAttachments={setAttachments} onOpenLibrary={()=>setToolPanel("library")}/></main>
    {settings&&<SettingsModal user={user} onClose={()=>setSettings(false)} onSaved={()=>{window.AIStoica.ensureOmni();setTimeout(loadData,1000)}}/>}
    {createType&&<CreateModal type={createType} onClose={()=>setCreateType(null)} onCreate={createItem}/>}
    {toolPanel==="explore"&&<ExplorePanel onClose={()=>setToolPanel(null)} assistants={assistants} models={models} onUseAssistant={useAssistant} onImagePrompt={startImagePrompt} onOpenLibrary={()=>setToolPanel("library")}/>} 
    {toolPanel==="library"&&<LibraryPanel onClose={()=>setToolPanel(null)} onAttach={attachFromLibrary}/>} 
    {toolPanel==="memory"&&<MemoryPanel onClose={()=>setToolPanel(null)}/>}
    {toolPanel==="plugins"&&<PluginsPanel onClose={()=>setToolPanel(null)}/>}
    {toolPanel==="automations"&&<AutomationsPanel onClose={()=>setToolPanel(null)} model={model}/>}
  </div>;
}
createRoot(document.getElementById("root")).render(<ErrorBoundary><App/></ErrorBoundary>);
