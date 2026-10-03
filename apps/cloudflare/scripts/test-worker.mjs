// Runs the Worker against an in-memory D1 (node:sqlite), R2 and Workers AI. Needs Node 22.5+ and `npm install`.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const worker = (await import(path.join(root, "src", "index.js"))).default;

function makeD1(db) {
  const norm = v => v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v;
  class Stmt {
    constructor(sql, args = []) { this.sql = sql; this.args = args; }
    bind(...a) { return new Stmt(this.sql, a.map(norm)); }
    async first() { const r = db.prepare(this.sql).get(...this.args); return r ? { ...r } : null; }
    async all() { return { results: db.prepare(this.sql).all(...this.args).map(r => ({ ...r })) }; }
    async run() { const r = db.prepare(this.sql).run(...this.args); return { meta: { changes: Number(r.changes) } }; }
  }
  return { prepare: sql => new Stmt(sql) };
}
function makeR2() {
  const objects = new Map();
  return {
    objects,
    async put(key, body, opts) {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      objects.set(key, { bytes, opts });
      return { size: bytes.length };
    },
    async get(key) {
      const o = objects.get(key);
      if (!o) return null;
      return {
        size: o.bytes.length, body: new Blob([o.bytes]).stream(),
        arrayBuffer: async () => o.bytes.slice().buffer,
        writeHttpMetadata: h => h.set("content-type", o.opts?.httpMetadata?.contentType || "application/octet-stream")
      };
    },
    async delete(key) { objects.delete(key); }
  };
}
const aiCalls = [];
const AI = {
  async run(model, input) {
    aiCalls.push({ model, input });
    if (/flux/.test(model)) return { image: Buffer.from("fake-jpeg").toString("base64") };
    return { response: "Răspuns de test." };
  },
  async toMarkdown(doc) { return { name: doc.name, data: "Text extras din " + doc.name }; }
};

function freshDb(upTo = 99) {
  const db = new DatabaseSync(":memory:");
  for (const f of fs.readdirSync(path.join(root, "migrations")).sort()) {
    if (Number.parseInt(f, 10) > upTo) continue;
    db.exec(fs.readFileSync(path.join(root, "migrations", f), "utf8"));
  }
  return db;
}
const baseVars = { OWNER_EMAIL: "Owner@Example.com", OWNER_SETUP_CODE: "cod-secret-123", AI_STOICA_FILE_MAX_MB: "1", CF_MODEL: "@cf/test/model", CF_FALLBACK_MODEL: "@cf/test/model" };
function makeEnv(db, extra = {}) { return { DB: makeD1(db), FILES: makeR2(), AI, ...baseVars, ...extra }; }

let ip = 1;
async function call(env, method, p, { token, body, headers = {}, raw } = {}) {
  const h = { "cf-connecting-ip": headers["cf-connecting-ip"] || "10.0.0." + ip, ...headers };
  if (token) h.authorization = "Bearer " + token;
  let payload;
  if (raw !== undefined) payload = raw;
  else if (body !== undefined) { payload = JSON.stringify(body); h["content-type"] = "application/json"; }
  const res = await worker.fetch(new Request("https://w.test" + p, { method, headers: h, body: payload, duplex: "half" }), env);
  const type = res.headers.get("content-type") || "";
  return { status: res.status, headers: res.headers, data: type.includes("json") ? await res.json() : await res.arrayBuffer() };
}

const results = [];
async function test(name, fn) {
  try { await fn(); results.push(["ok", name]); }
  catch (e) { results.push(["FAIL", name, e.stack || e.message]); }
}

const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("offline in tests"); };

const db = freshDb();
const env = makeEnv(db);
let ownerToken, userToken, userId;

await test("fresh migrations create every column used by the Worker", async () => {
  const cols = t => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
  for (const c of ["password_iterations", "memory_enabled", "role", "status"]) assert.ok(cols("users").includes(c), c);
  assert.ok(cols("files").includes("extracted_text"));
  assert.ok(cols("conversations").includes("project_id"));
  assert.ok(cols("user_items").includes("data_json"));
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='sessions_expires_idx'").get(), undefined);
});

await test("unknown routes are 404 and wrong methods 405 without a token", async () => {
  assert.equal((await call(env, "GET", "/nope")).status, 404);
  const r = await call(env, "GET", "/auth/login");
  assert.equal(r.status, 405);
  assert.equal(r.headers.get("allow"), "POST");
  assert.equal((await call(env, "GET", "/api/conversations")).status, 401);
});

await test("health does not reveal provider keys", async () => {
  const r = await call(env, "GET", "/health");
  assert.equal(r.status, 200);
  assert.equal(r.data.fallbacks, undefined);
});

await test("owner registration needs OWNER_SETUP_CODE", async () => {
  let r = await call(env, "POST", "/auth/register", { body: { email: "owner@example.com", password: "parola-owner" } });
  assert.equal(r.status, 403);
  r = await call(env, "POST", "/auth/register", { body: { email: "owner@example.com", password: "parola-owner", setupCode: "gresit" } });
  assert.equal(r.status, 403);
  r = await call(env, "POST", "/auth/register", { body: { email: " OWNER@example.com ", password: "parola-owner", setupCode: "cod-secret-123" } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.user.role, "owner");
  assert.equal(r.data.permissions.github_access, true);
  ownerToken = r.data.token;
  assert.equal(db.prepare("SELECT password_iterations p FROM users WHERE email='owner@example.com'").get().p, 100000);
  r = await call(env, "POST", "/auth/register", { body: { email: "owner@example.com", password: "alta-parola", setupCode: "cod-secret-123" } });
  assert.equal(r.status, 409);
});

await test("new users wait for approval and cannot log in until approved", async () => {
  ip++;
  let r = await call(env, "POST", "/auth/register", { body: { email: "ana@example.com", password: "parola123", name: "Ana" } });
  assert.equal(r.status, 202);
  r = await call(env, "POST", "/auth/register", { body: { email: "ana@example.com", password: "parola123" } });
  assert.equal(r.status, 202, "existing e-mail answers like a new sign-up");
  r = await call(env, "POST", "/auth/login", { body: { email: "ana@example.com", password: "parola123" } });
  assert.equal(r.status, 403);
  assert.match(r.data.error, /așteaptă aprobarea/);
  const list = await call(env, "GET", "/api/admin/users", { token: ownerToken });
  assert.equal(list.status, 200);
  const ana = list.data.data.find(u => u.email === "ana@example.com");
  assert.equal(typeof ana.active_sessions, "number");
  userId = ana.id;
  r = await call(env, "PATCH", `/api/admin/users/${userId}/status`, { token: ownerToken, body: { status: "active" } });
  assert.equal(r.status, 200);
  r = await call(env, "POST", "/auth/login", { body: { email: "ana@example.com", password: "parola123" } });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.role, "user");
  userToken = r.data.token;
  assert.equal((await call(env, "GET", "/api/admin/users", { token: userToken })).status, 403);
});

await test("validation messages and limits", async () => {
  ip++;
  assert.equal((await call(env, "POST", "/auth/register", { body: { email: "x", password: "parola123" } })).data.error, "Adresa de email nu este validă.");
  assert.equal((await call(env, "POST", "/auth/register", { body: { email: "a@b.ro", password: "scurt" } })).data.error, "Parola trebuie să aibă cel puțin 8 caractere.");
  assert.equal((await call(env, "POST", "/auth/register", { body: { email: "a@b.ro", password: "parola123", name: "n".repeat(101) } })).status, 400);
});

await test("password guessing is limited per IP with Retry-After", async () => {
  const h = { "cf-connecting-ip": "203.0.113.9" };
  let r;
  for (let i = 0; i < 20; i++) r = await call(env, "POST", "/auth/login", { headers: h, body: { email: "ana@example.com", password: "gresit" + i } });
  assert.equal(r.status, 401);
  r = await call(env, "POST", "/auth/login", { headers: h, body: { email: "ana@example.com", password: "parola123" } });
  assert.equal(r.status, 429);
  assert.ok(Number(r.headers.get("retry-after")) > 0);
  assert.equal(db.prepare("SELECT failures FROM auth_attempts WHERE key='ip:203.0.113.9'").get().failures, 20);
});

await test("permissions are enforced and editable by the Owner", async () => {
  let r = await call(env, "PATCH", `/api/admin/users/${userId}/permissions`, { token: ownerToken, body: { permissions: { image_generation: "false", file_upload: false } } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.permissions.image_generation, false);
  r = await call(env, "POST", "/api/generate/image", { token: userToken, body: { prompt: "o pisică" } });
  assert.equal(r.status, 403);
  assert.equal(r.data.error, "Funcția „Generare imagini” este dezactivată de Owner pentru contul tău.");
  r = await call(env, "POST", "/api/files?name=a.txt", { token: userToken, raw: "salut", headers: { "content-type": "text/plain" } });
  assert.equal(r.status, 403);
  r = await call(env, "GET", "/auth/me", { token: userToken });
  assert.equal(r.data.permissions.image_generation, false);
  assert.equal(r.data.permissions.github_access, false);
  await call(env, "PATCH", `/api/admin/users/${userId}/permissions`, { token: ownerToken, body: { permissions: { image_generation: true, file_upload: true } } });
  assert.equal((await call(env, "PATCH", `/api/admin/users/${userId}/permissions`, { token: ownerToken, body: { permissions: { file_upload: "poate" } } })).status, 400);
  assert.equal((await call(env, "POST", "/api/admin/users/nu-exista/sessions/revoke", { token: ownerToken })).status, 404);
});

let fileId;
await test("uploads keep the size limit even without content-length or with a fake x-file-size", async () => {
  let r = await call(env, "POST", "/api/files?name=nota.txt&type=text/plain", { token: userToken, raw: "Proiectul meu se numește Delta.", headers: { "content-type": "text/plain; charset=utf-8" } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.data.mimeType, "text/plain");
  fileId = r.data.data.id;
  const big = new Uint8Array(1024 * 1024 + 10);
  r = await call(env, "POST", "/api/library/upload", { token: userToken, raw: big, headers: { "x-file-name": "%E0%A4%A", "x-file-size": "1" } });
  assert.equal(r.status, 413);
  r = await call(env, "POST", "/api/files?name=mare.bin", { token: userToken, raw: big, headers: { "content-length": String(big.length) } });
  assert.equal(r.status, 413);
  r = await call(env, "POST", "/api/files?name=mic.bin", { token: userToken, raw: new Uint8Array(10), headers: { "content-length": "10" } });
  assert.equal(r.status, 200);
  assert.equal(r.data.data.size, 10);
  r = await call(env, "POST", "/api/library/upload", { token: userToken, raw: new Blob(["abc"]).stream(), headers: { "x-file-name": "flux.txt", "x-file-type": "text/plain" } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.data.kind, "text");
  r = await call(env, "GET", "/api/library/" + r.data.data.id + "/file", { token: userToken });
  assert.equal(r.status, 200);
  assert.equal((await call(env, "GET", "/api/files/" + fileId, { token: ownerToken })).status, 404, "other users' files stay private");
});

await test("chat reads recent attachments once, uses project and assistant instructions, and rejects empty messages", async () => {
  let r = await call(env, "POST", "/api/projects", { token: userToken, body: { name: "Delta", instructions: "Răspunde scurt." } });
  assert.equal(r.status, 200);
  const projectId = r.data.data.id;
  r = await call(env, "POST", "/api/assistants", { token: userToken, body: { name: "jurist", systemPrompt: "Ești jurist." } });
  assert.equal(r.data.data.icon, "J");
  const assistantId = r.data.data.id;
  assert.equal((await call(env, "PATCH", "/api/projects/" + projectId, { token: userToken, body: { name: "" } })).status, 400);
  aiCalls.length = 0;
  const messages = [{ role: "assistant", content: "Iată fișierul", attachments: [{ id: fileId, name: "nota.txt" }] }, { role: "user", content: "Ce scrie?", attachments: [{ libraryId: fileId, name: "nota.txt" }] }];
  r = await call(env, "POST", "/api/chat", { token: userToken, body: { messages, projectId, assistantId } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const sent = aiCalls[0].input.messages;
  assert.match(sent[0].content, /Răspunde scurt/);
  assert.match(sent[0].content, /Ești jurist/);
  assert.equal((sent.find(m => m.role === "assistant").content.match(/FIȘIER ATAȘAT/g) || []).length, 0);
  assert.match(sent.at(-1).content, /Delta/);
  assert.equal(typeof db.prepare("SELECT extracted_text t FROM files WHERE id=?").get(fileId).t, "string");
  r = await call(env, "POST", "/api/chat", { token: userToken, body: { messages: [{ role: "assistant", content: "x" }] } });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, "Mesajul este gol.");
  assert.equal((await call(env, "DELETE", "/api/projects/" + projectId, { token: userToken })).status, 200);
  assert.equal((await call(env, "GET", "/api/projects/" + projectId, { token: userToken })).status, 404);
});

await test("disabled providers are skipped and all-disabled gives 403", async () => {
  await call(env, "PATCH", `/api/admin/users/${userId}/permissions`, { token: ownerToken, body: { permissions: { cloudflare: false } } });
  const r = await call(env, "POST", "/api/chat", { token: userToken, body: { messages: [{ role: "user", content: "Salut" }] } });
  assert.equal(r.status, 403);
  await call(env, "PATCH", `/api/admin/users/${userId}/permissions`, { token: ownerToken, body: { permissions: { cloudflare: true } } });
});

await test("memory: capture keeps only durable facts, toggle, summary, edit, delete", async () => {
  let r = await call(env, "POST", "/api/memory/capture", { token: userToken, body: { userText: "Cât face 2+2?", assistantText: "4" } });
  assert.equal(r.data.stored, false);
  r = await call(env, "POST", "/api/memory/capture", { token: userToken, body: { userText: "Ține minte că lucrez la primăria Bragadiru." } });
  assert.equal(r.data.stored, true);
  r = await call(env, "POST", "/api/memory", { token: userToken, body: { text: "Prefer răspunsuri scurte.", pinned: true } });
  const memId = r.data.data.id;
  r = await call(env, "GET", "/api/memory/summary", { token: userToken });
  assert.equal(r.data.data.count, 2);
  r = await call(env, "GET", "/api/memory?q=primăria", { token: userToken });
  assert.equal(r.data.data.length, 1);
  assert.equal((await call(env, "PATCH", "/api/memory/" + memId, { token: userToken, body: { pinned: "nu" } })).status, 400);
  r = await call(env, "PATCH", "/api/memory/" + memId, { token: userToken, body: { pinned: false, text: "Prefer răspunsuri foarte scurte." } });
  assert.equal(r.data.data.pinned, false);
  r = await call(env, "POST", "/api/memory/toggle", { token: userToken, body: { enabled: false } });
  assert.equal(r.data.enabled, false);
  r = await call(env, "POST", "/api/memory/capture", { token: userToken, body: { userText: "Ține minte că am un câine." } });
  assert.equal(r.data.stored, false);
  assert.equal((await call(env, "DELETE", "/api/memory/" + memId, { token: userToken })).status, 200);
  assert.equal((await call(env, "DELETE", "/api/memory/" + memId, { token: userToken })).status, 404);
  await call(env, "POST", "/api/memory/toggle", { token: userToken, body: { enabled: true } });
});

await test("conversations: summary list, single fetch, 1.8 MB limit, 404 on missing", async () => {
  let r = await call(env, "POST", "/api/conversations", { token: userToken, body: { title: "Test", messages: [{ role: "user", content: "a" }] } });
  assert.equal(r.status, 200);
  const id = r.data.data.id;
  r = await call(env, "GET", "/api/conversations?summary=1", { token: userToken });
  assert.equal(r.data.data[0].messageCount, 1);
  assert.equal(r.data.data[0].messages, undefined);
  r = await call(env, "GET", "/api/conversations/" + id, { token: userToken });
  assert.equal(r.data.data.messages.length, 1);
  r = await call(env, "PUT", "/api/conversations/" + id, { token: userToken, body: { messages: [{ role: "user", content: "ă".repeat(1000000) }] } });
  assert.equal(r.status, 413);
  r = await call(env, "PUT", "/api/conversations/" + id, { token: userToken, body: { title: "Nou", projectId: "p1" } });
  assert.equal(r.data.data.title, "Nou");
  assert.equal(r.data.data.messages.length, 1);
  assert.equal((await call(env, "PUT", "/api/conversations/" + id, { token: userToken, body: { messages: "x" } })).status, 400);
  assert.equal((await call(env, "DELETE", "/api/conversations/" + id, { token: userToken })).status, 200);
  assert.equal((await call(env, "DELETE", "/api/conversations/" + id, { token: userToken })).status, 404);
});

await test("export: PDF works offline (WinAnsi fallback) with emoji/arrows and keeps dotted titles", async () => {
  const r = await call(env, "POST", "/api/export", { token: userToken, body: { format: "pdf", title: "Raport v1.2 final", content: "Pași → gata ✓ 🚀\tcod\n" + "x".repeat(300) } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.data.name, "Raport v1.2 final.pdf");
  for (const format of ["docx", "pptx", "md", "txt"]) assert.equal((await call(env, "POST", "/api/export", { token: userToken, body: { format, title: "T", content: "Conținut" } })).status, 200, format);
});

const fontDir = process.env.AI_STOICA_FONT_DIR;
if (fontDir) await test("export: PDF with the static NotoSans fonts", async () => {
  globalThis.fetch = async url => new Response(fs.readFileSync(path.join(fontDir, path.basename(new URL(url).pathname))));
  const r = await call(env, "POST", "/api/export", { token: userToken, body: { format: "pdf", title: "Șțăîâ titlu", content: "Diacritice: ăâîșț ĂÂÎȘȚ → 🚀 ✓\tok" } });
  globalThis.fetch = async () => { throw new Error("offline in tests"); };
  assert.equal(r.status, 200, JSON.stringify(r.data));
});

await test("image generation stores the picture", async () => {
  const r = await call(env, "POST", "/api/generate/image", { token: userToken, body: { prompt: "un far" } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await call(env, "POST", "/api/generate/image", { token: userToken, body: { prompt: "x".repeat(2001) } })).status, 400);
});

await test("GitHub needs a token, the Owner and non-empty content", async () => {
  assert.equal((await call(env, "POST", "/api/github/solve", { token: userToken, body: { path: "a.js" } })).status, 403);
  assert.equal((await call(env, "POST", "/api/github/solve", { token: ownerToken, body: { path: "a.js" } })).status, 503);
  assert.equal((await call(env, "POST", "/api/github/apply", { token: ownerToken, body: { path: "a.js", sha: "1", content: "" } })).status, 400);
  assert.equal((await call(env, "GET", "/api/github/file?path=../x", { token: ownerToken })).status, 400);
});

await test("features that need the desktop app answer 501, lists stay empty", async () => {
  for (const [m, p] of [["POST", "/api/plugins"], ["PATCH", "/api/automations/1"], ["POST", "/api/tools/code/run"], ["POST", "/api/library/1/transcribe"], ["POST", "/api/transcribe"], ["POST", "/api/generate/video"], ["POST", "/api/memory/import-history"]]) {
    const r = await call(env, m, p, { token: userToken, body: {} });
    if (p === "/api/memory/import-history") { assert.equal(r.status, 200); continue; }
    assert.equal(r.status, 501, p);
    assert.match(r.data.error, /nu este disponibilă în AI Stoica Cloud/);
  }
  assert.deepEqual((await call(env, "GET", "/api/plugins", { token: userToken })).data, { data: [] });
  assert.equal((await call(env, "GET", "/api/admin/audit", { token: userToken })).status, 403);
  assert.equal((await call(env, "GET", "/api/admin/audit", { token: ownerToken })).status, 501);
});

await test("blocking signs the user out; logout ends the session", async () => {
  let r = await call(env, "PATCH", `/api/admin/users/${userId}/status`, { token: ownerToken, body: { status: "blocked" } });
  assert.equal(r.status, 200);
  assert.equal((await call(env, "GET", "/auth/me", { token: userToken })).status, 401);
  await call(env, "PATCH", `/api/admin/users/${userId}/status`, { token: ownerToken, body: { status: "active" } });
  r = await call(env, "POST", "/auth/login", { headers: { "cf-connecting-ip": "10.9.9.9" }, body: { email: "ana@example.com", password: "parola123" } });
  const t = r.data.token;
  assert.equal((await call(env, "POST", "/auth/logout", { token: t })).status, 200);
  assert.equal((await call(env, "GET", "/auth/me", { token: t })).status, 401);
});

await test("reset-password with OWNER_SETUP_CODE", async () => {
  ip++;
  assert.equal((await call(env, "POST", "/auth/reset-password", { body: { email: "ana@example.com", password: "nouaparola", setupCode: "x" } })).status, 403);
  assert.equal((await call(env, "POST", "/auth/reset-password", { body: { email: "ana@example.com", password: "nouaparola", setupCode: "cod-secret-123" } })).status, 200);
  assert.equal((await call(env, "POST", "/auth/login", { body: { email: "ana@example.com", password: "nouaparola" } })).status, 200);
});

await test("stale Owner (OWNER_EMAIL changed) loses Owner rights", async () => {
  const env2 = { ...env, OWNER_EMAIL: "nou@example.com" };
  const r = await call(env2, "GET", "/auth/me", { token: ownerToken });
  assert.equal(r.data.user.role, "user");
  assert.equal((await call(env2, "GET", "/api/admin/users", { token: ownerToken })).status, 403);
});

await test("legacy 120000-iteration accounts upgrade on login; a refused hash gives a clear 500", async () => {
  const legacy = freshDb(4);
  const salt = "aa".repeat(16);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("parola-veche"), "PBKDF2", false, ["deriveBits"]);
  const bits = Buffer.from(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: Buffer.from(salt, "hex"), iterations: 120000 }, key, 256)).toString("hex");
  legacy.prepare("INSERT INTO users(id,email,name,password_hash,password_salt,created_at,status) VALUES('u1','vechi@example.com','V',?,?,1,'active')").run(bits, salt);
  legacy.exec(fs.readFileSync(path.join(root, "migrations", fs.readdirSync(path.join(root, "migrations")).find(f => f.startsWith("0005"))), "utf8"));
  assert.equal(legacy.prepare("SELECT password_iterations p FROM users").get().p, 120000);
  const env3 = makeEnv(legacy);
  const original = crypto.subtle.deriveBits.bind(crypto.subtle);
  crypto.subtle.deriveBits = async (params, ...rest) => { if (params.iterations > 100000) throw new Error("Pbkdf2 failed: iteration counts above 100000 are not supported"); return original(params, ...rest); };
  let r = await call(env3, "POST", "/auth/login", { body: { email: "vechi@example.com", password: "parola-veche" } });
  assert.equal(r.status, 500);
  assert.match(r.data.error, /resete/);
  crypto.subtle.deriveBits = original;
  r = await call(env3, "POST", "/auth/login", { body: { email: "vechi@example.com", password: "parola-veche" } });
  assert.equal(r.status, 200);
  assert.equal(legacy.prepare("SELECT password_iterations p FROM users").get().p, 100000);
  r = await call(env3, "POST", "/auth/login", { body: { email: "vechi@example.com", password: "parola-veche" } });
  assert.equal(r.status, 200);
});

await test("scheduled cleanup removes expired sessions and old counters", async () => {
  db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES('old',?,1,1)").run(userId);
  db.prepare("INSERT INTO auth_attempts(key,failures,window_start) VALUES('ip:old',3,1)").run();
  let pending;
  await worker.scheduled({}, env, { waitUntil: p => { pending = p; } });
  await pending;
  assert.equal(db.prepare("SELECT COUNT(*) c FROM sessions WHERE token_hash='old'").get().c, 0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM auth_attempts WHERE key='ip:old'").get().c, 0);
});

await test("a database without the latest migrations gets a clear 503", async () => {
  const old = makeEnv(freshDb(4));
  const r = await call(old, "GET", "/api/conversations", { token: "x" });
  assert.equal(r.status, 503);
  assert.match(r.data.error, /db:init/);
});

await test("internal errors never leak details", async () => {
  const broken = { ...env, DB: { prepare: () => { throw new Error("SQLITE secret detail"); } } };
  const r = await call(broken, "GET", "/api/conversations", { token: userToken });
  assert.equal(r.status, 500);
  assert.doesNotMatch(r.data.error, /SQLITE/);
});

globalThis.fetch = realFetch;
const failed = results.filter(r => r[0] === "FAIL");
for (const r of results) console.log(r[0] === "ok" ? "  ok  " : "  FAIL", r[1], r[2] ? "\n" + r[2] : "");
console.log(failed.length ? `${failed.length} test(s) failed` : `WORKER_TESTS_PASSED (${results.length})`);
process.exit(failed.length ? 1 : 0);
