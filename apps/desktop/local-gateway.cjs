const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const fontkitModule = require("@pdf-lib/fontkit");
const fontkit = fontkitModule.default || fontkitModule;
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = require("docx");
const PptxGenJS = require("pptxgenjs");
const JSZip = require("jszip");
function normalizeModelKey(value){return String(value||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," ").trim();}
function isSmartAlias(value){
  const n=normalizeModelKey(value).replace(/[^a-z0-9]+/g," ").trim();
  return n==="ai principal"||n==="ai stoica"||n==="aistoica"||n==="auto"||n==="smart"||n==="smart router";
}
function inferProvider(entry){
  const explicit=normalizeModelKey(entry&&typeof entry==="object"?entry.provider:"");
  if(explicit)return explicit;
  const id=normalizeModelKey(typeof entry==="string"?entry:entry&&entry.id);
  const first=id.split("/")[0];
  const prefix={openai:"openai",anthropic:"anthropic",google:"gemini",gemini:"gemini",cerebras:"cerebras",groq:"groq",cloudflare:"cloudflare",openrouter:"openrouter","@cf":"cloudflare"};
  if(prefix[first])return prefix[first];
  if(/groq/.test(id))return "groq";
  if(/cerebras/.test(id))return "cerebras";
  if(/cloudflare|@cf\//.test(id))return "cloudflare";
  if(/openrouter/.test(id))return "openrouter";
  if(/claude|anthropic/.test(id))return "anthropic";
  if(/gemini|google/.test(id))return "gemini";
  if(/openai|codex|\bo[134]\b/.test(id)||(!/gpt[-_. ]?oss/.test(id)&&/gpt/.test(id)))return "openai";
  return "";
}

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
    createdAt: user.createdAt, memoryEnabled: user.memoryEnabled !== false,
    role: user.role || "user", status: user.status || "active",
    cloudUserId: user.cloudUserId || null
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
function normalizeMemoryText(value){
  return String(value||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," ").trim();
}
function memoryCategory(text){
  const t=normalizeMemoryText(text);
  if(/prefer|imi place|nu vreau|vreau sa fie|stil|format/.test(t))return "preferință";
  if(/proiect|lucrez|aplicatie|site|firma|primarie|scoala/.test(t))return "proiect";
  if(/am decis|decizie|ramane|aleg|folosim|vom folosi/.test(t))return "decizie";
  return "detaliu";
}
function durableMemoryCandidate(userText){
  const clean=String(userText||"").trim();
  if(clean.length<12)return "";
  const t=normalizeMemoryText(clean);
  const explicit=/tine minte|retine|remember|sa nu uiti/.test(t);
  const durable=/\b(prefer|vreau|nu vreau|folosesc|am decis|lucrez|proiect|obiectiv|format|program|domeniu|server|model|masina|liceu|clasa|firma|primarie)\b/.test(t);
  if(!explicit&&!durable)return "";
  return clean.slice(0,1800);
}
function addMemory(db, userId, text, source = "conversation", extra = {}) {
  const clean = String(text || "").trim();
  if (!clean) return null;
  const normalized=normalizeMemoryText(clean);
  const existing=db.memories.find(m=>m.userId===userId&&normalizeMemoryText(m.text)===normalized);
  if(existing){
    existing.updatedAt=Date.now();
    if(extra.pinned)existing.pinned=true;
    return existing;
  }
  const item = {
    id: crypto.randomUUID(), userId, text: clean.slice(0, 12000), source,
    category:extra.category||memoryCategory(clean),
    pinned: !!extra.pinned, conversationId: extra.conversationId || null,
    createdAt: Date.now(),updatedAt:Date.now()
  };
  db.memories.push(item);
  return item;
}
function pluginHeaders(plugin) {
  const out = { "Content-Type": "application/json" };
  if (plugin.accessToken) out.Authorization = `Bearer ${plugin.accessToken}`;
  else if (plugin.apiKey) {
    if ((plugin.authType || "bearer") === "header") out[plugin.headerName || "X-API-Key"] = plugin.apiKey;
    else out.Authorization = `Bearer ${plugin.apiKey}`;
  }
  if(plugin.oauthProvider==="github"){out.Accept="application/vnd.github+json";out["User-Agent"]="AI-Stoica";}
  if(plugin.oauthProvider==="notion")out["Notion-Version"]="2022-06-28";
  return out;
}
async function callOAuthPlugin(plugin, message) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try{
    let url=plugin.url,method=(plugin.method||"GET").toUpperCase(),body;
    const provider=String(plugin.oauthProvider||"");
    const headers=pluginHeaders(plugin);
    if(provider==="google"){
      const u=new URL(url);if(message)u.searchParams.set("q",String(message).slice(0,250));url=u.toString();
    }else if(provider==="google-calendar"){
      const u=new URL(url);u.searchParams.set("timeMin",new Date().toISOString());if(message)u.searchParams.set("q",String(message).slice(0,250));url=u.toString();
    }else if(provider==="notion"){
      method="POST";body=JSON.stringify({page_size:20,...(message?{query:String(message).slice(0,100)}:{})});
    }
    const r=await fetch(url,{method,headers,body,signal:controller.signal});
    const text=await r.text();
    if(r.status===401)throw new Error("Conexiunea OAuth a expirat sau a fost revocată. Reconectează pluginul.");
    if(!r.ok)throw new Error(`HTTP ${r.status}: ${text.slice(0,500)}`);
    try{return JSON.stringify(JSON.parse(text))}catch{return text}
  }finally{clearTimeout(timer)}
}
async function callPlugin(plugin, message) {
  if(plugin.mode==="direct_app"){
    return JSON.stringify({
      mode:"direct_app",
      name:plugin.name,
      appUrl:plugin.appUrl||plugin.url,
      message:"Plugin configurat pentru deschidere directă. Nu este necesar OAuth pentru lansarea aplicației."
    });
  }
  if(plugin.oauthConnected&&plugin.accessToken)return callOAuthPlugin(plugin,message);
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
  if (freq === "hourly" || freq === "interval") {
    const hours=Math.max(1,Math.min(168,Number(automation.intervalHours||1)));
    return from + hours * 60 * 60 * 1000;
  }
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
  if(freq==="monthly"){
    const day=Math.max(1,Math.min(28,Number(automation.monthday||1)));
    next.setDate(day);
    if(next.getTime()<=from){next.setMonth(next.getMonth()+1);next.setDate(day)}
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

function xmlEscape(value) {
  return String(value == null ? "" : value)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&apos;");
}
function stripOuterFence(content) {
  const text=String(content||"").trim();
  const m=text.match(/^\`\`\`[^\n]*\n([\s\S]*?)\n?\`\`\`$/);
  return m ? m[1] : text;
}
function markdownTableRows(content) {
  const text=String(content||"").replace(/\r/g,"").trim();
  const raw=stripOuterFence(text);
  try {
    const parsed=JSON.parse(raw);
    if(Array.isArray(parsed) && parsed.length){
      if(parsed.every(x=>x && typeof x==="object" && !Array.isArray(x))){
        const keys=[...new Set(parsed.flatMap(x=>Object.keys(x)))];
        return [keys,...parsed.map(x=>keys.map(k=>x[k]??""))];
      }
      if(parsed.every(Array.isArray)) return parsed;
    }
  } catch {}
  const lines=text.split("\n").map(x=>x.trim()).filter(Boolean);
  const pipeLines=lines.filter(x=>x.includes("|"));
  if(pipeLines.length>=2){
    const rows=pipeLines.map(line=>line.replace(/^\|/,"").replace(/\|$/,"").split("|").map(x=>plainMarkdownText(x.trim())));
    const clean=rows.filter(row=>!row.every(cell=>/^:?-{3,}:?$/.test(String(cell).trim())));
    if(clean.length>=2) return clean;
  }
  const delimited=lines.filter(x=>x.includes("\t")||x.includes(";")||x.includes(","));
  if(delimited.length>=2){
    const delimiter=delimited.some(x=>x.includes("\t"))?"\t":delimited.some(x=>x.includes(";"))?";":",";
    return delimited.map(line=>line.split(delimiter).map(x=>x.trim().replace(/^"|"$/g,"").replace(/""/g,'"')));
  }
  const simple=lines.filter(x=>!/^#{1,6}\s/.test(x)).map(x=>[plainMarkdownText(x.replace(/^[-*•]\s+/,""))]);
  return [["Conținut"],...(simple.length?simple:[[plainMarkdownText(text)]])];
}
function excelColumnName(index) {
  let n=index+1,out="";
  while(n>0){const r=(n-1)%26;out=String.fromCharCode(65+r)+out;n=Math.floor((n-1)/26);}
  return out;
}
function xlsxCellXml(value,row,col,style=0) {
  const ref=excelColumnName(col)+(row+1);
  const raw=value==null?"":value;
  const text=String(raw).trim();
  if(typeof raw==="number" || (/^-?(?:0|[1-9]\d*)(?:[.,]\d+)?$/.test(text) && !/^0\d+/.test(text))){
    const n=Number(text.replace(",","."));
    if(Number.isFinite(n)) return `<c r="${ref}" s="${style}"><v>${n}</v></c>`;
  }
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(raw)}</t></is></c>`;
}
async function createXlsxBytes(title, content) {
  const rows=markdownTableRows(content);
  const zip=new JSZip();
  const sheetName=safeGeneratedName(title||"Foaie").replace(/[\[\]*?:\\/]/g," ").slice(0,31)||"Foaie1";
  const maxCols=Math.max(1,...rows.map(r=>r.length));
  const widths=Array.from({length:maxCols},(_,c)=>Math.min(60,Math.max(10,...rows.map(r=>String(r[c]??"").length+2))));
  const sheetData=rows.map((row,r)=>`<row r="${r+1}">${Array.from({length:maxCols},(_,c)=>xlsxCellXml(row[c]??"",r,c,r===0?1:0)).join("")}</row>`).join("");
  const cols=widths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join("");
  zip.file("[Content_Types].xml",`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`);
  zip.folder("_rels").file(".rels",`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.folder("xl").file("workbook.xml",`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.folder("xl").folder("_rels").file("workbook.xml.rels",`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.folder("xl").file("styles.xml",`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><sz val="11"/><name val="Aptos"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`);
  zip.folder("xl").folder("worksheets").file("sheet1.xml",`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${cols}</cols><sheetData>${sheetData}</sheetData></worksheet>`);
  return await zip.generateAsync({type:"nodebuffer",compression:"DEFLATE",compressionOptions:{level:6}});
}
function csvEscape(value) {
  const s=String(value==null?"":value);
  return /[",\n\r;]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
}
function createCsvBytes(content) {
  const rows=markdownTableRows(content);
  return Buffer.from("\ufeff"+rows.map(r=>r.map(csvEscape).join(",")).join("\r\n"),"utf8");
}
function createJsonBytes(title, content) {
  const raw=stripOuterFence(content);
  try{return Buffer.from(JSON.stringify(JSON.parse(raw),null,2)+"\n","utf8");}
  catch{return Buffer.from(JSON.stringify({title:String(title||"AI Stoica"),content:String(content||"")},null,2)+"\n","utf8");}
}
function createHtmlBytes(title, content) {
  const raw=stripOuterFence(content);
  if(/^<!doctype html|^<html[\s>]/i.test(raw)) return Buffer.from(raw,"utf8");
  const body=parseDocumentBlocks(content).map(b=>{
    if(b.type==="heading")return `<h${Math.min(4,b.level)}>${xmlEscape(plainMarkdownText(b.text))}</h${Math.min(4,b.level)}>`;
    if(b.type==="bullet")return `<p>• ${xmlEscape(plainMarkdownText(b.text))}</p>`;
    if(b.type==="number")return `<p>${b.number}. ${xmlEscape(plainMarkdownText(b.text))}</p>`;
    if(b.type==="blank")return "";
    return `<p>${xmlEscape(plainMarkdownText(b.text))}</p>`;
  }).join("\n");
  return Buffer.from(`<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${xmlEscape(title||"AI Stoica")}</title></head><body><main>${body}</main></body></html>`,"utf8");
}
function createXmlBytes(title, content) {
  const raw=stripOuterFence(content);
  if(/^<\?xml\b|^<[A-Za-z_][\w:.-]*(?:\s|>)/.test(raw)) return Buffer.from(raw,"utf8");
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><document><title>${xmlEscape(title||"AI Stoica")}</title><content>${xmlEscape(content)}</content></document>`,"utf8");
}
function rtfEscape(value) {
  let out="";
  for(const ch of String(value||"")){
    const cp=ch.codePointAt(0);
    if(ch==="\\")out+="\\\\";
    else if(ch==="{")out+="\\{";
    else if(ch==="}")out+="\\}";
    else if(ch==="\n")out+="\\par\n";
    else if(cp>127){const signed=cp>32767?cp-65536:cp;out+=`\\u${signed}?`;}
    else out+=ch;
  }
  return out;
}
function createRtfBytes(title, content) {
  return Buffer.from(`{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Segoe UI;}}\\fs24\\b ${rtfEscape(title||"AI Stoica")}\\b0\\par\\par ${rtfEscape(plainMarkdownText(content))}}`,"utf8");
}
function languageExtension(lang) {
  const map={javascript:"js",js:"js",typescript:"ts",ts:"ts",jsx:"jsx",tsx:"tsx",python:"py",py:"py",java:"java",c:"c",cpp:"cpp","c++":"cpp",csharp:"cs",cs:"cs",go:"go",rust:"rs",rs:"rs",php:"php",ruby:"rb",rb:"rb",bash:"sh",shell:"sh",sh:"sh",powershell:"ps1",ps1:"ps1",sql:"sql",html:"html",css:"css",json:"json",xml:"xml",yaml:"yaml",yml:"yml",toml:"toml",markdown:"md",md:"md",text:"txt",txt:"txt",svg:"svg",latex:"tex",tex:"tex"};
  return map[String(lang||"").toLowerCase()]||"txt";
}
function safeZipPath(value) {
  const clean=String(value||"").replace(/\\/g,"/").replace(/^\/+|\.\.(?:\/|$)/g,"").replace(/[^A-Za-z0-9._\/-]+/g,"_");
  return clean && !clean.endsWith("/") ? clean.slice(0,180) : "";
}
async function createZipBytes(title, content) {
  const zip=new JSZip();
  zip.file("README.md",String(content||""));
  const re=/\`\`\`([^\n]*)\n([\s\S]*?)\n?\`\`\`/g;
  let m,index=1;
  while((m=re.exec(String(content||"")))){
    const header=String(m[1]||"").trim();
    const explicit=(header.match(/(?:file(?:name)?\s*[:=]\s*)?([A-Za-z0-9_.\/-]+\.[A-Za-z0-9]+)$/i)||[])[1];
    const lang=header.split(/\s+/)[0];
    const name=safeZipPath(explicit)||`file-${index++}.${languageExtension(lang)}`;
    if(name!=="README.md")zip.file(name,m[2]);
  }
  return await zip.generateAsync({type:"nodebuffer",compression:"DEFLATE",compressionOptions:{level:6}});
}
function createIpynbBytes(content) {
  const raw=stripOuterFence(content);
  try {
    const parsed=JSON.parse(raw);
    if(parsed && Array.isArray(parsed.cells)) return Buffer.from(JSON.stringify(parsed,null,2)+"\n","utf8");
  } catch {}
  const notebook={cells:[{cell_type:"markdown",metadata:{},source:String(content||"").split(/(?<=\n)/)}],metadata:{language_info:{name:"python"}},nbformat:4,nbformat_minor:5};
  return Buffer.from(JSON.stringify(notebook,null,2)+"\n","utf8");
}
function createSvgBytes(title, content) {
  const raw=stripOuterFence(content);
  if(/^<svg[\s>]/i.test(raw))return Buffer.from(raw,"utf8");
  const text=plainMarkdownText(content).replace(/\s+/g," ").slice(0,500);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#ffffff"/><text x="60" y="90" font-family="Arial, sans-serif" font-size="42" font-weight="700">${xmlEscape(title||"AI Stoica")}</text><text x="60" y="155" font-family="Arial, sans-serif" font-size="24">${xmlEscape(text)}</text></svg>`,"utf8");
}
const PLAIN_TEXT_MIME={
  md:"text/markdown; charset=utf-8",txt:"text/plain; charset=utf-8",html:"text/html; charset=utf-8",xml:"application/xml; charset=utf-8",rtf:"application/rtf",
  js:"text/javascript; charset=utf-8",ts:"text/plain; charset=utf-8",jsx:"text/javascript; charset=utf-8",tsx:"text/plain; charset=utf-8",py:"text/x-python; charset=utf-8",
  java:"text/x-java-source; charset=utf-8",c:"text/x-c; charset=utf-8",cpp:"text/x-c++src; charset=utf-8",cs:"text/plain; charset=utf-8",go:"text/plain; charset=utf-8",
  rs:"text/plain; charset=utf-8",php:"application/x-httpd-php",rb:"text/plain; charset=utf-8",sh:"text/x-shellscript; charset=utf-8",ps1:"text/plain; charset=utf-8",
  sql:"application/sql; charset=utf-8",css:"text/css; charset=utf-8",yaml:"application/yaml; charset=utf-8",yml:"application/yaml; charset=utf-8",toml:"text/plain; charset=utf-8",
  ini:"text/plain; charset=utf-8",tex:"application/x-tex; charset=utf-8"
};
const EXPORT_FORMATS=new Set(["pdf","docx","pptx","xlsx","csv","json","md","txt","html","xml","rtf","zip","ipynb","svg",...Object.keys(PLAIN_TEXT_MIME)]);
async function createExportBytes(format,title,content) {
  if(format==="pdf")return {bytes:await createPdfBytes(title,content),mime:"application/pdf"};
  if(format==="docx")return {bytes:await createDocxBytes(title,content),mime:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"};
  if(format==="pptx")return {bytes:await createPptxBytes(title,content),mime:"application/vnd.openxmlformats-officedocument.presentationml.presentation"};
  if(format==="xlsx")return {bytes:await createXlsxBytes(title,content),mime:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"};
  if(format==="csv")return {bytes:createCsvBytes(content),mime:"text/csv; charset=utf-8"};
  if(format==="json")return {bytes:createJsonBytes(title,content),mime:"application/json; charset=utf-8"};
  if(format==="html")return {bytes:createHtmlBytes(title,content),mime:PLAIN_TEXT_MIME.html};
  if(format==="xml")return {bytes:createXmlBytes(title,content),mime:PLAIN_TEXT_MIME.xml};
  if(format==="rtf")return {bytes:createRtfBytes(title,content),mime:PLAIN_TEXT_MIME.rtf};
  if(format==="zip")return {bytes:await createZipBytes(title,content),mime:"application/zip"};
  if(format==="ipynb")return {bytes:createIpynbBytes(content),mime:"application/x-ipynb+json"};
  if(format==="svg")return {bytes:createSvgBytes(title,content),mime:"image/svg+xml"};
  return {bytes:Buffer.from(stripOuterFence(content),"utf8"),mime:PLAIN_TEXT_MIME[format]||"text/plain; charset=utf-8"};
}

function startLocalGateway({ dataDir, port = 8787, host = "127.0.0.1", serviceName = "AI Stoica Gateway", getOmniConfig, onAutomationResult }) {
  const store = createStore(dataDir);
  const secret = loadOrCreateSecret(dataDir);
  const filesDir = path.join(dataDir, "library-files");
  fs.mkdirSync(filesDir, { recursive: true });
  const app = express();
  const oauthPending = new Map();
  app.use(helmet({ crossOriginResourcePolicy: false }));
  app.use(cors({ origin: true, credentials: false }));
  app.use(express.json({ limit: "64mb" }));

  const toolRunsDir = path.join(dataDir, "tool-runs");
  fs.mkdirSync(toolRunsDir, { recursive: true });

  function ownerOnlyLocal(req,res,next){
    if(ownerRequest(req))return next();
    return res.status(403).json({error:"Rularea de cod și accesul la server sunt rezervate Owner-ului."});
  }

  function decodeHtml(value){
    return String(value||"")
      .replace(/<script[\s\S]*?<\/script>/gi," ")
      .replace(/<style[\s\S]*?<\/style>/gi," ")
      .replace(/<[^>]+>/g," ")
      .replace(/&nbsp;/gi," ")
      .replace(/&amp;/gi,"&")
      .replace(/&quot;/gi,'"')
      .replace(/&#39;|&apos;/gi,"'")
      .replace(/&lt;/gi,"<")
      .replace(/&gt;/gi,">")
      .replace(/&#(\d+);/g,(_m,n)=>String.fromCodePoint(Number(n)||32))
      .replace(/&#x([0-9a-f]+);/gi,(_m,n)=>String.fromCodePoint(parseInt(n,16)||32))
      .replace(/\s+/g," ").trim();
  }
  function publicWebUrl(raw){
    try{
      let value=String(raw||"").trim();
      if(value.startsWith("//"))value="https:"+value;
      const u=new URL(value);
      if(/duckduckgo\.com$/i.test(u.hostname)&&u.pathname.startsWith("/l/")&&u.searchParams.get("uddg"))return publicWebUrl(decodeURIComponent(u.searchParams.get("uddg")));
      if(!["http:","https:"].includes(u.protocol))return "";
      const h=u.hostname.toLowerCase();
      if(h==="localhost"||h==="::1"||/^127\./.test(h)||/^10\./.test(h)||/^192\.168\./.test(h)||/^169\.254\./.test(h))return "";
      const m=h.match(/^172\.(\d+)\./);if(m&&Number(m[1])>=16&&Number(m[1])<=31)return "";
      return u.toString();
    }catch{return ""}
  }
  async function pageExcerpt(url,maxChars=2600){
    const safe=publicWebUrl(url);if(!safe)return "";
    try{
      const r=await fetch(safe,{redirect:"follow",headers:{"User-Agent":"AI-Stoica/0.7 (+desktop assistant)","Accept":"text/html,text/plain;q=0.9,*/*;q=0.5"},signal:AbortSignal.timeout(9000)});
      if(!r.ok)return "";
      const ctype=String(r.headers.get("content-type")||"");
      if(!/text\/|json|xml|html/i.test(ctype))return "";
      const text=await r.text();
      return decodeHtml(text).slice(0,maxChars);
    }catch{return ""}
  }
  async function liveWebSearch(query,maxResults=5){
    const q=String(query||"").trim().slice(0,700);if(!q)return [];
    const results=[];
    try{
      const r=await fetch("https://html.duckduckgo.com/html/?q="+encodeURIComponent(q),{
        headers:{"User-Agent":"Mozilla/5.0 AI-Stoica/0.7","Accept":"text/html"},
        signal:AbortSignal.timeout(12000)
      });
      const html=await r.text();
      const re=/<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let m;const seen=new Set();
      while((m=re.exec(html))&&results.length<maxResults){
        const url=publicWebUrl(m[1]);if(!url||seen.has(url))continue;seen.add(url);
        const title=decodeHtml(m[2])||new URL(url).hostname;
        results.push({title,url});
      }
    }catch{}
    if(!results.length){
      try{
        const r=await fetch("https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&utf8=1&srlimit="+Math.min(5,maxResults)+"&srsearch="+encodeURIComponent(q),{signal:AbortSignal.timeout(9000)});
        const data=await r.json();
        for(const x of data?.query?.search||[]){
          const url="https://en.wikipedia.org/wiki/"+encodeURIComponent(String(x.title||"").replace(/ /g,"_"));
          results.push({title:String(x.title||"Wikipedia"),url,snippet:decodeHtml(x.snippet||"")});
        }
      }catch{}
    }
    const enriched=await Promise.all(results.slice(0,maxResults).map(async x=>({...x,excerpt:x.snippet||await pageExcerpt(x.url)})));
    return enriched;
  }
  function urlsFromText(text){
    const matches=String(text||"").match(/https?:\/\/[^\s<>"']+/gi)||[];
    return [...new Set(matches.map(x=>x.replace(/[),.;]+$/,"")).filter(publicWebUrl))].slice(0,3);
  }
  function shouldUseLiveWeb(text){
    const t=String(text||"").toLowerCase();
    return /\b(azi|acum|actual|actuale|recent|recentă|recente|ultim|ultima|latest|news|știri|stiri|internet|online|caută|cauta|verifică|verifica|preț|pret|vreme|scor|program|orar|versiune|release|documentație|documentatie|api|model nou|2026)\b/.test(t);
  }
  function projectContext(db,userId,projectId,latestText){
    if(!projectId)return "";
    const words=[...new Set(normalizeMemoryText(latestText).split(/\s+/).filter(x=>x.length>=4))].slice(0,30);
    const rows=db.conversations.filter(x=>x.userId===userId&&x.projectId===projectId).map(conv=>{
      const sample=(conv.messages||[]).slice(-8).map(m=>textFromContent(m.content)).join(" ");
      const hay=normalizeMemoryText((conv.title||"")+" "+sample);
      const score=words.reduce((n,w)=>n+(hay.includes(w)?1:0),0);
      return {conv,score};
    }).sort((a,b)=>b.score-a.score||(b.conv.updatedAt||0)-(a.conv.updatedAt||0)).slice(0,6);
    let out="";
    for(const row of rows){
      const conv=row.conv;
      const msgs=(conv.messages||[]).slice(-4).map(m=>(m.role==="assistant"?"AI Stoica":"Utilizator")+": "+textFromContent(m.content).slice(0,1800)).join("\n");
      const block="Conversație proiect: "+(conv.title||"fără titlu")+"\n"+msgs+"\n\n";
      if(out.length+block.length>18000)break;
      out+=block;
    }
    return out.trim();
  }
  function githubSearchWords(text){
    const stop=new Set(["acest","aceasta","pentru","vreau","care","este","sunt","face","faci","facem","codul","fisier","fișier","problema","eroare","github","repo","repository","with","from","that","this","function","const"]);
    return [...new Set(String(text||"").match(/[A-Za-z0-9_.-]{4,}/g)||[])].filter(x=>!stop.has(x.toLowerCase())).sort((a,b)=>b.length-a.length).slice(0,3);
  }
  function shouldUseGithub(text){
    return /\b(github|repository|repo|cod|code|bug|eroare|build|component|funcție|functie|endpoint|react|node|python|server|api|fișier|fisier)\b/i.test(String(text||""));
  }
  async function githubCodeContext(cfg,text){
    const repo=String(cfg.githubRepo||"").trim(),token=String(cfg.githubToken||"").trim();
    if(!repo||!token||!shouldUseGithub(text))return "";
    const headers={Authorization:"Bearer "+token,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","User-Agent":"AI-Stoica"};
    const words=githubSearchWords(text);if(!words.length)return "";
    const found=new Map();
    for(const word of words){
      try{
        const r=await fetch("https://api.github.com/search/code?q="+encodeURIComponent(word+" repo:"+repo),{headers,signal:AbortSignal.timeout(10000)});
        if(!r.ok)continue;
        const data=await r.json();
        for(const item of data.items||[])if(item?.path&&!found.has(item.path))found.set(item.path,item);
      }catch{}
      if(found.size>=5)break;
    }
    let out="";
    for(const item of [...found.values()].slice(0,4)){
      try{
        const r=await fetch(item.url,{headers,signal:AbortSignal.timeout(10000)});if(!r.ok)continue;
        const data=await r.json();let source="";
        if(data?.content&&data?.encoding==="base64")source=Buffer.from(String(data.content).replace(/\n/g,""),"base64").toString("utf8");
        if(!source&&data?.download_url)source=await pageExcerpt(data.download_url,9000);
        const block="GitHub "+repo+"/"+item.path+"\n"+source.slice(0,9000)+"\n\n";
        if(out.length+block.length>26000)break;out+=block;
      }catch{}
    }
    return out.trim();
  }
  async function githubReadFile(cfg,filePath,branch){
    const repo=String(cfg.githubRepo||"").trim(),token=String(cfg.githubToken||"").trim();
    if(!repo)throw new Error("Configurează GitHub repository în Setări.");
    if(!token)throw new Error("Configurează GitHub token în Setări pentru repository-ul privat.");
    const headers={Authorization:"Bearer "+token,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","User-Agent":"AI-Stoica"};
    const ref=String(branch||cfg.githubBranch||"main").trim()||"main";
    const encodedPath=String(filePath||"").split("/").map(encodeURIComponent).join("/");
    const url="https://api.github.com/repos/"+repo+"/contents/"+encodedPath+"?ref="+encodeURIComponent(ref);
    const r=await fetch(url,{headers,signal:AbortSignal.timeout(12000)});
    const text=await r.text();let data={};try{data=JSON.parse(text)}catch{}
    if(!r.ok)throw new Error("GitHub HTTP "+r.status+": "+String(data?.message||text).slice(0,500));
    if(data.type!=="file"||!data.content)throw new Error("Calea GitHub nu indică un fișier text.");
    return {repo,branch:ref,path:data.path||filePath,sha:data.sha,content:Buffer.from(String(data.content).replace(/\n/g,""),"base64").toString("utf8")};
  }
  async function githubWriteFile(cfg,args){
    const repo=String(cfg.githubRepo||"").trim(),token=String(cfg.githubToken||"").trim();
    if(!repo||!token)throw new Error("GitHub repository/token nu sunt configurate.");
    const headers={Authorization:"Bearer "+token,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","User-Agent":"AI-Stoica","Content-Type":"application/json"};
    const ref=String(args.branch||cfg.githubBranch||"main").trim()||"main";
    const encodedPath=String(args.filePath||"").split("/").map(encodeURIComponent).join("/");
    const url="https://api.github.com/repos/"+repo+"/contents/"+encodedPath;
    const body={message:String(args.message||("AI Stoica: update "+args.filePath)),content:Buffer.from(String(args.content||""),"utf8").toString("base64"),branch:ref};
    if(args.sha)body.sha=args.sha;
    const r=await fetch(url,{method:"PUT",headers,body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
    const text=await r.text();let data={};try{data=JSON.parse(text)}catch{}
    if(!r.ok)throw new Error("GitHub HTTP "+r.status+": "+String(data?.message||text).slice(0,700));
    return data;
  }
  function saveGithubBackup(file){
    const dir=path.join(dataDir,"github-backups");fs.mkdirSync(dir,{recursive:true});
    const id=crypto.randomUUID();
    fs.writeFileSync(path.join(dir,id+".json"),JSON.stringify({id,repo:file.repo,path:file.path,branch:file.branch,sha:file.sha,content:file.content,createdAt:Date.now()},null,2),"utf8");
    return id;
  }
  async function generateGithubProposal(req,file,instruction){
    const cfg=getOmniConfig();
    const model=String(req.body?.model||cfg.model||"").trim();
    if(!model)throw new Error("Alege un model AI înainte de GitHub Solve.");
    await requireModelAccess(req.cloudToken,model);
    const messages=[
      {role:"system",content:"Ești motorul GitHub Solve din AI Stoica. Primești un singur fișier și o instrucțiune. Returnează EXCLUSIV conținutul complet al fișierului corectat, fără markdown fences, fără explicații și fără omisiuni."},
      {role:"user",content:"Fișier: "+file.path+"\nInstrucțiune: "+String(instruction||"Analizează și corectează problema.")+"\n\nCONȚINUT ACTUAL:\n"+file.content.slice(0,120000)}
    ];
    const r=await fetchChatCandidate(cfg,model,messages,false);
    const text=await r.text();let data={};try{data=JSON.parse(text)}catch{}
    if(!r.ok)throw new Error("Model AI HTTP "+r.status+": "+text.slice(0,500));
    let proposal=String(data?.choices?.[0]?.message?.content||"").trim();
    proposal=proposal.replace(/^```[a-z0-9_+.-]*\s*/i,"").replace(/\s*```$/,"");
    if(!proposal)throw new Error("Modelul nu a returnat o propunere de cod.");
    const check=await checkCodeSyntax(file.path,proposal);
    return {proposal,model,check};
  }
  async function checkCodeSyntax(filePath,source){
    const ext=String(path.extname(filePath||"")).toLowerCase();
    if(![".js",".cjs",".mjs",".py"].includes(ext))return {supported:false,ok:true,code:null,stdout:"",stderr:"",language:""};
    const runDir=path.join(toolRunsDir,crypto.randomUUID());fs.mkdirSync(runDir,{recursive:true});
    try{
      const file=path.join(runDir,"check"+ext);fs.writeFileSync(file,String(source||""),"utf8");
      if(ext!==".py"){
        const r=await spawnCapture(process.execPath,["--check",file],{cwd:runDir,timeout:12000,env:{ELECTRON_RUN_AS_NODE:"1"}});
        return {supported:true,ok:r.code===0&&!r.timedOut,...r,language:"javascript"};
      }
      const commands=process.platform==="win32"?[["py",["-3","-m","py_compile",file]],["python",["-m","py_compile",file]]]:[["python3",["-m","py_compile",file]],["python",["-m","py_compile",file]]];
      let last;
      for(const pair of commands){try{const r=await spawnCapture(pair[0],pair[1],{cwd:runDir,timeout:12000});return {supported:true,ok:r.code===0&&!r.timedOut,...r,language:"python"}}catch(e){last=e}}
      throw last||new Error("Python nu este instalat.");
    }finally{try{fs.rmSync(runDir,{recursive:true,force:true})}catch{}}
  }
  function spawnCapture(command,args,{cwd,timeout=15000,env={}}={}){
    return new Promise((resolve,reject)=>{
      let stdout="",stderr="",timedOut=false,settled=false;
      const child=spawn(command,args,{cwd,windowsHide:true,shell:false,env:{...process.env,...env}});
      const cap=(value)=>String(value||"").slice(0,120000);
      child.stdout?.on("data",d=>{stdout=cap(stdout+d.toString())});
      child.stderr?.on("data",d=>{stderr=cap(stderr+d.toString())});
      child.once("error",e=>{if(!settled){settled=true;reject(e)}});
      const timer=setTimeout(()=>{timedOut=true;try{child.kill()}catch{}},timeout);
      child.once("close",code=>{clearTimeout(timer);if(settled)return;settled=true;resolve({code:Number(code??-1),stdout,stderr,timedOut})});
    });
  }
  async function executeCode(language,code){
    const lang=String(language||"").toLowerCase(),source=String(code||"");
    if(!source.trim())throw new Error("Codul este gol.");
    if(source.length>100000)throw new Error("Codul este prea mare pentru o rulare interactivă.");
    const runDir=path.join(toolRunsDir,crypto.randomUUID());fs.mkdirSync(runDir,{recursive:true});
    try{
      if(["js","javascript","node","jsx"].includes(lang)){
        const file=path.join(runDir,"main.js");fs.writeFileSync(file,source,"utf8");
        return {...await spawnCapture(process.execPath,[file],{cwd:runDir,timeout:20000,env:{ELECTRON_RUN_AS_NODE:"1"}}),language:"javascript"};
      }
      if(["py","python","python3"].includes(lang)){
        const file=path.join(runDir,"main.py");fs.writeFileSync(file,source,"utf8");
        const commands=process.platform==="win32"?[["py",["-3",file]],["python",[file]]]:[["python3",[file]],["python",[file]]];
        let last;
        for(const pair of commands){try{return {...await spawnCapture(pair[0],pair[1],{cwd:runDir,timeout:20000}),language:"python"}}catch(e){last=e}}
        throw last||new Error("Python nu este instalat.");
      }
      throw new Error("AI Stoica poate rula direct JavaScript/Node și Python.");
    }finally{try{fs.rmSync(runDir,{recursive:true,force:true})}catch{}}
  }
  async function sshRun(cfg,command,timeout=30000){
    const host=String(cfg.serverHost||"").trim(),user=String(cfg.serverUser||"root").trim()||"root";
    if(!host)throw new Error("Serverul SSH nu este configurat în Setări.");
    const args=["-o","BatchMode=yes","-o","StrictHostKeyChecking=accept-new","-o","ConnectTimeout=8","-p",String(Math.max(1,Math.min(65535,Number(cfg.serverPort||22))))];
    const key=String(cfg.serverKeyPath||"").trim();if(key)args.push("-i",key);
    args.push(user+"@"+host,String(command||"echo AI_STOICA_SERVER_OK"));
    return await spawnCapture("ssh",args,{timeout});
  }

  function sign(user) { return jwt.sign({ sub: user.id, email: user.email }, secret); }
  function cloudBase() {
    const cfg = getOmniConfig?.() || {};
    return String(cfg.controlApiUrl || "").trim().replace(/\/+$/,"");
  }
  async function cloudFetch(pathname, init = {}) {
    const base = cloudBase();
    if (!base) throw new Error("AI Stoica Cloud nu este configurat.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(init.timeout || 9000));
    try {
      return await fetch(base + pathname, {
        method: init.method || "GET",
        headers: { ...(init.body !== undefined ? { "Content-Type":"application/json" } : {}), ...(init.headers || {}) },
        body: init.body === undefined ? undefined : (typeof init.body === "string" ? init.body : JSON.stringify(init.body)),
        signal: controller.signal
      });
    } finally { clearTimeout(timer); }
  }
  function policyFailure(message, status = 503) {
    const error = new Error(message);
    error.status = status;
    return error;
  }
  async function cloudModelPolicy(token, models) {
    const unique=[...new Set((models||[]).map(x=>String(x||"").trim()).filter(Boolean))];
    if (!cloudBase()) return { policyEnforced:false, data:unique.map(model=>({model,allowed:true})) };
    if (!token) throw policyFailure("Nu pot verifica permisiunile AI. Reautentifică-te prin AI Stoica Cloud.",503);
    const chunks=[];for(let i=0;i<unique.length;i+=150)chunks.push(unique.slice(i,i+150));
    const all=[];let paidAiEnabled=null;
    for(const chunk of chunks){
      let remote;
      try {
        remote=await cloudFetch("/api/ai/access",{
          method:"POST",
          headers:{Authorization:`Bearer ${token}`},
          body:{models:chunk},
          timeout:9000
        });
      } catch(e) {
        throw policyFailure(`AI Stoica Cloud nu poate verifica permisiunile AI: ${e.message}`,503);
      }
      const text=await remote.text();let data={};try{data=JSON.parse(text||"{}")}catch{}
      if(!remote.ok)throw policyFailure(data?.error||text||"Verificarea permisiunilor AI a eșuat.",remote.status||503);
      if(!Array.isArray(data?.data))throw policyFailure("Răspuns invalid de la politica AI Stoica Cloud.",502);
      all.push(...data.data);
      if(typeof data.paidAiEnabled==="boolean")paidAiEnabled=data.paidAiEnabled;
    }
    return {policyEnforced:true,data:all,...(paidAiEnabled===null?{}:{paidAiEnabled})};
  }
  async function requireModelAccess(token, model) {
    const policy=await cloudModelPolicy(token,[model]);
    const decision=policy.data.find(x=>String(x.model)===String(model))||policy.data[0];
    if(!decision?.allowed)throw policyFailure(decision?.reason||"Modelul nu este permis pentru acest cont.",403);
    return decision;
  }
  async function omniModelEntries(cfg) {
    const r=await fetch(`${String(cfg.baseUrl).replace(/\/+$/, "")}/models`,{
      headers:cfg.apiKey?{Authorization:`Bearer ${cfg.apiKey}`}:{},
      signal:AbortSignal.timeout(9000)
    });
    const text=await r.text();
    if(!r.ok)throw policyFailure(`OmniRoute models HTTP ${r.status}: ${text.slice(0,500)}`,502);
    let parsed;try{parsed=JSON.parse(text)}catch{throw policyFailure("OmniRoute a returnat o listă de modele invalidă.",502)}
    return Array.isArray(parsed)?parsed:(Array.isArray(parsed?.data)?parsed.data:[]);
  }
  async function allowedOmniEntries(context, entries) {
    const rows=(Array.isArray(entries)?entries:[]).map(entry=>{
      const id=String(typeof entry==="string"?entry:entry?.id||"").trim();
      const provider=String(typeof entry==="string"?"":entry?.provider||"").trim().toLowerCase();
      const first=id.toLowerCase().split("/")[0];
      const alreadyScoped=["openai","anthropic","google","gemini","cerebras","groq","cloudflare","openrouter","@cf"].includes(first);
      const policyId=provider&&!alreadyScoped?`${provider}/${id}`:id;
      return {entry,id,policyId};
    }).filter(x=>x.id);
    if(!rows.length)return [];
    if(!cloudBase())return rows.map(x=>x.entry);
    const policy=await cloudModelPolicy(context?.cloudToken,rows.map(x=>x.policyId));
    const allowed=new Set(policy.data.filter(x=>x.allowed).map(x=>String(x.model)));
    return rows.filter(x=>allowed.has(x.policyId)).map(x=>x.entry);
  }
  async function resolveChatRoute(context, messages, requestedModel) {
    const cfg=getOmniConfig();
    const requested=String(requestedModel||cfg.model||"").trim();
    if(!requested)throw policyFailure("Alege manual un model AI înainte de a trimite mesajul.",400);
    if(isSmartAlias(requested))throw policyFailure("Selectarea automată a AI-ului este dezactivată. Alege manual modelul dorit.",409);
    await requireModelAccess(context?.cloudToken,requested);
    return {task:"manual",reasons:["model ales manual"],selectedModel:requested,candidates:[{id:requested,provider:inferProvider(requested),score:0}]};
  }
  function ensureShadowUser(remoteUser) {
    if (!remoteUser?.email) return null;
    const db = store.read();
    let user = db.users.find((u) => u.cloudUserId === remoteUser.id) || db.users.find((u) => normalizeEmail(u.email) === normalizeEmail(remoteUser.email));
    if (!user) {
      user = {
        id: crypto.randomUUID(), email: normalizeEmail(remoteUser.email),
        name: remoteUser.name || String(remoteUser.email).split("@")[0],
        passwordHash: null, memoryEnabled: true, createdAt: Date.now()
      };
      db.users.push(user);
      db.assistants.push({
        id: crypto.randomUUID(), userId: user.id, name: "AI Stoica", icon: "S",
        systemPrompt: "Ești AI Stoica, asistentul principal Stoica Enterprises AI. Răspunde clar, riguros și util, în limba utilizatorului.",
        createdAt: Date.now(), builtIn: true
      });
    }
    user.cloudUserId = remoteUser.id || user.cloudUserId || null;
    user.email = normalizeEmail(remoteUser.email);
    user.name = remoteUser.name || user.name || user.email.split("@")[0];
    user.role = remoteUser.role || user.role || "user";
    user.status = remoteUser.status || user.status || "active";
    user.cloudSyncedAt = Date.now();
    store.write(db);
    return user;
  }
  function localUserFromToken(token) {
    try {
      const payload = jwt.verify(token, secret);
      const db = store.read();
      return db.users.find((u) => u.id === payload.sub) || null;
    } catch { return null; }
  }
  async function auth(req, res, next) {
    const raw = String(req.headers.authorization || "");
    const token = raw.startsWith("Bearer ") ? raw.slice(7) : "";
    if (!token) return res.status(401).json({ error: "Autentificare necesară." });

    // When Cloud is configured, validate there first. A 401/403 from Cloud wins over
    // a legacy local session, so suspended/blocked accounts cannot bypass server policy.
    if (cloudBase()) {
      try {
        const remote = await cloudFetch("/auth/me", { headers:{ Authorization:`Bearer ${token}` }, timeout:7000 });
        const text = await remote.text();
        let data={}; try { data=JSON.parse(text||"{}"); } catch {}
        if (remote.ok && data?.user) {
          const user = ensureShadowUser(data.user);
          if (!user) return res.status(401).json({ error:"Sesiune Cloud invalidă." });
          req.user = user;
          req.cloudUser = data.user;
          req.cloudToken = token;
          req.permissions = data.permissions || {};
          return next();
        }
        if (remote.status === 401 || remote.status === 403) {
          return res.status(remote.status).json(data?.error ? data : { error:"Sesiunea AI Stoica Cloud nu mai este validă." });
        }
      } catch {
        // If Cloud is temporarily unreachable we keep local-only features usable.
        // Owner/admin actions still require a verified Cloud session below.
      }
    }

    const user = localUserFromToken(token);
    if (!user) return res.status(401).json({ error: "Autentificare necesară." });
    req.user = user;
    next();
  }
  function cloudOwnerOnly(req,res,next) {
    if (!cloudBase()) return res.status(503).json({ error:"AI Stoica Cloud nu este configurat în Setări." });
    if (!req.cloudToken) return res.status(401).json({ error:"Reautentifică-te prin AI Stoica Cloud pentru Control Center." });
    if ((req.cloudUser?.role || req.user?.role) !== "owner") return res.status(403).json({ error:"Acces rezervat Owner." });
    next();
  }
  async function proxyCloud(req,res) {
    try {
      const headers = { Authorization: String(req.headers.authorization || "") };
      const hasBody = !["GET","HEAD"].includes(req.method);
      const remote = await cloudFetch(req.originalUrl, {
        method:req.method, headers, body:hasBody ? (req.body || {}) : undefined, timeout:12000
      });
      const contentType = remote.headers.get("content-type") || "application/json";
      const body = await remote.text();
      res.status(remote.status).type(contentType).send(body);
    } catch (e) {
      res.status(502).json({ error:`AI Stoica Cloud este indisponibil: ${e.message}` });
    }
  }

  app.get("/health", async (_req, res) => {
    const cfg = getOmniConfig(); let omni = false, cloudOnline = false;
    try {
      const r = await fetch(`${String(cfg.baseUrl).replace(/\/+$/, "")}/models`, {
        headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
        signal: AbortSignal.timeout(2500)
      }); omni = r.status > 0;
    } catch {}
    if (cloudBase()) {
      try { const r = await cloudFetch("/health",{timeout:2500}); cloudOnline = r.ok; } catch {}
    }
    res.json({ ok: true, service: serviceName, omni, model: cfg.model || "Ai principal", cloudConfigured:!!cloudBase(), cloudOnline });
  });

  app.post("/auth/register", async (req, res) => {
    if (cloudBase()) {
      try {
        const remote = await cloudFetch("/auth/register",{method:"POST",body:req.body || {},timeout:12000});
        const text = await remote.text(); let data={}; try{data=JSON.parse(text||"{}")}catch{}
        if (remote.ok && data?.token && data?.user) data.user = publicUser(ensureShadowUser(data.user));
        return res.status(remote.status).json(Object.keys(data).length?data:{error:text||"Răspuns Cloud invalid."});
      } catch(e) { return res.status(503).json({error:`AI Stoica Cloud este indisponibil: ${e.message}`}); }
    }
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
    if (cloudBase()) {
      try {
        const remote = await cloudFetch("/auth/login",{method:"POST",body:req.body || {},timeout:12000});
        const text = await remote.text(); let data={}; try{data=JSON.parse(text||"{}")}catch{}
        if (remote.ok && data?.token && data?.user) data.user = publicUser(ensureShadowUser(data.user));
        return res.status(remote.status).json(Object.keys(data).length?data:{error:text||"Răspuns Cloud invalid."});
      } catch(e) { return res.status(503).json({error:`AI Stoica Cloud este indisponibil: ${e.message}`}); }
    }
    const email = normalizeEmail(req.body?.email), password = String(req.body?.password || "");
    const db = store.read(), user = db.users.find((u) => u.email === email);
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: "Email sau parolă incorectă." });
    if (typeof user.memoryEnabled !== "boolean") { user.memoryEnabled = true; store.write(db); }
    res.json({ token: sign(user), user: publicUser(user) });
  });
  app.get("/auth/me", auth, (req, res) => res.json({
    token: req.cloudToken || sign(req.user),
    user: publicUser({ ...req.user, role:req.cloudUser?.role || req.user.role, status:req.cloudUser?.status || req.user.status }),
    permissions: req.permissions || {}
  }));

  // Owner Control Center is always backed by PostgreSQL on the Hetzner API.
  app.use("/api/admin", auth, cloudOwnerOnly, proxyCloud);

  app.get("/api/models", auth, async (req, res) => {
    const cfg = getOmniConfig();
    try {
      const entries=await omniModelEntries(cfg);
      const manualModels=entries.filter(x=>!isSmartAlias(typeof x==="string"?x:x?.id));
      let filtered=manualModels,policyError="";
      if(cloudBase()){
        try{filtered=await allowedOmniEntries(req,manualModels)}
        catch(e){filtered=[];policyError=e.message}
      }
      res.json({
        data:filtered,
        manualModels:filtered,
        policyEnforced:!!cloudBase(),
        policyUnavailable:!!policyError,
        policyError,
        automaticRouting:false,
        ownerControlled:true,
        deniedCount:Math.max(0,manualModels.length-filtered.length)
      });
    } catch (e) { res.status(e.status||502).json({ error:`Nu pot încărca lista de modele OmniRoute: ${e.message}` }); }
  });

  app.post("/api/router/preview", auth, (_req,res) => {
    res.status(410).json({error:"Selectarea automată a AI-ului este dezactivată. Fiecare utilizator alege manual dintre modelele permise de Owner."});
  });


  app.get("/api/tools/web/search", auth, async (req,res) => {
    try{
      if(!ownerRequest(req)&&cloudBase()&&req.permissions?.web_search!==true)return res.status(403).json({error:"Căutarea web este dezactivată pentru acest cont."});
      const query=String(req.query?.q||"").trim();if(!query)return res.status(400).json({error:"Termenul de căutare lipsește."});
      const data=await liveWebSearch(query,Math.max(1,Math.min(8,Number(req.query?.limit||5))));
      res.json({data});
    }catch(e){res.status(502).json({error:e.message})}
  });

  app.post("/api/tools/code/run", auth, ownerOnlyLocal, async (req,res) => {
    try{
      const result=await executeCode(req.body?.language||"javascript",req.body?.code||"");
      res.json({data:result});
    }catch(e){res.status(400).json({error:e.message})}
  });

  app.post("/api/tools/server/check", auth, ownerOnlyLocal, async (req,res) => {
    try{
      const cfg={...getOmniConfig(),...Object.fromEntries(["serverHost","serverPort","serverUser","serverKeyPath"].filter(k=>req.body?.[k]!==undefined).map(k=>[k,req.body[k]]))};
      const result=await sshRun(cfg,'echo AI_STOICA_SERVER_OK; uname -a 2>/dev/null || ver; uptime 2>/dev/null || true',18000);
      res.json({ok:result.code===0,output:(result.stdout||result.stderr||"").trim(),data:result});
    }catch(e){res.status(502).json({error:e.message})}
  });

  app.post("/api/tools/server/run", auth, ownerOnlyLocal, async (req,res) => {
    try{
      const command=String(req.body?.command||"").trim();if(!command)return res.status(400).json({error:"Comanda SSH lipsește."});
      const result=await sshRun(getOmniConfig(),command,Math.max(5000,Math.min(120000,Number(req.body?.timeout||45000))));
      res.json({data:result});
    }catch(e){res.status(502).json({error:e.message})}
  });

  app.get("/api/tools/github/search", auth, async (req,res) => {
    try{
      if(!ownerRequest(req)&&cloudBase()&&req.permissions?.github_access!==true)return res.status(403).json({error:"GitHub este dezactivat pentru acest cont."});
      const q=String(req.query?.q||"").trim();if(!q)return res.status(400).json({error:"Căutarea GitHub lipsește."});
      const context=await githubCodeContext(getOmniConfig(),q);
      res.json({data:{context}});
    }catch(e){res.status(502).json({error:e.message})}
  });

  app.post("/api/github/solve", auth, ownerOnlyLocal, async (req,res) => {
    try{
      const filePath=String(req.body?.path||"").trim();if(!filePath)return res.status(400).json({error:"Calea fișierului GitHub lipsește."});
      const file=await githubReadFile(getOmniConfig(),filePath,req.body?.branch);
      const solved=await generateGithubProposal(req,file,req.body?.instruction);
      res.json({data:{path:file.path,sha:file.sha,branch:file.branch,proposal:solved.proposal,model:solved.model,check:solved.check}});
    }catch(e){res.status(e.status||502).json({error:e.message})}
  });

  app.post("/api/github/apply", auth, ownerOnlyLocal, async (req,res) => {
    try{
      const filePath=String(req.body?.path||"").trim(),content=String(req.body?.content||"");
      if(!filePath||!content)return res.status(400).json({error:"Calea și conținutul sunt obligatorii."});
      const current=await githubReadFile(getOmniConfig(),filePath,req.body?.branch);
      if(req.body?.sha&&String(req.body.sha)!==String(current.sha))return res.status(409).json({error:"Fișierul s-a modificat între timp în GitHub. Rulează din nou GitHub Solve."});
      const backupId=saveGithubBackup(current);
      const result=await githubWriteFile(getOmniConfig(),{filePath:current.path,content,sha:current.sha,branch:current.branch,message:req.body?.message});
      res.json({data:{commit:result?.commit?.sha||"",contentSha:result?.content?.sha||"",backupId,path:current.path,branch:current.branch}});
    }catch(e){res.status(e.status||502).json({error:e.message})}
  });

  app.post("/api/github/rollback/:backupId", auth, ownerOnlyLocal, async (req,res) => {
    try{
      const backupPath=path.join(dataDir,"github-backups",String(req.params.backupId||"")+".json");
      if(!fs.existsSync(backupPath))return res.status(404).json({error:"Backup GitHub inexistent."});
      const backup=JSON.parse(fs.readFileSync(backupPath,"utf8"));
      const current=await githubReadFile(getOmniConfig(),backup.path,backup.branch);
      const result=await githubWriteFile(getOmniConfig(),{filePath:backup.path,content:backup.content,sha:current.sha,branch:backup.branch,message:"AI Stoica: rollback "+backup.path});
      res.json({data:{commit:result?.commit?.sha||"",path:backup.path,branch:backup.branch}});
    }catch(e){res.status(e.status||502).json({error:e.message})}
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
    const userText=String(req.body?.userText||"").trim();
    const candidate=durableMemoryCandidate(userText);
    if(!candidate)return res.json({ok:true,stored:false});
    const item=addMemory(db,req.user.id,candidate,"automatic",{conversationId:req.body?.conversationId||null,category:memoryCategory(candidate)});
    if(item)store.write(db);res.json({ok:true,stored:!!item,data:item});
  });
  app.get("/api/memory/summary", auth, (req,res) => {
    const db=store.read(),all=db.memories.filter(m=>m.userId===req.user.id);
    const pinned=all.filter(m=>m.pinned);
    const recent=[...all].sort((a,b)=>(b.updatedAt||b.createdAt)-(a.updatedAt||a.createdAt)).slice(0,12);
    const categories={};for(const m of all)categories[m.category||"detaliu"]=(categories[m.category||"detaliu"]||0)+1;
    res.json({data:{count:all.length,pinned:pinned.length,categories,recent:recent.map(m=>({id:m.id,text:m.text,category:m.category||"detaliu",pinned:!!m.pinned,updatedAt:m.updatedAt||m.createdAt}))}});
  });
  app.post("/api/memory/import-history", auth, (req,res) => {
    const db=store.read();let count=0;
    for(const c of db.conversations.filter(x=>x.userId===req.user.id)){
      for(let i=0;i<c.messages.length;i+=2){
        const u=c.messages[i],a=c.messages[i+1];if(u?.role!=="user")continue;
        const candidate=durableMemoryCandidate(textFromContent(u.content));
        if(candidate){addMemory(db,req.user.id,candidate,"history",{conversationId:c.id,category:memoryCategory(candidate)});count++;}
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
      const lowerName=String(name||"").toLowerCase();
      const kind=mime.startsWith("image/")?"image":
        (mime.startsWith("audio/")||/\.(mp3|m4a|aac|wav|ogg|oga|flac|opus|weba)$/i.test(lowerName))?"audio":
        (mime.startsWith("video/")||/\.(mp4|mov|m4v|webm|avi|mkv|mpeg|mpg)$/i.test(lowerName))?"video":
        (mime.startsWith("text/")||/\.(txt|md|csv|json|js|ts|py|html|css|xml|yaml|yml)$/i.test(lowerName))?"text":"file";
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
      const format=String(req.body?.format||"docx").toLowerCase().replace(/^\./,"");
      const title=String(req.body?.title||"AI Stoica").trim().slice(0,120)||"AI Stoica";
      const content=String(req.body?.content||"");
      if(!EXPORT_FORMATS.has(format))return res.status(400).json({error:"Format neacceptat de sistemul de fișiere AI Stoica."});
      if(!content.trim())return res.status(400).json({error:"Nu există conținut de exportat."});
      if(content.length>250000)return res.status(413).json({error:"Fișierul depășește limita de 250.000 de caractere pentru un singur export."});
      const generated=await createExportBytes(format,title,content);
      const requestedName=String(req.body?.fileName||"").trim();
      const baseName=safeGeneratedName(requestedName||title).replace(/\.[A-Za-z0-9]+$/,"")||"AI Stoica";
      const name=baseName+"."+format;
      const id=crypto.randomUUID(),target=path.join(filesDir,id+"."+format);
      fs.writeFileSync(target,generated.bytes);
      const db=store.read(),item={id,userId:req.user.id,name,mime:generated.mime,size:generated.bytes.length,kind:generated.mime.startsWith("image/")?"image":"file",filePath:target,storage:"disk",source:"ai-export",format,createdAt:Date.now()};
      db.library.push(item);store.write(db);
      res.json({data:{id:item.id,name:item.name,mimeType:item.mime,size:item.size,source:item.source,format:item.format,createdAt:item.createdAt}});
    } catch(e) { res.status(500).json({error:"Nu am putut genera fișierul: "+e.message}); }
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

  function requireFeaturePermission(req,key,label) {
    const role=req.cloudUser?.role||req.user?.role||"user";
    if(role==="owner")return;
    if(cloudBase()&&req.permissions?.[key]!==true)throw policyFailure(`${label} este dezactivată pentru acest cont.`,403);
  }
  function findMediaCandidate(value,kind) {
    const seen=new Set();
    function walk(v,key=""){
      if(v==null)return null;
      if(typeof v==="string"){
        const text=v.trim();
        if(/^data:(image|video)\/[a-z0-9.+-]+;base64,/i.test(text))return {type:"data",value:text};
        if(/^https?:\/\//i.test(text)){
          const score=(/url|uri|output|file|image|video|download|result/i.test(key)?2:0)+
            (kind==="image"&&/\.(png|jpe?g|webp|gif)(?:\?|$)/i.test(text)?2:0)+
            (kind==="video"&&/\.(mp4|webm|mov|m4v)(?:\?|$)/i.test(text)?2:0);
          if(score>0)return {type:"url",value:text};
        }
        if(kind==="image"&&/^[A-Za-z0-9+/=\r\n]{300,}$/.test(text)&&/b64|base64|image/i.test(key))return {type:"base64",value:text.replace(/\s+/g,"")};
        return null;
      }
      if(typeof v!=="object")return null;
      if(seen.has(v))return null;seen.add(v);
      if(kind==="image"&&typeof v.b64_json==="string")return {type:"base64",value:v.b64_json};
      const preferred=kind==="video"
        ?["video_url","output_url","download_url","url","uri","video","output","result","data"]
        :["b64_json","image_url","output_url","url","uri","image","output","result","data"];
      for(const k of preferred){
        if(Object.prototype.hasOwnProperty.call(v,k)){const hit=walk(v[k],k);if(hit)return hit;}
      }
      if(Array.isArray(v)){for(const x of v){const hit=walk(x,key);if(hit)return hit;}}
      else {for(const [k,x] of Object.entries(v)){if(preferred.includes(k))continue;const hit=walk(x,k);if(hit)return hit;}}
      return null;
    }
    return walk(value);
  }

  function findGenerationJobId(value){
    if(!value||typeof value!=="object")return "";
    const keys=["request_id","requestId","job_id","jobId","task_id","taskId","video_id","videoId","id"];
    for(const key of keys){
      const v=value?.[key];
      if(typeof v==="string"&&v.trim())return v.trim();
    }
    for(const container of ["data","result","job","task","video"]){
      const v=value?.[container];
      if(v&&typeof v==="object"){
        const id=findGenerationJobId(v);
        if(id)return id;
      }
    }
    return "";
  }
  function generationFailed(value){
    const status=String(value?.status||value?.state||value?.data?.status||value?.result?.status||"").toLowerCase();
    return /(fail|error|cancel|reject)/.test(status);
  }
  async function pollVideoResult(cfg,initialBody){
    let candidate=findMediaCandidate(initialBody,"video");
    if(candidate)return candidate;
    const jobId=findGenerationJobId(initialBody);
    if(!jobId)throw new Error("OmniRoute nu a returnat nici fișier video, nici ID de generare.");
    const base=String(cfg.baseUrl).replace(/\/+$/,"");
    const headers=cfg.apiKey?{Authorization:`Bearer ${cfg.apiKey}`}:{};
    const deadline=Date.now()+5*60*1000;
    let lastStatus="";
    while(Date.now()<deadline){
      await new Promise(r=>setTimeout(r,3000));
      const r=await fetch(`${base}/videos/${encodeURIComponent(jobId)}`,{headers,signal:AbortSignal.timeout(15000)});
      const text=await r.text();
      if(!r.ok){
        if(r.status===404){lastStatus="HTTP 404";continue;}
        throw new Error(`Verificarea videoclipului a eșuat: HTTP ${r.status} ${text.slice(0,500)}`);
      }
      let body;try{body=JSON.parse(text)}catch{body={url:text}}
      if(generationFailed(body))throw new Error(`Generarea videoclipului a eșuat: ${text.slice(0,700)}`);
      candidate=findMediaCandidate(body,"video");
      if(candidate)return candidate;
      lastStatus=String(body?.status||body?.state||body?.data?.status||body?.result?.status||"în lucru");
    }
    throw new Error(`Generarea videoclipului nu s-a finalizat în 5 minute${lastStatus?` (ultimul status: ${lastStatus})`:""}.`);
  }
  function inferMediaMime(bytes,declared,kind){
    const d=String(declared||"").split(";")[0].trim().toLowerCase();
    if((kind==="image"&&d.startsWith("image/"))||(kind==="video"&&d.startsWith("video/")))return d;
    if(bytes?.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])))return "image/png";
    if(bytes?.subarray(0,3).equals(Buffer.from([0xff,0xd8,0xff])))return "image/jpeg";
    if(bytes?.subarray(0,4).toString("ascii")==="RIFF"&&bytes?.subarray(8,12).toString("ascii")==="WEBP")return "image/webp";
    if(bytes?.subarray(4,8).toString("ascii")==="ftyp")return "video/mp4";
    if(bytes?.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])))return "video/webm";
    return kind==="image"?"image/png":"video/mp4";
  }
  function mediaExtFromMime(mime,kind){
    const m=String(mime||"").toLowerCase();
    if(m.includes("jpeg"))return "jpg";
    if(m.includes("webp"))return "webp";
    if(m.includes("gif"))return "gif";
    if(m.includes("webm"))return "webm";
    if(m.includes("quicktime"))return "mov";
    return kind==="image"?"png":"mp4";
  }
  async function resolveGeneratedMedia(candidate,kind){
    if(!candidate)throw new Error(`Furnizorul nu a returnat ${kind==="image"?"o imagine":"un videoclip"} descărcabil.`);
    if(candidate.type==="base64"){
      const bytes=Buffer.from(candidate.value,"base64");
      return {bytes,mime:inferMediaMime(bytes,"",kind)};
    }
    if(candidate.type==="data"){
      const m=candidate.value.match(/^data:([^;]+);base64,(.+)$/s);
      if(!m)throw new Error("Răspuns media data URL invalid.");
      const bytes=Buffer.from(m[2],"base64");
      return {bytes,mime:inferMediaMime(bytes,m[1],kind)};
    }
    const r=await fetch(candidate.value,{redirect:"follow",signal:AbortSignal.timeout(kind==="video"?180000:90000)});
    if(!r.ok)throw new Error(`Descărcarea rezultatului media a eșuat: HTTP ${r.status}`);
    const bytes=Buffer.from(await r.arrayBuffer());
    const max=kind==="video"?300*1024*1024:40*1024*1024;
    if(bytes.length>max)throw new Error(`Rezultatul ${kind==="video"?"video":"imaginii"} depășește limita locală de siguranță.`);
    return {bytes,mime:inferMediaMime(bytes,r.headers.get("content-type"),kind)};
  }
  function ownerRequest(req){return String(req.cloudUser?.role||req.user?.role||"").toLowerCase()==="owner";}

  async function fetchBinaryOrCandidate(r,kind){
    const ctype=String(r.headers.get("content-type")||"");
    if(!r.ok)throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0,700)}`);
    if((kind==="image"&&ctype.startsWith("image/"))||(kind==="video"&&ctype.startsWith("video/"))){
      const bytes=Buffer.from(await r.arrayBuffer());
      return {bytes,mime:inferMediaMime(bytes,ctype,kind)};
    }
    const text=await r.text();let body;
    try{body=JSON.parse(text)}catch{body={url:text}}
    const candidate=findMediaCandidate(body,kind);
    return resolveGeneratedMedia(candidate,kind);
  }

  async function directOpenAiImage(cfg,prompt,size){
    const key=String(cfg.openAiApiKey||"").trim();if(!key)return null;
    const model=String(cfg.imageModel||"").replace(/^openai\//i,"")||"gpt-image-2.5-flare";
    const r=await fetch("https://api.openai.com/v1/images/generations",{
      method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${key}`},
      body:JSON.stringify({model,prompt,size:String(size||"1024x1024"),quality:"auto",output_format:"png"}),
      signal:AbortSignal.timeout(180000)
    });
    const resolved=await fetchBinaryOrCandidate(r,"image");
    return {...resolved,model:`openai/${model}`,provider:"openai-direct"};
  }

  function directOpenRouterKey(cfg){
    const explicit=String(cfg.openRouterApiKey||"").trim();
    if(explicit)return explicit;
    const omniKey=String(cfg.apiKey||"").trim();
    return /^sk-or-/i.test(omniKey)?omniKey:"";
  }

  async function directOpenRouterImage(cfg,prompt){
    const key=directOpenRouterKey(cfg);if(!key)return null;
    const model=String(cfg.openRouterImageModel||"google/gemini-3.1-flash-image").trim();
    const r=await fetch("https://openrouter.ai/api/v1/images",{
      method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${key}`,"X-Title":"AI Stoica"},
      body:JSON.stringify({model,prompt}),
      signal:AbortSignal.timeout(180000)
    });
    const resolved=await fetchBinaryOrCandidate(r,"image");
    return {...resolved,model,provider:"openrouter-direct"};
  }

  async function directPollinationsImage(cfg,prompt){
    const key=String(cfg.pollinationsApiKey||"").trim();if(!key)return null;
    const model=String(cfg.pollinationsImageModel||"black-forest-labs/flux.1-schnell").trim();
    const r=await fetch("https://gen.pollinations.ai/v1/images/generations",{
      method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${key}`},
      body:JSON.stringify({model,prompt,response_format:"b64_json"}),
      signal:AbortSignal.timeout(180000)
    });
    const resolved=await fetchBinaryOrCandidate(r,"image");
    return {...resolved,model,provider:"pollinations-direct"};
  }

  async function directOpenRouterVideo(cfg,prompt,duration,aspectRatio){
    const key=directOpenRouterKey(cfg);if(!key)return null;
    const defaultModel=cfg.videoMode==="quality"?"bytedance/seedance-2.5":"bytedance/seedance-2.0-fast";
    const model=String(cfg.openRouterVideoModel||defaultModel).trim();
    const headers={"Content-Type":"application/json",Authorization:`Bearer ${key}`,"X-Title":"AI Stoica"};
    const submit=await fetch("https://openrouter.ai/api/v1/videos",{
      method:"POST",headers,
      body:JSON.stringify({model,prompt,duration:Math.max(1,Math.min(15,Number(duration||4))),resolution:"720p",aspect_ratio:String(aspectRatio||"16:9"),generate_audio:false}),
      signal:AbortSignal.timeout(60000)
    });
    const text=await submit.text();let job={};try{job=JSON.parse(text)}catch{}
    if(!submit.ok)throw new Error(`HTTP ${submit.status}: ${text.slice(0,700)}`);
    const jobId=String(job.id||job.data?.id||"");if(!jobId)throw new Error("OpenRouter nu a returnat ID-ul generării video.");
    const pollingRaw=String(job.polling_url||job.data?.polling_url||"").trim();
    const pollingUrl=pollingRaw?new URL(pollingRaw,"https://openrouter.ai").toString():`https://openrouter.ai/api/v1/videos/${encodeURIComponent(jobId)}`;
    const deadline=Date.now()+8*60*1000;
    let body=job;
    while(Date.now()<deadline){
      const state=String(body.status||body.state||body.data?.status||"").toLowerCase();
      if(/fail|error|cancel|reject|expired/.test(state))throw new Error(`Generarea video OpenRouter a eșuat: ${JSON.stringify(body).slice(0,700)}`);
      if(/complete|succeed|done|finished/.test(state)){
        const unsigned=body.unsigned_urls||body.data?.unsigned_urls||[];
        const downloadUrl=Array.isArray(unsigned)&&unsigned[0]?new URL(String(unsigned[0]),"https://openrouter.ai").toString():`https://openrouter.ai/api/v1/videos/${encodeURIComponent(jobId)}/content?index=0`;
        const file=await fetch(downloadUrl,{headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(180000)});
        const resolved=await fetchBinaryOrCandidate(file,"video");
        return {...resolved,model,provider:"openrouter-direct"};
      }
      await new Promise(r=>setTimeout(r,6000));
      const status=await fetch(pollingUrl,{headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(20000)});
      const st=await status.text();try{body=JSON.parse(st)}catch{body={status:"unknown",raw:st}}
      if(!status.ok)throw new Error(`Status video HTTP ${status.status}: ${st.slice(0,500)}`);
    }
    throw new Error("Generarea video OpenRouter nu s-a finalizat în intervalul permis.");
  }
  async function directPollinationsVideo(cfg,prompt,duration){
    const key=String(cfg.pollinationsApiKey||"").trim();if(!key)return null;
    const model=String(cfg.pollinationsVideoModel||"google/veo-3.1-fast").trim();
    const url=new URL(`https://gen.pollinations.ai/video/${encodeURIComponent(prompt)}`);
    url.searchParams.set("model",model);url.searchParams.set("duration",String(Math.max(1,Math.min(10,Number(duration||4)))));
    const r=await fetch(url,{headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(360000)});
    const resolved=await fetchBinaryOrCandidate(r,"video");
    return {...resolved,model,provider:"pollinations-direct"};
  }

  function saveGeneratedMedia(req,{bytes,mime,kind,prompt,model}){
    const id=crypto.randomUUID(),ext=mediaExtFromMime(mime,kind);
    const base=safeGeneratedName((kind==="image"?"Imagine AI Stoica":"Video AI Stoica")+" - "+String(prompt||"").slice(0,55)).replace(/\.[^.]+$/,"");
    const name=(base||`AI Stoica ${kind}`)+"."+ext,target=path.join(filesDir,id+"."+ext);
    fs.writeFileSync(target,bytes);
    const db=store.read(),item={id,userId:req.user.id,name,mime,size:bytes.length,kind,filePath:target,storage:"disk",source:kind==="image"?"ai-image":"ai-video",prompt:String(prompt||"").slice(0,2000),model:String(model||""),createdAt:Date.now()};
    db.library.push(item);store.write(db);
    return {id:item.id,name:item.name,mimeType:item.mime,size:item.size,kind:item.kind,source:item.source,model:item.model,createdAt:item.createdAt};
  }
  function mediaModelRow(entry,kind,forcedKind=false){
    const id=String(typeof entry==="string"?entry:entry?.id||"").trim();
    if(!id)return null;
    const provider=String(typeof entry==="string"?"":entry?.provider||"").trim().toLowerCase();
    const meta=(id+" "+JSON.stringify(entry||{})).toLowerCase();
    const matches=forcedKind||(kind==="image"
      ? /image|imagen|flux|sdxl|stable.?diffusion|dall.?e|gpt.?image|recraft|ideogram|playground|phoenix|kolors/.test(meta)
      : /video|runway|veo|kling|sora|seedance|hailuo|wan|ltx|minimax|hunyuan/.test(meta));
    if(!matches)return null;
    const first=id.toLowerCase().split("/")[0];
    const alreadyScoped=["openai","anthropic","google","gemini","cerebras","groq","cloudflare","openrouter","@cf"].includes(first);
    const policyId=provider&&!alreadyScoped?`${provider}/${id}`:id;
    return {entry,id,provider,policyId};
  }
  async function mediaCatalog(cfg,kind){
    const base=String(cfg.baseUrl).replace(/\/+$/,""),headers=cfg.apiKey?{Authorization:`Bearer ${cfg.apiKey}`}:{};
    const rows=[];
    try{
      const r=await fetch(`${base}/models`,{headers,signal:AbortSignal.timeout(7000)});
      if(r.ok){
        const data=await r.json(),items=Array.isArray(data)?data:(Array.isArray(data?.data)?data.data:[]);
        for(const entry of items){const row=mediaModelRow(entry,kind,false);if(row)rows.push(row)}
      }
    }catch{}
    try{
      const endpoint=kind==="image"?"/images/generations":"/videos/generations";
      const r=await fetch(base+endpoint,{headers,signal:AbortSignal.timeout(5000)});
      if(r.ok){
        const data=await r.json(),items=Array.isArray(data)?data:(Array.isArray(data?.data)?data.data:[]);
        for(const entry of items){const row=mediaModelRow(entry,kind,true);if(row)rows.push(row)}
      }
    }catch{}
    const seen=new Set();
    return rows.filter(row=>{const k=row.id.toLowerCase();if(seen.has(k))return false;seen.add(k);return true});
  }
  function localPaidHint(row){
    const p=String(row?.provider||inferProvider(row?.policyId||row?.id)||"").toLowerCase();
    return ["openai","anthropic","openrouter","runway"].includes(p)||/^(openai|anthropic|openrouter|runway)\//i.test(String(row?.policyId||row?.id||""));
  }
  async function discoverPermittedMediaModels(req,cfg,kind,explicitModel=""){
    const explicit=String(explicitModel||"").trim();
    if(explicit){
      await requireModelAccess(req.cloudToken,explicit);
      return [explicit];
    }

    const configured=String(kind==="image"?cfg.imageModel||"":cfg.videoModel||"").trim();
    const rows=await mediaCatalog(cfg,kind);
    const byId=new Map(rows.map(row=>[row.id.toLowerCase(),row]));
    if(ownerRequest(req)&&kind==="image"){
      for(const known of ["openai/gpt-image-2.5-flare","openai/gpt-image-2.5-sunburst","openai/gpt-image-2"]){
        if(!byId.has(known.toLowerCase())){
          const row=mediaModelRow({id:known,provider:"openai",type:"image"},kind,true);
          rows.push(row);byId.set(known.toLowerCase(),row);
        }
      }
    }
    if(configured&&!byId.has(configured.toLowerCase())){
      const row=mediaModelRow({id:configured},kind,true);
      if(row){rows.unshift(row);byId.set(configured.toLowerCase(),row)}
    }

    if(!rows.length)throw policyFailure(
      kind==="image"
        ?"Nu există momentan niciun model de imagine disponibil în OmniRoute."
        :"Nu există momentan niciun model video disponibil în OmniRoute.",
      503
    );

    if(!cloudBase()){
      rows.sort((a,b)=>{
        const configuredBoost=Number(b.id===configured)-Number(a.id===configured);
        if(configuredBoost)return configuredBoost;
        return Number(localPaidHint(a))-Number(localPaidHint(b));
      });
      return rows.map(x=>x.id);
    }

    const policy=await cloudModelPolicy(req.cloudToken,rows.map(x=>x.policyId));
    const decisions=new Map(policy.data.map(x=>[String(x.model),x]));
    const isOwner=(req.cloudUser?.role||req.user?.role)==="owner";
    const allowed=rows
      .map((row,index)=>({row,index,decision:decisions.get(row.policyId)}))
      .filter(x=>x.decision?.allowed)
      .sort((a,b)=>{
        const ac=Number(a.row.id===configured),bc=Number(b.row.id===configured);
        if(isOwner&&ac!==bc)return bc-ac;
        const ap=Number(a.decision?.paidRequired===true||localPaidHint(a.row));
        const bp=Number(b.decision?.paidRequired===true||localPaidHint(b.row));
        if(ap!==bp)return ap-bp;
        if(ac!==bc)return bc-ac;
        return a.index-b.index;
      });

    if(!allowed.length)throw policyFailure(
      kind==="image"
        ?"Generarea de imagini este permisă, dar nu există momentan un model de imagine gratuit sau autorizat pentru acest cont."
        :"Generarea video este permisă, dar nu există momentan un model video gratuit sau autorizat pentru acest cont.",
      403
    );
    return allowed.map(x=>x.row.id);
  }

  app.post("/api/generate/image", auth, async (req,res) => {
    try{
      requireFeaturePermission(req,"image_generation","Generarea de imagini");
      const prompt=String(req.body?.prompt||"").trim();
      if(!prompt)return res.status(400).json({error:"Descrierea imaginii lipsește."});
      const cfg=getOmniConfig(),errors=[];
      if(ownerRequest(req)){
        for(const attempt of [
          ["OpenAI direct",()=>directOpenAiImage(cfg,prompt,req.body?.size)],
          ["OpenRouter direct",()=>directOpenRouterImage(cfg,prompt)],
          ["Pollinations direct",()=>directPollinationsImage(cfg,prompt)]
        ]){
          try{
            const resolved=await attempt[1]();
            if(resolved?.bytes?.length)return res.json({data:saveGeneratedMedia(req,{...resolved,kind:"image",prompt,model:resolved.model||attempt[0]})});
          }catch(e){errors.push(`${attempt[0]}: ${e.message}`)}
        }
      }
      const models=(await discoverPermittedMediaModels(req,cfg,"image",req.body?.model)).slice(0,3);
      const imageUrl=`${String(cfg.baseUrl).replace(/\/+$/,"")}/images/generations`;
      const imageHeaders={"Content-Type":"application/json",...(cfg.apiKey?{Authorization:`Bearer ${cfg.apiKey}`}:{})};
      for(const model of models){
        try{
          let upstream=await fetch(imageUrl,{
            method:"POST",headers:imageHeaders,
            body:JSON.stringify({model,prompt,size:String(req.body?.size||"1024x1024"),n:1,response_format:"b64_json"}),
            signal:AbortSignal.timeout(180000)
          });
          if(!upstream.ok&&[400,404,405,409,422].includes(upstream.status)){
            upstream=await fetch(imageUrl,{
              method:"POST",headers:imageHeaders,
              body:JSON.stringify({model,prompt,size:String(req.body?.size||"1024x1024"),n:1}),
              signal:AbortSignal.timeout(180000)
            });
          }
          const ctype=upstream.headers.get("content-type")||"";
          if(!upstream.ok){errors.push(`${model}: HTTP ${upstream.status} ${(await upstream.text()).slice(0,350)}`);continue}
          let resolved;
          if(ctype.startsWith("image/")){
            const bytes=Buffer.from(await upstream.arrayBuffer());resolved={bytes,mime:inferMediaMime(bytes,ctype,"image")};
          }else{
            const body=await upstream.json(),candidate=findMediaCandidate(body,"image");
            resolved=await resolveGeneratedMedia(candidate,"image");
          }
          if(!resolved.bytes.length){errors.push(`${model}: imagine goală`);continue}
          return res.json({data:saveGeneratedMedia(req,{...resolved,kind:"image",prompt,model})});
        }catch(e){errors.push(`${model}: ${e.message}`)}
      }
      if(ownerRequest(req)){
        for(const attempt of [
          ["OpenAI direct",()=>directOpenAiImage(cfg,prompt,req.body?.size)],
          ["OpenRouter direct",()=>directOpenRouterImage(cfg,prompt)],
          ["Pollinations direct",()=>directPollinationsImage(cfg,prompt)]
        ]){
          try{
            const resolved=await attempt[1]();
            if(resolved?.bytes?.length)return res.json({data:saveGeneratedMedia(req,{...resolved,kind:"image",prompt,model:resolved.model||attempt[0]})});
          }catch(e){errors.push(`${attempt[0]}: ${e.message}`)}
        }
      }
      const providerHint=ownerRequest(req)&&!cfg.openAiApiKey&&!directOpenRouterKey(cfg)&&!cfg.pollinationsApiKey
        ?" Nu există o cheie media directă configurată; adaugă o cheie OpenAI, OpenRouter sau Pollinations în Setări > AI & OmniRoute."
        :"";
      throw policyFailure(`Generarea imaginii nu a produs un fișier real.${providerHint} ${errors.slice(0,6).join(" | ")}`.trim(),502);
    }catch(e){res.status(e.status||502).json({error:e.message})}
  });

  app.post("/api/generate/video", auth, async (req,res) => {
    try{
      requireFeaturePermission(req,"video_generation","Generarea de videoclipuri");
      const prompt=String(req.body?.prompt||"").trim();
      if(!prompt)return res.status(400).json({error:"Descrierea videoclipului lipsește."});
      const cfg=getOmniConfig(),errors=[];
      if(ownerRequest(req)){
        for(const attempt of [
          ["OpenRouter direct",()=>directOpenRouterVideo(cfg,prompt,req.body?.duration,req.body?.aspectRatio)],
          ["Pollinations direct",()=>directPollinationsVideo(cfg,prompt,req.body?.duration)]
        ]){
          try{
            const resolved=await attempt[1]();
            if(resolved?.bytes?.length)return res.json({data:saveGeneratedMedia(req,{...resolved,kind:"video",prompt,model:resolved.model||attempt[0]})});
          }catch(e){errors.push(`${attempt[0]}: ${e.message}`)}
        }
      }
      const models=(await discoverPermittedMediaModels(req,cfg,"video",req.body?.model)).slice(0,3);
      const videoUrl=`${String(cfg.baseUrl).replace(/\/+$/,"")}/videos/generations`;
      const videoHeaders={"Content-Type":"application/json",...(cfg.apiKey?{Authorization:`Bearer ${cfg.apiKey}`}:{})};
      for(const model of models){
        try{
          let upstream=await fetch(videoUrl,{
            method:"POST",headers:videoHeaders,
            body:JSON.stringify({model,prompt,duration:Math.max(1,Math.min(10,Number(req.body?.duration||4))),aspect_ratio:String(req.body?.aspectRatio||"16:9")}),
            signal:AbortSignal.timeout(360000)
          });
          if(!upstream.ok&&[400,404,405,409,422].includes(upstream.status)){
            upstream=await fetch(videoUrl,{
              method:"POST",headers:videoHeaders,body:JSON.stringify({model,prompt}),
              signal:AbortSignal.timeout(360000)
            });
          }
          const ctype=upstream.headers.get("content-type")||"";
          if(!upstream.ok){errors.push(`${model}: HTTP ${upstream.status} ${(await upstream.text()).slice(0,350)}`);continue}
          let resolved;
          if(ctype.startsWith("video/")){
            const bytes=Buffer.from(await upstream.arrayBuffer());resolved={bytes,mime:inferMediaMime(bytes,ctype,"video")};
          }else{
            const body=await upstream.json();
            const candidate=await pollVideoResult(cfg,body);
            resolved=await resolveGeneratedMedia(candidate,"video");
          }
          if(!resolved.bytes.length){errors.push(`${model}: video gol`);continue}
          return res.json({data:saveGeneratedMedia(req,{...resolved,kind:"video",prompt,model})});
        }catch(e){errors.push(`${model}: ${e.message}`)}
      }
      if(ownerRequest(req)){
        for(const attempt of [
          ["OpenRouter direct",()=>directOpenRouterVideo(cfg,prompt,req.body?.duration,req.body?.aspectRatio)],
          ["Pollinations direct",()=>directPollinationsVideo(cfg,prompt,req.body?.duration)]
        ]){
          try{
            const resolved=await attempt[1]();
            if(resolved?.bytes?.length)return res.json({data:saveGeneratedMedia(req,{...resolved,kind:"video",prompt,model:resolved.model||attempt[0]})});
          }catch(e){errors.push(`${attempt[0]}: ${e.message}`)}
        }
      }
      const providerHint=ownerRequest(req)&&!directOpenRouterKey(cfg)&&!cfg.pollinationsApiKey
        ?" Nu există o cheie directă pentru video configurată; adaugă o cheie OpenRouter sau Pollinations în Setări > AI & OmniRoute."
        :"";
      throw policyFailure(`Generarea videoclipului nu a produs un fișier MP4 real.${providerHint} ${errors.slice(0,6).join(" | ")}`.trim(),502);
    }catch(e){res.status(e.status||502).json({error:e.message})}
  });

  function publicPlugin(item){
    const {apiKey,accessToken,refreshToken,oauthClientSecret,...safe}=item||{};
    return {...safe,hasKey:!!apiKey,oauthConnected:!!item?.oauthConnected};
  }

  app.post("/api/plugins/oauth/start", auth, (req,res) => {
    try{
      const name=String(req.body?.name||"").trim(),provider=String(req.body?.provider||"").trim();
      const clientId=String(req.body?.clientId||"").trim(),clientSecret=String(req.body?.clientSecret||"").trim();
      const authUrl=String(req.body?.authUrl||"").trim(),tokenUrl=String(req.body?.tokenUrl||"").trim(),apiUrl=String(req.body?.apiUrl||"").trim();
      if(!name||!provider||!clientId||!authUrl||!tokenUrl||!apiUrl)return res.status(400).json({error:"Configurația OAuth este incompletă."});
      for(const candidate of [authUrl,tokenUrl,apiUrl]){const u=new URL(candidate);if(u.protocol!=="https:")throw new Error("OAuth/API trebuie să folosească HTTPS.");}
      const state=crypto.randomBytes(24).toString("hex");
      const verifier=crypto.randomBytes(48).toString("base64url");
      const challenge=crypto.createHash("sha256").update(verifier).digest("base64url");
      const redirectUri=`http://127.0.0.1:${port}/api/plugins/oauth/callback`;
      const u=new URL(authUrl);
      u.searchParams.set("response_type","code");
      u.searchParams.set("client_id",clientId);
      u.searchParams.set("redirect_uri",redirectUri);
      u.searchParams.set("state",state);
      const scopes=String(req.body?.scopes||"").trim();if(scopes)u.searchParams.set("scope",scopes);
      u.searchParams.set("code_challenge",challenge);u.searchParams.set("code_challenge_method","S256");
      if(provider.startsWith("google")){u.searchParams.set("access_type","offline");u.searchParams.set("prompt","consent");}
      if(provider==="notion")u.searchParams.set("owner","user");
      oauthPending.set(state,{
        userId:req.user.id,name,description:String(req.body?.description||""),trigger:String(req.body?.trigger||`@${name.toLowerCase().replace(/\s+/g,"-")}`),
        auto:!!req.body?.auto,provider,clientId,clientSecret,authUrl,tokenUrl,apiUrl,method:String(req.body?.method||"GET").toUpperCase(),
        scopes,redirectUri,verifier,createdAt:Date.now()
      });
      for(const [key,p] of oauthPending)if(Date.now()-p.createdAt>10*60*1000)oauthPending.delete(key);
      res.json({authorizeUrl:u.toString(),state,redirectUri});
    }catch(e){res.status(400).json({error:e.message})}
  });

  app.get("/api/plugins/oauth/callback", async (req,res) => {
    const state=String(req.query?.state||""),code=String(req.query?.code||""),oauthError=String(req.query?.error||"");
    const pending=oauthPending.get(state);oauthPending.delete(state);
    const finish=(ok,message)=>res.status(ok?200:400).type("html").send(`<!doctype html><html><head><meta charset="utf-8"><title>AI Stoica OAuth</title></head><body style="font-family:Segoe UI,Arial;background:#0b1018;color:#eef4ff;padding:40px"><h2>${ok?"AI Stoica — conectat":"AI Stoica — conexiune eșuată"}</h2><p>${String(message).replace(/[<>&]/g,x=>({"<":"&lt;",">":"&gt;","&":"&amp;"}[x]))}</p><p>Poți închide această fereastră și reveni în AI Stoica.</p></body></html>`);
    if(!pending)return finish(false,"Sesiunea OAuth a expirat. Reîncearcă din AI Stoica.");
    if(oauthError)return finish(false,`Providerul a refuzat autorizarea: ${oauthError}`);
    if(!code)return finish(false,"Providerul nu a returnat codul de autorizare.");
    try{
      let tokenResponse;
      if(pending.provider==="notion"){
        tokenResponse=await fetch(pending.tokenUrl,{
          method:"POST",
          headers:{"Content-Type":"application/json","Authorization":"Basic "+Buffer.from(`${pending.clientId}:${pending.clientSecret}`).toString("base64")},
          body:JSON.stringify({grant_type:"authorization_code",code,redirect_uri:pending.redirectUri}),
          signal:AbortSignal.timeout(15000)
        });
      }else{
        const form=new URLSearchParams({grant_type:"authorization_code",code,redirect_uri:pending.redirectUri,client_id:pending.clientId,code_verifier:pending.verifier});
        if(pending.clientSecret)form.set("client_secret",pending.clientSecret);
        tokenResponse=await fetch(pending.tokenUrl,{
          method:"POST",
          headers:{"Content-Type":"application/x-www-form-urlencoded","Accept":"application/json"},
          body:form,signal:AbortSignal.timeout(15000)
        });
      }
      const text=await tokenResponse.text();let token={};try{token=JSON.parse(text)}catch{}
      const accessToken=String(token.access_token||token?.authed_user?.access_token||"");
      if(!tokenResponse.ok||!accessToken)throw new Error(token.error_description||token.error||text.slice(0,500)||`Token HTTP ${tokenResponse.status}`);
      const db=store.read();
      db.plugins=db.plugins.filter(x=>!(x.userId===pending.userId&&String(x.name).toLowerCase()===pending.name.toLowerCase()));
      const item={
        id:crypto.randomUUID(),userId:pending.userId,name:pending.name,description:pending.description,url:pending.apiUrl,method:pending.method,
        trigger:pending.trigger,auto:pending.auto,enabled:true,oauthConnected:true,oauthProvider:pending.provider,
        oauthClientId:pending.clientId,oauthClientSecret:pending.clientSecret,oauthTokenUrl:pending.tokenUrl,oauthScopes:pending.scopes,
        accessToken,refreshToken:String(token.refresh_token||""),tokenExpiresAt:token.expires_in?Date.now()+Number(token.expires_in)*1000:null,createdAt:Date.now()
      };
      db.plugins.push(item);store.write(db);
      return finish(true,`${pending.name} a fost autorizat și legat de AI Stoica.`);
    }catch(e){return finish(false,`Nu am putut finaliza OAuth: ${e.message}`)}
  });

  app.get("/api/plugins", auth, (req,res) => {const db=store.read();res.json({data:db.plugins.filter(x=>x.userId===req.user.id).map(publicPlugin)});});

  app.post("/api/plugins/direct", auth, (req,res) => {
    const name=String(req.body?.name||"").trim(),appUrl=String(req.body?.appUrl||"").trim();
    if(!name||!appUrl)return res.status(400).json({error:"Numele și adresa aplicației sunt obligatorii."});
    try{
      const u=new URL(appUrl);
      if(!["https:","http:"].includes(u.protocol))throw new Error("protocol");
    }catch{return res.status(400).json({error:"Adresa aplicației nu este validă."})}
    const db=store.read();
    db.plugins=db.plugins.filter(x=>!(x.userId===req.user.id&&String(x.name||"").toLowerCase()===name.toLowerCase()));
    const item={
      id:crypto.randomUUID(),userId:req.user.id,name,
      description:String(req.body?.description||"Deschidere directă în aplicația oficială"),
      url:appUrl,appUrl,method:"OPEN",mode:"direct_app",
      trigger:String(req.body?.trigger||`@${name.toLowerCase().replace(/\s+/g,"-")}`),
      auto:false,enabled:true,oauthConnected:false,createdAt:Date.now()
    };
    db.plugins.push(item);store.write(db);res.json({data:publicPlugin(item)});
  });

  app.post("/api/plugins", auth, (req,res) => {
    const name=String(req.body?.name||"").trim(),url=String(req.body?.url||"").trim();if(!name||!url)return res.status(400).json({error:"Numele și URL-ul sunt obligatorii."});
    try{new URL(url)}catch{return res.status(400).json({error:"URL-ul pluginului nu este valid."})}
    const db=store.read(),item={id:crypto.randomUUID(),userId:req.user.id,name,description:String(req.body?.description||""),url,method:String(req.body?.method||"POST").toUpperCase(),trigger:String(req.body?.trigger||`@${name.toLowerCase().replace(/\s+/g,"-")}`),auto:!!req.body?.auto,enabled:true,authType:String(req.body?.authType||"bearer"),headerName:String(req.body?.headerName||"X-API-Key"),apiKey:String(req.body?.apiKey||""),createdAt:Date.now()};
    db.plugins.push(item);store.write(db);res.json({data:publicPlugin(item)});
  });
  app.patch("/api/plugins/:id", auth, (req,res) => {
    const db=store.read(),item=db.plugins.find(x=>x.id===req.params.id&&x.userId===req.user.id);if(!item)return res.status(404).json({error:"Pluginul nu a fost găsit."});
    for(const k of ["name","description","url","method","trigger","auto","enabled","authType","headerName"])if(Object.prototype.hasOwnProperty.call(req.body||{},k))item[k]=req.body[k];
    if(req.body?.apiKey)item.apiKey=String(req.body.apiKey);store.write(db);res.json({data:publicPlugin(item)});
  });
  app.post("/api/plugins/:id/test", auth, async (req,res) => {
    const db=store.read(),item=db.plugins.find(x=>x.id===req.params.id&&x.userId===req.user.id);if(!item)return res.status(404).json({error:"Pluginul nu a fost găsit."});
    if(item.mode==="direct_app")return res.json({ok:true,direct:true,appUrl:item.appUrl||item.url,result:"Conexiune directă pregătită. Aplicația se deschide fără OAuth."});
    try{const result=await callPlugin(item,String(req.body?.message||"Test AI Stoica"));res.json({ok:true,result:String(result).slice(0,5000)});}catch(e){res.status(502).json({error:e.message});}
  });
  app.delete("/api/plugins/:id", auth, (req,res) => {const db=store.read();db.plugins=db.plugins.filter(x=>!(x.id===req.params.id&&x.userId===req.user.id));store.write(db);res.json({ok:true});});

  function publicAutomation(item){const {cloudToken,...safe}=item||{};return safe;}
  app.get("/api/automations", auth, (req,res) => {const db=store.read();res.json({data:db.automations.filter(x=>x.userId===req.user.id).sort((a,b)=>b.createdAt-a.createdAt).map(publicAutomation)});});
  app.post("/api/automations", auth, async (req,res) => {
    const title=String(req.body?.title||"").trim(),prompt=String(req.body?.prompt||"").trim();if(!title||!prompt)return res.status(400).json({error:"Titlul și instrucțiunea sunt obligatorii."});
    const selectedModel=String(req.body?.model||getOmniConfig()?.model||"").trim();
    try{await requireModelAccess(req.cloudToken,selectedModel);}catch(e){return res.status(e.status||403).json({error:e.message})}
    const timingMode=["exact_schedule","flexible_schedule","condition_watch"].includes(req.body?.timingMode)?req.body.timingMode:"exact_schedule";
    const db=store.read(),item={id:crypto.randomUUID(),userId:req.user.id,title,prompt,trigger:String(req.body?.trigger||`@${title.toLowerCase().replace(/[^a-z0-9ăâîșț]+/gi,"-").replace(/^-|-$/g,"")}`),frequency:req.body?.frequency||"daily",time:req.body?.time||"09:00",weekday:Number(req.body?.weekday??1),days:Array.isArray(req.body?.days)?req.body.days.map(Number):[],runAt:Number(req.body?.runAt||0)||null,intervalHours:Math.max(1,Number(req.body?.intervalHours||1)),monthday:Math.max(1,Math.min(28,Number(req.body?.monthday||1))),timingMode,notify:req.body?.notify!==false,model:selectedModel,cloudToken:req.cloudToken||null,enabled:true,lastRunAt:null,lastResult:"",lastStatus:"created",createdAt:Date.now()};
    item.nextRunAt=nextRun(item,Date.now());db.automations.push(item);store.write(db);res.json({data:publicAutomation(item)});
  });
  app.patch("/api/automations/:id", auth, async (req,res) => {
    const db=store.read(),item=db.automations.find(x=>x.id===req.params.id&&x.userId===req.user.id);if(!item)return res.status(404).json({error:"Automatizarea nu a fost găsită."});
    const nextModel=String(Object.prototype.hasOwnProperty.call(req.body||{},"model")?req.body.model:(item.model||getOmniConfig()?.model||"")).trim();
    try{await requireModelAccess(req.cloudToken,nextModel);}catch(e){return res.status(e.status||403).json({error:e.message})}
    for(const k of ["title","prompt","trigger","frequency","time","weekday","days","runAt","intervalHours","monthday","timingMode","notify","model","enabled"])if(Object.prototype.hasOwnProperty.call(req.body||{},k))item[k]=req.body[k];
    item.model=nextModel;if(req.cloudToken)item.cloudToken=req.cloudToken;
    item.nextRunAt=item.enabled?nextRun(item,Date.now()):null;store.write(db);res.json({data:publicAutomation(item)});
  });
  app.post("/api/automations/:id/run", auth, async (req,res) => {
    const db=store.read(),item=db.automations.find(x=>x.id===req.params.id&&x.userId===req.user.id);if(!item)return res.status(404).json({error:"Automatizarea nu a fost găsită."});
    try{await runAutomation(item,req.cloudToken||item.cloudToken);const fresh=store.read().automations.find(x=>x.id===item.id);res.json({data:publicAutomation(fresh)});}catch(e){res.status(e.status||502).json({error:e.message});}
  });
  app.delete("/api/automations/:id", auth, (req,res) => {const db=store.read();db.automations=db.automations.filter(x=>!(x.id===req.params.id&&x.userId===req.user.id));store.write(db);res.json({ok:true});});

  function mediaExtension(mime,name="") {
    const fromName=path.extname(String(name||"")).replace(/^\./,"").toLowerCase();
    if(fromName&&/^[a-z0-9]{1,8}$/.test(fromName))return fromName;
    const m=String(mime||"").toLowerCase();
    if(m.includes("mpeg"))return "mp3";
    if(m.includes("ogg"))return "ogg";
    if(m.includes("wav"))return "wav";
    if(m.includes("webm"))return "webm";
    if(m.includes("mp4"))return m.startsWith("video/")?"mp4":"m4a";
    if(m.includes("quicktime"))return "mov";
    if(m.includes("aac"))return "aac";
    if(m.includes("flac"))return "flac";
    return "webm";
  }
  async function transcribeMedia(req,{bytes,mime,name,language,model}) {
    const cfg=getOmniConfig();
    if(!bytes?.length)throw policyFailure("Fișierul audio/video este gol.",400);
    if(bytes.length>25*1024*1024)throw policyFailure("Transcrierea automată acceptă maximum 25 MB per fișier. Fișierul rămâne salvat în Bibliotecă.",413);
    const candidates=[...new Set([
      String(model||"").trim(),
      String(cfg.speechModel||"").trim(),
      "openai/whisper-1",
      "groq/whisper-large-v3-turbo",
      "deepgram/nova-3"
    ].filter(Boolean))];
    let permittedCandidates=candidates;
    if(cloudBase()){
      const policy=await cloudModelPolicy(req.cloudToken,candidates);
      const allowed=new Set(policy.data.filter(x=>x.allowed).map(x=>String(x.model)));
      permittedCandidates=candidates.filter(x=>allowed.has(String(x)));
      if(!permittedCandidates.length)throw policyFailure("Contul nu are acces la niciun model de transcriere disponibil.",403);
    }
    const errors=[];
    const ext=mediaExtension(mime,name);
    for(const candidate of permittedCandidates){
      try{
        const form=new FormData();
        form.append("file",new Blob([bytes],{type:mime||"application/octet-stream"}),String(name||`media.${ext}`));
        form.append("model",candidate);
        const lang=String(language||cfg.speechLanguage||"ro").trim();
        if(lang)form.append("language",lang);
        const r=await fetch(`${String(cfg.baseUrl).replace(/\/+$/,"")}/audio/transcriptions`,{
          method:"POST",
          headers:cfg.apiKey?{Authorization:`Bearer ${cfg.apiKey}`}:{},
          body:form,
          signal:AbortSignal.timeout(60000)
        });
        const body=await r.text();
        if(!r.ok){errors.push(`${candidate}: HTTP ${r.status}`);continue;}
        let data;try{data=JSON.parse(body)}catch{data={text:body}}
        const text=String(data?.text||data?.transcript||"").trim();
        if(text)return {text,model:candidate};
        errors.push(`${candidate}: răspuns fără text`);
      }catch(e){errors.push(`${candidate}: ${e.message}`)}
    }
    throw policyFailure(`Nu am putut transcrie fișierul prin OmniRoute. ${errors.join(" | ")}`,502);
  }

  app.post("/api/transcribe", auth, async (req,res) => {
    try{
      const raw=String(req.body?.audio||"");
      const match=raw.match(/^data:([^;]+);base64,(.+)$/s);
      if(!match)return res.status(400).json({error:"Înregistrarea audio nu este validă."});
      const mime=String(req.body?.mime||match[1]||"audio/webm");
      const bytes=Buffer.from(match[2],"base64");
      const result=await transcribeMedia(req,{bytes,mime,name:`recording.${mediaExtension(mime)}`,language:req.body?.language,model:req.body?.model});
      res.json(result);
    }catch(e){res.status(e.status||502).json({error:e.message})}
  });

  app.post("/api/library/:id/transcribe", auth, async (req,res) => {
    try{
      const db=store.read(),item=db.library.find(x=>x.id===req.params.id&&x.userId===req.user.id);
      if(!item)return res.status(404).json({error:"Fișierul nu a fost găsit."});
      const isMedia=item.kind==="audio"||item.kind==="video"||String(item.mime||"").startsWith("audio/")||String(item.mime||"").startsWith("video/");
      if(!isMedia)return res.status(400).json({error:"Fișierul nu este audio sau video."});
      let bytes;
      if(item.filePath&&fs.existsSync(item.filePath))bytes=fs.readFileSync(item.filePath);
      else if(item.dataUrl){
        const m=String(item.dataUrl).match(/^data:([^;]+);base64,(.+)$/s);
        if(m)bytes=Buffer.from(m[2],"base64");
      }
      if(!bytes)return res.status(404).json({error:"Conținutul media nu mai este disponibil."});
      const result=await transcribeMedia(req,{bytes,mime:item.mime,name:item.name,language:req.body?.language,model:req.body?.model});
      res.json({...result,fileId:item.id,name:item.name});
    }catch(e){res.status(e.status||502).json({error:e.message})}
  });

  async function prepareMessages(rawMessages, assistantId, userId, options={}) {
    const db=store.read(),messages=Array.isArray(rawMessages)?rawMessages:[];
    const latest=[...messages].reverse().find(m=>m.role==="user");const latestText=textFromContent(latest?.content);
    const cfg=getOmniConfig(),system=[];
    system.push("Când utilizatorul cere un fișier descărcabil (PDF, DOCX/Word, PPTX/PowerPoint, XLSX/Excel, CSV, JSON, Markdown, TXT, HTML, XML, RTF, ZIP, notebook sau fișier de cod), redactează direct conținutul final care trebuie introdus în acel fișier. Pentru XLSX/CSV folosește preferabil un tabel Markdown cu antete; pentru JSON produce JSON valid; pentru HTML/XML/SVG și cod produce conținut valid, fără explicații în afara lui. Nu afișa pseudo-comenzi de tool: aplicația creează fișierul real și îl atașează separat.");
    system.push("Capabilități AI Stoica: aplicația are memorie persistentă, poate primi context din alte conversații ale aceluiași Proiect, poate căuta internetul în timp real, poate căuta fragmente relevante într-un repository GitHub configurat și Owner-ul poate rula/testa cod JavaScript sau Python și poate lucra cu serverul SSH configurat. Nu afirma că aceste capabilități nu există atunci când contextul lor este prezent. Nu pretinde însă că un cod a fost executat dacă nu ai primit explicit un rezultat de rulare. Pentru proiecte mari, lucrează modular și folosește contextul relevant recuperat, fără a cere utilizatorului să copieze manual întreaga bază de cod.");
    system.push("Fiabilitate: pentru informații actuale despre biblioteci, API-uri, modele, versiuni, prețuri sau servicii folosește prioritar contextul WEB LIVE dacă este disponibil și include la final o secțiune scurtă «Surse» cu linkurile folosite. Pentru cod, separă clar ce ai analizat de ce a fost efectiv rulat/testat. Pentru medical, juridic și financiar poți analiza și cita surse, dar păstrează recomandarea de validare umană atunci când decizia are consecințe importante.");
    const assistant=db.assistants.find(a=>a.id===assistantId&&a.userId===userId);if(assistant?.systemPrompt)system.push(assistant.systemPrompt);
    const user=db.users.find(u=>u.id===userId);
    if(user?.memoryEnabled!==false){
      const mem=memoryMatches(db,userId,latestText,8);if(mem.length)system.push("Memorie relevantă despre utilizator și conversațiile anterioare:\n"+mem.map((m,i)=>`${i+1}. ${m.text}`).join("\n"));
    }
    const pctx=await pluginContext(db,userId,latestText);if(pctx.length)system.push("Rezultate furnizate de pluginuri conectate:\n"+pctx.join("\n\n"));
    if(cfg.projectContextEnabled!==false&&options.projectId){const pc=projectContext(db,userId,options.projectId,latestText);if(pc)system.push("CONTEXT PERSISTENT DIN ACELAȘI PROIECT:\n"+pc)}
    if(cfg.webSearchEnabled!==false&&options.webAllowed!==false){
      try{const directUrls=urlsFromText(latestText);if(directUrls.length){const pages=[];for(const url of directUrls){const excerpt=await pageExcerpt(url,5000);if(excerpt)pages.push("URL: "+url+"\nExtras: "+excerpt)}if(pages.length)system.push("PAGINI WEB LIVE — conținut citit direct din linkurile utilizatorului:\n"+pages.join("\n\n"))}}catch{}
      if(shouldUseLiveWeb(latestText)){try{const rows=await liveWebSearch(latestText,5);if(rows.length)system.push("WEB LIVE — rezultate obținute acum. Folosește-le pentru informațiile actuale și indică sursele prin link; nu inventa surse:\n"+rows.map((x,i)=>(i+1)+". "+x.title+"\nURL: "+x.url+"\nExtras: "+String(x.excerpt||"").slice(0,2600)).join("\n\n"))}catch{}}
    }
    if(cfg.githubAutoContext!==false&&options.githubAllowed!==false){try{const gc=await githubCodeContext(cfg,latestText);if(gc)system.push("GITHUB LIVE — fragmente relevante din repository-ul configurat:\n"+gc)}catch{}}
    if(options.owner&&/\b(rulează|ruleaza|execută|executa|testează|testeaza|run|execute|test)\b/i.test(latestText)){
      const fence=String(latestText||"").match(/```(javascript|js|node|python|py|python3)\s*\n([\s\S]*?)```/i);
      if(fence){
        try{
          const rr=await executeCode(fence[1],fence[2]);
          system.push("RULARE COD REALĂ — executată local la cererea explicită a Owner-ului:\nLimbaj: "+rr.language+"\nExit code: "+rr.code+"\nTimeout: "+(rr.timedOut?"DA":"NU")+"\nSTDOUT:\n"+(rr.stdout||"(gol)")+"\nSTDERR:\n"+(rr.stderr||"(gol)"));
        }catch(e){system.push("RULARE COD REALĂ — a eșuat: "+e.message)}
      }
    }
    if(options.owner&&cfg.serverHost&&/\b(server|ssh|hetzner|deploy|deployment|producție|productie|nginx|ubuntu)\b/i.test(latestText)){
      try{const s=await sshRun(cfg,"uname -a; uptime; pwd",12000);if(s.stdout)system.push("SERVER LIVE — verificare read-only efectuată acum:\n"+s.stdout.slice(0,8000))}catch(e){system.push("SERVER LIVE — conexiunea de verificare nu a reușit: "+e.message)}
    }
    return system.length?[{role:"system",content:system.join("\n\n")},...messages.filter(m=>m.role!=="system")]:messages;
  }

  async function fetchChatCandidate(cfg,model,messages,stream){
    return await fetch(`${String(cfg.baseUrl).replace(/\/+$/,"")}/chat/completions`,{
      method:"POST",
      headers:{"Content-Type":"application/json",...(cfg.apiKey?{Authorization:`Bearer ${cfg.apiKey}`}:{})},
      body:JSON.stringify({model,messages,stream,temperature:0.4}),
      signal:AbortSignal.timeout(stream?120000:90000)
    });
  }
  app.post("/api/chat", auth, async (req,res) => {
    const cfg=getOmniConfig(),requestedModel=String(req.body?.model||cfg.model||"").trim(),messages=await prepareMessages(req.body?.messages,req.body?.assistantId,req.user.id,{projectId:req.body?.projectId||null,webAllowed:ownerRequest(req)||req.permissions?.web_search!==false,githubAllowed:ownerRequest(req)||req.permissions?.github_access===true,owner:ownerRequest(req)});if(!messages.length)return res.status(400).json({error:"Nu există mesaje."});
    try{
      const route=await resolveChatRoute(req,messages,requestedModel);
      const errors=[];
      for(const candidate of route.candidates){
        try{
          const r=await fetchChatCandidate(cfg,candidate.id,messages,false);
          const body=await r.text();
          if(!r.ok){errors.push(`${candidate.id}: HTTP ${r.status}`);continue;}
          res.setHeader("X-AI-Stoica-Route",route.task);
          res.setHeader("X-AI-Stoica-Model",candidate.id);
          return res.status(200).type(r.headers.get("content-type")||"application/json").send(body);
        }catch(e){errors.push(`${candidate.id}: ${e.message}`)}
      }
      throw policyFailure("Niciun model selectat de AI Stoica nu a putut răspunde. "+errors.join(" | "),502);
    }catch(e){res.status(e.status||502).json({error:e.message})}
  });
  app.post("/api/chat/stream", auth, async (req,res) => {
    const cfg=getOmniConfig(),requestedModel=String(req.body?.model||cfg.model||"").trim(),messages=await prepareMessages(req.body?.messages,req.body?.assistantId,req.user.id,{projectId:req.body?.projectId||null,webAllowed:ownerRequest(req)||req.permissions?.web_search!==false,githubAllowed:ownerRequest(req)||req.permissions?.github_access===true,owner:ownerRequest(req)});if(!messages.length)return res.status(400).json({error:"Nu există mesaje."});
    try{
      const route=await resolveChatRoute(req,messages,requestedModel);
      const errors=[];let upstream=null,usedModel="";
      for(const candidate of route.candidates){
        try{
          const r=await fetchChatCandidate(cfg,candidate.id,messages,true);
          if(!r.ok){errors.push(`${candidate.id}: HTTP ${r.status} ${(await r.text()).slice(0,300)}`);continue;}
          upstream=r;usedModel=candidate.id;break;
        }catch(e){errors.push(`${candidate.id}: ${e.message}`)}
      }
      if(!upstream)throw policyFailure("Niciun model selectat de AI Stoica nu a putut răspunde. "+errors.join(" | "),502);
      const ctype=upstream.headers.get("content-type")||"";
      res.status(200);
      res.setHeader("Content-Type","text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control","no-cache, no-transform");
      res.setHeader("Connection","keep-alive");
      res.setHeader("X-AI-Stoica-Route",route.task);
      res.setHeader("X-AI-Stoica-Model",usedModel);
      const usedCandidate=route.candidates.find(x=>x.id===usedModel)||{};
      res.write(`data: ${JSON.stringify({ai_stoica_route:{task:route.task,model:usedModel,provider:usedCandidate.provider||inferProvider(usedModel),reasons:route.reasons||[]}})}\n\n`);
      if(!ctype.includes("text/event-stream")){const data=await upstream.json(),text=data?.choices?.[0]?.message?.content||"";res.write(`data: ${JSON.stringify({choices:[{delta:{content:text}}]})}\n\n`);res.write("data: [DONE]\n\n");return res.end();}
      const reader=upstream.body.getReader();while(true){const {value,done}=await reader.read();if(done)break;res.write(Buffer.from(value));}res.end();
    }catch(e){if(!res.headersSent)res.status(e.status||502).json({error:e.message});else{res.write(`data: ${JSON.stringify({error:e.message})}\n\n`);res.end();}}
  });

  async function runAutomation(item, cloudToken) {
    const cfg=getOmniConfig(),db=store.read(),user=db.users.find(u=>u.id===item.userId);if(!user)throw new Error("Contul automatizării nu mai există.");
    const selectedModel=String(item.model||cfg.model||"").trim();
    if(!selectedModel||isSmartAlias(selectedModel))throw policyFailure("Automatizarea nu are un model AI manual valid. Selectează un model permis de Owner.",400);
    await requireModelAccess(cloudToken,selectedModel);
    const isWatch=item.timingMode==="condition_watch";
    const taskPrompt=isWatch
      ? `${item.prompt}\n\nAceasta este o verificare condițională. Dacă nu există o schimbare relevantă sau condiția nu este îndeplinită, răspunde exact: AI_STOICA_NO_NOTIFICATION. Dacă este îndeplinită, răspunde numai cu informația utilă care trebuie notificată.`
      : item.prompt;
    const messages=await prepareMessages([{role:"user",content:taskPrompt}],null,item.userId);
    const r=await fetch(`${String(cfg.baseUrl).replace(/\/+$/,"")}/chat/completions`,{method:"POST",headers:{"Content-Type":"application/json",...(cfg.apiKey?{Authorization:`Bearer ${cfg.apiKey}`}:{})},body:JSON.stringify({model:selectedModel,messages,stream:false,temperature:0.25})});
    if(!r.ok)throw new Error(`OmniRoute HTTP ${r.status}: ${(await r.text()).slice(0,500)}`);
    const data=await r.json(),answer=String(data?.choices?.[0]?.message?.content||"").trim();
    const noNotification=isWatch&&/^AI_STOICA_NO_NOTIFICATION\b/i.test(answer);
    const fresh=store.read(),target=fresh.automations.find(x=>x.id===item.id);if(!target)return;
    target.lastRunAt=Date.now();
    target.lastStatus=noNotification?"checked_no_change":"delivered";
    target.lastResult=noNotification?"Verificat — condiția nu este încă îndeplinită.":answer.slice(0,30000);
    if(target.frequency==="once"){target.enabled=false;target.nextRunAt=null;}else target.nextRunAt=nextRun(target,Date.now()+1000);
    const u=fresh.users.find(x=>x.id===item.userId);
    if(!noNotification&&u?.memoryEnabled!==false)addMemory(fresh,item.userId,`Rezultat automatizare "${item.title}": ${answer.slice(0,1800)}`,"automation",{category:"automatizare"});
    store.write(fresh);
    if(!noNotification&&target.notify!==false&&typeof onAutomationResult==="function"){
      try{onAutomationResult({title:item.title,body:answer.slice(0,500),automationId:item.id,userId:item.userId})}catch{}
    }
  }

  let automationBusy=false;
  const automationTimer=setInterval(async()=>{
    if(automationBusy)return;automationBusy=true;
    try{
      const db=store.read(),now=Date.now(),due=db.automations.filter(a=>a.enabled&&a.nextRunAt&&a.nextRunAt<=now).slice(0,5);
      for(const a of due){try{await runAutomation(a,a.cloudToken);}catch(e){const f=store.read(),t=f.automations.find(x=>x.id===a.id);if(t){t.lastRunAt=Date.now();t.lastResult=`Eroare: ${e.message}`;t.nextRunAt=nextRun(t,Date.now()+60000);store.write(f);}}}
    }finally{automationBusy=false;}
  },30000);

  const server=app.listen(port,host);
  return {server,port,host,close:()=>new Promise(resolve=>{clearInterval(automationTimer);server.close(resolve);})};
}
module.exports={startLocalGateway};
