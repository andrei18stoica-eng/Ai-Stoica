// Memory helpers: what to remember, and how to find the relevant memories for a question.
//
// Search works in two layers:
// 1. Always: word matching that also understands Romanian word forms
//    ("mașina", "mașinii", "mașinile" all match), without diacritics.
// 2. When a free Gemini or Cloudflare key is configured: meaning-based search (embeddings),
//    so "autoturism" can find a memory about "mașină". If the provider is unavailable,
//    the word matching result is used, so memory never stops working.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function normalizeMemoryText(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}

const STOP_WORDS = new Set(["care", "este", "sunt", "pentru", "acest", "aceasta", "acesta", "cand", "unde", "cine", "despre", "dupa", "inainte", "foarte", "mult", "putin", "with", "from", "that", "this", "what", "have", "the", "and", "you", "are", "mie", "imi", "meu", "mea", "mele", "tau", "ta", "vrea", "vreau", "poti", "poate", "spune", "zi"]);

// Romanian/English word stem: "masinii" -> "masin", "proiectele" -> "proiect".
function stem(word) {
  let w = String(word || "");
  if (w.length <= 4) return w;
  const suffixes = ["urilor", "ilor", "elor", "ului", "iile", "uri", "ile", "ele", "lui", "ul", "ii", "le", "ea", "ia", "ei", "ing", "ed", "es", "s", "a", "e", "i", "u"];
  for (const s of suffixes) {
    if (w.length - s.length >= 4 && w.endsWith(s)) return w.slice(0, -s.length);
  }
  return w;
}

function tokenize(text) {
  return [...new Set((normalizeMemoryText(text).match(/[a-z0-9]{3,}/g) || []).filter((w) => !STOP_WORDS.has(w)))];
}

function keywordScore(memoryText, words) {
  const hay = normalizeMemoryText(memoryText);
  const hayStems = new Set((hay.match(/[a-z0-9]{3,}/g) || []).map(stem));
  let score = 0;
  for (const w of words) {
    if (hay.includes(w)) score += 2;
    else if (hayStems.has(stem(w))) score += 1.5;
  }
  return score;
}

function memoryMatches(db, userId, query, limit = 10) {
  const words = tokenize(query);
  return db.memories
    .filter((m) => m.userId === userId)
    .map((m) => {
      let score = m.pinned ? 6 : 0;
      score += keywordScore(m.text, words);
      if (!words.length) score += 1;
      return { m, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (b.m.createdAt || 0) - (a.m.createdAt || 0))
    .slice(0, limit)
    .map((x) => x.m);
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

// Only explicit requests ("ține minte …") and first-person durable facts or preferences are kept.
// Questions, one-off requests and long pasted text are not memories.
function durableMemoryCandidate(userText) {
  const clean = String(userText || "").trim();
  if (clean.length < 12) return "";
  const t = normalizeMemoryText(clean);
  if (EXPLICIT_MEMORY.test(t)) return clean.slice(0, 1800);
  if (clean.includes("?") || clean.length > 600) return "";
  if (REQUEST_START.test(t)) return "";
  return DURABLE_FACT.test(t) ? clean.slice(0, 1800) : "";
}

function addMemory(db, userId, text, source = "conversation", extra = {}) {
  const clean = String(text || "").trim();
  if (!clean) return null;
  const normalized = normalizeMemoryText(clean);
  const existing = db.memories.find((m) => m.userId === userId && normalizeMemoryText(m.text) === normalized);
  if (existing) {
    existing.updatedAt = Date.now();
    if (extra.pinned) existing.pinned = true;
    return existing;
  }
  const item = {
    id: crypto.randomUUID(), userId, text: clean.slice(0, 12000), source,
    category: extra.category || memoryCategory(clean),
    pinned: !!extra.pinned, conversationId: extra.conversationId || null,
    createdAt: Date.now(), updatedAt: Date.now()
  };
  db.memories.push(item);
  return item;
}

// ---------- Meaning-based search (embeddings) ----------

function embeddingProvider(cfg) {
  const gemini = String(cfg?.geminiApiKey || "").trim();
  if (gemini) {
    return {
      id: "gemini",
      url: "https://generativelanguage.googleapis.com/v1beta/openai/embeddings",
      key: gemini,
      model: String(cfg.geminiEmbeddingModel || "gemini-embedding-001").trim()
    };
  }
  const account = String(cfg?.cloudflareAccountId || "").trim();
  const token = String(cfg?.cloudflareApiToken || "").trim();
  if (account && token) {
    return {
      id: "cloudflare",
      url: `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/v1/embeddings`,
      key: token,
      model: String(cfg.cloudflareEmbeddingModel || "@cf/baai/bge-m3").trim()
    };
  }
  return null;
}

function cosine(a, b) {
  if (!a || !b || typeof a.length !== "number" || a.length !== b.length || !a.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

const MAX_VECTORS = 5000;
const MAX_NEW_PER_SEARCH = 256;

// Vectors are stored once per memory (Float32, base64), never for questions. Vectors of deleted
// memories are dropped on save, and the file is written at most once every 2 seconds.
function createEmbeddingIndex(dataDir) {
  const file = path.join(dataDir, "memory-embeddings.json");
  let cache = null, dirty = false, disabledUntil = 0, saveTimer = null, knownIds = null;
  const queryCache = new Map();

  function load() {
    if (cache) return cache;
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      cache = raw && raw.version === 2 && raw.items && typeof raw.items === "object" ? raw.items : {};
      if (!(raw && raw.version === 2)) dirty = true;
    } catch { cache = {}; }
    return cache;
  }
  function encode(vec) { return Buffer.from(new Float32Array(vec).buffer).toString("base64"); }
  function decode(s) { const b = Buffer.from(String(s || ""), "base64"); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length - (b.length % 4))); }
  function hashFor(provider, text) { return crypto.createHash("sha1").update(provider.id + ":" + provider.model + ":" + String(text)).digest("hex"); }
  function writeNow() {
    saveTimer = null;
    if (!dirty || !cache) return;
    try {
      if (knownIds) for (const id of Object.keys(cache)) if (!knownIds.has(id)) delete cache[id];
      const ids = Object.keys(cache);
      if (ids.length > MAX_VECTORS) for (const id of ids.sort((a, b) => (cache[a].t || 0) - (cache[b].t || 0)).slice(0, ids.length - MAX_VECTORS)) delete cache[id];
      fs.writeFileSync(`${file}.tmp`, JSON.stringify({ version: 2, items: cache }), "utf8");
      fs.renameSync(`${file}.tmp`, file);
      dirty = false;
    } catch {}
  }
  function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(writeNow, 2000);
    saveTimer.unref?.();
  }
  async function embed(provider, texts) {
    const r = await fetch(provider.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.key}` },
      body: JSON.stringify({ model: provider.model, input: texts }),
      signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) { try { await r.body?.cancel(); } catch {} throw Object.assign(new Error(`Embeddings HTTP ${r.status}`), { status: r.status }); }
    const data = await r.json();
    const rows = Array.isArray(data?.data) ? data.data : [];
    return rows.sort((a, b) => (a.index || 0) - (b.index || 0)).map((x) => x.embedding);
  }
  async function queryVector(provider, query) {
    const key = hashFor(provider, query);
    if (queryCache.has(key)) { const v = queryCache.get(key); queryCache.delete(key); queryCache.set(key, v); return v; }
    const [v] = await embed(provider, [query]);
    if (!Array.isArray(v)) return null;
    queryCache.set(key, v);
    if (queryCache.size > 200) queryCache.delete(queryCache.keys().next().value);
    return v;
  }
  async function memoryVectors(provider, mine) {
    const store = load();
    const missing = mine.filter((m) => !store[m.id] || store[m.id].h !== hashFor(provider, m.text)).slice(0, MAX_NEW_PER_SEARCH);
    for (let start = 0; start < missing.length; start += 64) {
      const batch = missing.slice(start, start + 64);
      const vectors = await embed(provider, batch.map((m) => String(m.text).slice(0, 4000)));
      batch.forEach((m, j) => { if (Array.isArray(vectors[j])) { store[m.id] = { h: hashFor(provider, m.text), v: encode(vectors[j]), t: m.createdAt || Date.now() }; dirty = true; } });
    }
    if (dirty) scheduleSave();
    return mine.map((m) => (store[m.id] && store[m.id].h === hashFor(provider, m.text) ? decode(store[m.id].v) : null));
  }

  // Combines word matching with meaning-based similarity. Falls back silently.
  async function search(cfg, db, userId, query, limit = 8) {
    knownIds = new Set(db.memories.map((m) => m.id));
    const keyword = memoryMatches(db, userId, query, limit);
    const provider = embeddingProvider(cfg);
    const mine = db.memories.filter((m) => m.userId === userId);
    if (!provider || !String(query || "").trim() || !mine.length || Date.now() < disabledUntil || cfg?.semanticMemoryEnabled === false) return keyword;
    try {
      const qv = await queryVector(provider, String(query).slice(0, 4000));
      if (!qv) return keyword;
      const vectors = await memoryVectors(provider, mine);
      const words = tokenize(query);
      const scored = mine.map((m, i) => {
        const semantic = cosine(qv, vectors[i]);
        return { m, semantic, score: semantic * 10 + keywordScore(m.text, words) + (m.pinned ? 3 : 0) };
      }).filter((x) => x.semantic >= 0.45 || x.m.pinned || keyword.includes(x.m))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((x) => x.m);
      return scored.length ? scored : keyword;
    } catch (e) {
      if ([401, 403, 429].includes(e?.status)) disabledUntil = Date.now() + 10 * 60 * 1000;
      return keyword;
    }
  }

  function flush() { if (saveTimer) { clearTimeout(saveTimer); writeNow(); } }

  return { search, flush };
}

module.exports = {
  normalizeMemoryText, tokenize, stem, keywordScore, memoryMatches, memoryCategory,
  durableMemoryCandidate, addMemory, embeddingProvider, cosine, createEmbeddingIndex
};
