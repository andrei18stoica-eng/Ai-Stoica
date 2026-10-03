import React, { useEffect, useRef, useState } from "react";
import { CalendarClock, Plus, Play, Pencil, Copy, Trash2, ArrowLeft, ChevronDown, RotateCcw, Clock, Bell, BellOff, Sparkles } from "lucide-react";
import { api, toast, cx, plural, ToolShell, Modal, Switch, relativeDay, shortDate, clockTime, Markdown } from "../core.jsx";

export const DAY_NAMES=["duminică","luni","marți","miercuri","joi","vineri","sâmbătă"];
const WEEK_ORDER=[1,2,3,4,5,6,0];
const SHORT_DAYS={1:"L",2:"Ma",3:"Mi",4:"J",5:"V",6:"S",0:"D"};
const WORKDAYS=[1,2,3,4,5];
const cap=s=>s?s[0].toUpperCase()+s.slice(1):s;
const sameDays=(a,b)=>{const x=[...new Set((a||[]).map(Number))].sort(),y=[...b].sort();return x.length===y.length&&x.every((v,i)=>v===y[i]);};
export function localTimeZone(){try{return Intl.DateTimeFormat().resolvedOptions().timeZone||""}catch{return ""}}

export function humanSchedule(x){
  const t=x?.time||"09:00";
  switch(x?.frequency){
    case "once":return x.runAt?`O singură dată: ${shortDate(x.runAt)}, ${clockTime(x.runAt)}`:"O singură dată";
    case "hourly":return "La fiecare oră";
    case "interval":{const n=Number(x.intervalHours||1);return n<=1?"La fiecare oră":`La fiecare ${plural(n,"oră","ore")}`;}
    case "weekly":return `Săptămânal, ${DAY_NAMES[Number(x.weekday)]||"luni"} la ${t}`;
    case "selected_days":{
      const days=[...new Set((x.days||[]).map(Number))].filter(d=>d>=0&&d<=6);
      if(days.length===7)return `Zilnic la ${t}`;
      if(sameDays(days,WORKDAYS))return `Luni–Vineri la ${t}`;
      if(sameDays(days,[0,6]))return `Sâmbătă și duminică la ${t}`;
      const names=WEEK_ORDER.filter(d=>days.includes(d)).map(d=>DAY_NAMES[d]);
      return names.length?`${cap(names.join(", "))} la ${t}`:"Nicio zi aleasă";
    }
    case "monthly":return `Lunar, pe ${x.monthday||1}, la ${t}`;
    default:return `Zilnic la ${t}`;
  }
}

const STATUS={
  ok:["Reușită","ok"],delivered:["Reușită","ok"],no_change:["Fără schimbări","neutral"],checked_no_change:["Fără schimbări","neutral"],
  error:["Eroare","error"],disabled_after_errors:["Oprită după erori","error"],needs_login:["Necesită autentificare","warn"],permission_denied:["Oprită de Owner","warn"]
};
export function StatusPill({status,ran=true}){
  const [label,kind]=STATUS[status]||(ran?["Modificată","idle"]:["Nerulată încă","idle"]);
  return <span className={cx("statusPill",kind)}>{label}</span>;
}

const FREQUENCIES=[["once","O singură dată"],["hourly","La fiecare oră"],["interval","La câteva ore"],["daily","Zilnic"],["weekdays","Zile lucrătoare (luni–vineri)"],["selected_days","Zile alese"],["weekly","Săptămânal"],["monthly","Lunar"]];
const TIMED=["daily","weekdays","selected_days","weekly","monthly"];
function toLocalInput(ts){
  if(!ts)return "";
  const d=new Date(ts);if(!Number.isFinite(d.getTime()))return "";
  const p=n=>String(n).padStart(2,"0");
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function blankForm(model=""){return {title:"",prompt:"",frequency:"daily",time:"09:00",weekday:1,days:[...WORKDAYS],runAt:"",intervalHours:3,monthday:1,model,notify:true,watch:false};}
function formFrom(x){
  return {...blankForm(x.model||""),title:x.title||"",prompt:x.prompt||"",
    frequency:x.frequency==="selected_days"&&sameDays(x.days,WORKDAYS)?"weekdays":(x.frequency||"daily"),
    time:x.time||"09:00",weekday:Number(x.weekday??1),days:Array.isArray(x.days)&&x.days.length?x.days.map(Number):[...WORKDAYS],
    runAt:toLocalInput(x.runAt),intervalHours:Number(x.intervalHours||3),monthday:Number(x.monthday||1),notify:x.notify!==false,watch:x.timingMode==="condition_watch"};
}
function payloadFrom(f){
  const weekdays=f.frequency==="weekdays";
  return {title:f.title.trim(),prompt:f.prompt.trim(),frequency:weekdays?"selected_days":f.frequency,time:f.time,weekday:Number(f.weekday),
    days:weekdays?[...WORKDAYS]:f.days,intervalHours:Number(f.intervalHours),monthday:Number(f.monthday),
    runAt:f.frequency==="once"?Date.parse(f.runAt):null,notify:!!f.notify,timingMode:f.watch?"condition_watch":"exact_schedule",
    timeZone:localTimeZone(),...(f.model?{model:f.model}:{})};
}
export function validateTask(f,{needsFuture=true}={}){
  if(!f.title.trim())return "Scrie un nume pentru sarcină.";
  if(f.title.trim().length>120)return "Numele poate avea maximum 120 de caractere.";
  if(!f.prompt.trim())return "Scrie ce trebuie să facă AI Stoica.";
  if(f.prompt.trim().length>8000)return "Instrucțiunile pot avea maximum 8000 de caractere.";
  if(TIMED.includes(f.frequency)&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(f.time||""))return "Alege o oră validă (00:00–23:59).";
  if(f.frequency==="interval"&&!(Number.isInteger(Number(f.intervalHours))&&f.intervalHours>=1&&f.intervalHours<=168))return "Intervalul trebuie să fie între 1 și 168 de ore.";
  if(f.frequency==="monthly"&&!(Number.isInteger(Number(f.monthday))&&f.monthday>=1&&f.monthday<=28))return "Ziua lunii trebuie să fie între 1 și 28.";
  if(f.frequency==="selected_days"&&!f.days.length)return "Alege cel puțin o zi a săptămânii.";
  if(f.frequency==="once"){const at=Date.parse(f.runAt||"");if(!Number.isFinite(at))return "Alege data și ora pentru sarcina unică.";if(needsFuture&&at<=Date.now()+30000)return "Alege o dată și o oră din viitor.";}
  return "";
}
const EXAMPLES=[
  {label:"Știri în fiecare dimineață",title:"Știri de dimineață",prompt:"Fă-mi un rezumat scurt al celor mai importante știri de azi din România și din tehnologie, cu linkuri către surse.",frequency:"weekdays",time:"08:30"},
  {label:"Plan pentru săptămână",title:"Plan pentru săptămână",prompt:"Propune-mi un plan pentru săptămâna care începe: priorități, termene și câte un pas mic pentru fiecare zi.",frequency:"weekly",weekday:1,time:"09:00"},
  {label:"Urmărește un preț",title:"Verifică prețul",prompt:"Verifică prețul la iPhone 16 pe eMAG și spune-mi doar dacă a scăzut sub 4000 de lei.",frequency:"daily",time:"10:00",watch:true}
];

function TaskForm({initial,editing,models,onClose,onSave}){
  const [f,setF]=useState(initial),[error,setError]=useState(""),[saving,setSaving]=useState(false);
  const mounted=useRef(true);
  useEffect(()=>()=>{mounted.current=false},[]);
  const set=patch=>setF(v=>({...v,...patch}));
  const modelOptions=[...new Set([...(models||[]),f.model].filter(Boolean))];
  async function submit(e){
    e.preventDefault();
    if(saving)return;
    const problem=validateTask(f,{needsFuture:!editing||editing.enabled!==false});
    if(problem){setError(problem);return;}
    setError("");setSaving(true);
    try{await onSave(payloadFrom(f))}
    catch(err){if(mounted.current){setError(err.message);setSaving(false)}}
  }
  function toggleDay(d){set({days:f.days.includes(d)?f.days.filter(x=>x!==d):[...f.days,d]})}
  return <Modal title={editing?"Editează sarcina":"Sarcină nouă"} subtitle="AI Stoica rulează instrucțiunile singur, la ora aleasă, cât timp aplicația este pornită." className="modal taskFormModal" onClose={onClose}>
    <form className="taskForm" onSubmit={submit} noValidate>
      <label>Nume<input value={f.title} maxLength={120} onChange={e=>set({title:e.target.value})} placeholder="Ex. Rezumat de știri" autoFocus/></label>
      <label>Instrucțiuni<textarea value={f.prompt} maxLength={8000} onChange={e=>set({prompt:e.target.value})} placeholder="Ce trebuie să facă AI Stoica? Ex. Caută știrile importante de azi și fă-mi un rezumat cu linkuri."/></label>
      <div className="taskFormGrid">
        <label>Frecvență<select value={f.frequency} onChange={e=>set({frequency:e.target.value})}>{FREQUENCIES.map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>
        {TIMED.includes(f.frequency)&&<label>Ora<input type="time" value={f.time} onChange={e=>set({time:e.target.value})}/></label>}
        {f.frequency==="interval"&&<label>La fiecare (ore)<input type="number" min="1" max="168" value={f.intervalHours} onChange={e=>set({intervalHours:Math.max(1,Math.min(168,Math.round(Number(e.target.value)||1)))})}/></label>}
        {f.frequency==="once"&&<label>Dată<input type="datetime-local" value={f.runAt} onChange={e=>set({runAt:e.target.value})}/></label>}
        {f.frequency==="weekly"&&<label>Ziua<select value={f.weekday} onChange={e=>set({weekday:Number(e.target.value)})}>{WEEK_ORDER.map(d=><option key={d} value={d}>{cap(DAY_NAMES[d])}</option>)}</select></label>}
        {f.frequency==="monthly"&&<label>Ziua din lună<input type="number" min="1" max="28" value={f.monthday} onChange={e=>set({monthday:Math.max(1,Math.min(28,Math.round(Number(e.target.value)||1)))})}/></label>}
        <label>Model<select value={f.model} onChange={e=>set({model:e.target.value})}><option value="">Modelul implicit</option>{modelOptions.map(m=><option key={m} value={m}>{m}</option>)}</select></label>
      </div>
      {f.frequency==="selected_days"&&<div className="dayPicker" role="group" aria-label="Zile">{WEEK_ORDER.map(d=><button type="button" key={d} aria-pressed={f.days.includes(d)} aria-label={DAY_NAMES[d]} className={f.days.includes(d)?"active":""} onClick={()=>toggleDay(d)}>{SHORT_DAYS[d]}</button>)}</div>}
      <p className="taskPreview"><Clock size={13}/> {humanSchedule(payloadFrom({...f,runAt:f.runAt||""}))}</p>
      <label className="checkRow"><input type="checkbox" checked={f.notify} onChange={e=>set({notify:e.target.checked})}/><span><b>Notifică-mă</b><small>Afișează o notificare desktop când sarcina are un rezultat.</small></span></label>
      <label className="checkRow"><input type="checkbox" checked={f.watch} onChange={e=>set({watch:e.target.checked})}/><span><b>Doar când se schimbă ceva</b><small>Pentru verificări (prețuri, anunțuri): nu notifică dacă rezultatul e la fel ca data trecută.</small></span></label>
      {error&&<div className="inlineError" role="alert">{error}</div>}
      <div className="modalActions"><button type="button" className="secondary" onClick={onClose}>Anulează</button><button className="primary" disabled={saving}>{saving?"Se salvează…":editing?"Salvează":"Creează sarcina"}</button></div>
    </form>
  </Modal>;
}

function RunHistory({task,runs}){
  const [open,setOpen]=useState(null);
  const list=runs?.data||(task.lastRunAt?[{id:"last",at:task.lastRunAt,status:task.lastStatus,model:task.model,result:task.lastResult}]:[]);
  if(runs?.loading&&!runs?.data)return <div className="emptyState small">Se încarcă istoricul…</div>;
  if(!list.length)return <div className="emptyState small"><Clock size={22}/>Sarcina nu a rulat încă. Apasă „Rulează acum” ca să vezi un rezultat.</div>;
  return <div className="runList">
    {runs?.error&&<div className="inlineError" role="alert">{runs.error}</div>}
    {list.map((r,i)=>{const key=r.id||i,isOpen=open===key;return <div className={cx("runItem",isOpen&&"open")} key={key}>
      <button className="runHead" aria-expanded={isOpen} onClick={()=>setOpen(isOpen?null:key)}><StatusPill status={r.status}/><span className="runWhen">{relativeDay(r.at)}</span><small className="runModel">{r.model||""}</small><ChevronDown size={16}/></button>
      {isOpen&&<div className="runResult assistantBody">{r.result?<Markdown text={r.result}/>:<p>Fără rezultat text.</p>}</div>}
    </div>})}
  </div>;
}

export function ScheduledPage({onClose,model,models}){
  const [items,setItems]=useState([]),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState("");
  const [openId,setOpenId]=useState(null),[form,setForm]=useState(null),[running,setRunning]=useState(null),[busy,setBusy]=useState(null),[runs,setRuns]=useState({});
  const mounted=useRef(true);
  useEffect(()=>()=>{mounted.current=false},[]);
  async function load(){
    try{const d=await api("/api/automations");if(mounted.current){setItems(d.data||[]);setLoadError("")}}
    catch(e){if(mounted.current)setLoadError(e.message)}
    finally{if(mounted.current)setLoading(false)}
  }
  async function loadRuns(id){
    setRuns(r=>({...r,[id]:{...(r[id]||{}),loading:true}}));
    try{const d=await api(`/api/automations/${id}/runs`);if(mounted.current)setRuns(r=>({...r,[id]:{data:Array.isArray(d.data)?d.data:[]}}))}
    catch(e){if(mounted.current)setRuns(r=>({...r,[id]:{data:null,error:e.status===404?"":e.message}}))}
  }
  useEffect(()=>{load();const id=setInterval(()=>{if(!document.hidden)load()},30000);return()=>clearInterval(id)},[]);
  useEffect(()=>{if(openId)loadRuns(openId)},[openId]);
  const selected=items.find(x=>x.id===openId)||null;
  useEffect(()=>{if(openId&&!loading&&!selected)setOpenId(null)},[openId,loading,selected]);
  async function toggle(x){
    if(busy)return;setBusy(x.id);
    try{await api(`/api/automations/${x.id}`,{method:"PATCH",body:JSON.stringify({enabled:!x.enabled,timeZone:localTimeZone()})});await load()}
    catch(e){toast(e.message)}
    finally{if(mounted.current)setBusy(null)}
  }
  async function run(x){
    if(running)return;setRunning(x.id);
    try{await api(`/api/automations/${x.id}/run`,{method:"POST",body:"{}"});toast(`„${x.title}” a rulat. Rezultatul apare în istoric.`,"ok")}
    catch(e){toast(`„${x.title}”: ${e.message}`)}
    finally{if(mounted.current){setRunning(null);await load();loadRuns(x.id)}}
  }
  async function duplicate(x){
    if(busy)return;setBusy(x.id);
    try{const d=await api(`/api/automations/${x.id}/duplicate`,{method:"POST",body:"{}"});await load();if(d.data?.id&&mounted.current)setOpenId(d.data.id);toast(`Am creat o copie oprită: „${d.data?.title||x.title+" (copie)"}”.`,"ok")}
    catch(e){toast(e.message)}
    finally{if(mounted.current)setBusy(null)}
  }
  async function remove(x){
    if(!confirm(`Ștergi sarcina „${x.title}”? Istoricul rulărilor se pierde.`))return;
    try{await api(`/api/automations/${x.id}`,{method:"DELETE"});if(mounted.current)setOpenId(null);await load()}catch(e){toast(e.message)}
  }
  async function save(payload){
    if(form.editing){
      await api(`/api/automations/${form.editing.id}`,{method:"PATCH",body:JSON.stringify(payload)});
      toast("Sarcina a fost actualizată.","ok");
    }else{
      const d=await api("/api/automations",{method:"POST",body:JSON.stringify({...payload,enabled:true})});
      toast(`Sarcina „${d.data?.title||payload.title}” a fost creată.`,"ok");
    }
    if(!mounted.current)return;
    const editedId=form.editing?.id;
    setForm(null);await load();
    if(editedId)loadRuns(editedId);
  }
  const newTask=(preset={})=>setForm({initial:{...blankForm(model||""),...preset},editing:null});
  const header=<button className="primary" onClick={()=>newTask()}><Plus size={16}/> Sarcină nouă</button>;
  return <ToolShell title="Scheduled" subtitle="Sarcini pe care AI Stoica le rulează singur, la ora aleasă." onClose={onClose} className="pageModal scheduledPage" actions={header}>
    <div className="pageBody">
      {loadError&&<div className="inlineError" role="alert">Nu am putut încărca sarcinile: {loadError} <button className="linkBtn" onClick={()=>{setLoading(true);load()}}>Reîncearcă</button></div>}
      {selected?<div className="taskDetail">
        <button className="backButton" onClick={()=>setOpenId(null)}><ArrowLeft size={16}/> Toate sarcinile</button>
        <div className="taskDetailHead">
          <span className="taskIcon big"><CalendarClock size={22}/></span>
          <div className="taskDetailTitle"><h3>{selected.title}</h3><p>{humanSchedule(selected)}{selected.enabled?` · următoarea: ${relativeDay(selected.nextRunAt)}`:" · oprită"}</p></div>
          <StatusPill status={selected.lastStatus} ran={!!selected.lastRunAt}/>
          <Switch checked={selected.enabled} disabled={busy===selected.id} label={`${selected.enabled?"Oprește":"Pornește"} ${selected.title}`} onChange={()=>toggle(selected)}/>
        </div>
        <div className="taskActions">
          <button className="primary" onClick={()=>run(selected)} disabled={!!running}>{running===selected.id?<RotateCcw size={15} className="spin"/>:<Play size={15}/>} {running===selected.id?"Rulează…":"Rulează acum"}</button>
          <button className="secondary" onClick={()=>setForm({initial:formFrom(selected),editing:selected})}><Pencil size={15}/> Editează</button>
          <button className="secondary" onClick={()=>duplicate(selected)} disabled={busy===selected.id}><Copy size={15}/> Duplică</button>
          <button className="dangerButton" onClick={()=>remove(selected)}><Trash2 size={15}/> Șterge</button>
        </div>
        <div className="taskInfoGrid">
          <div><span>Program</span><b>{humanSchedule(selected)}</b></div>
          <div><span>Următoarea rulare</span><b>{selected.enabled&&selected.nextRunAt?relativeDay(selected.nextRunAt):"—"}</b></div>
          <div><span>Model</span><b title={selected.model||""}>{selected.model||"Implicit"}</b></div>
          <div><span>Notificări</span><b>{selected.notify!==false?<><Bell size={13}/> Da</>:<><BellOff size={13}/> Nu</>}{selected.timingMode==="condition_watch"?" · doar la schimbări":""}</b></div>
        </div>
        <section className="taskSection"><h4>Instrucțiuni</h4><div className="taskPromptFull">{selected.prompt}</div></section>
        <section className="taskSection"><h4>Istoric rulări</h4><RunHistory task={selected} runs={runs[selected.id]}/></section>
      </div>:loading?<div className="emptyState small">Se încarcă sarcinile…</div>:!items.length?<div className="taskEmpty">
        <span className="taskIcon big"><CalendarClock size={26}/></span>
        <h3>Nicio sarcină programată încă</h3>
        <p>Scrie o dată ce vrei să facă AI Stoica și alege când. De exemplu: „În fiecare zi lucrătoare la 08:30, fă-mi un rezumat al știrilor din România.”</p>
        <div className="taskExamples">{EXAMPLES.map(({label,...preset})=><button key={label} className="secondary" onClick={()=>newTask(preset)}><Sparkles size={14}/> {label}</button>)}</div>
      </div>:<div className="taskList" role="list">
        {items.map(x=><div key={x.id} className={cx("taskRow",!x.enabled&&"off")} role="listitem">
          <button className="taskRowMain" onClick={()=>setOpenId(x.id)} title="Deschide sarcina">
            <span className="taskIcon"><CalendarClock size={18}/></span>
            <span className="taskText"><b>{x.title}</b><small className="taskPromptLine">{String(x.prompt||"").replace(/\s+/g," ")}</small><span className="taskMeta"><Clock size={12}/> {humanSchedule(x)} · {x.enabled?`următoarea: ${relativeDay(x.nextRunAt)}`:"oprită"}</span></span>
          </button>
          <StatusPill status={x.lastStatus} ran={!!x.lastRunAt}/>
          <Switch checked={x.enabled} disabled={busy===x.id} label={`${x.enabled?"Oprește":"Pornește"} ${x.title}`} onChange={()=>toggle(x)}/>
        </div>)}
      </div>}
    </div>
    {form&&<TaskForm initial={form.initial} editing={form.editing} models={models} onClose={()=>setForm(null)} onSave={save}/>}
  </ToolShell>;
}
