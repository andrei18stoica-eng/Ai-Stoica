import { PDFDocument, StandardFonts } from "pdf-lib";
import { Document, Packer, Paragraph, TextRun } from "docx";

const enc = new TextEncoder();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS"
};

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders, ...extra }
  });
}

function uuid() { return crypto.randomUUID(); }
function now() { return Date.now(); }
function normalizeEmail(v) { return String(v || "").trim().toLowerCase(); }
function hex(bytes) { return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join(""); }
function randomHex(bytes = 32) { const a = new Uint8Array(bytes); crypto.getRandomValues(a); return hex(a); }
async function sha256(v) { return hex(await crypto.subtle.digest("SHA-256", enc.encode(String(v)))); }

async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const salt = Uint8Array.from(saltHex.match(/../g).map(x => parseInt(x, 16)));
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 120000 },
    key,
    256
  );
  return hex(bits);
}

async function createSession(env, userId) {
  const token = randomHex(32);
  const tokenHash = await sha256(token);
  const t = now();
  await env.DB.prepare(
    "INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)"
  ).bind(tokenHash, userId, t + 30 * 86400000, t).run();
  return token;
}

async function authenticate(request, env) {
  const raw = request.headers.get("authorization") || "";
  if (!raw.startsWith("Bearer ")) return null;
  const tokenHash = await sha256(raw.slice(7));
  const row = await env.DB.prepare(
    `SELECT u.id,u.email,u.name,u.created_at
     FROM sessions s JOIN users u ON u.id=s.user_id
     WHERE s.token_hash=? AND s.expires_at>?`
  ).bind(tokenHash, now()).first();
  return row || null;
}

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, createdAt: u.created_at };
}

async function bodyJson(request) {
  try { return await request.json(); } catch { return {}; }
}

function safeFileName(value) {
  return String(value || "file").replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 180) || "file";
}

function bytesToBase64(bytes) {
  let out = "";
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i += 0x8000) {
    out += String.fromCharCode(...arr.subarray(i, Math.min(i + 0x8000, arr.length)));
  }
  return btoa(out);
}

function base64ToBytes(value) {
  const bin = atob(String(value || ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeBase64Utf8(value) {
  return new TextDecoder().decode(base64ToBytes(String(value || "").replace(/\n/g, "")));
}

function publicFile(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    mimeType: row.mime_type,
    size: Number(row.size || 0),
    source: row.source || "upload",
    createdAt: row.created_at
  };
}

async function ownedFile(env, userId, id) {
  return env.DB.prepare(
    "SELECT id,user_id,name,mime_type,size,r2_key,source,created_at FROM files WHERE id=? AND user_id=?"
  ).bind(id, userId).first();
}

async function storeFile(env, userId, { name, mimeType, bytes, source = "generated" }) {
  const id = uuid();
  const clean = safeFileName(name);
  const key = userId + "/" + id + "/" + clean;
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  await env.FILES.put(key, data, {
    httpMetadata: { contentType: mimeType || "application/octet-stream" },
    customMetadata: { userId, fileId: id, source }
  });
  const createdAt = now();
  await env.DB.prepare(
    "INSERT INTO files(id,user_id,name,mime_type,size,r2_key,source,created_at) VALUES(?,?,?,?,?,?,?,?)"
  ).bind(id,userId,clean,mimeType || "application/octet-stream",data.byteLength,key,source,createdAt).run();
  return { id, name: clean, mimeType: mimeType || "application/octet-stream", size: data.byteLength, source, createdAt };
}

async function fileToText(env, userId, fileId) {
  const row = await ownedFile(env, userId, fileId);
  if (!row) throw new Error("Fișierul atașat nu a fost găsit.");
  const obj = await env.FILES.get(row.r2_key);
  if (!obj) throw new Error("Fișierul nu mai există în stocare.");
  const buffer = await obj.arrayBuffer();
  const mime = String(row.mime_type || "");

  if (mime.startsWith("text/") || /\.(txt|md|json|js|jsx|ts|tsx|css|html|xml|csv|log|py|java|c|cpp|h|sql|yaml|yml)$/i.test(row.name)) {
    return new TextDecoder().decode(buffer).slice(0, 180000);
  }

  try {
    const converted = await env.AI.toMarkdown(
      { name: row.name, blob: new Blob([buffer], { type: mime || "application/octet-stream" }) },
      { conversionOptions: { output: { format: "text" }, pdf: { metadata: false } } }
    );
    const item = Array.isArray(converted) ? converted[0] : converted;
    if (item?.data) return String(item.data).slice(0, 180000);
  } catch (e) {
    return "[Fișier " + row.name + " încărcat, dar conversia automată nu a reușit: " + e.message + "]";
  }
  return "[Fișier " + row.name + " încărcat.]";
}

async function expandAttachmentMessages(env, userId, messages) {
  const src = Array.isArray(messages) ? messages : [];
  const out = [];
  for (const m of src) {
    if (!m || !["user","assistant","system"].includes(m.role)) continue;
    let content = typeof m.content === "string" ? m.content : String(m.content ?? "");
    const attachments = Array.isArray(m.attachments) ? m.attachments.slice(0, 6) : [];
    if (attachments.length) {
      for (const a of attachments) {
        const fileId = a?.id || a?.libraryId;
        if (!fileId) continue;
        const row = await ownedFile(env, userId, fileId);
        if (!row) continue;
        const extracted = await fileToText(env, userId, fileId);
        content += "\n\n===== FIȘIER ATAȘAT: " + row.name + " =====\n" + extracted + "\n===== SFÂRȘIT FIȘIER =====";
      }
    }
    if (content.trim()) out.push({ role: m.role, content });
  }
  return out;
}

function pdfSafeText(value) {
  return String(value || "")
    .replace(/[ăĂ]/g, m => m === "ă" ? "a" : "A")
    .replace(/[âÂ]/g, m => m === "â" ? "a" : "A")
    .replace(/[îÎ]/g, m => m === "î" ? "i" : "I")
    .replace(/[șşȘŞ]/g, m => /[șş]/.test(m) ? "s" : "S")
    .replace(/[țţȚŢ]/g, m => /[țţ]/.test(m) ? "t" : "T")
    .replace(/[–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
}

function wrapPdfLine(line, max = 92) {
  const words = String(line || "").split(/\s+/);
  const lines = [];
  let cur = "";
  for (const word of words) {
    if ((cur + " " + word).trim().length > max && cur) {
      lines.push(cur);
      cur = word;
    } else cur = (cur + " " + word).trim();
  }
  if (cur || !lines.length) lines.push(cur);
  return lines;
}

async function makePdf(title, content) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([595.28, 841.89]);
  let y = 790;
  const addText = (text, fontRef, size) => {
    for (const raw of String(text || "").split("\n")) {
      const lines = wrapPdfLine(pdfSafeText(raw), size >= 16 ? 66 : 92);
      for (const line of lines) {
        if (y < 55) { page = pdf.addPage([595.28,841.89]); y = 790; }
        page.drawText(line || " ", { x: 48, y, size, font: fontRef });
        y -= size + 5;
      }
    }
  };
  addText(title || "AI Stoica", bold, 18);
  y -= 10;
  addText(content, font, 10.5);
  return new Uint8Array(await pdf.save());
}

async function makeDocx(title, content) {
  const children = [
    new Paragraph({ children:[new TextRun({ text:String(title || "AI Stoica"), bold:true, size:32 })] }),
    new Paragraph({ text:"" }),
    ...String(content || "").split("\n").map(line => new Paragraph({ children:[new TextRun({ text:line, size:22 })] }))
  ];
  const doc = new Document({ sections:[{ properties:{}, children }] });
  const buf = await Packer.toBuffer(doc);
  return new Uint8Array(buf);
}

async function githubApi(env, suffix, options = {}) {
  if (!env.GITHUB_TOKEN) throw new Error("GitHub nu este configurat în AI Stoica.");
  const repo = env.GITHUB_REPO || "andrei18stoica-eng/Ai-Stoica";
  const r = await fetch("https://api.github.com/repos/" + repo + suffix, {
    ...options,
    headers: {
      "Accept":"application/vnd.github+json",
      "Authorization":"Bearer " + env.GITHUB_TOKEN,
      "X-GitHub-Api-Version":"2022-11-28",
      "User-Agent":"AI-Stoica",
      ...(options.headers || {})
    }
  });
  const textBody = await r.text();
  let data; try { data = JSON.parse(textBody); } catch { data = { message:textBody }; }
  if (!r.ok) throw new Error("GitHub HTTP " + r.status + ": " + (data?.message || textBody.slice(0,200)));
  return data;
}

function messageContentToText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(part => {
      if (!part) return "";
      if (part.type === "text") return String(part.text || "");
      if (part.type === "image_url") return "[Imagine atașată]";
      return "";
    }).filter(Boolean).join("\n");
  }
  return String(content ?? "");
}

function parseMessages(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(m => m && ["user","assistant","system"].includes(m.role))
    .map(m => ({ role: m.role, content: messageContentToText(m.content) }))
    .filter(m => m.content.trim());
}

function performanceContext(messages, maxMessages = 80, maxChars = 320000) {
  const src = parseMessages(messages);
  const out = [];
  let chars = 0;
  for (let i = src.length - 1; i >= 0 && out.length < maxMessages; i--) {
    const m = src[i];
    if (chars + m.content.length > maxChars && out.length) break;
    chars += m.content.length;
    out.unshift(m);
  }
  return out;
}

async function relevantMemories(env, userId, latest, limit = 16) {
  const rows = await env.DB.prepare(
    "SELECT id,text,pinned,source,created_at FROM memories WHERE user_id=? ORDER BY pinned DESC, created_at DESC LIMIT 80"
  ).bind(userId).all();
  const words = [...new Set(String(latest || "").toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"").match(/[a-z0-9]{4,}/g) || [])];
  return (rows.results || [])
    .map(m => {
      const h = String(m.text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
      let score = m.pinned ? 20 : 0;
      for (const w of words) if (h.includes(w)) score += 2;
      return { ...m, score };
    })
    .filter(m => m.score > 0 || m.pinned)
    .sort((a,b) => b.score - a.score || b.created_at - a.created_at)
    .slice(0, limit);
}

function extractText(data) {
  if (!data) return "";
  if (typeof data === "string") return data;
  if (typeof data.response === "string") return data.response;
  if (typeof data.output_text === "string") return data.output_text;
  if (typeof data.text === "string") return data.text;
  const choice = data.choices?.[0]?.message?.content;
  if (typeof choice === "string") return choice;
  if (Array.isArray(data.output)) {
    return data.output.flatMap(x => x?.content || []).map(x => x?.text || x?.content || "").join("").trim();
  }
  return "";
}

async function callCloudflare(env, messages, model) {
  const selectedModel = model || env.CF_MODEL || "@cf/nvidia/nemotron-3-120b-a12b";
  const result = await env.AI.run(selectedModel, {
    messages,
    max_tokens: Number(env.AI_STOICA_MAX_OUTPUT || 4096),
    temperature: Number(env.AI_STOICA_TEMPERATURE || 0.35)
  });
  const text = extractText(result);
  if (!text) throw new Error("Cloudflare AI a răspuns fără text.");
  return { text, provider: "cloudflare", model: selectedModel, raw: result };
}

async function callOpenAICompatible({ baseUrl, apiKey, model, messages, provider, maxOutput }) {
  const r = await fetch(baseUrl.replace(/\/+$/,"") + "/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.35,
      max_tokens: maxOutput
    }),
    signal: AbortSignal.timeout(90000)
  });
  const textBody = await r.text();
  if (!r.ok) throw new Error(`${provider} HTTP ${r.status}: ${textBody.slice(0,300)}`);
  let data; try { data = JSON.parse(textBody); } catch { data = {}; }
  const text = extractText(data);
  if (!text) throw new Error(`${provider} a răspuns fără text.`);
  return { text, provider, model, raw: data };
}

async function routeAI(env, messages) {
  const errors = [];
  const maxOutput = Number(env.AI_STOICA_MAX_OUTPUT || 4096);

  // Primary engine for heavy free usage: Cerebras GPT-OSS 120B.
  if (env.CEREBRAS_API_KEY) {
    try {
      return await callOpenAICompatible({
        provider: "cerebras",
        baseUrl: "https://api.cerebras.ai/v1",
        apiKey: env.CEREBRAS_API_KEY,
        model: env.CEREBRAS_MODEL || "gpt-oss-120b",
        messages,
        maxOutput
      });
    } catch (e) {
      errors.push("Cerebras: " + e.message);
    }
  }

  // First fallback: Cloudflare Workers AI.
  const primaryModel = env.CF_MODEL || "@cf/nvidia/nemotron-3-120b-a12b";
  const cloudflareFallback = env.CF_FALLBACK_MODEL || "@cf/openai/gpt-oss-120b";
  try {
    return await callCloudflare(env, messages, primaryModel);
  } catch (e) {
    errors.push("Cloudflare " + primaryModel + ": " + e.message);
  }
  if (cloudflareFallback && cloudflareFallback !== primaryModel) {
    try {
      return await callCloudflare(env, messages, cloudflareFallback);
    } catch (e) {
      errors.push("Cloudflare " + cloudflareFallback + ": " + e.message);
    }
  }

  const fallbacks = [
    env.GROQ_API_KEY && {
      provider: "groq",
      baseUrl: "https://api.groq.com/openai/v1",
      apiKey: env.GROQ_API_KEY,
      model: env.GROQ_MODEL || "openai/gpt-oss-120b"
    },
    env.GEMINI_API_KEY && {
      provider: "gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: env.GEMINI_API_KEY,
      model: env.GEMINI_MODEL || "gemini-2.5-pro"
    }
  ].filter(Boolean);

  for (const p of fallbacks) {
    try {
      return await callOpenAICompatible({ ...p, messages, maxOutput });
    } catch (e) {
      errors.push(p.provider + ": " + e.message);
    }
  }
  throw new Error("Toate motoarele AI au eșuat. " + errors.join(" | "));
}

async function chatMessages(env, user, incoming) {
  const expanded = await expandAttachmentMessages(env, user.id, incoming);
  const raw = performanceContext(expanded, Number(env.AI_STOICA_MAX_HISTORY || 80), Number(env.AI_STOICA_MAX_CONTEXT_CHARS || 320000));
  const latest = [...raw].reverse().find(m => m.role === "user")?.content || "";
  const memories = await relevantMemories(env, user.id, latest, 16);
  const system = [
    "Ești AI Stoica, asistentul principal Stoica Enterprises AI.",
    "Răspunde în limba utilizatorului, riguros, clar și complet.",
    "Folosește capacitatea maximă de raționament disponibilă. Nu simplifica doar pentru a economisi resurse.",
    memories.length ? "Memorie relevantă:\n" + memories.map((m,i)=>`${i+1}. ${m.text}`).join("\n") : ""
  ].filter(Boolean).join("\n\n");
  return [{ role: "system", content: system }, ...raw.filter(m => m.role !== "system")];
}

async function handleAuthRegister(request, env) {
  const b = await bodyJson(request);
  const email = normalizeEmail(b.email), password = String(b.password || ""), name = String(b.name || "").trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error:"Email invalid." },400);
  if (password.length < 8) return json({ error:"Parola trebuie să aibă minimum 8 caractere." },400);
  const exists = await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first();
  if (exists) return json({ error:"Contul există deja." },409);
  const salt = randomHex(16), passwordHash = await hashPassword(password, salt);
  const user = { id:uuid(), email, name:name || email.split("@")[0], created_at:now() };
  await env.DB.prepare(
    "INSERT INTO users(id,email,name,password_hash,password_salt,created_at) VALUES(?,?,?,?,?,?)"
  ).bind(user.id,user.email,user.name,passwordHash,salt,user.created_at).run();
  const token = await createSession(env,user.id);
  return json({ token, user:publicUser(user) });
}

async function handleAuthLogin(request, env) {
  const b=await bodyJson(request), email=normalizeEmail(b.email), password=String(b.password||"");
  const u=await env.DB.prepare("SELECT * FROM users WHERE email=?").bind(email).first();
  if(!u) return json({error:"Email sau parolă incorectă."},401);
  const hash=await hashPassword(password,u.password_salt);
  if(hash!==u.password_hash) return json({error:"Email sau parolă incorectă."},401);
  const token=await createSession(env,u.id);
  return json({token,user:publicUser(u)});
}

async function requireUser(request, env) {
  const user=await authenticate(request,env);
  return user;
}

async function router(request, env) {
  if (request.method === "OPTIONS") return new Response(null,{status:204,headers:corsHeaders});
  const url=new URL(request.url), p=url.pathname;

  if(p==="/health"){
    return json({
      ok:true,
      service:"AI Stoica Cloudflare",
      mode:"performance-max",
      primaryProvider:env.CEREBRAS_API_KEY ? "cerebras" : "cloudflare",
      primaryModel:env.CEREBRAS_API_KEY ? (env.CEREBRAS_MODEL || "gpt-oss-120b") : (env.CF_MODEL || "@cf/nvidia/nemotron-3-120b-a12b"),
      cloudflareFallback:env.CF_FALLBACK_MODEL || "@cf/openai/gpt-oss-120b",
      fallbacks:{
        groq:!!env.GROQ_API_KEY,
        cerebras:!!env.CEREBRAS_API_KEY,
        gemini:!!env.GEMINI_API_KEY
      }
    });
  }

  if(p==="/auth/register" && request.method==="POST") return handleAuthRegister(request,env);
  if(p==="/auth/login" && request.method==="POST") return handleAuthLogin(request,env);

  const user=await requireUser(request,env);
  if(!user) return json({error:"Autentificare necesară."},401);

  if(p.startsWith("/api/github/")){
    const allowed=normalizeEmail(env.GITHUB_ALLOWED_EMAIL||"");
    if(!allowed || normalizeEmail(user.email)!==allowed){
      return json({error:"Funcțiile GitHub nu sunt autorizate pentru acest cont."},403);
    }
  }

  if(p==="/auth/me" && request.method==="GET"){
    const token=await createSession(env,user.id);
    return json({token,user:publicUser(user)});
  }

  if(p==="/api/projects" && request.method==="GET") return json({data:[]});
  if(p==="/api/assistants" && request.method==="GET") return json({data:[]});

  if(p==="/api/models" && request.method==="GET"){
    return json({data:[
      ...(env.CEREBRAS_API_KEY?[{id:env.CEREBRAS_MODEL||"gpt-oss-120b",provider:"cerebras",primary:true}]:[]),
      {id:env.CF_MODEL || "@cf/nvidia/nemotron-3-120b-a12b",provider:"cloudflare",primary:!env.CEREBRAS_API_KEY},
      {id:env.CF_FALLBACK_MODEL || "@cf/openai/gpt-oss-120b",provider:"cloudflare",fallback:true},
      ...(env.GROQ_API_KEY?[{id:env.GROQ_MODEL||"openai/gpt-oss-120b",provider:"groq"}]:[]),
      ...(env.GEMINI_API_KEY?[{id:env.GEMINI_MODEL||"gemini-2.5-pro",provider:"gemini"}]:[])
    ]});
  }

  if(p==="/api/library" && request.method==="GET"){
    const r=await env.DB.prepare(
      "SELECT id,name,mime_type,size,source,created_at FROM files WHERE user_id=? ORDER BY created_at DESC LIMIT 500"
    ).bind(user.id).all();
    return json({data:(r.results||[]).map(x=>({
      id:x.id,name:x.name,mime:x.mime_type,size:Number(x.size||0),
      kind:String(x.mime_type||"").startsWith("image/")?"image":(String(x.mime_type||"").startsWith("text/")||/\.(txt|md|csv|json|js|jsx|ts|tsx|py|html|css|xml|yaml|yml|sql)$/i.test(x.name)?"text":"file"),
      source:x.source||"upload",createdAt:x.created_at
    }))});
  }

  if(p==="/api/library/upload" && request.method==="POST"){
    const name=safeFileName(decodeURIComponent(request.headers.get("x-file-name")||"file"));
    const mime=request.headers.get("x-file-type")||request.headers.get("content-type")||"application/octet-stream";
    const declared=Number(request.headers.get("x-file-size")||request.headers.get("content-length")||0);
    const maxBytes=Number(env.AI_STOICA_FILE_MAX_MB||25)*1024*1024;
    if(declared>maxBytes)return json({error:"Fișierul depășește limita de "+(env.AI_STOICA_FILE_MAX_MB||25)+" MB."},413);
    if(!request.body)return json({error:"Lipsește conținutul fișierului."},400);
    const id=uuid(),key=user.id+"/"+id+"/"+name,createdAt=now();
    const obj=await env.FILES.put(key,request.body,{httpMetadata:{contentType:mime},customMetadata:{userId:user.id,fileId:id,source:"upload"}});
    const size=Number(obj?.size||declared||0);
    if(size>maxBytes){await env.FILES.delete(key);return json({error:"Fișierul depășește limita admisă."},413);}
    await env.DB.prepare("INSERT INTO files(id,user_id,name,mime_type,size,r2_key,source,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .bind(id,user.id,name,mime,size,key,"upload",createdAt).run();
    return json({data:{id,name,mime,size,kind:mime.startsWith("image/")?"image":(mime.startsWith("text/")?"text":"file"),createdAt}});
  }

  const libMetaMatch=p.match(/^\/api\/library\/([^/]+)$/);
  if(libMetaMatch && request.method==="GET"){
    const row=await ownedFile(env,user.id,libMetaMatch[1]);
    if(!row)return json({error:"Fișierul nu a fost găsit."},404);
    const mime=String(row.mime_type||"");
    return json({data:{
      id:row.id,name:row.name,mime,size:Number(row.size||0),
      kind:mime.startsWith("image/")?"image":(mime.startsWith("text/")||/\.(txt|md|csv|json|js|jsx|ts|tsx|py|html|css|xml|yaml|yml|sql)$/i.test(row.name)?"text":"file"),
      source:row.source||"upload",createdAt:row.created_at
    }});
  }
  if(libMetaMatch && request.method==="DELETE"){
    const row=await ownedFile(env,user.id,libMetaMatch[1]);
    if(!row)return json({error:"Fișierul nu a fost găsit."},404);
    await env.FILES.delete(row.r2_key);
    await env.DB.prepare("DELETE FROM files WHERE id=? AND user_id=?").bind(row.id,user.id).run();
    return json({ok:true});
  }

  const libContentMatch=p.match(/^\/api\/library\/([^/]+)\/content$/);
  if(libContentMatch && request.method==="GET"){
    const row=await ownedFile(env,user.id,libContentMatch[1]);
    if(!row)return json({error:"Fișierul nu a fost găsit."},404);
    const obj=await env.FILES.get(row.r2_key);
    if(!obj)return json({error:"Fișierul nu mai există în stocare."},404);
    const headers=new Headers(corsHeaders);
    headers.set("content-type",row.mime_type||"application/octet-stream");
    if(obj.size!=null)headers.set("content-length",String(obj.size));
    return new Response(obj.body,{status:200,headers});
  }

  if(p==="/api/files" && request.method==="GET"){
    const r=await env.DB.prepare(
      "SELECT id,name,mime_type,size,source,created_at FROM files WHERE user_id=? ORDER BY created_at DESC LIMIT 200"
    ).bind(user.id).all();
    return json({data:(r.results||[]).map(publicFile)});
  }

  if(p==="/api/files" && request.method==="POST"){
    const name=safeFileName(url.searchParams.get("name")||"file");
    const mime=request.headers.get("content-type")||url.searchParams.get("type")||"application/octet-stream";
    const declared=Number(request.headers.get("content-length")||0);
    const maxBytes=Number(env.AI_STOICA_FILE_MAX_MB||25)*1024*1024;
    if(declared>maxBytes)return json({error:"Fișierul depășește limita de "+(env.AI_STOICA_FILE_MAX_MB||25)+" MB."},413);
    if(!request.body)return json({error:"Lipsește conținutul fișierului."},400);
    const id=uuid(),key=user.id+"/"+id+"/"+name,createdAt=now();
    const obj=await env.FILES.put(key,request.body,{
      httpMetadata:{contentType:mime},
      customMetadata:{userId:user.id,fileId:id,source:"upload"}
    });
    const size=Number(obj?.size||declared||0);
    if(size>maxBytes){
      await env.FILES.delete(key);
      return json({error:"Fișierul depășește limita de "+(env.AI_STOICA_FILE_MAX_MB||25)+" MB."},413);
    }
    await env.DB.prepare(
      "INSERT INTO files(id,user_id,name,mime_type,size,r2_key,source,created_at) VALUES(?,?,?,?,?,?,?,?)"
    ).bind(id,user.id,name,mime,size,key,"upload",createdAt).run();
    return json({data:{id,name,mimeType:mime,size,source:"upload",createdAt}});
  }

  const fileMatch=p.match(/^\/api\/files\/([^/]+)$/);
  if(fileMatch && request.method==="GET"){
    const row=await ownedFile(env,user.id,fileMatch[1]);
    if(!row)return json({error:"Fișierul nu a fost găsit."},404);
    const obj=await env.FILES.get(row.r2_key);
    if(!obj)return json({error:"Fișierul nu mai există în stocare."},404);
    const headers=new Headers(corsHeaders);
    obj.writeHttpMetadata(headers);
    headers.set("content-type",row.mime_type||"application/octet-stream");
    headers.set("content-disposition","attachment; filename*=UTF-8''"+encodeURIComponent(row.name));
    if(obj.size!=null)headers.set("content-length",String(obj.size));
    return new Response(obj.body,{status:200,headers});
  }
  if(fileMatch && request.method==="DELETE"){
    const row=await ownedFile(env,user.id,fileMatch[1]);
    if(!row)return json({error:"Fișierul nu a fost găsit."},404);
    await env.FILES.delete(row.r2_key);
    await env.DB.prepare("DELETE FROM files WHERE id=? AND user_id=?").bind(row.id,user.id).run();
    return json({ok:true});
  }

  if(p==="/api/export" && request.method==="POST"){
    const b=await bodyJson(request);
    const format=String(b.format||"docx").toLowerCase();
    const title=String(b.title||"AI Stoica");
    const content=String(b.content||"");
    if(!content.trim())return json({error:"Nu există conținut de exportat."},400);
    let bytes,mime,ext;
    if(format==="pdf"){
      bytes=await makePdf(title,content);mime="application/pdf";ext="pdf";
    }else if(format==="docx"){
      bytes=await makeDocx(title,content);mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document";ext="docx";
    }else if(format==="md"){
      bytes=enc.encode(content);mime="text/markdown; charset=utf-8";ext="md";
    }else{
      bytes=enc.encode(content);mime="text/plain; charset=utf-8";ext="txt";
    }
    const file=await storeFile(env,user.id,{
      name:safeFileName(title).replace(/\.[^.]+$/,"")+"."+ext,
      mimeType:mime,bytes,source:"ai-export"
    });
    return json({data:file});
  }

  if(p==="/api/generate/image" && request.method==="POST"){
    const b=await bodyJson(request);
    const prompt=String(b.prompt||"").trim();
    if(!prompt)return json({error:"Scrie descrierea imaginii."},400);
    const model=env.IMAGE_MODEL||"@cf/black-forest-labs/flux-1-schnell";
    const result=await env.AI.run(model,{prompt});
    if(!result?.image)return json({error:"Modelul de imagini nu a returnat o imagine."},502);
    const bytes=base64ToBytes(result.image);
    const file=await storeFile(env,user.id,{
      name:"ai-stoica-image-"+new Date().toISOString().replace(/[:.]/g,"-")+".jpg",
      mimeType:"image/jpeg",bytes,source:"ai-image"
    });
    return json({data:file,model});
  }

  if(p==="/api/github/file" && request.method==="GET"){
    const path=String(url.searchParams.get("path")||"").replace(/^\/+/, "");
    if(!path)return json({error:"Lipsește calea fișierului GitHub."},400);
    const branchName=String(url.searchParams.get("ref")||env.GITHUB_BRANCH||"main");
    const encoded=path.split("/").map(encodeURIComponent).join("/");
    const data=await githubApi(env,"/contents/"+encoded+"?ref="+encodeURIComponent(branchName));
    if(data.type!=="file")return json({error:"Calea GitHub nu indică un fișier."},400);
    return json({data:{path:data.path,sha:data.sha,size:data.size,content:decodeBase64Utf8(data.content||"")}});
  }

  if(p==="/api/github/solve" && request.method==="POST"){
    const b=await bodyJson(request);
    const path=String(b.path||"").replace(/^\/+/, "");
    const instruction=String(b.instruction||"Analizează fișierul, identifică problema și corectează-l.").trim();
    if(!path)return json({error:"Lipsește calea fișierului GitHub."},400);
    const branchName=String(b.branch||env.GITHUB_BRANCH||"main");
    const encoded=path.split("/").map(encodeURIComponent).join("/");
    const data=await githubApi(env,"/contents/"+encoded+"?ref="+encodeURIComponent(branchName));
    if(data.type!=="file")return json({error:"Calea GitHub nu indică un fișier."},400);
    const original=decodeBase64Utf8(data.content||"");
    if(original.length>220000)return json({error:"Fișierul este prea mare pentru rezolvarea automată într-un singur pas."},413);
    const messages=[
      {role:"system",content:"Ești agentul de programare AI Stoica. Primești un fișier din repository și o cerință. Returnează EXCLUSIV conținutul complet al fișierului corectat, fără explicații și fără delimitatoare Markdown."},
      {role:"user",content:"Repository: "+(env.GITHUB_REPO||"andrei18stoica-eng/Ai-Stoica")+"\nFișier: "+path+"\nCerință: "+instruction+"\n\nCONȚINUT ACTUAL:\n"+original}
    ];
    const out=await routeAI(env,messages);
    let proposal=String(out.text||"").trim();
    proposal=proposal.replace(/^\x60\x60\x60[^\n]*\n/,"").replace(/\n\x60\x60\x60$/,"").trim();
    return json({data:{path,branch:branchName,sha:data.sha,original,proposal,provider:out.provider,model:out.model}});
  }

  if(p==="/api/github/apply" && request.method==="POST"){
    const b=await bodyJson(request);
    const path=String(b.path||"").replace(/^\/+/, "");
    const content=String(b.content??"");
    const sha=String(b.sha||"");
    const branchName=String(b.branch||env.GITHUB_BRANCH||"main");
    if(!path||!sha)return json({error:"Lipsesc path sau SHA pentru commit."},400);
    const encoded=path.split("/").map(encodeURIComponent).join("/");
    const data=await githubApi(env,"/contents/"+encoded,{
      method:"PUT",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({
        message:String(b.message||("AI Stoica: rezolvare "+path)),
        content:bytesToBase64(enc.encode(content)),
        sha,
        branch:branchName
      })
    });
    return json({ok:true,data:{path,branch:branchName,commit:data.commit?.sha||null}});
  }

  if(p==="/api/conversations" && request.method==="GET"){
    const r=await env.DB.prepare(
      "SELECT id,title,model,messages_json,summary,created_at,updated_at FROM conversations WHERE user_id=? ORDER BY updated_at DESC"
    ).bind(user.id).all();
    return json({data:(r.results||[]).map(x=>({
      id:x.id,title:x.title,model:x.model,messages:JSON.parse(x.messages_json||"[]"),
      summary:x.summary||"",createdAt:x.created_at,updatedAt:x.updated_at
    }))});
  }

  if(p==="/api/conversations" && request.method==="POST"){
    const b=await bodyJson(request), t=now();
    const item={id:uuid(),title:String(b.title||"Conversație nouă"),model:String(b.model||env.CF_MODEL||"@cf/nvidia/nemotron-3-120b-a12b"),messages:Array.isArray(b.messages)?b.messages:[],summary:"",createdAt:t,updatedAt:t};
    await env.DB.prepare(
      "INSERT INTO conversations(id,user_id,title,model,messages_json,summary,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)"
    ).bind(item.id,user.id,item.title,item.model,JSON.stringify(item.messages),item.summary,t,t).run();
    return json({data:item});
  }

  const convMatch=p.match(/^\/api\/conversations\/([^/]+)$/);
  if(convMatch && request.method==="PUT"){
    const id=convMatch[1],b=await bodyJson(request);
    const old=await env.DB.prepare("SELECT * FROM conversations WHERE id=? AND user_id=?").bind(id,user.id).first();
    if(!old)return json({error:"Conversația nu a fost găsită."},404);
    const title=Object.hasOwn(b,"title")?String(b.title):old.title;
    const model=Object.hasOwn(b,"model")?String(b.model):old.model;
    const messages=Object.hasOwn(b,"messages")&&Array.isArray(b.messages)?b.messages:JSON.parse(old.messages_json||"[]");
    await env.DB.prepare(
      "UPDATE conversations SET title=?,model=?,messages_json=?,updated_at=? WHERE id=? AND user_id=?"
    ).bind(title,model,JSON.stringify(messages),now(),id,user.id).run();
    const fresh=await env.DB.prepare("SELECT * FROM conversations WHERE id=? AND user_id=?").bind(id,user.id).first();
    return json({data:{id:fresh.id,title:fresh.title,model:fresh.model,messages:JSON.parse(fresh.messages_json||"[]"),summary:fresh.summary||"",createdAt:fresh.created_at,updatedAt:fresh.updated_at}});
  }
  if(convMatch && request.method==="DELETE"){
    await env.DB.prepare("DELETE FROM conversations WHERE id=? AND user_id=?").bind(convMatch[1],user.id).run();
    return json({ok:true});
  }

  if(p==="/api/memory" && request.method==="GET"){
    const r=await env.DB.prepare("SELECT id,text,pinned,source,created_at FROM memories WHERE user_id=? ORDER BY pinned DESC,created_at DESC").bind(user.id).all();
    return json({enabled:true,data:(r.results||[]).map(x=>({...x,createdAt:x.created_at,pinned:!!x.pinned}))});
  }
  if(p==="/api/memory" && request.method==="POST"){
    const b=await bodyJson(request), text=String(b.text||"").trim();
    if(!text)return json({error:"Memoria este goală."},400);
    const item={id:uuid(),text:text.slice(0,20000),pinned:!!b.pinned,source:"manual",createdAt:now()};
    await env.DB.prepare("INSERT INTO memories(id,user_id,text,pinned,source,created_at) VALUES(?,?,?,?,?,?)")
      .bind(item.id,user.id,item.text,item.pinned?1:0,item.source,item.createdAt).run();
    return json({data:item});
  }

  if(p==="/api/chat" && request.method==="POST"){
    const b=await bodyJson(request);
    const prepared=await chatMessages(env,user,b.messages);
    try{
      const out=await routeAI(env,prepared);
      return json({
        choices:[{index:0,message:{role:"assistant",content:out.text},finish_reason:"stop"}],
        model:out.model,
        provider:out.provider,
        mode:"performance-max"
      });
    }catch(e){
      return json({error:e.message},502);
    }
  }

  return json({error:"Endpoint inexistent."},404);
}

export default {
  async fetch(request, env) {
    try { return await router(request,env); }
    catch(e){ return json({error:"Eroare AI Stoica: "+e.message},500); }
  }
};
