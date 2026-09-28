const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const { Pool } = require("pg");

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";
const OWNER_EMAIL = String(process.env.OWNER_EMAIL || "").trim().toLowerCase();
const SESSION_TTL_DAYS = Math.max(1, Number(process.env.SESSION_TTL_DAYS || 30));
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!OWNER_EMAIL) throw new Error("OWNER_EMAIL is required");

const pool = new Pool({ connectionString: DATABASE_URL, max: Number(process.env.PG_POOL_MAX || 10) });

const DEFAULT_USER_PERMISSIONS = {
  chat: true,
  cerebras: true,
  gemini: true,
  groq: true,
  cloudflare: true,
  openrouter: true,
  image_generation: true,
  document_generation: true,
  file_upload: true,
  web_search: true,
  deep_research: false,
  automations: false,
  plugins: false,
  github_access: false,
  openai: false,
  anthropic: false
};

function normalizeEmail(v) { return String(v || "").trim().toLowerCase(); }
function randomToken() { return crypto.randomBytes(32).toString("hex"); }
function sha256(v) { return crypto.createHash("sha256").update(String(v)).digest("hex"); }
function id() { return crypto.randomUUID(); }
function clientIp(req) { return String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim(); }

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, "migrations", "001_initial.sql"), "utf8");
  await pool.query(sql);
  await pool.query(
    "UPDATE users SET role='owner', status='active', approved_at=COALESCE(approved_at,NOW()) WHERE lower(email)=lower($1)",
    [OWNER_EMAIL]
  );
}

async function audit(actorUserId, action, targetUserId = null, details = {}) {
  await pool.query(
    "INSERT INTO audit_log(actor_user_id,action,target_user_id,details) VALUES($1,$2,$3,$4::jsonb)",
    [actorUserId || null, action, targetUserId || null, JSON.stringify(details || {})]
  );
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
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    approvedAt: row.approved_at,
    lastLoginAt: row.last_login_at
  };
}

async function auth(req, res, next) {
  try {
    const raw = String(req.headers.authorization || "");
    if (!raw.startsWith("Bearer ")) return res.status(401).json({ error: "Autentificare necesară." });
    const tokenHash = sha256(raw.slice(7));
    const q = await pool.query(
      `SELECT u.*, s.token_hash
       FROM sessions s
       JOIN users u ON u.id=s.user_id
       WHERE s.token_hash=$1 AND s.expires_at>NOW()`,
      [tokenHash]
    );
    const user = q.rows[0];
    if (!user) return res.status(401).json({ error: "Sesiune invalidă sau expirată." });
    if (user.status !== "active") return res.status(403).json({ error: "Contul nu este activ.", status: user.status });
    req.user = user;
    req.sessionTokenHash = tokenHash;
    next();
  } catch (e) {
    next(e);
  }
}

function ownerOnly(req, res, next) {
  if (req.user?.role !== "owner") return res.status(403).json({ error: "Acces rezervat Owner." });
  next();
}

const app = express();
app.set("trust proxy", 1);
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
app.use(rateLimit({ windowMs: 60_000, limit: Number(process.env.RATE_LIMIT_PER_MINUTE || 120), standardHeaders: "draft-8", legacyHeaders: false }));

app.get("/health", async (_req, res, next) => {
  try {
    const r = await pool.query("SELECT NOW() AS now");
    res.json({ ok: true, service: "AI Stoica Server", database: "ok", time: r.rows[0].now });
  } catch (e) { next(e); }
});

app.post("/auth/register", async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");
    const name = String(req.body?.name || "").trim() || email.split("@")[0];
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Email invalid." });
    if (password.length < 10) return res.status(400).json({ error: "Parola trebuie să aibă minimum 10 caractere." });

    const existing = await pool.query("SELECT id FROM users WHERE email=$1", [email]);
    if (existing.rowCount) return res.status(409).json({ error: "Contul există deja." });

    const userId = id();
    const isOwner = email === OWNER_EMAIL;
    const passwordHash = await bcrypt.hash(password, 12);
    const role = isOwner ? "owner" : "user";
    const status = isOwner ? "active" : "pending";

    await pool.query("BEGIN");
    try {
      await pool.query(
        `INSERT INTO users(id,email,name,password_hash,role,status,approved_at)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [userId, email, name, passwordHash, role, status, isOwner ? new Date() : null]
      );
      await pool.query(
        "INSERT INTO user_permissions(user_id,permissions) VALUES($1,$2::jsonb)",
        [userId, JSON.stringify(isOwner ? { ...DEFAULT_USER_PERMISSIONS, deep_research:true, automations:true, plugins:true, github_access:true, openai:true, anthropic:true } : DEFAULT_USER_PERMISSIONS)]
      );
      await pool.query("COMMIT");
    } catch (e) {
      await pool.query("ROLLBACK");
      throw e;
    }

    await audit(userId, "user.register", userId, { status, role, ip: clientIp(req) });

    if (!isOwner) {
      return res.status(202).json({
        ok: true,
        status: "pending",
        message: "Cont creat. Accesul așteaptă aprobarea Owner-ului."
      });
    }

    const token = await createSession(req, userId);
    const q = await pool.query("SELECT * FROM users WHERE id=$1", [userId]);
    res.status(201).json({ token, user: publicUser(q.rows[0]) });
  } catch (e) { next(e); }
});

app.post("/auth/login", async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");
    const q = await pool.query("SELECT * FROM users WHERE email=$1", [email]);
    const user = q.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Email sau parolă incorectă." });
    }
    if (user.status !== "active") {
      return res.status(403).json({ error: "Contul nu este activ.", status: user.status });
    }
    if (email === OWNER_EMAIL && user.role !== "owner") {
      await pool.query("UPDATE users SET role='owner', status='active', approved_at=COALESCE(approved_at,NOW()) WHERE id=$1", [user.id]);
      user.role = "owner";
      user.status = "active";
    }
    await pool.query("UPDATE users SET last_login_at=NOW(), updated_at=NOW() WHERE id=$1", [user.id]);
    const token = await createSession(req, user.id);
    await audit(user.id, "user.login", user.id, { ip: clientIp(req) });
    res.json({ token, user: publicUser(user) });
  } catch (e) { next(e); }
});

app.post("/auth/logout", auth, async (req, res, next) => {
  try {
    await pool.query("DELETE FROM sessions WHERE token_hash=$1", [req.sessionTokenHash]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.get("/auth/me", auth, async (req, res, next) => {
  try {
    const p = await pool.query("SELECT permissions FROM user_permissions WHERE user_id=$1", [req.user.id]);
    res.json({ user: publicUser(req.user), permissions: p.rows[0]?.permissions || {} });
  } catch (e) { next(e); }
});

app.get("/api/admin/users", auth, ownerOnly, async (_req, res, next) => {
  try {
    const q = await pool.query(
      `SELECT u.id,u.email,u.name,u.role,u.status,u.created_at,u.approved_at,u.last_login_at,
              COALESCE(p.permissions,'{}'::jsonb) AS permissions,
              (SELECT COUNT(*)::int FROM sessions s WHERE s.user_id=u.id AND s.expires_at>NOW()) AS active_sessions
       FROM users u
       LEFT JOIN user_permissions p ON p.user_id=u.id
       ORDER BY u.created_at DESC`
    );
    res.json({ data: q.rows });
  } catch (e) { next(e); }
});

app.patch("/api/admin/users/:id/status", auth, ownerOnly, async (req, res, next) => {
  try {
    const targetId = req.params.id;
    const status = String(req.body?.status || "");
    if (!["pending","active","rejected","suspended","blocked"].includes(status)) {
      return res.status(400).json({ error: "Status invalid." });
    }
    const target = await pool.query("SELECT * FROM users WHERE id=$1", [targetId]);
    if (!target.rowCount) return res.status(404).json({ error: "Utilizator inexistent." });
    if (target.rows[0].role === "owner") return res.status(400).json({ error: "Contul Owner nu poate fi blocat din aplicație." });

    await pool.query(
      `UPDATE users
       SET status=$1,
           approved_at=CASE WHEN $1='active' THEN COALESCE(approved_at,NOW()) ELSE approved_at END,
           approved_by=CASE WHEN $1='active' THEN $2 ELSE approved_by END,
           updated_at=NOW()
       WHERE id=$3`,
      [status, req.user.id, targetId]
    );
    if (["rejected","suspended","blocked"].includes(status)) {
      await pool.query("DELETE FROM sessions WHERE user_id=$1", [targetId]);
    }
    await audit(req.user.id, "admin.user_status", targetId, { status });
    const updated = await pool.query("SELECT * FROM users WHERE id=$1", [targetId]);
    res.json({ user: publicUser(updated.rows[0]) });
  } catch (e) { next(e); }
});

app.patch("/api/admin/users/:id/permissions", auth, ownerOnly, async (req, res, next) => {
  try {
    const targetId = req.params.id;
    const target = await pool.query("SELECT * FROM users WHERE id=$1", [targetId]);
    if (!target.rowCount) return res.status(404).json({ error: "Utilizator inexistent." });
    if (target.rows[0].role === "owner") return res.status(400).json({ error: "Permisiunile Owner sunt complete și nu se restricționează aici." });

    const current = await pool.query("SELECT permissions FROM user_permissions WHERE user_id=$1", [targetId]);
    const nextPermissions = { ...(current.rows[0]?.permissions || DEFAULT_USER_PERMISSIONS) };
    for (const [k,v] of Object.entries(req.body?.permissions || {})) {
      if (Object.prototype.hasOwnProperty.call(DEFAULT_USER_PERMISSIONS, k)) nextPermissions[k] = Boolean(v);
    }
    await pool.query(
      `INSERT INTO user_permissions(user_id,permissions,updated_at)
       VALUES($1,$2::jsonb,NOW())
       ON CONFLICT(user_id) DO UPDATE SET permissions=EXCLUDED.permissions, updated_at=NOW()`,
      [targetId, JSON.stringify(nextPermissions)]
    );
    await audit(req.user.id, "admin.permissions", targetId, { permissions: nextPermissions });
    res.json({ permissions: nextPermissions });
  } catch (e) { next(e); }
});

app.post("/api/admin/users/:id/sessions/revoke", auth, ownerOnly, async (req, res, next) => {
  try {
    const targetId = req.params.id;
    await pool.query("DELETE FROM sessions WHERE user_id=$1", [targetId]);
    await audit(req.user.id, "admin.sessions_revoke", targetId, {});
    res.json({ ok: true });
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
    const enabled = Boolean(req.body?.paidAiEnabled);
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

app.get("/api/ai/catalog", auth, async (req, res, next) => {
  try {
    const permissionsRow = await pool.query("SELECT permissions FROM user_permissions WHERE user_id=$1", [req.user.id]);
    const permissions = permissionsRow.rows[0]?.permissions || {};
    const paidRow = await pool.query("SELECT value FROM system_settings WHERE key='paid_ai_enabled'");
    const paidEnabled = req.user.role === "owner" ? paidRow.rows[0]?.value === true : paidRow.rows[0]?.value === true;
    const combinations = await pool.query("SELECT id,name,providers,paid_required,enabled FROM ai_combinations WHERE enabled=TRUE ORDER BY paid_required,id");
    const providers = [
      { id:"cerebras", tier:"free", enabled:req.user.role==="owner" || permissions.cerebras !== false },
      { id:"gemini", tier:"free", enabled:req.user.role==="owner" || permissions.gemini !== false },
      { id:"groq", tier:"free", enabled:req.user.role==="owner" || permissions.groq !== false },
      { id:"cloudflare", tier:"free", enabled:req.user.role==="owner" || permissions.cloudflare !== false },
      { id:"openrouter", tier:"free", enabled:req.user.role==="owner" || permissions.openrouter !== false },
      { id:"openai", tier:"paid", enabled:paidEnabled && (req.user.role==="owner" || permissions.openai === true) },
      { id:"anthropic", tier:"paid", enabled:paidEnabled && (req.user.role==="owner" || permissions.anthropic === true) }
    ];
    res.json({
      freeOnly: !paidEnabled,
      providers,
      combinations: combinations.rows.map(c => ({ ...c, available: !c.paid_required || paidEnabled }))
    });
  } catch (e) { next(e); }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Eroare internă AI Stoica." });
});

(async () => {
  await migrate();
  await pool.query("DELETE FROM sessions WHERE expires_at<=NOW()");
  app.listen(PORT, HOST, () => console.log(`AI Stoica Server listening on ${HOST}:${PORT}`));
})().catch(err => {
  console.error("AI Stoica Server failed to start:", err);
  process.exit(1);
});
