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

function durableMemoryCandidate(userText) {
  const clean = String(userText || "").trim();
  if (clean.length < 12) return "";
  const t = normalizeMemoryText(clean);
  const explicit = /tine minte|retine|remember|sa nu uiti/.test(t);
  const durable = /\b(prefer|vreau|nu vreau|folosesc|am decis|lucrez|proiect|obiectiv|format|program|domeniu|server|model|masina|liceu|clasa|firma|primarie)\b/.test(t);
  if (!explicit && !durable) return "";
  return clean.slice(0, 1800);
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
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

function createEmbeddingIndex(dataDir) {
  const file = path.join(dataDir, "memory-embeddings.json");
  let cache = null;
  let dirty = false;
  let disabledUntil = 0;

  function load() {
    if (cache) return cache;
    try { cache = JSON.parse(fs.readFileSync(file, "utf8")) || {}; } catch { cache = {}; }
    return cache;
  }
  function save() {
    if (!dirty) return;
    try {
      const keys = Object.keys(cache);
      if (keys.length > 20000) for (const k of keys.slice(0, keys.length - 20000)) delete cache[k];
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(cache), "utf8");
      fs.renameSync(`${file}.tmp`, file);
      dirty = false;
    } catch {}
  }
  function keyFor(provider, text) {
    return provider.id + ":" + provider.model + ":" + crypto.createHash("sha1").update(String(text)).digest("hex");
  }
  async function embed(provider, texts) {
    const r = await fetch(provider.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.key}` },
      body: JSON.stringify({ model: provider.model, input: texts }),
      signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) throw new Error(`Embeddings HTTP ${r.status}`);
    const data = await r.json();
    const rows = Array.isArray(data?.data) ? data.data : [];
    return rows.sort((a, b) => (a.index || 0) - (b.index || 0)).map((x) => x.embedding);
  }
  async function vectorsFor(provider, texts) {
    const store = load();
    const out = new Array(texts.length);
    const missing = [];
    texts.forEach((t, i) => {
      const hit = store[keyFor(provider, t)];
      if (hit) out[i] = hit; else missing.push(i);
    });
    for (let start = 0; start < missing.length; start += 64) {
      const batch = missing.slice(start, start + 64);
      const vectors = await embed(provider, batch.map((i) => String(texts[i]).slice(0, 4000)));
      batch.forEach((idx, j) => {
        if (Array.isArray(vectors[j])) { out[idx] = vectors[j]; store[keyFor(provider, texts[idx])] = vectors[j]; dirty = true; }
      });
    }
    save();
    return out;
  }

  // Combines word matching with meaning-based similarity. Falls back silently.
  async function search(cfg, db, userId, query, limit = 8) {
    const keyword = memoryMatches(db, userId, query, limit);
    const provider = embeddingProvider(cfg);
    const mine = db.memories.filter((m) => m.userId === userId);
    if (!provider || !String(query || "").trim() || !mine.length || Date.now() < disabledUntil || cfg?.semanticMemoryEnabled === false) return keyword;
    try {
      const [queryVector] = await vectorsFor(provider, [String(query).slice(0, 4000)]);
      const vectors = await vectorsFor(provider, mine.map((m) => m.text));
      const words = tokenize(query);
      const scored = mine.map((m, i) => {
        const semantic = cosine(queryVector, vectors[i]);
        const score = semantic * 10 + keywordScore(m.text, words) + (m.pinned ? 3 : 0);
        return { m, score, semantic };
      }).filter((x) => x.semantic >= 0.45 || x.m.pinned || keyword.includes(x.m))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((x) => x.m);
      return scored.length ? scored : keyword;
    } catch {
      disabledUntil = Date.now() + 10 * 60 * 1000;
      return keyword;
    }
  }

  return { search };
}

module.exports = {
  normalizeMemoryText, tokenize, stem, keywordScore, memoryMatches, memoryCategory,
  durableMemoryCandidate, addMemory, embeddingProvider, cosine, createEmbeddingIndex
};
