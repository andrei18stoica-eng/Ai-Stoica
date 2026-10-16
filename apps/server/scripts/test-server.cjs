// Starts server.cjs against a small in-memory stand-in for PostgreSQL and checks the HTTP contract.
const Module = require("module");
const net = require("net");
const path = require("path");
const assert = require("assert/strict");

const db = { users: [], sessions: new Map(), migrations: new Set(), failNextUserInsert: false, log: [], settings: {}, subs: new Map(), access: new Map(), codes: new Map() };
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
    const [id, email, name, password_hash, role, status, approved_at, email_verified_at] = params;
    db.users.push({ id, email, name, password_hash, role, status, created_at: new Date(), email_verified_at: email_verified_at || null });
    return result([]);
  }
  if (/^\s*SELECT \* FROM users WHERE email=\$1/.test(q)) return result(db.users.filter(u => u.email === params[0]));
  if (/^\s*SELECT \* FROM users WHERE id=\$1/.test(q)) return result(db.users.filter(u => u.id === params[0]));
  if (/SELECT value FROM system_settings WHERE key='vapid_keys'/.test(q)) return result(db.settings.vapid_keys ? [{ value: db.settings.vapid_keys }] : []);
  if (/INSERT INTO system_settings\(key,value\) VALUES\('vapid_keys'/.test(q)) { db.settings.vapid_keys ??= JSON.parse(params[0]); return result([]); }
  if (/^\s*INSERT INTO push_subscriptions/.test(q)) { db.subs.set(params[0], { endpoint: params[0], user_id: params[1], p256dh: params[2], auth: params[3] }); return result([]); }
  if (/^\s*DELETE FROM push_subscriptions WHERE user_id=\$1 AND endpoint=\$2/.test(q)) { const x = db.subs.get(params[1]); if (x && x.user_id === params[0]) db.subs.delete(params[1]); return result([]); }
  if (/^\s*DELETE FROM push_subscriptions WHERE endpoint=\$1/.test(q)) { db.subs.delete(params[0]); return result([]); }
  if (/COUNT\(\*\)::int AS n FROM push_subscriptions/.test(q)) return result([{ n: [...db.subs.values()].filter(x => x.user_id === params[0]).length }]);
  if (/^\s*SELECT endpoint,p256dh,auth FROM push_subscriptions/.test(q)) return result([...db.subs.values()].filter(x => x.user_id === params[0]));
  if (/^\s*INSERT INTO access_requests/.test(q)) { for (const [h, v] of db.access) if (v === params[0]) db.access.delete(h); db.access.set(params[1], params[0]); return result([]); }
  if (/FROM access_requests a JOIN users u/.test(q)) { const uid = db.access.get(params[0]); return result(db.users.filter(u => u.id === uid)); }
  if (/^\s*DELETE FROM access_requests WHERE user_id=\$1/.test(q)) { for (const [h, v] of db.access) if (v === params[0]) db.access.delete(h); return result([]); }
  if (/^\s*UPDATE users SET status=\$1,/.test(q)) { const u = db.users.find(x => x.id === params[2] && x.status === "pending"); if (u) u.status = params[0]; return result([]); }
  if (/^\s*INSERT INTO email_codes/.test(q)) { db.codes.set(params[0], { user_id: params[0], code_hash: params[1], expires_at: params[2], attempts: 0, sent_at: new Date() }); return result([]); }
  if (/^\s*SELECT (\*|sent_at|expires_at) FROM email_codes WHERE user_id=\$1/.test(q)) return result(db.codes.has(params[0]) ? [db.codes.get(params[0])] : []);
  if (/^\s*UPDATE email_codes SET attempts=attempts\+1/.test(q)) { const c = db.codes.get(params[0]); if (c) c.attempts++; return result([]); }
  if (/^\s*DELETE FROM email_codes WHERE user_id=\$1/.test(q)) { db.codes.delete(params[0]); return result([]); }
  if (/^\s*UPDATE users SET email_verified_at=NOW\(\)/.test(q)) { const u = db.users.find(x => x.id === params[0]); if (u) u.email_verified_at = new Date(); return result([]); }
  if (/^\s*DELETE FROM users WHERE id=\$1/.test(q)) { db.users = db.users.filter(x => x.id !== params[0]); return result([]); }
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
// Web Push is replaced by a recorder; an endpoint containing "gone" answers 410 like an expired phone.
const pushes = [];
const fakeWebPush = {
  generateVAPIDKeys: () => ({ publicKey: "BPublicKeyForTests", privateKey: "privateKeyForTests" }),
  sendNotification: async (sub, payload, options) => {
    if (sub.endpoint.includes("gone")) throw Object.assign(new Error("gone"), { statusCode: 410 });
    pushes.push({ endpoint: sub.endpoint, payload: JSON.parse(payload), options });
  }
};
// Email goes to a list instead of SMTP; an address with "fara-cutie" fails like a refused delivery.
const mails = [];
const fakeNodemailer = { createTransport: (opts) => ({ sendMail: async (m) => { if (m.to.includes("fara-cutie")) throw new Error("550 mailbox unavailable"); mails.push({ ...m, opts }); } }) };
const codeFor = (email) => { const m = [...mails].reverse().find(x => x.to === email); return m && m.text.match(/(\d{6})/)[1]; };
Module._load = function (request, parent, isMain) {
  if (request === "pg") return { Pool: FakePool };
  if (request === "nodemailer") return fakeNodemailer;
  if (request === "web-push") return fakeWebPush;
  return originalLoad.call(this, request, parent, isMain);
};

function freePort() {
  return new Promise(resolve => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}

(async () => {
  const port = await freePort();
  Object.assign(process.env, { PORT: String(port), HOST: "127.0.0.1", DATABASE_URL: "postgres://test", OWNER_EMAIL: "Owner@Example.com", OWNER_INITIAL_PASSWORD: "", BLOCKED_EMAIL_DOMAINS: " @Spam.example , ", REGISTRATIONS_PER_HOUR: "100", AUTH_ATTEMPTS_PER_15_MIN: "200", SMTP_HOST: "smtp.example.com", SMTP_USER: "ai@example.com", SMTP_PASS: "x" });
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

  // Spam-bot domains: uberip.com always, BLOCKED_EMAIL_DOMAINS too, subdomains included; nothing reaches the database.
  assert.ok(db.log.some(x => /SET status='blocked'/.test(x.q) && x.params[0].includes("uberip.com") && x.params[0].includes("spam.example")), "existing accounts on blocked domains are blocked at start-up");
  for (const email of ["5wx3th65ofawn0@uberip.com", "X@UberIP.com", "bot@mail.uberip.com", "bot@spam.example"]) {
    r = await call("POST", "/auth/register", { body: { email, password: "parola123" } });
    assert.deepEqual([r.status, r.data.error], [400, "Adresa de email nu este acceptată."], email);
    r = await call("POST", "/auth/login", { body: { email, password: "parola123" } });
    assert.deepEqual([r.status, r.data.status], [403, "blocked"], email);
  }
  assert.ok(!db.users.some(u => /uberip|spam\.example/.test(u.email)), "blocked sign-ups are not stored");
  r = await call("POST", "/auth/register", { body: { email: "om@notuberip.com", password: "parola123" } });
  assert.equal(r.status, 202, "a domain that only ends with the same letters is not blocked");

  // Sign-up code by email: the account reaches the Owner only after the code from the inbox is typed.
  r = await call("POST", "/auth/register", { body: { email: "ana@example.com", password: "parola123" } });
  assert.deepEqual([r.status, r.data.status], [202, "verify_email"]);
  const anaMail = mails.at(-1);
  assert.equal(anaMail.to, "ana@example.com");
  assert.match(anaMail.subject, /^Codul tău Serasmart AI: \d{6}$/);
  assert.equal(anaMail.from, "Serasmart AI <ai@example.com>");
  assert.equal(anaMail.opts.port, 587);
  const anaId = db.users.find(u => u.email === "ana@example.com").id;
  assert.ok(!db.codes.get(anaId).code_hash.includes(codeFor("ana@example.com")), "only a hash of the code is stored");
  r = await call("POST", "/auth/login", { body: { email: "ana@example.com", password: "parola123" } });
  assert.deepEqual([r.status, r.data.status], [403, "verify_email"], "login asks for the code first");
  r = await call("POST", "/auth/resend-code", { body: { email: "ana@example.com" } });
  assert.equal(r.status, 429, "a new code at most once a minute");
  r = await call("POST", "/auth/resend-code", { body: { email: "nimeni@example.com" } });
  assert.equal(r.status, 200, "unknown addresses get the same answer");
  const wrong = codeFor("ana@example.com") === "000000" ? "111111" : "000000";
  r = await call("POST", "/auth/verify-email", { body: { email: "ana@example.com", code: wrong } });
  assert.deepEqual([r.status, r.data.error], [400, "Codul nu este corect."]);
  r = await call("POST", "/auth/verify-email", { body: { email: "ANA@example.com", code: codeFor("ana@example.com") } });
  assert.deepEqual([r.status, r.data.status], [202, "pending"]);
  assert.ok(db.users.find(u => u.id === anaId).email_verified_at, "the email is confirmed");
  r = await call("POST", "/auth/verify-email", { body: { email: "ana@example.com", code: codeFor("ana@example.com") } });
  assert.equal(r.status, 400, "a code works once");
  r = await call("POST", "/auth/login", { body: { email: "ana@example.com", password: "parola123" } });
  assert.deepEqual([r.status, r.data.error], [403, "Contul așteaptă aprobarea Owner-ului."]);

  r = await call("POST", "/auth/register", { body: { email: "x@fara-cutie.ro", password: "parola123" } });
  assert.deepEqual([r.status, r.data.error], [502, "Nu am putut trimite emailul cu codul. Verifică adresa și încearcă din nou."]);
  assert.ok(!db.users.some(u => u.email === "x@fara-cutie.ro"), "an address that cannot receive mail leaves no account");

  r = await call("POST", "/auth/register", { body: { email: "ghicitor@example.com", password: "parola123" } });
  for (let i = 0; i < 5; i++) r = await call("POST", "/auth/verify-email", { body: { email: "ghicitor@example.com", code: String(i).repeat(6) === codeFor("ghicitor@example.com") ? "999999" : String(i).repeat(6) } });
  assert.deepEqual([r.status, r.data.error], [400, "Prea multe coduri greșite. Cere un cod nou."]);
  r = await call("POST", "/auth/verify-email", { body: { email: "ghicitor@example.com", code: codeFor("ghicitor@example.com") } });
  assert.equal(r.status, 429, "after 5 wrong codes even the right one is refused");
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

  // Phone notification for a new account, with Permite / Refuză that work from the notification itself.
  r = await call("GET", "/api/admin/push");
  assert.equal(r.status, 401, "push settings need the Owner");
  r = await call("GET", "/api/admin/push", { token: owner });
  assert.deepEqual([r.status, r.data.publicKey, r.data.devices], [200, "BPublicKeyForTests", 0]);
  assert.equal(db.settings.vapid_keys.privateKey, "privateKeyForTests", "VAPID keys are generated once and kept in the database");
  r = await call("POST", "/api/admin/push/subscribe", { token: owner, body: { subscription: { endpoint: "http://insecure", keys: { p256dh: "x", auth: "y" } } } });
  assert.equal(r.status, 400);
  const phone = { endpoint: "https://push.example/telefon", keys: { p256dh: "BPhoneKey_1234567890abcdefghij", auth: "authKey12345" } };
  r = await call("POST", "/api/admin/push/subscribe", { token: owner, body: { subscription: phone } });
  assert.deepEqual([r.status, r.data.devices], [200, 1]);
  r = await call("POST", "/api/admin/push/subscribe", { token: owner, body: { subscription: { ...phone, endpoint: "https://push.example/gone" } } });
  assert.equal(r.data.devices, 2);
  r = await call("POST", "/api/admin/push/test", { token: owner });
  assert.equal(r.data.delivered, 1, "an expired phone does not count");
  assert.ok(!db.subs.has("https://push.example/gone"), "an expired phone (410) is forgotten");

  const waitPush = async (n) => { for (let i = 0; i < 50 && pushes.length < n; i++) await new Promise(r => setTimeout(r, 20)); return pushes[n - 1]; };
  const before = pushes.length;
  r = await call("POST", "/auth/register", { body: { email: "maria@gmail.com", password: "parola123", name: "Maria" } });
  assert.deepEqual([r.status, r.data.status], [202, "verify_email"]);
  await new Promise(r => setTimeout(r, 100));
  assert.equal(pushes.length, before, "no phone notification before the email is confirmed");
  r = await call("POST", "/auth/verify-email", { body: { email: "maria@gmail.com", code: codeFor("maria@gmail.com") } });
  assert.equal(r.status, 202);
  const sent = await waitPush(before + 1);
  assert.ok(sent, "the Owner's phone gets a notification for a new account");
  assert.equal(sent.payload.body, "Maria (maria@gmail.com) vrea să se conecteze la Serasmart AI. Permiți?");
  assert.equal(sent.payload.kind, "access_request");
  assert.match(sent.payload.url, /^\/\?access=[a-f0-9]{64}$/);
  assert.equal(sent.options.vapidDetails.subject, "mailto:owner@example.com");
  const token = sent.payload.token;
  r = await call("GET", "/auth/access-requests/" + token);
  assert.deepEqual([r.status, r.data.request.name, r.data.request.email], [200, "Maria", "maria@gmail.com"]);
  r = await call("POST", "/auth/access-requests/" + token, { body: { decision: "poate" } });
  assert.equal(r.status, 400);
  r = await call("POST", "/auth/access-requests/" + token, { body: { decision: "allow" } });
  assert.deepEqual([r.status, r.data.status], [200, "active"]);
  assert.equal(db.users.find(u => u.email === "maria@gmail.com").status, "active");
  r = await call("POST", "/auth/access-requests/" + token, { body: { decision: "deny" } });
  assert.equal(r.status, 404, "the link works only once");
  r = await call("POST", "/auth/login", { body: { email: "maria@gmail.com", password: "parola123" } });
  assert.equal(r.status, 200, "an allowed account can sign in");

  r = await call("POST", "/auth/register", { body: { email: "ion@example.com", password: "parola123", name: "Ion" } });
  r = await call("POST", "/auth/verify-email", { body: { email: "ion@example.com", code: codeFor("ion@example.com") } });
  const ionPush = await waitPush(before + 2);
  r = await call("POST", "/auth/access-requests/" + ionPush.payload.token, { body: { decision: "deny" } });
  assert.deepEqual([r.status, r.data.status], [200, "rejected"]);
  r = await call("POST", "/auth/login", { body: { email: "ion@example.com", password: "parola123" } });
  assert.equal(r.status, 403, "a refused account cannot sign in");
  r = await call("GET", "/auth/access-requests/" + "0".repeat(64));
  assert.equal(r.status, 404);
  r = await call("POST", "/api/admin/push/unsubscribe", { token: owner, body: { endpoint: phone.endpoint } });
  assert.equal(r.data.devices, 0);

  // 0.7.18: an automation's result reaches its account as a notification (sent by the gateway with the account's session).
  const noticesBefore = db.log.filter(x => /INSERT INTO notifications/.test(x.q)).length;
  r = await call("POST", "/api/notifications/self", { token: owner, body: { type: "automation", title: "Știrile zilei", body: "Trei știri noi." } });
  assert.equal(r.status, 200, "an account can notify itself about an automation");
  const notice = db.log.filter(x => /INSERT INTO notifications/.test(x.q)).at(-1);
  assert.ok(db.log.filter(x => /INSERT INTO notifications/.test(x.q)).length === noticesBefore + 1 && notice.params[2] === "automation" && notice.params[3] === "Știrile zilei");
  r = await call("POST", "/api/notifications/self", { token: owner, body: { type: "account_status", title: "Cont aprobat" } });
  assert.equal(r.status, 400, "only automation notices may be sent this way");
  r = await call("POST", "/api/notifications/self", { body: { type: "automation", title: "x" } });
  assert.equal(r.status, 401, "a session is needed");

  r = await call("POST", "/auth/logout", { token: owner });
  assert.equal(r.status, 200);
  r = await call("GET", "/auth/me", { token: owner });
  assert.equal(r.status, 401);

  console.log("SERVER_TESTS_PASSED");
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
