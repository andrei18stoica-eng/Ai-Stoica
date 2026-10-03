import React, { useEffect, useRef, useState } from "react";
import { Upload, Search, Eye, Download, Trash2, FileText, Film, Music, Palette, X, HardDrive, Play, MessageSquarePlus } from "lucide-react";
import { api, authedFetch, toast, cx, plural, formatBytes, shortDate, mediaKind, kindLabel, uploadFileToLibrary, downloadLibraryFile, useAccess, deniedMessage, useModal, useAuthedBlobUrl, useInView, ToolShell } from "../core.jsx";

export const LIBRARY_FILTERS=[["all","Toate"],["document","Documente"],["image","Poze"],["video","Video"],["audio","Audio"],["design","Design"]];
export const DESIGN_KINDS={site:"Site",landing:"Landing page",afis:"Afiș",prezentare:"Prezentare",card:"Card de vizită",meniu:"Meniu",cv:"CV",email:"Email",altceva:"Altceva"};
export function libraryCategory(x){if(x?.isDesign)return "design";const k=mediaKind(x.mime,x.name);return k==="image"||k==="audio"||k==="video"?k:"document";}
const TEXT_STATUS={pending:["Se citește textul…","pending"],ok:["Text citit pentru AI","ok"],empty:["Fără text citibil","warn"],too_large:["Prea mare pentru citire","warn"],error:["Textul nu a putut fi citit","warn"]};
const SORTS=[["new","Cele mai noi"],["name","Nume"],["size","Mărime"]];
function extOf(name){const m=String(name||"").match(/\.([a-z0-9]{1,6})$/i);return m?m[1].toUpperCase():"";}
function hasFiles(e){return [...(e.dataTransfer?.types||[])].includes("Files");}

function Thumb({x}){
  const cat=libraryCategory(x);
  const [ref,seen]=useInView();
  const {src}=useAuthedBlobUrl(cat==="image"&&seen&&!/heic|heif/i.test(`${x.mime} ${x.name}`)?`/api/library/${x.id}/content`:"");
  return <span ref={ref} className={cx("libThumbInner",cat)}>
    {src?<img src={src} alt="" loading="lazy"/>:cat==="video"?<><Film size={26}/><Play size={14} className="libPlayBadge"/></>:cat==="audio"?<Music size={26}/>:cat==="design"?<Palette size={26}/>:<><FileText size={26}/>{extOf(x.name)&&<em>{extOf(x.name)}</em>}</>}
  </span>;
}

function PreviewBody({item}){
  const cat=libraryCategory(item),kind=mediaKind(item.mime,item.name);
  const media=["image","video","audio"].includes(cat);
  const {src,failed}=useAuthedBlobUrl(media?`/api/library/${item.id}/content`:"");
  const [text,setText]=useState({loading:!media,value:"",note:""});
  useEffect(()=>{
    if(media)return;
    let active=true;
    (async()=>{
      try{
        if(kind==="text"){
          const r=await authedFetch(`/api/library/${item.id}/content`);const t=await r.text();
          if(active)setText({loading:false,value:t.slice(0,60000),note:t.length>60000?"Se afișează primele 60.000 de caractere.":""});
          return;
        }
        const d=(await api(`/api/library/${item.id}`)).data||{};
        const full=String(d.text||"");
        const pdf=/pdf/i.test(`${d.mime} ${d.name}`);
        const first=pdf&&full.includes("\f")?full.split("\f").find(p=>p.trim())||"":full.slice(0,pdf?3500:8000);
        const status=TEXT_STATUS[d.textStatus]?.[0];
        if(active)setText({loading:false,value:first,note:full?(pdf?"Prima pagină, ca text.":full.length>first.length?"Începutul documentului, ca text.":""):(status||"Acest tip de fișier nu are previzualizare. Îl poți descărca.")});
      }catch(e){if(active)setText({loading:false,value:"",note:e.message})}
    })();
    return()=>{active=false};
  },[item.id]);
  if(media){
    if(!src)return <div className="previewPlaceholder">{failed?"Previzualizarea nu este disponibilă.":"Se încarcă…"}</div>;
    if(cat==="image")return <img className="previewMedia" src={src} alt={item.name}/>;
    if(cat==="video")return <video className="previewMedia" src={src} controls preload="metadata"/>;
    return <audio className="previewAudio" src={src} controls preload="metadata"/>;
  }
  if(text.loading)return <div className="previewPlaceholder">Se încarcă textul…</div>;
  return <div className="previewText">{text.note&&<small>{text.note}</small>}{text.value&&<pre>{text.value}</pre>}</div>;
}

function PreviewDrawer({item,onClose,onAttach,attaching,onRemove}){
  const {ref,backdropProps}=useModal(onClose);
  return <div className="drawerBackdrop" {...backdropProps}>
    <aside className="previewDrawer" ref={ref} role="dialog" aria-modal="true" aria-label={`Previzualizare: ${item.name}`} tabIndex={-1}>
      <div className="drawerHead"><div><b title={item.name}>{item.name}</b><small>{kindLabel(mediaKind(item.mime,item.name),item.mime,item.name)} · {formatBytes(item.size)} · {shortDate(item.createdAt)}</small></div><button className="iconOnly" onClick={onClose} aria-label="Închide previzualizarea" title="Închide"><X size={18}/></button></div>
      <div className="drawerBody"><PreviewBody item={item}/></div>
      <div className="drawerActions">
        {onAttach&&<button className="primary" onClick={()=>onAttach(item)} disabled={!!attaching}><MessageSquarePlus size={15}/> {attaching===item.id?"Se pregătește…":"Folosește în chat"}</button>}
        <button className="secondary" onClick={()=>downloadLibraryFile({libraryId:item.id,name:item.name}).catch(e=>toast(e.message))}><Download size={15}/> Descarcă</button>
        <button className="dangerButton" onClick={()=>onRemove(item)}><Trash2 size={15}/> Șterge</button>
      </div>
    </aside>
  </div>;
}

export function LibraryPage({onClose,onAttach,toAttachment,initialFilter="all",onOpenDesign}){
  const {can,deny}=useAccess();
  const [items,setItems]=useState([]),[designs,setDesigns]=useState([]),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState("");
  const [uploading,setUploading]=useState(0),[attaching,setAttaching]=useState(null),[filter,setFilter]=useState(initialFilter),[query,setQuery]=useState(""),[sort,setSort]=useState("new"),[preview,setPreview]=useState(null),[dragOver,setDragOver]=useState(false);
  const input=useRef(null),mounted=useRef(true);
  useEffect(()=>()=>{mounted.current=false},[]);
  async function load(){
    try{
      const [d,ds]=await Promise.all([api("/api/library"),api("/api/designs").catch(()=>({data:[]}))]);
      if(!mounted.current)return;
      setItems(d.data||[]);setDesigns(Array.isArray(ds.data)?ds.data:[]);setLoadError("");
    }catch(e){if(mounted.current)setLoadError(e.message)}
    finally{if(mounted.current)setLoading(false)}
  }
  useEffect(()=>{load()},[]);
  const pending=items.some(x=>x.textStatus==="pending");
  useEffect(()=>{if(!pending)return;const t=setTimeout(load,4000);return()=>clearTimeout(t)},[pending,items]);
  const uploadLocked=!can("file_upload");
  async function upload(files){
    if(!files.length)return;
    if(uploadLocked){deny("file_upload");return;}
    setUploading(n=>n+files.length);
    const failed=[];
    for(const f of files){try{await uploadFileToLibrary(f)}catch(err){failed.push(`${f.name}: ${err.message}`)}finally{if(mounted.current)setUploading(n=>Math.max(0,n-1))}}
    if(failed.length)toast("Încărcare fișier: "+failed.join(" · "));
    else toast(files.length===1?"Fișierul a fost adăugat în Bibliotecă.":`${plural(files.length,"fișier","fișiere")} adăugate în Bibliotecă.`,"ok");
    if(mounted.current)await load();
  }
  async function remove(x){
    if(!confirm(`Ștergi „${x.name}” din Bibliotecă? Fișierul nu va mai putea fi descărcat nici din conversațiile în care a fost folosit.`))return;
    try{await api(`/api/library/${x.id}`,{method:"DELETE"});if(mounted.current)setPreview(p=>p?.id===x.id?null:p);await load()}catch(e){toast("Ștergere: "+e.message)}
  }
  async function attach(x){
    if(attaching||!onAttach)return;
    setAttaching(x.id);
    try{const a=await toAttachment(x);onAttach(a);onClose()}
    catch(e){toast("Atașare: "+e.message)}
    finally{if(mounted.current)setAttaching(null)}
  }
  const designEntries=designs.map(d=>({...d,isDesign:true,name:d.title||"Design fără titlu",size:0,createdAt:d.updatedAt||d.createdAt}));
  const all=[...items,...designEntries];
  const q=query.trim().toLowerCase();
  const visible=all.filter(x=>(filter==="all"||libraryCategory(x)===filter)&&(!q||String(x.name||"").toLowerCase().includes(q)||(x.isDesign&&String(x.prompt||"").toLowerCase().includes(q))))
    .sort((a,b)=>sort==="name"?String(a.name).localeCompare(String(b.name),"ro",{sensitivity:"base"}):sort==="size"?Number(b.size||0)-Number(a.size||0):Number(b.createdAt||0)-Number(a.createdAt||0));
  const counts=Object.fromEntries(LIBRARY_FILTERS.map(([k])=>[k,k==="all"?all.length:all.filter(x=>libraryCategory(x)===k).length]));
  const dropProps={
    onDragOver:e=>{if(!hasFiles(e))return;e.preventDefault();e.dataTransfer.dropEffect=uploadLocked?"none":"copy";setDragOver(true)},
    onDragLeave:e=>{if(!e.currentTarget.contains(e.relatedTarget))setDragOver(false)},
    onDrop:e=>{if(!hasFiles(e))return;e.preventDefault();setDragOver(false);upload([...(e.dataTransfer.files||[])])}
  };
  const header=<><button className={cx("primary",uploadLocked&&"locked")} onClick={()=>uploadLocked?deny("file_upload"):input.current?.click()} title={uploadLocked?deniedMessage("file_upload"):"Maxim 2 GB per fișier"}><Upload size={16}/> {uploading?"Se încarcă…":"Adaugă fișiere"}</button><input ref={input} type="file" multiple hidden onChange={e=>{const f=[...(e.target.files||[])];e.target.value="";upload(f)}}/></>;
  return <ToolShell title="Bibliotecă" subtitle="Fișierele, pozele, videoclipurile și designurile tale, gata de folosit în conversații." onClose={onClose} className="pageModal libraryPage" actions={header}>
    <div className="libraryToolbar">
      <div className="chipRow" role="tablist" aria-label="Filtre Bibliotecă">{LIBRARY_FILTERS.map(([k,label])=><button key={k} role="tab" aria-selected={filter===k} className={cx("filterChip",filter===k&&"active")} onClick={()=>setFilter(k)}>{label}{counts[k]>0&&<small>{counts[k]}</small>}</button>)}</div>
      <div className="libraryTools">
        <div className="pageSearch"><Search size={15}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Caută după nume" aria-label="Caută în Bibliotecă"/></div>
        <label className="sortSelect"><span>Sortează</span><select value={sort} onChange={e=>setSort(e.target.value)} aria-label="Sortează">{SORTS.map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>
      </div>
    </div>
    <div className={cx("pageBody libraryBody",dragOver&&"dragOver")} {...dropProps}>
      {dragOver&&<div className="dropOverlay">{uploadLocked?deniedMessage("file_upload"):"Eliberează pentru a adăuga fișierele în Bibliotecă"}</div>}
      {loadError&&<div className="inlineError" role="alert">{loadError} <button className="linkBtn" onClick={()=>{setLoading(true);load()}}>Reîncearcă</button></div>}
      {uploading>0&&<div className="toolStatus" role="status">Se încarcă {plural(uploading,"fișier","fișiere")}… pentru fișiere mari poate dura.</div>}
      {loading?<div className="emptyState"><HardDrive size={30}/>Se încarcă biblioteca…</div>:!visible.length?<div className="emptyState"><HardDrive size={30}/>{all.length?"Niciun fișier nu corespunde filtrului.":<span>Biblioteca este goală. Trage fișiere aici sau apasă „Adaugă fișiere”.</span>}</div>:
      <div className="libGrid">{visible.map(x=>{
        if(x.isDesign)return <div className="libCard design" key={"d"+x.id}>
          <button className="libThumb" onClick={()=>onOpenDesign?.(x.id)} aria-label={`Deschide designul ${x.name}`}><Thumb x={x}/></button>
          <div className="libInfo"><b title={x.name}>{x.name}</b><small>Design · {DESIGN_KINDS[x.kind]||"Design"} · {plural(x.versionCount||1,"versiune","versiuni")} · {shortDate(x.createdAt)}</small></div>
          <div className="libActions"><button className="smallBtn" onClick={()=>onOpenDesign?.(x.id)}><Palette size={13}/> Deschide în Design</button></div>
        </div>;
        const status=libraryCategory(x)==="document"&&TEXT_STATUS[x.textStatus];
        return <div className="libCard" key={x.id}>
          <button className="libThumb" onClick={()=>setPreview(x)} aria-label={`Deschide previzualizarea pentru ${x.name}`}><Thumb x={x}/></button>
          <div className="libInfo"><b title={x.name}>{x.name}</b><small>{kindLabel(mediaKind(x.mime,x.name),x.mime,x.name)} · {formatBytes(x.size)} · {shortDate(x.createdAt)}</small>{status&&<span className={cx("textStatus",status[1])}>{status[0]}</span>}</div>
          <div className="libActions">
            {onAttach&&<button className="smallBtn" onClick={()=>attach(x)} disabled={!!attaching}>{attaching===x.id?"Se pregătește…":"Folosește în chat"}</button>}
            <button className="iconOnly smallIcon" onClick={()=>setPreview(x)} aria-label={`Previzualizează ${x.name}`} title="Previzualizează"><Eye size={16}/></button>
            <button className="iconOnly smallIcon" onClick={()=>downloadLibraryFile({libraryId:x.id,name:x.name}).catch(e=>toast(e.message))} aria-label={`Descarcă ${x.name}`} title="Descarcă"><Download size={16}/></button>
            <button className="iconDanger" onClick={()=>remove(x)} aria-label={`Șterge ${x.name}`} title="Șterge"><Trash2 size={16}/></button>
          </div>
        </div>;
      })}</div>}
    </div>
    {preview&&<PreviewDrawer item={preview} onClose={()=>setPreview(null)} onAttach={onAttach?attach:null} attaching={attaching} onRemove={remove}/>}
  </ToolShell>;
}
