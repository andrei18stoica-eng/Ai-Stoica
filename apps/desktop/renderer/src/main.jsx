import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Menu, Plus, Search, Folder, Bot, Settings, LogOut, Share2, MoreHorizontal,
  Paperclip, Mic, ArrowUp, Copy, ThumbsUp, ThumbsDown, RotateCcw, X,
  ChevronDown, User, Check, Wifi, WifiOff, Sparkles, SquarePen,
  CalendarClock, Plug, Library, Brain, Upload, Trash2, Play, Pin, PinOff,
  FileText, Image as ImageIcon, HardDrive, ToggleLeft, ToggleRight
} from "lucide-react";
import "./styles.css";

const GATEWAY = "http://127.0.0.1:8787";
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
  const d = (await api(`/api/library/${item.id}`)).data;
  if (d.kind === "image" && d.dataUrl) return { name:d.name, type:"image", libraryId:d.id, part:{type:"image_url",image_url:{url:d.dataUrl}} };
  if (d.kind === "text" && d.text != null) return { name:d.name, type:"text", libraryId:d.id, part:{type:"text",text:`Conținutul fișierului ${d.name}:\n${d.text}`} };
  return { name:d.name, type:"stored", libraryId:d.id, part:null };
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

function Sidebar({open,setOpen,user,search,setSearch,projects,assistants,conversations,currentId,onSelect,onNew,selectedProject,setSelectedProject,selectedAssistant,setSelectedAssistant,onNewProject,onNewAssistant,onTool,onSettings,onLogout}) {
  const filtered=conversations.filter(c=>!search||(c.title||"").toLowerCase().includes(search.toLowerCase()));
  const groups=useMemo(()=>{const out={};filtered.forEach(c=>{const g=groupLabel(c.updatedAt);(out[g]||=[]).push(c)});return out},[filtered]);
  return <aside className={cx("sidebar",open&&"open")}>
    <div className="sideTop"><div className="brandLine"><BrandMark small/><div><b>AI Stoica</b><span>Enterprises AI</span></div></div><button className="iconOnly mobileClose" onClick={()=>setOpen(false)}><X size={20}/></button></div>
    <button className="newChat" onClick={onNew}><SquarePen size={17}/> Conversație nouă</button>
    <div className="searchBox"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Caută conversații"/></div>
    <div className="sideScroll">
      <div className="sideSection"><div className="sectionHead"><span>Instrumente</span></div>
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
        {Object.entries(groups).map(([g,items])=><div key={g} className="historyGroup"><div className="historyLabel">{g}</div>{items.filter(c=>!selectedProject||c.projectId===selectedProject).map(c=><button key={c.id} className={cx("historyItem",currentId===c.id&&"active")} onClick={()=>onSelect(c.id)} title={c.title}>{c.title||"Conversație"}</button>)}</div>)}
      </div>
    </div>
    <div className="accountArea"><div className="accountBadge"><div className="accountAvatar">{(user?.name||user?.email||"S")[0].toUpperCase()}</div><div className="accountText"><b>{user?.name||"Cont Stoica"}</b><span>{user?.email}</span></div></div><div className="accountButtons"><button onClick={onSettings}><Settings size={17}/> Setări</button><button onClick={onLogout}><LogOut size={17}/> Deconectare</button></div></div>
  </aside>;
}

function Header({onMenu,model,setModel,models,omni,onShare}) {
  return <header className="topbar"><button className="iconOnly menuBtn" onClick={onMenu}><Menu size={20}/></button><div className="modelWrap"><select value={model} onChange={e=>setModel(e.target.value)}>{models.map(m=><option key={m} value={m}>{m}</option>)}</select><ChevronDown size={15}/></div><div className="topSpacer"/><div className={cx("connection",omni?"ok":"bad")}>{omni?<Wifi size={15}/>:<WifiOff size={15}/>} {omni?"OmniRoute conectat":"OmniRoute se reconectează"}</div><button className="topAction" onClick={onShare}><Share2 size={16}/> Distribuie</button><button className="iconOnly"><MoreHorizontal size={20}/></button></header>;
}

function MessageActions({message,onRegenerate,onRate}) {
  const [copied,setCopied]=useState(false);
  async function copy(){await navigator.clipboard.writeText(messageText(message));setCopied(true);setTimeout(()=>setCopied(false),1200)}
  return <div className="messageActions"><button onClick={copy} title="Copiază">{copied?<Check size={15}/>:<Copy size={15}/>}</button><button className={message.rating===1?"selected":""} onClick={()=>onRate(1)}><ThumbsUp size={15}/></button><button className={message.rating===-1?"selected":""} onClick={()=>onRate(-1)}><ThumbsDown size={15}/></button><button onClick={onRegenerate}><RotateCcw size={15}/></button></div>;
}

function ConversationView({conversation,busy,onRegenerate,onRate}) {
  if(!conversation||!conversation.messages?.length)return <div className="welcome"><BrandMark/><h1>Cu ce lucrăm astăzi?</h1><p>Întreabă orice. AI Stoica poate folosi memoria, biblioteca, pluginurile și automatizările tale.</p></div>;
  return <div className="messagesColumn">{conversation.messages.map((m,i)=>m.role==="user"?<div key={m.id||i} className="userRow"><div className="userBubble"><div>{messageText(m)}</div>{m.attachments?.length>0&&<div className="inlineAttachments">{m.attachments.map((a,j)=><span key={j}><Paperclip size={12}/>{a.name}</span>)}</div>}</div></div>:m.role==="assistant"?<div key={m.id||i} className="assistantBlock"><div className="assistantMark">S</div><div className="assistantBody"><ReactMarkdown remarkPlugins={[remarkGfm]}>{String(m.content||"")}</ReactMarkdown>{!m.streaming&&<MessageActions message={m} onRegenerate={()=>onRegenerate(i)} onRate={v=>onRate(i,v)}/>}</div></div>:null)}{busy&&<div className="thinking"><span/><span/><span/></div>}</div>;
}

function Composer({centered,draft,setDraft,onSend,busy,attachments,setAttachments,onOpenLibrary}) {
  const ta=useRef(null),fileInput=useRef(null); const [menu,setMenu]=useState(false);
  useEffect(()=>{if(ta.current){ta.current.style.height="0px";ta.current.style.height=Math.min(ta.current.scrollHeight,190)+"px"}},[draft]);
  async function filesChosen(e){
    const files=[...e.target.files],next=[];
    for(const f of files.slice(0,5)){
      if(f.size>8*1024*1024)continue;
      if(f.type.startsWith("image/")){const dataUrl=await readDataUrl(f);next.push({name:f.name,type:"image",part:{type:"image_url",image_url:{url:dataUrl}}});}
      else if(f.type.startsWith("text/")||/\.(txt|md|csv|json|js|ts|py|html|css|xml|yaml|yml)$/i.test(f.name)){next.push({name:f.name,type:"text",part:{type:"text",text:`Conținutul fișierului ${f.name}:\n${(await f.text()).slice(0,100000)}`}});}
      else next.push({name:f.name,type:"unsupported",part:null});
    }
    setAttachments([...attachments,...next]);e.target.value="";setMenu(false);
  }
  function mic(){const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){alert("Dictarea vocală nu este disponibilă pe acest sistem.");return;}const r=new SR();r.lang="ro-RO";r.interimResults=false;r.onresult=e=>setDraft((draft?draft+" ":"")+e.results[0][0].transcript);r.start();}
  return <div className={cx("composerDock",centered&&"centered")}><div className="composerCard">
    {attachments.length>0&&<div className="attachmentTray">{attachments.map((a,i)=><span className={a.type==="unsupported"||a.type==="stored"?"unsupported":""} key={i}><Paperclip size={13}/>{a.name}<button onClick={()=>setAttachments(attachments.filter((_,j)=>j!==i))}><X size={13}/></button></span>)}</div>}
    <div className="composerLine"><input ref={fileInput} type="file" hidden multiple onChange={filesChosen}/><div className="attachWrap"><button className="composerIcon" onClick={()=>setMenu(!menu)} title="Fișiere și bibliotecă"><Plus size={21}/></button>{menu&&<div className="attachMenu"><button onClick={()=>fileInput.current?.click()}><Upload size={16}/> Încarcă de pe PC</button><button onClick={()=>{setMenu(false);onOpenLibrary()}}><Library size={16}/> Alege din Bibliotecă</button></div>}</div><textarea ref={ta} value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Întreabă orice" onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();onSend()}}}/><button className="composerIcon" onClick={mic} title="Dictare"><Mic size={20}/></button><button className="sendButton" disabled={busy||(!draft.trim()&&!attachments.some(a=>a.part))} onClick={onSend}><ArrowUp size={20}/></button></div>
  </div><div className="composerHint">AI Stoica poate greși. Verifică informațiile importante.</div></div>;
}

function ToolShell({title,subtitle,onClose,children}) {
  return <div className="modalBackdrop"><div className="toolModal"><div className="toolHead"><div><h2>{title}</h2><p>{subtitle}</p></div><button className="iconOnly" onClick={onClose}><X size={20}/></button></div>{children}</div></div>;
}

function LibraryPanel({onClose,onAttach}) {
  const [items,setItems]=useState([]),[busy,setBusy]=useState(false),input=useRef(null);
  async function load(){setItems((await api("/api/library")).data||[])}
  useEffect(()=>{load()},[]);
  async function upload(e){setBusy(true);try{for(const f of [...e.target.files]){if(f.size>8*1024*1024){alert(`${f.name}: maxim 8 MB`);continue;}await api("/api/library",{method:"POST",body:JSON.stringify(await fileToLibraryPayload(f))});}await load();}finally{setBusy(false);e.target.value=""}}
  async function remove(id){await api(`/api/library/${id}`,{method:"DELETE"});await load()}
  async function attach(item){const a=await libraryItemToAttachment(item);onAttach?.(a);if(a.part)onClose();else alert("Fișierul este salvat în bibliotecă, dar acest tip nu poate fi încă trimis direct modelului.");}
  return <ToolShell title="Bibliotecă" subtitle="Păstrează fișierele tale și refolosește-le în conversații." onClose={onClose}>
    <div className="toolActions"><button className="primary" onClick={()=>input.current?.click()}><Upload size={16}/> Adaugă fișiere</button><input ref={input} type="file" multiple hidden onChange={upload}/><span className="toolNote">Maxim 8 MB/fișier. Text și imagini pot fi atașate direct în chat.</span></div>
    <div className="libraryGrid">{items.length===0?<div className="emptyState"><HardDrive size={30}/>Biblioteca este goală.</div>:items.map(x=><div className="libraryCard" key={x.id}><div className="fileIcon">{x.kind==="image"?<ImageIcon size={22}/>:<FileText size={22}/>}</div><div className="fileMeta"><b>{x.name}</b><span>{Math.max(1,Math.round((x.size||0)/1024))} KB · {fmtTime(x.createdAt)}</span></div><button className="smallBtn" onClick={()=>attach(x)}>Folosește</button><button className="iconDanger" onClick={()=>remove(x.id)}><Trash2 size={16}/></button></div>)}</div>
    {busy&&<div className="toolStatus">Se încarcă…</div>}
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
  const [items,setItems]=useState([]),[form,setForm]=useState(blank),[result,setResult]=useState("");
  async function load(){setItems((await api("/api/plugins")).data||[])}
  useEffect(()=>{load()},[]);
  async function add(){if(!form.name.trim()||!form.url.trim())return;await api("/api/plugins",{method:"POST",body:JSON.stringify(form)});setForm(blank);await load()}
  async function patch(x,p){await api(`/api/plugins/${x.id}`,{method:"PATCH",body:JSON.stringify(p)});await load()}
  async function test(x){try{const d=await api(`/api/plugins/${x.id}/test`,{method:"POST",body:JSON.stringify({message:"Test conexiune AI Stoica"})});setResult(`${x.name}: ${d.result}`)}catch(e){setResult(`${x.name}: Eroare — ${e.message}`)}}
  async function remove(id){await api(`/api/plugins/${id}`,{method:"DELETE"});await load()}
  return <ToolShell title="Pluginuri" subtitle="Conectează servicii HTTP/Webhook. Le poți chema în chat cu triggerul pluginului, de exemplu @nume-plugin." onClose={onClose}>
    <div className="pluginForm"><input placeholder="Nume plugin" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/><input placeholder="URL endpoint (https://…)" value={form.url} onChange={e=>setForm({...form,url:e.target.value})}/><input placeholder="Trigger, ex. @calendar" value={form.trigger} onChange={e=>setForm({...form,trigger:e.target.value})}/><input type="password" placeholder="API key opțională" value={form.apiKey} onChange={e=>setForm({...form,apiKey:e.target.value})}/><select value={form.method} onChange={e=>setForm({...form,method:e.target.value})}><option>POST</option><option>GET</option></select><label className="checkLabel"><input type="checkbox" checked={form.auto} onChange={e=>setForm({...form,auto:e.target.checked})}/> Folosește automat la fiecare mesaj</label><button className="primary" onClick={add}><Plus size={16}/> Adaugă plugin</button></div>
    {result&&<div className="pluginResult">{result}</div>}
    <div className="pluginList">{items.map(x=><div className="pluginCard" key={x.id}><div className="pluginBadge"><Plug size={18}/></div><div className="pluginInfo"><b>{x.name}</b><span>{x.url}</span><small>Trigger: {x.trigger||"—"} {x.hasKey?"· cheie salvată":""}</small></div><button className="smallBtn" onClick={()=>test(x)}>Testează</button><button className="smallBtn" onClick={()=>patch(x,{enabled:!x.enabled})}>{x.enabled?"Activ":"Oprit"}</button><button className="iconDanger" onClick={()=>remove(x.id)}><Trash2 size={16}/></button></div>)}</div>
  </ToolShell>;
}

function AutomationsPanel({onClose,model}) {
  const blank={title:"",prompt:"",frequency:"daily",time:"09:00",weekday:1};
  const [items,setItems]=useState([]),[form,setForm]=useState(blank),[busy,setBusy]=useState(false);
  async function load(){setItems((await api("/api/automations")).data||[])}
  useEffect(()=>{load()},[]);
  async function add(){if(!form.title.trim()||!form.prompt.trim())return;await api("/api/automations",{method:"POST",body:JSON.stringify({...form,model})});setForm(blank);await load()}
  async function patch(x,p){await api(`/api/automations/${x.id}`,{method:"PATCH",body:JSON.stringify(p)});await load()}
  async function run(x){setBusy(true);try{await api(`/api/automations/${x.id}/run`,{method:"POST",body:"{}"});await load()}finally{setBusy(false)}}
  async function remove(id){await api(`/api/automations/${id}`,{method:"DELETE"});await load()}
  return <ToolShell title="Automatizări" subtitle="AI Stoica execută sarcini programate cât timp PC-ul și aplicația sunt pornite." onClose={onClose}>
    <div className="automationForm"><input placeholder="Titlu, ex. Rezumat zilnic" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/><textarea placeholder="Ce trebuie să facă AI Stoica?" value={form.prompt} onChange={e=>setForm({...form,prompt:e.target.value})}/><div className="automationRow"><select value={form.frequency} onChange={e=>setForm({...form,frequency:e.target.value})}><option value="hourly">La fiecare oră</option><option value="daily">Zilnic</option><option value="weekly">Săptămânal</option><option value="once">O singură dată</option></select>{form.frequency!=="hourly"&&form.frequency!=="once"&&<input type="time" value={form.time} onChange={e=>setForm({...form,time:e.target.value})}/>} {form.frequency==="weekly"&&<select value={form.weekday} onChange={e=>setForm({...form,weekday:Number(e.target.value)})}><option value={1}>Luni</option><option value={2}>Marți</option><option value={3}>Miercuri</option><option value={4}>Joi</option><option value={5}>Vineri</option><option value={6}>Sâmbătă</option><option value={0}>Duminică</option></select>}</div><button className="primary" onClick={add}><Plus size={16}/> Creează automatizare</button></div>
    <div className="automationList">{items.map(x=><div className="automationCard" key={x.id}><div className="automationIcon"><CalendarClock size={20}/></div><div className="automationInfo"><b>{x.title}</b><span>{x.frequency} · următoarea: {fmtTime(x.nextRunAt)}</span><p>{x.prompt}</p>{x.lastResult&&<details><summary>Ultimul rezultat · {fmtTime(x.lastRunAt)}</summary><div className="lastResult">{x.lastResult}</div></details>}</div><button className="iconOnly" disabled={busy} onClick={()=>run(x)} title="Rulează acum"><Play size={16}/></button><button className="smallBtn" onClick={()=>patch(x,{enabled:!x.enabled})}>{x.enabled?"Activ":"Oprit"}</button><button className="iconDanger" onClick={()=>remove(x.id)}><Trash2 size={16}/></button></div>)}</div>
  </ToolShell>;
}

function SettingsModal({onClose,onSaved}) {
  const [cfg,setCfg]=useState(null),[key,setKey]=useState("");
  useEffect(()=>{window.AIStoica.getConfig().then(setCfg)},[]);
  if(!cfg)return null;
  async function save(){await window.AIStoica.setConfig({...cfg,apiKey:key||cfg.apiKey});onSaved?.();onClose()}
  return <div className="modalBackdrop"><div className="modal"><div className="modalHead"><div><h2>Setări AI Stoica</h2><p>OmniRoute și rulare permanentă în Windows.</p></div><button className="iconOnly" onClick={onClose}><X size={20}/></button></div><label>Base URL OmniRoute<input value={cfg.baseUrl} onChange={e=>setCfg({...cfg,baseUrl:e.target.value})}/></label><label>Cheie API<input type="password" value={key} onChange={e=>setKey(e.target.value)} placeholder={cfg.apiKey?"Cheie salvată — lasă gol pentru a o păstra":"Introdu cheia OmniRoute"}/></label><label>Model/combo implicit<input value={cfg.model} onChange={e=>setCfg({...cfg,model:e.target.value})}/></label><label>Comandă OmniRoute<input value={cfg.omniCommand||"omniroute.cmd"} onChange={e=>setCfg({...cfg,omniCommand:e.target.value})}/></label><div className="toggleRow"><div><b>Pornește OmniRoute automat</b><span>Dacă serviciul se oprește, AI Stoica încearcă să-l repornească.</span></div><input type="checkbox" checked={!!cfg.autoStartOmniRoute} onChange={e=>setCfg({...cfg,autoStartOmniRoute:e.target.checked})}/></div><div className="toggleRow"><div><b>Pornește AI Stoica cu Windows</b><span>Aplicația rămâne în fundal și supraveghează OmniRoute.</span></div><input type="checkbox" checked={!!cfg.startWithWindows} onChange={e=>setCfg({...cfg,startWithWindows:e.target.checked})}/></div><div className="modalActions"><button className="secondary" onClick={onClose}>Anulează</button><button className="primary" onClick={save}>Salvează</button></div></div></div>;
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
  const [settings,setSettings]=useState(false),[createType,setCreateType]=useState(null),[toolPanel,setToolPanel]=useState(null),[updateReady,setUpdateReady]=useState(false);
  const chatRef=useRef(null);
  const current=conversations.find(c=>c.id===currentId)||null;

  async function loadData(){
    if(!localStorage.getItem(TOKEN_KEY)){setBoot(false);return}
    try{
      const [me,cs,ps,as,ms]=await Promise.all([api("/auth/me"),api("/api/conversations"),api("/api/projects"),api("/api/assistants"),api("/api/models").catch(()=>({data:[]}))]);
      setUser(me.user);localStorage.setItem(USER_KEY,JSON.stringify(me.user));setConversations(cs.data||[]);setProjects(ps.data||[]);setAssistants(as.data||[]);
      const ids=(ms.data||[]).map(x=>x.id).filter(Boolean);if(ids.length){setModels(ids);setModel(ids.find(x=>/ai[ _-]*principal/i.test(x))||ids[0])}
      if((as.data||[]).length&&!selectedAssistant)setSelectedAssistant(as.data[0].id);if((cs.data||[]).length&&!currentId)setCurrentId(cs.data[0].id);
    }catch(e){if(/Autentificare|Sesiune|401/i.test(e.message))logout()}finally{setBoot(false)}
  }
  useEffect(()=>{loadData();window.AIStoica?.onUpdateReady(()=>setUpdateReady(true))},[user?.id]);
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

  if(boot)return <div className="loadingScreen"><BrandMark/><span>Se pornește AI Stoica…</span></div>;
  if(!user)return <AuthScreen onAuth={setUser}/>;
  const hasMessages=!!current?.messages?.length;
  return <div className="appShell">
    <Sidebar open={sidebar} setOpen={setSidebar} user={user} search={search} setSearch={setSearch} projects={projects} assistants={assistants} conversations={conversations} currentId={currentId} onSelect={id=>{setCurrentId(id);setSidebar(false)}} onNew={newConversation} selectedProject={selectedProject} setSelectedProject={setSelectedProject} selectedAssistant={selectedAssistant} setSelectedAssistant={setSelectedAssistant} onNewProject={()=>setCreateType("project")} onNewAssistant={()=>setCreateType("assistant")} onTool={openTool} onSettings={()=>setSettings(true)} onLogout={logout}/>
    {sidebar&&<div className="mobileScrim" onClick={()=>setSidebar(false)}/>}
    <main className="mainArea"><Header onMenu={()=>setSidebar(true)} model={model} setModel={setModel} models={models} omni={omni} onShare={share}/>{updateReady&&<button className="updateBanner" onClick={()=>window.AIStoica.installUpdate()}>Actualizare AI Stoica disponibilă — instalează acum</button>}<div className="chatScroll" ref={chatRef}><ConversationView conversation={current} busy={busy} onRegenerate={regenerate} onRate={rate}/></div><Composer centered={!hasMessages} draft={draft} setDraft={setDraft} onSend={send} busy={busy} attachments={attachments} setAttachments={setAttachments} onOpenLibrary={()=>setToolPanel("library")}/></main>
    {settings&&<SettingsModal onClose={()=>setSettings(false)} onSaved={()=>{window.AIStoica.ensureOmni();setTimeout(loadData,1000)}}/>}
    {createType&&<CreateModal type={createType} onClose={()=>setCreateType(null)} onCreate={createItem}/>}
    {toolPanel==="library"&&<LibraryPanel onClose={()=>setToolPanel(null)} onAttach={attachFromLibrary}/>}
    {toolPanel==="memory"&&<MemoryPanel onClose={()=>setToolPanel(null)}/>}
    {toolPanel==="plugins"&&<PluginsPanel onClose={()=>setToolPanel(null)}/>}
    {toolPanel==="automations"&&<AutomationsPanel onClose={()=>setToolPanel(null)} model={model}/>}
  </div>;
}
createRoot(document.getElementById("root")).render(<App/>);
