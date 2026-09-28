const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const fontkitModule = require("@pdf-lib/fontkit");
const fontkit = fontkitModule.default || fontkitModule;
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = require("docx");
const PptxGenJS = require("pptxgenjs");

function createStore(dataDir) {
  const file = path.join(dataDir, "ai-stoica-data.json");
  const empty = {
    users: [], conversations: [], projects: [], assistants: [],
    memories: [], library: [], plugins: [], automations: []
  };
  function read() {
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      return { ...structuredClone(empty), ...data };
    } catch {
      return structuredClone(empty);
    }
  }
  function write(data) {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmp, file);
  }
  return { read, write };
}

function loadOrCreateSecret(dataDir) {
  const file = path.join(dataDir, "auth-secret.txt");
  try { return fs.readFileSync(file, "utf8").trim(); } catch {}
  fs.mkdirSync(dataDir, { recursive: true });
  const secret = crypto.randomBytes(48).toString("hex");
  fs.writeFileSync(file, secret, { encoding: "utf8", mode: 0o600 });
  return secret;
}

function normalizeEmail(email) { return String(email || "").trim().toLowerCase(); }
function publicUser(user) {
  return {
    id: user.id, email: user.email, name: user.name || user.email.split("@")[0],
    createdAt: user.createdAt, memoryEnabled: user.memoryEnabled !== false
  };
}
function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((x) => x?.type === "text").map((x) => x.text || "").join("\n");
}
function tokenize(text) {
  return [...new Set(String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").match(/[a-z0-9]{3,}/g) || [])];
}
function memoryMatches(db, userId, query, limit = 10) {
  const words = tokenize(query);
  return db.memories
    .filter((m) => m.userId === userId)
    .map((m) => {
      const hay = String(m.text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
      let score = m.pinned ? 6 : 0;
      for (const w of words) if (hay.includes(w)) score += 2;
      if (!words.length) score += 1;
      return { m, score };
    })
    .filter((x) => x.score > 0)
    .sort((a,b) => b.score - a.score || b.m.createdAt - a.m.createdAt)
    .slice(0, limit)
    .map((x) => x.m);
}
function addMemory(db, userId, text, source = "conversation", extra = {}) {
  const clean = String(text || "").trim();
  if (!clean) return null;
  const item = {
    id: crypto.randomUUID(), userId, text: clean.slice(0, 12000), source,
    pinned: !!extra.pinned, conversationId: extra.conversationId || null,
    createdAt: Date.now()
  };
  db.memories.push(item);
  return item;
}
function pluginHeaders(plugin) {
  const out = { "Content-Type": "application/json" };
  if (plugin.apiKey) {
    if ((plugin.authType || "bearer") === "header") out[plugin.headerName || "X-API-Key"] = plugin.apiKey;
    else out.Authorization = `Bearer ${plugin.apiKey}`;
  }
  return out;
}
async function callPlugin(plugin, message) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const method = (plugin.method || "POST").toUpperCase();
    let url = plugin.url;
    const init = { method, headers: pluginHeaders(plugin), signal: controller.signal };
    if (method === "GET") {
      const u = new URL(url); u.searchParams.set("q", message); url = u.toString();
    } else {
      init.body = JSON.stringify({ message, source: "AI Stoica", plugin: plugin.name });
    }
    const r = await fetch(url, init);
    const body = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${body.slice(0,300)}`);
    try { return JSON.stringify(JSON.parse(body)); } catch { return body; }
  } finally { clearTimeout(timer); }
}
async function pluginContext(db, userId, latestText) {
  const enabled = db.plugins.filter((p) => p.userId === userId && p.enabled !== false && p.url);
  const out = [];
  for (const p of enabled) {
    const trigger = String(p.trigger || `@${String(p.name || "").toLowerCase().replace(/\s+/g,"-")}`).toLowerCase();
    if (!p.auto && !String(latestText || "").toLowerCase().includes(trigger)) continue;
    try {
      const result = await callPlugin(p, latestText);
      out.push(`Plugin ${p.name}: ${String(result).slice(0,12000)}`);
    } catch (e) {
      out.push(`Plugin ${p.name} a eșuat: ${e.message}`);
    }
  }
  return out;
}
function nextRun(automation, from = Date.now()) {
  const d = new Date(from);
  const freq = automation.frequency || "daily";
  if (freq === "once") return Number(automation.runAt || 0) || null;
  if (freq === "hourly") return from + 60 * 60 * 1000;
  const [hh, mm] = String(automation.time || "09:00").split(":").map(Number);
  const next = new Date(d); next.setSeconds(0,0); next.setHours(hh || 0, mm || 0, 0, 0);
  if (next.getTime() <= from) next.setDate(next.getDate() + 1);
  if (freq === "weekly") {
    const target = Number.isInteger(Number(automation.weekday)) ? Number(automation.weekday) : 1;
    while (next.getDay() !== target || next.getTime() <= from) next.setDate(next.getDate() + 1);
  }
  if (freq === "selected_days") {
    const days = Array.isArray(automation.days) ? automation.days.map(Number) : [];
    if (!days.length) return null;
    while (!days.includes(next.getDay()) || next.getTime() <= from) next.setDate(next.getDate() + 1);
  }
  return next.getTime();
}

function safeGeneratedName(value) {
  return String(value || "AI Stoica").replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 120) || "AI Stoica";
}
function parseDocumentBlocks(content) {
  const lines = String(content || "").replace(/\r/g, "").split("\n");
  const blocks = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { blocks.push({ type: "blank", text: "" }); continue; }
    let m = line.match(/^(#{1,4})\s+(.+)$/);
    if (m) { blocks.push({ type: "heading", level: m[1].length, text: m[2].trim() }); continue; }
    m = line.match(/^[-*•]\s+(.+)$/);
    if (m) { blocks.push({ type: "bullet", text: m[1].trim() }); continue; }
    m = line.match(/^(\d+)[.)]\s+(.+)$/);
    if (m) { blocks.push({ type: "number", text: m[2].trim(), number: Number(m[1]) }); continue; }
    blocks.push({ type: "paragraph", text: line });
  }
  return blocks;
}
function plainMarkdownText(value) {
  return String(value || "").replace(/\*\*(.*?)\*\*/g, "$1").replace(/__(.*?)__/g, "$1").replace(/`([^`]+)`/g, "$1");
}
function inlineRuns(text, size = 22) {
  const src = String(text || "");
  const runs = [];
  const re = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`)/g;
  let pos = 0, m;
  while ((m = re.exec(src))) {
    if (m.index > pos) runs.push(new TextRun({ text: src.slice(pos, m.index), size }));
    const token = m[0];
    if (token.startsWith("**") || token.startsWith("__")) runs.push(new TextRun({ text: token.slice(2, -2), size, bold: true }));
    else runs.push(new TextRun({ text: token.slice(1, -1), size, font: "Consolas" }));
    pos = m.index + token.length;
  }
  if (pos < src.length) runs.push(new TextRun({ text: src.slice(pos), size }));
  return runs.length ? runs : [new TextRun({ text: src, size })];
}
function findWindowsFont() {
  const candidates = [
    path.join(process.env.WINDIR || "C:\\Windows", "Fonts", "segoeui.ttf"),
    path.join(process.env.WINDIR || "C:\\Windows", "Fonts", "arial.ttf"),
    path.join(process.env.WINDIR || "C:\\Windows", "Fonts", "calibri.ttf")
  ];
  return candidates.find(p => fs.existsSync(p)) || null;
}
function wrapTextByWidth(text, maxChars) {
  const words = String(text || "").split(/\s+/);
  const out = []; let cur = "";
  for (const word of words) {
    const candidate = (cur + " " + word).trim();
    if (candidate.length > maxChars && cur) { out.push(cur); cur = word; }
    else cur = candidate;
  }
  if (cur || !out.length) out.push(cur);
  return out;
}
async function createPdfBytes(title, content) {
  const pdf = await PDFDocument.create();
  let regular, bold, unicode = false;
  const fontPath = findWindowsFont();
  if (fontPath) {
    try {
      pdf.registerFontkit(fontkit);
      const fontBytes = fs.readFileSync(fontPath);
      regular = await pdf.embedFont(fontBytes, { subset: true });
      bold = regular;
      unicode = true;
    } catch {}
  }
  if (!regular) { regular = await pdf.embedFont(StandardFonts.Helvetica); bold = await pdf.embedFont(StandardFonts.HelveticaBold); }
  const clean = v => unicode ? String(v || "") : String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[șş]/g,"s").replace(/[ȘŞ]/g,"S").replace(/[țţ]/g,"t").replace(/[ȚŢ]/g,"T");
  let page = pdf.addPage([595.28, 841.89]), y = 792;
  const draw = (text, opts = {}) => {
    const size = opts.size || 11, indent = opts.indent || 0, font = opts.bold ? bold : regular;
    const max = Math.max(28, Math.floor((88 - indent / 7) * (11 / size)));
    for (const line of wrapTextByWidth(clean(plainMarkdownText(text)), max)) {
      if (y < 58) { page = pdf.addPage([595.28, 841.89]); y = 792; }
      page.drawText(line || " ", { x: 48 + indent, y, size, font, color: rgb(0.12,0.15,0.2) });
      y -= size + (opts.after == null ? 5 : opts.after);
    }
  };
  draw(title || "AI Stoica", { size: 20, bold: true, after: 8 }); y -= 8;
  for (const b of parseDocumentBlocks(content)) {
    if (b.type === "blank") { y -= 6; continue; }
    if (b.type === "heading") { y -= 3; draw(b.text, { size: b.level === 1 ? 17 : b.level === 2 ? 15 : 13, bold: true, after: 7 }); continue; }
    if (b.type === "bullet") { draw("• " + b.text, { indent: 10, after: 4 }); continue; }
    if (b.type === "number") { draw(String(b.number) + ". " + b.text, { indent: 10, after: 4 }); continue; }
    draw(b.text, { after: 5 });
  }
  return Buffer.from(await pdf.save());
}
async function createDocxBytes(title, content) {
  const children = [
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: String(title || "AI Stoica"), bold: true, size: 36 })] }),
    new Paragraph({ text: "" })
  ];
  for (const b of parseDocumentBlocks(content)) {
    if (b.type === "blank") { children.push(new Paragraph({ text: "" })); continue; }
    if (b.type === "heading") {
      const level = b.level <= 1 ? HeadingLevel.HEADING_1 : b.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
      children.push(new Paragraph({ heading: level, children: inlineRuns(b.text, b.level <= 1 ? 30 : 26) }));
      continue;
    }
    if (b.type === "bullet") { children.push(new Paragraph({ bullet: { level: 0 }, children: inlineRuns(b.text, 22) })); continue; }
    if (b.type === "number") { children.push(new Paragraph({ children: [new TextRun({ text: String(b.number) + ". ", bold: true, size: 22 }), ...inlineRuns(b.text,22)] })); continue; }
    children.push(new Paragraph({ children: inlineRuns(b.text,22), spacing: { after: 120 } }));
  }
  const doc = new Document({ sections: [{ properties: {}, children }] });
  return Buffer.from(await Packer.toBuffer(doc));
}
function slideChunks(content, maxChars = 850) {
  const blocks = parseDocumentBlocks(content).filter(b => b.type !== "blank");
  const slides = []; let current = { title: "", body: [] }, chars = 0;
  const flush = () => { if (current.title || current.body.length) slides.push(current); current = { title: "", body: [] }; chars = 0; };
  for (const b of blocks) {
    if (b.type === "heading" && b.level <= 2) { if (current.title || current.body.length) flush(); current.title = plainMarkdownText(b.text); continue; }
    const prefix = b.type === "bullet" ? "• " : b.type === "number" ? String(b.number) + ". " : "";
    const text = prefix + plainMarkdownText(b.text);
    if (chars + text.length > maxChars && current.body.length) flush();
    current.body.push(text); chars += text.length;
  }
  flush();
  return slides.length ? slides : [{ title: "", body: [plainMarkdownText(content)] }];
}
async function createPptxBytes(title, content) {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "AI Stoica"; pptx.company = "Stoica Enterprises AI"; pptx.lang = "ro-RO";
  let s = pptx.addSlide(); s.background = { color: "F7F9FC" };
  s.addText(String(title || "AI Stoica"), { x:0.8,y:2.3,w:11.7,h:0.8,fontFace:"Aptos Display",fontSize:28,bold:true,color:"172033",align:"center",margin:0 });
  s.addText("Document generat cu AI Stoica", { x:1.2,y:3.25,w:10.9,h:0.4,fontFace:"Aptos",fontSize:14,color:"52627A",align:"center",margin:0 });
  for (const part of slideChunks(content)) {
    s = pptx.addSlide(); s.background = { color: "FFFFFF" };
    s.addText(part.title || String(title || "AI Stoica"), { x:0.65,y:0.45,w:12,h:0.55,fontFace:"Aptos Display",fontSize:23,bold:true,color:"172033",margin:0 });
    s.addText(part.body.join("\n"), { x:0.8,y:1.25,w:11.7,h:5.65,fontFace:"Aptos",fontSize:18,color:"26354A",valign:"top",margin:0.08,fit:"shrink",breakLine:false });
  }
  const out = await pptx.write({ outputType: "arraybuffer" });
  return Buffer.from(out);
}

function startLocalGateway({ dataDir, port = 8787, host = "127.0.0.1", serviceName = "AI Stoica Gateway", getOmniConfig }) {
  const store = createStore(dataDir);
  const secret = loadOrCreateSecret(dataDir);
  const filesDir = path.join(dataDir, "library-files");
  fs.mkdirSync(filesDir, { recursive: true });
  const app = express();
  app.use(helmet({ crossOriginResourcePolicy: false }));
  app.use(cors({ origin: true, credentials: false }));
  app.use(express.json({ limit: "64mb" }));

  function sign(user) { return jwt.sign({ sub: user.id, email: user.email }, secret); }
  function auth(req, res, next) {
    const raw = String(req.headers.authorization || "");
    const token = raw.startsWith("Bearer ") ? raw.slice(7) : "";
    try {
      const payload = jwt.verify(token, secret);
      const db = store.read();
      const user = db.users.find((u) => u.id === payload.sub);
      if (!user) return res.status(401).json({ error: "Sesiune invalidă." });
      req.user = user; next();
    } catch { return res.status(401).json({ error: "Autentificare necesară." }); }
  }

  app.get("/health", async (_req, res) => {
    const cfg = getOmniConfig(); let omni = false;
    try {
      const r = await fetch(`${String(cfg.baseUrl).replace(/\/+$/, "")}/models`, {
        headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
        signal: AbortSignal.timeout(2500)
      }); omni = r.status > 0;
    } catch {}
    res.json({ ok: true, service: serviceName, omni, model: cfg.model || "Ai principal" });
  });

  app.post("/auth/register", async (req, res) => {
    const email = normalizeEmail(req.body?.email), password = String(req.body?.password || ""), name = String(req.body?.name || "").trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Adresa de email nu este validă." });
    if (password.length < 8) return res.status(400).json({ error: "Parola trebuie să aibă cel puțin 8 caractere." });
    const db = store.read();
    if (db.users.some((u) => u.email === email)) return res.status(409).json({ error: "Există deja un cont cu acest email." });
    const user = { id: crypto.randomUUID(), email, name: name || email.split("@")[0], passwordHash: await bcrypt.hash(password, 12), memoryEnabled: true, createdAt: Date.now() };
    db.users.push(user);
    db.assistants.push({ id: crypto.randomUUID(), userId: user.id, name: "AI Stoica", icon: "S", systemPrompt: "Ești AI Stoica, asistentul principal Stoica Enterprises AI. Răspunde clar, riguros și util, în limba utilizatorului.", createdAt: Date.now(), builtIn: true });
    store.write(db); res.json({ token: sign(user), user: publicUser(user) });
  });

  app.post("/auth/login", async (req, res) => {
    const email = normalizeEmail(req.body?.email), password = String(req.body?.password || "");
    const db = store.read(), user = db.users.find((u) => u.email === email);
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: "Email sau parolă incorectă." });
    if (typeof user.memoryEnabled !== "boolean") { user.memoryEnabled = true; store.write(db); }
    res.json({ token: sign(user), user: publicUser(user) });
  });
  app.get("/auth/me", auth, (req, res) => res.json({ token: sign(req.user), user: publicUser(req.user) }));

  app.get("/api/models", auth, async (_req, res) => {
    const cfg = getOmniConfig();
    try {
      const r = await fetch(`${String(cfg.baseUrl).replace(/\/+$/, "")}/models`, { headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {} });
      res.status(r.status).type("application/json").send(await r.text());
    } catch (e) { res.status(502).json({ error: `Nu mă pot conecta la OmniRoute: ${e.message}` }); }
  });

  app.get("/api/projects", auth, (req,res) => { const db=store.read(); res.json({data:db.projects.filter(x=>x.userId===req.user.id).sort((a,b)=>b.updatedAt-a.updatedAt)}); });
  app.post("/api/projects", auth, (req,res) => {
    const name=String(req.body?.name||"").trim(); if(!name)return res.status(400).json({error:"Numele proiectului este obligatoriu."});
    const db=store.read(), item={id:crypto.randomUUID(),userId:req.user.id,name,createdAt:Date.now(),updatedAt:Date.now()}; db.projects.push(item);store.write(db);res.json({data:item});
  });
  app.get("/api/assistants", auth, (req,res) => { const db=store.read();res.json({data:db.assistants.filter(x=>x.userId===req.user.id).sort((a,b)=>Number(b.builtIn)-Number(a.builtIn)||a.name.localeCompare(b.name))}); });
  app.post("/api/assistants", auth, (req,res) => {
    const name=String(req.body?.name||"").trim(),systemPrompt=String(req.body?.systemPrompt||"").trim();if(!name)return res.status(400).json({error:"Numele asistentului este obligatoriu."});
    const db=store.read(),item={id:crypto.randomUUID(),userId:req.user.id,name,icon:name[0]?.toUpperCase()||"A",systemPrompt,createdAt:Date.now(),builtIn:false};db.assistants.push(item);store.write(db);res.json({data:item});
  });

  app.get("/api/conversations", auth, (req,res) => {const db=store.read();res.json({data:db.conversations.filter(x=>x.userId===req.user.id).sort((a,b)=>b.updatedAt-a.updatedAt)});});
  app.post("/api/conversations", auth, (req,res) => {
    const now=Date.now(),db=store.read(),item={id:crypto.randomUUID(),userId:req.user.id,title:String(req.body?.title||"Conversație nouă"),projectId:req.body?.projectId||null,assistantId:req.body?.assistantId||null,model:req.body?.model||null,messages:Array.isArray(req.body?.messages)?req.body.messages:[],createdAt:now,updatedAt:now};
    db.conversations.push(item);store.write(db);res.json({data:item});
  });
  app.put("/api/conversations/:id", auth, (req,res) => {
    const db=store.read(),item=db.conversations.find(x=>x.id===req.params.id&&x.userId===req.user.id);if(!item)return res.status(404).json({error:"Conversația nu a fost găsită."});
    for(const k of ["title","projectId","assistantId","model","messages","archived"])if(Object.prototype.hasOwnProperty.call(req.body||{},k))item[k]=req.body[k];
    item.updatedAt=Date.now();store.write(db);res.json({data:item});
  });
  app.delete("/api/conversations/:id", auth, (req,res) => {
    const db=store.read(),before=db.conversations.length;db.conversations=db.conversations.filter(x=>!(x.id===req.params.id&&x.userId===req.user.id));if(db.conversations.length===before)return res.status(404).json({error:"Conversația nu a fost găsită."});store.write(db);res.json({ok:true});
  });

  app.get("/api/memory", auth, (req,res) => {
    const db=store.read(),user=db.users.find(u=>u.id===req.user.id);
    const q=String(req.query.q||"");const data=q?memoryMatches(db,req.user.id,q,100):db.memories.filter(m=>m.userId===req.user.id).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.createdAt-a.createdAt);
    res.json({enabled:user?.memoryEnabled!==false,data});
  });
  app.post("/api/memory/toggle", auth, (req,res) => {
    const db=store.read(),user=db.users.find(u=>u.id===req.user.id);user.memoryEnabled=!!req.body?.enabled;store.write(db);res.json({enabled:user.memoryEnabled});
  });
  app.post("/api/memory", auth, (req,res) => {
    const db=store.read(),item=addMemory(db,req.user.id,req.body?.text,"manual",{pinned:!!req.body?.pinned});if(!item)return res.status(400).json({error:"Memoria este goală."});store.write(db);res.json({data:item});
  });
  app.post("/api/memory/capture", auth, (req,res) => {
    const db=store.read(),user=db.users.find(u=>u.id===req.user.id);if(user?.memoryEnabled===false)return res.json({ok:true,stored:false});
    const userText=String(req.body?.userText||"").trim(),assistantText=String(req.body?.assistantText||"").trim();
    const text=[userText&&`Utilizator: ${userText}`,assistantText&&`AI Stoica: ${assistantText}`].filter(Boolean).join("\n");
    const item=addMemory(db,req.user.id,text,"conversation",{conversationId:req.body?.conversationId||null});if(item)store.write(db);res.json({ok:true,stored:!!item,data:item});
  });
  app.post("/api/memory/import-history", auth, (req,res) => {
    const db=store.read();let count=0;
    for(const c of db.conversations.filter(x=>x.userId===req.user.id)){
      for(let i=0;i<c.messages.length;i+=2){
        const u=c.messages[i],a=c.messages[i+1];if(u?.role!=="user")continue;
        const text=[`Utilizator: ${textFromContent(u.content)}`,a?.role==="assistant"?`AI Stoica: ${textFromContent(a.content)}`:""].filter(Boolean).join("\n").trim();
        if(text){addMemory(db,req.user.id,text,"history",{conversationId:c.id});count++;}
      }
    }
    store.write(db);res.json({ok:true,count});
  });
  app.patch("/api/memory/:id", auth, (req,res) => {
    const db=store.read(),item=db.memories.find(m=>m.id===req.params.id&&m.userId===req.user.id);if(!item)return res.status(404).json({error:"Memoria nu a fost găsită."});
    if(Object.prototype.hasOwnProperty.call(req.body||{},"pinned"))item.pinned=!!req.body.pinned;if(req.body?.text)item.text=String(req.body.text).slice(0,12000);store.write(db);res.json({data:item});
  });
  app.delete("/api/memory/:id", auth, (req,res) => {const db=store.read();db.memories=db.memories.filter(m=>!(m.id===req.params.id&&m.userId===req.user.id));store.write(db);res.json({ok:true});});
  app.delete("/api/memory", auth, (req,res) => {const db=store.read();db.memories=db.memories.filter(m=>m.userId!==req.user.id);store.write(db);res.json({ok:true});});

  app.get("/api/library", auth, (req,res) => {const db=store.read();res.json({data:db.library.filter(x=>x.userId===req.user.id).sort((a,b)=>b.createdAt-a.createdAt).map(({dataUrl,text,filePath,...x})=>x)});});

  app.post("/api/library/upload", auth, async (req,res) => {
    const rawName=String(req.headers["x-file-name"]||"").trim();
    let name=rawName;
    try{name=decodeURIComponent(rawName)}catch{}
    if(!name)return res.status(400).json({error:"Numele fișierului lipsește."});
    const mime=String(req.headers["x-file-type"]||"application/octet-stream");
    const declared=Number(req.headers["x-file-size"]||0)||0;
    const id=crypto.randomUUID();
    const safeExt=path.extname(name).replace(/[^.a-z0-9_-]/gi,"").slice(0,20);
    const target=path.join(filesDir,`${id}${safeExt}`);
    let bytes=0,finished=false;
    const out=fs.createWriteStream(target,{flags:"wx"});
    const cleanup=()=>{try{out.destroy()}catch{};try{fs.unlinkSync(target)}catch{}};
    req.on("data",chunk=>{bytes+=chunk.length});
    req.on("aborted",()=>{if(!finished)cleanup()});
    req.on("error",()=>{if(!finished)cleanup()});
    out.on("error",e=>{if(!res.headersSent)res.status(500).json({error:`Nu am putut salva fișierul: ${e.message}`})});
    out.on("finish",()=>{
      finished=true;
      const db=store.read();
      const kind=mime.startsWith("image/")?"image":mime.startsWith("text/")?"text":"file";
      const item={id,userId:req.user.id,name,mime,size:bytes||declared,kind,filePath:target,storage:"disk",createdAt:Date.now()};
      db.library.push(item);store.write(db);
      res.json({data:{...item,filePath:undefined}});
    });
    req.pipe(out);
  });

  app.get("/api/library/:id/content", auth, (req,res) => {
    const db=store.read(),item=db.library.find(x=>x.id===req.params.id&&x.userId===req.user.id);
    if(!item)return res.status(404).json({error:"Fișierul nu a fost găsit."});
    if(item.filePath&&fs.existsSync(item.filePath)){
      res.setHeader("Content-Type",item.mime||"application/octet-stream");
      res.setHeader("Content-Length",String(item.size||fs.statSync(item.filePath).size));
      return fs.createReadStream(item.filePath).pipe(res);
    }
    if(item.dataUrl){
      const m=String(item.dataUrl).match(/^data:([^;]+);base64,(.+)$/s);
      if(!m)return res.status(404).json({error:"Conținut indisponibil."});
      const b=Buffer.from(m[2],"base64");res.type(item.mime||m[1]||"application/octet-stream");return res.send(b);
    }
    if(item.text!=null){res.type(item.mime||"text/plain");return res.send(String(item.text));}
    return res.status(404).json({error:"Conținut indisponibil."});
  });

  app.post("/api/library", auth, (req,res) => {
    const name=String(req.body?.name||"").trim();if(!name)return res.status(400).json({error:"Numele fișierului lipsește."});
    const db=store.read(),item={id:crypto.randomUUID(),userId:req.user.id,name,mime:String(req.body?.mime||""),size:Number(req.body?.size||0),kind:String(req.body?.kind||"file"),dataUrl:req.body?.dataUrl||null,text:req.body?.text||null,createdAt:Date.now()};
    db.library.push(item);store.write(db);res.json({data:{...item,dataUrl:undefined,text:undefined}});
  });
  app.get("/api/library/:id", auth, (req,res) => {const db=store.read(),item=db.library.find(x=>x.id===req.params.id&&x.userId===req.user.id);if(!item)return res.status(404).json({error:"Fișierul nu a fost găsit."});const {filePath,...safe}=item;res.json({data:safe});});
  app.delete("/api/library/:id", auth, (req,res) => {const db=store.read(),item=db.library.find(x=>x.id===req.params.id&&x.userId===req.user.id);if(item?.filePath){try{fs.unlinkSync(item.filePath)}catch{}}db.library=db.library.filter(x=>!(x.id===req.params.id&&x.userId===req.user.id));store.write(db);res.json({ok:true});});

  app.post("/api/export", auth, async (req,res) => {
    try {
      const format=String(req.body?.format||"docx").toLowerCase();
      const allowed=new Set(["pdf","docx","pptx","md","txt"]);
      const title=String(req.body?.title||"AI Stoica").trim().slice(0,120)||"AI Stoica";
      const content=String(req.body?.content||"");
      if(!allowed.has(format))return res.status(400).json({error:"Format neacceptat. Folosește PDF, DOCX, PPTX, MD sau TXT."});
      if(!content.trim())return res.status(400).json({error:"Nu există conținut de exportat."});
      if(content.length>100000)return res.status(413).json({error:"Documentul depășește 100.000 de caractere."});
      let bytes,mime;
      if(format==="pdf"){bytes=await createPdfBytes(title,content);mime="application/pdf";}
      else if(format==="docx"){bytes=await createDocxBytes(title,content);mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document";}
      else if(format==="pptx"){bytes=await createPptxBytes(title,content);mime="application/vnd.openxmlformats-officedocument.presentationml.presentation";}
      else if(format==="md"){bytes=Buffer.from(content,"utf8");mime="text/markdown; charset=utf-8";}
      else {bytes=Buffer.from(content,"utf8");mime="text/plain; charset=utf-8";}
      const id=crypto.randomUUID(),name=safeGeneratedName(title).replace(/\.[^.]+$/,"")+"."+format,target=path.join(filesDir,id+"."+format);
      fs.writeFileSync(target,bytes);
      const db=store.read(),item={id,userId:req.user.id,name,mime,size:bytes.length,kind:"file",filePath:target,storage:"disk",source:"ai-export",createdAt:Date.now()};
      db.library.push(item);store.write(db);
      res.json({data:{id:item.id,name:item.name,mimeType:item.mime,size:item.size,source:item.source,createdAt:item.createdAt}});
    } catch(e) { res.status(500).json({error:"Nu am putut genera documentul: "+e.message}); }
  });

  app.get("/api/files/:id", auth, (req,res) => {
    const db=store.read(),item=db.library.find(x=>x.id===req.params.id&&x.userId===req.user.id);
    if(!item)return res.status(404).json({error:"Fișierul nu a fost găsit."});
    if(!item.filePath||!fs.existsSync(item.filePath))return res.status(404).json({error:"Fișierul nu mai există pe disc."});
    res.setHeader("Content-Type",item.mime||"application/octet-stream");
    res.setHeader("Content-Length",String(item.size||fs.statSync(item.filePath).size));
    res.setHeader("Content-Disposition",'attachment; filename*=UTF-8\'\''+encodeURIComponent(item.name));
    fs.createReadStream(item.filePath).pipe(res);
  });

  app.get("/api/plugins", auth, (req,res) => {const db=store.read();res.json({data:db.plugins.filter(x=>x.userId===req.user.id).map(({apiKey,...x})=>({...x,hasKey:!!apiKey}))});});
  app.post("/api/plugins", auth, (req,res) => {
    const name=String(req.body?.name||"").trim(),url=String(req.body?.url||"").trim();if(!name||!url)return res.status(400).json({error:"Numele și URL-ul sunt obligatorii."});
    try{new URL(url)}catch{return res.status(400).json({error:"URL-ul pluginului nu este valid."})}
    const db=store.read(),item={id:crypto.randomUUID(),userId:req.user.id,name,description:String(req.body?.description||""),url,method:String(req.body?.method||"POST").toUpperCase(),trigger:String(req.body?.trigger||`@${name.toLowerCase().replace(/\s+/g,"-")}`),auto:!!req.body?.auto,enabled:true,authType:String(req.body?.authType||"bearer"),headerName:String(req.body?.headerName||"X-API-Key"),apiKey:String(req.body?.apiKey||""),createdAt:Date.now()};
    db.plugins.push(item);store.write(db);res.json({data:{...item,apiKey:undefined,hasKey:!!item.apiKey}});
  });
  app.patch("/api/plugins/:id", auth, (req,res) => {
    const db=store.read(),item=db.plugins.find(x=>x.id===req.params.id&&x.userId===req.user.id);if(!item)return res.status(404).json({error:"Pluginul nu a fost găsit."});
    for(const k of ["name","description","url","method","trigger","auto","enabled","authType","headerName"])if(Object.prototype.hasOwnProperty.call(req.body||{},k))item[k]=req.body[k];
    if(req.body?.apiKey)item.apiKey=String(req.body.apiKey);store.write(db);res.json({data:{...item,apiKey:undefined,hasKey:!!item.apiKey}});
  });
  app.post("/api/plugins/:id/test", auth, async (req,res) => {
    const db=store.read(),item=db.plugins.find(x=>x.id===req.params.id&&x.userId===req.user.id);if(!item)return res.status(404).json({error:"Pluginul nu a fost găsit."});
    try{const result=await callPlugin(item,String(req.body?.message||"Test AI Stoica"));res.json({ok:true,result:String(result).slice(0,5000)});}catch(e){res.status(502).json({error:e.message});}
  });
  app.delete("/api/plugins/:id", auth, (req,res) => {const db=store.read();db.plugins=db.plugins.filter(x=>!(x.id===req.params.id&&x.userId===req.user.id));store.write(db);res.json({ok:true});});

  app.get("/api/automations", auth, (req,res) => {const db=store.read();res.json({data:db.automations.filter(x=>x.userId===req.user.id).sort((a,b)=>b.createdAt-a.createdAt)});});
  app.post("/api/automations", auth, (req,res) => {
    const title=String(req.body?.title||"").trim(),prompt=String(req.body?.prompt||"").trim();if(!title||!prompt)return res.status(400).json({error:"Titlul și instrucțiunea sunt obligatorii."});
    const db=store.read(),item={id:crypto.randomUUID(),userId:req.user.id,title,prompt,trigger:String(req.body?.trigger||`@${title.toLowerCase().replace(/[^a-z0-9ăâîșț]+/gi,"-").replace(/^-|-$/g,"")}`),frequency:req.body?.frequency||"daily",time:req.body?.time||"09:00",weekday:Number(req.body?.weekday??1),days:Array.isArray(req.body?.days)?req.body.days.map(Number):[],runAt:Number(req.body?.runAt||0)||null,model:req.body?.model||null,enabled:true,lastRunAt:null,lastResult:"",createdAt:Date.now()};
    item.nextRunAt=nextRun(item,Date.now());db.automations.push(item);store.write(db);res.json({data:item});
  });
  app.patch("/api/automations/:id", auth, (req,res) => {
    const db=store.read(),item=db.automations.find(x=>x.id===req.params.id&&x.userId===req.user.id);if(!item)return res.status(404).json({error:"Automatizarea nu a fost găsită."});
    for(const k of ["title","prompt","trigger","frequency","time","weekday","days","runAt","model","enabled"])if(Object.prototype.hasOwnProperty.call(req.body||{},k))item[k]=req.body[k];
    item.nextRunAt=item.enabled?nextRun(item,Date.now()):null;store.write(db);res.json({data:item});
  });
  app.post("/api/automations/:id/run", auth, async (req,res) => {
    const db=store.read(),item=db.automations.find(x=>x.id===req.params.id&&x.userId===req.user.id);if(!item)return res.status(404).json({error:"Automatizarea nu a fost găsită."});
    try{await runAutomation(item);const fresh=store.read().automations.find(x=>x.id===item.id);res.json({data:fresh});}catch(e){res.status(502).json({error:e.message});}
  });
  app.delete("/api/automations/:id", auth, (req,res) => {const db=store.read();db.automations=db.automations.filter(x=>!(x.id===req.params.id&&x.userId===req.user.id));store.write(db);res.json({ok:true});});

  app.post("/api/transcribe", auth, async (req, res) => {
    const cfg = getOmniConfig();
    const raw = String(req.body?.audio || "");
    const match = raw.match(/^data:([^;]+);base64,(.+)$/s);
    if (!match) return res.status(400).json({ error: "Înregistrarea audio nu este validă." });
    const mime = String(req.body?.mime || match[1] || "audio/webm");
    const bytes = Buffer.from(match[2], "base64");
    if (!bytes.length) return res.status(400).json({ error: "Înregistrarea audio este goală." });
    if (bytes.length > 20 * 1024 * 1024) return res.status(413).json({ error: "Înregistrarea audio este prea mare." });

    const ext = mime.includes("ogg") ? "ogg" : mime.includes("wav") ? "wav" : mime.includes("mp4") || mime.includes("m4a") ? "m4a" : "webm";
    const candidates = [...new Set([
      String(req.body?.model || "").trim(),
      String(cfg.speechModel || "").trim(),
      "openai/whisper-1",
      "groq/whisper-large-v3-turbo",
      "deepgram/nova-3"
    ].filter(Boolean))];
    const errors = [];
    for (const model of candidates) {
      try {
        const form = new FormData();
        form.append("file", new Blob([bytes], { type: mime }), `recording.${ext}`);
        form.append("model", model);
        const language = String(req.body?.language || cfg.speechLanguage || "ro").trim();
        if (language) form.append("language", language);
        const r = await fetch(`${String(cfg.baseUrl).replace(/\/+$/, "")}/audio/transcriptions`, {
          method: "POST",
          headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
          body: form,
          signal: AbortSignal.timeout(45000)
        });
        const body = await r.text();
        if (!r.ok) { errors.push(`${model}: HTTP ${r.status}`); continue; }
        let data; try { data = JSON.parse(body); } catch { data = { text: body }; }
        const text = String(data?.text || data?.transcript || "").trim();
        if (text) return res.json({ text, model });
        errors.push(`${model}: răspuns fără text`);
      } catch (e) {
        errors.push(`${model}: ${e.message}`);
      }
    }
    res.status(502).json({ error: `Nu am putut transcrie vocea prin OmniRoute. Verifică modelul de voce din Setări. ${errors.join(" | ")}` });
  });

  async function prepareMessages(rawMessages, assistantId, userId) {
    const db=store.read(),messages=Array.isArray(rawMessages)?rawMessages:[];
    const latest=[...messages].reverse().find(m=>m.role==="user");const latestText=textFromContent(latest?.content);
    const system=[];
    system.push("Când utilizatorul cere PDF, DOCX sau PPTX, redactează conținutul bine structurat, cu titluri și liste unde este util. Nu afișa pseudo-comenzi precum <invoke generate_pdf>; aplicația creează fișierul real separat.");
    const assistant=db.assistants.find(a=>a.id===assistantId&&a.userId===userId);if(assistant?.systemPrompt)system.push(assistant.systemPrompt);
    const user=db.users.find(u=>u.id===userId);
    if(user?.memoryEnabled!==false){
      const mem=memoryMatches(db,userId,latestText,8);if(mem.length)system.push("Memorie relevantă despre utilizator și conversațiile anterioare:\n"+mem.map((m,i)=>`${i+1}. ${m.text}`).join("\n"));
    }
    const pctx=await pluginContext(db,userId,latestText);if(pctx.length)system.push("Rezultate furnizate de pluginuri conectate:\n"+pctx.join("\n\n"));
    return system.length?[{role:"system",content:system.join("\n\n")},...messages.filter(m=>m.role!=="system")]:messages;
  }

  app.post("/api/chat", auth, async (req,res) => {
    const cfg=getOmniConfig(),messages=await prepareMessages(req.body?.messages,req.body?.assistantId,req.user.id);if(!messages.length)return res.status(400).json({error:"Nu există mesaje."});
    try{const r=await fetch(`${String(cfg.baseUrl).replace(/\/+$/,"")}/chat/completions`,{method:"POST",headers:{"Content-Type":"application/json",...(cfg.apiKey?{Authorization:`Bearer ${cfg.apiKey}`}:{})},body:JSON.stringify({model:req.body?.model||cfg.model||"Ai principal",messages,stream:false,temperature:0.4})});res.status(r.status).type("application/json").send(await r.text());}
    catch(e){res.status(502).json({error:`Nu mă pot conecta la OmniRoute: ${e.message}`});}
  });
  app.post("/api/chat/stream", auth, async (req,res) => {
    const cfg=getOmniConfig(),messages=await prepareMessages(req.body?.messages,req.body?.assistantId,req.user.id);if(!messages.length)return res.status(400).json({error:"Nu există mesaje."});
    try{
      const upstream=await fetch(`${String(cfg.baseUrl).replace(/\/+$/,"")}/chat/completions`,{method:"POST",headers:{"Content-Type":"application/json",...(cfg.apiKey?{Authorization:`Bearer ${cfg.apiKey}`}:{})},body:JSON.stringify({model:req.body?.model||cfg.model||"Ai principal",messages,stream:true,temperature:0.4})});
      if(!upstream.ok)return res.status(upstream.status).type("application/json").send(await upstream.text());
      const ctype=upstream.headers.get("content-type")||"";res.status(200);res.setHeader("Content-Type","text/event-stream; charset=utf-8");res.setHeader("Cache-Control","no-cache, no-transform");res.setHeader("Connection","keep-alive");
      if(!ctype.includes("text/event-stream")){const data=await upstream.json(),text=data?.choices?.[0]?.message?.content||"";res.write(`data: ${JSON.stringify({choices:[{delta:{content:text}}]})}\n\n`);res.write("data: [DONE]\n\n");return res.end();}
      const reader=upstream.body.getReader();while(true){const {value,done}=await reader.read();if(done)break;res.write(Buffer.from(value));}res.end();
    }catch(e){if(!res.headersSent)res.status(502).json({error:`Nu mă pot conecta la OmniRoute: ${e.message}`});else{res.write(`data: ${JSON.stringify({error:e.message})}\n\n`);res.end();}}
  });

  async function runAutomation(item) {
    const cfg=getOmniConfig(),db=store.read(),user=db.users.find(u=>u.id===item.userId);if(!user)throw new Error("Contul automatizării nu mai există.");
    const messages=await prepareMessages([{role:"user",content:item.prompt}],null,item.userId);
    const r=await fetch(`${String(cfg.baseUrl).replace(/\/+$/,"")}/chat/completions`,{method:"POST",headers:{"Content-Type":"application/json",...(cfg.apiKey?{Authorization:`Bearer ${cfg.apiKey}`}:{})},body:JSON.stringify({model:item.model||cfg.model||"Ai principal",messages,stream:false,temperature:0.35})});
    if(!r.ok)throw new Error(`OmniRoute HTTP ${r.status}: ${(await r.text()).slice(0,500)}`);
    const data=await r.json(),answer=data?.choices?.[0]?.message?.content||"";
    const fresh=store.read(),target=fresh.automations.find(x=>x.id===item.id);if(!target)return;
    target.lastRunAt=Date.now();target.lastResult=answer.slice(0,30000);
    if(target.frequency==="once"){target.enabled=false;target.nextRunAt=null;}else target.nextRunAt=nextRun(target,Date.now()+1000);
    const u=fresh.users.find(x=>x.id===item.userId);if(u?.memoryEnabled!==false)addMemory(fresh,item.userId,`Automatizare "${item.title}": ${answer}`,"automation");
    store.write(fresh);
  }

  let automationBusy=false;
  const automationTimer=setInterval(async()=>{
    if(automationBusy)return;automationBusy=true;
    try{
      const db=store.read(),now=Date.now(),due=db.automations.filter(a=>a.enabled&&a.nextRunAt&&a.nextRunAt<=now).slice(0,5);
      for(const a of due){try{await runAutomation(a);}catch(e){const f=store.read(),t=f.automations.find(x=>x.id===a.id);if(t){t.lastRunAt=Date.now();t.lastResult=`Eroare: ${e.message}`;t.nextRunAt=nextRun(t,Date.now()+60000);store.write(f);}}}
    }finally{automationBusy=false;}
  },30000);

  const server=app.listen(port,host);
  return {server,port,host,close:()=>new Promise(resolve=>{clearInterval(automationTimer);server.close(resolve);})};
}
module.exports={startLocalGateway};
