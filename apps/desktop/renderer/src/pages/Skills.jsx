import React, { useEffect, useRef, useState } from "react";
import { Plus, Pencil, Trash2, Sparkles, Check } from "lucide-react";
import { api, toast, cx, ToolShell, Switch } from "../core.jsx";

// Skills (0.7.18): instructions saved once and called with /name in the chat, or kept always on.
const BLANK={name:"",slug:"",description:"",instructions:""};

function SkillForm({initial,onCancel,onSaved}){
  const [f,setF]=useState(initial),[busy,setBusy]=useState(false);
  const set=(k,v)=>setF(x=>({...x,[k]:v}));
  async function save(e){
    e.preventDefault();if(busy)return;setBusy(true);
    try{
      const body={name:f.name,slug:f.slug||undefined,description:f.description,instructions:f.instructions};
      const d=f.id?await api(`/api/skills/${f.id}`,{method:"PATCH",body:JSON.stringify(body)}):await api("/api/skills",{method:"POST",body:JSON.stringify(body)});
      toast(`Skill-ul /${d.data.slug} a fost salvat.`,"success");onSaved();
    }catch(err){toast(err.message)}finally{setBusy(false)}
  }
  return <form className="skillForm" onSubmit={save}>
    <label>Nume<input value={f.name} onChange={e=>set("name",e.target.value)} maxLength={60} placeholder="ex. Răspuns la reclamații" required/></label>
    <label>Comanda în chat<div className="skillSlug"><span>/</span><input value={f.slug} onChange={e=>set("slug",e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,""))} maxLength={32} placeholder="se face din nume"/></div></label>
    <label>Descriere scurtă<input value={f.description} onChange={e=>set("description",e.target.value)} maxLength={300} placeholder="Ce face, într-o propoziție"/></label>
    <label>Instrucțiuni pentru AI<textarea value={f.instructions} onChange={e=>set("instructions",e.target.value)} maxLength={8000} rows={8} placeholder="Ce trebuie să facă AI-ul de fiecare dată când folosești acest skill: ton, structură, ce să includă, ce să evite." required/></label>
    <div className="formActions"><button type="button" className="secondary" onClick={onCancel}>Renunță</button><button className="primary" disabled={busy}>{busy?"Se salvează…":"Salvează skill-ul"}</button></div>
  </form>;
}

export function SkillsPage({onClose}){
  const [items,setItems]=useState([]),[templates,setTemplates]=useState([]),[loading,setLoading]=useState(true),[editing,setEditing]=useState(null),[busy,setBusy]=useState("");
  const mounted=useRef(true);
  useEffect(()=>()=>{mounted.current=false},[]);
  async function load(){
    try{const d=await api("/api/skills");if(mounted.current){setItems(d.data||[]);setTemplates(d.templates||[])}}
    catch(e){toast("Nu am putut încărca skill-urile: "+e.message)}
    finally{if(mounted.current)setLoading(false)}
  }
  useEffect(()=>{load()},[]);
  async function run(key,fn){if(busy)return;setBusy(key);try{await fn();await load()}catch(e){toast(e.message)}finally{if(mounted.current)setBusy("")}}
  const addTemplate=t=>run("t:"+t.slug,async()=>{await api("/api/skills/template",{method:"POST",body:JSON.stringify({slug:t.slug})});toast(`Ai adăugat /${t.slug}. Scrie-l în chat ca să-l folosești.`,"success")});
  const patch=(x,p)=>run(x.id,()=>api(`/api/skills/${x.id}`,{method:"PATCH",body:JSON.stringify(p)}));
  const remove=x=>{if(!confirm(`Ștergi skill-ul /${x.slug}?`))return;run(x.id,()=>api(`/api/skills/${x.id}`,{method:"DELETE"}))};
  const free=templates.filter(t=>!t.added);
  return <ToolShell title="Skill-uri" subtitle="Instrucțiuni salvate o dată și folosite oricând: scrie /nume în chat (de ex. /rezumat) sau lasă un skill mereu activ." onClose={onClose} className="pageModal skillsPage">
    <div className="pageBody">
      {editing?<SkillForm initial={editing} onCancel={()=>setEditing(null)} onSaved={()=>{setEditing(null);load()}}/>:<>
        <div className="skillsHead"><h3>Skill-urile tale</h3><button className="primary" onClick={()=>setEditing({...BLANK})}><Plus size={14}/> Skill nou</button></div>
        {loading?<div className="emptyState small">Se încarcă…</div>:!items.length?<div className="taskEmpty">
          <span className="taskIcon big"><Sparkles size={26}/></span><h3>Nu ai încă skill-uri</h3>
          <p>Un skill e un set de instrucțiuni pe care AI-ul îl urmează când îl chemi. Adaugă unul de mai jos sau creează-l pe al tău.</p>
        </div>:<div className="skillList">{items.map(x=><div key={x.id} className={cx("skillCard",!x.enabled&&"off")}>
          <div className="skillCardText"><b>/{x.slug} <span>{x.name}</span></b><small>{x.description||String(x.instructions||"").slice(0,140)}</small></div>
          <div className="skillCardActions">
            <label className="skillAuto" title="Mereu activ: se aplică la fiecare mesaj, fără /nume"><Switch checked={!!x.auto} label={`Mereu activ ${x.slug}`} disabled={busy===x.id} onChange={v=>patch(x,{auto:v})}/><span>Mereu activ</span></label>
            <Switch checked={x.enabled} label={`Activ ${x.slug}`} disabled={busy===x.id} onChange={v=>patch(x,{enabled:v})}/>
            <button className="iconOnly smallIcon" onClick={()=>setEditing({...x})} aria-label={`Editează ${x.slug}`} title="Editează"><Pencil size={15}/></button>
            <button className="iconDanger" onClick={()=>remove(x)} aria-label={`Șterge ${x.slug}`} title="Șterge"><Trash2 size={15}/></button>
          </div>
        </div>)}</div>}
        {free.length>0&&<section className="catalogSection"><h3>Gata făcute</h3><div className="catalogGrid">
          {free.map(t=><div className="catalogCard" key={t.slug}>
            <span className="pluginLogo"><span>/</span></span>
            <div className="catalogText"><b>{t.name} <small>/{t.slug}</small></b><small>{t.description}</small></div>
            <button className="smallBtn addBtn" onClick={()=>addTemplate(t)} disabled={busy==="t:"+t.slug} aria-label={`Adaugă ${t.name}`}>{busy==="t:"+t.slug?<Check size={13}/>:<Plus size={13}/>} Adaugă</button>
          </div>)}
        </div></section>}
      </>}
    </div>
  </ToolShell>;
}
