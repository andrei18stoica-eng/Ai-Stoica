// Local data store for Serasmart AI (accounts, conversations, memory, library, plugins, automations, designs, skills).
//
// All requests share ONE in-memory copy of the data, so two actions saving at the same time
// can no longer overwrite each other's changes. Every save is atomic (temp file + rename) and
// keeps the previous version in serasmart-data.json.bak. A damaged data file is never replaced
// with an empty database: it is kept aside and the last good backup is loaded instead.
const fs = require("fs");
const path = require("path");

const COLLECTIONS = ["users", "conversations", "projects", "assistants", "memories", "library", "plugins", "automations", "designs", "skills"];

function emptyDb() {
  return Object.fromEntries(COLLECTIONS.map((k) => [k, []]));
}

function normalizeDb(data) {
  const out = { ...emptyDb(), ...(data && typeof data === "object" && !Array.isArray(data) ? data : {}) };
  for (const k of COLLECTIONS) if (!Array.isArray(out[k])) out[k] = [];
  return out;
}

// Antivirus and search indexers on Windows briefly lock files; retry the rename instead of failing the save.
function renameWithRetry(from, to) {
  for (let attempt = 0; ; attempt++) {
    try { return fs.renameSync(from, to); } catch (e) {
      if (attempt >= 6 || !["EPERM", "EBUSY", "EACCES"].includes(e.code)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40 * (attempt + 1));
    }
  }
}

function createStore(dataDir) {
  const file = path.join(dataDir, "serasmart-data.json");
  const backup = `${file}.bak`;
  // 0.7.21: the data file had the old name (ai-stoica-data.json). It is renamed once, with its backup; nothing is lost.
  const legacy = path.join(dataDir, "ai-stoica-data.json");
  if (!fs.existsSync(file) && fs.existsSync(legacy)) {
    try { renameWithRetry(legacy, file); } catch {}
    try { if (!fs.existsSync(backup) && fs.existsSync(`${legacy}.bak`)) renameWithRetry(`${legacy}.bak`, backup); } catch {}
  }
  const conversationDir = path.join(dataDir, "conversations");
  let cache = null;
  let cacheMtime = -1;

  function mtimeOf(target) {
    try { return fs.statSync(target).mtimeMs; } catch { return 0; }
  }
  function loadConversationFiles() {
    if (!fs.existsSync(conversationDir)) return [];
    const out = [];
    for (const name of fs.readdirSync(conversationDir)) {
      if (!name.endsWith(".json")) continue;
      const target=path.join(conversationDir,name);
      try {
        const item=JSON.parse(fs.readFileSync(target,"utf8"));
        if(item && typeof item==="object" && !Array.isArray(item) && item.id) out.push(item);
      } catch {
        try { fs.copyFileSync(target, `${target}.corrupt-${Date.now()}`); } catch {}
      }
    }
    return out;
  }
  function load() {
    let base=emptyDb();
    if (!fs.existsSync(file)) {
      try { base=normalizeDb(JSON.parse(fs.readFileSync(backup, "utf8"))); } catch {}
    } else {
      try { base=normalizeDb(JSON.parse(fs.readFileSync(file, "utf8"))); }
      catch {
        try { fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`); } catch {}
        try { base=normalizeDb(JSON.parse(fs.readFileSync(backup, "utf8"))); } catch { base=emptyDb(); }
      }
    }
    const split=loadConversationFiles();
    if(split.length)base.conversations=split;
    return base;
  }
  function read() {
    const m = mtimeOf(file);
    if (!cache || m !== cacheMtime) {
      cache = load();
      cacheMtime = m;
    }
    return cache;
  }
  function atomicJson(target,value,backupTarget=null) {
    fs.mkdirSync(path.dirname(target),{recursive:true});
    const tmp=`${target}.tmp`;
    if(backupTarget&&fs.existsSync(target)){try{fs.copyFileSync(target,backupTarget)}catch{}}
    fs.writeFileSync(tmp,JSON.stringify(value,null,2),"utf8");
    renameWithRetry(tmp,target);
  }
  function write(data) {
    if (data && data !== cache) cache = normalizeDb(data);
    if (!cache) cache = emptyDb();
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(conversationDir,{recursive:true});
    const ids=new Set();
    for(const conv of cache.conversations||[]){
      if(!conv?.id)continue;
      ids.add(String(conv.id));
      const target=path.join(conversationDir,`${conv.id}.json`);
      atomicJson(target,conv,`${target}.bak`);
    }
    for(const name of fs.readdirSync(conversationDir)){
      if(name.endsWith(".json.bak")&&!ids.has(name.slice(0,-9))){try{fs.unlinkSync(path.join(conversationDir,name))}catch{}continue;}
      if(!name.endsWith(".json"))continue;
      const id=name.slice(0,-5);
      // A deleted conversation leaves nothing behind, its backup copy included (0.7.23).
      if(!ids.has(id)){try{fs.unlinkSync(path.join(conversationDir,name))}catch{}try{fs.unlinkSync(path.join(conversationDir,name+".bak"))}catch{}}
    }
    const compact={...cache,conversations:[]};
    atomicJson(file,compact,backup);
    cacheMtime = mtimeOf(file);
  }

  return { read, write, file, conversationDir };
}

module.exports = { createStore, emptyDb, normalizeDb, renameWithRetry, COLLECTIONS };
