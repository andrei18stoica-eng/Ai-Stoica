import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, Pressable, ScrollView, StyleSheet, ActivityIndicator, Modal, Alert, KeyboardAvoidingView, AppState, RefreshControl, Image } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { StatusBar } from "expo-status-bar";
import * as DocumentPicker from "expo-document-picker";
import * as Clipboard from "expo-clipboard";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

const GATEWAY=(process.env.EXPO_PUBLIC_GATEWAY_URL||"").trim().replace(/\/+$/,"");
const DEFAULT_MODEL=process.env.EXPO_PUBLIC_DEFAULT_MODEL||"AI Stoica Performance Max";
const TOKEN_KEY="aiStoicaMobileTokenV4";
const API_TIMEOUT=30000,CHAT_TIMEOUT=180000;
const EXPORT_FORMATS=[["pdf","PDF"],["docx","DOCX"],["pptx","PPTX"]];
const STATUS_LABELS={pending:"În așteptare",active:"Activ",rejected:"Respins",suspended:"Suspendat",blocked:"Blocat"};

function gatewayProblem(){
  if(!GATEWAY)return "Adresa serverului AI Stoica lipsește din build (EXPO_PUBLIC_GATEWAY_URL).";
  if(/SUBDOMENIUL-TAU|example\.com/i.test(GATEWAY))return "Adresa serverului din eas.json este încă cea de exemplu. Înlocuiește EXPO_PUBLIC_GATEWAY_URL și refă build-ul.";
  return "";
}
function sessionLost(status,message){return status===401||(status===403&&/Contul nu este activ|așteaptă aprobarea/i.test(String(message||"")));}

let onSessionLost=null;
function request(method,path,{token,body,timeout=API_TIMEOUT}={}){
  return new Promise((resolve,reject)=>{
    const problem=gatewayProblem();if(problem)return reject(new Error(problem));
    const x=new XMLHttpRequest();
    x.open(method,GATEWAY+path);
    x.timeout=timeout;
    if(token)x.setRequestHeader("Authorization",`Bearer ${token}`);
    if(body!==undefined)x.setRequestHeader("Content-Type","application/json");
    x.onload=()=>resolve(x);
    x.onerror=()=>reject(new Error("Nu mă pot conecta la server. Verifică internetul."));
    x.ontimeout=()=>reject(new Error("Serverul nu a răspuns la timp. Încearcă din nou."));
    x.send(body===undefined?null:JSON.stringify(body));
  });
}
async function api(path,token,{method="GET",body,timeout,silent=false}={}){
  const x=await request(method,path,{token,body,timeout});
  let d=null;try{d=x.responseText?JSON.parse(x.responseText):{}}catch{}
  if(x.status>=200&&x.status<300&&d)return d;
  const err=new Error(d?.error||(x.status>=200&&x.status<300?"Răspuns invalid de la server.":`Serverul a răspuns cu eroarea HTTP ${x.status}.`));
  err.status=x.status;
  if(token&&!silent&&sessionLost(x.status,err.message)&&onSessionLost){err.sessionLost=true;onSessionLost(err.message)}
  throw err;
}
function showError(title,e){if(!e?.sessionLost)Alert.alert(title,e?.message||"A apărut o eroare.")}
function contentText(m){
  if(typeof m.displayText==="string"&&m.displayText)return m.displayText;
  if(typeof m.content==="string")return m.content;
  if(Array.isArray(m.content))return m.content.filter(x=>x?.type==="text").map(x=>String(x.text||"")).join("\n")||"[Imagine]";
  return "[Conținut]";
}
function fileRef(a){return {id:a.id||a.libraryId,name:a.name||"fișier",mimeType:a.mimeType||a.mime||""}}

function inlineParts(text){
  return String(text).split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g).map((p,i)=>
    p.length>4&&p.startsWith("**")&&p.endsWith("**")?<Text key={i} style={s.bold}>{p.slice(2,-2)}</Text>:
    p.length>2&&p.startsWith("`")&&p.endsWith("`")?<Text key={i} style={s.inlineCode}>{p.slice(1,-1)}</Text>:p);
}
function MessageText({text}){
  const blocks=String(text||"").split(/```[^\n]*\n?/);
  return <View>{blocks.map((block,i)=>i%2
    ?<ScrollView key={i} horizontal style={s.codeBlock}><Text selectable style={s.codeText}>{block.replace(/\n$/,"")}</Text></ScrollView>
    :block.split("\n").map((line,j)=>{
      const heading=line.match(/^#{1,6}\s+(.*)$/),bullet=line.match(/^\s*[-*]\s+(.*)$/);
      if(heading)return <Text key={i+"-"+j} selectable style={[s.msgText,s.heading]}>{inlineParts(heading[1])}</Text>;
      if(bullet)return <Text key={i+"-"+j} selectable style={s.msgText}>{"• "}{inlineParts(bullet[1])}</Text>;
      return <Text key={i+"-"+j} selectable style={s.msgText}>{inlineParts(line)}</Text>;
    }))}</View>;
}

function Auth({onAuth,initialNotice}){
  const insets=useSafeAreaInsets();
  const[mode,setMode]=useState("login"),[name,setName]=useState(""),[email,setEmail]=useState(""),[password,setPassword]=useState(""),[setupCode,setSetupCode]=useState("");
  const[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState(initialNotice||"");
  useEffect(()=>{if(initialNotice)setNotice(initialNotice)},[initialNotice]);
  async function submit(){
    if(busy)return;
    if(!email.trim()||!password)return setError("Scrie e-mailul și parola.");
    setBusy(true);setError("");setNotice("");
    try{
      const body={email:email.trim(),password,...(mode==="register"?{name:name.trim(),...(setupCode.trim()?{setupCode:setupCode.trim()}:{})}:{})};
      const d=await api(mode==="login"?"/auth/login":"/auth/register","",{method:"POST",body});
      if(!d?.token){setNotice(d?.message||"Contul a fost creat și așteaptă aprobarea Owner-ului.");setMode("login");setPassword("");setSetupCode("");return}
      try{await AsyncStorage.setItem(TOKEN_KEY,d.token)}catch{}
      onAuth(d.token,d.user,d.permissions||{});
    }catch(e){setError(e.message)}finally{setBusy(false)}
  }
  return <View style={[s.safe,{paddingTop:insets.top,paddingBottom:insets.bottom}]}><StatusBar style="light"/>
    <KeyboardAvoidingView style={s.flex} behavior="padding">
      <ScrollView contentContainerStyle={s.authWrap} keyboardShouldPersistTaps="handled">
        <View style={s.logoBox}><Text style={s.logoAI}>AI</Text><Text style={s.logoStoica}>STOICA</Text></View>
        <Text style={s.title} accessibilityRole="header">AI Stoica</Text><Text style={s.sub}>STOICA ENTERPRISES AI</Text>
        <View style={s.card}>
          <View style={s.tabs}>
            <TouchableOpacity accessibilityRole="tab" accessibilityState={{selected:mode==="login"}} onPress={()=>{setMode("login");setError("")}} style={[s.tab,mode==="login"&&s.tabOn]}><Text style={s.tabText}>Autentificare</Text></TouchableOpacity>
            <TouchableOpacity accessibilityRole="tab" accessibilityState={{selected:mode==="register"}} onPress={()=>{setMode("register");setError("")}} style={[s.tab,mode==="register"&&s.tabOn]}><Text style={s.tabText}>Cont nou</Text></TouchableOpacity>
          </View>
          {mode==="register"&&<TextInput style={s.input} placeholder="Nume" placeholderTextColor="#7d8ba0" value={name} onChangeText={setName} maxLength={100} autoComplete="name" textContentType="name" accessibilityLabel="Nume"/>}
          <TextInput style={s.input} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" placeholder="Email" placeholderTextColor="#7d8ba0" value={email} onChangeText={setEmail} maxLength={254} accessibilityLabel="Email"/>
          <TextInput style={s.input} secureTextEntry autoComplete={mode==="login"?"password":"new-password"} textContentType={mode==="login"?"password":"newPassword"} placeholder={mode==="register"?"Parolă (minimum 8 caractere)":"Parolă"} placeholderTextColor="#7d8ba0" value={password} onChangeText={setPassword} maxLength={256} onSubmitEditing={submit} accessibilityLabel="Parolă"/>
          {mode==="register"&&<TextInput style={s.input} autoCapitalize="none" autoCorrect={false} placeholder="Cod Owner (doar pentru contul Owner)" placeholderTextColor="#7d8ba0" value={setupCode} onChangeText={setSetupCode} accessibilityLabel="Cod Owner, doar pentru contul Owner"/>}
          {!!error&&<Text style={s.err} accessibilityLiveRegion="polite">{error}</Text>}
          {!!notice&&<Text style={s.notice} accessibilityLiveRegion="polite">{notice}</Text>}
          <TouchableOpacity accessibilityRole="button" style={[s.primary,busy&&s.disabled]} onPress={submit} disabled={busy}><Text style={s.primaryText}>{busy?(mode==="login"?"Se conectează…":"Se creează contul…"):mode==="login"?"Intră":"Creează cont"}</Text></TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  </View>;
}

export default function Home(){
  const insets=useSafeAreaInsets();
  const[token,setToken]=useState(null),[user,setUser]=useState(null),[permissions,setPermissions]=useState({}),[loading,setLoading]=useState(true),[offline,setOffline]=useState(false),[authNotice,setAuthNotice]=useState("");
  const[convs,setConvs]=useState([]),[currentId,setCurrentId]=useState(null),[convLoading,setConvLoading]=useState(false),[refreshing,setRefreshing]=useState(false);
  const[text,setText]=useState(""),[busy,setBusy]=useState(false),[menu,setMenu]=useState(false),[exportFormat,setExportFormat]=useState(null);
  const[pendingFiles,setPendingFiles]=useState([]),[uploading,setUploading]=useState(false),[exporting,setExporting]=useState(""),[copiedId,setCopiedId]=useState("");
  const[adminOpen,setAdminOpen]=useState(false),[accounts,setAccounts]=useState([]),[accountsLoading,setAccountsLoading]=useState(false),[accountBusy,setAccountBusy]=useState("");
  const[githubOpen,setGithubOpen]=useState(false),[ghPath,setGhPath]=useState(""),[ghInstruction,setGhInstruction]=useState(""),[ghBusy,setGhBusy]=useState(false),[applyingId,setApplyingId]=useState("");
  const scrollRef=useRef(null),tokenRef=useRef(null);
  const isOwner=user?.role==="owner";
  const allowed=k=>permissions?.[k]!==false;
  const current=useMemo(()=>convs.find(c=>c.id===currentId)||null,[convs,currentId]);
  tokenRef.current=token;

  function resetState(){
    setToken(null);setUser(null);setPermissions({});setOffline(false);setConvs([]);setCurrentId(null);setText("");setPendingFiles([]);setExportFormat(null);
    setMenu(false);setAdminOpen(false);setAccounts([]);setGithubOpen(false);setGhPath("");setGhInstruction("");setBusy(false);setUploading(false);
  }
  async function endSession(message){
    try{await AsyncStorage.removeItem(TOKEN_KEY)}catch{}
    resetState();
    setAuthNotice(message||"");
  }
  useEffect(()=>{
    onSessionLost=message=>{if(tokenRef.current)endSession(/așteaptă|nu este activ/i.test(message)?message:"Sesiunea a expirat. Autentifică-te din nou.")};
    return()=>{onSessionLost=null};
  },[]);

  async function checkSession(t){
    try{
      const me=await api("/auth/me",t,{silent:true});
      const nt=me.token||t;
      try{await AsyncStorage.setItem(TOKEN_KEY,nt)}catch{}
      setToken(nt);setUser(me.user);setPermissions(me.permissions||{});setOffline(false);
      return true;
    }catch(e){
      if(sessionLost(e.status,e.message)){await endSession(e.status===403?e.message:"Sesiunea a expirat. Autentifică-te din nou.");return false}
      setToken(t);setOffline(true);return false;
    }
  }
  useEffect(()=>{(async()=>{
    let t=null;
    try{t=await AsyncStorage.getItem(TOKEN_KEY)}catch{}
    if(t)await checkSession(t);
    setLoading(false);
  })()},[]);
  useEffect(()=>{
    const sub=AppState.addEventListener("change",state=>{if(state==="active"&&tokenRef.current&&offline)checkSession(tokenRef.current)});
    return()=>sub.remove();
  },[offline]);
  useEffect(()=>{if(token&&user)reload()},[token,user?.id]);

  async function reload(){
    try{
      const d=await api("/api/conversations?summary=1",tokenRef.current);
      const list=d.data||[];
      setConvs(prev=>list.map(c=>{const old=prev.find(x=>x.id===c.id);return old?.messages&&old.updatedAt===c.updatedAt?{...c,messages:old.messages}:c}));
      if(!currentId&&list.length){setCurrentId(list[0].id);if(!Array.isArray(list[0].messages))loadConversation(list[0].id)}
    }catch(e){if(!offline)showError("AI Stoica",e)}
  }
  async function refreshList(){setRefreshing(true);try{await reload()}finally{setRefreshing(false)}}
  async function loadConversation(id,{quiet=false}={}){
    setConvLoading(true);
    try{
      let conv;
      try{conv=(await api(`/api/conversations/${encodeURIComponent(id)}`,tokenRef.current)).data}
      catch(e){
        // Older Worker versions have no GET /api/conversations/:id: take the conversation from the full list.
        if(e.status!==404&&e.status!==405)throw e;
        conv=((await api("/api/conversations",tokenRef.current)).data||[]).find(x=>x.id===id);
        if(!conv)throw e;
      }
      setConvs(v=>v.map(x=>x.id===id?conv:x));return conv;
    }
    catch(e){if(quiet)throw e;showError("Conversație",e);return null}
    finally{setConvLoading(false)}
  }
  function openConversation(id){
    setCurrentId(id);setMenu(false);
    const c=convs.find(x=>x.id===id);
    if(!c||!c.messages)loadConversation(id);
  }
  function deleteConversation(c){
    Alert.alert("Șterge conversația",`Ștergi „${c.title}”?`,[{text:"Anulează",style:"cancel"},{text:"Șterge",style:"destructive",onPress:async()=>{
      try{await api(`/api/conversations/${encodeURIComponent(c.id)}`,token,{method:"DELETE"});setConvs(v=>v.filter(x=>x.id!==c.id));if(currentId===c.id)setCurrentId(null)}
      catch(e){showError("Conversație",e)}
    }}]);
  }
  async function loadAccounts(){
    setAccountsLoading(true);
    try{const d=await api("/api/admin/users",token);setAccounts(d.data||[])}catch(e){showError("Conturi",e)}finally{setAccountsLoading(false)}
  }
  async function setAccountStatus(a,status){
    setAccountBusy(a.id);
    try{await api(`/api/admin/users/${encodeURIComponent(a.id)}/status`,token,{method:"PATCH",body:{status}});await loadAccounts()}
    catch(e){showError("Conturi",e)}finally{setAccountBusy("")}
  }
  function confirmStatus(a,status,label){
    if(status==="active")return setAccountStatus(a,status);
    Alert.alert(label,`${label} contul ${a.email}?`,[{text:"Anulează",style:"cancel"},{text:label,style:"destructive",onPress:()=>setAccountStatus(a,status)}]);
  }
  function authDone(t,u,perms){setAuthNotice("");setToken(t);setUser(u);setPermissions(perms||{})}
  async function logout(){
    const t=token;
    setMenu(false);
    if(t)api("/auth/logout",t,{method:"POST",body:{},silent:true}).catch(()=>{});
    await endSession("");
  }
  async function ensureConversation(title="Conversație nouă"){
    if(current)return current.messages?current:await loadConversation(current.id,{quiet:true});
    const d=await api("/api/conversations",token,{method:"POST",body:{title:title.slice(0,48),model:DEFAULT_MODEL,messages:[]}});
    setConvs(v=>[d.data,...v]);setCurrentId(d.data.id);return d.data;
  }
  async function saveMessages(c,messages){
    const saved=await api(`/api/conversations/${encodeURIComponent(c.id)}`,token,{method:"PUT",body:{messages,model:DEFAULT_MODEL}});
    setConvs(v=>v.map(x=>x.id===c.id?saved.data:x));
    return saved.data;
  }

  async function uploadOne(asset){
    const problem=gatewayProblem();if(problem)throw new Error(problem);
    const name=asset.name||"fisier",type=asset.mimeType||"application/octet-stream";
    const result=await FileSystem.uploadAsync(`${GATEWAY}/api/files?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`,asset.uri,{
      httpMethod:"POST",uploadType:FileSystem.FileSystemUploadType.BINARY_CONTENT,headers:{Authorization:`Bearer ${token}`,"Content-Type":type}
    });
    let d={};try{d=JSON.parse(result.body||"{}")}catch{}
    if(result.status<200||result.status>=300){
      const msg=d.error||`Încărcarea a eșuat (HTTP ${result.status}).`;
      if(sessionLost(result.status,msg)&&onSessionLost){onSessionLost(msg);const e=new Error(msg);e.sessionLost=true;throw e}
      throw new Error(msg);
    }
    if(!d.data?.id)throw new Error("Răspuns invalid de la server la încărcare.");
    return d.data;
  }
  async function pickFiles(){
    if(uploading||busy)return;
    try{
      const result=await DocumentPicker.getDocumentAsync({multiple:true,copyToCacheDirectory:true});
      if(result.canceled)return;
      setUploading(true);
      const failed=[];
      for(const a of result.assets||[]){
        try{const f=await uploadOne(a);setPendingFiles(v=>[...v,f])}
        catch(e){if(e.sessionLost)return;failed.push(`${a.name||"fișier"}: ${e.message}`)}
      }
      if(failed.length)Alert.alert("Atașament",failed.join("\n"));
    }catch(e){showError("Atașament",e)}finally{setUploading(false)}
  }
  async function downloadAndShare(file){
    try{
      const problem=gatewayProblem();if(problem)throw new Error(problem);
      const safe=(file.name||"fisier").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9._-]/g,"_");
      const dest=(FileSystem.cacheDirectory||FileSystem.documentDirectory)+safe;
      const r=await FileSystem.downloadAsync(`${GATEWAY}/api/files/${encodeURIComponent(file.id)}`,dest,{headers:{Authorization:`Bearer ${token}`}});
      if(r.status<200||r.status>=300){
        let msg=`Descărcarea a eșuat (HTTP ${r.status}).`;
        try{msg=JSON.parse(await FileSystem.readAsStringAsync(r.uri))?.error||msg}catch{}
        await FileSystem.deleteAsync(r.uri,{idempotent:true}).catch(()=>{});
        if(sessionLost(r.status,msg)&&onSessionLost)return onSessionLost(msg);
        throw new Error(msg);
      }
      if(await Sharing.isAvailableAsync())await Sharing.shareAsync(r.uri,{mimeType:file.mimeType||undefined,dialogTitle:file.name||"AI Stoica"});
      else Alert.alert("Fișier salvat",r.uri);
    }catch(e){showError("Fișier",e)}
  }

  async function send(){
    const p=text.trim();
    if((!p&&!pendingFiles.length)||busy||uploading)return;
    const files=pendingFiles,format=exportFormat;
    setBusy(true);setPendingFiles([]);setText("");setExportFormat(null);
    let c=null,before=[],answered=null;
    try{
      c=await ensureConversation(p||files[0]?.name||"Fișiere");
      before=c.messages||[];
      const msg={id:`u${Date.now()}`,role:"user",content:p||"Analizează și rezolvă fișierele atașate.",attachments:files,createdAt:Date.now()};
      const messages=[...before,msg];
      setConvs(v=>v.map(x=>x.id===c.id?{...x,messages}:x));
      const d=await api("/api/chat",token,{method:"POST",body:{model:DEFAULT_MODEL,messages},timeout:CHAT_TIMEOUT});
      const ans=String(d?.choices?.[0]?.message?.content||"Nu am primit răspuns.");
      let generated=[];
      if(format){
        try{const exported=await api("/api/export",token,{method:"POST",body:{format,title:c.title||"AI Stoica - document",content:ans},timeout:CHAT_TIMEOUT});if(exported?.data)generated=[exported.data]}
        catch(e){showError("Document",{...e,message:"Răspunsul a fost generat, dar fișierul nu a putut fi creat: "+e.message})}
      }
      answered=[...messages,{id:`a${Date.now()}`,role:"assistant",content:ans,attachments:generated,createdAt:Date.now(),provider:d.provider,model:d.model}];
      setConvs(v=>v.map(x=>x.id===c.id?{...x,messages:answered}:x));
      await saveMessages(c,answered);
    }catch(e){
      if(e.sessionLost)return;
      if(answered){Alert.alert("AI Stoica","Răspunsul este afișat, dar nu a putut fi salvat pe server: "+e.message);return}
      if(c)setConvs(v=>v.map(x=>x.id===c.id?{...x,messages:before}:x));
      setPendingFiles(files);setText(v=>v||p);setExportFormat(format);
      showError("AI Stoica",e);
    }finally{setBusy(false)}
  }

  async function exportMessage(m,format){
    if(exporting)return;
    setExporting(`${m.id}:${format}`);
    try{const d=await api("/api/export",token,{method:"POST",body:{format,title:current?.title||"AI Stoica - răspuns",content:contentText(m)},timeout:CHAT_TIMEOUT});await downloadAndShare(d.data)}
    catch(e){showError("Export",e)}finally{setExporting("")}
  }

  async function generateImage(){
    const prompt=text.trim();
    if(busy||uploading)return;
    if(!prompt)return Alert.alert("Imagine","Scrie mai întâi descrierea imaginii.");
    setBusy(true);
    try{
      const d=await api("/api/generate/image",token,{method:"POST",body:{prompt},timeout:CHAT_TIMEOUT});
      const c=await ensureConversation("Imagine: "+prompt);
      const userMsg={id:`u${Date.now()}`,role:"user",content:"Generează imagine: "+prompt,createdAt:Date.now()};
      const aiMsg={id:`img${Date.now()}`,role:"assistant",content:"Imagine generată de AI Stoica.",attachments:[d.data],createdAt:Date.now(),model:d.model};
      setText("");
      await saveMessages(c,[...(c.messages||[]),userMsg,aiMsg]);
    }catch(e){showError("Imagine",e)}finally{setBusy(false)}
  }

  async function solveGithub(){
    if(!ghPath.trim()||ghBusy)return;
    setGhBusy(true);
    try{
      const d=await api("/api/github/solve",token,{method:"POST",body:{path:ghPath.trim(),...(ghInstruction.trim()?{instruction:ghInstruction.trim()}:{})},timeout:CHAT_TIMEOUT});
      const{path,branch,sha,proposal}=d.data;
      const c=await ensureConversation("GitHub: "+ghPath.trim());
      const m={id:`gh${Date.now()}`,role:"assistant",content:proposal,createdAt:Date.now(),githubProposal:{path,branch,sha}};
      await saveMessages(c,[...(c.messages||[]),{id:`u${Date.now()}`,role:"user",content:`Rezolvă în GitHub ${ghPath.trim()}: ${ghInstruction.trim()||"corectează problema"}`,createdAt:Date.now()},m]);
      setGithubOpen(false);setGhPath("");setGhInstruction("");
    }catch(e){showError("GitHub",e)}finally{setGhBusy(false)}
  }
  function applyGithub(m){
    const g=m.githubProposal;
    Alert.alert("Aplică în GitHub",`Fișierul ${g.path} va fi modificat în repository.`,[
      {text:"Anulează",style:"cancel"},
      {text:"Aplică",style:"destructive",onPress:async()=>{
        setApplyingId(m.id);
        try{
          const d=await api("/api/github/apply",token,{method:"POST",body:{path:g.path,content:m.content,sha:g.sha,branch:g.branch,message:`AI Stoica: rezolvare ${g.path}`}});
          const commit=d.data?.commit||"";
          const c=current;
          if(c?.messages)await saveMessages(c,c.messages.map(x=>x.id===m.id?{...x,githubApplied:{commit,at:Date.now()}}:x)).catch(()=>{});
          Alert.alert("GitHub","Modificarea a fost trimisă."+(commit?" Commit: "+commit.slice(0,10):""));
        }catch(e){showError("GitHub",e)}finally{setApplyingId("")}
      }}
    ]);
  }
  async function copyText(m){
    try{await Clipboard.setStringAsync(contentText(m));setCopiedId(m.id);setTimeout(()=>setCopiedId(v=>v===m.id?"":v),1500)}
    catch(e){showError("Copiere",e)}
  }

  if(loading)return <View style={[s.safe,s.center]}><StatusBar style="light"/><ActivityIndicator color="#278cff" accessibilityLabel="Se încarcă"/></View>;
  if(!token)return <Auth onAuth={authDone} initialNotice={authNotice||gatewayProblem()}/>;

  const messages=current?.messages||[];
  return <View style={[s.safe,{paddingTop:insets.top,paddingBottom:insets.bottom}]}><StatusBar style="light"/>
    <KeyboardAvoidingView style={s.flex} behavior="padding">
      <View style={s.header}>
        <TouchableOpacity onPress={()=>setMenu(true)} accessibilityRole="button" accessibilityLabel="Deschide meniul de conversații" hitSlop={12}><Text style={s.menu}>☰</Text></TouchableOpacity>
        <View style={s.headerTitles}><Text style={s.headerTitle} accessibilityRole="header">AI Stoica</Text><Text style={s.headerSub} numberOfLines={1}>{DEFAULT_MODEL}</Text></View>
        {isOwner&&allowed("github_access")&&<TouchableOpacity style={s.ghTop} onPress={()=>setGithubOpen(true)} accessibilityRole="button" accessibilityLabel="GitHub Solve"><Text style={s.ghTopText}>GitHub</Text></TouchableOpacity>}
        <TouchableOpacity style={s.newBtn} onPress={()=>{setCurrentId(null);setPendingFiles([]);setExportFormat(null)}} accessibilityRole="button" accessibilityLabel="Conversație nouă"><Text style={s.newBtnText}>Nou</Text></TouchableOpacity>
      </View>
      {offline&&<View style={s.offline}><Text style={s.offlineText}>Serverul nu răspunde momentan. Verifică internetul.</Text><TouchableOpacity onPress={()=>checkSession(token)} accessibilityRole="button"><Text style={s.offlineRetry}>Reîncearcă</Text></TouchableOpacity></View>}

      <ScrollView ref={scrollRef} style={s.flex} contentContainerStyle={s.chatContent} keyboardShouldPersistTaps="handled" onContentSizeChange={()=>scrollRef.current?.scrollToEnd({animated:true})}>
        {convLoading&&!messages.length?<ActivityIndicator style={s.convSpinner} color="#278cff" accessibilityLabel="Se încarcă conversația"/>:
        !messages.length?<View style={s.empty}><View style={s.logoBoxSmall}><Text style={s.logoAISmall}>AI</Text></View><Text style={s.big}>Trimite-mi orice fișier</Text><Text style={s.emptyText}>Poze, PDF, DOCX, CSV, cod. Îl citesc, îl analizez și îl rezolv.</Text></View>:
        messages.map((m,i)=><View key={m.id||i} style={m.role==="user"?s.userMsg:s.aiMsg}>
          {m.role==="assistant"&&<Text style={s.aiName}>AI Stoica</Text>}
          {m.role==="assistant"?<MessageText text={contentText(m)}/>:<Text selectable style={s.msgText}>{contentText(m)}</Text>}
          {!!m.attachments?.length&&<View style={s.fileWrap}>{m.attachments.filter(x=>x&&(x.id||x.libraryId)).map(fileRef).map((a,j)=><View key={a.id||j}>
            {/^image\//.test(a.mimeType||"")&&!gatewayProblem()&&<Image source={{uri:`${GATEWAY}/api/files/${encodeURIComponent(a.id)}`,headers:{Authorization:`Bearer ${token}`}}} style={s.preview} resizeMode="contain" accessibilityLabel={a.name||"Imagine"}/>}
            <TouchableOpacity style={s.fileChip} onPress={()=>downloadAndShare(a)} accessibilityRole="button" accessibilityLabel={`Deschide fișierul ${a.name||""}`}><Text style={s.fileChipText}>📎 {a.name}</Text></TouchableOpacity>
          </View>)}</View>}
          {m.role==="assistant"&&<View style={s.actions}>
            <TouchableOpacity style={s.action} onPress={()=>copyText(m)} accessibilityRole="button" accessibilityLabel="Copiază răspunsul"><Text style={s.actionText}>{copiedId===m.id?"Copiat ✓":"Copiază"}</Text></TouchableOpacity>
            {allowed("document_generation")&&EXPORT_FORMATS.map(([f,label])=><TouchableOpacity key={f} style={[s.action,!!exporting&&s.disabled]} disabled={!!exporting} onPress={()=>exportMessage(m,f)} accessibilityRole="button" accessibilityLabel={`Descarcă răspunsul ca ${label}`}><Text style={s.actionText}>{exporting===`${m.id}:${f}`?"…":label}</Text></TouchableOpacity>)}
            {!!m.githubProposal&&!m.githubApplied&&<TouchableOpacity style={[s.action,s.apply]} disabled={!!applyingId} onPress={()=>applyGithub(m)} accessibilityRole="button"><Text style={s.applyText}>{applyingId===m.id?"Se aplică…":"Aplică în GitHub"}</Text></TouchableOpacity>}
            {!!m.githubApplied&&<Text style={s.appliedText}>Aplicat în GitHub{m.githubApplied.commit?` · ${m.githubApplied.commit.slice(0,7)}`:""}</Text>}
          </View>}
        </View>)}
        {busy&&<View style={s.busyRow} accessibilityLiveRegion="polite"><ActivityIndicator color="#278cff"/><Text style={s.busyText}>AI Stoica lucrează…</Text></View>}
      </ScrollView>

      {!!pendingFiles.length&&<ScrollView horizontal style={s.pending} contentContainerStyle={s.pendingInner} keyboardShouldPersistTaps="handled">
        {pendingFiles.map((f,i)=><View key={f.id||i} style={s.pendingChip}><Text numberOfLines={1} style={s.pendingText}>📎 {f.name}</Text><TouchableOpacity onPress={()=>setPendingFiles(v=>v.filter(x=>x.id!==f.id))} hitSlop={12} accessibilityRole="button" accessibilityLabel={`Elimină ${f.name}`}><Text style={s.remove}>×</Text></TouchableOpacity></View>)}
      </ScrollView>}
      {allowed("document_generation")&&<View style={s.formatRow}>
        <Text style={s.formatLabel}>Răspuns ca:</Text>
        {[[null,"Text"],...EXPORT_FORMATS].map(([f,label])=><TouchableOpacity key={label} style={[s.formatChip,exportFormat===f&&s.formatChipOn]} onPress={()=>setExportFormat(f)} accessibilityRole="radio" accessibilityState={{selected:exportFormat===f}} accessibilityLabel={f?`Răspunsul următor și ca fișier ${label}`:"Răspuns doar text"}><Text style={[s.formatText,exportFormat===f&&s.formatTextOn]}>{label}</Text></TouchableOpacity>)}
      </View>}
      <View style={s.composer}>
        {allowed("file_upload")&&<TouchableOpacity style={s.attach} onPress={pickFiles} disabled={uploading||busy} accessibilityRole="button" accessibilityLabel="Atașează fișiere">{uploading?<ActivityIndicator color="#8fbce9"/>:<Text style={s.attachText}>＋</Text>}</TouchableOpacity>}
        <TextInput style={s.textarea} multiline placeholder="Întreabă sau atașează un fișier" placeholderTextColor="#7d8ba0" value={text} onChangeText={setText} accessibilityLabel="Mesaj"/>
        {allowed("image_generation")&&<TouchableOpacity style={[s.imageBtn,(busy||uploading)&&s.disabled]} onPress={generateImage} disabled={busy||uploading} accessibilityRole="button" accessibilityLabel="Generează o imagine din text"><Text style={s.imageBtnText}>▧</Text></TouchableOpacity>}
        <TouchableOpacity style={[s.send,(busy||uploading)&&s.disabled]} onPress={send} disabled={busy||uploading} accessibilityRole="button" accessibilityLabel="Trimite mesajul"><Text style={s.sendText}>↑</Text></TouchableOpacity>
      </View>
    </KeyboardAvoidingView>

    <Modal visible={menu} transparent animationType="fade" onRequestClose={()=>setMenu(false)}>
      <View style={s.drawerRow}>
        <View style={[s.drawer,{paddingTop:insets.top+16,paddingBottom:insets.bottom}]}>
          <Text style={s.drawerTitle} accessibilityRole="header">Conversații</Text>
          {isOwner&&allowed("github_access")&&<TouchableOpacity style={s.githubMenu} onPress={()=>{setMenu(false);setGithubOpen(true)}} accessibilityRole="button"><Text style={s.githubMenuText}>⌘ GitHub Solve</Text></TouchableOpacity>}
          {isOwner&&<TouchableOpacity style={s.githubMenu} onPress={()=>{setMenu(false);setAdminOpen(true);loadAccounts()}} accessibilityRole="button"><Text style={s.githubMenuText}>Conturi și cereri de acces</Text></TouchableOpacity>}
          <ScrollView style={s.flex} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshList} tintColor="#278cff"/>}>
            {!convs.length&&<Text style={s.drawerEmpty}>Nu ai conversații încă.</Text>}
            {convs.map(c=><TouchableOpacity key={c.id} style={[s.drawerItem,c.id===currentId&&s.drawerItemOn]} onPress={()=>openConversation(c.id)} onLongPress={()=>deleteConversation(c)} accessibilityRole="button" accessibilityHint="Apasă lung pentru a șterge"><Text numberOfLines={1} style={s.drawerText}>{c.title}</Text></TouchableOpacity>)}
          </ScrollView>
          <View style={s.account}><Text style={s.accountName}>{user?.name||"Cont"}</Text><Text style={s.accountEmail}>{user?.email||(offline?"Fără conexiune":"")}</Text><TouchableOpacity onPress={logout} accessibilityRole="button" hitSlop={8}><Text style={s.logout}>Deconectare</Text></TouchableOpacity></View>
        </View>
        <Pressable style={s.flex} onPress={()=>setMenu(false)} accessibilityRole="button" accessibilityLabel="Închide meniul"/>
      </View>
    </Modal>

    <Modal visible={adminOpen} transparent animationType="slide" onRequestClose={()=>setAdminOpen(false)}>
      <View style={s.modalScrim}><View style={s.ghModal}>
        <Text style={s.ghTitle} accessibilityRole="header">Conturi</Text>
        <Text style={s.ghHelp}>Conturile noi așteaptă aprobarea ta înainte să poată folosi AI Stoica.</Text>
        {accountsLoading&&<ActivityIndicator color="#278cff" accessibilityLabel="Se încarcă conturile"/>}
        <ScrollView style={s.accountList}>{accounts.filter(a=>a.id!==user?.id).map(a=><View key={a.id} style={s.accountRow}>
          <Text style={s.accountRowName}>{a.name} · {a.email}</Text>
          <Text style={s.accountRowStatus}>{STATUS_LABELS[a.status]||a.status}</Text>
          <View style={s.ghButtons}>
            {accountBusy===a.id?<ActivityIndicator color="#278cff"/>:<>
              {a.status!=="active"&&<TouchableOpacity style={s.primarySmall} onPress={()=>confirmStatus(a,"active","Aprobă")} accessibilityRole="button"><Text style={s.primaryText}>Aprobă</Text></TouchableOpacity>}
              {a.status!=="blocked"&&<TouchableOpacity style={s.cancelBtn} onPress={()=>a.status==="pending"?confirmStatus(a,"rejected","Respinge"):confirmStatus(a,"blocked","Blochează")} accessibilityRole="button"><Text style={s.cancelText}>{a.status==="pending"?"Respinge":"Blochează"}</Text></TouchableOpacity>}
            </>}
          </View>
        </View>)}{!accountsLoading&&!accounts.some(a=>a.id!==user?.id)&&<Text style={s.ghHelp}>Nu există alte conturi.</Text>}</ScrollView>
        <View style={s.ghButtons}><TouchableOpacity style={s.cancelBtn} onPress={()=>setAdminOpen(false)} accessibilityRole="button"><Text style={s.cancelText}>Închide</Text></TouchableOpacity></View>
      </View></View>
    </Modal>

    <Modal visible={githubOpen} transparent animationType="slide" onRequestClose={()=>{if(!ghBusy)setGithubOpen(false)}}>
      <KeyboardAvoidingView style={s.flex} behavior="padding"><View style={s.modalScrim}><View style={s.ghModal}>
        <Text style={s.ghTitle} accessibilityRole="header">GitHub Solve</Text>
        <Text style={s.ghHelp}>AI Stoica citește fișierul, propune versiunea corectată, iar tu alegi separat dacă o aplici.</Text>
        <TextInput style={s.input} autoCapitalize="none" autoCorrect={false} placeholder="ex: apps/mobile/app/index.js" placeholderTextColor="#7d8ba0" value={ghPath} onChangeText={setGhPath} accessibilityLabel="Calea fișierului din repository"/>
        <TextInput style={[s.input,s.ghInstructions]} multiline placeholder="Ce trebuie rezolvat?" placeholderTextColor="#7d8ba0" value={ghInstruction} onChangeText={setGhInstruction} accessibilityLabel="Ce trebuie rezolvat"/>
        <View style={s.ghButtons}>
          <TouchableOpacity style={s.cancelBtn} onPress={()=>setGithubOpen(false)} disabled={ghBusy} accessibilityRole="button"><Text style={s.cancelText}>Anulează</Text></TouchableOpacity>
          <TouchableOpacity style={[s.primarySmall,(ghBusy||!ghPath.trim())&&s.disabled]} onPress={solveGithub} disabled={ghBusy||!ghPath.trim()} accessibilityRole="button">{ghBusy?<ActivityIndicator color="#fff"/>:<Text style={s.primaryText}>Rezolvă</Text>}</TouchableOpacity>
        </View>
      </View></View></KeyboardAvoidingView>
    </Modal>
  </View>;
}

const s=StyleSheet.create({
  flex:{flex:1},safe:{flex:1,backgroundColor:"#05070b"},center:{alignItems:"center",justifyContent:"center"},disabled:{opacity:0.5},
  authWrap:{padding:24,alignItems:"center",justifyContent:"center",flexGrow:1},logoBox:{width:145,height:92,borderRadius:24,borderWidth:1,borderColor:"#31537a",alignItems:"center",justifyContent:"center",backgroundColor:"#09111c"},
  logoAI:{color:"#50a7ff",fontSize:36,fontWeight:"900"},logoStoica:{color:"#fff",fontSize:13,fontWeight:"800",letterSpacing:3},
  logoBoxSmall:{width:90,height:90,borderRadius:24,borderWidth:1,borderColor:"#31537a",alignItems:"center",justifyContent:"center",backgroundColor:"#09111c"},logoAISmall:{color:"#50a7ff",fontSize:34,fontWeight:"900"},
  title:{color:"#fff",fontSize:30,fontWeight:"800",marginTop:14},sub:{color:"#7f9cc0",fontSize:11,letterSpacing:2,marginTop:4},
  card:{width:"100%",maxWidth:430,backgroundColor:"#0d131d",borderColor:"#243248",borderWidth:1,borderRadius:20,padding:18,marginTop:24},
  tabs:{flexDirection:"row",backgroundColor:"#080c12",borderRadius:10,padding:3,marginBottom:15},tab:{flex:1,minHeight:44,padding:9,borderRadius:8,alignItems:"center",justifyContent:"center"},tabOn:{backgroundColor:"#151e2a"},tabText:{color:"#cdd7e4"},
  input:{backgroundColor:"#080d14",borderColor:"#26354a",borderWidth:1,borderRadius:10,color:"white",padding:12,marginVertical:6,minHeight:46},
  primary:{backgroundColor:"#197ce2",padding:13,borderRadius:10,alignItems:"center",marginTop:8,minHeight:46,justifyContent:"center"},primarySmall:{backgroundColor:"#197ce2",paddingHorizontal:20,paddingVertical:12,borderRadius:10,alignItems:"center",minHeight:44,justifyContent:"center"},
  primaryText:{color:"white",fontWeight:"700"},err:{color:"#ff9dab",marginTop:5},notice:{color:"#8fd7ae",marginTop:5},
  accountList:{maxHeight:380},accountRow:{borderBottomColor:"#1e2938",borderBottomWidth:1,paddingVertical:10},accountRowName:{color:"#e7edf6",fontSize:14},accountRowStatus:{color:"#9aa9bb",fontSize:12,marginTop:3},
  header:{minHeight:60,borderBottomWidth:1,borderBottomColor:"#1e2938",flexDirection:"row",alignItems:"center",paddingHorizontal:14,paddingVertical:8,gap:10},menu:{color:"#d8e2ef",fontSize:25,paddingHorizontal:4},
  headerTitles:{flex:1},headerTitle:{color:"#fff",fontWeight:"700",fontSize:16},headerSub:{color:"#9aabc2",fontSize:11,marginTop:2},ghTop:{borderColor:"#30517a",borderWidth:1,borderRadius:10,paddingHorizontal:10,paddingVertical:8,minHeight:40,justifyContent:"center"},ghTopText:{color:"#7fbaff",fontWeight:"700"},
  newBtn:{borderColor:"#2a384d",borderWidth:1,borderRadius:10,paddingHorizontal:12,paddingVertical:8,minHeight:40,justifyContent:"center"},newBtnText:{color:"#dce6f2"},
  offline:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",backgroundColor:"#2a1a10",paddingHorizontal:14,paddingVertical:8,gap:10},offlineText:{color:"#ffd2a8",flex:1,fontSize:13},offlineRetry:{color:"#ffb26b",fontWeight:"700"},
  chatContent:{padding:16,paddingBottom:24,flexGrow:1},convSpinner:{marginTop:60},empty:{marginTop:70,alignItems:"center"},big:{color:"#fff",fontSize:28,fontWeight:"800",textAlign:"center",marginTop:18},emptyText:{color:"#9aa9bb",fontSize:14,textAlign:"center",lineHeight:21,marginTop:10,maxWidth:330},
  userMsg:{alignSelf:"flex-end",maxWidth:"90%",backgroundColor:"#151d29",borderRadius:18,padding:12,marginVertical:8},aiMsg:{alignSelf:"stretch",marginVertical:14},
  aiName:{color:"#4ba2ff",fontWeight:"700",fontSize:12,marginBottom:5},msgText:{color:"#e7edf6",fontSize:16,lineHeight:24},heading:{fontWeight:"800",fontSize:17,marginTop:6},bold:{fontWeight:"800"},
  inlineCode:{fontFamily:"monospace",backgroundColor:"#111a26",color:"#cfe3ff"},codeBlock:{backgroundColor:"#0b121c",borderColor:"#1f2d40",borderWidth:1,borderRadius:10,padding:10,marginVertical:6},codeText:{fontFamily:"monospace",color:"#cfe3ff",fontSize:13,lineHeight:19},
  fileWrap:{marginTop:8,gap:6},preview:{width:240,height:240,borderRadius:12,backgroundColor:"#0b1522",marginBottom:6},fileChip:{backgroundColor:"#0b1522",borderColor:"#29496c",borderWidth:1,borderRadius:10,padding:10,minHeight:44,justifyContent:"center"},fileChipText:{color:"#9ecbff",fontSize:13},
  actions:{flexDirection:"row",flexWrap:"wrap",gap:8,marginTop:9,alignItems:"center"},action:{borderColor:"#29384c",borderWidth:1,borderRadius:9,paddingHorizontal:12,paddingVertical:9,minHeight:40,justifyContent:"center"},actionText:{color:"#b8c6d8",fontSize:13},apply:{borderColor:"#2d855d",backgroundColor:"#0d241a"},applyText:{color:"#8ee2b8",fontSize:13,fontWeight:"700"},appliedText:{color:"#8ee2b8",fontSize:12},
  busyRow:{flexDirection:"row",alignItems:"center",gap:8,marginVertical:10},busyText:{color:"#9aa9bb"},
  pending:{maxHeight:52,flexGrow:0,paddingHorizontal:10},pendingInner:{gap:7,alignItems:"center",paddingVertical:4},pendingChip:{maxWidth:240,height:40,flexDirection:"row",alignItems:"center",gap:8,backgroundColor:"#101a28",borderColor:"#29496c",borderWidth:1,borderRadius:11,paddingHorizontal:10},pendingText:{color:"#b9d8fa",fontSize:12,flexShrink:1},remove:{color:"#ff9da9",fontSize:22,paddingHorizontal:4},
  formatRow:{flexDirection:"row",alignItems:"center",gap:6,paddingHorizontal:12,paddingTop:6,flexWrap:"wrap"},formatLabel:{color:"#9aa9bb",fontSize:12},formatChip:{borderColor:"#29384c",borderWidth:1,borderRadius:14,paddingHorizontal:10,paddingVertical:5,minHeight:32,justifyContent:"center"},formatChipOn:{backgroundColor:"#197ce2",borderColor:"#197ce2"},formatText:{color:"#b8c6d8",fontSize:12},formatTextOn:{color:"#fff",fontWeight:"700"},
  composer:{margin:10,backgroundColor:"#0d131d",borderColor:"#253247",borderWidth:1,borderRadius:22,padding:7,flexDirection:"row",alignItems:"flex-end"},
  attach:{width:44,height:44,borderRadius:12,alignItems:"center",justifyContent:"center"},attachText:{color:"#8fbce9",fontSize:27},textarea:{flex:1,color:"white",fontSize:16,minHeight:44,maxHeight:140,padding:10},
  imageBtn:{width:44,height:44,borderRadius:12,backgroundColor:"#121d2b",alignItems:"center",justifyContent:"center",marginRight:6},imageBtnText:{color:"#9dc8f2",fontSize:20},
  send:{width:44,height:44,borderRadius:13,backgroundColor:"#eef4fb",alignItems:"center",justifyContent:"center"},sendText:{color:"#09101a",fontSize:21,fontWeight:"800"},
  drawerRow:{flex:1,flexDirection:"row",backgroundColor:"#0009"},drawer:{width:"82%",maxWidth:380,height:"100%",backgroundColor:"#090d14",borderRightColor:"#1e2938",borderRightWidth:1,paddingHorizontal:12},
  drawerTitle:{color:"white",fontSize:18,fontWeight:"700",marginBottom:12},drawerItem:{padding:12,borderRadius:9,minHeight:44,justifyContent:"center"},drawerItemOn:{backgroundColor:"#121c2a"},drawerText:{color:"#d0d9e6"},drawerEmpty:{color:"#9aa9bb",padding:12},
  githubMenu:{padding:12,borderRadius:10,backgroundColor:"#0d1724",marginBottom:8,minHeight:44,justifyContent:"center"},githubMenuText:{color:"#7fbaff",fontWeight:"700"},
  account:{borderTopColor:"#1e2938",borderTopWidth:1,paddingVertical:14},accountName:{color:"white",fontWeight:"700"},accountEmail:{color:"#9aa9bb",fontSize:12,marginTop:3},logout:{color:"#7fbaff",marginTop:12,paddingVertical:6},
  modalScrim:{flex:1,backgroundColor:"#000b",justifyContent:"center",padding:18},ghModal:{backgroundColor:"#0c121c",borderColor:"#263750",borderWidth:1,borderRadius:20,padding:18},
  ghTitle:{color:"#fff",fontSize:22,fontWeight:"800"},ghHelp:{color:"#9aa9bb",fontSize:13,lineHeight:19,marginVertical:10},ghInstructions:{minHeight:110,textAlignVertical:"top"},ghButtons:{flexDirection:"row",justifyContent:"flex-end",gap:10,marginTop:10,alignItems:"center"},cancelBtn:{paddingHorizontal:18,paddingVertical:12,minHeight:44,justifyContent:"center"},cancelText:{color:"#b8c6d8"}
});
