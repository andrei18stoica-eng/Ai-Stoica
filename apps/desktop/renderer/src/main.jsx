import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Menu, Plus, Search, Folder, Bot, Settings, LogOut, Share2, MoreHorizontal,
  Paperclip, Mic, ArrowUp, Copy, ThumbsUp, ThumbsDown, RotateCcw, X,
  ChevronDown, User, Check, Wifi, WifiOff, Sparkles, SquarePen
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
  const d = new Date(ts || Date.now()); const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.floor((start - t) / 86400000);
  if (days <= 0) return "Azi";
  if (days === 1) return "Ieri";
  if (days <= 7) return "Ultimele 7 zile";
  if (days <= 30) return "Ultimele 30 de zile";
  return "Mai vechi";
}

function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const path = mode === "login" ? "/auth/login" : "/auth/register";
      const data = await api(path, { method: "POST", body: JSON.stringify({ name, email, password }) });
      localStorage.setItem(TOKEN_KEY, data.token); localStorage.setItem(USER_KEY, JSON.stringify(data.user)); onAuth(data.user);
    } catch (e2) { setError(e2.message); } finally { setBusy(false); }
  }
  return <div className="authShell">
    <div className="authGlow" />
    <div className="authBrand">
      <img src="./stoica-enterprises-ai.png" alt="Stoica Enterprises AI" />
      <h1>AI Stoica</h1><p>Stoica Enterprises AI</p>
      <div className="authFeature"><Sparkles size={17}/> Chat AI profesional, proiecte și asistenți personali.</div>
      <div className="authFeature"><Wifi size={17}/> Conectare securizată prin OmniRoute.</div>
      <div className="authFeature"><User size={17}/> Cont personal cu email.</div>
    </div>
    <form className="authCard" onSubmit={submit}>
      <div className="authTabs"><button type="button" className={mode==="login"?"active":""} onClick={()=>setMode("login")}>Autentificare</button><button type="button" className={mode==="register"?"active":""} onClick={()=>setMode("register")}>Creează cont</button></div>
      <h2>{mode === "login" ? "Bine ai revenit" : "Creează contul AI Stoica"}</h2>
      <p className="muted">Folosește emailul tău pentru contul AI Stoica.</p>
      {mode === "register" && <label>Nume<input value={name} onChange={e=>setName(e.target.value)} placeholder="Numele tău" /></label>}
      <label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="nume@email.ro" required /></label>
      <label>Parolă<input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Minimum 8 caractere" required minLength={8} /></label>
      {error && <div className="authError">{error}</div>}
      <button className="primaryWide" disabled={busy}>{busy ? "Se conectează…" : (mode === "login" ? "Intră în AI Stoica" : "Creează cont")}</button>
      <div className="localNote">În această versiune, contul și conversațiile sunt păstrate pe PC. Sincronizarea completă între Windows și iPhone se activează când publicăm Gateway-ul AI Stoica online.</div>
    </form>
  </div>;
}

function BrandMark({ small=false }) {
  return <div className={cx("brandMark", small && "small")}><img src="./stoica-enterprises-ai.png" alt="S" /></div>;
}

function Sidebar({ open, setOpen, user, search, setSearch, projects, assistants, conversations, currentId, onSelect, onNew, selectedProject, setSelectedProject, selectedAssistant, setSelectedAssistant, onNewProject, onNewAssistant, onSettings, onLogout }) {
  const filtered = conversations.filter(c => !search || (c.title||"").toLowerCase().includes(search.toLowerCase()));
  const groups = useMemo(() => {
    const out = {}; filtered.forEach(c => { const g=groupLabel(c.updatedAt); (out[g] ||= []).push(c); }); return out;
  }, [filtered]);
  return <aside className={cx("sidebar", open && "open")}>
    <div className="sideTop"><div className="brandLine"><BrandMark small/><div><b>AI Stoica</b><span>Enterprises AI</span></div></div><button className="iconOnly mobileClose" onClick={()=>setOpen(false)}><X size={20}/></button></div>
    <button className="newChat" onClick={onNew}><SquarePen size={17}/> Conversație nouă</button>
    <div className="searchBox"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Caută conversații"/></div>
    <div className="sideScroll">
      <div className="sideSection"><div className="sectionHead"><span>Proiecte</span><button onClick={onNewProject}><Plus size={15}/></button></div>
        <button className={cx("sideItem", selectedProject===null&&"active")} onClick={()=>setSelectedProject(null)}><Folder size={16}/> Toate conversațiile</button>
        {projects.map(p=><button key={p.id} className={cx("sideItem", selectedProject===p.id&&"active")} onClick={()=>setSelectedProject(p.id)}><Folder size={16}/>{p.name}</button>)}
      </div>
      <div className="sideSection"><div className="sectionHead"><span>Asistenți</span><button onClick={onNewAssistant}><Plus size={15}/></button></div>
        {assistants.map(a=><button key={a.id} className={cx("sideItem", selectedAssistant===a.id&&"active")} onClick={()=>setSelectedAssistant(a.id)}><Bot size={16}/>{a.name}</button>)}
      </div>
      <div className="sideSection historySection"><div className="sectionHead"><span>Conversații</span></div>
        {Object.entries(groups).map(([g,items])=><div key={g} className="historyGroup"><div className="historyLabel">{g}</div>{items.filter(c=>!selectedProject||c.projectId===selectedProject).map(c=><button key={c.id} className={cx("historyItem", currentId===c.id&&"active")} onClick={()=>onSelect(c.id)} title={c.title}>{c.title||"Conversație"}</button>)}</div>)}
      </div>
    </div>
    <div className="accountArea"><div className="accountBadge"><div className="accountAvatar">{(user?.name||user?.email||"S")[0].toUpperCase()}</div><div className="accountText"><b>{user?.name||"Cont Stoica"}</b><span>{user?.email}</span></div></div><div className="accountButtons"><button onClick={onSettings}><Settings size={17}/> Setări</button><button onClick={onLogout}><LogOut size={17}/> Deconectare</button></div></div>
  </aside>;
}

function Header({ onMenu, model, setModel, models, omni, onShare }) {
  return <header className="topbar"><button className="iconOnly menuBtn" onClick={onMenu}><Menu size={20}/></button><div className="modelWrap"><select value={model} onChange={e=>setModel(e.target.value)}>{models.map(m=><option key={m} value={m}>{m}</option>)}</select><ChevronDown size={15}/></div><div className="topSpacer"/><div className={cx("connection", omni?"ok":"bad")}>{omni?<Wifi size={15}/>:<WifiOff size={15}/>} {omni?"OmniRoute conectat":"OmniRoute se reconectează"}</div><button className="topAction" onClick={onShare}><Share2 size={16}/> Distribuie</button><button className="iconOnly"><MoreHorizontal size={20}/></button></header>;
}

function MessageActions({ message, onRegenerate, onRate }) {
  const [copied,setCopied]=useState(false);
  async function copy(){await navigator.clipboard.writeText(messageText(message));setCopied(true);setTimeout(()=>setCopied(false),1200)}
  return <div className="messageActions"><button onClick={copy} title="Copiază">{copied?<Check size={15}/>:<Copy size={15}/>}</button><button className={message.rating===1?"selected":""} onClick={()=>onRate(1)} title="Apreciez"><ThumbsUp size={15}/></button><button className={message.rating===-1?"selected":""} onClick={()=>onRate(-1)} title="Nu apreciez"><ThumbsDown size={15}/></button><button onClick={onRegenerate} title="Regenerează"><RotateCcw size={15}/></button></div>;
}

function ConversationView({ conversation, busy, onRegenerate, onRate }) {
  if (!conversation || !conversation.messages?.length) return <div className="welcome"><BrandMark/><h1>Cu ce lucrăm astăzi?</h1><p>Întreabă orice. AI Stoica folosește combo-ul tău OmniRoute și păstrează conversațiile în contul tău.</p></div>;
  return <div className="messagesColumn">{conversation.messages.map((m,i)=>m.role==="user"?<div key={m.id||i} className="userRow"><div className="userBubble"><div>{messageText(m)}</div>{m.attachments?.length>0&&<div className="inlineAttachments">{m.attachments.map((a,j)=><span key={j}><Paperclip size={12}/>{a.name}</span>)}</div>}</div></div>:m.role==="assistant"?<div key={m.id||i} className="assistantBlock"><div className="assistantMark">S</div><div className="assistantBody"><ReactMarkdown remarkPlugins={[remarkGfm]}>{String(m.content||"")}</ReactMarkdown>{!m.streaming&&<MessageActions message={m} onRegenerate={()=>onRegenerate(i)} onRate={v=>onRate(i,v)}/>}</div></div>:null)}{busy&&<div className="thinking"><span/><span/><span/></div>}</div>;
}

function Composer({ centered, draft, setDraft, onSend, busy, attachments, setAttachments }) {
  const ta = useRef(null); const fileInput = useRef(null);
  useEffect(()=>{if(ta.current){ta.current.style.height="0px";ta.current.style.height=Math.min(ta.current.scrollHeight,190)+"px"}},[draft]);
  async function filesChosen(e){
    const files=[...e.target.files]; const next=[];
    for(const f of files.slice(0,5)){
      if(f.size>8*1024*1024) continue;
      if(f.type.startsWith("image/")){
        const dataUrl=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(f)});
        next.push({name:f.name,type:"image",part:{type:"image_url",image_url:{url:dataUrl}}});
      } else if(f.type.startsWith("text/") || /\.(txt|md|csv|json|js|ts|py|html|css)$/i.test(f.name)) {
        const text=await f.text(); next.push({name:f.name,type:"text",part:{type:"text",text:`Conținutul fișierului ${f.name}:\n${text.slice(0,100000)}`}});
      } else next.push({name:f.name,type:"unsupported",part:null});
    }
    setAttachments([...attachments,...next]); e.target.value="";
  }
  function mic(){
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR){alert("Dictarea vocală nu este disponibilă pe acest sistem în acest moment.");return;}
    const r=new SR();r.lang="ro-RO";r.interimResults=false;r.onresult=e=>setDraft((draft?draft+" ":"")+e.results[0][0].transcript);r.start();
  }
  return <div className={cx("composerDock", centered&&"centered")}><div className="composerCard">{attachments.length>0&&<div className="attachmentTray">{attachments.map((a,i)=><span className={a.type==="unsupported"?"unsupported":""} key={i}><Paperclip size={13}/>{a.name}<button onClick={()=>setAttachments(attachments.filter((_,j)=>j!==i))}><X size={13}/></button></span>)}</div>}<div className="composerLine"><input ref={fileInput} type="file" hidden multiple onChange={filesChosen}/><button className="composerIcon" onClick={()=>fileInput.current?.click()} title="Atașează"><Plus size={21}/></button><textarea ref={ta} value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Întreabă orice" onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();onSend()}}}/><button className="composerIcon" onClick={mic} title="Dictare"><Mic size={20}/></button><button className="sendButton" disabled={busy||(!draft.trim()&&!attachments.some(a=>a.part))} onClick={onSend}><ArrowUp size={20}/></button></div></div><div className="composerHint">AI Stoica poate greși. Verifică informațiile importante.</div></div>;
}

function SettingsModal({ onClose, onSaved }) {
  const [cfg,setCfg]=useState(null); const [key,setKey]=useState("");
  useEffect(()=>{window.AIStoica.getConfig().then(setCfg)},[]);
  if(!cfg)return null;
  async function save(){await window.AIStoica.setConfig({...cfg,apiKey:key||cfg.apiKey});onSaved?.();onClose();}
  return <div className="modalBackdrop"><div className="modal"><div className="modalHead"><div><h2>Setări AI Stoica</h2><p>OmniRoute și rulare permanentă în Windows.</p></div><button className="iconOnly" onClick={onClose}><X size={20}/></button></div><label>Base URL OmniRoute<input value={cfg.baseUrl} onChange={e=>setCfg({...cfg,baseUrl:e.target.value})}/></label><label>Cheie API<input type="password" value={key} onChange={e=>setKey(e.target.value)} placeholder={cfg.apiKey?"Cheie salvată — lasă gol pentru a o păstra":"Introdu cheia OmniRoute"}/></label><label>Model/combo implicit<input value={cfg.model} onChange={e=>setCfg({...cfg,model:e.target.value})}/></label><label>Comandă OmniRoute<input value={cfg.omniCommand||"omniroute.cmd"} onChange={e=>setCfg({...cfg,omniCommand:e.target.value})}/></label><div className="toggleRow"><div><b>Pornește OmniRoute automat</b><span>Dacă serviciul se oprește, AI Stoica încearcă să-l repornească.</span></div><input type="checkbox" checked={!!cfg.autoStartOmniRoute} onChange={e=>setCfg({...cfg,autoStartOmniRoute:e.target.checked})}/></div><div className="toggleRow"><div><b>Pornește AI Stoica cu Windows</b><span>Aplicația rămâne în fundal și supraveghează OmniRoute.</span></div><input type="checkbox" checked={!!cfg.startWithWindows} onChange={e=>setCfg({...cfg,startWithWindows:e.target.checked})}/></div><div className="modalActions"><button className="secondary" onClick={onClose}>Anulează</button><button className="primary" onClick={save}>Salvează</button></div></div></div>;
}

function CreateModal({ type, onClose, onCreate }) {
  const [name,setName]=useState(""); const [prompt,setPrompt]=useState("");
  return <div className="modalBackdrop"><div className="modal smallModal"><div className="modalHead"><h2>{type==="project"?"Proiect nou":"Asistent personalizat"}</h2><button className="iconOnly" onClick={onClose}><X size={20}/></button></div><label>Nume<input autoFocus value={name} onChange={e=>setName(e.target.value)} placeholder={type==="project"?"Ex. Proiecte Primărie":"Ex. Profesor de matematică"}/></label>{type==="assistant"&&<label>Instrucțiuni pentru asistent<textarea className="promptArea" value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder="Cum vrei să lucreze acest asistent?"/></label>}<div className="modalActions"><button className="secondary" onClick={onClose}>Anulează</button><button className="primary" disabled={!name.trim()} onClick={()=>onCreate({name:name.trim(),systemPrompt:prompt.trim()})}>Creează</button></div></div></div>;
}

function App() {
  const [user,setUser]=useState(()=>{try{return JSON.parse(localStorage.getItem(USER_KEY)||"null")}catch{return null}});
  const [boot,setBoot]=useState(true); const [conversations,setConversations]=useState([]); const [projects,setProjects]=useState([]); const [assistants,setAssistants]=useState([]); const [models,setModels]=useState(["Ai principal"]);
  const [currentId,setCurrentId]=useState(null); const [model,setModel]=useState("Ai principal"); const [selectedProject,setSelectedProject]=useState(null); const [selectedAssistant,setSelectedAssistant]=useState(null);
  const [draft,setDraft]=useState(""); const [attachments,setAttachments]=useState([]); const [busy,setBusy]=useState(false); const [search,setSearch]=useState(""); const [sidebar,setSidebar]=useState(false); const [omni,setOmni]=useState(false);
  const [settings,setSettings]=useState(false); const [createType,setCreateType]=useState(null); const [updateReady,setUpdateReady]=useState(false);
  const chatRef=useRef(null);

  const current = conversations.find(c=>c.id===currentId) || null;
  async function loadData() {
    if(!localStorage.getItem(TOKEN_KEY)){setBoot(false);return;}
    try {
      const [me,cs,ps,as,ms] = await Promise.all([api("/auth/me"),api("/api/conversations"),api("/api/projects"),api("/api/assistants"),api("/api/models").catch(()=>({data:[]}))]);
      setUser(me.user);localStorage.setItem(USER_KEY,JSON.stringify(me.user));setConversations(cs.data||[]);setProjects(ps.data||[]);setAssistants(as.data||[]);
      const ids=(ms.data||[]).map(x=>x.id).filter(Boolean); if(ids.length){setModels(ids);const fav=ids.find(x=>/ai[ _-]*principal/i.test(x))||ids[0];setModel(fav)}
      if((as.data||[]).length&&!selectedAssistant)setSelectedAssistant(as.data[0].id);
      if((cs.data||[]).length&&!currentId)setCurrentId(cs.data[0].id);
    } catch(e){ if(/Autentificare|Sesiune|401/i.test(e.message)){logout();} }
    finally{setBoot(false)}
  }
  useEffect(()=>{loadData();window.AIStoica?.onUpdateReady(()=>setUpdateReady(true));},[user?.id]);
  useEffect(()=>{const poll=async()=>{try{const h=await fetch(`${GATEWAY}/health`).then(r=>r.json());setOmni(!!h.omni)}catch{setOmni(false);window.AIStoica?.ensureOmni?.().catch(()=>{})}};poll();const id=setInterval(poll,8000);return()=>clearInterval(id)},[]);
  useEffect(()=>{setTimeout(()=>chatRef.current?.scrollTo({top:chatRef.current.scrollHeight,behavior:"smooth"}),30)},[current?.messages?.length,busy,current?.messages?.at(-1)?.content]);

  function logout(){localStorage.removeItem(TOKEN_KEY);localStorage.removeItem(USER_KEY);setUser(null);setConversations([]);setCurrentId(null)}
  function newConversation(){setCurrentId(null);setDraft("");setAttachments([]);setSidebar(false)}
  async function saveConversation(conv){
    if(conv.id){const d=await api(`/api/conversations/${conv.id}`,{method:"PUT",body:JSON.stringify(conv)});setConversations(v=>v.map(x=>x.id===conv.id?d.data:x));return d.data}
    const d=await api("/api/conversations",{method:"POST",body:JSON.stringify(conv)});setConversations(v=>[d.data,...v]);setCurrentId(d.data.id);return d.data;
  }
  async function streamAssistant(baseConv, messages) {
    setBusy(true);
    const assistantMessage={id:uid(),role:"assistant",content:"",createdAt:Date.now(),streaming:true};
    let working={...baseConv,messages:[...messages,assistantMessage],updatedAt:Date.now()};setConversations(v=>v.map(x=>x.id===working.id?working:x));
    try{
      if(!omni){await window.AIStoica.ensureOmni();await new Promise(r=>setTimeout(r,1200))}
      const token=localStorage.getItem(TOKEN_KEY)||"";
      const r=await fetch(`${GATEWAY}/api/chat/stream`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({model,assistantId:working.assistantId,messages})});
      if(!r.ok){let e;try{e=await r.json()}catch{e={error:await r.text()}};throw new Error(e?.error||`HTTP ${r.status}`)}
      const reader=r.body.getReader();const dec=new TextDecoder();let buf="",answer="";
      while(true){const {value,done}=await reader.read();if(done)break;buf+=dec.decode(value,{stream:true});const events=buf.split("\n\n");buf=events.pop()||"";for(const ev of events){for(const line of ev.split("\n")){if(!line.startsWith("data:"))continue;const raw=line.slice(5).trim();if(!raw||raw==="[DONE]")continue;try{const j=JSON.parse(raw);const delta=j?.choices?.[0]?.delta?.content||j?.choices?.[0]?.message?.content||"";if(delta){answer+=delta;working={...working,messages:[...messages,{...assistantMessage,content:answer,streaming:true}]};setConversations(v=>v.map(x=>x.id===working.id?working:x))}}catch{}}}}
      working={...working,messages:[...messages,{...assistantMessage,content:answer||"Nu am primit răspuns.",streaming:false}],updatedAt:Date.now()};
      const saved=await saveConversation(working);setConversations(v=>v.map(x=>x.id===saved.id?saved:x));
    }catch(e){working={...working,messages:[...messages,{...assistantMessage,content:`Eroare: ${e.message}`,streaming:false}],updatedAt:Date.now()};const saved=await saveConversation(working);setConversations(v=>v.map(x=>x.id===saved.id?saved:x));}
    finally{setBusy(false)}
  }
  async function send(){
    const text=draft.trim();const usable=attachments.filter(a=>a.part);if((!text&&!usable.length)||busy)return;
    const parts=[...(text?[{type:"text",text}]:[]),...usable.map(a=>a.part)];const content=parts.length===1&&parts[0].type==="text"?parts[0].text:parts;
    const userMsg={id:uid(),role:"user",content,displayText:text||"Fișier atașat",attachments:attachments.map(a=>({name:a.name,type:a.type})),createdAt:Date.now()};
    let conv=current ? {...current} : {title:titleFrom(text||attachments[0]?.name),projectId:selectedProject,assistantId:selectedAssistant,model,messages:[]};
    conv={...conv,title:conv.messages?.length?conv.title:titleFrom(text||attachments[0]?.name),projectId:conv.projectId??selectedProject,assistantId:conv.assistantId??selectedAssistant,model,messages:[...(conv.messages||[]),userMsg],updatedAt:Date.now()};
    setDraft("");setAttachments([]);const saved=await saveConversation(conv);await streamAssistant(saved,saved.messages);
  }
  async function regenerate(index){if(busy||!current)return;const msgs=current.messages.slice(0,index);const conv={...current,messages:msgs};const saved=await saveConversation(conv);await streamAssistant(saved,msgs)}
  async function rate(index,value){if(!current)return;const msgs=current.messages.map((m,i)=>i===index?{...m,rating:m.rating===value?0:value}:m);await saveConversation({...current,messages:msgs})}
  async function createItem(data){if(createType==="project"){const d=await api("/api/projects",{method:"POST",body:JSON.stringify(data)});setProjects(v=>[d.data,...v]);setSelectedProject(d.data.id)}else{const d=await api("/api/assistants",{method:"POST",body:JSON.stringify(data)});setAssistants(v=>[...v,d.data]);setSelectedAssistant(d.data.id)}setCreateType(null)}
  async function share(){if(!current)return;const text=current.messages.map(m=>`${m.role==="user"?"Eu":"AI Stoica"}:\n${messageText(m)}`).join("\n\n");await navigator.clipboard.writeText(text);alert("Conversația a fost copiată în clipboard.")}

  if(boot)return <div className="loadingScreen"><BrandMark/><span>Se pornește AI Stoica…</span></div>;
  if(!user)return <AuthScreen onAuth={setUser}/>;
  const hasMessages=!!current?.messages?.length;
  return <div className="appShell">
    <Sidebar open={sidebar} setOpen={setSidebar} user={user} search={search} setSearch={setSearch} projects={projects} assistants={assistants} conversations={conversations} currentId={currentId} onSelect={id=>{setCurrentId(id);setSidebar(false)}} onNew={newConversation} selectedProject={selectedProject} setSelectedProject={setSelectedProject} selectedAssistant={selectedAssistant} setSelectedAssistant={setSelectedAssistant} onNewProject={()=>setCreateType("project")} onNewAssistant={()=>setCreateType("assistant")} onSettings={()=>setSettings(true)} onLogout={logout}/>
    {sidebar&&<div className="mobileScrim" onClick={()=>setSidebar(false)}/>}<main className="mainArea"><Header onMenu={()=>setSidebar(true)} model={model} setModel={setModel} models={models} omni={omni} onShare={share}/>{updateReady&&<button className="updateBanner" onClick={()=>window.AIStoica.installUpdate()}>Actualizare AI Stoica disponibilă — instalează acum</button>}<div className="chatScroll" ref={chatRef}><ConversationView conversation={current} busy={busy} onRegenerate={regenerate} onRate={rate}/></div><Composer centered={!hasMessages} draft={draft} setDraft={setDraft} onSend={send} busy={busy} attachments={attachments} setAttachments={setAttachments}/></main>
    {settings&&<SettingsModal onClose={()=>setSettings(false)} onSaved={()=>{window.AIStoica.ensureOmni();setTimeout(loadData,1000)}}/>}{createType&&<CreateModal type={createType} onClose={()=>setCreateType(null)} onCreate={createItem}/>} 
  </div>;
}

createRoot(document.getElementById("root")).render(<App/>);
