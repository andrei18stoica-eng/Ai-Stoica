const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function createStore(dataDir) {
  const file = path.join(dataDir, "ai-stoica-data.json");
  const empty = { users: [], conversations: [], projects: [], assistants: [] };
  function read() {
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      return { ...empty, ...data };
    } catch {
      return structuredClone(empty);
    }
  }
  function write(data) {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmp, file);
  }
  return { read, write };
}

function loadOrCreateSecret(dataDir) {
  const file = path.join(dataDir, "auth-secret.txt");
  try { return fs.readFileSync(file, "utf8").trim(); } catch {}
  fs.mkdirSync(dataDir, { recursive: true });
  const secret = crypto.randomBytes(48).toString("hex");
  fs.writeFileSync(file, secret, { encoding: "utf8", mode: 0o600 });
  return secret;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name || user.email.split("@")[0], createdAt: user.createdAt };
}

function startLocalGateway({ dataDir, port = 8787, getOmniConfig }) {
  const store = createStore(dataDir);
  const secret = loadOrCreateSecret(dataDir);
  const app = express();
  app.use(helmet({ crossOriginResourcePolicy: false }));
  app.use(cors({ origin: true, credentials: false }));
  app.use(express.json({ limit: "25mb" }));

  function sign(user) {
    return jwt.sign({ sub: user.id, email: user.email }, secret, { expiresIn: "30d" });
  }

  function auth(req, res, next) {
    const raw = String(req.headers.authorization || "");
    const token = raw.startsWith("Bearer ") ? raw.slice(7) : "";
    try {
      const payload = jwt.verify(token, secret);
      const db = store.read();
      const user = db.users.find((u) => u.id === payload.sub);
      if (!user) return res.status(401).json({ error: "Sesiune invalidă." });
      req.user = user;
      next();
    } catch {
      return res.status(401).json({ error: "Autentificare necesară." });
    }
  }

  app.get("/health", async (_req, res) => {
    const cfg = getOmniConfig();
    let omni = false;
    try {
      const r = await fetch(`${String(cfg.baseUrl).replace(/\/+$/, "")}/models`, {
        headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
        signal: AbortSignal.timeout(2500)
      });
      omni = r.status > 0;
    } catch {}
    res.json({ ok: true, service: "AI Stoica Local Gateway", omni, model: cfg.model || "Ai principal" });
  });

  app.post("/auth/register", async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");
    const name = String(req.body?.name || "").trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Adresa de email nu este validă." });
    if (password.length < 8) return res.status(400).json({ error: "Parola trebuie să aibă cel puțin 8 caractere." });
    const db = store.read();
    if (db.users.some((u) => u.email === email)) return res.status(409).json({ error: "Există deja un cont cu acest email." });
    const user = {
      id: crypto.randomUUID(), email, name: name || email.split("@")[0],
      passwordHash: await bcrypt.hash(password, 12), createdAt: Date.now()
    };
    db.users.push(user);
    db.assistants.push({
      id: crypto.randomUUID(), userId: user.id, name: "AI Stoica", icon: "S",
      systemPrompt: "Ești AI Stoica, asistentul principal Stoica Enterprises AI. Răspunde clar, riguros și util, în limba utilizatorului.",
      createdAt: Date.now(), builtIn: true
    });
    store.write(db);
    res.json({ token: sign(user), user: publicUser(user) });
  });

  app.post("/auth/login", async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");
    const db = store.read();
    const user = db.users.find((u) => u.email === email);
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: "Email sau parolă incorectă." });
    }
    res.json({ token: sign(user), user: publicUser(user) });
  });

  app.get("/auth/me", auth, (req, res) => res.json({ user: publicUser(req.user) }));

  app.get("/api/models", auth, async (_req, res) => {
    const cfg = getOmniConfig();
    try {
      const r = await fetch(`${String(cfg.baseUrl).replace(/\/+$/, "")}/models`, {
        headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}
      });
      res.status(r.status).type("application/json").send(await r.text());
    } catch (e) {
      res.status(502).json({ error: `Nu mă pot conecta la OmniRoute: ${e.message}` });
    }
  });

  app.get("/api/projects", auth, (req, res) => {
    const db = store.read();
    res.json({ data: db.projects.filter((x) => x.userId === req.user.id).sort((a,b) => b.updatedAt - a.updatedAt) });
  });
  app.post("/api/projects", auth, (req, res) => {
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "Numele proiectului este obligatoriu." });
    const db = store.read();
    const item = { id: crypto.randomUUID(), userId: req.user.id, name, createdAt: Date.now(), updatedAt: Date.now() };
    db.projects.push(item); store.write(db); res.json({ data: item });
  });

  app.get("/api/assistants", auth, (req, res) => {
    const db = store.read();
    res.json({ data: db.assistants.filter((x) => x.userId === req.user.id).sort((a,b) => Number(b.builtIn) - Number(a.builtIn) || a.name.localeCompare(b.name)) });
  });
  app.post("/api/assistants", auth, (req, res) => {
    const name = String(req.body?.name || "").trim();
    const systemPrompt = String(req.body?.systemPrompt || "").trim();
    if (!name) return res.status(400).json({ error: "Numele asistentului este obligatoriu." });
    const db = store.read();
    const item = { id: crypto.randomUUID(), userId: req.user.id, name, icon: name[0]?.toUpperCase() || "A", systemPrompt, createdAt: Date.now(), builtIn: false };
    db.assistants.push(item); store.write(db); res.json({ data: item });
  });

  app.get("/api/conversations", auth, (req, res) => {
    const db = store.read();
    const items = db.conversations.filter((x) => x.userId === req.user.id).sort((a,b) => b.updatedAt - a.updatedAt);
    res.json({ data: items });
  });
  app.post("/api/conversations", auth, (req, res) => {
    const now = Date.now();
    const db = store.read();
    const item = {
      id: crypto.randomUUID(), userId: req.user.id,
      title: String(req.body?.title || "Conversație nouă"), projectId: req.body?.projectId || null,
      assistantId: req.body?.assistantId || null, model: req.body?.model || null,
      messages: Array.isArray(req.body?.messages) ? req.body.messages : [], createdAt: now, updatedAt: now
    };
    db.conversations.push(item); store.write(db); res.json({ data: item });
  });
  app.put("/api/conversations/:id", auth, (req, res) => {
    const db = store.read();
    const item = db.conversations.find((x) => x.id === req.params.id && x.userId === req.user.id);
    if (!item) return res.status(404).json({ error: "Conversația nu a fost găsită." });
    for (const k of ["title","projectId","assistantId","model","messages"]) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, k)) item[k] = req.body[k];
    }
    item.updatedAt = Date.now(); store.write(db); res.json({ data: item });
  });
  app.delete("/api/conversations/:id", auth, (req, res) => {
    const db = store.read();
    const before = db.conversations.length;
    db.conversations = db.conversations.filter((x) => !(x.id === req.params.id && x.userId === req.user.id));
    if (db.conversations.length === before) return res.status(404).json({ error: "Conversația nu a fost găsită." });
    store.write(db); res.json({ ok: true });
  });

  function withAssistant(messages, assistantId, userId) {
    const db = store.read();
    const assistant = db.assistants.find((a) => a.id === assistantId && a.userId === userId);
    if (!assistant?.systemPrompt) return messages;
    return [{ role: "system", content: assistant.systemPrompt }, ...messages.filter((m) => m.role !== "system")];
  }

  app.post("/api/chat", auth, async (req, res) => {
    const cfg = getOmniConfig();
    const messages = withAssistant(Array.isArray(req.body?.messages) ? req.body.messages : [], req.body?.assistantId, req.user.id);
    if (!messages.length) return res.status(400).json({ error: "Nu există mesaje." });
    try {
      const r = await fetch(`${String(cfg.baseUrl).replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}) },
        body: JSON.stringify({ model: req.body?.model || cfg.model || "Ai principal", messages, stream: false, temperature: 0.4 })
      });
      res.status(r.status).type("application/json").send(await r.text());
    } catch (e) {
      res.status(502).json({ error: `Nu mă pot conecta la OmniRoute: ${e.message}` });
    }
  });

  app.post("/api/chat/stream", auth, async (req, res) => {
    const cfg = getOmniConfig();
    const messages = withAssistant(Array.isArray(req.body?.messages) ? req.body.messages : [], req.body?.assistantId, req.user.id);
    if (!messages.length) return res.status(400).json({ error: "Nu există mesaje." });
    try {
      const upstream = await fetch(`${String(cfg.baseUrl).replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}) },
        body: JSON.stringify({ model: req.body?.model || cfg.model || "Ai principal", messages, stream: true, temperature: 0.4 })
      });
      if (!upstream.ok) return res.status(upstream.status).type("application/json").send(await upstream.text());
      const ctype = upstream.headers.get("content-type") || "";
      res.status(200);
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      if (!ctype.includes("text/event-stream")) {
        const data = await upstream.json();
        const text = data?.choices?.[0]?.message?.content || "";
        res.write(`data: ${JSON.stringify({ choices:[{ delta:{ content:text } }] })}\n\n`);
        res.write("data: [DONE]\n\n");
        return res.end();
      }
      const reader = upstream.body.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    } catch (e) {
      if (!res.headersSent) res.status(502).json({ error: `Nu mă pot conecta la OmniRoute: ${e.message}` });
      else { res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`); res.end(); }
    }
  });

  const server = app.listen(port, "127.0.0.1");
  return { server, port, close: () => new Promise((resolve) => server.close(resolve)) };
}

module.exports = { startLocalGateway };
