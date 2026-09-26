import express from "express";
import cors from "cors";
import helmet from "helmet";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const app = express();
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: true }));
app.use(express.json({ limit: "25mb" }));

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";
const dataDir = path.resolve(process.env.DATA_DIR || "./data");
const dataFile = path.join(dataDir, "ai-stoica-data.json");
const omniBase = (process.env.OMNIROUTE_BASE_URL || "http://127.0.0.1:20128/v1").replace(/\/+$/, "");
const omniKey = process.env.OMNIROUTE_API_KEY || "";
const defaultModel = process.env.OMNIROUTE_MODEL || "Ai principal";
const jwtSecret = process.env.JWT_SECRET || crypto.createHash("sha256").update(`ai-stoica-${dataDir}`).digest("hex");

function readDb(){try{return {...{users:[],conversations:[],projects:[],assistants:[]},...JSON.parse(fs.readFileSync(dataFile,"utf8"))}}catch{return {users:[],conversations:[],projects:[],assistants:[]}}}
function writeDb(db){fs.mkdirSync(dataDir,{recursive:true});const tmp=`${dataFile}.tmp`;fs.writeFileSync(tmp,JSON.stringify(db,null,2));fs.renameSync(tmp,dataFile)}
function email(v){return String(v||"").trim().toLowerCase()}
function pub(u){return {id:u.id,email:u.email,name:u.name||u.email.split("@")[0],createdAt:u.createdAt}}
function sign(u){return jwt.sign({sub:u.id,email:u.email},jwtSecret,{expiresIn:"30d"})}
function auth(req,res,next){const raw=String(req.headers.authorization||"");const token=raw.startsWith("Bearer ")?raw.slice(7):"";try{const p=jwt.verify(token,jwtSecret);const u=readDb().users.find(x=>x.id===p.sub);if(!u)return res.status(401).json({error:"Sesiune invalidă."});req.user=u;next()}catch{return res.status(401).json({error:"Autentificare necesară."})}}
function withAssistant(messages,assistantId,userId){const a=readDb().assistants.find(x=>x.id===assistantId&&x.userId===userId);return a?.systemPrompt?[{role:"system",content:a.systemPrompt},...messages.filter(m=>m.role!=="system")]:messages}

app.get("/health",async(_req,res)=>{let omni=false;try{const r=await fetch(`${omniBase}/models`,{headers:omniKey?{Authorization:`Bearer ${omniKey}`}:{},signal:AbortSignal.timeout(2500)});omni=r.status>0}catch{}res.json({ok:true,service:"AI Stoica Gateway",omni,model:defaultModel})});
app.post("/auth/register",async(req,res)=>{const e=email(req.body?.email),p=String(req.body?.password||""),name=String(req.body?.name||"").trim();if(!/^\S+@\S+\.\S+$/.test(e))return res.status(400).json({error:"Email invalid."});if(p.length<8)return res.status(400).json({error:"Parola trebuie să aibă minimum 8 caractere."});const db=readDb();if(db.users.some(u=>u.email===e))return res.status(409).json({error:"Contul există deja."});const u={id:crypto.randomUUID(),email:e,name:name||e.split("@")[0],passwordHash:await bcrypt.hash(p,12),createdAt:Date.now()};db.users.push(u);db.assistants.push({id:crypto.randomUUID(),userId:u.id,name:"AI Stoica",icon:"S",systemPrompt:"Ești AI Stoica, asistentul principal Stoica Enterprises AI. Răspunde clar, riguros și util, în limba utilizatorului.",createdAt:Date.now(),builtIn:true});writeDb(db);res.json({token:sign(u),user:pub(u)})});
app.post("/auth/login",async(req,res)=>{const e=email(req.body?.email),p=String(req.body?.password||"");const u=readDb().users.find(x=>x.email===e);if(!u||!(await bcrypt.compare(p,u.passwordHash)))return res.status(401).json({error:"Email sau parolă incorectă."});res.json({token:sign(u),user:pub(u)})});
app.get("/auth/me",auth,(req,res)=>res.json({user:pub(req.user)}));
app.get("/api/models",auth,async(_req,res)=>{try{const r=await fetch(`${omniBase}/models`,{headers:omniKey?{Authorization:`Bearer ${omniKey}`}:{}});res.status(r.status).type("application/json").send(await r.text())}catch(e){res.status(502).json({error:String(e)})}});
app.get("/api/projects",auth,(req,res)=>res.json({data:readDb().projects.filter(x=>x.userId===req.user.id)}));
app.post("/api/projects",auth,(req,res)=>{const db=readDb();const item={id:crypto.randomUUID(),userId:req.user.id,name:String(req.body?.name||"Proiect"),createdAt:Date.now(),updatedAt:Date.now()};db.projects.push(item);writeDb(db);res.json({data:item})});
app.get("/api/assistants",auth,(req,res)=>res.json({data:readDb().assistants.filter(x=>x.userId===req.user.id)}));
app.post("/api/assistants",auth,(req,res)=>{const db=readDb();const item={id:crypto.randomUUID(),userId:req.user.id,name:String(req.body?.name||"Asistent"),systemPrompt:String(req.body?.systemPrompt||""),createdAt:Date.now(),builtIn:false};db.assistants.push(item);writeDb(db);res.json({data:item})});
app.get("/api/conversations",auth,(req,res)=>res.json({data:readDb().conversations.filter(x=>x.userId===req.user.id).sort((a,b)=>b.updatedAt-a.updatedAt)}));
app.post("/api/conversations",auth,(req,res)=>{const db=readDb(),now=Date.now();const item={id:crypto.randomUUID(),userId:req.user.id,title:String(req.body?.title||"Conversație nouă"),projectId:req.body?.projectId||null,assistantId:req.body?.assistantId||null,model:req.body?.model||defaultModel,messages:Array.isArray(req.body?.messages)?req.body.messages:[],createdAt:now,updatedAt:now};db.conversations.push(item);writeDb(db);res.json({data:item})});
app.put("/api/conversations/:id",auth,(req,res)=>{const db=readDb();const item=db.conversations.find(x=>x.id===req.params.id&&x.userId===req.user.id);if(!item)return res.status(404).json({error:"Conversația nu a fost găsită."});for(const k of ["title","projectId","assistantId","model","messages"])if(Object.prototype.hasOwnProperty.call(req.body||{},k))item[k]=req.body[k];item.updatedAt=Date.now();writeDb(db);res.json({data:item})});
app.delete("/api/conversations/:id",auth,(req,res)=>{const db=readDb();db.conversations=db.conversations.filter(x=>!(x.id===req.params.id&&x.userId===req.user.id));writeDb(db);res.json({ok:true})});
app.post("/api/chat",auth,async(req,res)=>{const messages=withAssistant(Array.isArray(req.body?.messages)?req.body.messages:[],req.body?.assistantId,req.user.id);try{const r=await fetch(`${omniBase}/chat/completions`,{method:"POST",headers:{"Content-Type":"application/json",...(omniKey?{Authorization:`Bearer ${omniKey}`}:{})},body:JSON.stringify({model:req.body?.model||defaultModel,messages,stream:false,temperature:.4})});res.status(r.status).type("application/json").send(await r.text())}catch(e){res.status(502).json({error:String(e)})}});
app.post("/api/chat/stream",auth,async(req,res)=>{const messages=withAssistant(Array.isArray(req.body?.messages)?req.body.messages:[],req.body?.assistantId,req.user.id);try{const up=await fetch(`${omniBase}/chat/completions`,{method:"POST",headers:{"Content-Type":"application/json",...(omniKey?{Authorization:`Bearer ${omniKey}`}:{})},body:JSON.stringify({model:req.body?.model||defaultModel,messages,stream:true,temperature:.4})});if(!up.ok)return res.status(up.status).send(await up.text());const ct=up.headers.get("content-type")||"";res.setHeader("Content-Type","text/event-stream; charset=utf-8");res.setHeader("Cache-Control","no-cache");if(!ct.includes("text/event-stream")){const j=await up.json();const t=j?.choices?.[0]?.message?.content||"";res.write(`data: ${JSON.stringify({choices:[{delta:{content:t}}]})}\n\ndata: [DONE]\n\n`);return res.end()}const reader=up.body.getReader();while(true){const {value,done}=await reader.read();if(done)break;res.write(Buffer.from(value))}res.end()}catch(e){if(!res.headersSent)res.status(502).json({error:String(e)});else res.end()}});

app.listen(port,host,()=>console.log(`AI Stoica Gateway: http://${host}:${port}`));
