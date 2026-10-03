import React, { useEffect, useRef, useState } from "react";
import { Search, Trash2, Pin, PinOff, Pencil, Brain, History, Check, X } from "lucide-react";
import { api, toast, cx, plural, fmtTime, ToolShell, Switch } from "../core.jsx";

export const PREFERENCE_ITEMS=[
  ["memoryEnabled","Folosește memoria","AI Stoica reține automat preferințele, deciziile și detaliile durabile și le folosește când sunt relevante."],
  ["searchPastChats","Caută în conversațiile anterioare","Când întrebi ceva, caută în celelalte conversații ale tale (și în cele arhivate) și folosește ce are legătură. Așa poți continua un subiect într-o conversație nouă."],
  ["askClarifyingQuestions","Pune întrebări de clarificare (cu variante de răspuns)","Când o cerere poate fi înțeleasă în mai multe feluri, AI Stoica întreabă înainte, cu variante pe care le alegi cu un clic."]
];
export function PreferenceSwitches({preferences,onChange,busyKey=""}){
  return <div className="prefList">{PREFERENCE_ITEMS.map(([k,title,desc])=><div className="prefRow" key={k}>
    <div className="prefText"><b>{title}</b><span>{desc}</span></div>
    <Switch checked={preferences?.[k]!==false} label={title} disabled={busyKey===k} onChange={v=>onChange({[k]:v})}/>
  </div>)}</div>;
}

const MEMORY_SOURCES={manual:"adăugată de tine",automatic:"reținută automat",history:"din istoric",automation:"dintr-o sarcină programată"};
const CATEGORY_ORDER=["preferință","proiect","decizie","detaliu"];
const CATEGORY_LABELS={"preferință":"Preferințe","proiect":"Proiecte și muncă","decizie":"Decizii","detaliu":"Alte detalii"};

function MemoryItem({x,busy,onPin,onRemove,onSave}){
  const [editing,setEditing]=useState(false),[text,setText]=useState(x.text);
  useEffect(()=>{if(!editing)setText(x.text)},[x.text,editing]);
  async function save(){if(!text.trim()||text.trim()===x.text){setEditing(false);return;}if(await onSave(x,text.trim()))setEditing(false)}
  return <div className={cx("memoryItem",x.pinned&&"pinned")}>
    <button className="pinBtn" onClick={()=>onPin(x)} disabled={busy} aria-label={x.pinned?"Anulează fixarea":"Fixează informația"} title={x.pinned?"Fixată — apasă pentru a anula":"Fixează"}>{x.pinned?<Pin size={16}/>:<PinOff size={16}/>}</button>
    <div className="memoryItemBody">
      {editing?<textarea value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&(e.ctrlKey||e.metaKey)){e.preventDefault();save()}}} aria-label="Textul informației" autoFocus/>:<p>{x.text}</p>}
      <span>{MEMORY_SOURCES[x.source]||x.source||"memorie"} · {fmtTime(x.updatedAt||x.createdAt)}</span>
    </div>
    <div className="memoryItemActions">
      {editing?<>
        <button className="iconOnly smallIcon" onClick={save} disabled={busy||!text.trim()} aria-label="Salvează modificarea" title="Salvează"><Check size={15}/></button>
        <button className="iconOnly smallIcon" onClick={()=>setEditing(false)} aria-label="Renunță la modificare" title="Renunță"><X size={15}/></button>
      </>:<button className="iconOnly smallIcon" onClick={()=>setEditing(true)} disabled={busy} aria-label="Editează informația" title="Editează"><Pencil size={15}/></button>}
      <button className="iconDanger" onClick={()=>onRemove(x)} disabled={busy} aria-label="Șterge informația" title="Șterge"><Trash2 size={15}/></button>
    </div>
  </div>;
}

export function MemoryPage({onClose,preferences,onPreferences,prefBusy}){
  const [items,setItems]=useState([]),[loading,setLoading]=useState(true),[enabled,setEnabled]=useState(true),[query,setQuery]=useState(""),[text,setText]=useState(""),[summary,setSummary]=useState(null),[busy,setBusy]=useState(""),[error,setError]=useState("");
  const seq=useRef(0),mounted=useRef(true);
  useEffect(()=>()=>{mounted.current=false},[]);
  async function load(q=query.trim()){
    const id=++seq.current;
    try{
      const [d,sm]=await Promise.all([api(`/api/memory${q?`?q=${encodeURIComponent(q)}`:""}`),api("/api/memory/summary").catch(()=>({data:null}))]);
      if(id!==seq.current||!mounted.current)return;
      setItems(d.data||[]);setEnabled(d.enabled!==false);setSummary(sm.data||null);setError("");
    }catch(e){if(id===seq.current&&mounted.current)setError(e.message)}
    finally{if(id===seq.current&&mounted.current)setLoading(false)}
  }
  useEffect(()=>{const t=setTimeout(()=>load(query.trim()),query.trim()?300:0);return()=>clearTimeout(t)},[query]);
  async function run(kind,fn){if(busy)return false;setBusy(kind);try{await fn();return true}catch(e){toast(e.message);return false}finally{if(mounted.current)setBusy("")}}
  const add=()=>{if(!text.trim())return;run("add",async()=>{await api("/api/memory",{method:"POST",body:JSON.stringify({text:text.trim(),pinned:true})});setText("");toast("Informația a fost salvată și fixată în memorie.","ok");await load()})};
  const pin=x=>run("pin",async()=>{await api(`/api/memory/${x.id}`,{method:"PATCH",body:JSON.stringify({pinned:!x.pinned})});await load()});
  const saveText=(x,value)=>run("edit",async()=>{await api(`/api/memory/${x.id}`,{method:"PATCH",body:JSON.stringify({text:value})});await load()});
  const remove=x=>{if(!confirm("Ștergi această informație din memorie?"))return;run("remove",async()=>{await api(`/api/memory/${x.id}`,{method:"DELETE"});await load()})};
  const clear=()=>{if(!confirm("Ștergi toate memoriile AI Stoica pentru acest cont? Operația nu poate fi anulată."))return;run("clear",async()=>{await api("/api/memory",{method:"DELETE"});setQuery("");await load("")})};
  const importHistory=()=>{if(!confirm("Import din istoricul conversațiilor informațiile durabile (preferințe, decizii, detalii de proiect)?"))return;run("import",async()=>{const d=await api("/api/memory/import-history",{method:"POST",body:"{}"});toast(`Am importat ${plural(d.count||0,"informație","informații")} din istoric.`,"ok");await load()})};
  async function changePreferences(patch){
    const ok=await onPreferences(patch);
    if(ok&&"memoryEnabled" in patch)setEnabled(patch.memoryEnabled);
  }
  const prefs={...(preferences||{}),memoryEnabled:preferences&&typeof preferences.memoryEnabled==="boolean"?preferences.memoryEnabled:enabled};
  const facts=summary?[...(summary.recent||[])].sort((a,b)=>Number(b.pinned)-Number(a.pinned)).slice(0,5):[];
  const searching=!!query.trim();
  const grouped=searching?[["Rezultate",items]]:CATEGORY_ORDER.map(c=>[CATEGORY_LABELS[c],items.filter(x=>(x.category||"detaliu")===c)]).concat([["Altele",items.filter(x=>!CATEGORY_ORDER.includes(x.category||"detaliu"))]]).filter(([,list])=>list.length);
  return <ToolShell title="Memorie" subtitle="Ce reține AI Stoica despre tine și cum folosește conversațiile anterioare." onClose={onClose} className="pageModal memoryPage">
    <div className="pageBody">
      <div className="memoryOverview">
        <section className="memoryCard">
          <h3><Brain size={17}/> Setări memorie</h3>
          <PreferenceSwitches preferences={prefs} onChange={changePreferences} busyKey={prefBusy}/>
        </section>
        <section className="memoryCard">
          <h3><History size={17}/> Ce știe AI Stoica despre tine</h3>
          {!prefs.memoryEnabled&&<p className="memoryOff">Memoria este oprită: AI Stoica nu reține și nu folosește informații noi până o pornești.</p>}
          {summary?.count?<>
            <div className="memoryStats"><span><b>{summary.count}</b> {summary.count===1?"informație":"informații"}</span><span><b>{summary.pinned||0}</b> fixate</span><span><b>{Object.keys(summary.categories||{}).length}</b> {Object.keys(summary.categories||{}).length===1?"categorie":"categorii"}</span></div>
            <ul className="memoryFacts">{facts.map(f=><li key={f.id}>{f.pinned&&<Pin size={12}/>} {String(f.text).length>170?String(f.text).slice(0,170)+"…":f.text}</li>)}</ul>
          </>:<p className="memoryEmptyNote">Încă nimic. Pe măsură ce vorbiți, AI Stoica reține preferințele și deciziile importante. Poți adăuga și tu ceva mai jos.</p>}
        </section>
      </div>
      <div className="memoryAdd"><textarea value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&(e.ctrlKey||e.metaKey)){e.preventDefault();add()}}} placeholder="Adaugă ceva important pe care AI Stoica să-l țină minte… (Ctrl+Enter salvează)" aria-label="Informație nouă pentru memorie"/><button className="primary" onClick={add} disabled={!text.trim()||!!busy}>{busy==="add"?"Se salvează…":"Salvează și fixează"}</button></div>
      <div className="memoryToolbar">
        <div className="pageSearch"><Search size={15}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Caută în memorie" aria-label="Caută în memorie"/></div>
        <button className="secondary" onClick={importHistory} disabled={!!busy}><History size={15}/> {busy==="import"?"Se importă…":"Importă din istoric"}</button>
        <button className="dangerButton" onClick={clear} disabled={!!busy||!items.length}><Trash2 size={15}/> Șterge tot</button>
      </div>
      {error&&<div className="inlineError" role="alert">{error}</div>}
      {loading?<div className="emptyState small">Se încarcă memoria…</div>:!items.length?<div className="emptyState small">{searching?"Nu am găsit nimic pentru această căutare.":"Memoria este goală."}</div>:
        grouped.map(([label,list])=><section className="memoryGroup" key={label}><h4>{label} <small>{list.length}</small></h4><div className="memoryList">{list.map(x=><MemoryItem key={x.id} x={x} busy={!!busy} onPin={pin} onRemove={remove} onSave={saveText}/>)}</div></section>)}
    </div>
  </ToolShell>;
}
