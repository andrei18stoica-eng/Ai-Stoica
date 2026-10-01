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

if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!OWNER_EMAIL) throw new Error("OWNER_EMAIL is required");

const pool = new Pool({ connectionString: DATABASE_URL, max: Number(process.env.PG_POOL_MAX || 10) });

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
  anthropic: false
};

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
function clientIp(req) { return String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim(); }

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, "migrations", "001_initial.sql"), "utf8");
  await pool.query(sql);
  await pool.query(
    "UPDATE users SET role='owner', status='active', approved_at=COALESCE(approved_at,NOW()) WHERE lower(email)=lower($1)",
    [OWNER_EMAIL]
  );

  // Older installations initialized paid_ai_enabled=false even when Owner never disabled it.
  // Upgrade only that untouched default. An explicit Owner choice is preserved via audit_log.
  const [paidSetting, paidChoice] = await Promise.all([
    pool.query("SELECT value FROM system_settings WHERE key='paid_ai_enabled'"),
    pool.query("SELECT 1 FROM audit_log WHERE action='admin.paid_ai' LIMIT 1")
  ]);
  if (paidSetting.rows[0]?.value === false && paidChoice.rowCount === 0) {
    await pool.query(
      `INSERT INTO system_settings(key,value,updated_at)
       VALUES('paid_ai_enabled','true'::jsonb,NOW())
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
        [userId, JSON.stringify(isOwner ? { ...DEFAULT_USER_PERMISSIONS, video_generation:true, deep_research:true, automations:true, plugins:true, github_access:true, openai:true, anthropic:true } : DEFAULT_USER_PERMISSIONS)]
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
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
    const ip = clientIp(req);
    await audit(user.id, "user.login", user.id, { ip });

    await notify(user.id, "login", "Autentificare AI Stoica", `Te-ai autentificat la AI Stoica de la adresa ${ip || "necunoscută"}.`);
    if (user.role !== "owner") {
      const ownerId = await ownerUserId();
      if (ownerId) await notify(ownerId, "user_login", "Utilizator conectat", `${user.name} (${user.email}) s-a autentificat. IP: ${ip || "necunoscut"}.`);
    }

    const refreshed = await pool.query("SELECT * FROM users WHERE id=$1", [user.id]);
    res.json({ token, user: publicUser(refreshed.rows[0] || user) });
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
    res.json({ user: publicUser(req.user), permissions: { ...DEFAULT_USER_PERMISSIONS, ...(p.rows[0]?.permissions || {}) } });
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
    res.json({ data: q.rows.map(row=>({...row,permissions:{...DEFAULT_USER_PERMISSIONS,...(row.permissions||{})}})) });
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
    const statusLabels = {
      active: "Cont aprobat",
      pending: "Cont în așteptare",
      rejected: "Cerere respinsă",
      suspended: "Cont suspendat",
      blocked: "Cont blocat"
    };
    await notify(targetId, "account_status", statusLabels[status] || "Status cont actualizat", `Statusul contului tău AI Stoica este acum: ${status}.`);
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
    const limit = Math.min(200, Math.max(1, Number(req.query?.limit || 100)));
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
