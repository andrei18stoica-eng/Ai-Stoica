// Settings for the Owner on the web site (aistoica.ro): what the Windows app keeps in config.json, the server keeps in
// <data>/server-settings.json, over the values from deploy/hetzner/.env. Only the keys below can be changed from the
// site; the Owner email, sign-up rules and the addresses of the services stay in .env. Keys and tokens leave the
// server only masked; the file is written for the service's user alone (0600).
const fs = require("fs");
const path = require("path");
const { PROVIDER_KEY_PAGES, comboNames } = require("./providers.cjs");

const MASK = "••••••••";
// Same list as SECRET_KEYS in main.cjs (test-0716-web-settings.cjs keeps them equal).
const SECRET_KEYS = ["apiKey","openAiApiKey","openRouterApiKey","cerebrasApiKey","groqApiKey","geminiApiKey","mistralApiKey","nvidiaApiKey","cohereApiKey","pollinationsApiKey","cloudflareApiToken","hfToken","togetherApiKey","stabilityApiKey","replicateApiToken","falApiKey","githubToken","xaiApiKey"];
const BOOLEAN_KEYS = ["directChatEnabled","chatFallbackOnFailure","webSearchEnabled","projectContextEnabled","githubAutoContext","pollinationsFreeEnabled"];
const CHOICES = {
  directChatCostPolicy: ["free_only","allow_paid"], imageCostPolicy: ["free_only","allow_paid"], videoCostPolicy: ["free_only","allow_paid"],
  imageProviderMode: ["auto","fast","quality","free"], videoMode: ["fast","quality","free","auto"], stabilityImageEngine: ["core","ultra","sd3"],
  speechLanguage: ["ro","en","fr"]
};
const TEXT_KEYS = [
  "baseUrl","model","speechModel","directChatProviderOrder","blockedProviders","sharedCombos","imageProviders","videoProviders",
  "cerebrasModel","groqModel","geminiModels","mistralModel","nvidiaModel","githubModelsModel","openRouterChatModel","cloudflareChatModel","cohereModel","huggingFaceChatModel","openAiChatModels","xaiModels",
  "imageModel","imageProviderOrder","cloudflareAccountId","openAiImageModel","replicateImageModel","falImageModel","openRouterImageModel","pollinationsImageModel","geminiImageModel","xaiImageModel",
  "videoModel","videoProviderOrder","geminiVideoModel","falVideoModel","replicateVideoModel","openRouterVideoModel","pollinationsVideoModel","openAiVideoModel","xaiVideoModel",
  "githubRepo","githubBranch"
];
const EDITABLE = [...TEXT_KEYS, ...BOOLEAN_KEYS, ...Object.keys(CHOICES), ...SECRET_KEYS];

function clean(key, value) {
  if (BOOLEAN_KEYS.includes(key)) return value === true || value === "true";
  if (CHOICES[key]) return CHOICES[key].includes(String(value)) ? String(value) : undefined;
  const text = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 2000);
  if (key === "baseUrl" && text && !/^https?:\/\/[^\s]+$/i.test(text)) return undefined;
  if (key === "sharedCombos") return comboNames(text);
  if (["blockedProviders", "imageProviders", "videoProviders"].includes(key)) return text.split(",").map(x => x.trim().toLowerCase()).filter(x => /^[a-z0-9@-]{2,20}$/.test(x)).join(",");
  return text;
}

function createServerSettings(dataDir) {
  const file = path.join(dataDir, "server-settings.json");
  let cache = null, stamp = -1;
  function read() {
    try {
      const st = fs.statSync(file);
      if (cache && st.mtimeMs === stamp) return cache;
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      cache = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
      stamp = st.mtimeMs;
    } catch { cache = cache || {}; }
    return cache;
  }
  // .env values, then what the Owner saved on the site.
  function apply(base) {
    const saved = read(), out = { ...base };
    for (const key of EDITABLE) if (Object.prototype.hasOwnProperty.call(saved, key)) out[key] = saved[key];
    return out;
  }
  function publicView(base) {
    const cfg = apply(base), out = {};
    for (const key of EDITABLE) out[key] = SECRET_KEYS.includes(key) ? (cfg[key] ? MASK : "") : cfg[key];
    out.providerKeyPages = PROVIDER_KEY_PAGES;
    out.serverSettings = true;
    return out;
  }
  // A key left empty or masked keeps its value; "__CLEAR__" removes it (also one that came from .env). A setting equal
  // to its .env value is not stored, so a later change in .env still applies to it.
  function save(input, base = {}) {
    const next = { ...read() };
    for (const key of EDITABLE) {
      if (!input || !Object.prototype.hasOwnProperty.call(input, key)) continue;
      const value = input[key];
      if (SECRET_KEYS.includes(key)) {
        if (value === "__CLEAR__") next[key] = "";
        else if (value && value !== MASK) next[key] = String(value).replace(/\s+/g, "").slice(0, 4000);
        continue;
      }
      if (value === undefined || value === null) continue;
      const cleaned = clean(key, value);
      if (cleaned === undefined) continue;
      const fromEnv = base[key] === undefined || base[key] === null ? undefined : clean(key, base[key]);
      if (cleaned === fromEnv) delete next[key];
      else next[key] = cleaned;
    }
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmp, file);
    try { fs.chmodSync(file, 0o600); } catch {}
    cache = next; stamp = -1;
    return next;
  }
  return { file, apply, publicView, save, read };
}

module.exports = { createServerSettings, SECRET_KEYS, EDITABLE, MASK };
