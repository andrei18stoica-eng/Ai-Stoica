import React, { useEffect, useMemo, useState } from "react";
import { SafeAreaView, View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, Modal, Alert } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { StatusBar } from "expo-status-bar";
import * as DocumentPicker from "expo-document-picker";
import * as Clipboard from "expo-clipboard";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

const GATEWAY=(process.env.EXPO_PUBLIC_GATEWAY_URL||"").replace(/\/+$/,"");
const DEFAULT_MODEL=process.env.EXPO_PUBLIC_DEFAULT_MODEL||"AI Stoica Performance Max";
const TOKEN_KEY="aiStoicaMobileTokenV4";

function normalizeIntent(value){
  return String(value||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
}
function requestedDocumentFormat(value){
  const t=normalizeIntent(value);
  const asks=/(trimite|da-mi|dami|descarc|export|salveaz|fisier|document|format|creeaz|genereaz|fa-mi|fami)/;
  if(!asks.test(t))return null;
  if(/\bpptx\b|powerpoint|prezentare/.test(t))return "pptx";
  if(/\bdocx\b|\bword\b/.test(t))return "docx";
  if(/\bpdf\b/.test(t))return "pdf";
  return null;
}
function standaloneExportRequest(value){
  const t=normalizeIntent(value).replace(/[^a-z0-9\s-]/g," ").replace(/\s+/g," ").trim();
  if(!requestedDocumentFormat(t))return false;
  const stripped=t
    .replace(/\b(pdf|docx|pptx|powerpoint|word|prezentare|document|fisier|format)\b/g," ")
    .replace(/\b(trimite|da-mi|dami|descarca|descarc|exporta|export|salveaza|salveaz|creeaza|creeaz|genereaza|genereaz|fa-mi|fami|in|ca|te|rog|mi)\b/g," ")
    .replace(/\s+/g," ").trim();
  return stripped.length<12;
}

async function api(path,token,options={}){
  if(!GATEWAY)throw new Error("Gateway-ul AI Stoica nu este configurat.");
  const headers={...(token?{Authorization:`Bearer ${token}`}:{}),...(options.headers||{})};
  if(options.body && !(options.body instanceof Blob) && !headers["Content-Type"])headers["Content-Type"]="application/json";
  const r=await fetch(`${GATEWAY}${path}`,{...options,headers});
  const d=await r.json().catch(()=>({error:`HTTP ${r.status}`}));
  if(!r.ok)throw new Error(d?.error||`HTTP ${r.status}`);
  return d;
}

function Auth({onAuth}){
  const[mode,setMode]=useState("login"),[name,setName]=useState(""),[email,setEmail]=useState(""),[password,setPassword]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  async function submit(){
    setBusy(true);setError("");
    try{
      const d=await api(mode==="login"?"/auth/login":"/auth/register","",{method:"POST",body:JSON.stringify({name,email,password})});
      await AsyncStorage.setItem(TOKEN_KEY,d.token);onAuth(d.token,d.user);
    }catch(e){setError(e.message)}finally{setBusy(false)}
  }
  return <SafeAreaView style={s.safe}><StatusBar style="light"/>
    <ScrollView contentContainerStyle={s.authWrap}>
      <View style={s.logoBox}><Text style={s.logoAI}>AI</Text><Text style={s.logoStoica}>STOICA</Text></View>
      <Text style={s.title}>AI Stoica</Text><Text style={s.sub}>STOICA ENTERPRISES AI</Text>
      <View style={s.card}>
        <View style={s.tabs}>
          <TouchableOpacity onPress={()=>setMode("login")} style={[s.tab,mode==="login"&&s.tabOn]}><Text style={s.tabText}>Autentificare</Text></TouchableOpacity>
          <TouchableOpacity onPress={()=>setMode("register")} style={[s.tab,mode==="register"&&s.tabOn]}><Text style={s.tabText}>Cont nou</Text></TouchableOpacity>
        </View>
        {mode==="register"&&<TextInput style={s.input} placeholder="Nume" placeholderTextColor="#627086" value={name} onChangeText={setName}/>}
        <TextInput style={s.input} autoCapitalize="none" keyboardType="email-address" placeholder="Email" placeholderTextColor="#627086" value={email} onChangeText={setEmail}/>
        <TextInput style={s.input} secureTextEntry placeholder="Parolă" placeholderTextColor="#627086" value={password} onChangeText={setPassword}/>
        {!!error&&<Text style={s.err}>{error}</Text>}
        <TouchableOpacity style={s.primary} onPress={submit} disabled={busy}><Text style={s.primaryText}>{busy?"Se conectează…":mode==="login"?"Intră":"Creează cont"}</Text></TouchableOpacity>
      </View>
    </ScrollView>
  </SafeAreaView>;
}

export default function Home(){
  const[token,setToken]=useState(null),[user,setUser]=useState(null),[loading,setLoading]=useState(true);
  const[convs,setConvs]=useState([]),[currentId,setCurrentId]=useState(null),[text,setText]=useState(""),[busy,setBusy]=useState(false),[menu,setMenu]=useState(false);
  const[pendingFiles,setPendingFiles]=useState([]),[uploading,setUploading]=useState(false);
  const[githubOpen,setGithubOpen]=useState(false),[ghPath,setGhPath]=useState(""),[ghInstruction,setGhInstruction]=useState(""),[ghBusy,setGhBusy]=useState(false);
  const current=useMemo(()=>convs.find(c=>c.id===currentId)||null,[convs,currentId]);

  useEffect(()=>{AsyncStorage.getItem(TOKEN_KEY).then(async t=>{
    if(t){try{const me=await api("/auth/me",t);const nt=me.token||t;await AsyncStorage.setItem(TOKEN_KEY,nt);setToken(nt);setUser(me.user)}catch{await AsyncStorage.removeItem(TOKEN_KEY)}}
    setLoading(false);
  })},[]);
  useEffect(()=>{if(token)reload()},[token]);

  async function reload(){const d=await api("/api/conversations",token);setConvs(d.data||[]);if(!currentId&&d.data?.length)setCurrentId(d.data[0].id)}
  async function authDone(t,u){setToken(t);setUser(u)}
  async function logout(){await AsyncStorage.removeItem(TOKEN_KEY);setToken(null);setUser(null);setConvs([]);setCurrentId(null)}
  async function ensureConversation(title="Conversație nouă"){
    if(current)return current;
    const d=await api("/api/conversations",token,{method:"POST",body:JSON.stringify({title:title.slice(0,48),model:DEFAULT_MODEL,messages:[]})});
    setConvs(v=>[d.data,...v]);setCurrentId(d.data.id);return d.data;
  }
  async function saveMessages(c,messages){
    const saved=await api(`/api/conversations/${c.id}`,token,{method:"PUT",body:JSON.stringify({messages,model:DEFAULT_MODEL})});
    setConvs(v=>v.map(x=>x.id===c.id?saved.data:x));
    return saved.data;
  }

  async function uploadOne(asset){
    const name=asset.name||"fisier";
    const type=asset.mimeType||"application/octet-stream";
    const url=`${GATEWAY}/api/files?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`;
    const result=await FileSystem.uploadAsync(url,asset.uri,{
      httpMethod:"POST",
      uploadType:FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers:{Authorization:`Bearer ${token}`,"Content-Type":type}
    });
    let d={};try{d=JSON.parse(result.body||"{}")}catch{}
    if(result.status<200||result.status>=300)throw new Error(d.error||`Upload HTTP ${result.status}`);
    return d.data;
  }

  async function pickFiles(){
    try{
      const result=await DocumentPicker.getDocumentAsync({multiple:true,copyToCacheDirectory:true});
      if(result.canceled)return;
      setUploading(true);
      const uploaded=[];
      for(const a of result.assets||[])uploaded.push(await uploadOne(a));
      setPendingFiles(v=>[...v,...uploaded]);
    }catch(e){Alert.alert("Atașament",e.message)}finally{setUploading(false)}
  }

  async function downloadAndShare(file){
    try{
      const safe=(file.name||"fisier").replace(/[^a-zA-Z0-9._-]/g,"_");
      const dest=(FileSystem.cacheDirectory||FileSystem.documentDirectory)+safe;
      const r=await FileSystem.downloadAsync(`${GATEWAY}/api/files/${file.id}`,dest,{headers:{Authorization:`Bearer ${token}`}});
      const ok=await Sharing.isAvailableAsync();
      if(ok)await Sharing.shareAsync(r.uri,{mimeType:file.mimeType||undefined,dialogTitle:file.name||"AI Stoica"});
      else Alert.alert("Fișier salvat",r.uri);
    }catch(e){Alert.alert("Fișier",e.message)}
  }

  async function send(){
    const p=text.trim();
    if((!p&&!pendingFiles.length)||busy)return;
    setBusy(true);
    const files=pendingFiles;setPendingFiles([]);setText("");
    try{
      let c=await ensureConversation(p||files[0]?.name||"Fișiere");
      const msg={id:String(Date.now()),role:"user",content:p||"Analizează și rezolvă fișierele atașate.",attachments:files,createdAt:Date.now()};
      const messages=[...(c.messages||[]),msg];
      setConvs(v=>v.map(x=>x.id===c.id?{...x,messages}:x));
      const d=await api("/api/chat",token,{method:"POST",body:JSON.stringify({model:DEFAULT_MODEL,messages})});
      const ans=d?.choices?.[0]?.message?.content||"Nu am primit răspuns.";
      let generatedAttachments=[];
      const requestedFormat=requestedDocumentFormat(p);
      if(requestedFormat){
        try{
          const previousAssistant=[...(c.messages||[])].reverse().find(m=>m.role==="assistant");
          const exportContent=standaloneExportRequest(p)&&previousAssistant?.content
            ? String(previousAssistant.content)
            : String(ans);
          const exported=await api("/api/export",token,{method:"POST",body:JSON.stringify({
            format:requestedFormat,
            title:c.title||"AI Stoica - document",
            content:exportContent
          })});
          if(exported?.data)generatedAttachments=[exported.data];
        }catch(e){
          Alert.alert("Document", "Răspunsul a fost generat, dar fișierul nu a putut fi creat: "+e.message);
        }
      }
      const final=[...messages,{id:`a${Date.now()}`,role:"assistant",content:String(ans),attachments:generatedAttachments,createdAt:Date.now(),provider:d.provider,model:d.model}];
      await saveMessages(c,final);
    }catch(e){Alert.alert("AI Stoica",e.message);setPendingFiles(files)}finally{setBusy(false)}
  }

  async function exportMessage(m,format){
    try{
      const d=await api("/api/export",token,{method:"POST",body:JSON.stringify({format,title:"AI Stoica - răspuns",content:m.content})});
      await downloadAndShare(d.data);
    }catch(e){Alert.alert("Export",e.message)}
  }

  async function generateImage(){
    const prompt=text.trim();
    if(!prompt)return Alert.alert("Imagine","Scrie mai întâi descrierea imaginii.");
    setBusy(true);
    try{
      let c=await ensureConversation("Imagine: "+prompt);
      const d=await api("/api/generate/image",token,{method:"POST",body:JSON.stringify({prompt})});
      const userMsg={id:String(Date.now()),role:"user",content:"Generează imagine: "+prompt,createdAt:Date.now()};
      const aiMsg={id:`img${Date.now()}`,role:"assistant",content:"Imagine generată de AI Stoica.",attachments:[d.data],createdAt:Date.now(),model:d.model};
      await saveMessages(c,[...(c.messages||[]),userMsg,aiMsg]);
      setText("");
    }catch(e){Alert.alert("Imagine",e.message)}finally{setBusy(false)}
  }

  async function solveGithub(){
    if(!ghPath.trim())return;
    setGhBusy(true);
    try{
      const d=await api("/api/github/solve",token,{method:"POST",body:JSON.stringify({path:ghPath.trim(),instruction:ghInstruction.trim()||undefined})});
      let c=await ensureConversation("GitHub: "+ghPath.trim());
      const m={id:`gh${Date.now()}`,role:"assistant",content:d.data.proposal,createdAt:Date.now(),githubProposal:d.data};
      await saveMessages(c,[...(c.messages||[]),{id:String(Date.now()),role:"user",content:`Rezolvă în GitHub ${ghPath.trim()}: ${ghInstruction.trim()||"corectează problema"}`,createdAt:Date.now()},m]);
      setGithubOpen(false);
    }catch(e){Alert.alert("GitHub",e.message)}finally{setGhBusy(false)}
  }

  async function applyGithub(g){
    Alert.alert("Aplică în GitHub","Această acțiune va modifica fișierul în repository.",[
      {text:"Anulează",style:"cancel"},
      {text:"Aplică",style:"destructive",onPress:async()=>{
        try{
          const d=await api("/api/github/apply",token,{method:"POST",body:JSON.stringify({path:g.path,content:g.proposal,sha:g.sha,branch:g.branch,message:`AI Stoica: rezolvare ${g.path}`})});
          Alert.alert("GitHub","Modificarea a fost trimisă. Commit: "+(d.data?.commit||"creat"));
        }catch(e){Alert.alert("GitHub",e.message)}
      }}
    ]);
  }

  async function copyText(value){await Clipboard.setStringAsync(String(value||""));}

  if(loading)return <SafeAreaView style={s.safeCenter}><ActivityIndicator color="#278cff"/></SafeAreaView>;
  if(!token)return <Auth onAuth={authDone}/>;

  return <SafeAreaView style={s.safe}><StatusBar style="light"/>
    <View style={s.header}>
      <TouchableOpacity onPress={()=>setMenu(true)}><Text style={s.menu}>☰</Text></TouchableOpacity>
      <View><Text style={s.headerTitle}>AI Stoica</Text><Text style={s.headerSub}>{DEFAULT_MODEL}</Text></View>
      <TouchableOpacity style={s.ghTop} onPress={()=>setGithubOpen(true)}><Text style={s.ghTopText}>GitHub</Text></TouchableOpacity>
      <TouchableOpacity style={s.newBtn} onPress={()=>{setCurrentId(null);setPendingFiles([])}}><Text style={s.newBtnText}>Nou</Text></TouchableOpacity>
    </View>

    <ScrollView style={s.chat} contentContainerStyle={s.chatContent}>
      {!current?.messages?.length?<View style={s.empty}><View style={s.logoBoxSmall}><Text style={s.logoAISmall}>AI</Text></View><Text style={s.big}>Trimite-mi orice fișier</Text><Text style={s.emptyText}>Poze, PDF, DOCX, CSV, cod. Îl citesc, îl analizez și îl rezolv.</Text></View>:
      current.messages.map((m,i)=><View key={m.id||i} style={m.role==="user"?s.userMsg:s.aiMsg}>
        {m.role==="assistant"&&<Text style={s.aiName}>AI Stoica</Text>}
        <Text selectable style={s.msgText}>{typeof m.content==="string"?m.content:"[Conținut]"}</Text>
        {!!m.attachments?.length&&<View style={s.fileWrap}>{m.attachments.map((a,j)=><TouchableOpacity key={a.id||j} style={s.fileChip} onPress={()=>downloadAndShare(a)}><Text style={s.fileChipText}>📎 {a.name}</Text></TouchableOpacity>)}</View>}
        {m.role==="assistant"&&<View style={s.actions}>
          <TouchableOpacity style={s.action} onPress={()=>copyText(m.content)}><Text style={s.actionText}>Copy</Text></TouchableOpacity>
          <TouchableOpacity style={s.action} onPress={()=>exportMessage(m,"pdf")}><Text style={s.actionText}>PDF</Text></TouchableOpacity>
          <TouchableOpacity style={s.action} onPress={()=>exportMessage(m,"docx")}><Text style={s.actionText}>DOCX</Text></TouchableOpacity>
          <TouchableOpacity style={s.action} onPress={()=>exportMessage(m,"pptx")}><Text style={s.actionText}>PPTX</Text></TouchableOpacity>
          {!!m.githubProposal&&<TouchableOpacity style={[s.action,s.apply]} onPress={()=>applyGithub(m.githubProposal)}><Text style={s.applyText}>Aplică în GitHub</Text></TouchableOpacity>}
        </View>}
      </View>)}
      {busy&&<ActivityIndicator color="#278cff"/>}
    </ScrollView>

    {!!pendingFiles.length&&<ScrollView horizontal style={s.pending} contentContainerStyle={s.pendingInner}>
      {pendingFiles.map((f,i)=><View key={f.id||i} style={s.pendingChip}><Text numberOfLines={1} style={s.pendingText}>📎 {f.name}</Text><TouchableOpacity onPress={()=>setPendingFiles(v=>v.filter(x=>x.id!==f.id))}><Text style={s.remove}>×</Text></TouchableOpacity></View>)}
    </ScrollView>}

    <View style={s.composer}>
      <TouchableOpacity style={s.attach} onPress={pickFiles} disabled={uploading}><Text style={s.attachText}>{uploading?"…":"＋"}</Text></TouchableOpacity>
      <TextInput style={s.textarea} multiline placeholder="Întreabă sau atașează un fișier" placeholderTextColor="#607086" value={text} onChangeText={setText}/>
      <TouchableOpacity style={s.imageBtn} onPress={generateImage}><Text style={s.imageBtnText}>▧</Text></TouchableOpacity>
      <TouchableOpacity style={s.send} onPress={send}><Text style={s.sendText}>↑</Text></TouchableOpacity>
    </View>

    <Modal visible={menu} transparent animationType="fade">
      <TouchableOpacity style={s.scrim} onPress={()=>setMenu(false)}>
        <View style={s.drawer}>
          <Text style={s.drawerTitle}>Conversații</Text>
          <TouchableOpacity style={s.githubMenu} onPress={()=>{setMenu(false);setGithubOpen(true)}}><Text style={s.githubMenuText}>⌘ GitHub Solve</Text></TouchableOpacity>
          <ScrollView>{convs.map(c=><TouchableOpacity key={c.id} style={s.drawerItem} onPress={()=>{setCurrentId(c.id);setMenu(false)}}><Text numberOfLines={1} style={s.drawerText}>{c.title}</Text></TouchableOpacity>)}</ScrollView>
          <View style={s.account}><Text style={s.accountName}>{user?.name}</Text><Text style={s.accountEmail}>{user?.email}</Text><TouchableOpacity onPress={logout}><Text style={s.logout}>Deconectare</Text></TouchableOpacity></View>
        </View>
      </TouchableOpacity>
    </Modal>

    <Modal visible={githubOpen} transparent animationType="slide">
      <View style={s.modalScrim}><View style={s.ghModal}>
        <Text style={s.ghTitle}>GitHub Solve</Text>
        <Text style={s.ghHelp}>AI Stoica citește fișierul, propune versiunea corectată, iar tu alegi separat dacă o aplici.</Text>
        <TextInput style={s.input} autoCapitalize="none" placeholder="ex: apps/mobile/app/index.js" placeholderTextColor="#627086" value={ghPath} onChangeText={setGhPath}/>
        <TextInput style={[s.input,s.ghInstructions]} multiline placeholder="Ce trebuie rezolvat?" placeholderTextColor="#627086" value={ghInstruction} onChangeText={setGhInstruction}/>
        <View style={s.ghButtons}>
          <TouchableOpacity style={s.cancelBtn} onPress={()=>setGithubOpen(false)}><Text style={s.cancelText}>Anulează</Text></TouchableOpacity>
          <TouchableOpacity style={s.primarySmall} onPress={solveGithub} disabled={ghBusy}><Text style={s.primaryText}>{ghBusy?"Analizez…":"Rezolvă"}</Text></TouchableOpacity>
        </View>
      </View></View>
    </Modal>
  </SafeAreaView>;
}

const s=StyleSheet.create({
  safe:{flex:1,backgroundColor:"#05070b"},safeCenter:{flex:1,backgroundColor:"#05070b",alignItems:"center",justifyContent:"center"},
  authWrap:{padding:24,alignItems:"center",justifyContent:"center",minHeight:"100%"},logoBox:{width:145,height:92,borderRadius:24,borderWidth:1,borderColor:"#31537a",alignItems:"center",justifyContent:"center",backgroundColor:"#09111c"},
  logoAI:{color:"#50a7ff",fontSize:36,fontWeight:"900"},logoStoica:{color:"#fff",fontSize:13,fontWeight:"800",letterSpacing:3},
  logoBoxSmall:{width:90,height:90,borderRadius:24,borderWidth:1,borderColor:"#31537a",alignItems:"center",justifyContent:"center",backgroundColor:"#09111c"},logoAISmall:{color:"#50a7ff",fontSize:34,fontWeight:"900"},
  title:{color:"#fff",fontSize:30,fontWeight:"800",marginTop:14},sub:{color:"#52749c",fontSize:10,letterSpacing:2,marginTop:4},
  card:{width:"100%",maxWidth:430,backgroundColor:"#0d131d",borderColor:"#243248",borderWidth:1,borderRadius:20,padding:18,marginTop:24},
  tabs:{flexDirection:"row",backgroundColor:"#080c12",borderRadius:10,padding:3,marginBottom:15},tab:{flex:1,padding:9,borderRadius:8,alignItems:"center"},tabOn:{backgroundColor:"#151e2a"},tabText:{color:"#cdd7e4"},
  input:{backgroundColor:"#080d14",borderColor:"#26354a",borderWidth:1,borderRadius:10,color:"white",padding:12,marginVertical:6},
  primary:{backgroundColor:"#197ce2",padding:13,borderRadius:10,alignItems:"center",marginTop:8},primarySmall:{backgroundColor:"#197ce2",paddingHorizontal:20,paddingVertical:12,borderRadius:10,alignItems:"center"},
  primaryText:{color:"white",fontWeight:"700"},err:{color:"#ff93a1",marginTop:5},
  header:{height:68,borderBottomWidth:1,borderBottomColor:"#1e2938",flexDirection:"row",alignItems:"center",paddingHorizontal:14,gap:10},menu:{color:"#d8e2ef",fontSize:25},
  headerTitle:{color:"#fff",fontWeight:"700",fontSize:16},headerSub:{color:"#617087",fontSize:9,marginTop:2},ghTop:{marginLeft:"auto",borderColor:"#30517a",borderWidth:1,borderRadius:10,paddingHorizontal:10,paddingVertical:8},ghTopText:{color:"#7fbaff",fontWeight:"700"},
  newBtn:{borderColor:"#2a384d",borderWidth:1,borderRadius:10,paddingHorizontal:10,paddingVertical:8},newBtnText:{color:"#dce6f2"},
  chat:{flex:1},chatContent:{padding:16,paddingBottom:150},empty:{marginTop:70,alignItems:"center"},big:{color:"#fff",fontSize:28,fontWeight:"800",textAlign:"center",marginTop:18},emptyText:{color:"#77879c",fontSize:14,textAlign:"center",lineHeight:21,marginTop:10,maxWidth:330},
  userMsg:{alignSelf:"flex-end",maxWidth:"90%",backgroundColor:"#151d29",borderRadius:18,padding:12,marginVertical:8},aiMsg:{alignSelf:"stretch",marginVertical:14},
  aiName:{color:"#4ba2ff",fontWeight:"700",fontSize:12,marginBottom:5},msgText:{color:"#e7edf6",fontSize:16,lineHeight:24},
  fileWrap:{marginTop:8,gap:6},fileChip:{backgroundColor:"#0b1522",borderColor:"#29496c",borderWidth:1,borderRadius:10,padding:9},fileChipText:{color:"#9ecbff",fontSize:12},
  actions:{flexDirection:"row",flexWrap:"wrap",gap:7,marginTop:9},action:{borderColor:"#29384c",borderWidth:1,borderRadius:9,paddingHorizontal:10,paddingVertical:6},actionText:{color:"#aab9cb",fontSize:12},apply:{borderColor:"#2d855d",backgroundColor:"#0d241a"},applyText:{color:"#8ee2b8",fontSize:12,fontWeight:"700"},
  pending:{position:"absolute",left:10,right:10,bottom:78,maxHeight:46},pendingInner:{gap:7,alignItems:"center"},pendingChip:{maxWidth:220,height:38,flexDirection:"row",alignItems:"center",gap:7,backgroundColor:"#101a28",borderColor:"#29496c",borderWidth:1,borderRadius:11,paddingHorizontal:10},pendingText:{color:"#b9d8fa",fontSize:11,flexShrink:1},remove:{color:"#ff9da9",fontSize:20},
  composer:{position:"absolute",left:10,right:10,bottom:10,backgroundColor:"#0d131d",borderColor:"#253247",borderWidth:1,borderRadius:22,padding:7,flexDirection:"row",alignItems:"flex-end"},
  attach:{width:40,height:42,borderRadius:12,alignItems:"center",justifyContent:"center"},attachText:{color:"#8fbce9",fontSize:27},textarea:{flex:1,color:"white",fontSize:16,minHeight:44,maxHeight:140,padding:10},
  imageBtn:{width:40,height:42,borderRadius:12,backgroundColor:"#121d2b",alignItems:"center",justifyContent:"center",marginRight:6},imageBtnText:{color:"#9dc8f2",fontSize:20},
  send:{width:42,height:42,borderRadius:13,backgroundColor:"#eef4fb",alignItems:"center",justifyContent:"center"},sendText:{color:"#09101a",fontSize:21,fontWeight:"800"},
  scrim:{flex:1,backgroundColor:"#0009"},drawer:{width:"82%",height:"100%",backgroundColor:"#090d14",borderRightColor:"#1e2938",borderRightWidth:1,paddingTop:55,paddingHorizontal:12},
  drawerTitle:{color:"white",fontSize:18,fontWeight:"700",marginBottom:12},drawerItem:{padding:11,borderRadius:9},drawerText:{color:"#c5cfdd"},githubMenu:{padding:12,borderRadius:10,backgroundColor:"#0d1724",marginBottom:8},githubMenuText:{color:"#7fbaff",fontWeight:"700"},
  account:{borderTopColor:"#1e2938",borderTopWidth:1,paddingVertical:14,marginTop:"auto"},accountName:{color:"white",fontWeight:"700"},accountEmail:{color:"#6e7d91",fontSize:12,marginTop:3},logout:{color:"#7fbaff",marginTop:12},
  modalScrim:{flex:1,backgroundColor:"#000b",justifyContent:"center",padding:18},ghModal:{backgroundColor:"#0c121c",borderColor:"#263750",borderWidth:1,borderRadius:20,padding:18},
  ghTitle:{color:"#fff",fontSize:22,fontWeight:"800"},ghHelp:{color:"#77879c",fontSize:13,lineHeight:19,marginVertical:10},ghInstructions:{minHeight:110,textAlignVertical:"top"},ghButtons:{flexDirection:"row",justifyContent:"flex-end",gap:10,marginTop:10},cancelBtn:{paddingHorizontal:18,paddingVertical:12},cancelText:{color:"#9aa9bb"}
});
