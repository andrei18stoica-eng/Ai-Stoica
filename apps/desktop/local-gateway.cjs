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
const { createStore, renameWithRetry } = require("./lib/store.cjs");
const { extractText } = require("./lib/extract.cjs");
const { safeGeneratedName, EXPORT_FORMATS, createExportBytes } = require("./lib/documents.cjs");
const { normalizeMemoryText, memoryCategory, durableMemoryCandidate, addMemory, createEmbeddingIndex, tokenize, keywordMatch } = require("./lib/memory.cjs");
const net = require("net");
const { safeRequest, isBlockedAddress } = require("./lib/netguard.cjs");
const { DIRECT_MODEL_DEFAULTS: MODEL_DEFAULTS } = require("./lib/providers.cjs");
const { nextRun, validateAutomation, toBool } = require("./lib/schedule.cjs");
const { QUESTIONS_RULE, sanitizeQuestions } = require("./lib/questions.cjs");
const { DESIGN_KINDS, MAX_VERSIONS: MAX_DESIGN_VERSIONS, designMessages, reviseMessages, extractHtml, htmlTitle, previewToken, verifyPreviewToken } = require("./lib/design.cjs");
function normalizeModelKey(value){return String(value||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/\s+/g," ").trim();}
function isSmartAlias(value){
  const n=normalizeModelKey(value).replace(/[^a-z0-9]+/g," ").trim();
  return n==="ai principal"||n==="ai stoica"||n==="aistoica"||n==="auto"||n==="smart"||n==="smart router";
}
function inferProvider(entry){
  const explicit=normalizeModelKey(entry&&typeof entry==="object"?entry.provider:"");
  if(explicit)return explicit;
  const id=normalizeModelKey(typeof entry==="string"?entry:entry&&entry.id);
  const first=id.split("/")[0];
  const prefix={openai:"openai",anthropic:"anthropic",google:"gemini",gemini:"gemini",cerebras:"cerebras",groq:"groq",cloudflare:"cloudflare",openrouter:"openrouter","@cf":"cloudflare",xai:"xai","x-ai":"xai"};
  if(prefix[first])return prefix[first];
  if(/groq/.test(id))return "groq";
  if(/\bgrok/.test(id))return "xai";
  if(/cerebras/.test(id))return "cerebras";
  if(/cloudflare|@cf\//.test(id))return "cloudflare";
  if(/openrouter/.test(id))return "openrouter";
  if(/claude|anthropic/.test(id))return "anthropic";
  if(/gemini|google/.test(id))return "gemini";
  if(/openai|codex|\bo[134]\b/.test(id)||(!/gpt[-_. ]?oss/.test(id)&&/gpt/.test(id)))return "openai";
  return "";
}

// The company behind a model id, for Settings → "Furnizori folosiți". OmniRoute's subscription prefixes count as their
// maker (cx/ = ChatGPT/Codex, cc/ = Claude Code, gc/ = Gemini CLI …). Combinations have no family and are never hidden.
const FAMILY_PREFIX={openai:"openai",cx:"openai",codex:"openai","chatgpt-web":"openai","cgpt-web":"openai",
  anthropic:"anthropic",claude:"anthropic",cc:"anthropic","claude-code":"anthropic",
  gemini:"gemini",google:"gemini",gc:"gemini","gemini-cli":"gemini",gweb:"gemini","gemini-web":"gemini",
  xai:"xai","x-ai":"xai",grok:"xai",groq:"groq",cerebras:"cerebras",mistral:"mistral",openrouter:"openrouter",nvidia:"nvidia",
  github:"github",cloudflare:"cloudflare","@cf":"cloudflare",cohere:"cohere",huggingface:"huggingface"};
function providerFamily(id){
  const v=normalizeModelKey(id);
  if(!v.includes("/"))return "";
  return FAMILY_PREFIX[v.split("/")[0]]||"";
}
// Cerebras is off unless the Owner turns it back on (its answers were the weakest); an empty value means none is off.
const DEFAULT_BLOCKED_PROVIDERS="cerebras";
function blockedProviders(cfg){
  const raw=cfg?.blockedProviders;
  return new Set(String(raw===undefined||raw===null?DEFAULT_BLOCKED_PROVIDERS:raw).split(",").map(x=>x.trim().toLowerCase()).filter(Boolean));
}
function modelBlocked(cfg,id){const family=providerFamily(id);return !!family&&blockedProviders(cfg).has(family);}

function loadOrCreateSecret(dataDir) {
  const file = path.join(dataDir, "auth-secret.txt");
  try { return fs.readFileSync(file, "utf8").trim(); } catch {}
  fs.mkdirSync(dataDir, { recursive: true });
  const secret = crypto.randomBytes(48).toString("hex");
  fs.writeFileSync(file, secret, { encoding: "utf8", mode: 0o600 });
  return secret;
}

function normalizeEmail(email) { return String(email || "").trim().toLowerCase(); }
function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((x) => x?.type === "text").map((x) => x.text || "").join("\n");
}
// \b only knows ASCII letters, so it fails next to ă, â, î, ș, ț. These boundaries use Unicode letters.
function wordsRegex(words){return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${words.join("|")})(?![\\p{L}\\p{N}_])`,"iu");}
const LIVE_WEB_WORDS=wordsRegex(["azi","acum","actual","actuale","recent","recentă","recente","ultim","ultima","ultimele","latest","news","știri","stiri","internet","online","caută","cauta","verifică","verifica","preț","pret","prețul","pretul","vreme","scor","program","orar","versiune","release","documentație","documentatie","api","model nou","2026"]);
const DEEP_RESEARCH_WORDS=wordsRegex(["deep research","cercetare aprofundată","cercetare aprofundata"]);
const GITHUB_WORDS=wordsRegex(["github","repository","repo","cod","code","bug","eroare","build","component","funcție","functie","endpoint","react","node","python","server","api","fișier","fisier"]);
const SERVER_WORDS=wordsRegex(["server","ssh","hetzner","deploy","deployment","producție","productie","nginx","ubuntu"]);
const PERMISSION_KEYS=["image_generation","video_generation","document_generation","file_upload","web_search","deep_research","automations","plugins","github_access"];
const PERMISSION_LABELS={image_generation:"Generare imagini",video_generation:"Generare video",document_generation:"Fișiere descărcabile",file_upload:"Încărcare fișiere",web_search:"Căutare web",deep_research:"Deep Research",automations:"Automatizări",plugins:"Pluginuri",github_access:"GitHub"};
function deniedMessage(key){return `Funcția „${PERMISSION_LABELS[key]||key}” este dezactivată de Owner pentru contul tău.`;}
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
function escapeRegex(value){return String(value).replace(/[.*+?^${}()|[\]\\]/g,"\\$&");}
// "@git" must not fire inside "@github": the trigger has to be a whole token.
function triggerMatches(text,trigger){
  const t=String(trigger||"").trim();if(!t)return false;
  return new RegExp(`(?<![\\p{L}\\p{N}_@-])${escapeRegex(t)}(?![\\p{L}\\p{N}_-])`,"iu").test(String(text||""));
}
function foldText(value){return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();}
// "Calendar", "meteo", "Google Drive": case- and diacritics-insensitive whole word or phrase; names under 3 letters only work with @.
function nameMentioned(text,name){
  const n=foldText(name).replace(/\s+/g," ").trim();
  if(n.replace(/[^\p{L}\p{N}]/gu,"").length<3)return false;
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegex(n).replace(/ /g,"\\s+")}(?![\\p{L}\\p{N}_])`,"u").test(foldText(text));
}
// Turns technical network/library errors into short Romanian messages for the user.
function roError(e){
  const msg=String(e?.message||e||"");
  if(e?.name==="TimeoutError"||/aborted due to timeout|timed? ?out/i.test(msg))return "Serviciul nu a răspuns la timp.";
  if(e?.name==="AbortError"||/operation was aborted/i.test(msg))return "Cererea a fost anulată.";
  if(/^fetch failed$|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up|other side closed/i.test(msg)||/ECONNREFUSED|ENOTFOUND|ECONNRESET/.test(String(e?.cause?.code||e?.code||"")))return "Serviciul nu poate fi contactat (conexiune eșuată).";
  if(/Invalid URL|Failed to parse URL/i.test(msg))return "Adresa URL nu este validă.";
  if(/Unexpected token|is not valid JSON|JSON at position/i.test(msg))return "Serviciul a returnat un răspuns invalid.";
  return msg||"Eroare necunoscută.";
}

function startLocalGateway({ dataDir, port = 8787, host = "127.0.0.1", serviceName = "AI Stoica Gateway", getOmniConfig: readOmniConfig, onAutomationResult, encryptSecret, decryptSecret, streamIdleMs, streamTotalMs, webDir, updateDir, serverSettings }) {
  // The configuration is read many times per request; one read is reused for 2 seconds.
  let configMemo = null, configMemoAt = 0;
  const getOmniConfig = () => { const now = Date.now(); if (!configMemo || now - configMemoAt > 2000) { configMemo = (typeof readOmniConfig === "function" ? readOmniConfig() : null) || {}; configMemoAt = now; } return configMemo; };
  const store = createStore(dataDir);
  const embeddingIndex = createEmbeddingIndex(dataDir);
  const secret = loadOrCreateSecret(dataDir);
  const filesDir = path.join(dataDir, "library-files");
  fs.mkdirSync(filesDir, { recursive: true });
  const app = express();
  const startCfg = (() => { try { return readOmniConfig?.() || {}; } catch { return {}; } })();
  const loopbackHost = /^(127\.0\.0\.1|localhost|::1)$/i.test(String(host));
  // apps/cloud runs behind Caddy on the Docker network: trustProxy (e.g. 1 or "uniquelocal") lets the login limiter see real client addresses.
  app.set("trust proxy", startCfg.trustProxy ?? "loopback");
  app.set("x-powered-by", false);
  const oauthPending = new Map();
  const timers = [];
  const errorLogFile = path.join(dataDir, "ai-stoica-errors.log");
  let logWindowStart = 0, logCount = 0;
  // At most 30 lines per minute; the log is rotated at 1 MB so it cannot fill the disk.
  function logError(line) {
    const now = Date.now();
    if (now - logWindowStart > 60000) { logWindowStart = now; logCount = 0; }
    if (++logCount > 30) return;
    fs.promises.stat(errorLogFile).then((st) => (st.size > 1024 * 1024 ? fs.promises.rename(errorLogFile, errorLogFile + ".1").catch(() => {}) : null), () => null)
      .then(() => fs.promises.appendFile(errorLogFile, `[${new Date().toISOString()}] ${String(line).replace(/[\r\n]+/g, " ").slice(0, 600)}\n`)).catch(() => {});
  }
  const SECRET_PREFIX = "enc1:";
  function sealSecret(value) {
    const v = String(value || "");
    if (!v || typeof encryptSecret !== "function" || v.startsWith(SECRET_PREFIX)) return v;
    try { const out = encryptSecret(v); return out ? SECRET_PREFIX + String(out) : v; } catch { return v; }
  }
  function openSecret(value) {
    const v = String(value || "");
    if (!v.startsWith(SECRET_PREFIX)) return v;
    if (typeof decryptSecret !== "function") return "";
    try { return String(decryptSecret(v.slice(SECRET_PREFIX.length)) || ""); } catch { return ""; }
  }
  const PLUGIN_SECRETS = ["apiKey", "accessToken", "refreshToken", "oauthClientSecret"];
  function pluginWithSecrets(p) { const out = { ...p }; for (const k of PLUGIN_SECRETS) if (out[k]) out[k] = openSecret(out[k]); return out; }
  if (typeof encryptSecret === "function") {
    try {
      const db = store.read(); let changed = false;
      for (const p of db.plugins) for (const k of PLUGIN_SECRETS) if (p[k] && !String(p[k]).startsWith(SECRET_PREFIX)) { const sealed = sealSecret(p[k]); if (sealed !== p[k]) { p[k] = sealed; changed = true; } }
      for (const a of db.automations) if (a.cloudToken && !String(a.cloudToken).startsWith(SECRET_PREFIX)) { const sealed = sealSecret(a.cloudToken); if (sealed !== a.cloudToken) { a.cloudToken = sealed; changed = true; } }
      if (changed) store.write(db);
    } catch {}
  }
  app.use(helmet({ crossOriginResourcePolicy: false }));
  // Only the AI Stoica window may talk to this local service. Websites open in a browser
  // (and DNS-rebinding tricks that point a domain at 127.0.0.1) are refused.
  const allowedOrigins=new Set(["null","file://","http://localhost:5173","http://127.0.0.1:5173",`http://127.0.0.1:${port}`,`http://localhost:${port}`]);
  const originAllowed=(origin)=>!origin||allowedOrigins.has(String(origin))||/^(file|app):/i.test(String(origin));
  const loopbackOnly=["127.0.0.1","localhost","::1"].includes(String(host));
  // Web version (webDir set, e.g. apps/cloud behind Caddy): the interface is served by this same address,
  // so requests from the service's own origin are allowed too. Without webDir (Windows) nothing changes.
  const sameOrigin=(req)=>{
    if(!webDir||!req.headers.origin)return false;
    try{return new URL(String(req.headers.origin)).host===String(req.headers.host||"").toLowerCase()}catch{return false}
  };
  app.use((req,res,next)=>{
    const hostName=String(req.headers.host||"").toLowerCase().replace(/:\d+$/,"").replace(/^\[|\]$/g,"");
    if(loopbackOnly&&hostName&&!["127.0.0.1","localhost","::1"].includes(hostName))return res.status(403).json({error:"Cerere blocată: adresă necunoscută."});
    if(!originAllowed(req.headers.origin)&&!sameOrigin(req)&&!(req.method==="GET"&&/^\/api\/designs\/[^/]+\/preview$/.test(req.path))){
      logError(`Blocked request from origin ${String(req.headers.origin).slice(0,200)} to ${req.method} ${req.path}`);
      return res.status(403).json({error:"Cerere blocată: provine din afara aplicației AI Stoica."});
    }
    next();
  });
  app.use(cors((req,cb)=>cb(null,{ origin:originAllowed(req.headers.origin)||sameOrigin(req), credentials: false })));
  const jsonParser = express.json({ limit: loopbackHost ? "64mb" : "16mb" });
  const RAW_UPLOADS = new Set(["/api/library/upload", "/api/files"]);
  app.use((req,res,next)=>req.method==="POST"&&RAW_UPLOADS.has(req.path)?next():jsonParser(req,res,next));

  const attempts = new Map();
  // Desktop (loopback): one person uses the PC, so attempts are counted per email and cleared by a correct login.
  // Public server: counted per client address and never cleared by a success (one valid account must not unlock guessing others).
  function attemptKey(req, kind) { return kind + ":" + (loopbackHost ? normalizeEmail(req.body?.email) : (req.ip || req.socket?.remoteAddress || "")); }
  function clearAttempts(req, kind) { if (loopbackHost) attempts.delete(attemptKey(req, kind)); }
  function rateLimited(req, res, kind, limit = 10, windowMs = 15 * 60 * 1000) {
    const now = Date.now();
    if (attempts.size > 5000) for (const [k, v] of attempts) if (v.reset <= now) attempts.delete(k);
    let entry = attempts.get(attemptKey(req, kind));
    if (!entry || entry.reset <= now) { entry = { count: 0, reset: now + windowMs }; attempts.set(attemptKey(req, kind), entry); }
    if (entry.count < limit) return false;
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil((entry.reset - now) / 1000))));
    res.status(429).json({ error: "Prea multe încercări de autentificare. Încearcă din nou peste câteva minute." });
    return true;
  }
  function countAttempt(req, kind) { const entry = attempts.get(attemptKey(req, kind)); if (entry) entry.count++; }

  const toolRunsDir = path.join(dataDir, "tool-runs");
  fs.mkdirSync(toolRunsDir, { recursive: true });

  function ownerOnly(message){return (req,res,next)=>ownerRequest(req)?next():res.status(403).json({error:message});}
  const ownerOnlyLocal=ownerOnly("Rularea de cod și accesul la server sunt rezervate Owner-ului.");
  const ownerOnlyGithub=ownerOnly("GitHub Solve, aplicarea și anularea modificărilor în GitHub sunt rezervate Owner-ului.");

  function safeCodePoint(n){return Number.isInteger(n)&&n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):"�";}
  function decodeHtml(value){
    return String(value||"")
      .replace(/<script[\s\S]*?<\/script>/gi," ")
      .replace(/<style[\s\S]*?<\/style>/gi," ")
      .replace(/<[^>]+>/g," ")
      .replace(/&nbsp;/gi," ")
      .replace(/&quot;/gi,'"')
      .replace(/&#39;|&apos;/gi,"'")
      .replace(/&lt;/gi,"<")
      .replace(/&gt;/gi,">")
      .replace(/&#(\d+);/g,(_m,n)=>safeCodePoint(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi,(_m,n)=>safeCodePoint(parseInt(n,16)))
      .replace(/&amp;/gi,"&")
      .replace(/\s+/g," ").trim();
  }
  // Cheap syntax check before any network work; private and local addresses are refused again
  // when connecting (after DNS resolution and on every redirect) by safeRequest.
  function publicWebUrl(raw){
    try{
      let value=String(raw||"").trim();
      if(value.startsWith("//"))value="https:"+value;
      const u=new URL(value);
      if(/duckduckgo\.com$/i.test(u.hostname)&&u.pathname.startsWith("/l/")&&u.searchParams.get("uddg"))return publicWebUrl(decodeURIComponent(u.searchParams.get("uddg")));
      if(!["http:","https:"].includes(u.protocol)||u.username||u.password)return "";
      const h=u.hostname.toLowerCase().replace(/^\[|\]$/g,"").replace(/\.$/,"");
      if(!h||h==="localhost"||h.endsWith(".localhost")||h.endsWith(".local")||h.endsWith(".internal")||(!h.includes(".")&&!h.includes(":")))return "";
      if(net.isIP(h)&&isBlockedAddress(h))return "";
      return u.toString();
    }catch{return ""}
  }
  async function pageExcerpt(url,maxChars=2600,signal){
    const safe=publicWebUrl(url);if(!safe)return "";
    try{
      const r=await safeRequest(safe,{headers:{"Accept":"text/html,text/plain;q=0.9,*/*;q=0.5"},timeout:9000,maxBytes:1024*1024,truncate:true,signal});
      if(!r.ok)return "";
      const ctype=String(r.headers.get("content-type")||"");
      if(!/text\/|json|xml|html/i.test(ctype))return "";
      return decodeHtml(await r.text()).slice(0,maxChars);
    }catch{return ""}
  }
  const ROMANIAN_HINT=wordsRegex(["și","sau","este","sunt","care","pentru","despre","cum","ce","unde","când","cand","azi","vreme","preț","pret","știri","stiri","românia","romania","bucurești","bucuresti"]);
  async function liveWebSearch(query,maxResults=5,signal){
    const q=String(query||"").trim().slice(0,700);if(!q)return [];
    const limit=Math.max(1,Math.min(8,Number(maxResults)||5));
    const results=[];
    try{
      const r=await safeRequest("https://html.duckduckgo.com/html/?q="+encodeURIComponent(q),{headers:{"User-Agent":"Mozilla/5.0 AI-Stoica/0.7","Accept":"text/html"},timeout:12000,maxBytes:2*1024*1024,truncate:true,signal});
      if(r.status===200){
        const html=await r.text();
        const re=/<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
        let m;const seen=new Set();
        while((m=re.exec(html))&&results.length<limit){
          const url=publicWebUrl(m[1]);if(!url||seen.has(url))continue;seen.add(url);
          results.push({title:decodeHtml(m[2])||new URL(url).hostname,url});
        }
      }
    }catch{}
    if(!results.length){
      const langs=/[ăâîșțşţ]/i.test(q)||ROMANIAN_HINT.test(q)?["ro","en"]:["en"];
      for(const lang of langs){
        try{
          const r=await safeRequest(`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&utf8=1&srlimit=${Math.min(5,limit)}&srsearch=${encodeURIComponent(q)}`,{timeout:9000,maxBytes:1024*1024,signal});
          if(!r.ok)continue;
          const data=await r.json();
          for(const x of data?.query?.search||[])results.push({title:String(x.title||"Wikipedia"),url:`https://${lang}.wikipedia.org/wiki/`+encodeURIComponent(String(x.title||"").replace(/ /g,"_")),snippet:decodeHtml(x.snippet||"")});
          if(results.length)break;
        }catch{}
      }
    }
    return await Promise.all(results.slice(0,limit).map(async x=>({...x,excerpt:x.snippet||await pageExcerpt(x.url,2600,signal)})));
  }
  function urlsFromText(text){
    const matches=String(text||"").match(/https?:\/\/[^\s<>"']+/gi)||[];
    return [...new Set(matches.map(x=>x.replace(/[),.;]+$/,"")).filter(publicWebUrl))].slice(0,3);
  }
  function shouldUseLiveWeb(text){return LIVE_WEB_WORDS.test(String(text||""));}
  // Library documents are split into 1500-character pieces normalized once (cached per file version),
  // and the pieces that match the question are sent, not just the beginning of each document.
  const libraryChunkCache=new Map();
  function libraryChunks(item){
    const body=String(item.text||item.transcript||item.prompt||"");
    const key=(item.textIndexedAt||item.createdAt||0)+":"+body.length;
    const hit=libraryChunkCache.get(item.id);
    if(hit&&hit.key===key)return hit;
    const chunks=[];
    for(let i=0;i<body.length;i+=1500){const text=body.slice(i,i+1500);chunks.push({text,norm:normalizeMemoryText(text)});}
    const entry={key,chunks,nameNorm:normalizeMemoryText(item.name||"")};
    libraryChunkCache.set(item.id,entry);
    if(libraryChunkCache.size>2000)libraryChunkCache.delete(libraryChunkCache.keys().next().value);
    return entry;
  }
  function libraryContext(db,userId,query){
    const words=[...new Set(normalizeMemoryText(query).split(/[^a-z0-9]+/).filter(x=>x.length>=4))].slice(0,35);
    if(!words.length)return "";
    const scoreText=(hay)=>words.reduce((n,w)=>n+(hay.includes(w)?1:(hay.includes(w.slice(0,Math.max(4,w.length-3)))?0.5:0)),0);
    const rows=db.library.filter(x=>x.userId===userId).map(item=>{
      const entry=libraryChunks(item);if(!entry.chunks.length)return null;
      const scored=entry.chunks.map((c,i)=>({i,score:scoreText(c.norm)}));
      const total=scoreText(entry.nameNorm)+Math.max(0,...scored.map(x=>x.score));
      return {item,entry,scored,total};
    }).filter(x=>x&&x.total>0).sort((a,b)=>b.total-a.total||(b.item.createdAt||0)-(a.item.createdAt||0)).slice(0,5);
    let out="";
    for(const row of rows){
      const best=row.scored.filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,3).sort((a,b)=>a.i-b.i);
      const excerpt=(best.length?best:[{i:0}]).map(p=>row.entry.chunks[p.i].text).join("\n[…]\n").slice(0,5000);
      const block="Fișier bibliotecă: "+(row.item.name||row.item.id)+"\n"+excerpt+"\n\n";
      if(out.length+block.length>18000)break;out+=block;
    }
    return out.trim();
  }
  function projectContext(db,userId,projectId,latestText){
    if(!projectId)return "";
    const words=[...new Set(normalizeMemoryText(latestText).split(/[^a-z0-9]+/).filter(x=>x.length>=4))].slice(0,30);
    const rows=db.conversations.filter(x=>x.userId===userId&&x.projectId===projectId).map(conv=>{
      const sample=(Array.isArray(conv.messages)?conv.messages:[]).slice(-8).map(m=>textFromContent(m?.content)).join(" ");
      const hay=normalizeMemoryText((conv.title||"")+" "+sample);
      const score=words.reduce((n,w)=>n+(hay.includes(w)?1:0),0);
      return {conv,score};
    }).sort((a,b)=>b.score-a.score||(b.conv.updatedAt||0)-(a.conv.updatedAt||0)).slice(0,6);
    let out="";
    for(const row of rows){
      const conv=row.conv;
      const msgs=(Array.isArray(conv.messages)?conv.messages:[]).slice(-4).map(m=>(m?.role==="assistant"?"AI Stoica":"Utilizator")+": "+textFromContent(m?.content).slice(0,1800)).join("\n");
      const block="Conversație proiect: "+(conv.title||"fără titlu")+"\n"+msgs+"\n\n";
      if(out.length+block.length>18000)break;
      out+=block;
    }
    return out.trim();
  }
  // C3: the user's other conversations (archived included) that talk about the same thing as the latest message.
  const PAST_CHATS_HEADER="DIN CONVERSAȚIILE ANTERIOARE ALE UTILIZATORULUI — folosește doar dacă are legătură cu întrebarea; poți spune din ce conversație vine:";
  const PAST_STOP=new Set(["cum","fac","face","faci","facem","fel","ceva","asta","acum","sau","din","dar","mai","cat","cate","unei","unui","esti","avem","daca","pot","stii","stiu","buna","salut","multumesc","rog","for","with","how","can","about"]);
  const roShortDate=new Intl.DateTimeFormat("ro-RO",{day:"numeric",month:"short",year:"numeric"});
  function chatMessageText(m){
    const text=m?.role==="user"&&typeof m.displayText==="string"&&m.displayText.trim()?m.displayText:(typedText(m?.content)||textFromContent(m?.content));
    return String(text||"").replace(/\s+/g," ").trim();
  }
  function clipText(value,max){return value.length>max?value.slice(0,max-1)+"…":value;}
  function pastChatsContext(db,userId,query,currentId){
    const raw=String(query||"").replace(/\s+/g," ").trim();
    if(raw.length<8)return "";
    const words=tokenize(raw).filter(w=>!PAST_STOP.has(w)).slice(0,30);
    if(!words.length)return "";
    const need=words.length>=3?2:words.length,now=Date.now(),asked=normalizeMemoryText(raw);
    const convs=db.conversations.filter(c=>c.userId===userId&&c.id!==currentId&&!c.deleted&&!c.deletedAt&&Array.isArray(c.messages)&&c.messages.length)
      .sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)).slice(0,300);
    const found=[];
    for(const c of convs){
      const msgs=c.messages.slice(-160);
      if(!currentId&&now-(c.updatedAt||0)<15*60*1000){
        const last=[...msgs].reverse().find(m=>m?.role==="user");
        if(last&&normalizeMemoryText(chatMessageText(last))===asked)continue;
      }
      const hits=[];
      msgs.forEach((m,i)=>{
        if(m?.role!=="user")return;
        const text=chatMessageText(m);
        if(text.length<8||!tokenize(text).length)return;
        const {score,matched}=keywordMatch(text.slice(0,3000),words);
        if(matched>=need)hits.push({i,score,text});
      });
      if(hits.length)found.push({c,msgs,hits:hits.sort((a,b)=>b.score-a.score).slice(0,2)});
    }
    const lines=[];let size=PAST_CHATS_HEADER.length;
    for(const {c,msgs,hits} of found.sort((a,b)=>b.hits[0].score-a.hits[0].score||(b.c.updatedAt||0)-(a.c.updatedAt||0)).slice(0,3)){
      const title=clipText(String(c.title||"Conversație").replace(/\s+/g," ").trim(),80);
      for(const hit of hits.sort((a,b)=>a.i-b.i)){
        let answer="";
        for(let k=hit.i+1;k<msgs.length&&msgs[k]?.role!=="user";k++)if(msgs[k]?.role==="assistant"){answer=chatMessageText(msgs[k]);break;}
        const t=Number(msgs[hit.i]?.createdAt||c.updatedAt||c.createdAt),at=t>0&&t<8.64e15?t:now;
        const line=`[«${title}» · ${roShortDate.format(at)}] Utilizator: ${clipText(hit.text,600)}${answer?` / AI Stoica: ${clipText(answer,600)}`:""}`;
        if(size+1+line.length>3500)continue;
        lines.push(line);size+=1+line.length;
      }
    }
    return lines.length?PAST_CHATS_HEADER+"\n"+lines.join("\n"):"";
  }
  function githubSearchWords(text){
    const stop=new Set(["acest","aceasta","pentru","vreau","care","este","sunt","face","faci","facem","codul","fisier","fișier","problema","eroare","github","repo","repository","with","from","that","this","function","const"]);
    return [...new Set(String(text||"").match(/[A-Za-z0-9_.-]{4,}/g)||[])].filter(x=>!stop.has(x.toLowerCase())).sort((a,b)=>b.length-a.length).slice(0,3);
  }
  function shouldUseGithub(text){return GITHUB_WORDS.test(String(text||""));}
  async function githubCodeContext(cfg,text){
    const repo=String(cfg.githubRepo||"").trim(),token=String(cfg.githubToken||"").trim();
    if(!repo||!token||!shouldUseGithub(text))return "";
    const headers={Authorization:"Bearer "+token,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","User-Agent":"AI-Stoica"};
    const words=githubSearchWords(text);if(!words.length)return "";
    const found=new Map();
    for(const word of words){
      try{
        const r=await fetch("https://api.github.com/search/code?q="+encodeURIComponent(word+" repo:"+repo),{headers,signal:AbortSignal.timeout(10000)});
        if(!r.ok){try{await r.body?.cancel()}catch{}continue;}
        const data=await r.json();
        for(const item of data.items||[])if(item?.path&&!found.has(item.path))found.set(item.path,item);
      }catch{}
      if(found.size>=5)break;
    }
    let out="";
    for(const item of [...found.values()].slice(0,4)){
      try{
        if(!/^https:\/\/api\.github\.com\//i.test(String(item.url||"")))continue;
        const r=await fetch(item.url,{headers,signal:AbortSignal.timeout(10000)});if(!r.ok){try{await r.body?.cancel()}catch{}continue}
        const data=await r.json();let source="";
        if(data?.content&&data?.encoding==="base64")source=Buffer.from(String(data.content).replace(/\n/g,""),"base64").toString("utf8");
        if(!source&&data?.download_url)source=await pageExcerpt(data.download_url,9000);
        const block="GitHub "+repo+"/"+item.path+"\n"+source.slice(0,9000)+"\n\n";
        if(out.length+block.length>26000)break;out+=block;
      }catch{}
    }
    return out.trim();
  }
  const GITHUB_SOLVE_MAX_CHARS=120000;
  async function githubReadFile(cfg,filePath,branch){
    const repo=String(cfg.githubRepo||"").trim(),token=String(cfg.githubToken||"").trim();
    if(!repo)throw policyFailure("Configurează GitHub repository în Setări.",400);
    if(!token)throw policyFailure("Configurează GitHub token în Setări pentru repository-ul privat.",400);
    const headers={Authorization:"Bearer "+token,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","User-Agent":"AI-Stoica"};
    const ref=String(branch||cfg.githubBranch||"main").trim()||"main";
    const encodedPath=String(filePath||"").split("/").map(encodeURIComponent).join("/");
    const url="https://api.github.com/repos/"+repo+"/contents/"+encodedPath+"?ref="+encodeURIComponent(ref);
    const r=await fetch(url,{headers,signal:AbortSignal.timeout(12000)});
    const text=await r.text();let data={};try{data=JSON.parse(text)}catch{}
    if(!r.ok)throw policyFailure("GitHub HTTP "+r.status+": "+String(data?.message||text).slice(0,500),r.status===404?404:r.status===401||r.status===403?403:502);
    if(data.type!=="file")throw policyFailure("Calea GitHub nu indică un fișier.",400);
    if(!data.content||data.encoding!=="base64")throw policyFailure("Fișierul GitHub este prea mare (peste 1 MB) pentru GitHub Solve.",413);
    return {repo,branch:ref,path:data.path||filePath,sha:data.sha,content:Buffer.from(String(data.content).replace(/\n/g,""),"base64").toString("utf8")};
  }
  async function githubWriteFile(cfg,args){
    const repo=String(cfg.githubRepo||"").trim(),token=String(cfg.githubToken||"").trim();
    if(!repo||!token)throw policyFailure("GitHub repository/token nu sunt configurate.",400);
    const headers={Authorization:"Bearer "+token,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","User-Agent":"AI-Stoica","Content-Type":"application/json"};
    const ref=String(args.branch||cfg.githubBranch||"main").trim()||"main";
    const encodedPath=String(args.filePath||"").split("/").map(encodeURIComponent).join("/");
    const url="https://api.github.com/repos/"+repo+"/contents/"+encodedPath;
    const body={message:String(args.message||("AI Stoica: update "+args.filePath)).slice(0,500),content:Buffer.from(String(args.content||""),"utf8").toString("base64"),branch:ref};
    if(args.sha)body.sha=args.sha;
    const r=await fetch(url,{method:"PUT",headers,body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
    const text=await r.text();let data={};try{data=JSON.parse(text)}catch{}
    if(!r.ok)throw policyFailure("GitHub HTTP "+r.status+": "+String(data?.message||text).slice(0,700),r.status===409?409:r.status===404?404:502);
    return data;
  }
  const githubBackupsDir=path.join(dataDir,"github-backups");
  function saveGithubBackup(file){
    fs.mkdirSync(githubBackupsDir,{recursive:true});
    const id=crypto.randomUUID();
    fs.writeFileSync(path.join(githubBackupsDir,id+".json"),JSON.stringify({id,repo:file.repo,path:file.path,branch:file.branch,sha:file.sha,content:file.content,createdAt:Date.now()},null,2),"utf8");
    try{
      const all=fs.readdirSync(githubBackupsDir).filter(f=>/^[0-9a-f-]{36}\.json$/i.test(f)).map(f=>({f,t:fs.statSync(path.join(githubBackupsDir,f)).mtimeMs})).sort((a,b)=>b.t-a.t);
      for(const old of all.slice(20))fs.rmSync(path.join(githubBackupsDir,old.f),{force:true});
    }catch{}
    return id;
  }
  async function generateGithubProposal(req,file,instruction){
    const cfg=getOmniConfig();
    const model=String(req.body?.model||cfg.model||"").trim();
    if(!model||isSmartAlias(model))throw policyFailure("Alege un model AI înainte de GitHub Solve.",400);
    if(file.content.length>GITHUB_SOLVE_MAX_CHARS)throw policyFailure("Fișierul are peste 120.000 de caractere. GitHub Solve lucrează doar cu fișiere complete mai mici, ca să nu taie conținutul la aplicare.",413);
    await requireModelAccess(req.cloudToken,model);
    const messages=[
      {role:"system",content:"Ești motorul GitHub Solve din AI Stoica. Primești un singur fișier și o instrucțiune. Returnează EXCLUSIV conținutul complet al fișierului corectat, fără markdown fences, fără explicații și fără omisiuni."},
      {role:"user",content:"Fișier: "+file.path+"\nInstrucțiune: "+String(instruction||"Analizează și corectează problema.").slice(0,4000)+"\n\nCONȚINUT ACTUAL:\n"+file.content}
    ];
    const r=await fetchChatCandidate(cfg,model,messages,false);
    const text=await r.text();let data={};try{data=JSON.parse(text)}catch{}
    if(!r.ok)throw policyFailure("Model AI HTTP "+r.status+": "+text.slice(0,500),502);
    let proposal=String(data?.choices?.[0]?.message?.content||"").trim();
    proposal=proposal.replace(/^```[a-z0-9_+.-]*\s*/i,"").replace(/\s*```$/,"");
    if(!proposal)throw policyFailure("Modelul nu a returnat o propunere de cod.",502);
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
      for(const pair of commands){try{const r=await spawnCapture(pair[0],pair[1],{cwd:runDir,timeout:12000});return {supported:true,ok:r.code===0&&!r.timedOut,...r,language:"python"}}catch(e){if(e.code!=="ENOENT")throw e}}
      return {supported:false,ok:true,code:null,stdout:"",stderr:"Python nu este instalat; verificarea sintaxei a fost omisă.",language:"python"};
    }finally{try{fs.rmSync(runDir,{recursive:true,force:true})}catch{}}
  }
  // Stops the program and everything it started (Windows: taskkill /T, others: the process group).
  function killTree(child){
    if(!child?.pid)return;
    if(process.platform==="win32"){try{spawn("taskkill",["/pid",String(child.pid),"/T","/F"],{windowsHide:true,stdio:"ignore"}).on("error",()=>{})}catch{}}
    else{try{process.kill(-child.pid,"SIGKILL")}catch{try{child.kill("SIGKILL")}catch{}}}
  }
  function spawnCapture(command,args,{cwd,timeout=15000,env={}}={}){
    return new Promise((resolve,reject)=>{
      let stdout="",stderr="",timedOut=false,settled=false,timer=null,grace=null,child;
      const finish=(fn)=>{if(settled)return;settled=true;clearTimeout(timer);clearTimeout(grace);try{child?.stdout?.destroy();child?.stderr?.destroy()}catch{}fn()};
      try{child=spawn(command,args,{cwd,windowsHide:true,shell:false,detached:process.platform!=="win32",env:{...process.env,...env}})}catch(e){return reject(e)}
      const cap=(value)=>String(value||"").slice(0,120000);
      child.stdout?.on("data",d=>{stdout=cap(stdout+d.toString())});
      child.stderr?.on("data",d=>{stderr=cap(stderr+d.toString())});
      child.once("error",e=>finish(()=>reject(e)));
      timer=setTimeout(()=>{timedOut=true;killTree(child);clearTimeout(grace);grace=setTimeout(()=>finish(()=>resolve({code:-1,stdout,stderr,timedOut})),2000)},timeout);
      child.once("close",code=>finish(()=>resolve({code:Number(code??-1),stdout,stderr,timedOut})));
      // A background process started by the code can keep the output pipes open after the program ends.
      child.once("exit",code=>{if(timedOut)return;clearTimeout(grace);grace=setTimeout(()=>{killTree(child);finish(()=>resolve({code:Number(code??-1),stdout,stderr,timedOut}))},1500)});
    });
  }
  async function executeCode(language,code){
    const lang=String(language||"").toLowerCase(),source=String(code||"");
    if(!source.trim())throw policyFailure("Codul este gol.",400);
    if(source.length>100000)throw policyFailure("Codul este prea mare pentru o rulare interactivă.",413);
    const runDir=path.join(toolRunsDir,crypto.randomUUID());fs.mkdirSync(runDir,{recursive:true});
    try{
      if(["js","javascript","node"].includes(lang)){
        const file=path.join(runDir,"main.js");fs.writeFileSync(file,source,"utf8");
        return {...await spawnCapture(process.execPath,[file],{cwd:runDir,timeout:20000,env:{ELECTRON_RUN_AS_NODE:"1"}}),language:"javascript"};
      }
      if(["py","python","python3"].includes(lang)){
        const file=path.join(runDir,"main.py");fs.writeFileSync(file,source,"utf8");
        const commands=process.platform==="win32"?[["py",["-3",file]],["python",[file]]]:[["python3",[file]],["python",[file]]];
        for(const pair of commands){try{return {...await spawnCapture(pair[0],pair[1],{cwd:runDir,timeout:20000}),language:"python"}}catch(e){if(e.code!=="ENOENT")throw e}}
        throw policyFailure("Python nu este instalat pe acest calculator.",503);
      }
      throw policyFailure("AI Stoica poate rula direct JavaScript/Node și Python.",400);
    }finally{try{fs.rmSync(runDir,{recursive:true,force:true})}catch{}}
  }
  async function sshRun(cfg,command,timeout=30000){
    const host=String(cfg.serverHost||"").trim(),user=String(cfg.serverUser||"root").trim()||"root";
    if(!host)throw policyFailure("Serverul SSH nu este configurat în Setări.",400);
    if(host.startsWith("-")||user.startsWith("-")||/[\s@]/.test(host)||/[\s@]/.test(user))throw policyFailure("Adresa sau utilizatorul serverului SSH nu sunt valide.",400);
    const args=["-o","BatchMode=yes","-o","StrictHostKeyChecking=accept-new","-o","ConnectTimeout=8","-p",String(Math.max(1,Math.min(65535,Number(cfg.serverPort||22)||22)))];
    const key=String(cfg.serverKeyPath||"").trim();if(key)args.push("-i",key);
    args.push(user+"@"+host,String(command||"echo AI_STOICA_SERVER_OK"));
    try{return await spawnCapture("ssh",args,{timeout})}catch(e){if(e.code==="ENOENT")throw policyFailure("Clientul SSH nu este instalat pe acest calculator.",503);throw e}
  }

  // Local sessions last 30 days and are renewed every time the app opens (see /auth/me).
  const SESSION_DAYS=30;
  function sign(user,sid){return jwt.sign({sub:user.id,email:user.email,sid:sid||crypto.randomUUID()},secret,{expiresIn:`${SESSION_DAYS}d`});}
  function tokenHash(token){return crypto.createHash("sha256").update(String(token||"")).digest("hex");}
  // Logged-out local sessions are remembered (on disk) until they would have expired anyway.
  const revokedFile=path.join(dataDir,"revoked-sessions.json");
  const revoked=(()=>{try{const raw=JSON.parse(fs.readFileSync(revokedFile,"utf8"));return raw&&typeof raw==="object"&&!Array.isArray(raw)?raw:{}}catch{return {}}})();
  function saveRevoked(){
    const now=Date.now();for(const [k,exp] of Object.entries(revoked))if(!(exp>now))delete revoked[k];
    try{fs.writeFileSync(revokedFile+".tmp",JSON.stringify(revoked),"utf8");renameWithRetry(revokedFile+".tmp",revokedFile)}catch{}
  }
  function revokeLocalToken(token){
    try{
      const p=jwt.verify(token,secret);
      revoked[p.sid?"sid:"+p.sid:"tok:"+tokenHash(token)]=p.exp?p.exp*1000:Date.now()+SESSION_DAYS*86400000;
      saveRevoked();return true;
    }catch{return false}
  }
  function isRevoked(payload,token){
    const now=Date.now(),a=payload.sid?revoked["sid:"+payload.sid]:0,b=revoked["tok:"+tokenHash(token)];
    return (a&&a>now)||(b&&b>now);
  }
  function cloudBase() {
    const cfg = getOmniConfig() || {};
    return String(cfg.controlApiUrl || "").trim().replace(/\/+$/,"");
  }
  // The whole answer (headers and body) must arrive within the timeout; the body is buffered here.
  async function cloudFetch(pathname, init = {}) {
    const base = cloudBase();
    if (!base) throw new Error("AI Stoica Cloud nu este configurat.");
    const signal = AbortSignal.timeout(Number(init.timeout || 9000));
    const r = await fetch(base + pathname, {
      method: init.method || "GET",
      headers: { ...(init.body !== undefined ? { "Content-Type":"application/json" } : {}), ...(init.headers || {}) },
      body: init.body === undefined ? undefined : (typeof init.body === "string" ? init.body : JSON.stringify(init.body)),
      signal
    });
    const buf = Buffer.from(await r.arrayBuffer());
    const headers = new Headers(r.headers); headers.delete("content-encoding"); headers.delete("content-length");
    return new Response(buf.length && ![204, 205, 304].includes(r.status) ? buf : null, { status: r.status, headers });
  }
  function policyFailure(message, status = 503) {
    const error = new Error(message);
    error.status = status;
    return error;
  }
  function cloudDownMessage(status){return `AI Stoica Cloud nu răspunde momentan${status?` (HTTP ${status})`:""}. Încearcă din nou peste câteva secunde.`;}
  async function cloudModelPolicy(token, models) {
    const unique=[...new Set((models||[]).map(x=>String(x||"").trim()).filter(Boolean))];
    if (!cloudBase()) return { policyEnforced:false, data:unique.map(model=>({model,allowed:true})) };
    if (!token) throw policyFailure("Nu pot verifica permisiunile AI. Reautentifică-te prin AI Stoica Cloud.",503);
    const chunks=[];for(let i=0;i<unique.length;i+=150)chunks.push(unique.slice(i,i+150));
    const all=[];let paidAiEnabled=null;
    for(const chunk of chunks){
      let remote;
      try {
        remote=await cloudFetch("/api/ai/access",{method:"POST",headers:{Authorization:`Bearer ${token}`},body:{models:chunk},timeout:9000});
      } catch(e) {
        throw policyFailure(`AI Stoica Cloud nu poate verifica permisiunile AI: ${roError(e)}`,503);
      }
      const text=await remote.text();let data={};try{data=JSON.parse(text||"{}")}catch{}
      if(remote.status>=500)throw policyFailure(cloudDownMessage(remote.status),503);
      if(!remote.ok)throw policyFailure(typeof data?.error==="string"&&data.error?data.error:"Verificarea permisiunilor AI a eșuat.",remote.status||503);
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
  // OmniRoute 3.8 refuses /v1/* without a client key (Docker: REQUIRE_API_KEY=true; /v1/models once the dashboard has a password).
  const OMNI_KEY_HINT="OmniRoute cere cheia API: creează una în OmniRoute → API Manager (http://127.0.0.1:20128/dashboard/api-manager) și pune-o în Setări → AI & OmniRoute → Cheie API OmniRoute (pe server: OMNIROUTE_API_KEY în .env).";
  function omniHttpError(status,text){
    if(status===401||status===403)return (cfg=>cfg.apiKey?"OmniRoute a refuzat cheia API (HTTP "+status+"): cheia e greșită, expirată sau revocată. ":"")(getOmniConfig())+OMNI_KEY_HINT;
    return `OmniRoute HTTP ${status}: ${String(text||"").slice(0,300)}`;
  }
  // The reason an OpenAI-compatible service gives (OmniRoute lists which provider of a combination failed and why).
  function upstreamErrorText(body){
    try{const j=JSON.parse(body);const e=j?.error;return String((typeof e==="string"?e:e?.message)||j?.message||body).slice(0,400)}catch{return String(body||"").slice(0,300)}
  }
  let omniEntriesLast=[];
  async function omniModelEntries(cfg) {
    const r=await fetch(`${String(cfg.baseUrl).replace(/\/+$/, "")}/models`,{
      headers:cfg.apiKey?{Authorization:`Bearer ${cfg.apiKey}`}:{},
      signal:AbortSignal.timeout(20000)
    });
    const text=await r.text();
    if(!r.ok)throw policyFailure(omniHttpError(r.status,text),502);
    let parsed;try{parsed=JSON.parse(text)}catch{throw policyFailure("OmniRoute a returnat o listă de modele invalidă.",502)}
    const list=Array.isArray(parsed)?parsed:(Array.isArray(parsed?.data)?parsed.data:[]);
    if(list.length)omniEntriesLast=list;
    return list;
  }
  async function allowedOmniEntries(context, entries) {
    const rows=(Array.isArray(entries)?entries:[]).map(entry=>{
      const id=String(typeof entry==="string"?entry:entry?.id||"").trim();
      const provider=String(typeof entry==="string"?"":entry?.provider||"").trim().toLowerCase();
      const first=id.toLowerCase().split("/")[0];
      const alreadyScoped=["openai","anthropic","google","gemini","cerebras","groq","cloudflare","openrouter","@cf","xai"].includes(first);
      const policyId=provider&&!alreadyScoped?`${provider}/${id}`:id;
      return {entry,id,policyId};
    }).filter(x=>x.id);
    if(!rows.length)return [];
    if(!cloudBase())return rows.map(x=>x.entry);
    const policy=await cloudModelPolicy(context?.cloudToken,rows.map(x=>x.policyId));
    const allowed=new Set(policy.data.filter(x=>x.allowed).map(x=>String(x.model)));
    return rows.filter(x=>allowed.has(x.policyId)).map(x=>x.entry);
  }
  let omniEntriesCache={at:0,entries:[]};
  async function omniEntriesCached(cfg){
    if(Date.now()-omniEntriesCache.at<60000)return omniEntriesCache.entries;
    let entries=[];try{entries=await omniModelEntries(cfg)}catch{}
    omniEntriesCache={at:Date.now(),entries};return entries;
  }
  async function omniModelIds(cfg){
    return (await omniEntriesCached(cfg)).map(x=>String(typeof x==="string"?x:x?.id||"")).filter(Boolean);
  }
  // A request without a model (a client that left the choice to AI Stoica) goes to your own OmniRoute combination
  // ("Ai principal"), then to OmniRoute's auto/* ones; the direct APIs only when OmniRoute has none.
  async function defaultOmniModel(cfg,context){
    const entries=await omniEntriesCached(cfg);
    const combos=entries.map(x=>({id:String(typeof x==="string"?x:x?.id||"").trim(),combo:x?.owned_by==="combo"})).filter(x=>x.id&&(x.combo||!x.id.includes("/")));
    for(const id of [...combos.filter(x=>!/^auto\//i.test(x.id)),...combos.filter(x=>/^auto\//i.test(x.id))].map(x=>x.id)){
      try{await requireModelAccess(context?.cloudToken,id);return id}catch{}
    }
    return "";
  }
  // "Ai principal" / "AI Stoica …" (mobile default): an OmniRoute combo with that name if one exists, otherwise the configured default model.
  async function resolveModelAlias(cfg,requested){
    const value=String(requested||"").trim();
    if(!value||!(isSmartAlias(value)||/^ai stoica\b/.test(normalizeModelKey(value))))return value;
    const combo=(await omniModelIds(cfg)).find(id=>normalizeModelKey(id)===normalizeModelKey(value));
    if(combo)return combo;
    const fallback=[cfg.defaultModel,cfg.model].map(x=>String(x||"").trim()).find(x=>x&&!isSmartAlias(x));
    return fallback||"";
  }
  // A model from the direct APIs list (groq/…, cerebras/…, as /api/models offers it) that OmniRoute does not have:
  // that API answers it.
  const DIRECT_PROVIDERS=["cerebras","groq","gemini","mistral","nvidia","github","openrouter","cloudflare","cohere","huggingface","openai","xai"];
  async function isDirectModel(cfg,allowed,id){
    const v=String(id||"").trim(),provider=(v.split("/")[0]||"").toLowerCase();
    if(!allowed||cfg.directChatEnabled===false||!v.includes("/")||!DIRECT_PROVIDERS.includes(provider))return false;
    if((await omniModelIds(cfg)).some(x=>x.toLowerCase()===v.toLowerCase()))return false;
    try{return (await directChatCandidates(cfg,v)).some(c=>c.provider===provider)}catch{return false}
  }
  // chosen=false: the client sent no model (or the mobile "AI Stoica …" name), so AI Stoica picks and may fall back.
  async function resolveChatRoute(context, messages, requestedModel, {chosen=true}={}) {
    const cfg=getOmniConfig();
    const asked=String(requestedModel||cfg.model||"").trim();
    const requested=await resolveModelAlias(cfg,asked);
    if(!requested){
      const auto=await defaultOmniModel(cfg,context);
      if(auto)return {task:"auto",automatic:true,reasons:["niciun model ales: folosesc combinația principală OmniRoute"],selectedModel:auto,candidates:[{id:auto,provider:inferProvider(auto),score:0}]};
      if(directApisAllowed(context)&&cfg.directChatEnabled!==false)return {task:"direct-fallback",automatic:true,reasons:["OmniRoute fără model selectat; folosesc API-urile directe configurate"],selectedModel:"",candidates:[]};
      throw policyFailure("Alege manual un model AI înainte de a trimite mesajul.",400);
    }
    await requireModelAccess(context?.cloudToken,requested);
    requirePersonalAccess(context,requested);
    if(modelBlocked(cfg,requested))throw policyFailure(`Furnizorul modelului «${requested}» este oprit în Setări → API-uri AI → Furnizori folosiți. Alege alt model din listă.`,403);
    const automatic=chosen===false||!String(requestedModel||"").trim()||requested!==asked;
    if(await isDirectModel(cfg,directApisAllowed(context),requested))return {task:"direct",automatic,direct:true,reasons:["model API direct ales"],selectedModel:requested,candidates:[]};
    return {task:"manual",automatic,reasons:[automatic?"model implicit configurat":"model ales manual"],selectedModel:requested,candidates:[{id:requested,provider:inferProvider(requested),score:0}]};
  }
  const BUILTIN_PROMPT="Ești AI Stoica, asistentul principal Stoica Enterprises AI. Răspunde clar, riguros și util, în limba utilizatorului.";
  function builtInAssistant(userId){return {id:crypto.randomUUID(),userId,name:"AI Stoica",icon:"S",systemPrompt:BUILTIN_PROMPT,createdAt:Date.now(),builtIn:true};}
  // Cloud accounts are linked only by their Cloud id. The database is written only when something changed;
  // the current session token is kept on the user's automations so scheduled runs keep working after a new login.
  function ensureShadowUser(remoteUser, token) {
    if (!remoteUser?.email || !remoteUser?.id) return null;
    const db = store.read();
    let changed = false;
    let user = db.users.find((u) => u.cloudUserId && String(u.cloudUserId) === String(remoteUser.id));
    if (!user) {
      user = { id: crypto.randomUUID(), email: normalizeEmail(remoteUser.email), name: remoteUser.name || String(remoteUser.email).split("@")[0], passwordHash: null, memoryEnabled: true, createdAt: Date.now(), cloudUserId: String(remoteUser.id) };
      db.users.push(user);
      db.assistants.push(builtInAssistant(user.id));
      changed = true;
    }
    const next = { email: normalizeEmail(remoteUser.email), name: remoteUser.name || user.name || normalizeEmail(remoteUser.email).split("@")[0], role: remoteUser.role || user.role || "user", status: remoteUser.status || user.status || "active" };
    for (const [k, v] of Object.entries(next)) if (user[k] !== v) { user[k] = v; changed = true; }
    if (token) {
      const h = tokenHash(token);
      for (const a of db.automations) if (a.userId === user.id && a.cloudTokenHash !== h) { a.cloudToken = sealSecret(token); a.cloudTokenHash = h; changed = true; }
    }
    if (changed) { user.cloudSyncedAt = Date.now(); store.write(db); }
    return user;
  }
  function localSession(token) {
    try {
      const payload = jwt.verify(token, secret);
      // Sessions created by older versions had no expiry: accept them only within the same 30-day window.
      if (!payload.exp && (!payload.iat || Date.now() / 1000 - payload.iat > SESSION_DAYS * 86400)) return null;
      if (isRevoked(payload, token)) return null;
      const user = store.read().users.find((u) => u.id === payload.sub);
      return user ? { user, payload } : null;
    } catch { return null; }
  }
  function roleFor(user, cloudUser) {
    if (cloudUser) return String(cloudUser.role || "").toLowerCase() === "owner" ? "owner" : "user";
    const ownerEmail = normalizeEmail(getOmniConfig().ownerEmail);
    if (!cloudBase() && ownerEmail && ownerEmail === normalizeEmail(user?.email)) return "owner";
    return String(user?.role || "").toLowerCase() === "owner" ? "owner" : "user";
  }
  function ownerRequest(req){return roleFor(req.user,req.cloudUser)==="owner";}
  // Models that run on the Owner's own accounts connected in OmniRoute by login or cookie (ChatGPT / Codex, Gemini,
  // Claude Code): their terms forbid making an account available to anyone else, so only the Owner may use them
  // (or the single person of a PC with no Owner email set). Other accounts use the free models and the paid APIs.
  const PERSONAL_PROVIDERS=/^(codex|cx|chatgpt-web|cgpt-web|gemini-web|gweb|claude-code|cc|gemini-cli|gc)\//i;
  function personalAllowed(user,cloudUser){
    if(roleFor(user,cloudUser)==="owner")return true;
    return !cloudBase()&&!normalizeEmail(getOmniConfig().ownerEmail);
  }
  function requirePersonalAccess(req,model){
    if(PERSONAL_PROVIDERS.test(String(model||"").trim())&&!personalAllowed(req.user,req.cloudUser))
      throw policyFailure(`Modelul «${model}» folosește abonamentul personal al Owner-ului și nu poate fi folosit din alt cont. Alege alt model din listă.`,403);
  }
  // Local mode (no AI Stoica Cloud): the account on this PC uses the API keys configured on this PC.
  // Code execution, SSH and GitHub write stay Owner-only.
  function directApisAllowed(req){return ownerRequest(req)||!cloudBase();}
  function normalizePermissions(raw, owner) {
    const out = {};
    for (const k of PERMISSION_KEYS) { const v = raw?.[k]; out[k] = owner || !(v === false || v === "false" || v === 0); }
    return out;
  }
  // Missing keys are allowed. In Cloud mode without a verified Cloud session (Cloud unreachable) gated features stay off.
  function permissionsFor(req) {
    if (!cloudBase() || ownerRequest(req)) return normalizePermissions({}, true);
    if (!req.cloudUser) return Object.fromEntries(PERMISSION_KEYS.map((k) => [k, false]));
    return normalizePermissions(req.permissions || {}, false);
  }
  function hasPermission(req, key) { return permissionsFor(req)[key] !== false; }
  function requireFeaturePermission(req, key) { if (!hasPermission(req, key)) throw policyFailure(deniedMessage(key), 403); }
  function requirePermission(key) { return (req, res, next) => (hasPermission(req, key) ? next() : res.status(403).json({ error: deniedMessage(key) })); }
  function publicUser(user, role) {
    return {
      id: user.id, email: user.email, name: user.name || String(user.email || "").split("@")[0],
      createdAt: user.createdAt, memoryEnabled: user.memoryEnabled !== false,
      role: role || "user", status: user.status || "active",
      cloudUserId: user.cloudUserId || null,
      preferences: userPreferences(user)
    };
  }
  const PREFERENCE_KEYS = ["searchPastChats", "memoryEnabled", "askClarifyingQuestions"];
  function userPreferences(user) { return Object.fromEntries(PREFERENCE_KEYS.map((k) => [k, user?.[k] !== false])); }
  const cloudAuthCache = new Map();
  async function auth(req, res, next) {
    const raw = String(req.headers.authorization || "");
    const token = raw.startsWith("Bearer ") ? raw.slice(7).trim() : "";
    if (!token) return res.status(401).json({ error: "Autentificare necesară." });

    // When Cloud is configured, validate there first. A 401/403 from Cloud wins over
    // a legacy local session, so suspended/blocked accounts cannot bypass server policy.
    let cloudUnreachable = false;
    if (cloudBase()) {
      const key = tokenHash(token), hit = cloudAuthCache.get(key);
      if (hit && hit.exp > Date.now()) {
        const user = store.read().users.find((u) => u.id === hit.userId);
        if (user) { req.user = user; req.cloudUser = hit.cloudUser; req.cloudToken = token; req.permissions = hit.permissions; return next(); }
      }
      try {
        const remote = await cloudFetch("/auth/me", { headers:{ Authorization:`Bearer ${token}` }, timeout:7000 });
        const text = await remote.text();
        let data={}; try { data=JSON.parse(text||"{}"); } catch {}
        if (remote.ok && data?.user) {
          const user = ensureShadowUser(data.user, token);
          if (!user) return res.status(401).json({ error:"Sesiune Cloud invalidă." });
          req.user = user; req.cloudUser = data.user; req.cloudToken = token; req.permissions = data.permissions || {};
          cloudAuthCache.set(key, { userId: user.id, cloudUser: data.user, permissions: req.permissions, exp: Date.now() + 15000 });
          if (cloudAuthCache.size > 500) for (const [k, v] of cloudAuthCache) if (v.exp <= Date.now()) cloudAuthCache.delete(k);
          return next();
        }
        if (remote.status === 401 || remote.status === 403) {
          return res.status(remote.status).json({ error: typeof data?.error === "string" && data.error ? data.error : "Sesiunea AI Stoica Cloud nu mai este validă." });
        }
        // 5xx from a proxy (server down), 404 (wrong address) or 429: the account is not logged out.
        cloudUnreachable = true;
      } catch {
        cloudUnreachable = true;
      }
    }

    const session = localSession(token);
    // A Cloud account must not be logged out just because the internet or the server is down for a moment.
    if (!session && cloudUnreachable) return res.status(503).json({ error: "Serverul AI Stoica Cloud nu răspunde momentan. Verifică internetul și încearcă din nou peste câteva secunde." });
    if (!session) return res.status(401).json({ error: "Autentificare necesară." });
    req.user = session.user; req.localToken = token; req.localSession = session.payload;
    next();
  }
  function cloudOwnerOnly(req,res,next) {
    if (!cloudBase()) return res.status(503).json({ error:"AI Stoica Cloud nu este configurat în Setări." });
    if (!req.cloudToken) return res.status(401).json({ error:"Reautentifică-te prin AI Stoica Cloud pentru Control Center." });
    if (!ownerRequest(req)) return res.status(403).json({ error:"Acces rezervat Owner." });
    next();
  }
  async function proxyCloud(req,res) {
    try {
      const headers = { Authorization: String(req.headers.authorization || "") };
      const hasBody = !["GET","HEAD"].includes(req.method);
      const remote = await cloudFetch(req.originalUrl, { method:req.method, headers, body:hasBody ? (req.body || {}) : undefined, timeout:12000 });
      const contentType = remote.headers.get("content-type") || "";
      const body = await remote.text();
      if (!/json/i.test(contentType)) return res.status(remote.status >= 500 ? 503 : remote.status).json(remote.ok ? { data: body } : { error: remote.status >= 500 ? cloudDownMessage(remote.status) : `AI Stoica Cloud a răspuns cu HTTP ${remote.status}.` });
      res.status(remote.status).type(contentType).send(body);
    } catch (e) {
      res.status(503).json({ error: cloudDownMessage(0) });
    }
  }

  // Setări on the web site, for the Owner (apps/cloud/server.cjs passes serverSettings; the Windows app keeps its own
  // config through Electron and has no such route). Keys come back masked; a saved change applies to the next request.
  function requireSettingsOwner(req){
    if(!serverSettings)throw policyFailure("Setările serverului există doar pe site (aistoica.ro); în Windows sunt în aplicație.",404);
    if(!ownerRequest(req))throw policyFailure("Doar Owner-ul poate schimba setările serverului.",403);
  }
  app.get("/api/server/settings", auth, (req,res) => {
    try{requireSettingsOwner(req);res.json({data:serverSettings.publicView()})}
    catch(e){sendError(res,e,500)}
  });
  app.put("/api/server/settings", auth, (req,res) => {
    try{
      requireSettingsOwner(req);
      const input=req.body&&typeof req.body==="object"&&!Array.isArray(req.body)?req.body:{};
      serverSettings.save(input);
      // The model list and the OmniRoute list follow the new keys and addresses right away.
      omniEntriesCache={at:0,entries:[]};configMemo=null;
      res.json({ok:true,config:serverSettings.publicView()});
    }catch(e){sendError(res,e,500)}
  });

  // "Actualizează site-ul" (Owner, web server only). The site never runs anything on the server itself: it drops a
  // request file in updateDir, and the server's systemd service (deploy/hetzner/install-updater.sh) runs update.sh and
  // writes status.json / available.json back here.
  const readUpdateJson=(name)=>{try{return JSON.parse(fs.readFileSync(path.join(updateDir,name),"utf8"))}catch{return null}};
  function requireUpdateOwner(req){
    if(!ownerRequest(req))throw policyFailure("Doar Owner-ul poate actualiza site-ul.",403);
    if(!updateDir)throw policyFailure("Actualizarea din aplicație există doar pe serverul aistoica.ro.",404);
  }
  const UPDATE_SETUP="Serviciul de actualizare nu e instalat pe server. Rulează o dată pe server: sudo bash /opt/ai-stoica/deploy/hetzner/update.sh";
  app.get("/api/server/update", auth, (req,res) => {
    if(!ownerRequest(req)||!updateDir)return res.json({data:{enabled:false}});
    const exists=(name)=>{try{return fs.existsSync(path.join(updateDir,name))}catch{return false}};
    res.json({data:{enabled:true,installed:exists("installed"),pending:exists("request"),auto:exists("auto"),
      status:readUpdateJson("status.json"),available:readUpdateJson("available.json"),setupHint:exists("installed")?"":UPDATE_SETUP}});
  });
  app.post("/api/server/update", auth, (req,res) => {
    try{
      requireUpdateOwner(req);
      if(!fs.existsSync(path.join(updateDir,"installed")))throw policyFailure(UPDATE_SETUP,503);
      if(readUpdateJson("status.json")?.state==="running")throw policyFailure("O actualizare rulează deja. Așteaptă să se termine.",409);
      fs.writeFileSync(path.join(updateDir,"request"),JSON.stringify({by:req.user?.email||"",at:new Date().toISOString()}));
      res.status(202).json({data:{pending:true}});
    }catch(e){sendError(res,e.status?e:policyFailure("Cererea de actualizare nu a putut fi scrisă pe server: "+e.message,500))}
  });
  app.patch("/api/server/update", auth, (req,res) => {
    try{
      requireUpdateOwner(req);
      const auto=toBool(req.body?.auto,undefined);
      if(typeof auto!=="boolean")throw policyFailure("Câmpul „auto” trebuie să fie true sau false.",400);
      const file=path.join(updateDir,"auto");
      if(auto)fs.writeFileSync(file,new Date().toISOString());else fs.rmSync(file,{force:true});
      res.json({data:{auto}});
    }catch(e){sendError(res,e.status?e:policyFailure("Setarea nu a putut fi salvată pe server: "+e.message,500))}
  });

  app.get("/health", async (_req, res) => {
    const cfg = getOmniConfig(); let omni = false, omniNeedsKey = false, cloudOnline = false;
    try {
      const r = await fetch(`${String(cfg.baseUrl).replace(/\/+$/, "")}/models`, {
        headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
        signal: AbortSignal.timeout(2500)
      });
      omni = r.ok;
      // OmniRoute 3.8 answers 401 on /v1/* without a valid client key: it is running, but AI Stoica cannot use it yet.
      omniNeedsKey = r.status === 401 || r.status === 403;
      try { await r.body?.cancel(); } catch {}
    } catch {}
    if (cloudBase()) {
      try { const r = await cloudFetch("/health",{timeout:2500}); cloudOnline = r.ok; } catch {}
    }
    res.json({ ok: true, service: serviceName, omni, omniNeedsKey, model: cfg.model || "", cloudConfigured:!!cloudBase(), cloudOnline });
  });

  // Cloud login/register answers get the same shape as local ones: user.role and a permissions object.
  function cloudAuthAnswer(data, token) {
    if (!data?.user) return data;
    const user = ensureShadowUser(data.user, token);
    const owner = String(data.user.role || "").toLowerCase() === "owner";
    return { ...data, user: user ? publicUser({ ...user, status: data.user.status || user.status }, owner ? "owner" : "user") : data.user, permissions: normalizePermissions(data.permissions || {}, owner) };
  }
  // First Cloud login on a PC that was used in local mode: the local account with the same email (proved by the
  // same password) is linked to the Cloud account, so its conversations, Library and memories stay visible.
  async function linkLocalAccount(remoteUser, password) {
    try {
      if (!remoteUser?.id || !remoteUser?.email || typeof password !== "string" || !password) return;
      const db = store.read();
      if (db.users.some((u) => u.cloudUserId && String(u.cloudUserId) === String(remoteUser.id))) return;
      const local = db.users.find((u) => !u.cloudUserId && u.passwordHash && normalizeEmail(u.email) === normalizeEmail(remoteUser.email));
      if (!local || !(await bcrypt.compare(password, local.passwordHash))) return;
      local.cloudUserId = String(remoteUser.id);
      store.write(db);
    } catch {}
  }
  async function proxyCloudAuth(req, res, pathname, kind) {
    try {
      const remote = await cloudFetch(pathname, { method: "POST", body: req.body || {}, timeout: 12000 });
      const text = await remote.text(); let data = {}; try { data = JSON.parse(text || "{}"); } catch {}
      if (!remote.ok) {
        if (kind === "login" && remote.status === 401) countAttempt(req, kind);
        if (remote.status >= 500) return res.status(503).json({ error: cloudDownMessage(remote.status) });
        return res.status(remote.status).json({ error: typeof data?.error === "string" && data.error ? data.error : `AI Stoica Cloud a refuzat cererea (HTTP ${remote.status}).` });
      }
      if (!data?.token || !data?.user) return res.status(502).json({ error: "Răspuns invalid de la AI Stoica Cloud." });
      if (kind === "login") { clearAttempts(req, kind); await linkLocalAccount(data.user, req.body?.password); }
      return res.json(cloudAuthAnswer(data, data.token));
    } catch (e) { return res.status(503).json({ error: cloudDownMessage(0) }); }
  }
  const registerLocks = new Set();
  app.post("/auth/register", async (req, res) => {
    if (rateLimited(req, res, "register")) return;
    countAttempt(req, "register");
    if (cloudBase()) return proxyCloudAuth(req, res, "/auth/register", "register");
    const email = normalizeEmail(req.body?.email), password = typeof req.body?.password === "string" ? req.body.password : "", name = String(req.body?.name || "").trim().slice(0, 80);
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Adresa de email nu este validă." });
    if (password.length < 8) return res.status(400).json({ error: "Parola trebuie să aibă cel puțin 8 caractere." });
    if (Buffer.byteLength(password) > 72) return res.status(400).json({ error: "Parola poate avea cel mult 72 de caractere." });
    const closed = () => getOmniConfig()?.allowRegistration === false && store.read().users.length;
    const taken = () => store.read().users.some((u) => normalizeEmail(u.email) === email);
    // Servers reachable from the internet (apps/cloud) can turn off sign-up after the first account.
    if (closed()) return res.status(403).json({ error: "Crearea de conturi noi este dezactivată pe acest server." });
    if (taken() || registerLocks.has(email)) return res.status(409).json({ error: "Există deja un cont cu acest email." });
    registerLocks.add(email);
    try {
      const passwordHash = await bcrypt.hash(password, 12);
      if (closed()) return res.status(403).json({ error: "Crearea de conturi noi este dezactivată pe acest server." });
      if (taken()) return res.status(409).json({ error: "Există deja un cont cu acest email." });
      const db = store.read();
      const user = { id: crypto.randomUUID(), email, name: name || email.split("@")[0], passwordHash, memoryEnabled: true, createdAt: Date.now() };
      db.users.push(user);
      db.assistants.push(builtInAssistant(user.id));
      store.write(db);
      const reqLike = { user };
      res.json({ token: sign(user), user: publicUser(user, roleFor(user, null)), permissions: permissionsFor(reqLike) });
    } finally { registerLocks.delete(email); }
  });

  app.post("/auth/login", async (req, res) => {
    if (rateLimited(req, res, "login")) return;
    if (cloudBase()) return proxyCloudAuth(req, res, "/auth/login", "login");
    const email = normalizeEmail(req.body?.email), password = typeof req.body?.password === "string" ? req.body.password : "";
    const db = store.read(), user = db.users.find((u) => normalizeEmail(u.email) === email && u.passwordHash) || db.users.find((u) => normalizeEmail(u.email) === email);
    if (!user) { countAttempt(req, "login"); return res.status(401).json({ error: "Email sau parolă incorectă." }); }
    if (!user.passwordHash) { countAttempt(req, "login"); return res.status(401).json({ error: "Acest cont a fost creat prin AI Stoica Cloud și nu are parolă locală. Configurează din nou adresa AI Stoica Cloud în Setări sau creează un cont local cu alt email." }); }
    let ok = false;
    try { ok = await bcrypt.compare(password, user.passwordHash); } catch {}
    if (!ok) { countAttempt(req, "login"); return res.status(401).json({ error: "Email sau parolă incorectă." }); }
    clearAttempts(req, "login");
    if (typeof user.memoryEnabled !== "boolean") { user.memoryEnabled = true; store.write(db); }
    res.json({ token: sign(user), user: publicUser(user, roleFor(user, null)), permissions: permissionsFor({ user }) });
  });
  app.get("/auth/me", auth, (req, res) => res.json({
    token: req.cloudToken || sign(req.user, req.localSession?.sid),
    user: publicUser({ ...req.user, status: req.cloudUser?.status || req.user.status }, roleFor(req.user, req.cloudUser)),
    permissions: permissionsFor(req)
  }));
  app.patch("/api/me/preferences", auth, (req, res) => {
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {}, changes = {};
    for (const k of PREFERENCE_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(body, k)) continue;
      const v = toBool(body[k], undefined);
      if (typeof v !== "boolean") return res.status(400).json({ error: `Câmpul „${k}” trebuie să fie true sau false.` });
      changes[k] = v;
    }
    const db = store.read(), user = db.users.find((u) => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: "Contul nu a fost găsit." });
    if (Object.keys(changes).length) { Object.assign(user, changes); store.write(db); }
    res.json({ data: { preferences: userPreferences(user) } });
  });
  app.post("/auth/logout", auth, async (req, res) => {
    if (req.cloudToken) {
      cloudAuthCache.delete(tokenHash(req.cloudToken));
      try { await cloudFetch("/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${req.cloudToken}` }, body: {}, timeout: 5000 }); } catch {}
    }
    if (req.localToken) revokeLocalToken(req.localToken);
    res.json({ ok: true });
  });

  // Owner Control Center is always backed by PostgreSQL on the Hetzner API.
  app.use("/api/admin", auth, cloudOwnerOnly, proxyCloud);

  app.get("/api/models", auth, async (req, res) => {
    const cfg = getOmniConfig();
    let entries=[],omniError="";
    try{entries=await omniModelEntries(cfg)}catch(e){omniError=roError(e);entries=omniEntriesLast}
    // Everything OmniRoute serves is listed: free and paid models and its combinations ("Ai principal", auto/* …).
    // OmniRoute marks a combination with owned_by "combo"; a name without "provider/" is one too. The interface groups them first.
    const mapped=entries.map(x=>{const id=String(typeof x==="string"?x:x?.id||"").trim();if(!id)return null;const base=typeof x==="string"?{id}:{...x,id};return (x?.owned_by==="combo"||!id.includes("/"))?{...base,provider:"omniroute",kind:"combo"}:base;}).filter(Boolean);
    // Your own combinations first ("Ai principal" becomes the default pick), then OmniRoute's auto/* ones, then the models.
    const rank=x=>x.kind==="combo"?(/^auto\//i.test(x.id)?1:0):2;
    const manualModels=mapped.map((x,i)=>[x,i]).sort((a,b)=>rank(a[0])-rank(b[0])||a[1]-b[1]).map(([x])=>x);
    let filtered=manualModels,policyError="";
    if(cloudBase()){
      try{filtered=await allowedOmniEntries(req,manualModels)}
      catch(e){filtered=[];policyError=e.message}
    }
    if(directApisAllowed(req)&&cfg.directChatEnabled!==false){
      try{
        const direct=await directChatCandidates(cfg,"");
        const directEntries=[...new Map(direct.map(x=>[x.provider+"/"+x.model,{id:x.provider+"/"+x.model,provider:x.provider,source:"direct-api"}])).values()];
        const seen=new Set(filtered.map(x=>String(typeof x==="string"?x:x?.id||"").toLowerCase()));
        for(const x of directEntries)if(!seen.has(x.id.toLowerCase())){filtered.push(x);seen.add(x.id.toLowerCase())}
      }catch(e){policyError=policyError||("API direct: "+roError(e))}
    }
    if(!personalAllowed(req.user,req.cloudUser))filtered=filtered.filter(x=>!PERSONAL_PROVIDERS.test(String(typeof x==="string"?x:x?.id||"")));
    filtered=filtered.filter(x=>!modelBlocked(cfg,String(typeof x==="string"?x:x?.id||"")));
    if(!filtered.length&&omniError)return res.status(502).json({error:"Nu pot încărca modele OmniRoute și nu există API-uri directe configurate: "+omniError});
    res.json({
      data:filtered,
      manualModels:filtered,
      combos:filtered.filter(x=>x?.kind==="combo").map(x=>x.id),
      policyEnforced:!!cloudBase(),
      policyUnavailable:!!policyError,
      policyError,
      omniUnavailable:!!omniError,
      omniError,
      automaticRouting:false,
      ownerControlled:true,
      deniedCount:Math.max(0,manualModels.length-filtered.filter(x=>x?.source!=="direct-api").length)
    });
  });

  function headerSafe(value){return String(value||"").replace(/[^\x20-\x7e]/g,"?").slice(0,200);}
  function sendError(res,e,fallback=502){
    if(res.headersSent)return;
    res.status(Number.isInteger(e?.status)&&e.status>=400&&e.status<600?e.status:fallback).json({error:e?.status?e.message:roError(e)});
  }

  app.post("/api/tools/code/run", auth, ownerOnlyLocal, async (req,res) => {
    try{
      const result=await executeCode(req.body?.language||"javascript",req.body?.code||"");
      res.json({data:result});
    }catch(e){sendError(res,e,e?.code==="ENOENT"?503:500)}
  });

  app.post("/api/tools/server/check", auth, ownerOnlyLocal, async (req,res) => {
    try{
      const cfg={...getOmniConfig(),...Object.fromEntries(["serverHost","serverPort","serverUser","serverKeyPath"].filter(k=>typeof req.body?.[k]==="string"||typeof req.body?.[k]==="number").map(k=>[k,String(req.body[k]).slice(0,500)]))};
      const result=await sshRun(cfg,'echo AI_STOICA_SERVER_OK; uname -a 2>/dev/null || ver; uptime 2>/dev/null || true',18000);
      res.json({ok:result.code===0,output:(result.stdout||result.stderr||"").trim(),data:result});
    }catch(e){sendError(res,e)}
  });

  app.post("/api/github/solve", auth, ownerOnlyGithub, requirePermission("github_access"), async (req,res) => {
    try{
      const filePath=String(req.body?.path||"").trim();if(!filePath)return res.status(400).json({error:"Calea fișierului GitHub lipsește."});
      const file=await githubReadFile(getOmniConfig(),filePath,req.body?.branch);
      const solved=await generateGithubProposal(req,file,req.body?.instruction);
      res.json({data:{path:file.path,sha:file.sha,branch:file.branch,proposal:solved.proposal,model:solved.model,check:solved.check}});
    }catch(e){sendError(res,e)}
  });

  app.post("/api/github/apply", auth, ownerOnlyGithub, requirePermission("github_access"), async (req,res) => {
    try{
      const filePath=String(req.body?.path||"").trim(),content=typeof req.body?.content==="string"?req.body.content:"";
      if(!filePath||!content)return res.status(400).json({error:"Calea și conținutul sunt obligatorii."});
      if(!req.body?.sha)return res.status(400).json({error:"Lipsește versiunea fișierului (sha). Rulează din nou GitHub Solve."});
      const current=await githubReadFile(getOmniConfig(),filePath,req.body?.branch);
      if(String(req.body.sha)!==String(current.sha))return res.status(409).json({error:"Fișierul s-a modificat între timp în GitHub. Rulează din nou GitHub Solve."});
      const backupId=saveGithubBackup(current);
      const result=await githubWriteFile(getOmniConfig(),{filePath:current.path,content,sha:current.sha,branch:current.branch,message:req.body?.message});
      res.json({data:{commit:result?.commit?.sha||"",contentSha:result?.content?.sha||"",backupId,path:current.path,branch:current.branch}});
    }catch(e){sendError(res,e)}
  });

  app.post("/api/github/rollback/:backupId", auth, ownerOnlyGithub, requirePermission("github_access"), async (req,res) => {
    try{
      const backupId=String(req.params.backupId||"");
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(backupId))return res.status(400).json({error:"Identificatorul backup-ului nu este valid."});
      const backupPath=path.join(githubBackupsDir,backupId+".json");
      if(!fs.existsSync(backupPath))return res.status(404).json({error:"Backup GitHub inexistent."});
      const backup=JSON.parse(await fs.promises.readFile(backupPath,"utf8"));
      const current=await githubReadFile(getOmniConfig(),backup.path,backup.branch);
      const result=await githubWriteFile(getOmniConfig(),{filePath:backup.path,content:backup.content,sha:current.sha,branch:backup.branch,message:"AI Stoica: rollback "+backup.path});
      res.json({data:{commit:result?.commit?.sha||"",path:backup.path,branch:backup.branch}});
    }catch(e){sendError(res,e)}
  });
  const has=(body,k)=>Object.prototype.hasOwnProperty.call(body||{},k);
  // Returns the trimmed string, "" when absent, or null when the value is not text or too long.
  function textInput(value,max){if(value==null)return "";if(typeof value!=="string")return null;const v=value.trim();return v.length>max?null:v;}
  app.get("/api/projects", auth, (req,res) => { const db=store.read(); res.json({data:db.projects.filter(x=>x.userId===req.user.id).sort((a,b)=>b.updatedAt-a.updatedAt)}); });
  app.post("/api/projects", auth, (req,res) => {
    const name=textInput(req.body?.name,120),instructions=textInput(req.body?.instructions,12000);
    if(!name)return res.status(400).json({error:name===null?"Numele proiectului poate avea cel mult 120 de caractere.":"Numele proiectului este obligatoriu."});
    if(instructions===null)return res.status(400).json({error:"Instrucțiunile proiectului pot avea cel mult 12.000 de caractere."});
    const db=store.read(), item={id:crypto.randomUUID(),userId:req.user.id,name,instructions,createdAt:Date.now(),updatedAt:Date.now()}; db.projects.push(item);store.write(db);res.json({data:item});
  });
  app.get("/api/projects/:id", auth, (req,res) => {
    const item=store.read().projects.find(x=>x.id===req.params.id&&x.userId===req.user.id);if(!item)return res.status(404).json({error:"Proiectul nu a fost găsit."});res.json({data:item});
  });
  app.patch("/api/projects/:id", auth, (req,res) => {
    const db=store.read(),item=db.projects.find(x=>x.id===req.params.id&&x.userId===req.user.id);if(!item)return res.status(404).json({error:"Proiectul nu a fost găsit."});
    if(has(req.body,"name")){const name=textInput(req.body.name,120);if(!name)return res.status(400).json({error:name===null?"Numele proiectului poate avea cel mult 120 de caractere.":"Numele proiectului este obligatoriu."});item.name=name;}
    if(has(req.body,"instructions")){const v=textInput(req.body.instructions,12000);if(v===null)return res.status(400).json({error:"Instrucțiunile proiectului pot avea cel mult 12.000 de caractere."});item.instructions=v;}
    item.updatedAt=Date.now();store.write(db);res.json({data:item});
  });
  app.delete("/api/projects/:id", auth, (req,res) => {
    const db=store.read(),item=db.projects.find(x=>x.id===req.params.id&&x.userId===req.user.id);if(!item)return res.status(404).json({error:"Proiectul nu a fost găsit."});
    db.projects=db.projects.filter(x=>x!==item);
    for(const c of db.conversations)if(c.userId===req.user.id&&c.projectId===item.id)c.projectId=null;
    store.write(db);res.json({ok:true});
  });
  app.get("/api/assistants", auth, (req,res) => { const db=store.read();res.json({data:db.assistants.filter(x=>x.userId===req.user.id).sort((a,b)=>Number(b.builtIn)-Number(a.builtIn)||String(a.name).localeCompare(String(b.name)))}); });
  app.post("/api/assistants", auth, (req,res) => {
    const name=textInput(req.body?.name,80),systemPrompt=textInput(req.body?.systemPrompt,12000);
    if(!name)return res.status(400).json({error:name===null?"Numele asistentului poate avea cel mult 80 de caractere.":"Numele asistentului este obligatoriu."});
    if(systemPrompt===null)return res.status(400).json({error:"Instrucțiunile asistentului pot avea cel mult 12.000 de caractere."});
    const db=store.read(),item={id:crypto.randomUUID(),userId:req.user.id,name,icon:name[0]?.toUpperCase()||"A",systemPrompt,createdAt:Date.now(),builtIn:false};db.assistants.push(item);store.write(db);res.json({data:item});
  });
  app.get("/api/assistants/:id", auth, (req,res) => {
    const item=store.read().assistants.find(x=>x.id===req.params.id&&x.userId===req.user.id);if(!item)return res.status(404).json({error:"Asistentul nu a fost găsit."});res.json({data:item});
  });
  app.patch("/api/assistants/:id", auth, (req,res) => {
    const db=store.read(),item=db.assistants.find(x=>x.id===req.params.id&&x.userId===req.user.id);if(!item)return res.status(404).json({error:"Asistentul nu a fost găsit."});
    if(has(req.body,"name")){const name=textInput(req.body.name,80);if(!name)return res.status(400).json({error:name===null?"Numele asistentului poate avea cel mult 80 de caractere.":"Numele asistentului este obligatoriu."});item.name=name;item.icon=name[0].toUpperCase();}
    if(has(req.body,"systemPrompt")){const v=textInput(req.body.systemPrompt,12000);if(v===null)return res.status(400).json({error:"Instrucțiunile asistentului pot avea cel mult 12.000 de caractere."});item.systemPrompt=v;}
    item.updatedAt=Date.now();store.write(db);res.json({data:item});
  });
  app.delete("/api/assistants/:id", auth, (req,res) => {
    const db=store.read(),item=db.assistants.find(x=>x.id===req.params.id&&x.userId===req.user.id);if(!item)return res.status(404).json({error:"Asistentul nu a fost găsit."});
    if(item.builtIn)return res.status(400).json({error:"Asistentul implicit AI Stoica nu poate fi șters."});
    db.assistants=db.assistants.filter(x=>x!==item);
    for(const c of db.conversations)if(c.userId===req.user.id&&c.assistantId===item.id)c.assistantId=null;
    store.write(db);res.json({ok:true});
  });

  // C4: images inside saved conversations are references to the user's Library, never base64.
  const LIBRARY_REF="aistoica-library://";
  function referenceInlineImages(messages,userId,db){
    const owned=new Set(db.library.filter(x=>x.userId===userId).map(x=>x.id));
    return messages.map(m=>{
      if(!m||typeof m!=="object"||!Array.isArray(m.content))return m;
      const atts=Array.isArray(m.attachments)?m.attachments:[];
      const isImage=a=>a&&(a.type==="image"||a.kind==="image"||/^image\//i.test(String(a.mime||"")));
      // Image parts are matched to image attachments by position, so only when the two lists line up exactly
      // (0.7.10 messages may also carry video frames or images that were never sent as a picture part).
      if(atts.some(a=>a&&!isImage(a)&&(a.type==="video"||a.kind==="video"||/^video\//i.test(String(a.mime||"")))))return m;
      const imageAtts=atts.filter(isImage);
      if(imageAtts.length!==m.content.filter(p=>p?.type==="image_url").length)return m;
      const ids=imageAtts.map(a=>a.libraryId&&owned.has(String(a.libraryId))?String(a.libraryId):"");
      let k=0,changed=false;
      const content=m.content.map(p=>{
        if(p?.type!=="image_url")return p;
        const id=ids[k++],url=String(p.image_url?.url||"");
        if(id&&/^data:/i.test(url)){changed=true;return {type:"image_url",image_url:{url:LIBRARY_REF+id}};}
        return p;
      });
      return changed?{...m,content}:m;
    });
  }
  function conversationFields(body,userId,db){
    const out={};
    if(has(body,"title")){if(typeof body.title!=="string")return {error:"Titlul conversației trebuie să fie text."};out.title=body.title.trim().slice(0,200)||"Conversație nouă";}
    for(const [key,list,label] of [["projectId","projects","Proiectul"],["assistantId","assistants","Asistentul"]]){
      if(!has(body,key))continue;
      const v=body[key];
      if(v==null||v===""){out[key]=null;continue;}
      if(typeof v!=="string"||!db[list].some(x=>x.id===v&&x.userId===userId))return {error:`${label} selectat nu există.`};
      out[key]=v;
    }
    if(has(body,"model")){if(body.model!=null&&typeof body.model!=="string")return {error:"Modelul trebuie să fie text."};out.model=body.model?String(body.model).slice(0,200):null;}
    if(has(body,"archived")){const v=toBool(body.archived,false);if(v===null)return {error:"Câmpul „archived” trebuie să fie true sau false."};out.archived=v;}
    if(has(body,"messages")){
      if(!Array.isArray(body.messages))return {error:"Mesajele conversației trebuie să fie o listă."};
      if(body.messages.length>5000)return {error:"Conversația are prea multe mesaje (maxim 5000)."};
      out.messages=referenceInlineImages(body.messages.filter(m=>m&&typeof m==="object"&&!Array.isArray(m)),userId,db);
    }
    return {value:out};
  }
  app.get("/api/conversations", auth, (req,res) => {const db=store.read();res.json({data:db.conversations.filter(x=>x.userId===req.user.id).sort((a,b)=>b.updatedAt-a.updatedAt)});});
  app.post("/api/conversations", auth, (req,res) => {
    const db=store.read(),parsed=conversationFields(req.body||{},req.user.id,db);if(parsed.error)return res.status(400).json({error:parsed.error});
    const now=Date.now(),item={id:crypto.randomUUID(),userId:req.user.id,title:"Conversație nouă",projectId:null,assistantId:null,model:null,messages:[],...parsed.value,createdAt:now,updatedAt:now};
    db.conversations.push(item);store.write(db);res.json({data:item});
  });
  app.put("/api/conversations/:id", auth, (req,res) => {
    const db=store.read(),item=db.conversations.find(x=>x.id===req.params.id&&x.userId===req.user.id);if(!item)return res.status(404).json({error:"Conversația nu a fost găsită."});
    const parsed=conversationFields(req.body||{},req.user.id,db);if(parsed.error)return res.status(400).json({error:parsed.error});
    Object.assign(item,parsed.value);item.updatedAt=Date.now();store.write(db);res.json({data:item});
  });
  app.delete("/api/conversations/:id", auth, (req,res) => {
    const db=store.read(),before=db.conversations.length;db.conversations=db.conversations.filter(x=>!(x.id===req.params.id&&x.userId===req.user.id));if(db.conversations.length===before)return res.status(404).json({error:"Conversația nu a fost găsită."});store.write(db);res.json({ok:true});
  });

  app.get("/api/memory", auth, async (req,res) => {
    const db=store.read(),user=db.users.find(u=>u.id===req.user.id);
    const q=String(req.query.q||"").slice(0,2000);const data=q?await embeddingIndex.search(getOmniConfig(),db,req.user.id,q,100):db.memories.filter(m=>m.userId===req.user.id).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.createdAt-a.createdAt);
    res.json({enabled:user?.memoryEnabled!==false,data});
  });
  app.post("/api/memory/toggle", auth, (req,res) => {
    const enabled=toBool(req.body?.enabled,undefined);if(typeof enabled!=="boolean")return res.status(400).json({error:"Câmpul „enabled” trebuie să fie true sau false."});
    const db=store.read(),user=db.users.find(u=>u.id===req.user.id);if(!user)return res.status(404).json({error:"Contul nu a fost găsit."});user.memoryEnabled=enabled;store.write(db);res.json({enabled:user.memoryEnabled});
  });
  app.post("/api/memory", auth, (req,res) => {
    const text=textInput(req.body?.text,12000);if(text===null)return res.status(400).json({error:"Memoria poate avea cel mult 12.000 de caractere."});
    const db=store.read(),item=addMemory(db,req.user.id,text,"manual",{pinned:toBool(req.body?.pinned,false)===true});if(!item)return res.status(400).json({error:"Memoria este goală."});store.write(db);res.json({data:item});
  });
  app.post("/api/memory/capture", auth, (req,res) => {
    const db=store.read(),user=db.users.find(u=>u.id===req.user.id);if(user?.memoryEnabled===false)return res.json({ok:true,stored:false});
    const userText=typeof req.body?.userText==="string"?req.body.userText.trim():"";
    const candidate=durableMemoryCandidate(userText);
    if(!candidate)return res.json({ok:true,stored:false});
    const before=db.memories.length;
    const item=addMemory(db,req.user.id,candidate,"automatic",{conversationId:typeof req.body?.conversationId==="string"?req.body.conversationId:null,category:memoryCategory(candidate)});
    if(item)store.write(db);res.json({ok:true,stored:!!item&&db.memories.length>before,data:item});
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
      for(const u of (Array.isArray(c.messages)?c.messages:[])){
        if(u?.role!=="user")continue;
        const candidate=durableMemoryCandidate(typeof u.displayText==="string"&&u.displayText?u.displayText:textFromContent(u.content));
        if(!candidate)continue;
        const before=db.memories.length;
        addMemory(db,req.user.id,candidate,"history",{conversationId:c.id,category:memoryCategory(candidate)});
        if(db.memories.length>before)count++;
      }
    }
    if(count)store.write(db);res.json({ok:true,count});
  });
  app.patch("/api/memory/:id", auth, (req,res) => {
    const db=store.read(),item=db.memories.find(m=>m.id===req.params.id&&m.userId===req.user.id);if(!item)return res.status(404).json({error:"Memoria nu a fost găsită."});
    if(has(req.body,"pinned")){const v=toBool(req.body.pinned,undefined);if(typeof v!=="boolean")return res.status(400).json({error:"Câmpul „pinned” trebuie să fie true sau false."});item.pinned=v;}
    if(has(req.body,"text")){const text=textInput(req.body.text,12000);if(!text)return res.status(400).json({error:text===null?"Memoria poate avea cel mult 12.000 de caractere.":"Memoria este goală."});item.text=text;item.category=memoryCategory(text);}
    item.updatedAt=Date.now();store.write(db);res.json({data:item});
  });
  app.delete("/api/memory/:id", auth, (req,res) => {const db=store.read(),before=db.memories.length;db.memories=db.memories.filter(m=>!(m.id===req.params.id&&m.userId===req.user.id));if(db.memories.length===before)return res.status(404).json({error:"Memoria nu a fost găsită."});store.write(db);res.json({ok:true});});
  app.delete("/api/memory", auth, (req,res) => {const db=store.read();db.memories=db.memories.filter(m=>m.userId!==req.user.id);store.write(db);res.json({ok:true});});

  app.get("/api/library", auth, (req,res) => {const db=store.read();res.json({data:db.library.filter(x=>x.userId===req.user.id).sort((a,b)=>b.createdAt-a.createdAt).map(({dataUrl,text,filePath,...x})=>x)});});

  // Reads the text of uploaded documents (Word, PowerPoint, Excel, PDF, text/code) so the AI can use them.
  async function indexLibraryText(id){
    const item=store.read().library.find(x=>x.id===id);
    if(!item?.filePath)return;
    try{await fs.promises.access(item.filePath)}catch{return}
    let result;
    try{result=await extractText(item.filePath,item.mime,item.name)}catch{result={text:"",status:"error"}}
    const fresh=store.read(),target=fresh.library.find(x=>x.id===id);if(!target)return;
    if(result.text)target.text=result.text;
    target.textStatus=result.status;target.textIndexedAt=Date.now();
    store.write(fresh);
  }
  // Files whose reading was interrupted (app closed while "pending") are read again at startup.
  timers.push(setTimeout(async()=>{
    try{
      const pending=store.read().library.filter(x=>x.filePath&&(x.textStatus==="pending"||(!x.textStatus&&x.text==null))&&x.source!=="ai-image"&&x.source!=="ai-video").slice(0,200);
      for(const item of pending)await indexLibraryText(item.id).catch(()=>{});
    }catch{}
  },3000));
  timers[timers.length-1].unref?.();

  const MAX_UPLOAD_BYTES=2*1024*1024*1024;
  function uploadKind(mime,name){
    const lowerName=String(name||"").toLowerCase();
    return mime.startsWith("image/")?"image":
      (mime.startsWith("audio/")||/\.(mp3|m4a|aac|wav|ogg|oga|flac|opus|weba)$/i.test(lowerName))?"audio":
      (mime.startsWith("video/")||/\.(mp4|mov|m4v|webm|avi|mkv|mpeg|mpg)$/i.test(lowerName))?"video":
      (mime.startsWith("text/")||/\.(txt|md|csv|json|js|ts|py|html|css|xml|yaml|yml)$/i.test(lowerName))?"text":"file";
  }
  // Streams a raw request body to disk (max 2 GB, optional per-account quota on servers: cfg.userUploadQuotaBytes).
  function receiveUpload(req,res,{name,mime,declared},respond){
    const refuse=(status,error)=>{req.resume();if(!res.headersSent)res.status(status).json({error});};
    if(!name)return refuse(400,"Numele fișierului lipsește.");
    if(!hasPermission(req,"file_upload"))return refuse(403,deniedMessage("file_upload"));
    if(name.length>255)name=name.slice(0,255);
    const quota=Number(getOmniConfig().userUploadQuotaBytes)||0;
    const left=quota>0?Math.max(0,quota-store.read().library.filter(x=>x.userId===req.user.id).reduce((n,x)=>n+(Number(x.size)||0),0)):Infinity;
    const quotaError="Ai atins spațiul de stocare alocat contului tău. Șterge fișiere din Bibliotecă și încearcă din nou.";
    if(declared>MAX_UPLOAD_BYTES)return refuse(413,"Fișierul depășește limita de 2 GB.");
    if(declared>left)return refuse(413,quotaError);
    const id=crypto.randomUUID();
    const safeExt=path.extname(name).replace(/[^.a-z0-9_-]/gi,"").slice(0,20);
    const target=path.join(filesDir,`${id}${safeExt}`);
    let bytes=0,done=false;
    const out=fs.createWriteStream(target,{flags:"wx"});
    const fail=(status,error)=>{if(done)return;done=true;try{req.unpipe(out)}catch{};out.destroy();fs.promises.unlink(target).catch(()=>{});refuse(status,error);};
    req.on("data",chunk=>{bytes+=chunk.length;if(bytes>MAX_UPLOAD_BYTES)fail(413,"Fișierul depășește limita de 2 GB.");else if(bytes>left)fail(413,quotaError);});
    req.on("aborted",()=>fail(400,"Încărcarea a fost întreruptă."));
    req.on("close",()=>{if(!req.complete)fail(400,"Încărcarea a fost întreruptă.");});
    req.on("error",()=>fail(400,"Încărcarea a fost întreruptă."));
    out.on("error",()=>fail(500,"Nu am putut salva fișierul pe disc."));
    out.on("finish",async()=>{
      if(done)return;
      done=true;
      const db=store.read();
      const item={id,userId:req.user.id,name,mime,size:bytes,kind:uploadKind(mime,name),filePath:target,storage:"disk",textStatus:"pending",createdAt:Date.now()};
      db.library.push(item);store.write(db);
      try{await respond(item)}catch(e){sendError(res,e,500)}
    });
    req.pipe(out);
  }
  function cleanMime(value){const m=String(value||"").split(";")[0].trim().toLowerCase();return /^[a-z0-9][\w.+-]*\/[\w.+-]+$/.test(m)&&m.length<=120?m:"application/octet-stream";}
  function headerName(value){const raw=String(value||"").trim();try{return decodeURIComponent(raw).trim()}catch{return raw}}
  app.post("/api/library/upload", auth, (req,res) => {
    receiveUpload(req,res,{name:headerName(req.headers["x-file-name"]),mime:cleanMime(req.headers["x-file-type"]),declared:Number(req.headers["x-file-size"]||0)||0},async(item)=>{
      // Read the document text right away (up to 15 s) so it can be attached to the chat immediately;
      // very large files keep being processed in the background.
      let wait;
      await Promise.race([indexLibraryText(item.id).catch(()=>{}),new Promise(r=>{wait=setTimeout(r,15000)})]);
      clearTimeout(wait);
      const saved=store.read().library.find(x=>x.id===item.id)||item;
      const {filePath:_hidden,text:_text,...publicItem}=saved;
      if(!res.headersSent)res.json({data:publicItem});
    });
  });
  // Mobile app upload: raw body, name and type in the query (or X-File-* headers).
  app.post("/api/files", auth, (req,res) => {
    const ctype=cleanMime(req.headers["content-type"]);
    const mime=ctype!=="application/octet-stream"?ctype:cleanMime(req.query?.type||req.headers["x-file-type"]);
    receiveUpload(req,res,{name:String(req.query?.name||"").trim()||headerName(req.headers["x-file-name"]),mime,declared:Number(req.headers["content-length"]||0)||0},async(item)=>{
      indexLibraryText(item.id).catch(()=>{});
      res.json({data:{id:item.id,name:item.name,mimeType:item.mime,size:item.size,source:"upload",createdAt:item.createdAt}});
    });
  });

  async function libraryFileStat(item){if(!item?.filePath)return null;try{const st=await fs.promises.stat(item.filePath);return st.isFile()?st:null}catch{return null}}
  app.get(["/api/library/:id/content","/api/library/:id/file"], auth, async (req,res) => {
    const db=store.read(),item=db.library.find(x=>x.id===req.params.id&&x.userId===req.user.id);
    if(!item)return res.status(404).json({error:"Fișierul nu a fost găsit."});
    const st=await libraryFileStat(item);
    if(st){
      res.setHeader("Content-Type",item.mime||"application/octet-stream");
      res.setHeader("Content-Length",String(st.size));
      return fs.createReadStream(item.filePath).on("error",()=>res.destroy()).pipe(res);
    }
    if(item.dataUrl){
      const m=String(item.dataUrl).match(/^data:([^;]+);base64,(.+)$/s);
      if(!m)return res.status(404).json({error:"Conținut indisponibil."});
      const b=Buffer.from(m[2],"base64");res.type(item.mime||m[1]||"application/octet-stream");return res.send(b);
    }
    if(item.text!=null){res.type(item.mime||"text/plain");return res.send(String(item.text));}
    return res.status(404).json({error:"Conținutul fișierului nu mai există pe disc."});
  });
  // The text of a Word / PowerPoint / Excel / PDF file, to show it inside AI Stoica without downloading it.
  app.get("/api/library/:id/preview", auth, async (req,res) => {
    const item=store.read().library.find(x=>x.id===req.params.id&&x.userId===req.user.id);
    if(!item)return res.status(404).json({error:"Fișierul nu a fost găsit."});
    let text=item.text!=null?String(item.text):"",status=item.textStatus||(text?"ok":"");
    if(!text&&await libraryFileStat(item)){
      try{const r=await extractText(item.filePath,item.mime,item.name);text=r.text||"";status=r.status||status}catch{status="error"}
    }else if(!text&&item.dataUrl){
      const m=String(item.dataUrl).match(/^data:([^;]+);base64,(.+)$/s);
      if(m){
        const tmp=path.join(os.tmpdir(),"ai-stoica-preview-"+crypto.randomUUID()+path.extname(String(item.name||"")));
        try{await fs.promises.writeFile(tmp,Buffer.from(m[2],"base64"));const r=await extractText(tmp,item.mime,item.name);text=r.text||"";status=r.status||status}
        catch{status="error"}
        finally{fs.promises.rm(tmp,{force:true}).catch(()=>{})}
      }
    }
    const LIMIT=200000;
    res.json({data:{text:text.length>LIMIT?text.slice(0,LIMIT)+"\n\n… (fișierul continuă; descarcă-l pentru tot conținutul)":text,status,truncated:text.length>LIMIT}});
  });
  app.get("/api/library/:id", auth, (req,res) => {const db=store.read(),item=db.library.find(x=>x.id===req.params.id&&x.userId===req.user.id);if(!item)return res.status(404).json({error:"Fișierul nu a fost găsit."});const {filePath,...safe}=item;res.json({data:safe});});
  // Rename a file (only its name: the file on disk is stored under its id). Without an extension the old one is kept, so
  // the file still opens with the right program. Conversations that show the file get the new name as well.
  app.patch("/api/library/:id", auth, (req,res) => {
    const raw=String(req.body?.name??"").replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g," ").replace(/\s+/g," ").trim().replace(/^[.\s]+|[.\s]+$/g,"").slice(0,180);
    if(!raw)return res.status(400).json({error:"Scrie un nume pentru fișier."});
    const db=store.read(),item=db.library.find(x=>x.id===req.params.id&&x.userId===req.user.id);
    if(!item)return res.status(404).json({error:"Fișierul nu a fost găsit."});
    const oldExt=path.extname(String(item.name||""));
    const name=/\.[a-z0-9]{1,10}$/i.test(raw)||!oldExt?raw:raw+oldExt;
    item.name=name;item.updatedAt=Date.now();
    for(const c of db.conversations)if(c.userId===req.user.id)for(const m of c.messages||[])for(const a of m.attachments||[])if(a&&(a.libraryId===item.id||a.id===item.id))a.name=name;
    store.write(db);
    res.json({data:{id:item.id,name}});
  });
  app.delete("/api/library/:id", auth, async (req,res) => {
    const db=store.read(),item=db.library.find(x=>x.id===req.params.id&&x.userId===req.user.id);
    if(!item)return res.status(404).json({error:"Fișierul nu a fost găsit."});
    db.library=db.library.filter(x=>x!==item);store.write(db);libraryChunkCache.delete(item.id);
    if(item.filePath)await fs.promises.unlink(item.filePath).catch(()=>{});
    res.json({ok:true});
  });

  app.post("/api/export", auth, requirePermission("document_generation"), async (req,res) => {
    try {
      const format=String(req.body?.format||"docx").toLowerCase().replace(/^\./,"");
      const title=String(req.body?.title||"AI Stoica").trim().slice(0,120)||"AI Stoica";
      const content=typeof req.body?.content==="string"?req.body.content:"";
      if(!EXPORT_FORMATS.has(format))return res.status(400).json({error:"Format neacceptat de sistemul de fișiere AI Stoica."});
      if(!content.trim())return res.status(400).json({error:"Nu există conținut de exportat."});
      if(content.length>250000)return res.status(413).json({error:"Fișierul depășește limita de 250.000 de caractere pentru un singur export."});
      const generated=await createExportBytes(format,title,content);
      const requestedName=typeof req.body?.fileName==="string"?req.body.fileName.trim():"";
      const baseName=safeGeneratedName(requestedName||title).replace(new RegExp(`\\.(${[...EXPORT_FORMATS].join("|")})$`,"i"),"")||"AI Stoica";
      const name=baseName+"."+format;
      const id=crypto.randomUUID(),target=path.join(filesDir,id+"."+format);
      await fs.promises.writeFile(target,generated.bytes);
      const db=store.read(),item={id,userId:req.user.id,name,mime:generated.mime,size:generated.bytes.length,kind:generated.mime.startsWith("image/")?"image":"file",filePath:target,storage:"disk",source:"ai-export",format,createdAt:Date.now()};
      db.library.push(item);store.write(db);
      res.json({data:{id:item.id,name:item.name,mimeType:item.mime,size:item.size,source:item.source,format:item.format,createdAt:item.createdAt}});
    } catch(e) { logError("Export: "+(e?.stack||e)); res.status(500).json({error:"Nu am putut genera fișierul. Încearcă din nou sau alege alt format."}); }
  });

  // ASCII name for old clients plus the exact UTF-8 name (RFC 5987) for diacritics.
  function contentDisposition(name){
    const clean=String(name||"fisier").replace(/[\r\n"]/g,"_");
    const ascii=clean.normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^\x20-\x7e]/g,"_").replace(/[\\"]/g,"_");
    const star=encodeURIComponent(clean).replace(/['()*]/g,c=>"%"+c.charCodeAt(0).toString(16).toUpperCase());
    return `attachment; filename="${ascii}"; filename*=UTF-8''${star}`;
  }
  app.get("/api/files/:id", auth, async (req,res) => {
    const db=store.read(),item=db.library.find(x=>x.id===req.params.id&&x.userId===req.user.id);
    if(!item)return res.status(404).json({error:"Fișierul nu a fost găsit."});
    const st=await libraryFileStat(item);
    if(!st)return res.status(404).json({error:"Fișierul nu mai există pe disc."});
    res.setHeader("Content-Type",item.mime||"application/octet-stream");
    res.setHeader("Content-Length",String(st.size));
    res.setHeader("Content-Disposition",contentDisposition(item.name));
    fs.createReadStream(item.filePath).on("error",()=>res.destroy()).pipe(res);
  });

  // Media requests stop when the user cancels (the request closes); each route runs inside mediaAbort.run(signal).
  const mediaAbort=new (require("async_hooks").AsyncLocalStorage)();
  function mediaSignal(ms){return withAbort(ms,mediaAbort.getStore());}
  function mediaSleep(ms){
    const signal=mediaAbort.getStore();
    return new Promise((resolve,reject)=>{
      if(signal?.aborted)return reject(Object.assign(new Error("Cererea a fost anulată."),{name:"AbortError"}));
      const t=setTimeout(()=>{signal?.removeEventListener("abort",onAbort);resolve()},ms);
      const onAbort=()=>{clearTimeout(t);reject(Object.assign(new Error("Cererea a fost anulată."),{name:"AbortError"}))};
      signal?.addEventListener("abort",onAbort,{once:true});
    });
  }
  const MEDIA_MAX={image:40*1024*1024,video:300*1024*1024};
  async function readCapped(r,kind){
    const max=MEDIA_MAX[kind]||MEDIA_MAX.image;
    const declared=Number(r.headers.get("content-length")||0);
    const tooBig=()=>new Error(`Rezultatul ${kind==="video"?"video":"imaginii"} depășește limita locală de siguranță.`);
    if(declared>max){try{await r.body?.cancel()}catch{}throw tooBig();}
    if(!r.body)return Buffer.alloc(0);
    const chunks=[];let size=0;
    for await(const chunk of r.body){size+=chunk.length;if(size>max){try{await r.body.cancel()}catch{}throw tooBig();}chunks.push(Buffer.from(chunk));}
    return Buffer.concat(chunks);
  }
  // Provider keys are sent only to the provider's own hosts; links to CDNs or other hosts (and redirects to them) get no key.
  const AUTH_HEADER=/^(authorization|x-goog-api-key|x-api-key)$/i;
  function hostAllowed(url,hosts){try{const h=new URL(url).hostname.toLowerCase();return hosts.some(x=>h===x||h.endsWith("."+x))}catch{return false}}
  async function providerFetch(url,init,hosts){
    let current=String(url);
    for(let hop=0;hop<=5;hop++){
      const headers=Object.fromEntries(Object.entries(init.headers||{}).filter(([k])=>!AUTH_HEADER.test(k)||hostAllowed(current,hosts)));
      const r=await fetch(current,{...init,headers,redirect:"manual"});
      const location=r.headers.get("location");
      if(![301,302,303,307,308].includes(r.status)||!location)return r;
      try{await r.body?.cancel()}catch{}
      current=new URL(location,current).toString();
    }
    throw new Error("Prea multe redirecționări la descărcarea rezultatului.");
  }
  async function cancelBody(r){try{await r?.body?.cancel()}catch{}}

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
      await mediaSleep(3000);
      const r=await fetch(`${base}/videos/${encodeURIComponent(jobId)}`,{headers,signal:mediaSignal(15000)});
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
    const r=await providerFetch(candidate.value,{signal:mediaSignal(kind==="video"?180000:90000)},[]);
    if(!r.ok){await cancelBody(r);throw new Error(`Descărcarea rezultatului media a eșuat: HTTP ${r.status}`);}
    const bytes=await readCapped(r,kind);
    return {bytes,mime:inferMediaMime(bytes,r.headers.get("content-type"),kind)};
  }

  async function fetchBinaryOrCandidate(r,kind){
    const ctype=String(r.headers.get("content-type")||"");
    if(!r.ok)throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0,700)}`);
    if((kind==="image"&&ctype.startsWith("image/"))||(kind==="video"&&ctype.startsWith("video/"))){
      const bytes=await readCapped(r,kind);
      return {bytes,mime:inferMediaMime(bytes,ctype,kind)};
    }
    const text=(await readCapped(r,"image")).toString("utf8");let body;
    try{body=JSON.parse(text)}catch{body={url:text}}
    const candidate=findMediaCandidate(body,kind);
    return resolveGeneratedMedia(candidate,kind);
  }

  async function directOpenAiImage(cfg,prompt,size){
    const key=String(cfg.openAiApiKey||"").trim();if(!key)return null;
    const model=String(cfg.openAiImageModel||cfg.imageModel||"").replace(/^openai\//i,"")||"gpt-image-1-mini";
    const r=await fetch("https://api.openai.com/v1/images/generations",{
      method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${key}`},
      body:JSON.stringify({model,prompt,size:String(size||"1024x1024"),quality:"auto",output_format:"png"}),
      signal:mediaSignal(180000)
    });
    const resolved=await fetchBinaryOrCandidate(r,"image");
    return {...resolved,model:`openai/${model}`,provider:"openai-direct"};
  }

  // Grok Imagine (xAI): https://api.x.ai/v1/images/generations, OpenAI-style request and answer.
  async function directXaiImage(cfg,prompt){
    const key=String(cfg.xaiApiKey||"").trim();if(!key)return null;
    const model=String(cfg.xaiImageModel||"grok-imagine-image").trim().replace(/^(xai|x-ai)\//i,"");
    const r=await fetch("https://api.x.ai/v1/images/generations",{
      method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${key}`},
      body:JSON.stringify({model,prompt:String(prompt).slice(0,4000),n:1,response_format:"b64_json"}),
      signal:mediaSignal(180000)
    });
    const resolved=await fetchBinaryOrCandidate(r,"image");
    return {...resolved,model:`xai/${model}`,provider:"xai-direct"};
  }
  // Gemini image models ("Nano Banana") answer generateContent with the picture as inline data. The first name Google
  // does not know (404) moves on to the next one in the list.
  async function directGeminiImage(cfg,prompt){
    const key=String(cfg.geminiApiKey||"").trim();if(!key)return null;
    const models=csvValues(cfg.geminiImageModel,"gemini-3.1-flash-image,gemini-3.1-flash-image-preview,gemini-2.5-flash-image");
    let lastError="";
    for(const model of models){
      const r=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent",{
        method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":key},
        body:JSON.stringify({contents:[{parts:[{text:String(prompt).slice(0,4000)}]}],generationConfig:{responseModalities:["IMAGE"]}}),
        signal:mediaSignal(180000)
      });
      const text=await r.text();
      if(r.status===404){lastError=`${model}: HTTP 404`;continue}
      if(!r.ok)throw new Error("HTTP "+r.status+": "+text.slice(0,700));
      let body={};try{body=JSON.parse(text)}catch{throw new Error("Gemini a returnat un răspuns invalid.")}
      const part=(body?.candidates||[]).flatMap(c=>c?.content?.parts||[]).find(x=>x?.inlineData?.data||x?.inline_data?.data);
      const data=part?.inlineData||part?.inline_data;
      if(!data?.data)throw new Error("Gemini nu a returnat nicio imagine"+(body?.promptFeedback?.blockReason?` (${body.promptFeedback.blockReason})`:"")+".");
      const bytes=Buffer.from(String(data.data),"base64");
      if(bytes.length>MEDIA_MAX.image)throw new Error("Imaginea Gemini depășește limita locală de siguranță.");
      return {bytes,mime:inferMediaMime(bytes,data.mimeType||data.mime_type||"image/png","image"),model:`gemini/${model}`,provider:"gemini-image-direct"};
    }
    throw new Error("Niciun model de imagine Gemini nu este disponibil ("+lastError+"). Pune numele corect în Setări → Poze.");
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
      signal:mediaSignal(180000)
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
      signal:mediaSignal(180000)
    });
    const resolved=await fetchBinaryOrCandidate(r,"image");
    return {...resolved,model,provider:"pollinations-direct"};
  }
  // C6: works without any key or account; free, so it is allowed under «Doar gratuit».
  async function freePollinationsImage(prompt,size){
    const [w,h]=String(size||"1024x1024").split("x").map(n=>Math.max(256,Math.min(2048,Number(n)||1024)));
    const url=`https://image.pollinations.ai/prompt/${encodeURIComponent(String(prompt).slice(0,1500))}?width=${w}&height=${h}&model=flux&nologo=true&seed=${crypto.randomInt(1,2147483647)}`;
    const r=await providerFetch(url,{headers:{Accept:"image/*"},signal:mediaSignal(25000)},[]);
    const ctype=String(r.headers.get("content-type")||"").toLowerCase();
    if(!r.ok){await cancelBody(r);throw new Error(`HTTP ${r.status}`);}
    if(!ctype.startsWith("image/")){await cancelBody(r);throw new Error("Pollinations nu a returnat o imagine.");}
    const bytes=await readCapped(r,"image");
    if(!bytes.length)throw new Error("Pollinations a returnat o imagine goală.");
    return {bytes,mime:inferMediaMime(bytes,ctype,"image"),model:"pollinations/flux",provider:"pollinations-free"};
  }
  async function directCloudflareImage(cfg,prompt){
    const account=String(cfg.cloudflareAccountId||"").trim(),token=String(cfg.cloudflareApiToken||"").trim();
    if(!account||!token)return null;
    const model="@cf/black-forest-labs/flux-1-schnell";
    const url="https://api.cloudflare.com/client/v4/accounts/"+encodeURIComponent(account)+"/ai/run/"+model;
    const r=await fetch(url,{
      method:"POST",
      headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},
      body:JSON.stringify({prompt,steps:4}),
      signal:mediaSignal(180000)
    });
    if(!r.ok)throw new Error("HTTP "+r.status+": "+(await r.text()).slice(0,700));
    const body=await r.json();
    const b64=String(body?.result?.image||"").trim();
    if(!b64)throw new Error("Cloudflare nu a returnat imagine base64.");
    const bytes=Buffer.from(b64,"base64");
    return {bytes,mime:inferMediaMime(bytes,"image/png","image"),model,provider:"cloudflare-direct"};
  }

  async function directHuggingFaceImage(cfg,prompt,size){
    const token=String(cfg.hfToken||"").trim();if(!token)return null;
    const model="black-forest-labs/FLUX.1-schnell";
    const url="https://router.huggingface.co/hf-inference/models/"+model;
    const raw=String(size||"1024x1024").split("x");
    const width=Math.max(256,Math.min(2048,Number(raw[0]||1024)));
    const height=Math.max(256,Math.min(2048,Number(raw[1]||1024)));
    const r=await fetch(url,{
      method:"POST",
      headers:{"Content-Type":"application/json",Authorization:"Bearer "+token,Accept:"image/*"},
      body:JSON.stringify({inputs:prompt,parameters:{width,height}}),
      signal:mediaSignal(180000)
    });
    const resolved=await fetchBinaryOrCandidate(r,"image");
    return {...resolved,model:"huggingface/"+model,provider:"huggingface-direct"};
  }

  async function directTogetherImage(cfg,prompt,size){
    const key=String(cfg.togetherApiKey||"").trim();if(!key)return null;
    const model="black-forest-labs/FLUX.1-schnell";
    const raw=String(size||"1024x1024").split("x");
    const width=Math.max(256,Math.min(2048,Number(raw[0]||1024)));
    const height=Math.max(256,Math.min(2048,Number(raw[1]||1024)));
    const r=await fetch("https://api.together.xyz/v1/images/generations",{
      method:"POST",
      headers:{"Content-Type":"application/json",Authorization:"Bearer "+key},
      body:JSON.stringify({model,prompt,width,height,steps:4,n:1,response_format:"b64_json"}),
      signal:mediaSignal(180000)
    });
    const resolved=await fetchBinaryOrCandidate(r,"image");
    return {...resolved,model:"together/"+model,provider:"together-direct"};
  }
  async function directStabilityImage(cfg,prompt){
    const key=String(cfg.stabilityApiKey||"").trim();if(!key)return null;
    const engine=["core","ultra","sd3"].includes(String(cfg.stabilityImageEngine))?String(cfg.stabilityImageEngine):"core";
    const form=new FormData();
    form.set("prompt",prompt);
    form.set("output_format","png");
    if(engine==="sd3")form.set("model","sd3.5-large");
    const r=await fetch("https://api.stability.ai/v2beta/stable-image/generate/"+engine,{
      method:"POST",
      headers:{Authorization:"Bearer "+key,Accept:"image/*"},
      body:form,
      signal:mediaSignal(180000)
    });
    const resolved=await fetchBinaryOrCandidate(r,"image");
    return {...resolved,model:"stability/"+engine,provider:"stability-direct"};
  }

  async function directFalImage(cfg,prompt){
    const key=String(cfg.falApiKey||"").trim();if(!key)return null;
    const model=String(cfg.falImageModel||"fal-ai/z-image/turbo").trim().replace(/^\/+|\/+$/g,"");
    const r=await fetch("https://fal.run/"+model,{
      method:"POST",
      headers:{"Content-Type":"application/json",Authorization:"Key "+key},
      body:JSON.stringify({prompt}),
      signal:mediaSignal(180000)
    });
    const resolved=await fetchBinaryOrCandidate(r,"image");
    return {...resolved,model,provider:"fal-direct"};
  }

  async function directReplicateImage(cfg,prompt){
    const key=String(cfg.replicateApiToken||"").trim();if(!key)return null;
    const model=String(cfg.replicateImageModel||"black-forest-labs/flux-schnell").trim();
    const request=async authScheme=>fetch("https://api.replicate.com/v1/predictions",{
      method:"POST",
      headers:{"Content-Type":"application/json",Authorization:authScheme+" "+key,Prefer:"wait=60"},
      body:JSON.stringify({version:model,input:{prompt}}),
      signal:mediaSignal(90000)
    });
    let r=await request("Bearer");
    if(r.status===401){await cancelBody(r);r=await request("Token");}
    const text=await r.text();let body={};try{body=JSON.parse(text)}catch{body={raw:text}}
    if(!r.ok)throw new Error("HTTP "+r.status+": "+text.slice(0,700));
    let candidate=findMediaCandidate(body,"image");
    if(candidate){
      const resolved=await resolveGeneratedMedia(candidate,"image");
      return {...resolved,model,provider:"replicate-direct"};
    }
    const id=String(body.id||"").trim(),getUrl=String(body?.urls?.get||"").trim();
    if(!id&&!getUrl)throw new Error("Replicate nu a returnat rezultat sau ID de predicție.");
    const deadline=Date.now()+4*60*1000;
    let state=body;
    while(Date.now()<deadline){
      const status=String(state?.status||"").toLowerCase();
      if(/failed|canceled|cancelled/.test(status))throw new Error("Replicate: "+String(state?.error||status));
      candidate=findMediaCandidate(state,"image");
      if(candidate){
        const resolved=await resolveGeneratedMedia(candidate,"image");
        return {...resolved,model,provider:"replicate-direct"};
      }
      await mediaSleep(2500);
      const pollUrl=getUrl||("https://api.replicate.com/v1/predictions/"+encodeURIComponent(id));
      let pr=await providerFetch(pollUrl,{headers:{Authorization:"Bearer "+key},signal:mediaSignal(15000)},["api.replicate.com"]);
      if(pr.status===401){await cancelBody(pr);pr=await providerFetch(pollUrl,{headers:{Authorization:"Token "+key},signal:mediaSignal(15000)},["api.replicate.com"]);}
      const pt=await pr.text();try{state=JSON.parse(pt)}catch{state={raw:pt}}
      if(!pr.ok)throw new Error("Replicate status HTTP "+pr.status+": "+pt.slice(0,500));
    }
    throw new Error("Replicate nu a finalizat imaginea în intervalul permis.");
  }

  async function openRouterImageIsFree(cfg,model){
    const key=directOpenRouterKey(cfg);if(!key||!model)return false;
    const parts=String(model).split("/");if(parts.length<2)return false;
    const author=encodeURIComponent(parts.shift()),slug=parts.map(encodeURIComponent).join("/");
    try{
      const r=await fetch("https://openrouter.ai/api/v1/images/models/"+author+"/"+slug+"/endpoints",{
        headers:{Authorization:"Bearer "+key},
        signal:mediaSignal(12000)
      });
      if(!r.ok)return false;
      const data=await r.json();
      const endpoints=Array.isArray(data?.endpoints)?data.endpoints:[];
      return endpoints.some(ep=>{
        const pricing=Array.isArray(ep?.pricing)?ep.pricing:[];
        return pricing.length>0&&pricing.every(p=>Number(p?.cost_usd||0)<=0);
      });
    }catch{return false}
  }

  // Orders saved before 0.7.13 do not know "pollinations-free": it goes right after "pollinations".
  function imageProviderOrder(cfg){
    const known=["cloudflare","pollinations","pollinations-free","huggingface","together","openrouter","fal","replicate","stability","openai","gemini","xai"];
    const configured=String(cfg.imageProviderOrder||"").split(",").map(x=>x.trim().toLowerCase()).filter(x=>known.includes(x));
    if(!configured.includes("pollinations-free")&&configured.includes("pollinations"))configured.splice(configured.indexOf("pollinations")+1,0,"pollinations-free");
    const base=[...new Set([...configured,...known])];
    const mode=String(cfg.imageProviderMode||"auto");
    if(mode==="fast")return ["cloudflare","pollinations","pollinations-free","openrouter","fal","huggingface","together","replicate","stability","gemini","xai","openai"];
    if(mode==="quality")return ["openai","gemini","xai","openrouter","stability","fal","cloudflare","huggingface","together","replicate","pollinations","pollinations-free"];
    return base;
  }

  // A provider whose credits or quota ran out is moved to the end of the list for a while, so the next image, video
  // or answer goes straight to the next provider instead of waiting for the same refusal. It is still tried last, so a
  // request never fails only because of the memory. Empty credits: 1 hour. Rate limits: 2 minutes for images and video;
  // chat keeps the order chosen in Settings after a rate limit (those usually clear within the minute).
  const providerCooldown=new Map();
  function exhaustionWindow(message,kind){
    const m=String(message||"").toLowerCase();
    if(/http 402|\b402\b|payment required|insufficient[_ ]?(credit|quota|balance|fund)|out of credits?|no (remaining )?credits?|credit balance|not enough credits?|exceeded your current quota|quota (exceeded|exhausted)|billing|spend(ing)? limit|monthly (limit|quota)|usage limit/.test(m))return 60*60*1000;
    if(kind!=="chat"&&/http 429|\b429\b|rate.?limit|too many requests|resource.?exhausted/.test(m))return 2*60*1000;
    return 0;
  }
  function noteProviderResult(kind,id,error){
    const key=kind+":"+id;
    if(!error){providerCooldown.delete(key);return}
    const ms=exhaustionWindow(error,kind);
    if(ms)providerCooldown.set(key,{until:Date.now()+ms,reason:String(error).slice(0,200)});
  }
  function coolingDown(kind,id){
    const key=kind+":"+id,c=providerCooldown.get(key);
    if(c&&c.until<=Date.now()){providerCooldown.delete(key);return null}
    return c||null;
  }
  function byCooldown(kind,items,idOf=x=>x.id){
    return [...items.filter(x=>!coolingDown(kind,idOf(x))),...items.filter(x=>coolingDown(kind,idOf(x)))];
  }

  async function directImageAttempts(cfg,prompt,size){
    const strictFree=cfg.imageCostPolicy==="free_only"||cfg.imageProviderMode==="free";
    const openRouterModel=String(cfg.openRouterImageModel||"google/gemini-3.1-flash-image").trim();
    const openRouterFree=strictFree?await openRouterImageIsFree(cfg,openRouterModel):true;
    const definitions={
      cloudflare:{label:"Cloudflare Workers AI",configured:!!String(cfg.cloudflareAccountId||"").trim()&&!!String(cfg.cloudflareApiToken||"").trim(),paidRisk:false,run:()=>directCloudflareImage(cfg,prompt)},
      huggingface:{label:"Hugging Face",configured:!!String(cfg.hfToken||"").trim(),paidRisk:true,run:()=>directHuggingFaceImage(cfg,prompt,size)},
      together:{label:"Together AI",configured:!!String(cfg.togetherApiKey||"").trim(),paidRisk:true,run:()=>directTogetherImage(cfg,prompt,size)},
      openai:{label:"OpenAI",configured:!!String(cfg.openAiApiKey||"").trim(),paidRisk:true,run:()=>directOpenAiImage(cfg,prompt,size)},
      gemini:{label:"Google Gemini",configured:!!String(cfg.geminiApiKey||"").trim(),paidRisk:true,run:()=>directGeminiImage(cfg,prompt)},
      xai:{label:"Grok (xAI)",configured:!!String(cfg.xaiApiKey||"").trim(),paidRisk:true,run:()=>directXaiImage(cfg,prompt)},
      openrouter:{label:"OpenRouter",configured:!!directOpenRouterKey(cfg),paidRisk:!openRouterFree,run:()=>directOpenRouterImage(cfg,prompt)},
      stability:{label:"Stability AI",configured:!!String(cfg.stabilityApiKey||"").trim(),paidRisk:true,run:()=>directStabilityImage(cfg,prompt)},
      fal:{label:"fal.ai",configured:!!String(cfg.falApiKey||"").trim(),paidRisk:true,run:()=>directFalImage(cfg,prompt)},
      replicate:{label:"Replicate",configured:!!String(cfg.replicateApiToken||"").trim(),paidRisk:true,run:()=>directReplicateImage(cfg,prompt)},
      pollinations:{label:"Pollinations",configured:!!String(cfg.pollinationsApiKey||"").trim(),paidRisk:false,run:()=>directPollinationsImage(cfg,prompt)},
      "pollinations-free":{label:"Pollinations (fără cheie)",configured:cfg.pollinationsFreeEnabled!==false,paidRisk:false,run:()=>freePollinationsImage(prompt,size)}
    };
    return imageProviderOrder(cfg).map(id=>({id,...definitions[id]})).filter(x=>x.configured&&(!strictFree||!x.paidRisk));
  }

  async function directOpenRouterVideo(cfg,prompt,duration,aspectRatio){
    const key=directOpenRouterKey(cfg);if(!key)return null;
    const defaultModel=cfg.videoMode==="quality"?"bytedance/seedance-2.5":"bytedance/seedance-2.0-fast";
    const model=String(cfg.openRouterVideoModel||defaultModel).trim();
    const headers={"Content-Type":"application/json",Authorization:`Bearer ${key}`,"X-Title":"AI Stoica"};
    const submit=await fetch("https://openrouter.ai/api/v1/videos",{
      method:"POST",headers,
      body:JSON.stringify({model,prompt,duration:Math.max(1,Math.min(15,Number(duration||4))),resolution:"720p",aspect_ratio:String(aspectRatio||"16:9"),generate_audio:false}),
      signal:mediaSignal(60000)
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
        const file=await providerFetch(downloadUrl,{headers:{Authorization:`Bearer ${key}`},signal:mediaSignal(180000)},["openrouter.ai"]);
        const resolved=await fetchBinaryOrCandidate(file,"video");
        return {...resolved,model,provider:"openrouter-direct"};
      }
      await mediaSleep(6000);
      const status=await providerFetch(pollingUrl,{headers:{Authorization:`Bearer ${key}`},signal:mediaSignal(20000)},["openrouter.ai"]);
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
    let r=await fetch(url,{headers:{Authorization:`Bearer ${key}`},signal:mediaSignal(360000)});
    if([404,405].includes(r.status)){
      await cancelBody(r);
      // Newer Pollinations deployments expose the OpenAI-compatible video endpoint instead.
      r=await fetch("https://gen.pollinations.ai/v1/videos/generations",{
        method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${key}`},
        body:JSON.stringify({model,prompt,duration:Math.max(1,Math.min(10,Number(duration||4)))}),
        signal:mediaSignal(360000)
      });
    }
    const resolved=await fetchBinaryOrCandidate(r,"video");
    return {...resolved,model,provider:"pollinations-direct"};
  }

  function pricingNumbers(value,path=""){
    const out=[];
    if(value==null)return out;
    if(typeof value==="number"&&/price|pricing|cost|usd/i.test(path)){out.push(value);return out}
    if(typeof value==="string"&&/price|pricing|cost|usd/i.test(path)){
      const n=Number(value.replace(/[^0-9.eE+-]/g,""));if(Number.isFinite(n))out.push(n);return out;
    }
    if(typeof value==="object"){
      if(Array.isArray(value)){value.forEach((x,i)=>out.push(...pricingNumbers(x,path+"."+i)))}
      else for(const [k,v] of Object.entries(value))out.push(...pricingNumbers(v,path+"."+k));
    }
    return out;
  }
  function catalogEntryFree(entry){
    const nums=pricingNumbers(entry?.pricing??entry?.price??entry?.cost??entry,"pricing");
    return nums.length>0&&nums.every(n=>n<=0);
  }
  async function openRouterVideoIsFree(cfg,model){
    const key=directOpenRouterKey(cfg);if(!key||!model)return false;
    try{
      const r=await fetch("https://openrouter.ai/api/v1/videos/models",{headers:{Authorization:"Bearer "+key},signal:mediaSignal(12000)});
      if(!r.ok)return false;
      const data=await r.json(),items=Array.isArray(data)?data:(Array.isArray(data?.data)?data.data:[]);
      const hit=items.find(x=>String(x?.id||x?.model||"")===String(model));
      return !!hit&&catalogEntryFree(hit);
    }catch{return false}
  }
  async function pollinationsVideoIsFree(cfg,model){
    if(!cfg.pollinationsApiKey||!model)return false;
    try{
      const r=await fetch("https://gen.pollinations.ai/video/models",{signal:mediaSignal(12000)});
      if(!r.ok)return false;
      const data=await r.json(),items=Array.isArray(data)?data:(Array.isArray(data?.data)?data.data:[]);
      const hit=items.find(x=>{
        const id=String(x?.id||x?.model||"");
        const aliases=Array.isArray(x?.aliases)?x.aliases.map(String):[];
        return id===String(model)||aliases.includes(String(model));
      });
      return !!hit&&catalogEntryFree(hit);
    }catch{return false}
  }

  function nearestVeoDuration(value){
    const n=Math.max(1,Math.min(8,Number(value||4))),allowed=[4,6,8];
    return allowed.sort((a,b)=>Math.abs(a-n)-Math.abs(b-n))[0];
  }
  async function directGeminiVideo(cfg,prompt,duration,aspectRatio){
    const key=String(cfg.geminiApiKey||"").trim();if(!key)return null;
    const model=String(cfg.geminiVideoModel||"veo-3.1-fast-generate-preview").trim();
    const base="https://generativelanguage.googleapis.com/v1beta";
    const dur=nearestVeoDuration(duration),aspect=["16:9","9:16"].includes(String(aspectRatio))?String(aspectRatio):"16:9";
    const submit=await fetch(base+"/models/"+encodeURIComponent(model)+":predictLongRunning",{
      method:"POST",
      headers:{"Content-Type":"application/json","x-goog-api-key":key},
      body:JSON.stringify({instances:[{prompt}],parameters:{numberOfVideos:1,aspectRatio:aspect,durationSeconds:String(dur),resolution:"720p"}}),
      signal:mediaSignal(60000)
    });
    const text=await submit.text();let op={};try{op=JSON.parse(text)}catch{}
    if(!submit.ok)throw new Error("HTTP "+submit.status+": "+text.slice(0,700));
    const name=String(op?.name||"").trim();if(!name)throw new Error("Gemini Veo nu a returnat operațiunea de generare.");
    const deadline=Date.now()+8*60*1000;let state=op;
    while(Date.now()<deadline){
      if(state?.error)throw new Error("Gemini Veo: "+JSON.stringify(state.error).slice(0,600));
      if(state?.done){
        const uri=state?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri||
          state?.response?.generatedVideos?.[0]?.video?.uri||
          state?.response?.generated_videos?.[0]?.video?.uri;
        if(!uri)throw new Error("Gemini Veo a finalizat fără URL video.");
        const file=await providerFetch(String(uri),{headers:{"x-goog-api-key":key},signal:mediaSignal(180000)},["generativelanguage.googleapis.com"]);
        const resolved=await fetchBinaryOrCandidate(file,"video");
        return {...resolved,model,provider:"gemini-veo-direct"};
      }
      await mediaSleep(10000);
      const r=await fetch(base+"/"+name,{headers:{"x-goog-api-key":key},signal:mediaSignal(20000)});
      const st=await r.text();try{state=JSON.parse(st)}catch{state={raw:st}}
      if(!r.ok)throw new Error("Gemini Veo status HTTP "+r.status+": "+st.slice(0,500));
    }
    throw new Error("Gemini Veo nu a finalizat videoclipul în intervalul permis.");
  }

  async function directFalVideo(cfg,prompt,duration,aspectRatio){
    const key=String(cfg.falApiKey||"").trim();if(!key)return null;
    const model=String(cfg.falVideoModel||"fal-ai/ltx-video").trim().replace(/^\/+|\/+$/g,"");
    const headers={"Content-Type":"application/json",Authorization:"Key "+key};
    const submit=await fetch("https://queue.fal.run/"+model,{
      method:"POST",
      headers,
      body:JSON.stringify({prompt}),
      signal:mediaSignal(60000)
    });
    const text=await submit.text();let job={};try{job=JSON.parse(text)}catch{job={raw:text}}
    if(!submit.ok)throw new Error("fal.ai submit HTTP "+submit.status+": "+text.slice(0,700));

    // Queue submit responses contain status_url/response_url; these are not media files.
    // Wait for completion and only resolve the final video URL from the result payload.
    const statusUrl=String(job?.status_url||job?.statusUrl||"").trim();
    const responseUrl=String(job?.response_url||job?.responseUrl||"").trim();
    if(!statusUrl||!responseUrl)throw new Error("fal.ai nu a returnat status_url și response_url.");

    const deadline=Date.now()+10*60*1000;
    let state=job;
    while(Date.now()<deadline){
      const status=String(state?.status||"").toUpperCase();
      if(status==="COMPLETED")break;
      if(["FAILED","ERROR","CANCELED","CANCELLED"].includes(status))throw new Error("fal.ai video eșuat: "+JSON.stringify(state).slice(0,700));
      await mediaSleep(5000);
      const sr=await providerFetch(statusUrl,{headers:{Authorization:"Key "+key},signal:mediaSignal(30000)},["fal.run","fal.ai"]);
      const st=await sr.text();try{state=JSON.parse(st)}catch{state={raw:st}}
      if(!sr.ok)throw new Error("fal.ai status HTTP "+sr.status+": "+st.slice(0,500));
    }
    if(String(state?.status||"").toUpperCase()!=="COMPLETED")throw new Error("Video-ul fal.ai nu s-a finalizat în intervalul permis.");

    const rr=await providerFetch(responseUrl,{headers:{Authorization:"Key "+key},signal:mediaSignal(120000)},["fal.run","fal.ai"]);
    const rt=await rr.text();let result={};try{result=JSON.parse(rt)}catch{result={raw:rt}}
    if(!rr.ok)throw new Error("fal.ai result HTTP "+rr.status+": "+rt.slice(0,700));
    const finalVideoUrl=result?.video?.url||result?.data?.video?.url||result?.output?.video?.url||"";
    const candidate=finalVideoUrl
      ?{type:"url",value:String(finalVideoUrl)}
      :findMediaCandidate(result,"video");
    if(!candidate)throw new Error("fal.ai a finalizat fără URL video.");
    const resolved=await resolveGeneratedMedia(candidate,"video");
    return {...resolved,model,provider:"fal-video-direct"};
  }

  async function directReplicateVideo(cfg,prompt,duration,aspectRatio){
    const key=String(cfg.replicateApiToken||"").trim();if(!key)return null;
    const model=String(cfg.replicateVideoModel||"wan-video/wan-2.2-t2v-fast").trim();
    const parts=model.split("/").filter(Boolean);if(parts.length<2)throw new Error("Modelul Replicate trebuie să fie owner/model.");
    const endpoint="https://api.replicate.com/v1/models/"+encodeURIComponent(parts[0])+"/"+encodeURIComponent(parts.slice(1).join("/"))+"/predictions";
    const request=async scheme=>fetch(endpoint,{
      method:"POST",
      headers:{"Content-Type":"application/json",Authorization:scheme+" "+key,Prefer:"wait=60"},
      body:JSON.stringify({input:{prompt}}),
      signal:mediaSignal(90000)
    });
    let r=await request("Bearer");if(r.status===401){await cancelBody(r);r=await request("Token");}
    const text=await r.text();let state={};try{state=JSON.parse(text)}catch{state={raw:text}}
    if(!r.ok)throw new Error("HTTP "+r.status+": "+text.slice(0,700));
    let candidate=findMediaCandidate(state,"video");
    if(candidate){const resolved=await resolveGeneratedMedia(candidate,"video");return {...resolved,model,provider:"replicate-video-direct"}}
    const id=String(state?.id||"").trim(),getUrl=String(state?.urls?.get||"").trim();
    if(!id&&!getUrl)throw new Error("Replicate nu a returnat ID de predicție video.");
    const deadline=Date.now()+8*60*1000;
    while(Date.now()<deadline){
      const status=String(state?.status||"").toLowerCase();
      if(/failed|canceled|cancelled/.test(status))throw new Error("Replicate: "+String(state?.error||status));
      candidate=findMediaCandidate(state,"video");
      if(candidate){const resolved=await resolveGeneratedMedia(candidate,"video");return {...resolved,model,provider:"replicate-video-direct"}}
      await mediaSleep(4000);
      const pollUrl=getUrl||("https://api.replicate.com/v1/predictions/"+encodeURIComponent(id));
      let pr=await providerFetch(pollUrl,{headers:{Authorization:"Bearer "+key},signal:mediaSignal(20000)},["api.replicate.com"]);
      if(pr.status===401){await cancelBody(pr);pr=await providerFetch(pollUrl,{headers:{Authorization:"Token "+key},signal:mediaSignal(20000)},["api.replicate.com"]);}
      const pt=await pr.text();try{state=JSON.parse(pt)}catch{state={raw:pt}}
      if(!pr.ok)throw new Error("Replicate video status HTTP "+pr.status+": "+pt.slice(0,500));
    }
    throw new Error("Replicate nu a finalizat videoclipul în intervalul permis.");
  }

  // OpenAI Sora: create the job, poll it, then download /content (the file comes with the API key, not as a public URL).
  async function directOpenAiVideo(cfg,prompt,duration,aspectRatio){
    const key=String(cfg.openAiApiKey||"").trim();if(!key)return null;
    const model=String(cfg.openAiVideoModel||"sora-2").trim().replace(/^openai\//i,"");
    const seconds=[4,8,12].sort((a,b)=>Math.abs(a-Number(duration||4))-Math.abs(b-Number(duration||4)))[0];
    const size=String(aspectRatio)==="9:16"?"720x1280":"1280x720";
    const headers={"Content-Type":"application/json",Authorization:`Bearer ${key}`};
    const submit=await fetch("https://api.openai.com/v1/videos",{method:"POST",headers,body:JSON.stringify({model,prompt:String(prompt).slice(0,4000),seconds:String(seconds),size}),signal:mediaSignal(60000)});
    const text=await submit.text();let job={};try{job=JSON.parse(text)}catch{}
    if(!submit.ok)throw new Error("HTTP "+submit.status+": "+text.slice(0,700));
    const id=String(job?.id||"").trim();if(!id)throw new Error("OpenAI nu a returnat ID-ul videoclipului.");
    const deadline=Date.now()+10*60*1000;
    while(Date.now()<deadline){
      const status=String(job?.status||"").toLowerCase();
      if(status==="completed"){
        const file=await providerFetch("https://api.openai.com/v1/videos/"+encodeURIComponent(id)+"/content",{headers:{Authorization:`Bearer ${key}`},signal:mediaSignal(180000)},["api.openai.com"]);
        const resolved=await fetchBinaryOrCandidate(file,"video");
        return {...resolved,model:`openai/${model}`,provider:"openai-video-direct"};
      }
      if(["failed","cancelled","canceled","expired"].includes(status))throw new Error("OpenAI Sora: "+String(job?.error?.message||status));
      await mediaSleep(5000);
      const r=await fetch("https://api.openai.com/v1/videos/"+encodeURIComponent(id),{headers:{Authorization:`Bearer ${key}`},signal:mediaSignal(20000)});
      const st=await r.text();try{job=JSON.parse(st)}catch{job={status:"unknown"}}
      if(!r.ok)throw new Error("OpenAI Sora status HTTP "+r.status+": "+st.slice(0,500));
    }
    throw new Error("OpenAI Sora nu a finalizat videoclipul în intervalul permis.");
  }
  // Grok Imagine Video (xAI): start with /v1/videos/generations, poll /v1/videos/{request_id} until "done".
  async function directXaiVideo(cfg,prompt,duration,aspectRatio){
    const key=String(cfg.xaiApiKey||"").trim();if(!key)return null;
    const model=String(cfg.xaiVideoModel||"grok-imagine-video").trim().replace(/^(xai|x-ai)\//i,"");
    const headers={"Content-Type":"application/json",Authorization:`Bearer ${key}`};
    const submit=await fetch("https://api.x.ai/v1/videos/generations",{method:"POST",headers,body:JSON.stringify({model,prompt:String(prompt).slice(0,4000),duration:Math.max(1,Math.min(15,Number(duration||5))),aspect_ratio:String(aspectRatio||"16:9")}),signal:mediaSignal(60000)});
    const text=await submit.text();let job={};try{job=JSON.parse(text)}catch{}
    if(!submit.ok)throw new Error("HTTP "+submit.status+": "+text.slice(0,700));
    const id=String(job?.request_id||job?.id||"").trim();if(!id)throw new Error("xAI nu a returnat ID-ul cererii video.");
    const deadline=Date.now()+10*60*1000;let state=job;
    while(Date.now()<deadline){
      const status=String(state?.status||"").toLowerCase();
      const url=state?.video?.url||state?.url||state?.data?.[0]?.url||"";
      if(url&&(status==="done"||status==="completed"||!status)){
        const resolved=await resolveGeneratedMedia({type:"url",value:String(url)},"video");
        return {...resolved,model:`xai/${model}`,provider:"xai-video-direct"};
      }
      if(["failed","expired","error","cancelled","canceled"].includes(status))throw new Error("Grok Imagine: "+String(state?.error?.message||state?.error||status));
      await mediaSleep(5000);
      const r=await fetch("https://api.x.ai/v1/videos/"+encodeURIComponent(id),{headers:{Authorization:`Bearer ${key}`},signal:mediaSignal(20000)});
      const st=await r.text();try{state=JSON.parse(st)}catch{state={status:"unknown"}}
      if(!r.ok)throw new Error("Grok Imagine status HTTP "+r.status+": "+st.slice(0,500));
    }
    throw new Error("Grok Imagine nu a finalizat videoclipul în intervalul permis.");
  }

  function videoProviderOrder(cfg){
    const known=["pollinations","openrouter","gemini","fal","replicate","openai","xai"];
    const configured=String(cfg.videoProviderOrder||known.join(",")).split(",").map(x=>x.trim().toLowerCase()).filter(x=>known.includes(x));
    const base=[...new Set([...configured,...known])];
    if(cfg.videoMode==="quality")return ["gemini","openai","xai","openrouter","fal","replicate","pollinations"];
    if(cfg.videoMode==="fast")return ["pollinations","openrouter","xai","fal","replicate","gemini","openai"];
    return base;
  }
  async function directVideoAttempts(cfg,prompt,duration,aspectRatio){
    const strictFree=cfg.videoCostPolicy!=="allow_paid"||cfg.videoMode==="free";
    const openRouterModel=String(cfg.openRouterVideoModel||"bytedance/seedance-2.0-fast").trim();
    const pollinationsModel=String(cfg.pollinationsVideoModel||"google/veo-3.1-fast").trim();
    const [orFree,pollFree]=strictFree?await Promise.all([openRouterVideoIsFree(cfg,openRouterModel),pollinationsVideoIsFree(cfg,pollinationsModel)]):[true,true];
    const defs={
      pollinations:{label:"Pollinations",configured:!!String(cfg.pollinationsApiKey||"").trim(),paidRisk:!pollFree,run:()=>directPollinationsVideo(cfg,prompt,duration)},
      openrouter:{label:"OpenRouter",configured:!!directOpenRouterKey(cfg),paidRisk:!orFree,run:()=>directOpenRouterVideo(cfg,prompt,duration,aspectRatio)},
      gemini:{label:"Gemini Veo",configured:!!String(cfg.geminiApiKey||"").trim(),paidRisk:true,run:()=>directGeminiVideo(cfg,prompt,duration,aspectRatio)},
      fal:{label:"fal.ai",configured:!!String(cfg.falApiKey||"").trim(),paidRisk:true,run:()=>directFalVideo(cfg,prompt,duration,aspectRatio)},
      replicate:{label:"Replicate",configured:!!String(cfg.replicateApiToken||"").trim(),paidRisk:true,run:()=>directReplicateVideo(cfg,prompt,duration,aspectRatio)},
      openai:{label:"OpenAI Sora",configured:!!String(cfg.openAiApiKey||"").trim(),paidRisk:true,run:()=>directOpenAiVideo(cfg,prompt,duration,aspectRatio)},
      xai:{label:"Grok Imagine (xAI)",configured:!!String(cfg.xaiApiKey||"").trim(),paidRisk:true,run:()=>directXaiVideo(cfg,prompt,duration,aspectRatio)}
    };
    return videoProviderOrder(cfg).map(id=>({id,...defs[id]})).filter(x=>x.configured&&(!strictFree||!x.paidRisk));
  }

  async function saveGeneratedMedia(req,{bytes,mime,kind,prompt,model,provider}){
    const id=crypto.randomUUID(),ext=mediaExtFromMime(mime,kind);
    const base=safeGeneratedName((kind==="image"?"Imagine AI Stoica":"Video AI Stoica")+" - "+String(prompt||"").slice(0,55)).replace(/\.[^.]+$/,"");
    const name=(base||`AI Stoica ${kind}`)+"."+ext,target=path.join(filesDir,id+"."+ext);
    await fs.promises.writeFile(target,bytes);
    const db=store.read(),item={id,userId:req.user.id,name,mime,size:bytes.length,kind,filePath:target,storage:"disk",source:kind==="image"?"ai-image":"ai-video",prompt:String(prompt||"").slice(0,2000),model:String(model||""),provider:String(provider||""),createdAt:Date.now()};
    db.library.push(item);store.write(db);
    return {id:item.id,name:item.name,mimeType:item.mime,size:item.size,kind:item.kind,source:item.source,model:item.model,provider:item.provider,createdAt:item.createdAt};
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
    const alreadyScoped=["openai","anthropic","google","gemini","cerebras","groq","cloudflare","openrouter","@cf","xai"].includes(first);
    const policyId=provider&&!alreadyScoped?`${provider}/${id}`:id;
    return {entry,id,provider,policyId};
  }
  async function mediaCatalog(cfg,kind){
    const base=String(cfg.baseUrl).replace(/\/+$/,""),headers=cfg.apiKey?{Authorization:`Bearer ${cfg.apiKey}`}:{};
    const rows=[];
    try{
      const r=await fetch(`${base}/models`,{headers,signal:mediaSignal(7000)});
      if(r.ok){
        const data=await r.json(),items=Array.isArray(data)?data:(Array.isArray(data?.data)?data.data:[]);
        for(const entry of items){const row=mediaModelRow(entry,kind,false);if(row)rows.push(row)}
      }
    }catch{}
    try{
      const endpoint=kind==="image"?"/images/generations":"/videos/generations";
      const r=await fetch(base+endpoint,{headers,signal:mediaSignal(5000)});
      if(r.ok){
        const data=await r.json(),items=Array.isArray(data)?data:(Array.isArray(data?.data)?data.data:[]);
        for(const entry of items){const row=mediaModelRow(entry,kind,true);if(row)rows.push(row)}
      }
    }catch{}
    const seen=new Set();
    return rows.filter(row=>{const k=row.id.toLowerCase();if(seen.has(k))return false;seen.add(k);return true});
  }
  // Poză / Video stay on the model that worked for this account: it is tried first next time (other models only if it
  // fails). Changing the image / video settings (model, providers, order, cost) starts over from those settings.
  const mediaPrefsFile=path.join(dataDir,"media-prefs.json");
  let mediaPrefs={};try{mediaPrefs=JSON.parse(fs.readFileSync(mediaPrefsFile,"utf8"))||{}}catch{}
  const configuredMedia=(cfg,kind)=>JSON.stringify(kind==="image"
    ?[cfg.imageModel,cfg.imageProviderOrder,cfg.imageProviderMode,cfg.imageCostPolicy]
    :[cfg.videoModel,cfg.videoProviderOrder,cfg.videoMode,cfg.videoCostPolicy]).replace(/null/g,'""');
  function mediaPref(req,cfg,kind){
    const p=mediaPrefs[req.user?.id]?.[kind];
    return p&&p.configured===configuredMedia(cfg,kind)?String(p.id||""):"";
  }
  function rememberMedia(req,cfg,kind,id){
    const uid=req.user?.id;if(!uid||!id)return;
    const entry={id:String(id).slice(0,200),configured:configuredMedia(cfg,kind)};
    const cur=mediaPrefs[uid]?.[kind];
    if(cur&&cur.id===entry.id&&cur.configured===entry.configured)return;
    mediaPrefs={...mediaPrefs,[uid]:{...(mediaPrefs[uid]||{}),[kind]:entry}};
    try{fs.writeFileSync(mediaPrefsFile,JSON.stringify(mediaPrefs))}catch{}
  }
  // Images through your ChatGPT subscription (OmniRoute's Codex / ChatGPT Web connections) or Gemini Web, and the
  // free web video providers, come before the free no-key providers and the paid APIs.
  function subscriptionMedia(kind,id){
    const v=String(id||"");
    return kind==="image"?/^(codex|cx|chatgpt-web|cgpt-web|gemini-web|gweb)\//i.test(v):/^(veoaifree-web|veo-free)\//i.test(v);
  }
  // The media models to try, in the given order, each once: a name is an OmniRoute model (when discovery found it) or
  // the id of a direct-API attempt; an attempt object is a direct API.
  function mediaSteps(found,direct,order){
    const steps=[],seen=new Set();
    for(const item of order){
      if(!item)continue;
      if(typeof item==="object"){if(!seen.has("d:"+item.id)){seen.add("d:"+item.id);steps.push({key:item.id,direct:item})}continue;}
      if(found.includes(item)&&!seen.has("o:"+item)){seen.add("o:"+item);steps.push({key:"omniroute:"+item,omni:item})}
      for(const a of direct)if(a.id===item&&!seen.has("d:"+a.id)){seen.add("d:"+a.id);steps.push({key:a.id,direct:a})}
    }
    return steps;
  }
  function localPaidHint(row){
    const p=String(row?.provider||inferProvider(row?.policyId||row?.id)||"").toLowerCase();
    return ["openai","anthropic","openrouter","runway"].includes(p)||/^(openai|anthropic|openrouter|runway)\//i.test(String(row?.policyId||row?.id||""));
  }
  async function discoverPermittedMediaModels(req,cfg,kind,explicitModel=""){
    const explicit=String(explicitModel||"").trim();
    if(explicit){
      await requireModelAccess(req.cloudToken,explicit);
      if(!cloudBase()&&kind==="image"&&(cfg.imageCostPolicy==="free_only"||cfg.imageProviderMode==="free")&&localPaidHint({id:explicit}))throw policyFailure("Protecția «Doar gratuit» este activă, iar modelul ales poate genera costuri.",403);
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
      const strictFree=kind==="image"&&(cfg.imageCostPolicy==="free_only"||cfg.imageProviderMode==="free");
      const localRows=strictFree?rows.filter(row=>!localPaidHint(row)):rows;
      localRows.sort((a,b)=>{
        const configuredBoost=Number(b.id===configured)-Number(a.id===configured);
        if(configuredBoost)return configuredBoost;
        const subscriptionBoost=Number(subscriptionMedia(kind,b.id))-Number(subscriptionMedia(kind,a.id));
        if(subscriptionBoost)return subscriptionBoost;
        return Number(localPaidHint(a))-Number(localPaidHint(b));
      });
      if(strictFree&&!localRows.length)throw policyFailure("Protecția «Doar gratuit» este activă și OmniRoute nu are un model de imagine gratuit identificat.",403);
      return localRows.map(x=>x.id);
    }

    const policy=await cloudModelPolicy(req.cloudToken,rows.map(x=>x.policyId));
    const decisions=new Map(policy.data.map(x=>[String(x.model),x]));
    const isOwner=(req.cloudUser?.role||req.user?.role)==="owner";
    const strictFree=kind==="image"&&(cfg.imageCostPolicy==="free_only"||cfg.imageProviderMode==="free");
    const allowed=rows
      .map((row,index)=>({row,index,decision:decisions.get(row.policyId)}))
      .filter(x=>x.decision?.allowed)
      .filter(x=>!strictFree||!(x.decision?.paidRequired===true||localPaidHint(x.row)))
      .sort((a,b)=>{
        const ac=Number(a.row.id===configured),bc=Number(b.row.id===configured);
        if(isOwner&&ac!==bc)return bc-ac;
        const as=Number(subscriptionMedia(kind,a.row.id)),bs=Number(subscriptionMedia(kind,b.row.id));
        if(as!==bs)return bs-as;
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

  const IMAGE_SIZES=new Set(["256x256","512x512","768x768","1024x1024","1024x1536","1536x1024","1024x1792","1792x1024"]);
  function mediaRequest(req,kind){
    const prompt=typeof req.body?.prompt==="string"?req.body.prompt.trim():"";
    if(!prompt)throw policyFailure(kind==="image"?"Descrierea imaginii lipsește.":"Descrierea videoclipului lipsește.",400);
    if(prompt.length>4000)throw policyFailure("Descrierea poate avea cel mult 4000 de caractere.",400);
    const model=typeof req.body?.model==="string"?req.body.model.trim().slice(0,200):"";
    const size=IMAGE_SIZES.has(String(req.body?.size||""))?String(req.body.size):"1024x1024";
    const d=Number(req.body?.duration);
    const duration=Number.isFinite(d)?Math.max(1,Math.min(10,Math.round(d))):4;
    const aspectRatio=["16:9","9:16","1:1"].includes(String(req.body?.aspectRatio||""))?String(req.body.aspectRatio):"16:9";
    return {prompt,model,size,duration,aspectRatio};
  }
  // The work stops (and nothing is saved) when the user cancels and the request closes.
  function clientAbortSignal(res){const c=new AbortController();res.on("close",()=>{if(!res.writableFinished)c.abort()});return c.signal;}

  app.post("/api/generate/image", auth, async (req,res) => {
    const signal=clientAbortSignal(res);
    await mediaAbort.run(signal,async()=>{
    try{
      requireFeaturePermission(req,"image_generation");
      const {prompt,model:explicitModel,size}=mediaRequest(req,"image");
      const cfg=getOmniConfig(),errors=[];
      const strictFree=cfg.imageCostPolicy==="free_only"||cfg.imageProviderMode==="free";
      const done=async(resolved,meta)=>{if(signal.aborted)return true;res.json({data:await saveGeneratedMedia(req,{...resolved,kind:"image",prompt,...meta})});return true;};

      const runDirect=async(attempts)=>{
        for(const attempt of byCooldown("image",attempts)){
          if(signal.aborted)return true;
          try{
            const resolved=await attempt.run();
            if(resolved?.bytes?.length){noteProviderResult("image",attempt.id,"");rememberMedia(req,cfg,"image",attempt.id);if(await done(resolved,{model:resolved.model||attempt.label,provider:resolved.provider||attempt.id}))return true;}
          }catch(e){if(signal.aborted)return true;const msg=roError(e);noteProviderResult("image",attempt.id,msg);errors.push(attempt.label+": "+msg)}
        }
        return false;
      };
      const direct=directApisAllowed(req)&&!explicitModel?await directImageAttempts(cfg,prompt,size):[];
      // An image model chosen in Settings is tried before the no-key Pollinations fallback.
      const late=String(cfg.imageModel||"").trim()?direct.filter(a=>a.id==="pollinations-free"):[];
      if(explicitModel)requirePersonalAccess(req,explicitModel);
      let found=[];
      try{found=await discoverPermittedMediaModels(req,cfg,"image",explicitModel)}
      catch(e){if(e.status===403&&explicitModel)throw e;errors.push("OmniRoute: "+(e.status?e.message:roError(e)))}
      if(!personalAllowed(req.user,req.cloudUser))found=found.filter(m=>!PERSONAL_PROVIDERS.test(m));
      const models=found.slice(0,4);
      const imageUrl=String(cfg.baseUrl).replace(/\/+$/,"")+"/images/generations";
      const imageHeaders={"Content-Type":"application/json",...(cfg.apiKey?{Authorization:"Bearer "+cfg.apiKey}:{})};
      const runOmni=async(list)=>{
        for(const model of byCooldown("image",list,m=>"omniroute:"+m)){
          if(signal.aborted)return true;
          try{
            let upstream=await fetch(imageUrl,{method:"POST",headers:imageHeaders,body:JSON.stringify({model,prompt,size,n:1,response_format:"b64_json"}),signal:mediaSignal(180000)});
            if(!upstream.ok&&[400,404,405,409,422].includes(upstream.status)){
              await cancelBody(upstream);
              upstream=await fetch(imageUrl,{method:"POST",headers:imageHeaders,body:JSON.stringify({model,prompt,size,n:1}),signal:mediaSignal(180000)});
            }
            const ctype=upstream.headers.get("content-type")||"";
            if(!upstream.ok){const msg="HTTP "+upstream.status+" "+(await upstream.text()).slice(0,350);noteProviderResult("image","omniroute:"+model,msg);errors.push(model+": "+msg);continue}
            noteProviderResult("image","omniroute:"+model,"");
            let resolved;
            if(ctype.startsWith("image/")){const bytes=await readCapped(upstream,"image");resolved={bytes,mime:inferMediaMime(bytes,ctype,"image")};}
            else{const body=JSON.parse((await readCapped(upstream,"image")).toString("utf8")),candidate=findMediaCandidate(body,"image");resolved=await resolveGeneratedMedia(candidate,"image");}
            if(!resolved.bytes.length){errors.push(model+": imagine goală");continue}
            rememberMedia(req,cfg,"image",model);
            if(await done(resolved,{model,provider:"omniroute"}))return true;
          }catch(e){if(signal.aborted)return true;errors.push(model+": "+roError(e))}
        }
        return false;
      };
      // Order: the image model chosen in Settings, the model bound to this account, the subscription models (ChatGPT /
      // Gemini through OmniRoute), the direct APIs, OmniRoute's other models, the no-key fallback. A provider out of
      // credits goes to the end of the whole list (it is still tried, last).
      const steps=mediaSteps(found,direct,[
        explicitModel?"":String(cfg.imageModel||"").trim(),explicitModel?"":mediaPref(req,cfg,"image"),
        ...models.filter(m=>subscriptionMedia("image",m)),...direct.filter(a=>!late.includes(a)),...models,...late
      ]);
      for(const step of byCooldown("image",steps,x=>x.key)){
        if(step.omni?await runOmni([step.omni]):await runDirect([step.direct]))return;
      }

      const configuredProviders=[
        cfg.cloudflareAccountId&&cfg.cloudflareApiToken&&"Cloudflare",cfg.pollinationsApiKey&&"Pollinations",cfg.hfToken&&"Hugging Face",cfg.togetherApiKey&&"Together AI",
        cfg.openAiApiKey&&"OpenAI",directOpenRouterKey(cfg)&&"OpenRouter",cfg.stabilityApiKey&&"Stability AI",cfg.falApiKey&&"fal.ai",cfg.replicateApiToken&&"Replicate"
      ].filter(Boolean);
      const providerHint=!configuredProviders.length
        ?" Nu există nicio cheie de imagine configurată; adaugă cel puțin un provider în Setări > AI & OmniRoute > Providere imagini."
        :strictFree
          ?" Protecția «Doar gratuit» este activă; providerii cu cost sau cost necunoscut nu sunt apelați. Pentru ei trebuie să alegi explicit «Permite provideri cu plată»."
          :"";
      throw policyFailure(("Generarea imaginii nu a produs un fișier real."+providerHint+" "+errors.slice(0,10).join(" | ")).trim(),502);
    }catch(e){if(!signal.aborted)sendError(res,e)}
    });
  });

  const VIDEO_NEEDS_PROVIDER="Pentru video e nevoie de o cheie la Pollinations, fal.ai, Replicate sau Gemini (Veo) și de permisiunea pentru costuri din Setări → Video. Nu există în prezent un API video gratuit.";
  app.post("/api/generate/video", auth, async (req,res) => {
    const signal=clientAbortSignal(res);
    await mediaAbort.run(signal,async()=>{
    try{
      requireFeaturePermission(req,"video_generation");
      const {prompt,model:explicitModel,duration,aspectRatio}=mediaRequest(req,"video");
      const cfg=getOmniConfig(),errors=[];
      const strictFree=directApisAllowed(req)&&(cfg.videoCostPolicy!=="allow_paid"||cfg.videoMode==="free");
      const done=async(resolved,meta)=>{if(signal.aborted)return true;res.json({data:await saveGeneratedMedia(req,{...resolved,kind:"video",prompt,...meta})});return true;};

      if(explicitModel)requirePersonalAccess(req,explicitModel);
      const attempts=directApisAllowed(req)&&!explicitModel?await directVideoAttempts(cfg,prompt,duration,aspectRatio):[];
      // «Doar gratuit» keeps the paid OmniRoute video models out, but not the free web ones (veoaifree-web: VEO 3.1,
      // Seedance), which OmniRoute serves without a key or cost.
      let found=[];
      try{found=await discoverPermittedMediaModels(req,cfg,"video",explicitModel)}
      catch(e){if(e.status===403&&explicitModel)throw e;errors.push("OmniRoute: "+(e.status?e.message:roError(e)))}
      if(strictFree)found=found.filter(m=>subscriptionMedia("video",m));
      const models=found.slice(0,3);
      // Order: the video model chosen in Settings, the model bound to this account, the free web models, the direct
      // APIs, OmniRoute's other models; a provider out of credits goes to the end of the whole list.
      const steps=mediaSteps(found,attempts,[
        explicitModel?"":String(cfg.videoModel||"").trim(),explicitModel?"":mediaPref(req,cfg,"video"),
        ...models.filter(m=>subscriptionMedia("video",m)),...attempts,...models
      ]);
      const tried=steps.length;
      const videoUrl=String(cfg.baseUrl).replace(/\/+$/,"")+"/videos/generations";
      const videoHeaders={"Content-Type":"application/json",...(cfg.apiKey?{Authorization:"Bearer "+cfg.apiKey}:{})};
      for(const step of byCooldown("video",steps,x=>x.key)){
        if(signal.aborted)return;
        if(step.direct){
          const attempt=step.direct;
          try{
            const resolved=await attempt.run();
            if(resolved?.bytes?.length){noteProviderResult("video",attempt.id,"");rememberMedia(req,cfg,"video",attempt.id);if(await done(resolved,{model:resolved.model||attempt.label,provider:resolved.provider||attempt.id}))return;}
          }catch(e){if(signal.aborted)return;const msg=roError(e);noteProviderResult("video",attempt.id,msg);errors.push(attempt.label+": "+msg)}
          continue;
        }
        const model=step.omni;
        try{
          let upstream=await fetch(videoUrl,{method:"POST",headers:videoHeaders,body:JSON.stringify({model,prompt,duration,aspect_ratio:aspectRatio}),signal:mediaSignal(360000)});
          if(!upstream.ok&&[400,404,405,409,422].includes(upstream.status)){
            await cancelBody(upstream);
            upstream=await fetch(videoUrl,{method:"POST",headers:videoHeaders,body:JSON.stringify({model,prompt}),signal:mediaSignal(360000)});
          }
          const ctype=upstream.headers.get("content-type")||"";
          if(!upstream.ok){const msg="HTTP "+upstream.status+" "+(await upstream.text()).slice(0,350);noteProviderResult("video","omniroute:"+model,msg);errors.push(model+": "+msg);continue}
          let resolved;
          if(ctype.startsWith("video/")){const bytes=await readCapped(upstream,"video");resolved={bytes,mime:inferMediaMime(bytes,ctype,"video")};}
          else{const body=JSON.parse((await readCapped(upstream,"image")).toString("utf8"));const candidate=await pollVideoResult(cfg,body);resolved=await resolveGeneratedMedia(candidate,"video");}
          if(!resolved.bytes.length){errors.push(model+": video gol");continue}
          noteProviderResult("video","omniroute:"+model,"");
          rememberMedia(req,cfg,"video",model);
          if(await done(resolved,{model,provider:"omniroute"}))return;
        }catch(e){if(signal.aborted)return;errors.push(model+": "+roError(e))}
      }

      if(!tried&&directApisAllowed(req))throw policyFailure(VIDEO_NEEDS_PROVIDER,400);
      const configuredProviders=[
        cfg.pollinationsApiKey&&"Pollinations",directOpenRouterKey(cfg)&&"OpenRouter",cfg.geminiApiKey&&"Gemini Veo",cfg.falApiKey&&"fal.ai",cfg.replicateApiToken&&"Replicate"
      ].filter(Boolean);
      const hint=!configuredProviders.length
        ?" Nu există nicio cheie video configurată în Setări > Video."
        :strictFree
          ?" Protecția «Doar gratuit» este activă: AI Stoica pornește doar modelele web gratuite din OmniRoute (VEO 3.1, Seedance) și joburile al căror cost $0 îl poate confirma din catalogul providerului."
          :"";
      throw policyFailure(("Generarea videoclipului nu a produs un fișier MP4 real."+hint+" "+errors.slice(0,10).join(" | ")).trim(),502);
    }catch(e){if(!signal.aborted)sendError(res,e)}
    });
  });

  function publicPlugin(item){
    const {apiKey,accessToken,refreshToken,oauthClientSecret,...safe}=item||{};
    return {...safe,hasKey:!!apiKey,oauthConnected:!!item?.oauthConnected};
  }
  // Refreshes an expired OAuth access token with the saved refresh token (Google tokens last one hour).
  async function refreshOAuthPlugin(plugin){
    const p=pluginWithSecrets(plugin);
    if(!p.refreshToken||!p.oauthTokenUrl)return null;
    const headers={"Content-Type":"application/x-www-form-urlencoded","Accept":"application/json"};
    let body;
    if(p.oauthProvider==="notion"){
      headers["Content-Type"]="application/json";headers.Authorization="Basic "+Buffer.from(`${p.oauthClientId||""}:${p.oauthClientSecret||""}`).toString("base64");
      body=JSON.stringify({grant_type:"refresh_token",refresh_token:p.refreshToken});
    }else{
      const form=new URLSearchParams({grant_type:"refresh_token",refresh_token:p.refreshToken,client_id:p.oauthClientId||""});
      if(p.oauthClientSecret)form.set("client_secret",p.oauthClientSecret);
      body=form.toString();
    }
    const r=await safeRequest(p.oauthTokenUrl,{method:"POST",headers,body,timeout:15000,maxBytes:256*1024});
    let token={};try{token=await r.json()}catch{}
    if(!r.ok||!token.access_token)return null;
    const db=store.read(),target=db.plugins.find(x=>x.id===plugin.id);if(!target)return null;
    target.accessToken=sealSecret(String(token.access_token));
    if(token.refresh_token)target.refreshToken=sealSecret(String(token.refresh_token));
    target.tokenExpiresAt=token.expires_in?Date.now()+Number(token.expires_in)*1000:null;
    store.write(db);
    return pluginWithSecrets(target);
  }
  async function callOAuthPlugin(plugin,message,allowRefresh=true){
    let p=plugin;
    if(allowRefresh&&p.tokenExpiresAt&&Date.now()>Number(p.tokenExpiresAt)-60000){const fresh=await refreshOAuthPlugin(p).catch(()=>null);if(fresh)p=fresh;}
    let url=p.url,method=(p.method||"GET").toUpperCase(),body=null;
    const provider=String(p.oauthProvider||"");
    if(provider==="google"){const u=new URL(url);if(message)u.searchParams.set("q",String(message).slice(0,250));url=u.toString();}
    else if(provider==="google-calendar"){const u=new URL(url);u.searchParams.set("timeMin",new Date().toISOString());if(message)u.searchParams.set("q",String(message).slice(0,250));url=u.toString();}
    else if(provider==="notion"){method="POST";body=JSON.stringify({page_size:20,...(message?{query:String(message).slice(0,100)}:{})});}
    const r=await safeRequest(url,{method,headers:pluginHeaders(p),body,timeout:12000,maxBytes:2*1024*1024,truncate:true,...pluginNetwork()});
    const text=await r.text();
    if(r.status===401){
      if(allowRefresh){const fresh=await refreshOAuthPlugin(p).catch(()=>null);if(fresh)return callOAuthPlugin(fresh,message,false);}
      throw new Error("Conexiunea OAuth a expirat sau a fost revocată. Reconectează pluginul.");
    }
    if(!r.ok)throw new Error(`HTTP ${r.status}: ${text.slice(0,500)}`);
    try{return JSON.stringify(JSON.parse(text))}catch{return text}
  }
  // Plugin addresses are fetched through safeRequest. On a public server (apps/cloud) local and private networks are
  // refused; on the desktop app the PC's own services (n8n, Home Assistant, Ollama on the LAN) keep working.
  // cfg.allowPrivatePlugins overrides the default either way.
  function pluginNetwork(){const allow=getOmniConfig()?.allowPrivatePlugins;return (allow??loopbackHost)===true?{isBlocked:()=>false}:{};}
  async function callPlugin(stored,message){
    const plugin=pluginWithSecrets(stored);
    if(plugin.mode==="direct_app")return JSON.stringify({mode:"direct_app",name:plugin.name,appUrl:plugin.appUrl||plugin.url,message:"Plugin configurat pentru deschidere directă. Nu este necesar OAuth pentru lansarea aplicației."});
    if(plugin.oauthConnected&&plugin.accessToken)return callOAuthPlugin(plugin,message);
    const method=PLUGIN_METHODS.includes(String(plugin.method||"POST").toUpperCase())?String(plugin.method||"POST").toUpperCase():"POST";
    let url=plugin.url,body=null;
    if(method==="GET"){const u=new URL(url);u.searchParams.set("q",String(message||"").slice(0,1500));url=u.toString();}
    else body=JSON.stringify({message:String(message||"").slice(0,20000),source:"AI Stoica",plugin:plugin.name});
    const r=await safeRequest(url,{method,headers:pluginHeaders(plugin),body,timeout:12000,maxBytes:2*1024*1024,truncate:true,...pluginNetwork()});
    const text=await r.text();
    if(!r.ok)throw new Error(`HTTP ${r.status}: ${text.slice(0,300)}`);
    try{return JSON.stringify(JSON.parse(text))}catch{return text}
  }
  // C2: besides @trigger and "auto", an enabled plugin runs when its name appears as a whole word (max 3 per message).
  async function pluginContext(db,userId,latestText){
    const mine=db.plugins.filter(p=>p.userId===userId&&p.enabled!==false&&p.url);
    const explicit=mine.filter(p=>p.auto||triggerMatches(latestText,p.trigger||`@${String(p.name||"").toLowerCase().replace(/\s+/g,"-")}`));
    const named=mine.filter(p=>!explicit.includes(p)&&nameMentioned(latestText,p.name)).slice(0,3);
    const enabled=[...explicit,...named].slice(0,8);
    return Promise.all(enabled.map(async p=>{
      try{return `Plugin ${p.name}: ${String(await callPlugin(p,latestText)).slice(0,12000)}`}
      catch(e){return `Plugin ${p.name} a eșuat: ${e.code==="EBLOCKED"?e.message:roError(e)}`}
    }));
  }

  const PLUGIN_METHODS=["GET","POST","PUT","PATCH"];
  function pluginFields(body,prev){
    const out={};
    if(!prev||has(body,"name")){const v=textInput(body.name,80);if(!v)return {error:v===null?"Numele pluginului poate avea cel mult 80 de caractere.":"Numele și URL-ul sunt obligatorii."};out.name=v;}
    if(has(body,"description")){const v=textInput(body.description,500);if(v===null)return {error:"Descrierea pluginului poate avea cel mult 500 de caractere."};out.description=v;}
    if(!prev||has(body,"url")){
      const v=textInput(body.url,2000);if(!v)return {error:v===null?"URL-ul pluginului este prea lung.":"Numele și URL-ul sunt obligatorii."};
      let u;try{u=new URL(v)}catch{return {error:"URL-ul pluginului nu este valid."}}
      if(!["http:","https:"].includes(u.protocol))return {error:"URL-ul pluginului trebuie să înceapă cu http:// sau https://."};
      out.url=u.toString();if(prev?.mode==="direct_app")out.appUrl=out.url;
    }
    if(prev?.mode!=="direct_app"&&(!prev||has(body,"method"))){const m=String(body.method||"POST").toUpperCase();if(!PLUGIN_METHODS.includes(m))return {error:"Metoda HTTP a pluginului trebuie să fie GET, POST, PUT sau PATCH."};out.method=m;}
    if(!prev||has(body,"trigger")){const v=textInput(body.trigger,60);if(v===null)return {error:"Declanșatorul pluginului poate avea cel mult 60 de caractere."};out.trigger=v||`@${String(out.name||prev?.name||"").toLowerCase().replace(/\s+/g,"-")}`;}
    for(const k of ["auto","enabled"])if(has(body,k)){const v=toBool(body[k],undefined);if(typeof v!=="boolean")return {error:`Câmpul „${k}” trebuie să fie true sau false.`};out[k]=v;}
    if(!prev||has(body,"authType")){const v=String(body.authType||"bearer");if(!["bearer","header"].includes(v))return {error:"Tipul de autentificare trebuie să fie „bearer” sau „header”."};out.authType=v;}
    if(!prev||has(body,"headerName")){const v=String(body.headerName||"X-API-Key").trim();if(!/^[A-Za-z0-9-]{1,64}$/.test(v))return {error:"Numele header-ului pentru cheia API nu este valid."};out.headerName=v;}
    if(has(body,"apiKey")){
      const v=body.apiKey;
      if(v===null||v==="__CLEAR__")out.apiKey="";
      else if(typeof v!=="string"||v.length>4000)return {error:"Cheia API nu este validă."};
      else if(v.trim())out.apiKey=sealSecret(v.trim());
    }
    return {value:out};
  }

  function oauthRedirectUri(){
    const base=String(getOmniConfig().publicUrl||"").trim().replace(/\/+$/,"");
    return `${/^https?:\/\//i.test(base)?base:`http://127.0.0.1:${port}`}/api/plugins/oauth/callback`;
  }
  timers.push(setInterval(()=>{const now=Date.now();for(const [key,p] of oauthPending)if(now-p.createdAt>10*60*1000)oauthPending.delete(key);},60000));
  timers[timers.length-1].unref?.();
  app.post("/api/plugins/oauth/start", auth, requirePermission("plugins"), (req,res) => {
    try{
      const name=textInput(req.body?.name,80),provider=textInput(req.body?.provider,40);
      const clientId=textInput(req.body?.clientId,500),clientSecret=textInput(req.body?.clientSecret,2000);
      const authUrl=textInput(req.body?.authUrl,2000),tokenUrl=textInput(req.body?.tokenUrl,2000),apiUrl=textInput(req.body?.apiUrl,2000);
      if(!name||!provider||!clientId||clientSecret===null||!authUrl||!tokenUrl||!apiUrl)return res.status(400).json({error:"Configurația OAuth este incompletă."});
      for(const candidate of [authUrl,tokenUrl,apiUrl]){let u;try{u=new URL(candidate)}catch{return res.status(400).json({error:"Adresele OAuth/API nu sunt valide."})}if(u.protocol!=="https:")return res.status(400).json({error:"OAuth/API trebuie să folosească HTTPS."});}
      const method=String(req.body?.method||"GET").toUpperCase();
      if(!PLUGIN_METHODS.includes(method))return res.status(400).json({error:"Metoda HTTP a pluginului trebuie să fie GET, POST, PUT sau PATCH."});
      const state=crypto.randomBytes(24).toString("hex");
      const verifier=crypto.randomBytes(48).toString("base64url");
      const challenge=crypto.createHash("sha256").update(verifier).digest("base64url");
      const redirectUri=oauthRedirectUri();
      const u=new URL(authUrl);
      u.searchParams.set("response_type","code");
      u.searchParams.set("client_id",clientId);
      u.searchParams.set("redirect_uri",redirectUri);
      u.searchParams.set("state",state);
      const scopes=String(req.body?.scopes||"").trim().slice(0,1000);if(scopes)u.searchParams.set("scope",scopes);
      u.searchParams.set("code_challenge",challenge);u.searchParams.set("code_challenge_method","S256");
      if(provider.startsWith("google")){u.searchParams.set("access_type","offline");u.searchParams.set("prompt","consent");}
      if(provider==="notion")u.searchParams.set("owner","user");
      if(oauthPending.size>200)oauthPending.delete(oauthPending.keys().next().value);
      oauthPending.set(state,{
        userId:req.user.id,name,description:String(req.body?.description||"").slice(0,500),trigger:String(req.body?.trigger||`@${name.toLowerCase().replace(/\s+/g,"-")}`).slice(0,60),
        auto:toBool(req.body?.auto,false)===true,provider,clientId,clientSecret,authUrl,tokenUrl,apiUrl,method,
        scopes,redirectUri,verifier,createdAt:Date.now()
      });
      res.json({authorizeUrl:u.toString(),state,redirectUri});
    }catch(e){sendError(res,e,400)}
  });

  app.get("/api/plugins/oauth/callback", async (req,res) => {
    const state=String(req.query?.state||""),code=String(req.query?.code||""),oauthError=String(req.query?.error||"");
    const pending=oauthPending.get(state);oauthPending.delete(state);
    const finish=(ok,message)=>res.status(ok?200:400).type("html").send(`<!doctype html><html><head><meta charset="utf-8"><title>AI Stoica OAuth</title></head><body style="font-family:Segoe UI,Arial;background:#0b1018;color:#eef4ff;padding:40px"><h2>${ok?"AI Stoica — conectat":"AI Stoica — conexiune eșuată"}</h2><p>${String(message).replace(/[<>&"']/g,x=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&#39;"}[x]))}</p><p>Poți închide această fereastră și reveni în AI Stoica.</p></body></html>`);
    if(!pending||Date.now()-pending.createdAt>10*60*1000)return finish(false,"Sesiunea OAuth a expirat. Reîncearcă din AI Stoica.");
    if(oauthError)return finish(false,`Providerul a refuzat autorizarea: ${oauthError.slice(0,200)}`);
    if(!code)return finish(false,"Providerul nu a returnat codul de autorizare.");
    try{
      let tokenResponse;
      if(pending.provider==="notion"){
        tokenResponse=await safeRequest(pending.tokenUrl,{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Basic "+Buffer.from(`${pending.clientId}:${pending.clientSecret}`).toString("base64")},body:JSON.stringify({grant_type:"authorization_code",code,redirect_uri:pending.redirectUri}),timeout:15000,maxBytes:256*1024});
      }else{
        const form=new URLSearchParams({grant_type:"authorization_code",code,redirect_uri:pending.redirectUri,client_id:pending.clientId,code_verifier:pending.verifier});
        if(pending.clientSecret)form.set("client_secret",pending.clientSecret);
        tokenResponse=await safeRequest(pending.tokenUrl,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","Accept":"application/json"},body:form.toString(),timeout:15000,maxBytes:256*1024});
      }
      const text=await tokenResponse.text();let token={};try{token=JSON.parse(text)}catch{}
      const accessToken=String(token.access_token||token?.authed_user?.access_token||"");
      if(!tokenResponse.ok||!accessToken)throw new Error(token.error_description||token.error||`Token HTTP ${tokenResponse.status}`);
      const db=store.read();
      db.plugins=db.plugins.filter(x=>!(x.userId===pending.userId&&String(x.name).toLowerCase()===pending.name.toLowerCase()));
      const item={
        id:crypto.randomUUID(),userId:pending.userId,name:pending.name,description:pending.description,url:pending.apiUrl,method:pending.method,
        trigger:pending.trigger,auto:pending.auto,enabled:true,oauthConnected:true,oauthProvider:pending.provider,
        oauthClientId:pending.clientId,oauthClientSecret:sealSecret(pending.clientSecret),oauthTokenUrl:pending.tokenUrl,oauthScopes:pending.scopes,
        accessToken:sealSecret(accessToken),refreshToken:sealSecret(String(token.refresh_token||"")),tokenExpiresAt:token.expires_in?Date.now()+Number(token.expires_in)*1000:null,createdAt:Date.now()
      };
      db.plugins.push(item);store.write(db);
      return finish(true,`${pending.name} a fost autorizat și legat de AI Stoica.`);
    }catch(e){return finish(false,`Nu am putut finaliza OAuth: ${e.code==="EBLOCKED"?e.message:roError(e)}`)}
  });

  app.get("/api/plugins", auth, (req,res) => {const db=store.read();res.json({data:db.plugins.filter(x=>x.userId===req.user.id).map(publicPlugin)});});

  app.post("/api/plugins/direct", auth, requirePermission("plugins"), (req,res) => {
    const name=textInput(req.body?.name,80),appUrl=textInput(req.body?.appUrl,2000);
    if(!name||!appUrl)return res.status(400).json({error:"Numele și adresa aplicației sunt obligatorii."});
    try{
      const u=new URL(appUrl);
      if(!["https:","http:"].includes(u.protocol))throw new Error("protocol");
    }catch{return res.status(400).json({error:"Adresa aplicației nu este validă."})}
    const db=store.read();
    db.plugins=db.plugins.filter(x=>!(x.userId===req.user.id&&String(x.name||"").toLowerCase()===name.toLowerCase()));
    const item={
      id:crypto.randomUUID(),userId:req.user.id,name,
      description:String(req.body?.description||"Deschidere directă în aplicația oficială").slice(0,500),
      url:appUrl,appUrl,method:"OPEN",mode:"direct_app",
      trigger:String(req.body?.trigger||`@${name.toLowerCase().replace(/\s+/g,"-")}`).slice(0,60),
      auto:false,enabled:true,oauthConnected:false,createdAt:Date.now()
    };
    db.plugins.push(item);store.write(db);res.json({data:publicPlugin(item)});
  });

  app.post("/api/plugins", auth, requirePermission("plugins"), (req,res) => {
    const parsed=pluginFields(req.body||{},null);if(parsed.error)return res.status(400).json({error:parsed.error});
    const db=store.read(),item={id:crypto.randomUUID(),userId:req.user.id,description:"",auto:false,enabled:true,apiKey:"",...parsed.value,createdAt:Date.now()};
    db.plugins.push(item);store.write(db);res.json({data:publicPlugin(item)});
  });
  app.patch("/api/plugins/:id", auth, requirePermission("plugins"), (req,res) => {
    const db=store.read(),item=db.plugins.find(x=>x.id===req.params.id&&x.userId===req.user.id);if(!item)return res.status(404).json({error:"Pluginul nu a fost găsit."});
    const parsed=pluginFields(req.body||{},item);if(parsed.error)return res.status(400).json({error:parsed.error});
    Object.assign(item,parsed.value);item.updatedAt=Date.now();store.write(db);res.json({data:publicPlugin(item)});
  });
  app.post("/api/plugins/:id/test", auth, requirePermission("plugins"), async (req,res) => {
    const db=store.read(),item=db.plugins.find(x=>x.id===req.params.id&&x.userId===req.user.id);if(!item)return res.status(404).json({error:"Pluginul nu a fost găsit."});
    if(item.mode==="direct_app")return res.json({ok:true,direct:true,appUrl:item.appUrl||item.url,result:"Conexiune directă pregătită. Aplicația se deschide fără OAuth."});
    try{const result=await callPlugin(item,String(req.body?.message||"Test AI Stoica").slice(0,2000));res.json({ok:true,result:String(result).slice(0,5000)});}
    catch(e){res.status(e.status||502).json({error:e.code==="EBLOCKED"?e.message:roError(e)});}
  });
  app.delete("/api/plugins/:id", auth, (req,res) => {const db=store.read(),before=db.plugins.length;db.plugins=db.plugins.filter(x=>!(x.id===req.params.id&&x.userId===req.user.id));if(db.plugins.length===before)return res.status(404).json({error:"Pluginul nu a fost găsit."});store.write(db);res.json({ok:true});});

  // The list stays light: the run history is served separately by GET /api/automations/:id/runs.
  function publicAutomation(item){
    const {cloudToken,cloudTokenHash,runs,...safe}=item||{};
    return {...safe,enabled:safe.enabled!==false,notify:safe.notify!==false,frequency:safe.frequency||"daily",time:safe.time||"09:00",weekday:safe.weekday??1,days:Array.isArray(safe.days)?safe.days:[],monthday:safe.monthday??1,intervalHours:safe.intervalHours??1,timeZone:safe.timeZone||"",runAt:safe.runAt||null,nextRunAt:safe.nextRunAt||null,lastRunAt:safe.lastRunAt||null,lastStatus:safe.lastStatus||"created",lastResult:safe.lastResult||"",model:safe.model||""};
  }
  const RUN_STATUSES=["ok","error","no_change","needs_login","permission_denied"];
  function recordRun(target,status,model,result){
    const run={id:crypto.randomUUID(),at:Date.now(),status:RUN_STATUSES.includes(status)?status:"error",model:String(model||""),result:String(result||"").slice(0,4000)};
    target.runs=[run,...(Array.isArray(target.runs)?target.runs:[])].slice(0,20);
    return run;
  }
  function runFailureStatus(e){return e?.status===401?"needs_login":e?.status===403&&/dezactivat|nu este permis|nepermis|Owner/i.test(String(e?.message||""))?"permission_denied":"error";}
  async function automationModel(req,raw){
    const cfg=getOmniConfig();
    const model=await resolveModelAlias(cfg,String(raw??cfg.model??"").trim());
    if(!model)throw policyFailure("Alege mai întâi un model AI din lista de sus, apoi creează automatizarea.",400);
    await requireModelAccess(req.cloudToken,model);
    return model;
  }
  app.get("/api/automations", auth, (req,res) => {const db=store.read();res.json({data:db.automations.filter(x=>x.userId===req.user.id).sort((a,b)=>b.createdAt-a.createdAt).map(publicAutomation)});});
  app.post("/api/automations", auth, requirePermission("automations"), async (req,res) => {
    try{
      const now=Date.now(),v=validateAutomation(req.body||{},null,now);if(v.error)return res.status(400).json({error:v.error});
      const model=await automationModel(req,typeof req.body?.model==="string"&&req.body.model.trim()?req.body.model:undefined);
      const item={id:crypto.randomUUID(),userId:req.user.id,...v.value,model,trigger:v.value.trigger||`@${v.value.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,"-").replace(/^-|-$/g,"")}`,cloudToken:req.cloudToken?sealSecret(req.cloudToken):null,cloudTokenHash:req.cloudToken?tokenHash(req.cloudToken):null,lastRunAt:null,lastResult:"",lastStatus:"created",failures:0,createdAt:now};
      item.nextRunAt=item.enabled?nextRun(item,now):null;
      const db=store.read();db.automations.push(item);store.write(db);res.json({data:publicAutomation(item)});
    }catch(e){sendError(res,e,400)}
  });
  app.patch("/api/automations/:id", auth, requirePermission("automations"), async (req,res) => {
    try{
      const find=()=>store.read().automations.find(x=>x.id===req.params.id&&x.userId===req.user.id);
      let item=find();if(!item)return res.status(404).json({error:"Automatizarea nu a fost găsită."});
      const now=Date.now(),v=validateAutomation(req.body||{},item,now);if(v.error)return res.status(400).json({error:v.error});
      const model=await automationModel(req,has(req.body,"model")&&String(req.body.model||"").trim()?req.body.model:item.model);
      item=find();if(!item)return res.status(404).json({error:"Automatizarea nu a fost găsită."});
      Object.assign(item,v.value,{model});
      if(req.cloudToken){item.cloudToken=sealSecret(req.cloudToken);item.cloudTokenHash=tokenHash(req.cloudToken);}
      item.failures=0;item.nextRunAt=item.enabled?nextRun(item,now):null;
      if(item.enabled&&["disabled_after_errors","needs_login","permission_denied"].includes(item.lastStatus))item.lastStatus="updated";
      store.write(store.read());res.json({data:publicAutomation(item)});
    }catch(e){sendError(res,e,400)}
  });
  app.post("/api/automations/:id/run", auth, requirePermission("automations"), async (req,res) => {
    const item=store.read().automations.find(x=>x.id===req.params.id&&x.userId===req.user.id);if(!item)return res.status(404).json({error:"Automatizarea nu a fost găsită."});
    if(runningAutomations.has(item.id))return res.status(409).json({error:"Automatizarea rulează deja. Așteaptă să se termine."});
    try{
      await runAutomation(item,req.cloudToken||openSecret(item.cloudToken),{manual:true,req});
      res.json({data:publicAutomation(store.read().automations.find(x=>x.id===item.id)||item)});
    }catch(e){
      const db=store.read(),t=db.automations.find(x=>x.id===item.id);
      if(t){t.lastRunAt=Date.now();t.lastStatus="error";t.lastResult=`Eroare: ${e.status?e.message:roError(e)}`;recordRun(t,runFailureStatus(e),t.model,t.lastResult);store.write(db);}
      sendError(res,e);
    }
  });
  app.get("/api/automations/:id/runs", auth, (req,res) => {
    const item=store.read().automations.find(x=>x.id===req.params.id&&x.userId===req.user.id);if(!item)return res.status(404).json({error:"Automatizarea nu a fost găsită."});
    res.json({data:Array.isArray(item.runs)?item.runs:[]});
  });
  app.post("/api/automations/:id/duplicate", auth, requirePermission("automations"), (req,res) => {
    const db=store.read(),item=db.automations.find(x=>x.id===req.params.id&&x.userId===req.user.id);if(!item)return res.status(404).json({error:"Automatizarea nu a fost găsită."});
    const suffix=" (copie)",title=String(item.title||"Sarcină").slice(0,120-suffix.length).trim()+suffix,now=Date.now();
    const {runs,...rest}=item;
    const copy={...rest,id:crypto.randomUUID(),title,trigger:`@${title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,"-").replace(/^-|-$/g,"")}`,enabled:false,nextRunAt:null,lastRunAt:null,lastResult:"",lastStatus:"created",failures:0,runs:[],createdAt:now,updatedAt:now};
    if(req.cloudToken){copy.cloudToken=sealSecret(req.cloudToken);copy.cloudTokenHash=tokenHash(req.cloudToken);}
    db.automations.push(copy);store.write(db);res.json({data:publicAutomation(copy)});
  });
  app.delete("/api/automations/:id", auth, (req,res) => {const db=store.read(),before=db.automations.length;db.automations=db.automations.filter(x=>!(x.id===req.params.id&&x.userId===req.user.id));if(db.automations.length===before)return res.status(404).json({error:"Automatizarea nu a fost găsită."});store.write(db);res.json({ok:true});});

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
  async function transcribeMedia(req,{bytes,mime,name,language,model,signal}) {
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
        const lang=/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(String(language||"").trim())?String(language).trim():String(cfg.speechLanguage||"ro").trim();
        if(lang)form.append("language",lang);
        const r=await fetch(`${String(cfg.baseUrl).replace(/\/+$/,"")}/audio/transcriptions`,{
          method:"POST",
          headers:cfg.apiKey?{Authorization:`Bearer ${cfg.apiKey}`}:{},
          body:form,
          signal:withAbort(60000,signal)
        });
        const body=await r.text();
        if(!r.ok){errors.push(`${candidate}: HTTP ${r.status}`);continue;}
        let data;try{data=JSON.parse(body)}catch{data={text:body}}
        const text=String(data?.text||data?.transcript||"").trim();
        if(text)return {text,model:candidate};
        errors.push(`${candidate}: răspuns fără text`);
      }catch(e){if(signal?.aborted)throw e;errors.push(`${candidate}: ${roError(e)}`)}
    }
    throw policyFailure(`Nu am putut transcrie fișierul prin OmniRoute. ${errors.join(" | ")}`,502);
  }

  app.post("/api/library/:id/transcribe", auth, async (req,res) => {
    const signal=clientAbortSignal(res);
    try{
      const db=store.read(),item=db.library.find(x=>x.id===req.params.id&&x.userId===req.user.id);
      if(!item)return res.status(404).json({error:"Fișierul nu a fost găsit."});
      const isMedia=item.kind==="audio"||item.kind==="video"||String(item.mime||"").startsWith("audio/")||String(item.mime||"").startsWith("video/");
      if(!isMedia)return res.status(400).json({error:"Fișierul nu este audio sau video."});
      let bytes;
      const st=await libraryFileStat(item);
      if(st){
        if(st.size>25*1024*1024)return res.status(413).json({error:"Transcrierea automată acceptă maximum 25 MB per fișier. Fișierul rămâne salvat în Bibliotecă."});
        bytes=await fs.promises.readFile(item.filePath);
      }else if(item.dataUrl){
        const m=String(item.dataUrl).match(/^data:([^;]+);base64,(.+)$/s);
        if(m)bytes=Buffer.from(m[2],"base64");
      }
      if(!bytes)return res.status(404).json({error:"Conținutul media nu mai este disponibil."});
      const result=await transcribeMedia(req,{bytes,mime:item.mime,name:item.name,language:req.body?.language,model:typeof req.body?.model==="string"?req.body.model.slice(0,200):"",signal});
      res.json({...result,fileId:item.id,name:item.name});
    }catch(e){if(!signal.aborted)sendError(res,e)}
  });

  // C5: only role (system|user|assistant) and content (text or text/image_url parts) reach a provider.
  function sanitizeContent(content){
    if(typeof content==="string")return content;
    if(!Array.isArray(content))return content==null?"":String(content);
    const parts=[];
    for(const p of content){
      if(!p||typeof p!=="object")continue;
      if(p.type==="text"&&typeof p.text==="string"){parts.push({type:"text",text:p.text});continue;}
      if(p.type==="image_url"){
        const url=typeof p.image_url==="string"?p.image_url:p.image_url?.url;
        if(typeof url==="string"&&url){const part={type:"image_url",image_url:{url}};if(["auto","low","high"].includes(p.image_url?.detail))part.image_url.detail=p.image_url.detail;parts.push(part);}
      }
    }
    return parts;
  }
  function hasContent(c){return typeof c==="string"?!!c.trim():Array.isArray(c)&&c.some(p=>p.type==="image_url"||(p.type==="text"&&p.text.trim()));}
  function sanitizeChatMessages(raw){
    return (Array.isArray(raw)?raw:[])
      .filter(m=>m&&typeof m==="object"&&!Array.isArray(m)&&["system","user","assistant"].includes(m.role))
      .map(m=>({role:m.role,content:sanitizeContent(m.content)}))
      .filter(m=>m.role==="system"||hasContent(m.content));
  }
  // The user's typed text (first text part), without the attached files' content, drives search and plugins.
  function typedText(content){
    if(typeof content==="string")return content;
    return (Array.isArray(content)?content:[]).find(p=>p?.type==="text")?.text||"";
  }
  // C4: aistoica-library://<id> becomes a data URL read from the user's own Library (max 20 MB, newest 8 images).
  async function rehydrateLibraryImages(messages,userId){
    const db=store.read();
    let remaining=8;
    const out=[...messages];
    for(let i=out.length-1;i>=0;i--){
      const m=out[i];
      if(!Array.isArray(m.content)||!m.content.some(p=>p.type==="image_url"&&String(p.image_url?.url||"").startsWith(LIBRARY_REF)))continue;
      const parts=[];
      for(const p of m.content){
        const url=p.type==="image_url"?String(p.image_url?.url||""):"";
        if(!url.startsWith(LIBRARY_REF)){parts.push(p);continue;}
        const item=db.library.find(x=>x.id===url.slice(LIBRARY_REF.length)&&x.userId===userId);
        const st=item?await libraryFileStat(item):null;
        if(!item||(!st&&!item.dataUrl)){parts.push({type:"text",text:"[Imaginea atașată nu mai există în Bibliotecă.]"});continue;}
        if((st?.size||0)>20*1024*1024){parts.push({type:"text",text:`[Imaginea „${item.name}” depășește 20 MB și nu a fost trimisă modelului AI.]`});continue;}
        if(remaining<=0){parts.push({type:"text",text:`[Imagine trimisă anterior: ${item.name}]`});continue;}
        remaining--;
        const mime=/^image\//i.test(item.mime||"")?String(item.mime).split(";")[0]:"image/png";
        const data=st?(await fs.promises.readFile(item.filePath)).toString("base64"):String(item.dataUrl).replace(/^data:[^,]*,/,"");
        parts.push({type:"image_url",image_url:{url:`data:${mime};base64,${data}`}});
      }
      out[i]={...m,content:parts};
    }
    return out;
  }
  // Mobile app messages list uploaded files as attachments [{id,...}]; their text (or image) is added to the message.
  async function inlineUploadedAttachments(raw,userId){
    if(!Array.isArray(raw))return raw;
    let budget=200000;
    const out=[];
    for(const m of raw){
      const atts=m&&typeof m==="object"&&Array.isArray(m.attachments)?m.attachments.filter(a=>a&&typeof a==="object"&&a.id&&!a.libraryId).slice(0,6):[];
      if(!atts.length||m.role!=="user"){out.push(m);continue;}
      const parts=typeof m.content==="string"?[{type:"text",text:m.content}]:Array.isArray(m.content)?[...m.content]:[];
      for(const a of atts){
        let item=store.read().library.find(x=>x.id===String(a.id)&&x.userId===userId);if(!item)continue;
        if(/^image\//i.test(item.mime||"")){parts.push({type:"image_url",image_url:{url:LIBRARY_REF+item.id}});continue;}
        if(item.textStatus==="pending"){await indexLibraryText(item.id).catch(()=>{});item=store.read().library.find(x=>x.id===item.id)||item;}
        const text=String(item.text||item.transcript||"");
        const body=text?text.slice(0,Math.max(0,Math.min(60000,budget))):"(conținutul acestui fișier nu poate fi citit automat)";
        budget-=body.length;
        parts.push({type:"text",text:`===== FIȘIER ATAȘAT: ${item.name} =====\n${body}\n===== SFÂRȘIT FIȘIER =====`});
      }
      out.push({...m,content:parts});
    }
    return out;
  }
  async function prepareMessages(rawMessages, assistantId, userId, options={}) {
    const db=store.read();
    const messages=await rehydrateLibraryImages(sanitizeChatMessages(rawMessages),userId);
    const latest=[...messages].reverse().find(m=>m.role==="user");
    const latestText=textFromContent(latest?.content),query=typedText(latest?.content)||latestText.slice(0,4000);
    const cfg=getOmniConfig(),system=[];
    system.push("Când utilizatorul cere un fișier descărcabil (PDF, DOCX/Word, PPTX/PowerPoint, XLSX/Excel, CSV, JSON, Markdown, TXT, HTML, XML, RTF, ZIP, notebook sau fișier de cod), redactează direct conținutul final care trebuie introdus în acel fișier. Pentru XLSX/CSV folosește preferabil un tabel Markdown cu antete; pentru JSON produce JSON valid; pentru HTML/XML/SVG și cod produce conținut valid, fără explicații în afara lui. Nu afișa pseudo-comenzi de tool: aplicația creează fișierul real și îl atașează separat.");
    system.push("Formule matematice: scrie-le în LaTeX, $…$ în text și $$…$$ pe un rând separat (de exemplu $$x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}$$), inclusiv în conținutul unui fișier Word. AI Stoica le afișează ca formule în chat și le transformă în ecuații Microsoft Word (Inserare → Ecuație), editabile. Nu folosi $ pentru sume de bani lângă cifre (scrie «10 USD» sau «10 lei»).");
    system.push("Capabilități AI Stoica: aplicația are memorie persistentă, poate primi context din alte conversații ale aceluiași Proiect, poate căuta internetul în timp real, poate căuta fragmente relevante într-un repository GitHub configurat, iar Owner-ul poate rula cod JavaScript sau Python doar prin butonul explicit de rulare și poate lucra cu serverul SSH configurat. Nu afirma că aceste capabilități nu există atunci când contextul lor este prezent. Nu pretinde că un cod a fost executat dacă nu ai primit explicit un rezultat de rulare. Pentru proiecte mari, lucrează modular și folosește contextul relevant recuperat, fără a cere utilizatorului să copieze manual întreaga bază de cod.");
    system.push("Fiabilitate: pentru informații actuale despre biblioteci, API-uri, modele, versiuni, prețuri sau servicii folosește prioritar contextul WEB LIVE dacă este disponibil și include la final o secțiune scurtă «Surse» cu linkurile folosite. Pentru cod, separă clar ce ai analizat de ce a fost efectiv rulat/testat. Pentru medical, juridic și financiar poți analiza și cita surse, dar păstrează recomandarea de validare umană atunci când decizia are consecințe importante.");
    const assistant=db.assistants.find(a=>a.id===assistantId&&a.userId===userId);if(assistant?.systemPrompt)system.push(assistant.systemPrompt);
    const user=db.users.find(u=>u.id===userId);
    if(user?.memoryEnabled!==false){
      const mem=await embeddingIndex.search(cfg,db,userId,query,8);if(mem.length)system.push("Memorie relevantă despre utilizator și conversațiile anterioare:\n"+mem.map((m,i)=>`${i+1}. ${m.text}`).join("\n"));
    }
    if(user&&user.searchPastChats!==false){const past=pastChatsContext(db,userId,query,options.conversationId||null);if(past)system.push(past);}
    if(options.pluginsAllowed!==false){const pctx=await pluginContext(db,userId,query);if(pctx.length)system.push("Rezultate furnizate de pluginuri conectate:\n"+pctx.join("\n\n"));}
    const lctx=libraryContext(db,userId,query);if(lctx)system.push("BIBLIOTECA AI STOICA — fragmente relevante din fișierele încărcate:\n"+lctx);
    if(cfg.projectContextEnabled!==false&&options.projectId){
      const project=db.projects.find(p=>p.id===options.projectId&&p.userId===userId);
      if(project?.instructions)system.push("INSTRUCȚIUNI PROPRII ALE PROIECTULUI:\n"+project.instructions);
      if(project){const pc=projectContext(db,userId,options.projectId,query);if(pc)system.push("CONTEXT PERSISTENT DIN ACELAȘI PROIECT:\n"+pc)}
    }
    if(options.responseMode==="thinking")system.push("MOD GÂNDIRE: analizează mai riguros, verifică ipotezele și structurează răspunsul înainte de concluzie. Nu expune raționamentul intern; oferă doar concluzii și pași utili.");
    if(options.responseMode==="rapid")system.push("MOD RAPID: prioritizează un răspuns direct, concis și util, fără analiză inutil de lungă.");
    if(options.clarify&&user?.askClarifyingQuestions!==false)system.push(QUESTIONS_RULE);
    if(cfg.webSearchEnabled!==false&&options.webAllowed!==false){
      try{const directUrls=urlsFromText(query);if(directUrls.length){const pages=(await Promise.all(directUrls.map(async url=>{const excerpt=await pageExcerpt(url,5000);return excerpt?"URL: "+url+"\nExtras: "+excerpt:""}))).filter(Boolean);if(pages.length)system.push("PAGINI WEB LIVE — conținut citit direct din linkurile utilizatorului:\n"+pages.join("\n\n"))}}catch{}
      if(shouldUseLiveWeb(query)){try{const deep=options.deepAllowed!==false&&DEEP_RESEARCH_WORDS.test(query);const rows=await liveWebSearch(query,deep?8:5);if(rows.length)system.push("WEB LIVE — rezultate obținute acum. Folosește-le pentru informațiile actuale și indică sursele prin link; nu inventa surse:\n"+rows.map((x,i)=>(i+1)+". "+x.title+"\nURL: "+x.url+"\nExtras: "+String(x.excerpt||"").slice(0,2600)).join("\n\n"))}catch{}}
    }
    if(cfg.githubAutoContext!==false&&options.githubAllowed!==false){try{const gc=await githubCodeContext(cfg,query);if(gc)system.push("GITHUB LIVE — fragmente relevante din repository-ul configurat:\n"+gc)}catch{}}
    if(options.owner&&cfg.serverHost&&SERVER_WORDS.test(query)){
      try{const s=await sshRun(cfg,"uname -a; uptime; pwd",12000);if(s.stdout)system.push("SERVER LIVE — verificare read-only efectuată acum:\n"+s.stdout.slice(0,8000))}catch(e){system.push("SERVER LIVE — conexiunea de verificare nu a reușit: "+(e.status?e.message:roError(e)))}
    }
    return system.length?[{role:"system",content:system.join("\n\n")},...messages.filter(m=>m.role!=="system")]:messages;
  }
  async function prepareChat(req){
    const cfg=getOmniConfig();
    const raw=await inlineUploadedAttachments(req.body?.messages,req.user.id);
    if(!sanitizeChatMessages(raw).some(m=>m.role==="user"))throw policyFailure("Mesajul este gol.",400);
    const messages=await prepareMessages(raw,typeof req.body?.assistantId==="string"?req.body.assistantId:null,req.user.id,{
      projectId:typeof req.body?.projectId==="string"?req.body.projectId:null,
      conversationId:typeof req.body?.conversationId==="string"?req.body.conversationId.slice(0,100):null,clarify:true,
      webAllowed:hasPermission(req,"web_search"),deepAllowed:hasPermission(req,"deep_research"),githubAllowed:hasPermission(req,"github_access"),pluginsAllowed:hasPermission(req,"plugins"),
      owner:ownerRequest(req),responseMode:String(req.body?.responseMode||"rapid")
    });
    const sent=typeof req.body?.model==="string"?req.body.model.trim().slice(0,200):"";
    const requestedModel=sent||String(cfg.model||"").trim();
    return {cfg,requestedModel,messages,chosen:!!sent};
  }


  let openRouterFreeCache={key:"",at:0,model:""};
  async function openRouterFreeChatModel(cfg){
    const key=directOpenRouterKey(cfg);if(!key)throw new Error("Lipsește cheia OpenRouter.");
    if(openRouterFreeCache.key===key&&Date.now()-openRouterFreeCache.at<10*60*1000&&openRouterFreeCache.model)return openRouterFreeCache.model;
    const r=await fetch("https://openrouter.ai/api/v1/models",{
      headers:{Authorization:"Bearer "+key,"X-Title":"AI Stoica"},
      signal:AbortSignal.timeout(12000)
    });
    if(!r.ok)throw new Error("OpenRouter models HTTP "+r.status+": "+(await r.text()).slice(0,400));
    const data=await r.json();
    const rows=(Array.isArray(data?.data)?data.data:[]).filter(x=>String(x?.id||"").endsWith(":free"));
    const chat=rows.filter(x=>{const mods=x?.architecture?.output_modalities;return !Array.isArray(mods)||mods.includes("text")});
    const ids=(chat.length?chat:rows).map(x=>String(x.id));
    if(!ids.length)throw new Error("OpenRouter nu are momentan niciun model :free disponibil.");
    openRouterFreeCache={key,at:Date.now(),model:ids[0]};
    return ids[0];
  }

  function csvValues(value,fallback=""){
    return String(value||fallback).split(",").map(x=>x.trim()).filter(Boolean);
  }

  async function directChatCandidates(cfg,requestedModel=""){
    if(cfg.directChatEnabled===false)return [];
    const strictFree=cfg.directChatCostPolicy!=="allow_paid";
    const known=["cerebras","groq","gemini","mistral","nvidia","github","openrouter","cloudflare","cohere","huggingface","openai","xai"];
    const configured=String(cfg.directChatProviderOrder||known.join(",")).split(",").map(x=>x.trim().toLowerCase()).filter(x=>known.includes(x));
    const baseOrder=[...new Set([...configured,...known])];
    const requested=String(requestedModel||"").trim();
    const requestedProvider=(requested.split("/")[0]||"").toLowerCase();
    const order=requestedProvider==="openai"
      ?["openai","gemini",...baseOrder.filter(x=>x!=="openai"&&x!=="gemini")]
      :known.includes(requestedProvider)?[requestedProvider,...baseOrder.filter(x=>x!==requestedProvider)]:baseOrder;
    const result=[];

    const push=(provider,baseUrl,key,models,{label=provider,paidRisk=false,headers={}}={})=>{
      if(!key||!baseUrl||!models?.length)return;
      if(strictFree&&paidRisk)return;
      const reqProvider=(requested.split("/")[0]||"").toLowerCase();
      const requestedForProvider=reqProvider===provider?requested.slice(provider.length+1):"";
      const list=requestedForProvider?[requestedForProvider,...models]:models;
      for(const model of [...new Set(list.filter(Boolean))])result.push({provider,label,baseUrl,key,model,headers,paidRisk});
    };

    let openRouterModel=String(cfg.openRouterChatModel||"AUTO_FREE").trim();
    if(openRouterModel==="AUTO_FREE"){
      try{openRouterModel=await openRouterFreeChatModel(cfg)}catch{openRouterModel=""}
    }

    const defs={
      cerebras:()=>push("cerebras","https://api.cerebras.ai/v1",String(cfg.cerebrasApiKey||"").trim(),csvValues(cfg.cerebrasModel,MODEL_DEFAULTS.cerebrasModel),{label:"Cerebras"}),
      groq:()=>push("groq","https://api.groq.com/openai/v1",String(cfg.groqApiKey||"").trim(),csvValues(cfg.groqModel,MODEL_DEFAULTS.groqModel),{label:"Groq"}),
      gemini:()=>push("gemini","https://generativelanguage.googleapis.com/v1beta/openai",String(cfg.geminiApiKey||"").trim(),csvValues(cfg.geminiModels,MODEL_DEFAULTS.geminiModels),{label:"Gemini"}),
      mistral:()=>push("mistral","https://api.mistral.ai/v1",String(cfg.mistralApiKey||"").trim(),csvValues(cfg.mistralModel,MODEL_DEFAULTS.mistralModel),{label:"Mistral"}),
      nvidia:()=>push("nvidia","https://integrate.api.nvidia.com/v1",String(cfg.nvidiaApiKey||"").trim(),csvValues(cfg.nvidiaModel,MODEL_DEFAULTS.nvidiaModel),{label:"NVIDIA"}),
      github:()=>push("github","https://models.github.ai/inference",String(cfg.githubToken||"").trim(),csvValues(cfg.githubModelsModel,MODEL_DEFAULTS.githubModelsModel),{label:"GitHub Models",headers:{Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"}}),
      openrouter:()=>push("openrouter","https://openrouter.ai/api/v1",directOpenRouterKey(cfg),openRouterModel?[openRouterModel]:[],{label:"OpenRouter",headers:{"X-Title":"AI Stoica"}}),
      cloudflare:()=>push("cloudflare",cfg.cloudflareAccountId?"https://api.cloudflare.com/client/v4/accounts/"+encodeURIComponent(String(cfg.cloudflareAccountId).trim())+"/ai/v1":"",String(cfg.cloudflareApiToken||"").trim(),csvValues(cfg.cloudflareChatModel,MODEL_DEFAULTS.cloudflareChatModel),{label:"Cloudflare Workers AI"}),
      cohere:()=>push("cohere","https://api.cohere.ai/compatibility/v1",String(cfg.cohereApiKey||"").trim(),csvValues(cfg.cohereModel,MODEL_DEFAULTS.cohereModel),{label:"Cohere"}),
      huggingface:()=>push("huggingface","https://router.huggingface.co/v1",String(cfg.hfToken||"").trim(),csvValues(cfg.huggingFaceChatModel,MODEL_DEFAULTS.huggingFaceChatModel),{label:"Hugging Face"}),
      openai:()=>push("openai","https://api.openai.com/v1",String(cfg.openAiApiKey||"").trim(),csvValues(cfg.openAiChatModels,MODEL_DEFAULTS.openAiChatModels),{label:"OpenAI",paidRisk:true}),
      xai:()=>push("xai","https://api.x.ai/v1",String(cfg.xaiApiKey||"").trim(),csvValues(cfg.xaiModels,MODEL_DEFAULTS.xaiModels),{label:"Grok (xAI)",paidRisk:true})
    };
    const blocked=blockedProviders(cfg);
    for(const id of order)if(!blocked.has(id))defs[id]?.();
    return result;
  }

  function withAbort(ms,signal){return signal?AbortSignal.any([AbortSignal.timeout(ms),signal]):AbortSignal.timeout(ms);}
  // Streams may last up to 15 minutes but stop when the provider sends nothing for 90 seconds.
  // Non-streamed answers get 5 minutes per attempt (GitHub Solve: 10 minutes).
  const STREAM_IDLE_MS=Number(streamIdleMs)||90000,STREAM_TOTAL_MS=Number(streamTotalMs)||15*60*1000,NONSTREAM_MS=5*60*1000;
  function chatTimer(stream,clientSignal,nonStreamMs=NONSTREAM_MS){
    if(!stream)return {signal:null,attemptSignal:()=>withAbort(nonStreamMs,clientSignal),touch(){},clear(){},reason:()=>"",cancelled:()=>!!clientSignal?.aborted};
    const c=new AbortController();let idle=null,why="";
    const fail=(kind)=>{if(c.signal.aborted)return;why=kind;c.abort(Object.assign(new Error(kind==="idle"?"idle":"total"),{name:"TimeoutError"}));};
    const touch=()=>{clearTimeout(idle);idle=setTimeout(()=>fail("idle"),STREAM_IDLE_MS);};
    const total=setTimeout(()=>fail("total"),STREAM_TOTAL_MS);
    const onClient=()=>{why="client";c.abort(clientSignal.reason);};
    if(clientSignal){if(clientSignal.aborted)onClient();else clientSignal.addEventListener("abort",onClient,{once:true});}
    touch();
    return {signal:c.signal,attemptSignal:()=>{touch();return c.signal},touch,reason:()=>why,cancelled:()=>!!clientSignal?.aborted,clear(){clearTimeout(idle);clearTimeout(total);clientSignal?.removeEventListener("abort",onClient);}};
  }
  function timeoutMessage(timer){
    return timer.reason()==="total"?"Răspunsul a depășit durata maximă de 15 minute și a fost oprit.":"Furnizorul AI nu a mai trimis date timp de 90 de secunde; răspunsul a fost oprit.";
  }
  async function fetchDirectChatCandidate(candidate,messages,stream,timer){
    const headers={"Content-Type":"application/json",Authorization:"Bearer "+candidate.key,...(candidate.headers||{})};
    const call=async wantsStream=>fetch(String(candidate.baseUrl).replace(/\/+$/,"")+"/chat/completions",{
      method:"POST",
      headers,
      body:JSON.stringify({model:candidate.model,messages,stream:!!wantsStream}),
      signal:timer.attemptSignal()
    });
    let r=await call(stream);
    if(stream&&[400,404,405,409,422].includes(r.status)){await cancelBody(r);r=await call(false);}
    return r;
  }

  // A model you chose is the one that answers. If it fails, the error says so instead of another provider answering
  // in its place; the direct APIs step in for a direct-API model you chose (only that model), when no model was
  // chosen, or when «Rezervă automată» is turned on.
  const fallbackOn=(cfg,route)=>route?.automatic===true||cfg.chatFallbackOnFailure===true;
  function directFallbackAllowed(req,cfg,route){
    return directApisAllowed(req)&&cfg.directChatEnabled!==false&&(route?.direct===true||fallbackOn(cfg,route));
  }
  // The direct model to keep to, or "" when any configured direct API may answer.
  const directOnly=(cfg,route)=>route?.direct===true&&!fallbackOn(cfg,route)?route.selectedModel:"";
  const directReason=(route)=>route?.direct?(route.reasons||[]):["rezervă automată: modelul ales nu a răspuns, a răspuns un API direct"];
  function chosenModelFailure(req,cfg,route,errors){
    if(route?.automatic)return policyFailure("Niciun model selectat de AI Stoica nu a putut răspunde. "+errors.slice(0,14).join(" | "),502);
    // «Rezervă automată» is in the Windows Settings for the Owner; on the server it is AI_STOICA_CHAT_FALLBACK.
    const hint=!directApisAllowed(req)||cfg.directChatEnabled===false?" Alege alt model din listă."
      :webDir?" Alege alt model din listă (Owner-ul poate porni rezerva automată pe server: AI_STOICA_CHAT_FALLBACK=true).":" Alege alt model din listă sau pornește «Rezervă automată» în Setări → API-uri AI.";
    return policyFailure(`Modelul ales «${route?.selectedModel||"?"}» nu a răspuns, iar AI Stoica nu trece singur la alt model.${hint} Motiv: `+errors.slice(0,6).join(" | "),502);
  }
  // After 401/403/429 the remaining models of the same provider are skipped (same key, same limit).
  async function directChatFallback(cfg,messages,requestedModel,stream,timer=chatTimer(stream,null),only=""){
    let list=await directChatCandidates(cfg,only||requestedModel);
    if(only)list=list.filter(c=>`${c.provider}/${c.model}`.toLowerCase()===only.toLowerCase());
    const candidates=byCooldown("chat",list,c=>c.provider),errors=[],skip=new Set();
    for(const candidate of candidates){
      if(timer.cancelled())break;
      if(skip.has(candidate.provider))continue;
      try{
        const r=await fetchDirectChatCandidate(candidate,messages,stream,timer);
        if(!r.ok){
          const msg="HTTP "+r.status+" "+(await r.text()).slice(0,220);
          if([401,402,403,429].includes(r.status))skip.add(candidate.provider);
          noteProviderResult("chat",candidate.provider,msg);
          errors.push(candidate.label+" · "+candidate.model+": "+msg);continue;
        }
        noteProviderResult("chat",candidate.provider,"");
        return {response:r,candidate,errors};
      }catch(e){if(timer.cancelled())break;errors.push(candidate.label+" · "+candidate.model+": "+(timer.signal?.aborted?timeoutMessage(timer):roError(e)))}
    }
    return {response:null,candidate:null,errors};
  }

  // Settings > "Testează cheile": one tiny request per configured provider, in parallel.
  app.post("/api/providers/test", auth, async (req,res) => {
    if(!directApisAllowed(req))return res.status(403).json({error:"Testarea cheilor este disponibilă doar pentru Owner."});
    const cfg={...getOmniConfig(),directChatCostPolicy:"allow_paid"};
    let candidates;
    try{candidates=await directChatCandidates(cfg,"")}catch(e){return res.status(502).json({error:roError(e)})}
    const firstPerProvider=[...new Map(candidates.map(c=>[c.provider,c])).values()];
    // OmniRoute too: is it running, does it accept the key, how many models and combinations does it offer.
    const omniCfg=getOmniConfig();
    const omniCheck=String(omniCfg.baseUrl||"").trim()?(async()=>{
      const started=Date.now();
      try{
        const list=await omniModelEntries(omniCfg);
        const combos=list.filter(x=>x?.owned_by==="combo"||!String(typeof x==="string"?x:x?.id||"").includes("/")).length;
        return {ok:true,label:"OmniRoute",models:list.length,combos,ms:Date.now()-started};
      }catch(e){return {ok:false,label:"OmniRoute",error:e?.status?e.message:`OmniRoute nu răspunde la ${omniCfg.baseUrl} (${roError(e)}). Pornește-l sau verifică adresa.`,ms:Date.now()-started}}
    })():Promise.resolve(null);
    const results=await Promise.all(firstPerProvider.map(async c=>{
      const started=Date.now();
      try{
        const r=await fetch(String(c.baseUrl).replace(/\/+$/,"")+"/chat/completions",{
          method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+c.key,...(c.headers||{})},
          body:JSON.stringify({model:c.model,messages:[{role:"user",content:"Răspunde doar cu: OK"}],max_tokens:20,stream:false}),
          signal:AbortSignal.timeout(25000)
        });
        const text=await r.text();
        if(!r.ok){
          const hint=r.status===401||r.status===403?"cheie greșită sau fără drepturi":r.status===404?"modelul nu mai există — schimbă numele modelului":r.status===429?"limita gratuită de azi a fost atinsă":"";
          return {provider:c.provider,label:c.label,model:c.model,ok:false,status:r.status,ms:Date.now()-started,error:(hint?hint+" · ":"")+text.slice(0,200),paid:!!c.paidRisk};
        }
        return {provider:c.provider,label:c.label,model:c.model,ok:true,status:r.status,ms:Date.now()-started,paid:!!c.paidRisk};
      }catch(e){return {provider:c.provider,label:c.label,model:c.model,ok:false,status:0,ms:Date.now()-started,error:roError(e),paid:!!c.paidRisk}}
    }));
    const media=[
      ["Cloudflare (imagini)",cfg.cloudflareAccountId&&cfg.cloudflareApiToken],["Pollinations",cfg.pollinationsApiKey],["Pollinations (fără cheie)",cfg.pollinationsFreeEnabled!==false],["Hugging Face",cfg.hfToken],
      ["Together AI",cfg.togetherApiKey],["Stability AI",cfg.stabilityApiKey],["fal.ai",cfg.falApiKey],["Replicate",cfg.replicateApiToken]
    ].map(([label,set])=>({label,configured:!!set}));
    res.json({data:results,media,omni:await omniCheck,checkedAt:Date.now()});
  });

  async function fetchChatCandidate(cfg,model,messages,stream,timer=chatTimer(stream,null)){
    return await fetch(`${String(cfg.baseUrl).replace(/\/+$/,"")}/chat/completions`,{
      method:"POST",
      headers:{"Content-Type":"application/json",...(cfg.apiKey?{Authorization:`Bearer ${cfg.apiKey}`}:{})},
      body:JSON.stringify({model,messages,stream,temperature:0.4}),
      signal:timer.attemptSignal()
    });
  }
  function withCleanQuestions(body){
    if(!String(body).includes("```intrebari"))return body;
    try{const data=JSON.parse(body),msg=data?.choices?.[0]?.message;if(msg&&typeof msg.content==="string"){msg.content=sanitizeQuestions(msg.content);return JSON.stringify(data);}}catch{}
    return body;
  }
  app.post("/api/chat", auth, async (req,res) => {
    const clientSignal=clientAbortSignal(res);
    try{
      const {cfg,requestedModel,messages,chosen}=await prepareChat(req);
      const route=await resolveChatRoute(req,messages,requestedModel,{chosen});
      const timer=chatTimer(false,clientSignal),errors=[];
      for(const candidate of route.candidates){
        if(clientSignal.aborted)return;
        try{
          const r=await fetchChatCandidate(cfg,candidate.id,messages,false,timer);
          const body=await r.text();
          if(!r.ok){errors.push(`${candidate.id}: ${r.status===401||r.status===403?omniHttpError(r.status,""):"HTTP "+r.status+" "+upstreamErrorText(body)}`);continue;}
          res.setHeader("X-AI-Stoica-Route",route.task);
          res.setHeader("X-AI-Stoica-Model",headerSafe(candidate.id));
          return res.status(200).type(r.headers.get("content-type")||"application/json").send(withCleanQuestions(body));
        }catch(e){if(clientSignal.aborted)return;errors.push(`${candidate.id}: ${roError(e)}`)}
      }
      if(directFallbackAllowed(req,cfg,route)){
        const direct=await directChatFallback(cfg,messages,requestedModel,false,timer,directOnly(cfg,route));
        errors.push(...direct.errors);
        if(direct.response){
          const body=await direct.response.text();
          res.setHeader("X-AI-Stoica-Route",route.direct?"direct":"direct-fallback");
          res.setHeader("X-AI-Stoica-Model",headerSafe(direct.candidate.model));
          res.setHeader("X-AI-Stoica-Provider",direct.candidate.provider);
          return res.status(200).type(direct.response.headers.get("content-type")||"application/json").send(withCleanQuestions(body));
        }
      }
      if(clientSignal.aborted)return;
      throw chosenModelFailure(req,cfg,route,errors);
    }catch(e){if(!clientSignal.aborted)sendError(res,e)}
  });
  app.post("/api/chat/stream", auth, async (req,res) => {
    // When the user presses Stop (or closes the window) the request to the AI provider is cancelled too.
    const clientGone=new AbortController();
    res.on("close",()=>{if(!res.writableFinished)clientGone.abort()});
    let prepared;
    try{prepared=await prepareChat(req)}catch(e){return sendError(res,e,400)}
    const {cfg,requestedModel,messages,chosen}=prepared;
    const timer=chatTimer(true,clientGone.signal);
    try{
      const route=await resolveChatRoute(req,messages,requestedModel,{chosen});
      const errors=[];let upstream=null,usedModel="",directCandidate=null;
      for(const candidate of route.candidates){
        if(clientGone.signal.aborted)return;
        try{
          const r=await fetchChatCandidate(cfg,candidate.id,messages,true,timer);
          if(!r.ok){errors.push(`${candidate.id}: ${r.status===401||r.status===403?(await cancelBody(r),omniHttpError(r.status,"")):"HTTP "+r.status+" "+(await r.text()).slice(0,300)}`);continue;}
          upstream=r;usedModel=candidate.id;break;
        }catch(e){if(clientGone.signal.aborted)return;errors.push(`${candidate.id}: ${timer.signal.aborted?timeoutMessage(timer):roError(e)}`)}
      }
      if(!upstream&&directFallbackAllowed(req,cfg,route)&&!timer.signal.aborted){
        if(clientGone.signal.aborted)return;
        const direct=await directChatFallback(cfg,messages,requestedModel,true,timer,directOnly(cfg,route));
        errors.push(...direct.errors);
        if(direct.response){upstream=direct.response;usedModel=direct.candidate.model;directCandidate=direct.candidate}
      }
      if(clientGone.signal.aborted)return;
      if(!upstream)throw chosenModelFailure(req,cfg,route,errors);
      timer.touch();
      const ctype=upstream.headers.get("content-type")||"";
      res.status(200);
      res.setHeader("Content-Type","text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control","no-cache, no-transform");
      res.setHeader("Connection","keep-alive");
      const routeTask=directCandidate?(route.direct?"direct":"direct-fallback"):route.task;
      res.setHeader("X-AI-Stoica-Route",routeTask);
      res.setHeader("X-AI-Stoica-Model",headerSafe(usedModel));
      if(directCandidate)res.setHeader("X-AI-Stoica-Provider",directCandidate.provider);
      const usedCandidate=directCandidate||route.candidates.find(x=>x.id===usedModel)||{};
      res.write(`data: ${JSON.stringify({ai_stoica_route:{task:routeTask,model:usedModel,provider:usedCandidate.provider||inferProvider(usedModel),reasons:directCandidate?directReason(route):(route.reasons||[])}})}\n\n`);
      if(!ctype.includes("text/event-stream")){const data=await upstream.json(),text=sanitizeQuestions(data?.choices?.[0]?.message?.content||"");res.write(`data: ${JSON.stringify({choices:[{delta:{content:text}}]})}\n\n`);res.write("data: [DONE]\n\n");return res.end();}
      const reader=upstream.body.getReader();
      while(true){
        if(clientGone.signal.aborted){try{await reader.cancel()}catch{}break}
        const {value,done}=await reader.read();if(done)break;
        timer.touch();
        if(!res.write(Buffer.from(value)))await new Promise(resolve=>{const go=()=>{res.off("drain",go);res.off("close",go);resolve()};res.on("drain",go);res.on("close",go);});
      }
      if(!res.writableEnded&&!res.destroyed)res.end();
    }catch(e){
      if(clientGone.signal.aborted||res.destroyed)return;
      const message=timer.signal.aborted?timeoutMessage(timer):(e.status?e.message:roError(e));
      if(!res.headersSent)res.status(timer.signal.aborted?504:(e.status||502)).json({error:message});else{res.write(`data: ${JSON.stringify({error:message})}\n\n`);res.end();}
    }finally{timer.clear()}
  });

  // One non-streaming answer through the same route and fallback as chat (used by Design).
  async function completeText(req,messages,requestedModel,signal){
    const cfg=getOmniConfig(),route=await resolveChatRoute(req,messages,requestedModel);
    const timer=chatTimer(false,signal),errors=[];
    const textOf=async(r)=>{let data;try{data=JSON.parse(await r.text())}catch{return ""}return String(data?.choices?.[0]?.message?.content||"");};
    for(const candidate of route.candidates){
      if(signal?.aborted)throw policyFailure("Cererea a fost anulată.",499);
      try{
        const r=await fetchChatCandidate(cfg,candidate.id,messages,false,timer);
        if(!r.ok){errors.push(`${candidate.id}: HTTP ${r.status}`);await cancelBody(r);continue;}
        const text=await textOf(r);
        if(text.trim())return {text,model:candidate.id};
        errors.push(`${candidate.id}: răspuns gol`);
      }catch(e){if(signal?.aborted)throw e;errors.push(`${candidate.id}: ${roError(e)}`)}
    }
    if(directFallbackAllowed(req,cfg,route)){
      const direct=await directChatFallback(cfg,messages,requestedModel,false,timer,directOnly(cfg,route));
      errors.push(...direct.errors);
      if(direct.response){const text=await textOf(direct.response);if(text.trim())return {text,model:`${direct.candidate.provider}/${direct.candidate.model}`};errors.push(`${direct.candidate.label}: răspuns gol`);}
    }
    throw policyFailure("Niciun model AI nu a putut genera designul. "+errors.slice(0,8).join(" | "),502);
  }

  // C5 Design: metadata in the "designs" collection, every version's HTML in designs/<id>/v<n>.html.
  const designsDir=path.join(dataDir,"designs"),designBusy=new Set(),DESIGN_MAX_BYTES=1024*1024;
  const isUuid=(v)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v||""));
  const designFile=(id,n)=>path.join(designsDir,id,`v${n}.html`);
  function publicDesign(d){
    const versions=(Array.isArray(d.versions)?d.versions:[]).map(({n,prompt,at,model})=>({n,prompt,at,model:model||""}));
    return {id:d.id,title:d.title,kind:d.kind,prompt:d.prompt,model:d.model||"",versions,latest:d.latest,versionCount:versions.length,createdAt:d.createdAt,updatedAt:d.updatedAt};
  }
  function findDesign(req){return isUuid(req.params.id)?store.read().designs.find(x=>x.id===req.params.id&&x.userId===req.user.id)||null:null;}
  function designVersion(d,raw){
    if(raw==null||raw==="")return d.latest;
    const n=Number(raw);
    return Number.isInteger(n)&&d.versions.some(v=>v.n===n)?n:null;
  }
  function previewBase(req){
    const base=String(getOmniConfig().publicUrl||"").trim().replace(/\/+$/,"");
    if(/^https?:\/\//i.test(base))return base;
    // Web version: the preview is loaded from the same address as the page.
    if(webDir&&req?.headers?.host)return `${req.protocol}://${req.headers.host}`;
    return `http://127.0.0.1:${server.address()?.port||port}`;
  }
  async function generateDesignHtml(req,messages,signal){
    const requested=(typeof req.body?.model==="string"?req.body.model.trim().slice(0,200):"")||String(getOmniConfig().model||"").trim();
    const out=await completeText(req,messages,requested,signal);
    const html=extractHtml(out.text);
    if(!html)throw policyFailure("Modelul AI nu a returnat o pagină HTML. Încearcă din nou sau alege alt model.",502);
    if(Buffer.byteLength(html)>DESIGN_MAX_BYTES)throw policyFailure("Designul generat depășește 1 MB. Cere o variantă mai simplă.",502);
    return {html,model:out.model};
  }
  async function writeDesignVersion(id,n,html){await fs.promises.mkdir(path.join(designsDir,id),{recursive:true});await fs.promises.writeFile(designFile(id,n),html,"utf8");}
  const notFoundDesign=(res)=>res.status(404).json({error:"Designul nu a fost găsit."});

  app.get("/api/designs", auth, (req,res) => {
    const rows=store.read().designs.filter(x=>x.userId===req.user.id).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
    res.json({data:rows.map(d=>({id:d.id,title:d.title,kind:d.kind,prompt:d.prompt,versionCount:Array.isArray(d.versions)?d.versions.length:0,updatedAt:d.updatedAt,createdAt:d.createdAt}))});
  });
  app.post("/api/designs", auth, requirePermission("document_generation"), async (req,res) => {
    const signal=clientAbortSignal(res);
    try{
      const prompt=textInput(req.body?.prompt,8000);
      if(prompt===null)return res.status(400).json({error:"Descrierea designului poate avea cel mult 8000 de caractere."});
      if(!prompt)return res.status(400).json({error:"Descrie ce design vrei să construim."});
      const kind=req.body?.kind==null||req.body.kind===""?"altceva":String(req.body.kind);
      if(!has(DESIGN_KINDS,kind))return res.status(400).json({error:"Tipul designului nu este valid. Alege: site, landing, afiș, prezentare, card, meniu, CV, email sau altceva."});
      const {html,model}=await generateDesignHtml(req,designMessages(kind,prompt),signal);
      if(signal.aborted)return;
      const now=Date.now(),id=crypto.randomUUID();
      await writeDesignVersion(id,1,html);
      const item={id,userId:req.user.id,title:htmlTitle(html)||prompt.replace(/\s+/g," ").slice(0,80),kind,prompt,model,versions:[{n:1,prompt,at:now,model}],latest:1,createdAt:now,updatedAt:now};
      const db=store.read();db.designs.push(item);store.write(db);
      res.json({data:publicDesign(item)});
    }catch(e){if(!signal.aborted)sendError(res,e)}
  });
  app.get("/api/designs/:id", auth, (req,res) => {const d=findDesign(req);if(!d)return notFoundDesign(res);res.json({data:publicDesign(d)});});
  app.post("/api/designs/:id/revise", auth, requirePermission("document_generation"), async (req,res) => {
    const signal=clientAbortSignal(res);
    const d=findDesign(req);if(!d)return notFoundDesign(res);
    const instructions=textInput(req.body?.instructions,8000);
    if(instructions===null)return res.status(400).json({error:"Instrucțiunile pot avea cel mult 8000 de caractere."});
    if(!instructions)return res.status(400).json({error:"Scrie ce vrei să modific în design."});
    const from=designVersion(d,req.body?.v);if(from==null)return res.status(404).json({error:"Versiunea cerută nu există."});
    if(designBusy.has(d.id))return res.status(409).json({error:"Designul se modifică deja. Așteaptă să se termine."});
    designBusy.add(d.id);
    try{
      let previous;try{previous=await fs.promises.readFile(designFile(d.id,from),"utf8")}catch{return res.status(404).json({error:"Fișierul versiunii anterioare lipsește."})}
      const {html,model}=await generateDesignHtml(req,reviseMessages(d.kind,d.prompt,previous,instructions),signal);
      if(signal.aborted)return;
      const fresh=findDesign(req);if(!fresh)return notFoundDesign(res);
      const n=Math.max(0,...fresh.versions.map(v=>v.n))+1,now=Date.now();
      await writeDesignVersion(fresh.id,n,html);
      fresh.versions.push({n,prompt:instructions,at:now,model});
      const dropped=fresh.versions.length>MAX_DESIGN_VERSIONS?fresh.versions.splice(0,fresh.versions.length-MAX_DESIGN_VERSIONS):[];
      Object.assign(fresh,{latest:n,model,updatedAt:now});
      store.write(store.read());
      await Promise.all(dropped.map(v=>fs.promises.rm(designFile(fresh.id,v.n),{force:true}).catch(()=>{})));
      res.json({data:publicDesign(fresh)});
    }catch(e){if(!signal.aborted)sendError(res,e)}
    finally{designBusy.delete(d.id)}
  });
  app.get("/api/designs/:id/preview-token", auth, requirePermission("document_generation"), (req,res) => {
    const d=findDesign(req);if(!d)return notFoundDesign(res);
    const v=designVersion(d,req.query.v);if(v==null)return res.status(404).json({error:"Versiunea cerută nu există."});
    const t=previewToken(secret,d.userId,d.id,v);
    res.json({data:{url:`${previewBase(req)}/api/designs/${d.id}/preview?v=${v}&t=${encodeURIComponent(t)}`,v,expiresAt:Number(t.split(".")[0])}});
  });
  // Loaded by the Design page's sandboxed iframe: no Authorization header, the signed token is the permission.
  app.get("/api/designs/:id/preview", async (req,res) => {
    res.removeHeader("X-Frame-Options");
    res.removeHeader("Origin-Agent-Cluster");
    res.set({"Content-Type":"text/html; charset=utf-8","X-Content-Type-Options":"nosniff","Cache-Control":"no-store"});
    const page=(status,text)=>res.status(status).set("Content-Security-Policy","sandbox").send(`<!doctype html><html lang="ro"><head><meta charset="utf-8"><title>AI Stoica</title></head><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1018;color:#eef4ff;font-family:Segoe UI,Arial,sans-serif"><p>${text}</p></body></html>`);
    const d=isUuid(req.params.id)?store.read().designs.find(x=>x.id===req.params.id):null,v=Number(req.query.v);
    if(!d||!Number.isInteger(v)||!verifyPreviewToken(secret,req.query.t,d.userId,d.id,v))return page(401,"Linkul de previzualizare a expirat.");
    let html;try{html=await fs.promises.readFile(designFile(d.id,v),"utf8")}catch{return page(404,"Această versiune a designului nu mai există.")}
    res.status(200).set("Content-Security-Policy","sandbox allow-scripts allow-forms allow-popups").send(html);
  });
  app.get("/api/designs/:id/download", auth, requirePermission("document_generation"), async (req,res) => {
    const d=findDesign(req);if(!d)return notFoundDesign(res);
    const v=designVersion(d,req.query.v);if(v==null)return res.status(404).json({error:"Versiunea cerută nu există."});
    let html;try{html=await fs.promises.readFile(designFile(d.id,v))}catch{return res.status(404).json({error:"Fișierul designului lipsește."})}
    res.set({"Content-Type":"text/html; charset=utf-8","Content-Disposition":contentDisposition(safeGeneratedName(d.title||"Design")+".html"),"X-Content-Type-Options":"nosniff","Cache-Control":"no-store"});
    res.send(html);
  });
  app.patch("/api/designs/:id", auth, requirePermission("document_generation"), (req,res) => {
    const d=findDesign(req);if(!d)return notFoundDesign(res);
    const title=textInput(req.body?.title,120);
    if(title===null)return res.status(400).json({error:"Titlul designului poate avea cel mult 120 de caractere."});
    if(!title)return res.status(400).json({error:"Titlul designului este obligatoriu."});
    d.title=title;d.updatedAt=Date.now();store.write(store.read());res.json({data:publicDesign(d)});
  });
  app.delete("/api/designs/:id", auth, async (req,res) => {
    const d=findDesign(req);if(!d)return notFoundDesign(res);
    const db=store.read();db.designs=db.designs.filter(x=>x.id!==d.id);store.write(db);
    await fs.promises.rm(path.join(designsDir,d.id),{recursive:true,force:true}).catch(()=>{});
    res.json({ok:true});
  });

  const runningAutomations=new Set();
  // Permissions come from the request (manual run) or, for scheduled runs in Cloud mode, from Cloud with the saved session.
  async function automationContext(user,cloudToken,req){
    if(req)return req;
    if(!cloudBase())return {user};
    if(!cloudToken)throw policyFailure("Sesiunea AI Stoica Cloud a expirat. Autentifică-te din nou pentru ca automatizarea să ruleze.",401);
    let remote;
    try{remote=await cloudFetch("/auth/me",{headers:{Authorization:`Bearer ${cloudToken}`},timeout:7000})}catch{throw policyFailure(cloudDownMessage(0),503)}
    let data={};try{data=JSON.parse(await remote.text()||"{}")}catch{}
    if(remote.status===401||remote.status===403)throw policyFailure(typeof data?.error==="string"&&data.error?data.error:"Sesiunea AI Stoica Cloud a expirat. Autentifică-te din nou pentru ca automatizarea să ruleze.",401);
    if(!remote.ok||!data?.user)throw policyFailure(cloudDownMessage(remote.status),503);
    return {user,cloudUser:data.user,cloudToken,permissions:data.permissions||{}};
  }
  async function runAutomation(item, cloudToken, {manual=false,req=null}={}) {
    if(runningAutomations.has(item.id))throw policyFailure("Automatizarea rulează deja. Așteaptă să se termine.",409);
    runningAutomations.add(item.id);
    try{
      const cfg=getOmniConfig(),user=store.read().users.find(u=>u.id===item.userId);if(!user)throw new Error("Contul automatizării nu mai există.");
      const ctx=await automationContext(user,cloudToken,req);
      if(!hasPermission(ctx,"automations"))throw policyFailure(deniedMessage("automations"),403);
      const askedModel=String(item.model||cfg.model||"").trim();
      const selectedModel=await resolveModelAlias(cfg,askedModel);
      if(!selectedModel)throw policyFailure("Automatizarea nu are un model AI valid. Selectează un model permis de Owner.",400);
      if(PERSONAL_PROVIDERS.test(selectedModel)&&!personalAllowed(user,ctx.cloudUser))throw policyFailure(`Modelul «${selectedModel}» folosește abonamentul personal al Owner-ului și nu poate rula din alt cont.`,403);
      // Same rule as chat: no model chosen for the automation (or "Ai principal" / "AI Stoica …") lets AI Stoica fall back.
      const automaticModel=!String(item.model||"").trim()||selectedModel!==askedModel;
      await requireModelAccess(cloudToken,selectedModel);
      const isWatch=item.timingMode==="condition_watch";
      const taskPrompt=isWatch
        ? `${item.prompt}\n\nAceasta este o verificare condițională. Dacă nu există o schimbare relevantă sau condiția nu este îndeplinită, răspunde exact: AI_STOICA_NO_NOTIFICATION. Dacă este îndeplinită, răspunde numai cu informația utilă care trebuie notificată.`
        : item.prompt;
      const messages=await prepareMessages([{role:"user",content:taskPrompt}],null,item.userId,{webAllowed:hasPermission(ctx,"web_search"),deepAllowed:hasPermission(ctx,"deep_research"),githubAllowed:hasPermission(ctx,"github_access"),pluginsAllowed:hasPermission(ctx,"plugins"),owner:false});
      // Same rule as chat: a direct-API model goes to its API; any other model to OmniRoute, and when it fails the direct
      // APIs answer only if no model was chosen or «Rezervă automată» is on.
      const errors=[];let data=null;
      const directAllowed=(roleFor(user,ctx.cloudUser)==="owner"||!cloudBase())&&cfg.directChatEnabled!==false;
      const directModel=await isDirectModel(cfg,directAllowed,selectedModel),fallback=automaticModel||cfg.chatFallbackOnFailure===true;
      if(!directModel)try{
        const r=await fetch(`${String(cfg.baseUrl).replace(/\/+$/,"")}/chat/completions`,{method:"POST",headers:{"Content-Type":"application/json",...(cfg.apiKey?{Authorization:`Bearer ${cfg.apiKey}`}:{})},body:JSON.stringify({model:selectedModel,messages,stream:false,temperature:0.25}),signal:AbortSignal.timeout(NONSTREAM_MS)});
        if(r.ok)data=await r.json();
        else errors.push(`OmniRoute HTTP ${r.status}: ${(await r.text()).slice(0,300)}`);
      }catch(e){errors.push(`OmniRoute: ${roError(e)}`)}
      let usedModel=selectedModel;
      if(!data&&directAllowed&&(directModel||fallback)){
        const direct=await directChatFallback(cfg,messages,selectedModel,false,undefined,directModel&&!fallback?selectedModel:"");
        errors.push(...direct.errors);
        if(direct.response){usedModel=`${direct.candidate.provider}/${direct.candidate.model}`;try{data=JSON.parse(await direct.response.text())}catch{errors.push("API direct: răspuns invalid")}}
      }
      if(!data)throw new Error("Automatizarea nu a primit răspuns de la niciun AI. "+errors.slice(0,8).join(" | "));
      const answer=String(data?.choices?.[0]?.message?.content||"").trim();
      const noNotification=isWatch&&/^AI_STOICA_NO_NOTIFICATION\b/i.test(answer);
      const fresh=store.read(),target=fresh.automations.find(x=>x.id===item.id);if(!target)return;
      const stillActive=manual||target.enabled!==false;
      target.lastRunAt=Date.now();target.failures=0;
      target.lastStatus=noNotification?"checked_no_change":"delivered";
      target.lastResult=noNotification?"Verificat — condiția nu este încă îndeplinită.":answer.slice(0,30000);
      recordRun(target,noNotification?"no_change":"ok",String(data?.model||"")||usedModel,target.lastResult);
      // "Rulează acum" does not consume a one-time automation and does not move the schedule.
      if(!manual){if(target.frequency==="once"){target.enabled=false;target.nextRunAt=null;}else target.nextRunAt=target.enabled?nextRun(target,Date.now()+1000):null;}
      store.write(fresh);
      if(stillActive&&!noNotification&&target.notify!==false&&typeof onAutomationResult==="function"){
        try{onAutomationResult({title:target.title,body:answer.slice(0,500),automationId:item.id,userId:item.userId})}catch{}
      }
    }finally{runningAutomations.delete(item.id)}
  }

  let automationBusy=false;
  const automationTimer=setInterval(async()=>{
    if(automationBusy)return;automationBusy=true;
    try{
      const now=Date.now(),due=store.read().automations.filter(a=>a.enabled&&a.nextRunAt&&a.nextRunAt<=now).slice(0,5).map(a=>a.id);
      for(const id of due){
        // Re-read: the automation may have been disabled, edited or deleted while an earlier one was running.
        const a=store.read().automations.find(x=>x.id===id);
        if(!a||a.enabled!==true||!a.nextRunAt||a.nextRunAt>Date.now()||runningAutomations.has(id))continue;
        try{await runAutomation(a,openSecret(a.cloudToken));}
        catch(e){
          const f=store.read(),t=f.automations.find(x=>x.id===id);if(!t)continue;
          t.lastRunAt=Date.now();
          const reason=e.status?e.message:roError(e);
          if(e.status===401){
            t.lastStatus="needs_login";t.lastResult=`${reason} Automatizarea va relua rularea după autentificare.`;
            t.nextRunAt=t.frequency==="once"?Date.now()+30*60*1000:nextRun(t,Date.now()+60000);
          }else if(e.status===403&&/dezactivat|nu este permis|nepermis|Owner/i.test(String(e.message||""))){
            // Turned off by the Owner: wait (no failure counted) and resume by itself once the permission is given back.
            t.lastStatus="permission_denied";t.lastResult=`${reason} Automatizarea va rula din nou când Owner-ul îți dă acces.`;
            t.nextRunAt=t.frequency==="once"?Date.now()+60*60*1000:nextRun(t,Date.now()+60000);
          }else{
            t.lastStatus="error";t.lastResult=`Eroare: ${reason}`;t.failures=Number(t.failures||0)+1;
            // A one-time task whose date has passed would otherwise be retried forever.
            if(t.frequency==="once"){if(t.failures>=3){t.enabled=false;t.nextRunAt=null}else t.nextRunAt=Date.now()+5*60*1000}
            else if(t.failures>=5){t.enabled=false;t.nextRunAt=null;t.lastStatus="disabled_after_errors";t.lastResult=`Automatizarea a fost oprită după 5 erori consecutive. Ultima eroare: ${reason}`}
            else t.nextRunAt=nextRun(t,Date.now()+60000);
          }
          recordRun(t,["needs_login","permission_denied"].includes(t.lastStatus)?t.lastStatus:"error",t.model,t.lastResult);
          store.write(f);
        }
      }
    }finally{automationBusy=false;}
  },30000);

  if(webDir){
    // Web version and installable phone app (PWA): the same React interface as the Windows app, served at "/".
    // The policy matches the page's own <meta> policy, with the page's own address as gateway and Design preview frame.
    const WEB_CSP="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https:; frame-src 'self' blob:; frame-ancestors 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'";
    app.use(express.static(webDir,{index:"index.html",setHeaders:(res,file)=>{
      res.set("Content-Security-Policy",WEB_CSP);
      // Vite puts a content hash in every file under assets/; everything else (index.html, sw.js, manifest) must be re-checked so updates arrive.
      res.set("Cache-Control",/[\\/]assets[\\/]/.test(file)?"public, max-age=31536000, immutable":"no-cache");
    }}));
  }

  // C9: every answer is JSON, also for unknown addresses and malformed requests (no HTML, no stack traces).
  app.use((req,res)=>res.status(404).json({error:"Această adresă nu există în serviciul AI Stoica."}));
  app.use((err,req,res,next)=>{
    if(res.headersSent)return next(err);
    if(err?.type==="entity.parse.failed")return res.status(400).json({error:"Cererea conține JSON invalid."});
    if(err?.type==="entity.too.large")return res.status(413).json({error:"Cererea este prea mare (maximum 64 MB)."});
    if(err?.type==="encoding.unsupported"||err?.type==="charset.unsupported")return res.status(415).json({error:"Codificarea cererii nu este acceptată."});
    const status=Number(err?.status||err?.statusCode);
    if(status>=400&&status<500)return res.status(status).json({error:"Cererea nu este validă."});
    logError(`${req.method} ${req.path}: ${err?.stack||err}`);
    res.status(500).json({error:"Eroare internă AI Stoica. Încearcă din nou."});
  });

  const server=app.listen(port,host);
  server.on("error",e=>logError(`Gateway listen ${host}:${port}: ${e?.message||e}`));
  return {server,port,host,close:()=>new Promise(resolve=>{clearInterval(automationTimer);for(const t of timers)clearTimeout(t);embeddingIndex.flush?.();server.close(resolve);server.closeAllConnections?.();})};
}
module.exports={startLocalGateway};
