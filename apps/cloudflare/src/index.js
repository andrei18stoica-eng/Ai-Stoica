import { PDFDocument, StandardFonts } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { Document, Packer, Paragraph, TextRun } from "docx";
import PptxGenJS from "pptxgenjs";

const enc = new TextEncoder();
// Cloudflare Workers refuse PBKDF2 above 100000 iterations.
const PBKDF2_ITERATIONS = 100000;
const LEGACY_PBKDF2_ITERATIONS = 120000;
const SESSION_MS = 30 * 86400000;
const AUTH_WINDOW_MS = 15 * 60000;
// D1 rows are limited to 2 MB; conversations stay below that with room for the other columns.
const CONVERSATION_MAX_BYTES = 1800000;
const RECENT_ATTACHMENT_MESSAGES = 12;
const NOT_IN_CLOUDFLARE = "Funcția nu este disponibilă în AI Stoica Cloud (Cloudflare). Folosește aplicația desktop sau serverul Hetzner.";
const MSG_PENDING = "Contul așteaptă aprobarea Owner-ului.";
const MSG_INACTIVE = "Contul nu este activ.";
const MSG_TOO_MANY = "Prea multe încercări. Așteaptă 15 minute și încearcă din nou.";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-file-name, x-file-type, x-file-size",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "Access-Control-Expose-Headers": "content-disposition, retry-after",
  "Access-Control-Max-Age": "86400"
};

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders, ...extra }
  });
}

class HttpError extends Error {
  constructor(status, message, headers) { super(message); this.status = status; this.headers = headers; }
}
function fail(status, message, headers) { return new HttpError(status, message, headers); }

function uuid() { return crypto.randomUUID(); }
function now() { return Date.now(); }
function normalizeEmail(v) { return String(v || "").trim().toLowerCase(); }
function hex(bytes) { return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join(""); }
function randomHex(bytes = 32) { const a = new Uint8Array(bytes); crypto.getRandomValues(a); return hex(a); }
async function sha256(v) { return hex(await crypto.subtle.digest("SHA-256", enc.encode(String(v)))); }
function safeEqual(a, b) {
  a = String(a || ""); b = String(b || "");
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
function toBool(value) {
  if (value === true || value === false) return value;
  if (value === "true" || value === 1 || value === "1") return true;
  if (value === "false" || value === 0 || value === "0") return false;
  return undefined;
}
function textInput(value, max) {
  if (value == null) return "";
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v.length > max ? null : v;
}
function intParam(url, name, def, max) {
  const n = Number.parseInt(url.searchParams.get(name) || "", 10);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : def;
}
function safeParseArray(value) {
  try { const v = JSON.parse(value || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(fail(504, message)), ms); })
  ]).finally(() => clearTimeout(timer));
}

async function hashPassword(password, saltHex, iterations = PBKDF2_ITERATIONS) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const salt = Uint8Array.from(saltHex.match(/../g).map(x => parseInt(x, 16)));
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return hex(bits);
}
async function newPasswordFields(password) {
  const salt = randomHex(16);
  return { salt, hash: await hashPassword(password, salt), iterations: PBKDF2_ITERATIONS };
}
const DUMMY_SALT = "00112233445566778899aabbccddeeff";
async function verifyPassword(password, u) {
  if (!u) { await hashPassword(password, DUMMY_SALT); return false; }
  const iterations = Number(u.password_iterations || LEGACY_PBKDF2_ITERATIONS);
  let hash;
  try { hash = await hashPassword(password, u.password_salt, iterations); }
  catch {
    throw fail(500, "Parola acestui cont a fost salvată într-un format pe care Cloudflare nu îl mai acceptă. Owner-ul trebuie să reseteze parola contului cu OWNER_SETUP_CODE (vezi README, „Resetarea parolei”).");
  }
  return safeEqual(hash, u.password_hash);
}
function passwordError(password) {
  if (password.length < 8) return "Parola trebuie să aibă cel puțin 8 caractere.";
  if (password.length > 256) return "Parola poate avea cel mult 256 de caractere.";
  return "";
}

async function createSession(env, userId) {
  const token = randomHex(32);
  const t = now();
  await env.DB.prepare("INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)")
    .bind(await sha256(token), userId, t + SESSION_MS, t).run();
  return token;
}

function bearerToken(request) {
  const raw = request.headers.get("authorization") || "";
  return raw.startsWith("Bearer ") ? raw.slice(7).trim() : "";
}

async function authenticate(request, env) {
  const token = bearerToken(request);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id,u.email,u.name,u.created_at,u.role,u.status,u.memory_enabled,s.token_hash
     FROM sessions s JOIN users u ON u.id=s.user_id
     WHERE s.token_hash=? AND s.expires_at>?`
  ).bind(await sha256(token), now()).first();
  return row || null;
}

function ownerEmail(env) { return normalizeEmail(env.OWNER_EMAIL || ""); }
function isOwnerEmail(env, email) {
  const owner = ownerEmail(env);
  return !!owner && normalizeEmail(email) === owner;
}
// The Owner is the account that holds role "owner" AND matches OWNER_EMAIL; a stale role from an old OWNER_EMAIL grants nothing.
function effectiveRole(env, u) { return u.role === "owner" && isOwnerEmail(env, u.email) ? "owner" : "user"; }

function publicUser(u) {
  return {
    id: u.id, email: u.email, name: u.name, createdAt: u.created_at,
    role: u.role === "owner" ? "owner" : "user", status: u.status || "active",
    memoryEnabled: u.memory_enabled == null ? true : Number(u.memory_enabled) !== 0
  };
}
function inactiveBody(status) { return { error: status === "pending" ? MSG_PENDING : MSG_INACTIVE, status }; }

const PERMISSION_KEYS = ["cerebras", "cloudflare", "groq", "gemini", "image_generation", "document_generation", "file_upload", "github_access"];
const PERMISSION_LABELS = {
  cerebras: "Cerebras", cloudflare: "Cloudflare AI", groq: "Groq", gemini: "Gemini",
  image_generation: "Generare imagini", document_generation: "Generare documente",
  file_upload: "Încărcare fișiere", github_access: "GitHub"
};
function githubEmailAllowed(env, user) {
  const allowed = normalizeEmail(env.GITHUB_ALLOWED_EMAIL || "");
  return !!allowed && normalizeEmail(user.email) === allowed;
}
function permissionsFrom(env, user, row) {
  const owner = user.role === "owner", out = {};
  for (const k of PERMISSION_KEYS) out[k] = owner || !row || row[k] == null ? true : Number(row[k]) !== 0;
  out.github_access = owner || githubEmailAllowed(env, user) || Number(row?.github_access) === 1;
  return out;
}
async function loadPermissions(env, user) {
  if (user.role === "owner") return permissionsFrom(env, user, null);
  const row = await env.DB.prepare("SELECT * FROM user_permissions WHERE user_id=?").bind(user.id).first();
  return permissionsFrom(env, user, row);
}
async function permissionsOf(ctx) {
  if (!ctx.permissions) ctx.permissions = await loadPermissions(ctx.env, ctx.user);
  return ctx.permissions;
}
async function requirePermission(ctx, key) {
  const perms = await permissionsOf(ctx);
  if (perms[key] === false) throw fail(403, `Funcția „${PERMISSION_LABELS[key] || key}” este dezactivată de Owner pentru contul tău.`);
}

function clientIp(request) {
  return String(request.headers.get("cf-connecting-ip") || "unknown").slice(0, 80);
}
function authLimit(env) { return Math.max(1, Number(env.AUTH_ATTEMPTS_PER_15_MIN || 20)); }
async function authRetryAfter(env, request) {
  try {
    const row = await env.DB.prepare("SELECT failures,window_start FROM auth_attempts WHERE key=?").bind("ip:" + clientIp(request)).first();
    if (!row) return 0;
    const left = Number(row.window_start) + AUTH_WINDOW_MS - now();
    return left > 0 && Number(row.failures) >= authLimit(env) ? Math.ceil(left / 1000) : 0;
  } catch { return 0; }
}
// Counts failed sign-ins and every sign-up per IP. The counter is not reset by a successful sign-in,
// so an attacker with one valid account cannot keep guessing other passwords from the same IP.
async function recordAuthAttempt(env, request) {
  try {
    await env.DB.prepare(
      `INSERT INTO auth_attempts(key,failures,window_start) VALUES(?,1,?)
       ON CONFLICT(key) DO UPDATE SET
         failures=CASE WHEN excluded.window_start-auth_attempts.window_start>? THEN 1 ELSE auth_attempts.failures+1 END,
         window_start=CASE WHEN excluded.window_start-auth_attempts.window_start>? THEN excluded.window_start ELSE auth_attempts.window_start END`
    ).bind("ip:" + clientIp(request), now(), AUTH_WINDOW_MS, AUTH_WINDOW_MS).run();
  } catch (e) { console.error("auth_attempts:", e?.message || e); }
}
function tooMany(seconds) { return json({ error: MSG_TOO_MANY }, 429, { "Retry-After": String(seconds) }); }

async function bodyJson(request) {
  try { const v = await request.json(); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch { return {}; }
}

function safeFileName(value) {
  return String(value || "file").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 180) || "file";
}
function cleanMime(value) {
  const v = String(value || "").split(";")[0].trim().toLowerCase().slice(0, 120);
  return /^[a-z0-9][\w.+-]*\/[\w.+-]+$/.test(v) ? v : "application/octet-stream";
}
function fileKind(mime) {
  const m = String(mime || "");
  return m.startsWith("image/") ? "image" : m.startsWith("text/") ? "text" : "file";
}

function bytesToBase64(bytes) {
  let out = "";
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i += 0x8000) out += String.fromCharCode(...arr.subarray(i, Math.min(i + 0x8000, arr.length)));
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
  return { id: row.id, name: row.name, mimeType: row.mime_type, size: Number(row.size || 0), source: row.source || "upload", createdAt: row.created_at };
}
function libraryItem(row) {
  return {
    id: row.id, name: row.name, mime: row.mime_type, size: Number(row.size || 0),
    kind: fileKind(row.mime_type), source: row.source || "upload", createdAt: row.created_at
  };
}

async function ownedFile(env, userId, id) {
  return env.DB.prepare(
    "SELECT id,user_id,name,mime_type,size,r2_key,source,created_at,extracted_text FROM files WHERE id=? AND user_id=?"
  ).bind(String(id), userId).first();
}

async function insertFileRow(env, row) {
  try {
    await env.DB.prepare(
      "INSERT INTO files(id,user_id,name,mime_type,size,r2_key,source,created_at) VALUES(?,?,?,?,?,?,?,?)"
    ).bind(row.id, row.userId, row.name, row.mime, row.size, row.key, row.source, row.createdAt).run();
  } catch (e) {
    await env.FILES.delete(row.key).catch(() => {});
    throw e;
  }
}

async function storeFile(env, userId, { name, mimeType, bytes, source = "generated" }) {
  const id = uuid(), clean = safeFileName(name), key = userId + "/" + id + "/" + clean, mime = mimeType || "application/octet-stream";
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  await env.FILES.put(key, data, { httpMetadata: { contentType: mime }, customMetadata: { userId, fileId: id, source } });
  const createdAt = now();
  await insertFileRow(env, { id, userId, name: clean, mime, size: data.byteLength, key, source, createdAt });
  return { id, name: clean, mimeType: mime, size: data.byteLength, source, createdAt };
}

function maxUploadMb(env) { return Math.max(1, Number(env.AI_STOICA_FILE_MAX_MB || 25)); }
async function saveUpload(env, user, request, name, mime) {
  const maxMb = maxUploadMb(env), maxBytes = maxMb * 1024 * 1024;
  const tooLarge = () => fail(413, "Fișierul depășește limita de " + maxMb + " MB.");
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > maxBytes) throw tooLarge();
  if (!request.body) throw fail(400, "Lipsește conținutul fișierului.");
  let body = request.body;
  if (!declared) {
    const buf = await request.arrayBuffer();
    if (!buf.byteLength) throw fail(400, "Lipsește conținutul fișierului.");
    if (buf.byteLength > maxBytes) throw tooLarge();
    body = buf;
  }
  const id = uuid(), key = user.id + "/" + id + "/" + name, createdAt = now();
  const obj = await env.FILES.put(key, body, { httpMetadata: { contentType: mime }, customMetadata: { userId: user.id, fileId: id, source: "upload" } });
  const size = Number(obj?.size ?? declared ?? 0);
  if (size > maxBytes) { await env.FILES.delete(key); throw tooLarge(); }
  await insertFileRow(env, { id, userId: user.id, name, mime, size, key, source: "upload", createdAt });
  return { id, name, mimeType: mime, size, source: "upload", createdAt };
}

const TEXT_EXTENSIONS = /\.(txt|md|json|js|jsx|ts|tsx|css|html|xml|csv|log|py|java|c|cpp|h|sql|yaml|yml)$/i;
async function fileToText(env, row) {
  if (typeof row.extracted_text === "string") return row.extracted_text;
  const obj = await env.FILES.get(row.r2_key);
  if (!obj) return "[Fișierul " + row.name + " nu mai există în stocare.]";
  const buffer = await obj.arrayBuffer();
  const mime = String(row.mime_type || "");
  let text = "";
  if (mime.startsWith("text/") || TEXT_EXTENSIONS.test(row.name)) {
    text = new TextDecoder().decode(buffer).slice(0, 180000);
  } else {
    try {
      const converted = await withTimeout(env.AI.toMarkdown(
        { name: row.name, blob: new Blob([buffer], { type: mime || "application/octet-stream" }) },
        { conversionOptions: { output: { format: "text" }, pdf: { metadata: false } } }
      ), 60000, "Conversia fișierului a durat prea mult.");
      const item = Array.isArray(converted) ? converted[0] : converted;
      if (item?.data) text = String(item.data).slice(0, 180000);
      else return "[Fișier " + row.name + " încărcat, dar conversia automată nu a reușit" + (item?.error ? ": " + String(item.error).slice(0, 300) : ".") + "]";
    } catch (e) {
      return "[Fișier " + row.name + " încărcat, dar conversia automată nu a reușit: " + e.message + "]";
    }
  }
  try { await env.DB.prepare("UPDATE files SET extracted_text=? WHERE id=?").bind(text, row.id).run(); } catch {}
  return text;
}

function messageText(m) {
  if (typeof m.content === "string") return m.content;
  if (Array.isArray(m.content)) return m.content.filter(x => x?.type === "text").map(x => String(x.text || "")).join("\n");
  return String(m.content ?? "");
}

// Only the user's recent attachments are read again; older ones and the files the assistant produced become a short note.
async function expandAttachmentMessages(env, userId, messages) {
  const src = (Array.isArray(messages) ? messages : []).filter(m => m && ["user", "assistant", "system"].includes(m.role));
  const recentFrom = Math.max(0, src.length - RECENT_ATTACHMENT_MESSAGES);
  const out = [];
  for (let i = 0; i < src.length; i++) {
    const m = src[i];
    let content = messageText(m);
    const attachments = m.role === "user" && Array.isArray(m.attachments) ? m.attachments.slice(0, 6) : [];
    for (const a of attachments) {
      const fileId = a?.libraryId || a?.id;
      if (!fileId) continue;
      if (i < recentFrom) { content += "\n\n[Fișier atașat anterior: " + String(a?.name || "fișier").slice(0, 180) + "]"; continue; }
      const row = await ownedFile(env, userId, fileId);
      if (!row) continue;
      content += "\n\n===== FIȘIER ATAȘAT: " + row.name + " =====\n" + await fileToText(env, row) + "\n===== SFÂRȘIT FIȘIER =====";
    }
    if (content.trim()) out.push({ role: m.role, content });
  }
  return out;
}

const WIN_ANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
function pdfFallbackText(value) {
  return String(value || "")
    .replace(/[ăĂ]/g, m => m === "ă" ? "a" : "A")
    .replace(/[âÂ]/g, m => m === "â" ? "a" : "A")
    .replace(/[îÎ]/g, m => m === "î" ? "i" : "I")
    .replace(/[șşȘŞ]/g, m => /[șş]/.test(m) ? "s" : "S")
    .replace(/[țţȚŢ]/g, m => /[țţ]/.test(m) ? "t" : "T")
    .replace(/[–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/→/g, "->").replace(/←/g, "<-").replace(/[✓✔]/g, "v").replace(/[✗✘]/g, "x")
    .replace(/[^\x20-\x7e\xa0-\xff]/g, ch => WIN_ANSI_EXTRA.includes(ch) ? ch : "?");
}

function wrapPdfLine(line, max = 92) {
  const words = String(line || "").split(/\s+/).flatMap(w => w.length > max ? w.match(new RegExp(".{1," + max + "}", "g")) : [w]);
  const lines = [];
  let cur = "";
  for (const word of words) {
    if ((cur + " " + word).trim().length > max && cur) { lines.push(cur); cur = word; }
    else cur = (cur + " " + word).trim();
  }
  if (cur || !lines.length) lines.push(cur);
  return lines;
}

const PDF_FONTS = [
  "https://raw.githubusercontent.com/notofonts/notofonts.github.io/main/fonts/NotoSans/hinted/ttf/NotoSans-Regular.ttf",
  "https://raw.githubusercontent.com/notofonts/notofonts.github.io/main/fonts/NotoSans/hinted/ttf/NotoSans-Bold.ttf"
];
let pdfFontsPromise = null;
async function fetchFont(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error("Font Unicode HTTP " + r.status);
  return new Uint8Array(await r.arrayBuffer());
}
function loadUnicodePdfFonts() {
  if (!pdfFontsPromise) pdfFontsPromise = Promise.all(PDF_FONTS.map(fetchFont)).catch(e => { pdfFontsPromise = null; throw e; });
  return pdfFontsPromise;
}

async function makePdf(title, content) {
  const pdf = await PDFDocument.create();
  let font, titleFont, unicode = true;
  try {
    pdf.registerFontkit(fontkit);
    const [regular, bold] = await loadUnicodePdfFonts();
    font = await pdf.embedFont(regular, { subset: true });
    titleFont = await pdf.embedFont(bold, { subset: true });
  } catch {
    unicode = false;
    font = await pdf.embedFont(StandardFonts.Helvetica);
    titleFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  }
  let page = pdf.addPage([595.28, 841.89]);
  let y = 790;
  const addText = (text, fontRef, size) => {
    for (const raw of String(text || "").replace(/\r/g, "").replace(/\t/g, "    ").split("\n")) {
      const prepared = unicode ? raw.replace(/[\u0000-\u001f]/g, "") : pdfFallbackText(raw);
      for (const line of wrapPdfLine(prepared, size >= 16 ? 66 : 92)) {
        if (y < 55) { page = pdf.addPage([595.28, 841.89]); y = 790; }
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
    new Paragraph({ children: [new TextRun({ text: String(title || "AI Stoica"), bold: true, size: 32 })] }),
    new Paragraph({ text: "" }),
    ...String(content || "").split("\n").map(line => new Paragraph({ children: [new TextRun({ text: line, size: 22 })] }))
  ];
  const doc = new Document({ sections: [{ properties: {}, children }] });
  return new Uint8Array(await Packer.toBuffer(doc));
}

function splitForSlides(content, maxCharacters = 900) {
  const paragraphs = String(content || "").split(/\n\s*\n/).map(x => x.trim()).filter(Boolean);
  const chunks = [];
  let current = "";
  for (const paragraph of paragraphs.length ? paragraphs : [String(content || "")]) {
    for (const word of paragraph.split(/\s+/)) {
      const candidate = (current + " " + word).trim();
      if (candidate.length > maxCharacters && current) { chunks.push(current); current = word; }
      else current = candidate;
    }
    if (current && current.length > maxCharacters * 0.6) { chunks.push(current); current = ""; }
    else if (current) current += "\n\n";
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
  const slide = pptx.addSlide();
  slide.background = { color: "F7F9FC" };
  slide.addText(String(title || "AI Stoica"), { x: 0.8, y: 2.35, w: 11.7, h: 0.8, fontFace: "Aptos Display", fontSize: 28, bold: true, color: "172033", align: "center", margin: 0 });
  slide.addText("Document generat cu AI Stoica", { x: 1.2, y: 3.25, w: 10.9, h: 0.45, fontFace: "Aptos", fontSize: 14, color: "52627A", align: "center", margin: 0 });
  splitForSlides(content).forEach((chunk, index) => {
    const s = pptx.addSlide();
    s.background = { color: "FFFFFF" };
    s.addText(index === 0 ? String(title || "AI Stoica") : String(title || "AI Stoica") + " – continuare", { x: 0.65, y: 0.45, w: 12.0, h: 0.55, fontFace: "Aptos Display", fontSize: 23, bold: true, color: "172033", margin: 0 });
    s.addText(chunk, { x: 0.75, y: 1.25, w: 11.8, h: 5.65, fontFace: "Aptos", fontSize: 18, color: "26354A", breakLine: false, valign: "top", margin: 0.08, fit: "shrink" });
  });
  return new Uint8Array(await pptx.write({ outputType: "arraybuffer" }));
}

async function githubApi(env, suffix, options = {}) {
  if (!env.GITHUB_TOKEN) throw fail(503, "GitHub nu este configurat în AI Stoica Cloud (lipsește secretul GITHUB_TOKEN).");
  const repo = env.GITHUB_REPO || "andrei18stoica-eng/Ai-Stoica";
  let r;
  try {
    r = await fetch("https://api.github.com/repos/" + repo + suffix, {
      ...options,
      signal: AbortSignal.timeout(30000),
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": "Bearer " + env.GITHUB_TOKEN,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "AI-Stoica",
        ...(options.headers || {})
      }
    });
  } catch (e) { throw fail(504, "GitHub nu răspunde: " + e.message); }
  const textBody = await r.text();
  let data; try { data = JSON.parse(textBody); } catch { data = { message: textBody }; }
  if (!r.ok) {
    const status = r.status === 404 ? 404 : r.status === 409 || r.status === 422 ? 409 : 502;
    throw fail(status, "GitHub HTTP " + r.status + ": " + String(data?.message || textBody).slice(0, 200));
  }
  return data;
}
function githubPath(value) {
  const path = String(value || "").trim().replace(/^\/+/, "");
  if (!path) throw fail(400, "Lipsește calea fișierului GitHub.");
  if (path.length > 500 || path.split("/").some(x => x === ".." || x === "")) throw fail(400, "Calea fișierului GitHub nu este validă.");
  return path;
}
function githubRef(value, env) {
  const ref = String(value || env.GITHUB_BRANCH || "main").trim();
  if (!/^[\w./-]{1,200}$/.test(ref)) throw fail(400, "Numele ramurii GitHub nu este valid.");
  return ref;
}
async function requireGithub(ctx) {
  if ((await permissionsOf(ctx)).github_access) return;
  throw fail(403, "Funcțiile GitHub nu sunt autorizate pentru acest cont.");
}

function performanceContext(messages, maxMessages = 80, maxChars = 300000) {
  const src = (Array.isArray(messages) ? messages : []).filter(m => m && typeof m.content === "string" && m.content.trim());
  const out = [];
  let chars = 0;
  for (let i = src.length - 1; i >= 0 && out.length < maxMessages; i--) {
    const m = src[i];
    if (chars + m.content.length > maxChars) {
      if (!out.length) out.unshift({ role: m.role, content: m.content.slice(0, maxChars) });
      break;
    }
    chars += m.content.length;
    out.unshift(m);
  }
  return out;
}

function normalizeMemoryText(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}
function memoryCategory(text) {
  const t = normalizeMemoryText(text);
  if (/prefer|imi place|nu vreau|vreau sa fie|stil|format/.test(t)) return "preferință";
  if (/proiect|lucrez|aplicatie|site|firma|primarie|scoala/.test(t)) return "proiect";
  if (/am decis|decizie|ramane|aleg|folosim|vom folosi/.test(t)) return "decizie";
  return "detaliu";
}
const EXPLICIT_MEMORY = /(^|[^a-z])(tine minte|retine|memoreaza|noteaza(-ti)?|sa nu uiti|nu uita|remember|keep in mind)([^a-z]|$)/;
const REQUEST_START = /^(te rog[, ]+)?(fa|fa-mi|faceti|scrie|scrie-mi|genereaza|creeaza|da-mi|trimite|spune|spune-mi|explica|explica-mi|rezuma|rezuma-mi|tradu|traduce|calculeaza|cauta|verifica|arata|arata-mi|ajuta|ajuta-ma|poti|puteti|as vrea|vreau (sa|un|o|niste)|ce|cum|cand|unde|cine|care|de ce|cat|cati|cate)([^a-z]|$)/;
const DURABLE_FACT = /(^|[^a-z])(prefer|imi place|nu imi place|nu-mi place|ma numesc|numele meu|locuiesc|stau in|sunt din|sunt de profesie|lucrez (la|ca|in|pentru)|firma mea|compania mea|afacerea mea|proiectul meu|am decis|decizia (mea|noastra)|de acum (inainte|incolo)|intotdeauna|mereu sa|niciodata sa|folosesc (mereu|de obicei|zilnic)|obiectivul meu|scopul meu|limba mea|stilul meu|vreau ca (ai stoica|tu|raspunsurile|raspunsul)|raspunde(-mi)? (mereu|intotdeauna|doar|numai))([^a-z]|$)/;
function durableMemoryCandidate(userText) {
  const clean = String(userText || "").trim();
  if (clean.length < 12) return "";
  const t = normalizeMemoryText(clean);
  if (EXPLICIT_MEMORY.test(t)) return clean.slice(0, 1800);
  if (clean.includes("?") || clean.length > 600 || REQUEST_START.test(t)) return "";
  return DURABLE_FACT.test(t) ? clean.slice(0, 1800) : "";
}
function publicMemory(x) {
  return { id: x.id, text: x.text, pinned: !!x.pinned, source: x.source, category: memoryCategory(x.text), createdAt: x.created_at, updatedAt: x.updated_at || x.created_at };
}
async function addMemory(env, userId, text, source, pinned = false) {
  const existing = (await env.DB.prepare("SELECT id,text FROM memories WHERE user_id=? ORDER BY created_at DESC LIMIT 2000").bind(userId).all()).results || [];
  const normalized = normalizeMemoryText(text);
  const same = existing.find(m => normalizeMemoryText(m.text) === normalized);
  const t = now();
  if (same) {
    await env.DB.prepare("UPDATE memories SET updated_at=?,pinned=CASE WHEN ? THEN 1 ELSE pinned END WHERE id=?").bind(t, pinned ? 1 : 0, same.id).run();
    return { stored: false, row: await env.DB.prepare("SELECT * FROM memories WHERE id=?").bind(same.id).first() };
  }
  const row = { id: uuid(), user_id: userId, text, pinned: pinned ? 1 : 0, source, created_at: t, updated_at: t };
  await env.DB.prepare("INSERT INTO memories(id,user_id,text,pinned,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
    .bind(row.id, userId, text, row.pinned, source, t, t).run();
  return { stored: true, row };
}

async function relevantMemories(env, userId, latest, limit = 16) {
  const rows = await env.DB.prepare(
    "SELECT id,text,pinned,source,created_at FROM memories WHERE user_id=? ORDER BY pinned DESC,(source='manual') DESC,created_at DESC LIMIT 200"
  ).bind(userId).all();
  const words = [...new Set(normalizeMemoryText(latest).match(/[a-z0-9]{4,}/g) || [])];
  return (rows.results || [])
    .map(m => {
      const h = normalizeMemoryText(m.text);
      let score = m.pinned ? 20 : 0;
      for (const w of words) if (h.includes(w)) score += 2;
      return { ...m, score };
    })
    .filter(m => m.score > 0 || m.pinned)
    .sort((a, b) => b.score - a.score || b.created_at - a.created_at)
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
  if (Array.isArray(data.output)) return data.output.flatMap(x => x?.content || []).map(x => x?.text || x?.content || "").join("").trim();
  return "";
}
function temperature(env) { const t = Number(env.AI_STOICA_TEMPERATURE); return Number.isFinite(t) ? t : 0.35; }

async function callCloudflare(env, messages, model) {
  const selectedModel = model || env.CF_MODEL || "@cf/nvidia/nemotron-3-120b-a12b";
  const result = await withTimeout(env.AI.run(selectedModel, {
    messages,
    max_tokens: Number(env.AI_STOICA_MAX_OUTPUT || 4096),
    temperature: temperature(env)
  }), 120000, "Cloudflare AI nu a răspuns la timp.");
  const text = extractText(result);
  if (!text) throw new Error("Cloudflare AI a răspuns fără text.");
  return { text, provider: "cloudflare", model: selectedModel };
}

async function callOpenAICompatible({ baseUrl, apiKey, model, messages, provider, maxOutput, temp }) {
  const r = await fetch(baseUrl.replace(/\/+$/, "") + "/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, temperature: temp, max_tokens: maxOutput }),
    signal: AbortSignal.timeout(90000)
  });
  const textBody = await r.text();
  if (!r.ok) throw new Error(`${provider} HTTP ${r.status}: ${textBody.slice(0, 300)}`);
  let data; try { data = JSON.parse(textBody); } catch { data = {}; }
  const text = extractText(data);
  if (!text) throw new Error(`${provider} a răspuns fără text.`);
  return { text, provider, model };
}

async function routeAI(env, messages, perms = {}) {
  const errors = [], allowed = p => perms[p] !== false;
  const maxOutput = Number(env.AI_STOICA_MAX_OUTPUT || 4096), temp = temperature(env);
  let tried = 0;
  if (env.CEREBRAS_API_KEY && allowed("cerebras")) {
    tried++;
    try {
      return await callOpenAICompatible({ provider: "cerebras", baseUrl: "https://api.cerebras.ai/v1", apiKey: env.CEREBRAS_API_KEY, model: env.CEREBRAS_MODEL || "gpt-oss-120b", messages, maxOutput, temp });
    } catch (e) { errors.push("Cerebras: " + e.message); }
  }
  if (allowed("cloudflare")) {
    const primaryModel = env.CF_MODEL || "@cf/nvidia/nemotron-3-120b-a12b";
    const cloudflareFallback = env.CF_FALLBACK_MODEL || "@cf/openai/gpt-oss-120b";
    for (const model of [...new Set([primaryModel, cloudflareFallback].filter(Boolean))]) {
      tried++;
      try { return await callCloudflare(env, messages, model); }
      catch (e) { errors.push("Cloudflare " + model + ": " + e.message); }
    }
  }
  const fallbacks = [
    env.GROQ_API_KEY && { provider: "groq", baseUrl: "https://api.groq.com/openai/v1", apiKey: env.GROQ_API_KEY, model: env.GROQ_MODEL || "openai/gpt-oss-120b" },
    env.GEMINI_API_KEY && { provider: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || "gemini-2.5-pro" }
  ].filter(p => p && allowed(p.provider));
  for (const p of fallbacks) {
    tried++;
    try { return await callOpenAICompatible({ ...p, messages, maxOutput, temp }); }
    catch (e) { errors.push(p.provider + ": " + e.message); }
  }
  if (!tried) throw fail(403, "Niciun motor AI nu este permis pentru contul tău. Contactează Owner-ul.");
  throw fail(502, "Toate motoarele AI au eșuat. " + errors.join(" | "));
}

async function itemData(env, userId, kind, id) {
  if (typeof id !== "string" || !id) return null;
  const row = await env.DB.prepare("SELECT data_json FROM user_items WHERE id=? AND user_id=? AND kind=?").bind(id, userId, kind).first();
  if (!row) return null;
  try { return JSON.parse(row.data_json); } catch { return null; }
}

async function chatMessages(env, user, incoming, { projectId, assistantId } = {}) {
  const expanded = await expandAttachmentMessages(env, user.id, incoming);
  const raw = performanceContext(expanded, Number(env.AI_STOICA_MAX_HISTORY || 80), Number(env.AI_STOICA_MAX_CONTEXT_CHARS || 300000));
  const latest = [...raw].reverse().find(m => m.role === "user")?.content || "";
  const memoryOn = user.memory_enabled == null || Number(user.memory_enabled) !== 0;
  const memories = memoryOn ? await relevantMemories(env, user.id, latest, 16) : [];
  const assistant = await itemData(env, user.id, "assistant", assistantId);
  const project = await itemData(env, user.id, "project", projectId);
  const system = [
    "Ești AI Stoica, asistentul principal Stoica Enterprises AI.",
    "Răspunde în limba utilizatorului, riguros, clar și complet.",
    "Folosește capacitatea maximă de raționament disponibilă. Nu simplifica doar pentru a economisi resurse.",
    "Când utilizatorul cere PDF, DOCX sau PPTX, redactează conținutul normal. Nu afișa pseudo-comenzi precum <invoke generate_pdf>; aplicația creează fișierul real separat.",
    assistant?.systemPrompt ? "Instrucțiunile asistentului „" + assistant.name + "”:\n" + assistant.systemPrompt : "",
    project?.instructions ? "Instrucțiunile proiectului „" + project.name + "”:\n" + project.instructions : "",
    memories.length ? "Memorie relevantă:\n" + memories.map((m, i) => `${i + 1}. ${m.text}`).join("\n") : ""
  ].filter(Boolean).join("\n\n");
  return [{ role: "system", content: system }, ...raw.filter(m => m.role !== "system")];
}

const PENDING_REGISTRATION = { ok: true, status: "pending", message: "Cererea a fost trimisă. Dacă adresa este nouă, contul așteaptă aprobarea Owner-ului; dacă ai deja cont, autentifică-te." };

async function handleAuthRegister({ request, env }) {
  const b = await bodyJson(request);
  const email = normalizeEmail(b.email), password = String(b.password || ""), name = String(b.name || "").trim();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Adresa de email nu este validă." }, 400);
  const pwError = passwordError(password);
  if (pwError) return json({ error: pwError }, 400);
  if (name.length > 100) return json({ error: "Numele poate avea cel mult 100 de caractere." }, 400);
  const wait = await authRetryAfter(env, request);
  if (wait) return tooMany(wait);
  await recordAuthAttempt(env, request);
  const owner = isOwnerEmail(env, email);
  const open = String(env.OPEN_REGISTRATION || "").toLowerCase() === "true";
  const exists = await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first();
  if (owner) {
    if (exists) return json({ error: "Contul Owner există deja. Autentifică-te sau resetează parola cu OWNER_SETUP_CODE." }, 409);
    const code = String(env.OWNER_SETUP_CODE || "");
    if (!code) return json({ error: "Contul Owner se creează doar cu codul de configurare. Setează secretul OWNER_SETUP_CODE în Cloudflare (vezi README)." }, 403);
    if (!safeEqual(String(b.setupCode || "").trim(), code)) return json({ error: "Codul de configurare Owner este greșit." }, 403);
  } else if (exists) {
    return open ? json({ error: "Există deja un cont cu acest email." }, 409) : json(PENDING_REGISTRATION, 202);
  }
  const active = owner || open;
  const pw = await newPasswordFields(password);
  const user = { id: uuid(), email, name: name || email.split("@")[0], created_at: now(), role: owner ? "owner" : "user", status: active ? "active" : "pending", memory_enabled: 1 };
  await env.DB.prepare(
    "INSERT INTO users(id,email,name,password_hash,password_salt,password_iterations,created_at,role,status,approved_at) VALUES(?,?,?,?,?,?,?,?,?,?)"
  ).bind(user.id, user.email, user.name, pw.hash, pw.salt, pw.iterations, user.created_at, user.role, user.status, active ? user.created_at : null).run();
  if (!active) return json(PENDING_REGISTRATION, 202);
  const token = await createSession(env, user.id);
  user.role = effectiveRole(env, user);
  return json({ token, user: publicUser(user), permissions: await loadPermissions(env, user) });
}

async function handleAuthLogin({ request, env }) {
  const b = await bodyJson(request), email = normalizeEmail(b.email), password = String(b.password || "");
  const wait = await authRetryAfter(env, request);
  if (wait) return tooMany(wait);
  const u = email ? await env.DB.prepare("SELECT * FROM users WHERE email=?").bind(email).first() : null;
  if (!(await verifyPassword(password, u))) {
    await recordAuthAttempt(env, request);
    return json({ error: "Email sau parolă incorectă." }, 401);
  }
  if (Number(u.password_iterations || LEGACY_PBKDF2_ITERATIONS) !== PBKDF2_ITERATIONS) {
    const pw = await newPasswordFields(password);
    await env.DB.prepare("UPDATE users SET password_hash=?,password_salt=?,password_iterations=? WHERE id=?").bind(pw.hash, pw.salt, pw.iterations, u.id).run();
  }
  // A legacy active account with OWNER_EMAIL becomes Owner; a pending account with that email stays pending.
  if (isOwnerEmail(env, u.email) && u.role !== "owner" && u.status === "active") {
    await env.DB.prepare("UPDATE users SET role='owner',approved_at=COALESCE(approved_at,?) WHERE id=?").bind(now(), u.id).run();
    u.role = "owner";
  }
  if (u.status !== "active") return json(inactiveBody(u.status), 403);
  const t = now();
  await env.DB.prepare("DELETE FROM sessions WHERE user_id=? AND expires_at<=?").bind(u.id, t).run();
  await env.DB.prepare("UPDATE users SET last_login_at=? WHERE id=?").bind(t, u.id).run();
  const token = await createSession(env, u.id);
  u.role = effectiveRole(env, u);
  return json({ token, user: publicUser(u), permissions: await loadPermissions(env, u) });
}

async function handleResetPassword({ request, env }) {
  const b = await bodyJson(request), email = normalizeEmail(b.email), password = String(b.password || "");
  const wait = await authRetryAfter(env, request);
  if (wait) return tooMany(wait);
  const code = String(env.OWNER_SETUP_CODE || "");
  if (!code) return json({ error: "Resetarea parolei necesită secretul OWNER_SETUP_CODE în Cloudflare (vezi README)." }, 403);
  if (!safeEqual(String(b.setupCode || "").trim(), code)) {
    await recordAuthAttempt(env, request);
    return json({ error: "Codul de configurare Owner este greșit." }, 403);
  }
  const pwError = passwordError(password);
  if (pwError) return json({ error: pwError }, 400);
  const u = email ? await env.DB.prepare("SELECT id,email FROM users WHERE email=?").bind(email).first() : null;
  if (!u) return json({ error: "Contul nu a fost găsit." }, 404);
  const pw = await newPasswordFields(password), t = now();
  if (isOwnerEmail(env, u.email)) {
    await env.DB.prepare("UPDATE users SET password_hash=?,password_salt=?,password_iterations=?,role='owner',status='active',approved_at=COALESCE(approved_at,?) WHERE id=?")
      .bind(pw.hash, pw.salt, pw.iterations, t, u.id).run();
  } else {
    await env.DB.prepare("UPDATE users SET password_hash=?,password_salt=?,password_iterations=? WHERE id=?").bind(pw.hash, pw.salt, pw.iterations, u.id).run();
  }
  await env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(u.id).run();
  return json({ ok: true });
}

function conversationBytes(messages) { return enc.encode(JSON.stringify(messages)).length; }
function publicConversation(x, withMessages = true) {
  const out = {
    id: x.id, title: x.title, model: x.model, summary: x.summary || "",
    projectId: x.project_id || null, assistantId: x.assistant_id || null,
    createdAt: x.created_at, updatedAt: x.updated_at
  };
  if (withMessages) out.messages = safeParseArray(x.messages_json);
  else out.messageCount = Number(x.message_count || 0);
  return out;
}
function conversationFields(b, old) {
  const has = k => Object.hasOwn(b, k);
  const out = {};
  if (!old || has("title")) {
    const title = textInput(b.title, 200);
    if (title === null) throw fail(400, "Titlul conversației poate avea cel mult 200 de caractere.");
    out.title = title || (old ? old.title : "Conversație nouă");
  }
  if (has("model")) {
    if (b.model != null && (typeof b.model !== "string" || b.model.length > 200)) throw fail(400, "Modelul nu este valid.");
    out.model = b.model || null;
  }
  if (has("messages")) {
    if (!Array.isArray(b.messages)) throw fail(400, "Câmpul „messages” trebuie să fie o listă.");
    out.messages = b.messages.filter(m => m && typeof m === "object");
    if (conversationBytes(out.messages) > CONVERSATION_MAX_BYTES) throw fail(413, "Conversația a ajuns la limita de stocare Cloudflare (1,8 MB). Începe o conversație nouă.");
  }
  for (const [key, column] of [["projectId", "project_id"], ["assistantId", "assistant_id"]]) {
    if (!has(key)) continue;
    if (b[key] != null && (typeof b[key] !== "string" || b[key].length > 100)) throw fail(400, "Identificatorul „" + key + "” nu este valid.");
    out[column] = b[key] || null;
  }
  return out;
}

const ITEM_KINDS = {
  projects: {
    kind: "project", notFound: "Proiectul nu a fost găsit.",
    fields: [
      ["name", 120, true, "Numele proiectului este obligatoriu.", "Numele proiectului poate avea cel mult 120 de caractere."],
      ["instructions", 12000, false, "", "Instrucțiunile proiectului pot avea cel mult 12.000 de caractere."]
    ]
  },
  assistants: {
    kind: "assistant", notFound: "Asistentul nu a fost găsit.",
    fields: [
      ["name", 80, true, "Numele asistentului este obligatoriu.", "Numele asistentului poate avea cel mult 80 de caractere."],
      ["systemPrompt", 12000, false, "", "Instrucțiunile asistentului pot avea cel mult 12.000 de caractere."]
    ]
  }
};
function itemFromRow(row) {
  let data = {};
  try { data = JSON.parse(row.data_json || "{}"); } catch {}
  return { ...data, id: row.id, userId: row.user_id, createdAt: row.created_at, updatedAt: row.updated_at };
}
function itemFields(spec, b, current) {
  const out = { ...(current || {}) };
  for (const [key, max, required, missing, tooLong] of spec.fields) {
    if (current && !Object.hasOwn(b, key)) continue;
    const v = textInput(b[key], max);
    if (v === null) throw fail(400, tooLong);
    if (required && !v) throw fail(400, missing);
    out[key] = v;
  }
  if (spec.kind === "assistant") { out.icon = (out.name || "A")[0].toUpperCase(); out.builtIn = false; }
  return out;
}

const routes = [];
function route(method, path, handler, opts = {}) {
  const keys = [];
  const regex = new RegExp("^" + path.replace(/\//g, "\\/").replace(/:(\w+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "$");
  routes.push({ method, regex, keys, handler, ...opts });
}
const unavailable = () => json({ error: NOT_IN_CLOUDFLARE }, 501);

route("GET", "/health", () => json({ ok: true, service: "AI Stoica Cloudflare", mode: "performance-max", omni: true, cloud: true }), { public: true });
route("POST", "/auth/register", handleAuthRegister, { public: true });
route("POST", "/auth/login", handleAuthLogin, { public: true });
route("POST", "/auth/reset-password", handleResetPassword, { public: true });
route("POST", "/auth/logout", async ({ env, user }) => {
  await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(user.token_hash).run();
  return json({ ok: true });
}, { allowInactive: true });
route("GET", "/auth/me", async ({ request, env, user }) => {
  await env.DB.prepare("UPDATE sessions SET expires_at=? WHERE token_hash=?").bind(now() + SESSION_MS, user.token_hash).run();
  return json({ token: bearerToken(request), user: publicUser(user), permissions: await loadPermissions(env, user) });
});

route("GET", "/api/admin/users", async ({ env, url }) => {
  const limit = intParam(url, "limit", 500, 1000), offset = intParam(url, "offset", 0, 1e9);
  const r = await env.DB.prepare(
    `SELECT u.id,u.email,u.name,u.role,u.status,u.created_at,u.approved_at,u.last_login_at,
            p.cerebras,p.cloudflare,p.groq,p.gemini,p.image_generation,p.document_generation,p.file_upload,p.github_access,
            (SELECT COUNT(*) FROM sessions s WHERE s.user_id=u.id AND s.expires_at>?) AS active_sessions
     FROM users u LEFT JOIN user_permissions p ON p.user_id=u.id
     ORDER BY u.created_at DESC LIMIT ? OFFSET ?`
  ).bind(now(), limit, offset).all();
  return json({ data: (r.results || []).map(u => {
    const role = effectiveRole(env, u);
    const sessions = Number(u.active_sessions || 0);
    return {
      ...publicUser({ ...u, role }), approvedAt: u.approved_at, lastLoginAt: u.last_login_at, activeSessions: sessions,
      created_at: u.created_at, approved_at: u.approved_at, last_login_at: u.last_login_at, active_sessions: sessions,
      permissions: permissionsFrom(env, { ...u, role }, u)
    };
  }) });
}, { owner: true });

async function adminTarget(env, id) {
  const target = await env.DB.prepare("SELECT id,email,role FROM users WHERE id=?").bind(id).first();
  if (!target) throw fail(404, "Utilizator inexistent.");
  return target;
}
route("PATCH", "/api/admin/users/:id/status", async ({ request, env, params, user }) => {
  const b = await bodyJson(request), status = String(b.status || "");
  if (!["pending", "active", "rejected", "suspended", "blocked"].includes(status)) return json({ error: "Status invalid." }, 400);
  const target = await adminTarget(env, params.id);
  if (isOwnerEmail(env, target.email)) return json({ error: "Contul Owner nu poate fi modificat din aplicație." }, 400);
  // Any role "owner" left here belongs to an old OWNER_EMAIL and is removed.
  await env.DB.prepare(
    `UPDATE users SET status=?,role=CASE WHEN role='owner' THEN 'user' ELSE role END,
       approved_at=CASE WHEN ?='active' THEN COALESCE(approved_at,?) ELSE approved_at END,
       approved_by=CASE WHEN ?='active' THEN ? ELSE approved_by END WHERE id=?`
  ).bind(status, status, now(), status, user.id, target.id).run();
  if (status !== "active") await env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(target.id).run();
  return json({ ok: true, status });
}, { owner: true });
route("PATCH", "/api/admin/users/:id/permissions", async ({ request, env, params }) => {
  const b = await bodyJson(request), input = b.permissions;
  if (!input || typeof input !== "object" || Array.isArray(input)) return json({ error: "Lipsește obiectul „permissions”." }, 400);
  const target = await adminTarget(env, params.id);
  if (isOwnerEmail(env, target.email)) return json({ error: "Permisiunile Owner sunt complete și nu se restricționează aici." }, 400);
  const row = await env.DB.prepare("SELECT * FROM user_permissions WHERE user_id=?").bind(target.id).first();
  const next = {};
  for (const k of PERMISSION_KEYS) next[k] = row && row[k] != null ? Number(row[k]) !== 0 : k !== "github_access";
  for (const [k, v] of Object.entries(input)) {
    if (!PERMISSION_KEYS.includes(k)) continue;
    const value = toBool(v);
    if (typeof value !== "boolean") return json({ error: "Permisiunea „" + k + "” trebuie să fie true sau false." }, 400);
    next[k] = value;
  }
  const values = PERMISSION_KEYS.map(k => next[k] ? 1 : 0);
  await env.DB.prepare(
    `INSERT INTO user_permissions(user_id,${PERMISSION_KEYS.join(",")},updated_at) VALUES(?,${PERMISSION_KEYS.map(() => "?").join(",")},?)
     ON CONFLICT(user_id) DO UPDATE SET ${PERMISSION_KEYS.map(k => `${k}=excluded.${k}`).join(",")},updated_at=excluded.updated_at`
  ).bind(target.id, ...values, now()).run();
  return json({ permissions: permissionsFrom(env, { ...target, role: "user" }, Object.fromEntries(PERMISSION_KEYS.map((k, i) => [k, values[i]]))) });
}, { owner: true });
route("POST", "/api/admin/users/:id/sessions/revoke", async ({ env, params }) => {
  const target = await adminTarget(env, params.id);
  await env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(target.id).run();
  return json({ ok: true });
}, { owner: true });
route("GET", "/api/admin/audit", unavailable, { owner: true });
route("GET", "/api/admin/ai", unavailable, { owner: true });
route("PATCH", "/api/admin/ai", unavailable, { owner: true });

route("GET", "/api/models", async ctx => {
  const { env } = ctx, perms = await permissionsOf(ctx);
  const data = [
    ...(env.CEREBRAS_API_KEY && perms.cerebras ? [{ id: env.CEREBRAS_MODEL || "gpt-oss-120b", provider: "cerebras", primary: true }] : []),
    ...(perms.cloudflare ? [
      { id: env.CF_MODEL || "@cf/nvidia/nemotron-3-120b-a12b", provider: "cloudflare", primary: !(env.CEREBRAS_API_KEY && perms.cerebras) },
      { id: env.CF_FALLBACK_MODEL || "@cf/openai/gpt-oss-120b", provider: "cloudflare", fallback: true }
    ] : []),
    ...(env.GROQ_API_KEY && perms.groq ? [{ id: env.GROQ_MODEL || "openai/gpt-oss-120b", provider: "groq" }] : []),
    ...(env.GEMINI_API_KEY && perms.gemini ? [{ id: env.GEMINI_MODEL || "gemini-2.5-pro", provider: "gemini" }] : [])
  ];
  return json({ data });
});

route("GET", "/api/files", async ({ env, user, url }) => {
  const r = await env.DB.prepare("SELECT id,name,mime_type,size,source,created_at FROM files WHERE user_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?")
    .bind(user.id, intParam(url, "limit", 200, 1000), intParam(url, "offset", 0, 1e9)).all();
  return json({ data: (r.results || []).map(publicFile) });
});
route("POST", "/api/files", async ctx => {
  await requirePermission(ctx, "file_upload");
  const { request, env, user, url } = ctx;
  const name = safeFileName(url.searchParams.get("name") || "file");
  const mime = cleanMime(request.headers.get("content-type") || url.searchParams.get("type"));
  return json({ data: await saveUpload(env, user, request, name, mime) });
});
async function sendStoredFile(env, row, disposition) {
  const obj = await env.FILES.get(row.r2_key);
  if (!obj) return json({ error: "Fișierul nu mai există în stocare." }, 404);
  const headers = new Headers(corsHeaders);
  obj.writeHttpMetadata(headers);
  headers.set("content-type", row.mime_type || "application/octet-stream");
  headers.set("content-disposition", disposition + "; filename*=UTF-8''" + encodeURIComponent(row.name));
  headers.set("x-content-type-options", "nosniff");
  if (obj.size != null) headers.set("content-length", String(obj.size));
  return new Response(obj.body, { status: 200, headers });
}
async function requireOwnedFile(env, user, id) {
  const row = await ownedFile(env, user.id, id);
  if (!row) throw fail(404, "Fișierul nu a fost găsit.");
  return row;
}
async function deleteOwnedFile({ env, user, params }) {
  const row = await requireOwnedFile(env, user, params.id);
  await env.FILES.delete(row.r2_key);
  await env.DB.prepare("DELETE FROM files WHERE id=? AND user_id=?").bind(row.id, user.id).run();
  return json({ ok: true });
}
route("GET", "/api/files/:id", async ({ env, user, params }) => sendStoredFile(env, await requireOwnedFile(env, user, params.id), "attachment"));
route("DELETE", "/api/files/:id", deleteOwnedFile);

const EXPORT_FORMATS = { pdf: "pdf", docx: "docx", pptx: "pptx", md: "md", txt: "txt" };
route("POST", "/api/export", async ctx => {
  await requirePermission(ctx, "document_generation");
  const { request, env, user } = ctx;
  const b = await bodyJson(request);
  const format = String(b.format || "docx").toLowerCase().replace(/^\./, "");
  const title = String(b.title || "AI Stoica").trim().slice(0, 120) || "AI Stoica";
  const content = String(b.content || "");
  if (!EXPORT_FORMATS[format]) return json({ error: "Format neacceptat. Folosește PDF, DOCX, PPTX, MD sau TXT." }, 400);
  if (!content.trim()) return json({ error: "Nu există conținut de exportat." }, 400);
  if (content.length > 100000) return json({ error: "Documentul depășește limita de 100.000 de caractere pentru un singur export." }, 413);
  let bytes, mime;
  if (format === "pdf") { bytes = await makePdf(title, content); mime = "application/pdf"; }
  else if (format === "docx") { bytes = await makeDocx(title, content); mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"; }
  else if (format === "pptx") { bytes = await makePptx(title, content); mime = "application/vnd.openxmlformats-officedocument.presentationml.presentation"; }
  else { bytes = enc.encode(content); mime = format === "md" ? "text/markdown; charset=utf-8" : "text/plain; charset=utf-8"; }
  const base = safeFileName(title).replace(/\.(pdf|docx|pptx|md|txt)$/i, "") || "AI Stoica";
  return json({ data: await storeFile(env, user.id, { name: base + "." + format, mimeType: mime, bytes, source: "ai-export" }) });
});

route("POST", "/api/generate/image", async ctx => {
  await requirePermission(ctx, "image_generation");
  const { request, env, user } = ctx;
  const b = await bodyJson(request);
  const prompt = String(b.prompt || "").trim();
  if (!prompt) return json({ error: "Scrie descrierea imaginii." }, 400);
  if (prompt.length > 2000) return json({ error: "Descrierea imaginii poate avea cel mult 2.000 de caractere." }, 400);
  const model = env.IMAGE_MODEL || "@cf/black-forest-labs/flux-1-schnell";
  let bytes;
  try {
    const result = await withTimeout(env.AI.run(model, { prompt }), 120000, "Modelul de imagini nu a răspuns la timp.");
    if (!result?.image) return json({ error: "Modelul de imagini nu a returnat o imagine." }, 502);
    bytes = base64ToBytes(result.image);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    return json({ error: "Modelul de imagini nu a putut genera imaginea: " + e.message }, 502);
  }
  const file = await storeFile(env, user.id, {
    name: "ai-stoica-image-" + new Date().toISOString().replace(/[:.]/g, "-") + ".jpg",
    mimeType: "image/jpeg", bytes, source: "ai-image"
  });
  return json({ data: file, model });
});
route("POST", "/api/generate/video", unavailable);

route("GET", "/api/github/file", async ctx => {
  await requireGithub(ctx);
  const { env, url } = ctx;
  const path = githubPath(url.searchParams.get("path")), ref = githubRef(url.searchParams.get("ref"), env);
  const data = await githubApi(env, "/contents/" + path.split("/").map(encodeURIComponent).join("/") + "?ref=" + encodeURIComponent(ref));
  if (data.type !== "file") return json({ error: "Calea GitHub nu indică un fișier." }, 400);
  return json({ data: { path: data.path, sha: data.sha, size: data.size, content: decodeBase64Utf8(data.content || "") } });
});
route("POST", "/api/github/solve", async ctx => {
  await requireGithub(ctx);
  const { request, env } = ctx;
  const b = await bodyJson(request);
  const path = githubPath(b.path), branchName = githubRef(b.branch, env);
  const instruction = String(b.instruction || "Analizează fișierul, identifică problema și corectează-l.").trim().slice(0, 8000);
  const data = await githubApi(env, "/contents/" + path.split("/").map(encodeURIComponent).join("/") + "?ref=" + encodeURIComponent(branchName));
  if (data.type !== "file") return json({ error: "Calea GitHub nu indică un fișier." }, 400);
  const original = decodeBase64Utf8(data.content || "");
  if (original.length > 220000) return json({ error: "Fișierul este prea mare pentru rezolvarea automată într-un singur pas." }, 413);
  const messages = [
    { role: "system", content: "Ești agentul de programare AI Stoica. Primești un fișier din repository și o cerință. Returnează EXCLUSIV conținutul complet al fișierului corectat, fără explicații și fără delimitatoare Markdown." },
    { role: "user", content: "Repository: " + (env.GITHUB_REPO || "andrei18stoica-eng/Ai-Stoica") + "\nFișier: " + path + "\nCerință: " + instruction + "\n\nCONȚINUT ACTUAL:\n" + original }
  ];
  const out = await routeAI(env, messages, await permissionsOf(ctx));
  const proposal = String(out.text || "").trim().replace(/^\x60\x60\x60[^\n]*\n/, "").replace(/\n\x60\x60\x60$/, "").trim();
  if (!proposal) return json({ error: "AI-ul nu a propus nicio modificare." }, 502);
  return json({ data: { path, branch: branchName, sha: data.sha, original, proposal, provider: out.provider, model: out.model } });
});
route("POST", "/api/github/apply", async ctx => {
  await requireGithub(ctx);
  const { request, env } = ctx;
  const b = await bodyJson(request);
  const path = githubPath(b.path), branchName = githubRef(b.branch, env);
  const content = typeof b.content === "string" ? b.content : "";
  const sha = String(b.sha || "");
  if (!content.trim()) return json({ error: "Calea și conținutul sunt obligatorii." }, 400);
  if (!sha) return json({ error: "Lipsește versiunea fișierului (sha). Rulează din nou GitHub Solve." }, 400);
  const data = await githubApi(env, "/contents/" + path.split("/").map(encodeURIComponent).join("/"), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: String(b.message || ("AI Stoica: rezolvare " + path)).slice(0, 500), content: bytesToBase64(enc.encode(content)), sha, branch: branchName })
  });
  return json({ ok: true, data: { path, branch: branchName, commit: data.commit?.sha || null } });
});
route("POST", "/api/github/rollback/:id", unavailable);
route("GET", "/api/tools/github/search", unavailable);
route("GET", "/api/tools/web/search", unavailable);
route("POST", "/api/tools/code/run", unavailable);
route("POST", "/api/tools/server/check", unavailable);
route("POST", "/api/tools/server/run", unavailable);
route("POST", "/api/router/preview", unavailable);
route("POST", "/api/providers/test", unavailable);

for (const [collection, spec] of Object.entries(ITEM_KINDS)) {
  const base = "/api/" + collection;
  const find = async (env, user, id) => {
    const row = await env.DB.prepare("SELECT * FROM user_items WHERE id=? AND user_id=? AND kind=?").bind(id, user.id, spec.kind).first();
    if (!row) throw fail(404, spec.notFound);
    return row;
  };
  route("GET", base, async ({ env, user }) => {
    const r = await env.DB.prepare("SELECT * FROM user_items WHERE user_id=? AND kind=? ORDER BY updated_at DESC LIMIT 500").bind(user.id, spec.kind).all();
    return json({ data: (r.results || []).map(itemFromRow) });
  });
  route("POST", base, async ({ request, env, user }) => {
    const data = itemFields(spec, await bodyJson(request), null), id = uuid(), t = now();
    await env.DB.prepare("INSERT INTO user_items(id,user_id,kind,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?)").bind(id, user.id, spec.kind, JSON.stringify(data), t, t).run();
    return json({ data: { ...data, id, userId: user.id, createdAt: t, updatedAt: t } });
  });
  route("GET", base + "/:id", async ({ env, user, params }) => json({ data: itemFromRow(await find(env, user, params.id)) }));
  const update = async ({ request, env, user, params }) => {
    const row = await find(env, user, params.id), current = itemFromRow(row);
    const { id, userId, createdAt, updatedAt, ...stored } = current;
    const data = itemFields(spec, await bodyJson(request), stored), t = now();
    await env.DB.prepare("UPDATE user_items SET data_json=?,updated_at=? WHERE id=?").bind(JSON.stringify(data), t, row.id).run();
    return json({ data: { ...data, id, userId, createdAt, updatedAt: t } });
  };
  route("PATCH", base + "/:id", update);
  route("PUT", base + "/:id", update);
  route("DELETE", base + "/:id", async ({ env, user, params }) => {
    const row = await find(env, user, params.id);
    await env.DB.prepare("DELETE FROM user_items WHERE id=?").bind(row.id).run();
    const column = spec.kind === "project" ? "project_id" : "assistant_id";
    await env.DB.prepare(`UPDATE conversations SET ${column}=NULL WHERE user_id=? AND ${column}=?`).bind(user.id, row.id).run();
    return json({ ok: true });
  });
}

route("GET", "/api/plugins", () => json({ data: [] }));
route("GET", "/api/automations", () => json({ data: [] }));
for (const path of ["/api/plugins", "/api/plugins/direct", "/api/plugins/oauth/start", "/api/plugins/:id/test", "/api/automations", "/api/automations/:id/run"]) route("POST", path, unavailable);
route("GET", "/api/plugins/oauth/callback", unavailable);
for (const method of ["PATCH", "PUT", "DELETE"]) { route(method, "/api/plugins/:id", unavailable); route(method, "/api/automations/:id", unavailable); }

route("GET", "/api/library", async ({ env, user, url }) => {
  const r = await env.DB.prepare("SELECT id,name,mime_type,size,source,created_at FROM files WHERE user_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?")
    .bind(user.id, intParam(url, "limit", 200, 1000), intParam(url, "offset", 0, 1e9)).all();
  return json({ data: (r.results || []).map(libraryItem) });
});
route("POST", "/api/library/upload", async ctx => {
  await requirePermission(ctx, "file_upload");
  const { request, env, user } = ctx;
  let rawName = request.headers.get("x-file-name") || "file";
  try { rawName = decodeURIComponent(rawName); } catch {}
  const mime = cleanMime(request.headers.get("x-file-type") || request.headers.get("content-type"));
  const file = await saveUpload(env, user, request, safeFileName(rawName), mime);
  return json({ data: { id: file.id, name: file.name, mime: file.mimeType, size: file.size, createdAt: file.createdAt, kind: fileKind(file.mimeType) } });
});
route("POST", "/api/library/transcribe", unavailable);
route("GET", "/api/library/:id", async ({ env, user, params }) => json({ data: libraryItem(await requireOwnedFile(env, user, params.id)) }));
route("DELETE", "/api/library/:id", deleteOwnedFile);
for (const suffix of ["content", "file"]) {
  route("GET", "/api/library/:id/" + suffix, async ({ env, user, params }) => sendStoredFile(env, await requireOwnedFile(env, user, params.id), "inline"));
}
route("POST", "/api/library/:id/transcribe", unavailable);
route("POST", "/api/transcribe", unavailable);

route("GET", "/api/memory", async ({ env, user, url }) => {
  const q = String(url.searchParams.get("q") || "").trim().slice(0, 200);
  const r = q
    ? await env.DB.prepare("SELECT * FROM memories WHERE user_id=? AND text LIKE ? ESCAPE '\\' ORDER BY pinned DESC,created_at DESC LIMIT 100").bind(user.id, "%" + q.replace(/[\\%_]/g, m => "\\" + m) + "%").all()
    : await env.DB.prepare("SELECT * FROM memories WHERE user_id=? ORDER BY pinned DESC,created_at DESC LIMIT 1000").bind(user.id).all();
  return json({ enabled: Number(user.memory_enabled ?? 1) !== 0, data: (r.results || []).map(publicMemory) });
});
route("POST", "/api/memory/toggle", async ({ request, env, user }) => {
  const enabled = toBool((await bodyJson(request)).enabled);
  if (typeof enabled !== "boolean") return json({ error: "Câmpul „enabled” trebuie să fie true sau false." }, 400);
  await env.DB.prepare("UPDATE users SET memory_enabled=? WHERE id=?").bind(enabled ? 1 : 0, user.id).run();
  return json({ enabled });
});
route("POST", "/api/memory", async ({ request, env, user }) => {
  const b = await bodyJson(request), text = textInput(b.text, 12000);
  if (text === null) return json({ error: "Memoria poate avea cel mult 12.000 de caractere." }, 400);
  if (!text) return json({ error: "Memoria este goală." }, 400);
  const { row } = await addMemory(env, user.id, text, "manual", toBool(b.pinned) === true);
  return json({ data: publicMemory(row) });
});
route("POST", "/api/memory/capture", async ({ request, env, user }) => {
  if (Number(user.memory_enabled ?? 1) === 0) return json({ ok: true, stored: false });
  const b = await bodyJson(request);
  const candidate = durableMemoryCandidate(typeof b.userText === "string" ? b.userText : "");
  if (!candidate) return json({ ok: true, stored: false });
  const { stored, row } = await addMemory(env, user.id, candidate, "automatic");
  await env.DB.prepare(
    "DELETE FROM memories WHERE user_id=? AND source='automatic' AND pinned=0 AND id NOT IN (SELECT id FROM memories WHERE user_id=? AND source='automatic' ORDER BY created_at DESC LIMIT 300)"
  ).bind(user.id, user.id).run();
  return json({ ok: true, stored, data: publicMemory(row) });
});
route("GET", "/api/memory/summary", async ({ env, user }) => {
  const all = ((await env.DB.prepare("SELECT * FROM memories WHERE user_id=? ORDER BY COALESCE(updated_at,created_at) DESC LIMIT 2000").bind(user.id).all()).results || []).map(publicMemory);
  const categories = {};
  for (const m of all) categories[m.category] = (categories[m.category] || 0) + 1;
  return json({ data: {
    count: all.length, pinned: all.filter(m => m.pinned).length, categories,
    recent: all.slice(0, 12).map(m => ({ id: m.id, text: m.text, category: m.category, pinned: m.pinned, updatedAt: m.updatedAt }))
  } });
});
route("POST", "/api/memory/import-history", async ({ env, user }) => {
  const r = await env.DB.prepare("SELECT messages_json FROM conversations WHERE user_id=? ORDER BY updated_at DESC LIMIT 200").bind(user.id).all();
  let count = 0;
  for (const c of r.results || []) {
    for (const m of safeParseArray(c.messages_json)) {
      if (m?.role !== "user" || count >= 200) continue;
      const candidate = durableMemoryCandidate(typeof m.displayText === "string" && m.displayText ? m.displayText : messageText(m));
      if (candidate && (await addMemory(env, user.id, candidate, "history")).stored) count++;
    }
  }
  return json({ ok: true, count });
});
route("PATCH", "/api/memory/:id", async ({ request, env, user, params }) => {
  const row = await env.DB.prepare("SELECT * FROM memories WHERE id=? AND user_id=?").bind(params.id, user.id).first();
  if (!row) return json({ error: "Memoria nu a fost găsită." }, 404);
  const b = await bodyJson(request);
  if (Object.hasOwn(b, "pinned")) {
    const v = toBool(b.pinned);
    if (typeof v !== "boolean") return json({ error: "Câmpul „pinned” trebuie să fie true sau false." }, 400);
    row.pinned = v ? 1 : 0;
  }
  if (Object.hasOwn(b, "text")) {
    const text = textInput(b.text, 12000);
    if (!text) return json({ error: text === null ? "Memoria poate avea cel mult 12.000 de caractere." : "Memoria este goală." }, 400);
    row.text = text;
  }
  row.updated_at = now();
  await env.DB.prepare("UPDATE memories SET text=?,pinned=?,updated_at=? WHERE id=?").bind(row.text, row.pinned, row.updated_at, row.id).run();
  return json({ data: publicMemory(row) });
});
route("DELETE", "/api/memory/:id", async ({ env, user, params }) => {
  const r = await env.DB.prepare("DELETE FROM memories WHERE id=? AND user_id=?").bind(params.id, user.id).run();
  if (!r?.meta?.changes) return json({ error: "Memoria nu a fost găsită." }, 404);
  return json({ ok: true });
});
route("DELETE", "/api/memory", async ({ env, user }) => {
  await env.DB.prepare("DELETE FROM memories WHERE user_id=?").bind(user.id).run();
  return json({ ok: true });
});

async function answer(ctx) {
  const b = await bodyJson(ctx.request);
  const prepared = await chatMessages(ctx.env, ctx.user, b.messages, { projectId: b.projectId, assistantId: b.assistantId });
  if (!prepared.some(m => m.role === "user")) throw fail(400, "Mesajul este gol.");
  return routeAI(ctx.env, prepared, await permissionsOf(ctx));
}
route("POST", "/api/chat/stream", async ctx => {
  const out = await answer(ctx);
  const payload = JSON.stringify({ choices: [{ index: 0, delta: { content: out.text }, finish_reason: "stop" }], model: out.model, provider: out.provider });
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode("data: " + payload + "\n\n"));
      controller.enqueue(enc.encode("data: [DONE]\n\n"));
      controller.close();
    }
  });
  return new Response(stream, { status: 200, headers: { ...corsHeaders, "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" } });
});
route("POST", "/api/chat", async ctx => {
  const out = await answer(ctx);
  return json({ choices: [{ index: 0, message: { role: "assistant", content: out.text }, finish_reason: "stop" }], model: out.model, provider: out.provider, mode: "performance-max" });
});

const CONVERSATION_COLUMNS = "id,title,model,summary,project_id,assistant_id,created_at,updated_at";
route("GET", "/api/conversations", async ({ env, user, url }) => {
  const summary = url.searchParams.get("summary") === "1";
  const limit = intParam(url, "limit", summary ? 200 : 500, 1000), offset = intParam(url, "offset", 0, 1e9);
  const r = await env.DB.prepare(
    `SELECT ${CONVERSATION_COLUMNS},${summary ? "json_array_length(messages_json) AS message_count" : "messages_json"} FROM conversations WHERE user_id=? ORDER BY updated_at DESC LIMIT ? OFFSET ?`
  ).bind(user.id, limit, offset).all();
  return json({ data: (r.results || []).map(x => publicConversation(x, !summary)) });
});
route("POST", "/api/conversations", async ({ request, env, user }) => {
  const b = await bodyJson(request), t = now();
  const f = conversationFields(b, null);
  const row = {
    id: uuid(), title: f.title, model: f.model ?? (env.CF_MODEL || "@cf/nvidia/nemotron-3-120b-a12b"), messages_json: JSON.stringify(f.messages || []),
    summary: "", project_id: f.project_id ?? null, assistant_id: f.assistant_id ?? null, created_at: t, updated_at: t
  };
  await env.DB.prepare(
    "INSERT INTO conversations(id,user_id,title,model,messages_json,summary,project_id,assistant_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)"
  ).bind(row.id, user.id, row.title, row.model, row.messages_json, row.summary, row.project_id, row.assistant_id, t, t).run();
  return json({ data: publicConversation(row) });
});
async function ownedConversation(env, user, id) {
  const row = await env.DB.prepare("SELECT * FROM conversations WHERE id=? AND user_id=?").bind(id, user.id).first();
  if (!row) throw fail(404, "Conversația nu a fost găsită.");
  return row;
}
route("GET", "/api/conversations/:id", async ({ env, user, params }) => json({ data: publicConversation(await ownedConversation(env, user, params.id)) }));
const updateConversation = async ({ request, env, user, params }) => {
  const old = await ownedConversation(env, user, params.id);
  const f = conversationFields(await bodyJson(request), old);
  const row = {
    ...old, title: f.title ?? old.title, model: "model" in f ? f.model : old.model,
    messages_json: f.messages ? JSON.stringify(f.messages) : old.messages_json,
    project_id: "project_id" in f ? f.project_id : old.project_id,
    assistant_id: "assistant_id" in f ? f.assistant_id : old.assistant_id,
    updated_at: now()
  };
  await env.DB.prepare("UPDATE conversations SET title=?,model=?,messages_json=?,project_id=?,assistant_id=?,updated_at=? WHERE id=? AND user_id=?")
    .bind(row.title, row.model, row.messages_json, row.project_id, row.assistant_id, row.updated_at, row.id, user.id).run();
  return json({ data: publicConversation(row) });
};
route("PUT", "/api/conversations/:id", updateConversation);
route("PATCH", "/api/conversations/:id", updateConversation);
route("DELETE", "/api/conversations/:id", async ({ env, user, params }) => {
  const r = await env.DB.prepare("DELETE FROM conversations WHERE id=? AND user_id=?").bind(params.id, user.id).run();
  if (!r?.meta?.changes) return json({ error: "Conversația nu a fost găsită." }, 404);
  return json({ ok: true });
});

async function router(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  const url = new URL(request.url), method = request.method === "HEAD" ? "GET" : request.method;
  const matching = routes.filter(r => r.regex.test(url.pathname));
  if (!matching.length) return json({ error: "Endpoint inexistent." }, 404);
  const r = matching.find(x => x.method === method);
  if (!r) return json({ error: "Metoda HTTP nu este acceptată pentru această adresă." }, 405, { Allow: [...new Set(matching.map(x => x.method))].join(", ") });
  const params = {};
  const values = url.pathname.match(r.regex).slice(1);
  try { r.keys.forEach((k, i) => { params[k] = decodeURIComponent(values[i]); }); }
  catch { return json({ error: "Adresa conține caractere invalide." }, 400); }
  const ctx = { request, env, url, params };
  if (!r.public) {
    const user = await authenticate(request, env);
    if (!user) return json({ error: "Autentificare necesară." }, 401);
    user.role = effectiveRole(env, user);
    if (!r.allowInactive && user.status !== "active") return json(inactiveBody(user.status), 403);
    if (r.owner && user.role !== "owner") return json({ error: "Acces rezervat Owner." }, 403);
    ctx.user = user;
  }
  return r.handler(ctx);
}

async function cleanupExpired(env) {
  const t = now();
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at<=?").bind(t).run();
  await env.DB.prepare("DELETE FROM auth_attempts WHERE window_start<?").bind(t - AUTH_WINDOW_MS).run();
}

export default {
  async fetch(request, env) {
    try { return await router(request, env); }
    catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status, e.headers || {});
      console.error("AI Stoica Worker:", e?.stack || e);
      if (/no such (column|table)/i.test(String(e?.message))) return json({ error: "Baza de date D1 nu are ultimele migrații. Rulează „npm run db:init” în apps/cloudflare, apoi încearcă din nou." }, 503);
      return json({ error: "Eroare internă AI Stoica. Încearcă din nou peste câteva momente." }, 500);
    }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(cleanupExpired(env));
  }
};

