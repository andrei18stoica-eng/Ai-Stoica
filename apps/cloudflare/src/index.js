import { PDFDocument, StandardFonts } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { Document, Packer, Paragraph, TextRun } from "docx";
import PptxGenJS from "pptxgenjs";

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
    `SELECT u.id,u.email,u.name,u.created_at,u.role,u.status,s.token_hash
     FROM sessions s JOIN users u ON u.id=s.user_id
     WHERE s.token_hash=? AND s.expires_at>?`
  ).bind(tokenHash, now()).first();
  return row || null;
}

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, createdAt: u.created_at, role: u.role || "user", status: u.status || "active" };
}
function isOwnerEmail(env, email) {
  const owner = normalizeEmail(env.OWNER_EMAIL || env.GITHUB_ALLOWED_EMAIL || "");
  return !!owner && normalizeEmail(email) === owner;
}
function clientIp(request) {
  return String(request.headers.get("cf-connecting-ip") || "unknown").slice(0, 80);
}
// Password guessing protection: 20 failed attempts per IP every 15 minutes.
async function authBlocked(env, request) {
  try {
    const row = await env.DB.prepare("SELECT failures,window_start FROM auth_attempts WHERE key=?").bind("ip:" + clientIp(request)).first();
    if (!row) return false;
    if (now() - row.window_start > 15 * 60000) return false;
    return row.failures >= Number(env.AUTH_ATTEMPTS_PER_15_MIN || 20);
  } catch { return false; }
}
async function recordAuthFailure(env, request) {
  try {
    const key = "ip:" + clientIp(request), t = now();
    const row = await env.DB.prepare("SELECT failures,window_start FROM auth_attempts WHERE key=?").bind(key).first();
    if (!row || t - row.window_start > 15 * 60000) {
      await env.DB.prepare("INSERT INTO auth_attempts(key,failures,window_start) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET failures=1,window_start=excluded.window_start").bind(key, t).run();
    } else {
      await env.DB.prepare("UPDATE auth_attempts SET failures=failures+1 WHERE key=?").bind(key).run();
    }
  } catch {}
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
  let latestUserIndex=-1;
  for(let i=src.length-1;i>=0;i--){if(src[i]?.role==="user"){latestUserIndex=i;break}}
  for (let index=0;index<src.length;index++) {
    const m=src[index];
    if (!m || !["user","assistant","system"].includes(m.role)) continue;
    let content = "";
    if (typeof m.content === "string") content = m.content;
    else if (Array.isArray(m.content)) content = m.content.filter(x=>x?.type==="text").map(x=>String(x.text||"")).join("\n");
    else content = String(m.content ?? "");
    const attachments = index===latestUserIndex && Array.isArray(m.attachments) ? m.attachments.slice(0, 6) : [];
    for (const a of attachments) {
      const fileId=a?.id||a?.libraryId;if(!fileId)continue;
      const row=await ownedFile(env,userId,fileId);if(!row)continue;
      const extracted=await fileToText(env,userId,fileId);
      content += "\n\n===== FIȘIER ATAȘAT: " + row.name + " =====\n" + extracted + "\n===== SFÂRȘIT FIȘIER =====";
    }
    if (content.trim()) out.push({ role:m.role, content });
  }
  return out;
}

function pdfFallbackText(value) {
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

let unicodePdfFontPromise = null;
async function loadUnicodePdfFont() {
  if (!unicodePdfFontPromise) {
    unicodePdfFontPromise = fetch(
      "https://raw.githubusercontent.com/google/fonts/main/ofl/notosans/NotoSans%5Bwdth%2Cwght%5D.ttf"
    ).then(async r => {
      if (!r.ok) throw new Error("Font Unicode HTTP " + r.status);
      return new Uint8Array(await r.arrayBuffer());
    }).catch(e => {
      unicodePdfFontPromise = null;
      throw e;
    });
  }
  return unicodePdfFontPromise;
}

async function makePdf(title, content) {
  const pdf = await PDFDocument.create();
  let font;
  let titleFont;
  let unicode = true;
  try {
    pdf.registerFontkit(fontkit);
    const bytes = await loadUnicodePdfFont();
    font = await pdf.embedFont(bytes, { subset: true });
    titleFont = font;
  } catch {
    unicode = false;
    font = await pdf.embedFont(StandardFonts.Helvetica);
    titleFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  }

  let page = pdf.addPage([595.28, 841.89]);
  let y = 790;
  const addText = (text, fontRef, size) => {
    for (const raw of String(text || "").split("\n")) {
      const prepared = unicode ? raw : pdfFallbackText(raw);
      const lines = wrapPdfLine(prepared, size >= 16 ? 66 : 92);
      for (const line of lines) {
        if (y < 55) { page = pdf.addPage([595.28,841.89]); y = 790; }
        page.drawText(line || " ", { x: 48, y, size, font: fontRef });
        y -= size + 5;
      }
    }
  };
  addText(title || "AI Stoica", titleFont, 18);
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

function splitForSlides(content, maxCharacters = 900) {
  const paragraphs = String(content || "").split(/\n\s*\n/).map(x => x.trim()).filter(Boolean);
  const chunks = [];
  let current = "";
  for (const paragraph of paragraphs.length ? paragraphs : [String(content || "")]) {
    const words = paragraph.split(/\s+/);
    for (const word of words) {
      const candidate = (current + " " + word).trim();
      if (candidate.length > maxCharacters && current) {
        chunks.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current && current.length > maxCharacters * 0.6) {
      chunks.push(current);
      current = "";
    } else if (current) {
      current += "\n\n";
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length ? chunks : [""];
}

async function makePptx(title, content) {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "AI Stoica";
  pptx.company = "Stoica Enterprises AI";
  pptx.subject = String(title || "AI Stoica");
  pptx.title = String(title || "AI Stoica");
  pptx.lang = "ro-RO";

  let slide = pptx.addSlide();
  slide.background = { color: "F7F9FC" };
  slide.addText(String(title || "AI Stoica"), {
    x: 0.8, y: 2.35, w: 11.7, h: 0.8,
    fontFace: "Aptos Display", fontSize: 28, bold: true,
    color: "172033", align: "center", margin: 0
  });
  slide.addText("Document generat cu AI Stoica", {
    x: 1.2, y: 3.25, w: 10.9, h: 0.45,
    fontFace: "Aptos", fontSize: 14, color: "52627A",
    align: "center", margin: 0
  });

  const chunks = splitForSlides(content);
  chunks.forEach((chunk, index) => {
    const s = pptx.addSlide();
    s.background = { color: "FFFFFF" };
    s.addText(index === 0 ? String(title || "AI Stoica") : String(title || "AI Stoica") + " – continuare", {
      x: 0.65, y: 0.45, w: 12.0, h: 0.55,
      fontFace: "Aptos Display", fontSize: 23, bold: true,
      color: "172033", margin: 0
    });
    s.addText(chunk, {
      x: 0.75, y: 1.25, w: 11.8, h: 5.65,
      fontFace: "Aptos", fontSize: 18, color: "26354A",
      breakLine: false, valign: "top", margin: 0.08,
      fit: "shrink"
    });
  });

  const out = await pptx.write({ outputType: "arraybuffer" });
  return new Uint8Array(out);
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

function parseMessages(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(m => m && ["user","assistant","system"].includes(m.role))
    .map(m => ({ role: m.role, content: typeof m.content === "string" ? m.content : String(m.content ?? "") }))
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
    "Când utilizatorul cere PDF, DOCX sau PPTX, redactează conținutul normal. Nu afișa pseudo-comenzi precum <invoke generate_pdf>; aplicația creează fișierul real separat.",
    memories.length ? "Memorie relevantă:\n" + memories.map((m,i)=>`${i+1}. ${m.text}`).join("\n") : ""
  ].filter(Boolean).join("\n\n");
  return [{ role: "system", content: system }, ...raw.filter(m => m.role !== "system")];
}

async function handleAuthRegister(request, env) {
  const b = await bodyJson(request);
  const email = normalizeEmail(b.email), password = String(b.password || ""), name = String(b.name || "").trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error:"Email invalid." },400);
  if (password.length < 8) return json({ error:"Parola trebuie să aibă minimum 8 caractere." },400);
  if (await authBlocked(env, request)) return json({ error:"Prea multe încercări. Așteaptă 15 minute și încearcă din nou." },429);
  const exists = await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first();
  if (exists) { await recordAuthFailure(env, request); return json({ error:"Contul există deja." },409); }
  const salt = randomHex(16), passwordHash = await hashPassword(password, salt);
  // New accounts wait for the Owner's approval, so strangers cannot use the AI keys of this server.
  // OPEN_REGISTRATION="true" restores instant access for everyone.
  const owner = isOwnerEmail(env, email);
  if(owner){const bootstrap=String(env.OWNER_INITIAL_PASSWORD||"");if(!bootstrap)return json({error:"Contul Owner nu poate fi creat până când secretul OWNER_INITIAL_PASSWORD este configurat."},503);if(password!==bootstrap){await recordAuthFailure(env,request);return json({error:"Parola Owner nu corespunde secretului de bootstrap."},403)}}
  const active = owner || String(env.OPEN_REGISTRATION || "").toLowerCase() === "true";
  const user = { id:uuid(), email, name:name || email.split("@")[0], created_at:now(), role: owner ? "owner" : "user", status: active ? "active" : "pending" };
  await env.DB.prepare(
    "INSERT INTO users(id,email,name,password_hash,password_salt,created_at,role,status,approved_at) VALUES(?,?,?,?,?,?,?,?,?)"
  ).bind(user.id,user.email,user.name,passwordHash,salt,user.created_at,user.role,user.status,active ? user.created_at : null).run();
  if (!active) return json({ ok:true, status:"pending", message:"Cont creat. Accesul așteaptă aprobarea Owner-ului." },202);
  const token = await createSession(env,user.id);
  return json({ token, user:publicUser(user) });
}

async function handleAuthLogin(request, env) {
  const b=await bodyJson(request), email=normalizeEmail(b.email), password=String(b.password||"");
  if(await authBlocked(env,request)) return json({error:"Prea multe încercări. Așteaptă 15 minute și încearcă din nou."},429);
  const u=await env.DB.prepare("SELECT * FROM users WHERE email=?").bind(email).first();
  if(!u){await recordAuthFailure(env,request);return json({error:"Email sau parolă incorectă."},401);}
  const hash=await hashPassword(password,u.password_salt);
  if(hash!==u.password_hash){await recordAuthFailure(env,request);return json({error:"Email sau parolă incorectă."},401);}
  if(isOwnerEmail(env,u.email)){const bootstrap=String(env.OWNER_INITIAL_PASSWORD||"");if(!bootstrap||password!==bootstrap){await recordAuthFailure(env,request);return json({error:"Autentificarea Owner necesită parola configurată în OWNER_INITIAL_PASSWORD."},403)}if(u.role!=="owner"||u.status!=="active")return json({error:"Contul cu emailul Owner există, dar nu are rol Owner. Verifică baza D1 înainte de a continua."},403)}
  if(u.status!=="active") return json({error:u.status==="pending"?"Contul așteaptă aprobarea Owner-ului.":"Contul nu este activ.",status:u.status},403);
  await env.DB.prepare("DELETE FROM sessions WHERE user_id=? AND expires_at<=?").bind(u.id,now()).run();
  await env.DB.prepare("UPDATE users SET last_login_at=? WHERE id=?").bind(now(),u.id).run();
  const token=await createSession(env,u.id);
  return json({token,user:publicUser(u)});
}

async function requireUser(request, env) {
  return await authenticate(request,env);
}

async function router(request, env) {
  if (request.method === "OPTIONS") return new Response(null,{status:204,headers:corsHeaders});
  const url=new URL(request.url), p=url.pathname;

  if(p==="/health"){
    return json({
      ok:true,
      service:"AI Stoica Cloudflare",
      mode:"performance-max",
      omni:true,
      cloud:true,
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
  if(user.status&&user.status!=="active"&&user.role!=="owner") return json({error:user.status==="pending"?"Contul așteaptă aprobarea Owner-ului.":"Contul nu este activ.",status:user.status},403);

  // Owner: approve / reject accounts.
  if(p==="/api/admin/users" && request.method==="GET"){
    if(user.role!=="owner") return json({error:"Acces rezervat Owner."},403);
    const r=await env.DB.prepare("SELECT id,email,name,role,status,created_at,approved_at,last_login_at FROM users ORDER BY created_at DESC LIMIT 500").all();
    return json({data:(r.results||[]).map(u=>({...publicUser(u),approvedAt:u.approved_at,lastLoginAt:u.last_login_at}))});
  }
  const adminStatus=p.match(/^\/api\/admin\/users\/([^/]+)\/status$/);
  if(adminStatus && request.method==="PATCH"){
    if(user.role!=="owner") return json({error:"Acces rezervat Owner."},403);
    const b=await bodyJson(request),status=String(b.status||"");
    if(!["pending","active","rejected","suspended","blocked"].includes(status)) return json({error:"Status invalid."},400);
    const target=await env.DB.prepare("SELECT id,email FROM users WHERE id=?").bind(adminStatus[1]).first();
    if(!target) return json({error:"Utilizator inexistent."},404);
    if(isOwnerEmail(env,target.email)) return json({error:"Contul Owner nu poate fi modificat."},400);
    await env.DB.prepare("UPDATE users SET status=?,approved_at=CASE WHEN ?='active' THEN COALESCE(approved_at,?) ELSE approved_at END,approved_by=CASE WHEN ?='active' THEN ? ELSE approved_by END WHERE id=?").bind(status,status,now(),status,user.id,target.id).run();
    if(status!=="active") await env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(target.id).run();
    return json({ok:true,status});
  }

  if(p.startsWith("/api/github/")){
    const allowed=normalizeEmail(env.GITHUB_ALLOWED_EMAIL||"");
    if(!(user.role==="owner"||(allowed && normalizeEmail(user.email)===allowed))){
      return json({error:"Funcțiile GitHub nu sunt autorizate pentru acest cont."},403);
    }
  }

  if(p==="/auth/me" && request.method==="GET"){
    // Renew the current session instead of creating a new one every time the app opens.
    await env.DB.prepare("UPDATE sessions SET expires_at=? WHERE token_hash=?").bind(now()+30*86400000,user.token_hash).run();
    const token=(request.headers.get("authorization")||"").slice(7);
    return json({token,user:publicUser(user)});
  }

  if(p==="/api/models" && request.method==="GET"){
    return json({data:[
      ...(env.CEREBRAS_API_KEY?[{id:env.CEREBRAS_MODEL||"gpt-oss-120b",provider:"cerebras",primary:true}]:[]),
      {id:env.CF_MODEL || "@cf/nvidia/nemotron-3-120b-a12b",provider:"cloudflare",primary:!env.CEREBRAS_API_KEY},
      {id:env.CF_FALLBACK_MODEL || "@cf/openai/gpt-oss-120b",provider:"cloudflare",fallback:true},
      ...(env.GROQ_API_KEY?[{id:env.GROQ_MODEL||"openai/gpt-oss-120b",provider:"groq"}]:[]),
      ...(env.GEMINI_API_KEY?[{id:env.GEMINI_MODEL||"gemini-2.5-pro",provider:"gemini"}]:[])
    ]});
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
    const title=String(b.title||"AI Stoica").trim().slice(0,120) || "AI Stoica";
    const content=String(b.content||"");
    const allowed=new Set(["pdf","docx","pptx","md","txt"]);
    if(!allowed.has(format))return json({error:"Format neacceptat. Folosește PDF, DOCX, PPTX, MD sau TXT."},400);
    if(!content.trim())return json({error:"Nu există conținut de exportat."},400);
    if(content.length>100000)return json({error:"Documentul depășește limita de 100.000 de caractere pentru un singur export."},413);
    let bytes,mime,ext;
    if(format==="pdf"){
      bytes=await makePdf(title,content);mime="application/pdf";ext="pdf";
    }else if(format==="docx"){
      bytes=await makeDocx(title,content);mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document";ext="docx";
    }else if(format==="pptx"){
      bytes=await makePptx(title,content);mime="application/vnd.openxmlformats-officedocument.presentationml.presentation";ext="pptx";
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


  // Desktop compatibility: projects/assistants/plugins/automations are optional cloud features.
  if(p==="/api/projects" && request.method==="GET") return json({data:[]});
  if(p==="/api/assistants" && request.method==="GET") return json({data:[]});
  if(p==="/api/plugins" && request.method==="GET") return json({data:[]});
  if(p==="/api/automations" && request.method==="GET") return json({data:[]});

  if((p==="/api/projects"||p==="/api/assistants"||p==="/api/plugins"||p==="/api/automations") && request.method==="POST"){
    const b=await bodyJson(request);
    return json({data:{id:uuid(),...b,createdAt:now(),updatedAt:now()}});
  }

  const optionalItemMatch=p.match(/^\/api\/(projects|assistants|plugins|automations)\/([^/]+)$/);
  if(optionalItemMatch && (request.method==="PUT"||request.method==="PATCH")){
    const b=await bodyJson(request);
    return json({data:{id:optionalItemMatch[2],...b,updatedAt:now()}});
  }
  if(optionalItemMatch && request.method==="DELETE") return json({ok:true});

  // Compatibility layer for the existing Windows "Biblioteca AI Stoica" UI.
  if(p==="/api/library" && request.method==="GET"){
    const r=await env.DB.prepare(
      "SELECT id,name,mime_type,size,source,created_at FROM files WHERE user_id=? ORDER BY created_at DESC LIMIT 200"
    ).bind(user.id).all();
    return json({data:(r.results||[]).map(x=>({
      id:x.id,name:x.name,mime:x.mime_type,size:Number(x.size||0),
      kind:String(x.mime_type||"").startsWith("image/")?"image":(String(x.mime_type||"").startsWith("text/")?"text":"file"),
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
    const obj=await env.FILES.put(key,request.body,{
      httpMetadata:{contentType:mime},
      customMetadata:{userId:user.id,fileId:id,source:"upload"}
    });
    const size=Number(obj?.size||declared||0);
    if(size>maxBytes){await env.FILES.delete(key);return json({error:"Fișierul depășește limita reală de "+(env.AI_STOICA_FILE_MAX_MB||25)+" MB."},413);}
    await env.DB.prepare(
      "INSERT INTO files(id,user_id,name,mime_type,size,r2_key,source,created_at) VALUES(?,?,?,?,?,?,?,?)"
    ).bind(id,user.id,name,mime,size,key,"upload",createdAt).run();
    return json({data:{
      id,name,mime,size,createdAt,
      kind:mime.startsWith("image/")?"image":(mime.startsWith("text/")?"text":"file")
    }});
  }

  const libMatch=p.match(/^\/api\/library\/([^/]+)$/);
  if(libMatch && request.method==="GET"){
    const row=await ownedFile(env,user.id,libMatch[1]);
    if(!row)return json({error:"Fișierul nu a fost găsit."},404);
    return json({data:{
      id:row.id,name:row.name,mime:row.mime_type,size:Number(row.size||0),
      kind:String(row.mime_type||"").startsWith("image/")?"image":(String(row.mime_type||"").startsWith("text/")?"text":"file"),
      source:row.source||"upload",createdAt:row.created_at
    }});
  }
  if(libMatch && request.method==="DELETE"){
    const row=await ownedFile(env,user.id,libMatch[1]);
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
    headers.set("content-disposition","inline; filename*=UTF-8''"+encodeURIComponent(row.name));
    return new Response(obj.body,{status:200,headers});
  }

  if(p==="/api/memory/toggle" && request.method==="POST"){
    return json({enabled:true});
  }
  if(p==="/api/memory/import-history" && request.method==="POST"){
    return json({ok:true});
  }
  if(p==="/api/memory/capture" && request.method==="POST"){
    const b=await bodyJson(request);
    const text=[String(b.userText||"").trim(),String(b.assistantText||"").trim()].filter(Boolean).join("\n");
    if(text){
      await env.DB.prepare("INSERT INTO memories(id,user_id,text,pinned,source,created_at) VALUES(?,?,?,?,?,?)")
        .bind(uuid(),user.id,text.slice(0,20000),0,"conversation",now()).run();
    }
    return json({ok:true});
  }

  // SSE endpoint expected by the existing Windows UI.
  if(p==="/api/chat/stream" && request.method==="POST"){
    const b=await bodyJson(request);
    const prepared=await chatMessages(env,user,b.messages);
    try{
      const out=await routeAI(env,prepared);
      const payload=JSON.stringify({choices:[{index:0,delta:{content:out.text},finish_reason:"stop"}],model:out.model,provider:out.provider});
      const stream=new ReadableStream({
        start(controller){
          controller.enqueue(enc.encode("data: "+payload+"\n\n"));
          controller.enqueue(enc.encode("data: [DONE]\n\n"));
          controller.close();
        }
      });
      return new Response(stream,{status:200,headers:{...corsHeaders,"content-type":"text/event-stream; charset=utf-8","cache-control":"no-cache"}});
    }catch(e){
      return json({error:e.message},502);
    }
  }

  if(p==="/api/transcribe" && request.method==="POST"){
    return json({error:"Transcrierea vocală cloud va fi activată într-o versiune ulterioară."},501);
  }

  if(p==="/api/conversations" && request.method==="GET"){
    const requestedLimit=Number(url.searchParams.get("limit")||40);
    const limit=Math.max(1,Math.min(200,Number.isFinite(requestedLimit)?requestedLimit:40));
    const before=Number(url.searchParams.get("before")||0);
    const sql=before>0
      ? "SELECT id,title,model,messages_json,summary,created_at,updated_at FROM conversations WHERE user_id=? AND updated_at<? ORDER BY updated_at DESC LIMIT ?"
      : "SELECT id,title,model,messages_json,summary,created_at,updated_at FROM conversations WHERE user_id=? ORDER BY updated_at DESC LIMIT ?";
    const r=before>0
      ? await env.DB.prepare(sql).bind(user.id,before,limit+1).all()
      : await env.DB.prepare(sql).bind(user.id,limit+1).all();
    const rows=(r.results||[]),page=rows.slice(0,limit);
    return json({
      data:page.map(x=>({
        id:x.id,title:x.title,model:x.model,messages:JSON.parse(x.messages_json||"[]"),
        summary:x.summary||"",createdAt:x.created_at,updatedAt:x.updated_at
      })),
      nextBefore:rows.length>limit?Number(page.at(-1)?.updated_at||0):null
    });
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
