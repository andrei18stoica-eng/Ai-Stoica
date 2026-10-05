// Starts server.cjs against a small in-memory stand-in for PostgreSQL and checks the HTTP contract.
const Module = require("module");
const net = require("net");
const path = require("path");
const assert = require("assert/strict");

const db = { users: [], sessions: new Map(), migrations: new Set(), failNextUserInsert: false, log: [] };
function result(rows) { return { rows, rowCount: rows.length }; }
function query(sql, params = []) {
  const q = String(sql);
  db.log.push({ q, params });
  if (/^\s*SELECT NOW\(\) AS now/.test(q)) return result([{ now: new Date() }]);
  if (/schema_migrations/.test(q) && /^\s*SELECT version/.test(q)) return result([...db.migrations].map(version => ({ version })));
  if (/INSERT INTO schema_migrations/.test(q)) { db.migrations.add(params[0]); return result([]); }
  if (/^\s*SELECT id FROM users WHERE (lower\(email\)=lower\(\$1\)|email=\$1)/.test(q)) return result(db.users.filter(u => u.email === String(params[0]).toLowerCase()).map(u => ({ id: u.id })));
  if (/^\s*INSERT INTO users/.test(q)) {
    if (db.failNextUserInsert) { db.failNextUserInsert = false; throw Object.assign(new Error("duplicate key"), { code: "23505" }); }
    const [id, email, name, password_hash, role, status] = params;
    db.users.push({ id, email, name, password_hash, role, status, created_at: new Date() });
    return result([]);
  }
  if (/^\s*SELECT \* FROM users WHERE email=\$1/.test(q)) return result(db.users.filter(u => u.email === params[0]));
  if (/^\s*SELECT \* FROM users WHERE id=\$1/.test(q)) return result(db.users.filter(u => u.id === params[0]));
  if (/^\s*UPDATE users SET paid_gift=\$1/.test(q)) { const u = db.users.find(x => x.id === params[1]); if (u) u.paid_gift = params[0]; return result([]); }
  if (/^\s*INSERT INTO sessions/.test(q)) { db.sessions.set(params[0], { user_id: params[1], expires_at: params[2] }); return result([]); }
  if (/FROM sessions s\s+JOIN users u/.test(q)) {
    const s = db.sessions.get(params[0]);
    const u = s && s.expires_at > new Date() && db.users.find(x => x.id === s.user_id);
    return result(u ? [{ ...u, token_hash: params[0] }] : []);
  }
  if (/^\s*DELETE FROM sessions WHERE token_hash/.test(q)) { db.sessions.delete(params[0]); return result([]); }
  if (/^\s*UPDATE sessions SET expires_at/.test(q)) { const s = db.sessions.get(params[0]); if (s) s.expires_at = params[1]; return result([]); }
  return result([]);
}
class FakePool {
  constructor(config) { db.config = config; }
  async query(sql, params) { return query(sql, params); }
  async connect() { return { query: async (sql, params) => query(sql, params), release() {} }; }
  on() {}
  async end() {}
}
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "pg") return { Pool: FakePool };
  return originalLoad.call(this, request, parent, isMain);
};

function freePort() {
  return new Promise(resolve => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}

(async () => {
  const port = await freePort();
  Object.assign(process.env, { PORT: String(port), HOST: "127.0.0.1", DATABASE_URL: "postgres://test", OWNER_EMAIL: "Owner@Example.com", OWNER_INITIAL_PASSWORD: "" });
  const warn = console.warn; console.warn = () => {};
  require(path.join(__dirname, "..", "server.cjs"));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) { try { await fetch(base + "/health"); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
  console.warn = warn;
  const call = async (method, p, { body, token, raw } = {}) => {
    const headers = {};
    if (token) headers.authorization = "Bearer " + token;
    if (body !== undefined || raw !== undefined) headers["content-type"] = "application/json";
    const r = await fetch(base + p, { method, headers, body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json() };
  };

  assert.ok(db.migrations.has("001_initial.sql"), "migrations are recorded in schema_migrations");
  assert.equal(db.config.statement_timeout, 30000);

  let r = await call("GET", "/nu-exista");
  assert.deepEqual([r.status, r.data.error], [404, "Endpoint inexistent."]);
  r = await call("POST", "/auth/login", { raw: "{nu e json" });
  assert.deepEqual([r.status, r.data.error], [400, "Corpul cererii nu este JSON valid."]);
  r = await call("POST", "/auth/register", { body: { email: "x", password: "parola123" } });
  assert.equal(r.data.error, "Adresa de email nu este validă.");
  r = await call("POST", "/auth/register", { body: { email: "a@b.ro", password: "scurt" } });
  assert.equal(r.data.error, "Parola trebuie să aibă cel puțin 8 caractere.");

  r = await call("POST", "/auth/register", { body: { email: "ana@example.com", password: "parola123" } });
  assert.equal(r.status, 202);
  r = await call("POST", "/auth/login", { body: { email: "ana@example.com", password: "parola123" } });
  assert.deepEqual([r.status, r.data.error], [403, "Contul așteaptă aprobarea Owner-ului."]);
  r = await call("POST", "/auth/login", { body: { email: "nimeni@example.com", password: "parola123" } });
  assert.deepEqual([r.status, r.data.error], [401, "Email sau parolă incorectă."]);

  db.failNextUserInsert = true;
  r = await call("POST", "/auth/register", { body: { email: "dublu@example.com", password: "parola123" } });
  assert.deepEqual([r.status, r.data.error], [409, "Există deja un cont cu acest email."]);

  r = await call("POST", "/auth/register", { body: { email: "owner@example.com", password: "parola-owner" } });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.role, "owner");
  assert.equal(r.data.permissions.github_access, true);
  const owner = r.data.token;

  db.log.length = 0;
  r = await call("GET", "/auth/me", { token: owner });
  assert.equal(r.status, 200);
  assert.ok(db.log.some(x => /UPDATE sessions SET expires_at/.test(x.q)), "/auth/me renews the session");

  db.log.length = 0;
  r = await call("GET", "/api/admin/audit?limit=abc", { token: owner });
  assert.equal(r.status, 200);
  assert.deepEqual(db.log.find(x => /FROM audit_log/.test(x.q)).params, [100]);

  r = await call("POST", "/api/admin/users/nu-exista/sessions/revoke", { token: owner });
  assert.deepEqual([r.status, r.data.error], [404, "Utilizator inexistent."]);
  r = await call("PATCH", "/api/admin/ai", { token: owner, body: { paidAiEnabled: "poate" } });
  assert.equal(r.status, 400);
  r = await call("PATCH", "/api/admin/ai", { token: owner, body: { paidAiEnabled: "false" } });
  assert.equal(r.data.paidAiEnabled, false);

  const ana = db.users.find(u => u.email === "ana@example.com");
  r = await call("PATCH", `/api/admin/users/${ana.id}/permissions`, { token: owner, body: { permissions: { web_search: "nu" } } });
  assert.equal(r.status, 400);
  r = await call("PATCH", `/api/admin/users/${ana.id}/permissions`, { token: owner, body: { permissions: { web_search: "false" } } });
  assert.equal(r.data.permissions.web_search, false);

  // 0.7.17: the Owner's button gives one account GPT and Claude free, and takes them back.
  r = await call("PATCH", `/api/admin/users/${ana.id}/paid`, { token: owner, body: { gift: "poate" } });
  assert.equal(r.status, 400);
  r = await call("PATCH", `/api/admin/users/${ana.id}/paid`, { token: owner, body: { gift: true } });
  assert.deepEqual([r.status, r.data.user.paidAccess, r.data.user.paidGift], [200, true, true]);
  r = await call("PATCH", `/api/admin/users/${ana.id}/paid`, { token: owner, body: { gift: false } });
  assert.deepEqual([r.status, r.data.user.paidAccess], [200, false]);
  const ownerRow = db.users.find(u => u.email === "owner@example.com");
  r = await call("PATCH", `/api/admin/users/${ownerRow.id}/paid`, { token: owner, body: { gift: true } });
  assert.equal(r.status, 400);
  r = await call("GET", "/auth/me", { token: owner });
  assert.equal(r.data.user.paidAccess, true, "the Owner always has paid access");

  r = await call("POST", "/auth/logout", { token: owner });
  assert.equal(r.status, 200);
  r = await call("GET", "/auth/me", { token: owner });
  assert.equal(r.status, 401);

  console.log("SERVER_TESTS_PASSED");
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
