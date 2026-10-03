import React, { useEffect, useRef, useState } from "react";
import { Plus, Search, Check, Play, Pencil, Trash2, ExternalLink, Plug, Puzzle, Lock, X } from "lucide-react";
import { api, toast, cx, isHttpUrl, openLink, useAccess, deniedMessage, useModal, ToolShell, Switch, GATEWAY, OAUTH_REDIRECT_PATH } from "../core.jsx";

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
  {name:"Scheduled",description:"Rulează sarcini programate și verificări la ora aleasă.",mark:"S",perm:"automations"}
];
function pluginHasIntegration(x){return !!(PLUGIN_APP_LINKS[x.name]||PLUGIN_OAUTH[x.name]);}

function SetupOverlay({onClose,children}) {
  const {ref,backdropProps}=useModal(onClose);
  return <div className="claudeSetupBackdrop" {...backdropProps}><div className="claudeSetupPanel" ref={ref} role="dialog" aria-modal="true" aria-label="Configurare plugin" tabIndex={-1}>{children}</div></div>;
}
function ResultNote({result}){return result?<div className={cx("pluginResult claudeResult",result.kind)} role={result.kind==="error"?"alert":"status"}>{result.text}</div>:null;}

const BLANK_PLUGIN={name:"",description:"",url:"",method:"POST",auth:"none",headerName:"X-API-Key",apiKey:"",auto:false,trigger:"",oauthClientId:"",oauthClientSecret:""};
function initials(name){return String(name||"P").replace(/[^\p{L}\p{N} ]/gu,"").split(/\s+/).filter(Boolean).map(w=>w[0]).join("").slice(0,2).toUpperCase()||"P";}
function hostOf(url){try{return new URL(url).host}catch{return ""}}
export function pluginTriggerHint(name,trigger){
  const n=String(name||"").trim(),t=trigger||("@"+n.toLowerCase().replace(/\s+/g,"-"));
  return n.length>=3?`Se folosește când scrii «${n}» sau ${t}`:`Se folosește când scrii ${t}`;
}
function PluginLogo({entry,large=false}){
  const [failed,setFailed]=useState(false);
  const src=entry?.slug&&!failed?`https://cdn.simpleicons.org/${entry.slug}`:null;
  return <span className={cx("pluginLogo",large&&"large")}>{src?<img src={src} alt="" onError={()=>setFailed(true)}/>:<span>{entry?.mark||initials(entry?.name)}</span>}</span>;
}

function PluginForm({initial,editing,onSaved,onCancel}){
  const [f,setF]=useState(initial),[note,setNote]=useState(null),[busy,setBusy]=useState("");
  const mounted=useRef(true),urlRef=useRef(null);
  useEffect(()=>()=>{mounted.current=false},[]);
  useEffect(()=>{setF(initial);setNote(null);if(initial.name&&!initial.url)setTimeout(()=>urlRef.current?.focus(),0)},[initial]);
  const set=patch=>setF(v=>({...v,...patch}));
  const direct=editing?.mode==="direct_app",oauth=!!editing?.oauthConnected;
  function problem(){
    if(!f.name.trim())return "Scrie un nume pentru plugin.";
    if(!isHttpUrl(f.url))return "Adresa API trebuie să fie un link complet, de exemplu https://exemplu.ro/webhook.";
    if(f.auth==="header"&&!/^[A-Za-z0-9-]{1,64}$/.test(f.headerName.trim()))return "Numele antetului poate conține doar litere, cifre și cratimă.";
    if(f.auth!=="none"&&!f.apiKey.trim()&&!editing?.hasKey)return "Adaugă cheia sau alege „Fără” la autentificare.";
    return "";
  }
  function body(){
    const out={name:f.name.trim(),description:f.description.trim(),url:f.url.trim(),auto:!!f.auto};
    if(!direct){out.method=f.method;}
    if(!direct&&!oauth){
      out.authType=f.auth==="header"?"header":"bearer";
      if(f.auth==="header")out.headerName=f.headerName.trim();
      if(f.auth==="none"&&editing?.hasKey)out.apiKey="__CLEAR__";
      else if(f.auth!=="none"&&f.apiKey.trim())out.apiKey=f.apiKey.trim();
    }
    return out;
  }
  async function persist(){
    const d=editing?await api(`/api/plugins/${editing.id}`,{method:"PATCH",body:JSON.stringify(body())}):await api("/api/plugins",{method:"POST",body:JSON.stringify(body())});
    return d.data;
  }
  async function save(e){
    e?.preventDefault?.();
    if(busy)return;
    const p=problem();if(p){setNote({kind:"error",text:p});return;}
    setBusy("save");setNote(null);
    try{const saved=await persist();onSaved(saved,{kind:"ok",text:`${saved?.name||f.name.trim()}: pluginul a fost salvat.`},true)}
    catch(err){if(mounted.current)setNote({kind:"error",text:err.message})}
    finally{if(mounted.current)setBusy("")}
  }
  async function test(){
    if(busy)return;
    const p=problem();if(p){setNote({kind:"error",text:p});return;}
    setBusy("test");setNote({kind:"info",text:"Salvez pluginul și îl testez…"});
    try{
      const saved=await persist();
      onSaved(saved,null,false);
      try{const d=await api(`/api/plugins/${saved.id}/test`,{method:"POST",body:JSON.stringify({message:"Test conexiune AI Stoica"})});if(mounted.current)setNote({kind:"ok",text:`Test reușit: ${String(d.result||"conexiune reușită").slice(0,600)}`})}
      catch(err){if(mounted.current)setNote({kind:"error",text:`Pluginul a fost salvat, dar testul a eșuat: ${err.message}`})}
    }catch(err){if(mounted.current)setNote({kind:"error",text:err.message})}
    finally{if(mounted.current)setBusy("")}
  }
  return <form className="pluginCreateForm" onSubmit={save} noValidate>
    <div className="pluginCreateIntro"><Puzzle size={20}/><div><b>{editing?`Editează „${editing.name}”`:"Creează un plugin"}</b><span>Conectează orice API sau webhook. {pluginTriggerHint(f.name||"Nume",f.trigger||undefined)}.</span></div></div>
    <div className="pluginFormGrid">
      <label>Nume<input value={f.name} maxLength={80} onChange={e=>set({name:e.target.value})} placeholder="Ex. Meteo"/></label>
      <label>Descriere<input value={f.description} maxLength={500} onChange={e=>set({description:e.target.value})} placeholder="Ce face pluginul"/></label>
    </div>
    <label>Adresă API<input ref={urlRef} value={f.url} onChange={e=>set({url:e.target.value})} inputMode="url" placeholder="https://api.exemplu.ro/date"/></label>
    {!direct&&<div className="pluginFormGrid">
      <label>Metodă<select value={f.method} onChange={e=>set({method:e.target.value})}><option value="GET">GET</option><option value="POST">POST</option>{!["GET","POST"].includes(f.method)&&<option value={f.method}>{f.method}</option>}</select></label>
      {!oauth&&<label>Autentificare<select value={f.auth} onChange={e=>set({auth:e.target.value})}><option value="none">Fără</option><option value="bearer">Bearer token</option><option value="header">Antet personalizat</option></select></label>}
    </div>}
    {!direct&&!oauth&&f.auth!=="none"&&<div className="pluginFormGrid">
      {f.auth==="header"&&<label>Nume antet<input value={f.headerName} onChange={e=>set({headerName:e.target.value})} placeholder="X-API-Key"/></label>}
      <label>Cheie API<input type="password" value={f.apiKey} onChange={e=>set({apiKey:e.target.value})} placeholder={editing?.hasKey?"Cheie salvată — lasă gol pentru a o păstra":"Cheie / token"} autoComplete="off"/></label>
    </div>}
    <label className="checkRow"><input type="checkbox" checked={f.auto} onChange={e=>set({auto:e.target.checked})}/><span><b>Folosește-l automat când e relevant</b><small>Altfel pornește doar când îi scrii numele sau @trigger-ul în chat.</small></span></label>
    {note&&<ResultNote result={note}/>}
    <div className="pluginFormActions">
      {editing&&<button type="button" className="secondary" onClick={onCancel}>Anulează</button>}
      <button type="button" className="secondary" onClick={test} disabled={!!busy}><Play size={14}/> {busy==="test"?"Se testează…":"Testează"}</button>
      <button className="primary" disabled={!!busy}><Check size={15}/> {busy==="save"?"Se salvează…":"Salvează"}</button>
    </div>
  </form>;
}

function CatalogSetup({selected,onClose,onDone,reload}){
  const [form,setForm]=useState({...BLANK_PLUGIN,name:selected.name,description:selected.description,trigger:selected.trigger}),[setupResult,setSetupResult]=useState(null),[saving,setSaving]=useState(""),[redirectUri,setRedirectUri]=useState("");
  const oauthTimer=useRef(null),mounted=useRef(true);
  useEffect(()=>()=>{mounted.current=false;clearInterval(oauthTimer.current)},[]);
  async function addApi(e){
    e?.preventDefault?.();
    if(saving)return;
    if(!form.name.trim()){setSetupResult({kind:"error",text:"Scrie un nume pentru plugin."});return;}
    if(!isHttpUrl(form.url)){setSetupResult({kind:"error",text:"Adresa API trebuie să fie un link complet, de exemplu https://exemplu.ro/webhook."});return;}
    setSaving("api");setSetupResult(null);
    try{
      await api("/api/plugins",{method:"POST",body:JSON.stringify({name:form.name.trim(),description:form.description,url:form.url.trim(),method:form.method,trigger:form.trigger,auto:form.auto,...(form.apiKey.trim()?{apiKey:form.apiKey.trim()}:{})})});
      onDone({kind:"ok",text:`${form.name.trim()}: pluginul a fost conectat.`});
    }catch(err){if(mounted.current)setSetupResult({kind:"error",text:err.message})}
    finally{if(mounted.current)setSaving("")}
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
          const fresh=await reload();
          const connected=fresh.find(x=>String(x.name).toLowerCase()===name&&x.oauthConnected);
          if(connected||Date.now()-started>120000){
            clearInterval(oauthTimer.current);oauthTimer.current=null;
            if(!mounted.current)return;
            if(connected)onDone({kind:"ok",text:`${connected.name}: conectat cu succes.`});
            else setSetupResult({kind:"error",text:"Autorizarea nu a fost finalizată în 2 minute. Încearcă din nou."});
          }
        }catch{}
      },2000);
    }catch(e){if(mounted.current)setSetupResult({kind:"error",text:`Eroare OAuth — ${e.message}`})}
    finally{if(mounted.current)setSaving("")}
  }
  async function openProviderApp(){
    const url=selected?.appUrl;
    if(!url||saving)return;
    setSaving("direct");
    try{
      await api("/api/plugins/direct",{method:"POST",body:JSON.stringify({name:selected.name,description:selected.description,trigger:selected.trigger,appUrl:url})});
      const r=await window.AIStoica?.openExternal?.(url);
      if(r&&!r.ok)throw new Error(r.error||"Nu am putut deschide aplicația.");
      onDone({kind:"ok",text:`${selected.name}: salvat pentru deschidere directă, fără OAuth. Autentifică-te normal în aplicația oficială.`});
    }catch(e){if(mounted.current)setSetupResult({kind:"error",text:e.message})}
    finally{if(mounted.current)setSaving("")}
  }
  const redirectShown=redirectUri||`${String(GATEWAY).replace(/\/+$/,"")}${OAUTH_REDIRECT_PATH}`;
  return <SetupOverlay onClose={onClose}>
    <div className="claudeSetupHead">
      <PluginLogo entry={selected} large/>
      <div><h3>{selected.name}</h3><p>{selected.description}</p></div>
      <button className="iconOnly" onClick={onClose} aria-label="Închide" title="Închide"><X size={18}/></button>
    </div>
    <ResultNote result={setupResult}/>
    <div className="claudeSetupNotice"><Plug size={16}/><span>Poți folosi pluginul fără OAuth pentru deschiderea directă a aplicației. OAuth/API este necesar doar când vrei ca AI Stoica să citească sau să modifice date private din acel serviciu.</span></div>
    {selected.appUrl&&<div className="pluginDirectConnect">
      <button className="primary" onClick={openProviderApp} disabled={!!saving}><ExternalLink size={16}/> {saving==="direct"?"Se deschide…":`Conectează fără OAuth și deschide ${selected.name}`}</button>
      <small>AI Stoica salvează pluginul ca legătură directă și deschide aplicația oficială. Te autentifici normal în browser.</small>
    </div>}
    <form className="claudeSetupForm" onSubmit={addApi}>
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
      <div className="claudeSetupActions"><button type="button" className="secondary" onClick={onClose}>Anulează</button><button className="primary" disabled={!form.name.trim()||!form.url.trim()||!!saving}>{saving==="api"?"Se conectează…":"Conectează API personalizat"}</button></div>
    </form>
  </SetupOverlay>;
}

export function PluginsPage({onClose}){
  const {can}=useAccess();
  const [items,setItems]=useState([]),[loading,setLoading]=useState(true),[tab,setTab]=useState(null),[result,setResult]=useState(null);
  const [query,setQuery]=useState(""),[selected,setSelected]=useState(null),[testing,setTesting]=useState(null),[cardNotes,setCardNotes]=useState({});
  const [formInit,setFormInit]=useState(BLANK_PLUGIN),[editing,setEditing]=useState(null);
  const mounted=useRef(true);
  useEffect(()=>()=>{mounted.current=false},[]);
  async function load(){
    try{const d=await api("/api/plugins");const list=d.data||[];if(mounted.current){setItems(list);setTab(t=>t||(list.length?"installed":"directory"))}return list}
    catch(e){if(mounted.current){setResult({kind:"error",text:"Nu am putut încărca pluginurile: "+e.message});setTab(t=>t||"directory")}return []}
    finally{if(mounted.current)setLoading(false)}
  }
  useEffect(()=>{load()},[]);
  async function patch(x,p){try{await api(`/api/plugins/${x.id}`,{method:"PATCH",body:JSON.stringify(p)});await load()}catch(e){toast(e.message)}}
  async function test(x){
    if(testing)return;
    if(x.mode==="direct_app"&&(x.appUrl||x.url)){
      const r=await window.AIStoica?.openExternal?.(x.appUrl||x.url);
      if(!window.AIStoica?.openExternal)openLink(x.appUrl||x.url);
      setCardNotes(n=>({...n,[x.id]:r&&!r.ok?{kind:"error",text:`Nu am putut deschide aplicația — ${r.error||"eroare"}`}:{kind:"ok",text:"Aplicația a fost deschisă."}}));
      return;
    }
    setTesting(x.id);
    try{const d=await api(`/api/plugins/${x.id}/test`,{method:"POST",body:JSON.stringify({message:"Test conexiune AI Stoica"})});if(mounted.current)setCardNotes(n=>({...n,[x.id]:{kind:"ok",text:`Funcționează: ${String(d.result||"conexiune reușită").slice(0,300)}`}}))}
    catch(e){if(mounted.current)setCardNotes(n=>({...n,[x.id]:{kind:"error",text:`Eroare — ${e.message}`}}))}
    finally{if(mounted.current)setTesting(null)}
  }
  async function remove(x){
    if(!confirm(`Ștergi pluginul „${x.name}”?`))return;
    try{await api(`/api/plugins/${x.id}`,{method:"DELETE"});if(editing?.id===x.id){setEditing(null);setFormInit(BLANK_PLUGIN)}await load()}catch(e){toast(e.message)}
  }
  function edit(x){
    setEditing(x);
    setFormInit({...BLANK_PLUGIN,name:x.name||"",description:x.description||"",url:x.appUrl||x.url||"",method:x.method||"POST",auth:x.hasKey?(x.authType==="header"?"header":"bearer"):"none",headerName:x.headerName||"X-API-Key",auto:!!x.auto,trigger:x.trigger||""});
    setResult(null);setTab("create");
  }
  function addFromCatalog(x){
    setResult(null);
    if(pluginHasIntegration(x)){setSelected({...x,appUrl:PLUGIN_APP_LINKS[x.name]||"",oauth:PLUGIN_OAUTH[x.name]||null});return;}
    setEditing(null);setFormInit({...BLANK_PLUGIN,name:x.name,description:x.description,trigger:x.trigger});setTab("create");
  }
  function onSaved(saved,note,leave){
    load();
    if(leave){setEditing(null);setFormInit(BLANK_PLUGIN);setResult(note);setTab("installed");}
    else if(saved&&!editing)setEditing(saved);
  }
  const installedNames=new Set(items.map(x=>String(x.name||"").toLowerCase()));
  const normalized=query.trim().toLowerCase();
  const filtered=PLUGIN_CATALOG.filter(x=>!normalized||x.name.toLowerCase().includes(normalized)||x.description.toLowerCase().includes(normalized)||x.group.toLowerCase().includes(normalized));
  const groups=PLUGIN_GROUPS.map(group=>({group,items:filtered.filter(x=>x.group===group)})).filter(x=>x.items.length);
  const skills=SKILLS.filter(x=>!normalized||x.name.toLowerCase().includes(normalized)||x.description.toLowerCase().includes(normalized));
  const tabs=[["installed",`Instalate${items.length?` (${items.length})`:""}`],["directory","Director"],["create",editing?"Editează plugin":"Creează plugin"]];
  return <ToolShell title="Pluginuri" subtitle="Scrie numele unui plugin în chat (de ex. «Calendar») sau @nume și AI Stoica îl folosește pentru răspuns." onClose={onClose} className="pageModal pluginsPage">
    <div className="pageTabs" role="tablist" aria-label="Secțiuni pluginuri">
      {tabs.map(([k,label])=><button key={k} role="tab" aria-selected={tab===k} className={cx("pageTab",tab===k&&"active")} onClick={()=>{setTab(k);if(k==="create"&&editing&&tab!=="create"){setEditing(null);setFormInit(BLANK_PLUGIN)}}}>{label}</button>)}
    </div>
    <div className="pageBody" role="tabpanel">
      <ResultNote result={result}/>
      {tab==="installed"&&(loading?<div className="emptyState small">Se încarcă pluginurile…</div>:!items.length?<div className="taskEmpty">
        <span className="taskIcon big"><Puzzle size={26}/></span><h3>Nu ai pluginuri instalate</h3><p>Alege unul din Director sau creează-l pe al tău dintr-un API. După instalare, scrie-i numele în chat și AI Stoica îl folosește.</p>
        <div className="taskExamples"><button className="primary" onClick={()=>setTab("directory")}>Deschide Directorul</button><button className="secondary" onClick={()=>setTab("create")}><Plus size={14}/> Creează plugin</button></div>
      </div>:<div className="plugCards">
        {items.map(x=><div key={x.id} className={cx("plugCard",!x.enabled&&"off")}>
          <div className="plugCardTop"><PluginLogo entry={PLUGIN_CATALOG.find(c=>c.name.toLowerCase()===String(x.name||"").toLowerCase())||{name:x.name}}/><div className="plugCardText"><b title={x.name}>{x.name}</b><small>{x.description||hostOf(x.appUrl||x.url)}</small></div><Switch checked={x.enabled} label={`${x.enabled?"Dezactivează":"Activează"} ${x.name}`} onChange={()=>patch(x,{enabled:!x.enabled})}/></div>
          <p className="pluginTrigger">{pluginTriggerHint(x.name,x.trigger)}</p>
          <small className="pluginMeta">{x.mode==="direct_app"?"Deschidere directă a aplicației":x.oauthConnected?"Conectat prin OAuth":`API · ${x.method||"POST"}${x.hasKey?" · cu cheie":""}`}{x.auto?" · automat":""}</small>
          {cardNotes[x.id]&&<ResultNote result={cardNotes[x.id]}/>}
          <div className="plugCardActions">
            <button className="smallBtn" onClick={()=>test(x)} disabled={testing===x.id}>{x.mode==="direct_app"?<><ExternalLink size={13}/> Deschide</>:<><Play size={13}/> {testing===x.id?"Se testează…":"Testează"}</>}</button>
            <button className="smallBtn" onClick={()=>edit(x)}><Pencil size={13}/> Editează</button>
            <button className="smallBtn dangerSmall" onClick={()=>remove(x)} aria-label={`Șterge ${x.name}`}><Trash2 size={13}/> Șterge</button>
          </div>
        </div>)}
      </div>)}
      {tab==="directory"&&<div className="pluginDirectory">
        <div className="pageSearch"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Caută în Director (nume, categorie)" aria-label="Caută pluginuri"/></div>
        {groups.map(({group,items:groupItems})=><section className="catalogSection" key={group}>
          <h3>{group}</h3>
          <div className="catalogGrid">
            {groupItems.map(x=>{const installed=installedNames.has(x.name.toLowerCase());return <div className="catalogCard" key={x.group+x.name}>
              <PluginLogo entry={x}/>
              <div className="catalogText"><b>{x.name}</b><small>{x.description}{!pluginHasIntegration(x)&&<em className="apiOnlyTag"> · doar prin API</em>}</small></div>
              {installed?<button className="smallBtn installed" onClick={()=>setTab("installed")} aria-label={`${x.name} este instalat`}><Check size={13}/> Instalat</button>
                :<button className="smallBtn addBtn" onClick={()=>addFromCatalog(x)} aria-label={`Adaugă ${x.name}`}><Plus size={13}/> Adaugă</button>}
            </div>})}
          </div>
        </section>)}
        {!groups.length&&<div className="emptyState small">Nu am găsit pluginul căutat. Îl poți crea din tabul „Creează plugin”.</div>}
        {skills.length>0&&<section className="catalogSection"><h3>Incluse în AI Stoica</h3><div className="catalogGrid">
          {skills.map(x=>{const ok=can(x.perm);return <div className={cx("catalogCard",!ok&&"locked")} key={x.name} title={ok?"Disponibilă pentru contul tău":deniedMessage(x.perm)}>
            <span className="pluginLogo"><span>{x.mark}</span></span>
            <div className="catalogText"><b>{x.name}</b><small>{ok?x.description:"Dezactivată de Owner pentru contul tău."}</small></div>
            {ok?<Check size={16} className="okIcon" aria-label="Disponibilă"/>:<Lock size={15} aria-label="Dezactivată"/>}
          </div>})}
        </div></section>}
      </div>}
      {tab==="create"&&<PluginForm initial={formInit} editing={editing} onSaved={onSaved} onCancel={()=>{setEditing(null);setFormInit(BLANK_PLUGIN);setTab("installed")}}/>}
    </div>
    {selected&&<CatalogSetup selected={selected} reload={load} onClose={()=>setSelected(null)} onDone={note=>{setSelected(null);setResult(note);load();setTab("installed")}}/>}
  </ToolShell>;
}
