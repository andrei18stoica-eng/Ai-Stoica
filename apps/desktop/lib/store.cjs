// Local data store for AI Stoica (accounts, conversations, memory, library, plugins, automations).
//
// All requests share ONE in-memory copy of the data, so two actions saving at the same time
// can no longer overwrite each other's changes. Every save is atomic (temp file + rename) and
// keeps the previous version in ai-stoica-data.json.bak. A damaged data file is never replaced
// with an empty database: it is kept aside and the last good backup is loaded instead.
const fs = require("fs");
const path = require("path");

const COLLECTIONS = ["users", "conversations", "projects", "assistants", "memories", "library", "plugins", "automations"];

function emptyDb() {
  return Object.fromEntries(COLLECTIONS.map((k) => [k, []]));
}

function normalizeDb(data) {
  const out = { ...emptyDb(), ...(data && typeof data === "object" && !Array.isArray(data) ? data : {}) };
  for (const k of COLLECTIONS) if (!Array.isArray(out[k])) out[k] = [];
  return out;
}

function createStore(dataDir) {
  const file = path.join(dataDir, "ai-stoica-data.json");
  const backup = `${file}.bak`;
  let cache = null;
  let cacheMtime = -1;

  function mtimeOf(target) {
    try { return fs.statSync(target).mtimeMs; } catch { return 0; }
  }

  function load() {
    if (!fs.existsSync(file)) return emptyDb();
    try {
      return normalizeDb(JSON.parse(fs.readFileSync(file, "utf8")));
    } catch {
      try { fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`); } catch {}
      try { return normalizeDb(JSON.parse(fs.readFileSync(backup, "utf8"))); } catch {}
      return emptyDb();
    }
  }

  // Returns the live shared database. If the file was changed by something else
  // (another tool, a restore from backup), it is reloaded first.
  function read() {
    const m = mtimeOf(file);
    if (!cache || m !== cacheMtime) {
      cache = load();
      cacheMtime = m;
    }
    return cache;
  }

  function write(data) {
    if (data && data !== cache) cache = normalizeDb(data);
    if (!cache) cache = emptyDb();
    fs.mkdirSync(dataDir, { recursive: true });
    const json = JSON.stringify(cache, null, 2);
    const tmp = `${file}.tmp`;
    if (fs.existsSync(file)) { try { fs.copyFileSync(file, backup); } catch {} }
    fs.writeFileSync(tmp, json, "utf8");
    fs.renameSync(tmp, file);
    cacheMtime = mtimeOf(file);
  }

  return { read, write, file };
}

module.exports = { createStore, emptyDb, normalizeDb, COLLECTIONS };
