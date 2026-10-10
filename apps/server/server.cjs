const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const { Pool } = require("pg");
const { PAID_PROVIDERS, evaluateModelAccess, providerAccess } = require("./ai-policy.cjs");

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";
const OWNER_EMAIL = String(process.env.OWNER_EMAIL || "").trim().toLowerCase();
const SESSION_TTL_DAYS = Math.max(1, Number(process.env.SESSION_TTL_DAYS || 30));
const DATABASE_URL = process.env.DATABASE_URL;
// Optional but recommended: when set, the Owner account is created by the server itself at startup
// and nobody can claim the Owner e-mail through the public registration form.
const OWNER_INITIAL_PASSWORD = String(process.env.OWNER_INITIAL_PASSWORD || "");
const MIN_PASSWORD = 8;

const MSG = {
  email: "Adresa de email nu este validă.",
  password: `Parola trebuie să aibă cel puțin ${MIN_PASSWORD} caractere.`,
  passwordLong: "Parola poate avea cel mult 256 de caractere.",
  name: "Numele poate avea cel mult 100 de caractere.",
  exists: "Există deja un cont cu acest email.",
  credentials: "Email sau parolă incorectă.",
  pending: "Contul așteaptă aprobarea Owner-ului.",
  inactive: "Contul nu este activ.",
  tooMany: "Prea multe încercări. Așteaptă 15 minute și încearcă din nou.",
  auth: "Autentificare necesară.",
  session: "Sesiune invalidă sau expirată.",
  ownerOnly: "Acces rezervat Owner.",
  userMissing: "Utilizator inexistent."
};

if (!DATABASE_URL && !process.env.PGHOST) throw new Error("DATABASE_URL or PGHOST/PGUSER/PGPASSWORD/PGDATABASE is required");
if (!OWNER_EMAIL) throw new Error("OWNER_EMAIL is required");
if (OWNER_INITIAL_PASSWORD && OWNER_INITIAL_PASSWORD.length < MIN_PASSWORD) throw new Error(`OWNER_INITIAL_PASSWORD must have at least ${MIN_PASSWORD} characters`);

const pool = new Pool({
  ...(DATABASE_URL ? { connectionString: DATABASE_URL } : {}),
  max: Number(process.env.PG_POOL_MAX || 10),
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  statement_timeout: 30000,
  query_timeout: 35000
});
pool.on("error", e => console.error("[AI Stoica] PostgreSQL:", e.message));

const DEFAULT_USER_PERMISSIONS = {
  chat: true,
  cerebras: true,
  gemini: true,
  groq: true,
  cloudflare: true,
  openrouter: false,
  image_generation: true,
  video_generation: false,
  document_generation: true,
  file_upload: true,
  web_search: true,
  deep_research: false,
  automations: false,
  plugins: false,
  github_access: false,
  openai: false,
  anthropic: false,
  // "Code AI Stoica" (Codex / Claude Code). The Owner gives it per account; those accounts use the paid APIs, never
  // the Owner's own subscriptions.
  code: false
};
const OWNER_PERMISSIONS = { ...DEFAULT_USER_PERMISSIONS, video_generation: true, deep_research: true, automations: true, plugins: true, github_access: true, openai: true, anthropic: true, openrouter: true, code: true };

function httpError(status, message) { const e = new Error(message); e.status = status; e.expose = true; return e; }
function toBool(value) {
  if (value === true || value === false) return value;
  if (value === "true" || value === 1 || value === "1") return true;
  if (value === "false" || value === 0 || value === "0") return false;
  return undefined;
}
function intQuery(value, def, min, max) {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}

async function loadAiContext(user) {
  const [permissionsRow, paidRow, combinationsRow] = await Promise.all([
    pool.query("SELECT permissions FROM user_permissions WHERE user_id=$1", [user.id]),
    pool.query("SELECT value FROM system_settings WHERE key='paid_ai_enabled'"),
    pool.query("SELECT id,name,providers,paid_required,enabled FROM ai_combinations ORDER BY paid_required,id")
  ]);
  return {
    user,
    permissions: { ...DEFAULT_USER_PERMISSIONS, ...(permissionsRow.rows[0]?.permissions || {}) },
    paidEnabled: paidRow.rows[0]?.value === true,
    combinations: combinationsRow.rows
  };
}

function normalizeEmail(v) { return String(v || "").trim().toLowerCase(); }
function randomToken() { return crypto.randomBytes(32).toString("hex"); }
function sha256(v) { return crypto.createHash("sha256").update(String(v)).digest("hex"); }
function id() { return crypto.randomUUID(); }
// req.ip honours "trust proxy" (TRUST_PROXY_HOPS), so a client cannot fake its address with headers.
function clientIp(req) { return String(req.ip || req.socket?.remoteAddress || "").slice(0, 80); }
function isOwnerRow(row) { return row?.role === "owner" && normalizeEmail(row.email) === OWNER_EMAIL; }

// Same cost as real hashes, so unknown e-mails take as long as wrong passwords.
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString("hex"), 12);

async function ensureOwnerAccount() {
  if (!OWNER_INITIAL_PASSWORD) {
    console.warn("[AI Stoica] OWNER_INITIAL_PASSWORD is not set: until the Owner registers, anyone who knows OWNER_EMAIL could register it.");
    return;
  }
  const existing = await pool.query("SELECT id FROM users WHERE lower(email)=lower($1)", [OWNER_EMAIL]);
  if (existing.rowCount) return;
  const userId = id();
  await pool.query(
    `INSERT INTO users(id,email,name,password_hash,role,status,approved_at) VALUES($1,$2,$3,$4,'owner','active',NOW())`,
    [userId, OWNER_EMAIL, OWNER_EMAIL.split("@")[0], await bcrypt.hash(OWNER_INITIAL_PASSWORD, 12)]
  );
  await pool.query(
    "INSERT INTO user_permissions(user_id,permissions) VALUES($1,$2::jsonb) ON CONFLICT(user_id) DO NOTHING",
    [userId, JSON.stringify(OWNER_PERMISSIONS)]
  );
  await audit(userId, "owner.bootstrap", userId, {});
  console.log("[AI Stoica] Owner account created from OWNER_INITIAL_PASSWORD. You can remove the variable now.");
}

// Every .sql file in migrations/ runs once, in name order, under an advisory lock (safe with several replicas).
async function runMigrations() {
  const dir = path.join(__dirname, "migrations");
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".sql")).sort();
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(731107)");
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
    const done = new Set((await client.query("SELECT version FROM schema_migrations")).rows.map(r => r.version));
    for (const file of files) {
      if (done.has(file)) continue;
      await client.query("BEGIN");
      try {
        await client.query(fs.readFileSync(path.join(dir, file), "utf8"));
        await client.query("INSERT INTO schema_migrations(version) VALUES($1)", [file]);
        await client.query("COMMIT");
        console.log("[AI Stoica] Migration applied:", file);
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(731107)").catch(() => {});
    client.release();
  }
}

async function migrate() {
  await runMigrations();
  await ensureOwnerAccount();
  await pool.query(
    "UPDATE users SET role='owner', status='active', approved_at=COALESCE(approved_at,NOW()) WHERE lower(email)=lower($1)",
    [OWNER_EMAIL]
  );
  // An Owner role left from a previous OWNER_EMAIL grants nothing anymore.
  await pool.query("UPDATE users SET role='user', updated_at=NOW() WHERE role='owner' AND lower(email)<>lower($1)", [OWNER_EMAIL]);

  // One-time transition: paid AI is Owner-only by default.
  // The Owner may later enable paid AI for normal accounts from Control Center.
  const ownerPaidOnlyFlag = await pool.query("SELECT value FROM system_settings WHERE key='owner_paid_only_v1_applied'");
  if (ownerPaidOnlyFlag.rows[0]?.value !== true) {
    await pool.query(
      `INSERT INTO system_settings(key,value,updated_at)
       VALUES('paid_ai_enabled','false'::jsonb,NOW())
       ON CONFLICT(key) DO UPDATE SET value='false'::jsonb,updated_at=NOW()`
    );
    await pool.query(
      `INSERT INTO system_settings(key,value,updated_at)
       VALUES('owner_paid_only_v1_applied','true'::jsonb,NOW())
       ON CONFLICT(key) DO UPDATE SET value='true'::jsonb,updated_at=NOW()`
    );
  }

  const securityFlag = await pool.query("SELECT value FROM system_settings WHERE key='model_policy_v2_applied'");
  if (securityFlag.rows[0]?.value !== true) {
    await pool.query(
      `UPDATE user_permissions p
       SET permissions=jsonb_set(COALESCE(p.permissions,'{}'::jsonb),'{openrouter}','false'::jsonb,true), updated_at=NOW()
       FROM users u
       WHERE p.user_id=u.id AND u.role<>'owner'`
    );
    await pool.query(
      `INSERT INTO system_settings(key,value,updated_at)
       VALUES('model_policy_v2_applied','true'::jsonb,NOW())
       ON CONFLICT(key) DO UPDATE SET value='true'::jsonb,updated_at=NOW()`
    );
  }
}

async function audit(actorUserId, action, targetUserId = null, details = {}) {
  await pool.query(
    "INSERT INTO audit_log(actor_user_id,action,target_user_id,details) VALUES($1,$2,$3,$4::jsonb)",
    [actorUserId || null, action, targetUserId || null, JSON.stringify(details || {})]
  );
}

async function notify(userId, type, title, body = "") {
  if (!userId) return;
  await pool.query(
    "INSERT INTO notifications(id,user_id,type,title,body) VALUES($1,$2,$3,$4,$5)",
    [id(), userId, type, title, body]
  );
}
// Login notices are sent at most once per hour per account (and per watched account for the Owner).
async function notifyThrottled(userId, type, title, body, key = "") {
  if (!userId) return;
  const recent = await pool.query(
    "SELECT 1 FROM notifications WHERE user_id=$1 AND type=$2 AND ($3='' OR body LIKE $4) AND created_at>NOW()-INTERVAL '1 hour' LIMIT 1",
    [userId, type, key, "%" + key + "%"]
  );
  if (!recent.rowCount) await notify(userId, type, title, body);
}

async function ownerUserId() {
  const q = await pool.query("SELECT id FROM users WHERE lower(email)=lower($1) LIMIT 1", [OWNER_EMAIL]);
  return q.rows[0]?.id || null;
}

async function createSession(req, userId) {
  const token = randomToken();
  const tokenHash = sha256(token);
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 86400000);
  await pool.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at,user_agent,ip_address) VALUES($1,$2,$3,$4,$5)",
    [tokenHash, userId, expires, String(req.headers["user-agent"] || "").slice(0, 500), clientIp(req)]
  );
  return token;
}

function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: isOwnerRow(row) ? "owner" : "user",
    status: row.status,
    createdAt: row.created_at,
    approvedAt: row.approved_at,
    lastLoginAt: row.last_login_at
  };
}
function inactiveBody(status) { return { error: status === "pending" ? MSG.pending : MSG.inactive, status }; }
async function permissionsFor(user) {
  if (isOwnerRow(user)) return { ...OWNER_PERMISSIONS };
  const p = await pool.query("SELECT permissions FROM user_permissions WHERE user_id=$1", [user.id]);
  return { ...DEFAULT_USER_PERMISSIONS, ...(p.rows[0]?.permissions || {}) };
}

async function auth(req, res, next) {
  try {
    const raw = String(req.headers.authorization || "");
    if (!raw.startsWith("Bearer ")) return res.status(401).json({ error: MSG.auth });
    const tokenHash = sha256(raw.slice(7).trim());
    const q = await pool.query(
      `SELECT u.*, s.token_hash
       FROM sessions s
       JOIN users u ON u.id=s.user_id
       WHERE s.token_hash=$1 AND s.expires_at>NOW()`,
      [tokenHash]
    );
    const user = q.rows[0];
    if (!user) return res.status(401).json({ error: MSG.session });
    if (user.status !== "active") return res.status(403).json(inactiveBody(user.status));
    if (user.role === "owner" && !isOwnerRow(user)) user.role = "user";
    req.user = user;
    req.sessionTokenHash = tokenHash;
    next();
  } catch (e) {
    next(e);
  }
}

function ownerOnly(req, res, next) {
  if (!isOwnerRow(req.user)) return res.status(403).json({ error: MSG.ownerOnly });
  next();
}

const app = express();
app.set("trust proxy", intQuery(process.env.TRUST_PROXY_HOPS, 1, 0, 10));
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({
  origin(origin, cb) {
    const configured = String(process.env.CORS_ORIGIN || "*").trim();
    if (!origin || configured === "*") return cb(null, true);
    const allowed = configured.split(",").map(x => x.trim()).filter(Boolean);
    cb(null, allowed.includes(origin));
  }
}));
app.use(express.json({ limit: "4mb" }));
const limiterDefaults = { standardHeaders: "draft-8", legacyHeaders: false, message: { error: MSG.tooMany } };
// The desktop gateway validates its session on every request, so /auth/me has its own, larger budget.
app.use(rateLimit({ ...limiterDefaults, windowMs: 60_000, limit: Number(process.env.RATE_LIMIT_PER_MINUTE || 120), skip: req => req.path === "/auth/me" || req.path === "/health" }));
const meLimiter = rateLimit({ ...limiterDefaults, windowMs: 60_000, limit: Number(process.env.AUTH_ME_PER_MINUTE || 600) });
// Password guessing protection: at most 20 failed sign-in attempts per IP every 15 minutes.
const authLimiter = rateLimit({ ...limiterDefaults, windowMs: 15 * 60_000, limit: Number(process.env.AUTH_ATTEMPTS_PER_15_MIN || 20), skipSuccessfulRequests: true });
// Successful sign-ups count too, so nobody can flood the Owner with access requests.
const registerLimiter = rateLimit({ ...limiterDefaults, windowMs: 60 * 60_000, limit: Number(process.env.REGISTRATIONS_PER_HOUR || 10) });

app.get("/health", async (_req, res, next) => {
  try {
    const r = await pool.query("SELECT NOW() AS now");
    res.json({ ok: true, service: "AI Stoica Server", database: "ok", time: r.rows[0].now });
  } catch (e) { next(e); }
});

app.post("/auth/register", registerLimiter, authLimiter, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");
    const name = String(req.body?.name || "").trim() || email.split("@")[0];
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: MSG.email });
    if (password.length < MIN_PASSWORD) return res.status(400).json({ error: MSG.password });
    if (password.length > 256) return res.status(400).json({ error: MSG.passwordLong });
    if (name.length > 100) return res.status(400).json({ error: MSG.name });

    const existing = await pool.query("SELECT id FROM users WHERE email=$1", [email]);
    if (existing.rowCount) return res.status(409).json({ error: MSG.exists });

    if (email === OWNER_EMAIL && OWNER_INITIAL_PASSWORD) {
      return res.status(403).json({ error: "Contul Owner este creat de server. Autentifică-te cu parola configurată." });
    }
    const userId = id();
    const isOwner = email === OWNER_EMAIL;
    const passwordHash = await bcrypt.hash(password, 12);
    const role = isOwner ? "owner" : "user";
    const status = isOwner ? "active" : "pending";

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO users(id,email,name,password_hash,role,status,approved_at)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [userId, email, name, passwordHash, role, status, isOwner ? new Date() : null]
      );
      await client.query(
        "INSERT INTO user_permissions(user_id,permissions) VALUES($1,$2::jsonb)",
        [userId, JSON.stringify(isOwner ? OWNER_PERMISSIONS : DEFAULT_USER_PERMISSIONS)]
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      if (e.code === "23505") return res.status(409).json({ error: MSG.exists });
      throw e;
    } finally {
      client.release();
    }

    await audit(userId, "user.register", userId, { status, role, ip: clientIp(req) });

    if (!isOwner) {
      const ownerId = await ownerUserId();
      if (ownerId) {
        await notify(ownerId, "access_request", "Cerere nouă de acces", `${name} (${email}) a creat un cont și așteaptă aprobarea.`);
      }
      return res.status(202).json({
        ok: true,
        status: "pending",
        message: "Cont creat. Accesul așteaptă aprobarea Owner-ului."
      });
    }

    const token = await createSession(req, userId);
    const q = await pool.query("SELECT * FROM users WHERE id=$1", [userId]);
    res.status(201).json({ token, user: publicUser(q.rows[0]), permissions: await permissionsFor(q.rows[0]) });
  } catch (e) { next(e); }
});

app.post("/auth/login", authLimiter, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");
    const q = await pool.query("SELECT * FROM users WHERE email=$1", [email]);
    const user = q.rows[0];
    const ok = await bcrypt.compare(password, user?.password_hash || DUMMY_HASH);
    if (!user || !ok) return res.status(401).json({ error: MSG.credentials });
    if (user.status !== "active") return res.status(403).json(inactiveBody(user.status));
    if (email === OWNER_EMAIL && user.role !== "owner") {
      await pool.query("UPDATE users SET role='owner', approved_at=COALESCE(approved_at,NOW()) WHERE id=$1", [user.id]);
      user.role = "owner";
    }
    await pool.query("UPDATE users SET last_login_at=NOW(), updated_at=NOW() WHERE id=$1", [user.id]);
    const token = await createSession(req, user.id);
    const ip = clientIp(req);
    await audit(user.id, "user.login", user.id, { ip });

    await notifyThrottled(user.id, "login", "Autentificare AI Stoica", `Te-ai autentificat la AI Stoica de la adresa ${ip || "necunoscută"}.`);
    if (!isOwnerRow(user)) {
      const ownerId = await ownerUserId();
      if (ownerId) await notifyThrottled(ownerId, "user_login", "Utilizator conectat", `${user.name} (${user.email}) s-a autentificat. IP: ${ip || "necunoscut"}.`, `(${user.email})`);
    }

    const refreshed = (await pool.query("SELECT * FROM users WHERE id=$1", [user.id])).rows[0] || user;
    res.json({ token, user: publicUser(refreshed), permissions: await permissionsFor(refreshed) });
  } catch (e) { next(e); }
});

app.post("/auth/logout", auth, async (req, res, next) => {
  try {
    await pool.query("DELETE FROM sessions WHERE token_hash=$1", [req.sessionTokenHash]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.get("/auth/me", meLimiter, auth, async (req, res, next) => {
  try {
    await pool.query("UPDATE sessions SET expires_at=$2 WHERE token_hash=$1", [req.sessionTokenHash, new Date(Date.now() + SESSION_TTL_DAYS * 86400000)]);
    res.json({ user: publicUser(req.user), permissions: await permissionsFor(req.user) });
  } catch (e) { next(e); }
});

app.get("/api/admin/users", auth, ownerOnly, async (req, res, next) => {
  try {
    const limit = intQuery(req.query?.limit, 500, 1, 1000), offset = intQuery(req.query?.offset, 0, 0, 1e9);
    const q = await pool.query(
      `SELECT u.id,u.email,u.name,u.role,u.status,u.created_at,u.approved_at,u.last_login_at,
              COALESCE(p.permissions,'{}'::jsonb) AS permissions,
              (SELECT COUNT(*)::int FROM sessions s WHERE s.user_id=u.id AND s.expires_at>NOW()) AS active_sessions
       FROM users u
       LEFT JOIN user_permissions p ON p.user_id=u.id
       ORDER BY u.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json({ data: q.rows.map(row => ({ ...row, role: isOwnerRow(row) ? "owner" : "user", permissions: { ...DEFAULT_USER_PERMISSIONS, ...(row.permissions || {}) } })) });
  } catch (e) { next(e); }
});

async function adminTarget(targetId) {
  const target = await pool.query("SELECT * FROM users WHERE id=$1", [targetId]);
  if (!target.rowCount) throw httpError(404, MSG.userMissing);
  return target.rows[0];
}

app.patch("/api/admin/users/:id/status", auth, ownerOnly, async (req, res, next) => {
  try {
    const status = String(req.body?.status || "");
    if (!["pending","active","rejected","suspended","blocked"].includes(status)) {
      return res.status(400).json({ error: "Status invalid." });
    }
    const target = await adminTarget(req.params.id);
    if (isOwnerRow(target)) return res.status(400).json({ error: "Contul Owner nu poate fi blocat din aplicație." });

    await pool.query(
      `UPDATE users
       SET status=$1,
           role='user',
           approved_at=CASE WHEN $1='active' THEN COALESCE(approved_at,NOW()) ELSE approved_at END,
           approved_by=CASE WHEN $1='active' THEN $2 ELSE approved_by END,
           updated_at=NOW()
       WHERE id=$3`,
      [status, req.user.id, target.id]
    );
    if (status !== "active") await pool.query("DELETE FROM sessions WHERE user_id=$1", [target.id]);
    await audit(req.user.id, "admin.user_status", target.id, { status });
    const statusLabels = {
      active: "Cont aprobat",
      pending: "Cont în așteptare",
      rejected: "Cerere respinsă",
      suspended: "Cont suspendat",
      blocked: "Cont blocat"
    };
    await notify(target.id, "account_status", statusLabels[status], `Statusul contului tău AI Stoica: ${statusLabels[status]}.`);
    const updated = await pool.query("SELECT * FROM users WHERE id=$1", [target.id]);
    res.json({ user: publicUser(updated.rows[0]) });
  } catch (e) { next(e); }
});

app.patch("/api/admin/users/:id/permissions", auth, ownerOnly, async (req, res, next) => {
  try {
    const input = req.body?.permissions;
    if (!input || typeof input !== "object" || Array.isArray(input)) return res.status(400).json({ error: "Lipsește obiectul „permissions”." });
    const target = await adminTarget(req.params.id);
    if (isOwnerRow(target)) return res.status(400).json({ error: "Permisiunile Owner sunt complete și nu se restricționează aici." });

    const client = await pool.connect();
    let nextPermissions;
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO user_permissions(user_id,permissions) VALUES($1,$2::jsonb) ON CONFLICT(user_id) DO NOTHING", [target.id, JSON.stringify(DEFAULT_USER_PERMISSIONS)]);
      const current = await client.query("SELECT permissions FROM user_permissions WHERE user_id=$1 FOR UPDATE", [target.id]);
      nextPermissions = { ...DEFAULT_USER_PERMISSIONS, ...(current.rows[0]?.permissions || {}) };
      for (const [k, v] of Object.entries(input)) {
        if (!Object.hasOwn(DEFAULT_USER_PERMISSIONS, k)) continue;
        const value = toBool(v);
        if (typeof value !== "boolean") { await client.query("ROLLBACK"); return res.status(400).json({ error: `Permisiunea „${k}” trebuie să fie true sau false.` }); }
        nextPermissions[k] = value;
      }
      await client.query("UPDATE user_permissions SET permissions=$2::jsonb, updated_at=NOW() WHERE user_id=$1", [target.id, JSON.stringify(nextPermissions)]);
      await client.query("COMMIT");
    } catch (e) { try { await client.query("ROLLBACK"); } catch {} throw e; } finally { client.release(); }
    await audit(req.user.id, "admin.permissions", target.id, { permissions: nextPermissions });
    res.json({ permissions: nextPermissions });
  } catch (e) { next(e); }
});

// Per-model choice for one account: { model: "<id>", mode: "allow" | "deny" | "default" }. Kept in the same permissions
// document as model_overrides, so /auth/me and /api/ai/access carry it to the gateway.
app.patch("/api/admin/users/:id/models", auth, ownerOnly, async (req, res, next) => {
  try {
    const model = String(req.body?.model || "").trim();
    const mode = String(req.body?.mode || "").trim();
    if (!model || model.length > 200) return res.status(400).json({ error: "Modelul lipsește sau este prea lung." });
    if (!["allow", "deny", "default"].includes(mode)) return res.status(400).json({ error: "Modul trebuie să fie allow, deny sau default." });
    const target = await adminTarget(req.params.id);
    if (isOwnerRow(target)) return res.status(400).json({ error: "Owner-ul are acces la toate modelele." });
    // One transaction with the row locked: two quick clicks on different models must not overwrite each other.
    const client = await pool.connect();
    let nextPermissions;
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO user_permissions(user_id,permissions) VALUES($1,$2::jsonb) ON CONFLICT(user_id) DO NOTHING", [target.id, JSON.stringify(DEFAULT_USER_PERMISSIONS)]);
      const current = await client.query("SELECT permissions FROM user_permissions WHERE user_id=$1 FOR UPDATE", [target.id]);
      nextPermissions = { ...DEFAULT_USER_PERMISSIONS, ...(current.rows[0]?.permissions || {}) };
      const overrides = { ...(nextPermissions.model_overrides && typeof nextPermissions.model_overrides === "object" ? nextPermissions.model_overrides : {}) };
      for (const k of Object.keys(overrides)) if (k.toLowerCase() === model.toLowerCase()) delete overrides[k];
      if (mode !== "default") overrides[model] = mode;
      if (Object.keys(overrides).length > 2000) { await client.query("ROLLBACK"); return res.status(413).json({ error: "Prea multe modele setate pentru acest cont." }); }
      nextPermissions.model_overrides = overrides;
      await client.query("UPDATE user_permissions SET permissions=$2::jsonb, updated_at=NOW() WHERE user_id=$1", [target.id, JSON.stringify(nextPermissions)]);
      await client.query("COMMIT");
    } catch (e) { try { await client.query("ROLLBACK"); } catch {} throw e; } finally { client.release(); }
    await audit(req.user.id, "admin.model_override", target.id, { model, mode });
    res.json({ permissions: nextPermissions });
  } catch (e) { next(e); }
});

app.post("/api/admin/users/:id/sessions/revoke", auth, ownerOnly, async (req, res, next) => {
  try {
    const target = await adminTarget(req.params.id);
    await pool.query("DELETE FROM sessions WHERE user_id=$1", [target.id]);
    await audit(req.user.id, "admin.sessions_revoke", target.id, {});
    res.json({ ok: true });
  } catch (e) { next(e); }
});


app.get("/api/notifications", auth, async (req, res, next) => {
  try {
    const q = await pool.query(
      `SELECT id,type,title,body,read_at,created_at
       FROM notifications
       WHERE user_id=$1
       ORDER BY created_at DESC
       LIMIT 100`,
      [req.user.id]
    );
    const unread = q.rows.filter(x => !x.read_at).length;
    res.json({ data: q.rows, unread });
  } catch (e) { next(e); }
});

app.patch("/api/notifications/:id/read", auth, async (req, res, next) => {
  try {
    const q = await pool.query(
      "UPDATE notifications SET read_at=COALESCE(read_at,NOW()) WHERE id=$1 AND user_id=$2 RETURNING id,read_at",
      [req.params.id, req.user.id]
    );
    if (!q.rowCount) return res.status(404).json({ error: "Notificare inexistentă." });
    res.json({ data: q.rows[0] });
  } catch (e) { next(e); }
});

app.post("/api/notifications/read-all", auth, async (req, res, next) => {
  try {
    await pool.query("UPDATE notifications SET read_at=COALESCE(read_at,NOW()) WHERE user_id=$1", [req.user.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.get("/api/admin/audit", auth, ownerOnly, async (req, res, next) => {
  try {
    const limit = intQuery(req.query?.limit, 100, 1, 200);
    const q = await pool.query(
      `SELECT a.id,a.action,a.details,a.created_at,
              actor.email AS actor_email,target.email AS target_email
       FROM audit_log a
       LEFT JOIN users actor ON actor.id=a.actor_user_id
       LEFT JOIN users target ON target.id=a.target_user_id
       ORDER BY a.created_at DESC
       LIMIT $1`,
      [limit]
    );
    res.json({ data: q.rows });
  } catch (e) { next(e); }
});

app.get("/api/admin/ai", auth, ownerOnly, async (_req, res, next) => {
  try {
    const setting = await pool.query("SELECT value FROM system_settings WHERE key='paid_ai_enabled'");
    const combos = await pool.query("SELECT id,name,providers,paid_required,enabled FROM ai_combinations ORDER BY paid_required,id");
    res.json({ paidAiEnabled: setting.rows[0]?.value === true, combinations: combos.rows });
  } catch (e) { next(e); }
});

app.patch("/api/admin/ai", auth, ownerOnly, async (req, res, next) => {
  try {
    const enabled = toBool(req.body?.paidAiEnabled);
    if (typeof enabled !== "boolean") return res.status(400).json({ error: "Câmpul „paidAiEnabled” trebuie să fie true sau false." });
    await pool.query(
      `INSERT INTO system_settings(key,value,updated_at)
       VALUES('paid_ai_enabled',$1::jsonb,NOW())
       ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`,
      [JSON.stringify(enabled)]
    );
    await audit(req.user.id, "admin.paid_ai", null, { enabled });
    res.json({ paidAiEnabled: enabled });
  } catch (e) { next(e); }
});

app.post("/api/ai/access", auth, async (req, res, next) => {
  try {
    const raw = Array.isArray(req.body?.models) ? req.body.models : [req.body?.model];
    const models = [...new Set(raw.map(x => String(x || "").trim()).filter(Boolean))];
    if (!models.length) return res.status(400).json({ error:"Modelul sau lista de modele lipsește." });
    if (models.length > 1000) return res.status(413).json({ error:"Prea multe modele într-o singură verificare (maximum 1000)." });
    const context = await loadAiContext(req.user);
    const data = models.map(model => evaluateModelAccess(context, model));
    res.json({ data, policyEnforced:true, paidAiEnabled:context.paidEnabled });
  } catch (e) { next(e); }
});

app.get("/api/ai/catalog", auth, async (req, res, next) => {
  try {
    const context = await loadAiContext(req.user);
    const providerIds = ["cerebras","gemini","groq","cloudflare","openrouter","openai","anthropic"];
    const providers = providerIds.map(id => ({
      id,
      tier: PAID_PROVIDERS.has(id) ? "paid" : "free",
      enabled: providerAccess(context,id).allowed
    }));
    const combinations = context.combinations
      .filter(c => c.enabled !== false)
      .map(c => {
        const access = evaluateModelAccess(context, c.id);
        return { ...c, available:access.allowed, unavailableReason:access.allowed ? "" : access.reason };
      });
    const paidAvailable = providers.some(p => p.tier === "paid" && p.enabled);
    res.json({
      freeOnly: !paidAvailable,
      paidAiEnabled: context.paidEnabled,
      providers,
      combinations
    });
  } catch (e) { next(e); }
});

app.use((_req, res) => res.status(404).json({ error: "Endpoint inexistent." }));

app.use((err, _req, res, _next) => {
  const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error(err);
  let message = "Eroare internă AI Stoica.";
  if (err?.type === "entity.parse.failed") message = "Corpul cererii nu este JSON valid.";
  else if (err?.type === "entity.too.large") message = "Cererea depășește limita de 4 MB.";
  else if (status < 500 && err?.expose && err.message) message = err.message;
  else if (status < 500) message = "Cerere invalidă.";
  if (res.headersSent) return;
  res.status(status).json({ error: message });
});

async function cleanup() {
  await pool.query("DELETE FROM sessions WHERE expires_at<=NOW()");
  await pool.query("DELETE FROM notifications WHERE created_at<NOW()-INTERVAL '90 days'");
  await pool.query(
    `DELETE FROM notifications n USING (
       SELECT id FROM (SELECT id,ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS rn FROM notifications) x WHERE x.rn>500
     ) old WHERE n.id=old.id`
  );
}

let server = null;
async function shutdown(signal) {
  console.log(`[AI Stoica] ${signal}: closing the server...`);
  const force = setTimeout(() => process.exit(1), 10000);
  force.unref();
  try {
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.end();
  } finally { process.exit(0); }
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

(async () => {
  await migrate();
  await cleanup();
  setInterval(() => { cleanup().catch(e => console.error("[AI Stoica] cleanup:", e.message)); }, 60 * 60 * 1000).unref();
  server = app.listen(PORT, HOST, () => console.log(`AI Stoica Server listening on ${HOST}:${PORT}`));
})().catch(err => {
  console.error("AI Stoica Server failed to start:", err);
  process.exit(1);
});
