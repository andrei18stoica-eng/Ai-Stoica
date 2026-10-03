const { app, BrowserWindow, ipcMain, safeStorage, Tray, Menu, nativeImage, session, shell, clipboard, Notification } = require("electron");
const path = require("path");
const fs = require("fs");
const net = require("net");
const { spawn } = require("child_process");
const { autoUpdater } = require("electron-updater");
const { startLocalGateway } = require("./local-gateway.cjs");

if (process.platform === "win32") app.disableHardwareAcceleration();

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

let mainWindow;
let tray;
let isQuitting = false;
let gateway;
let watchdog;
let lastSpawn = 0;

const SECRET_KEYS = ["apiKey","openAiApiKey","openRouterApiKey","cerebrasApiKey","groqApiKey","geminiApiKey","mistralApiKey","nvidiaApiKey","cohereApiKey","pollinationsApiKey","cloudflareApiToken","hfToken","togetherApiKey","stabilityApiKey","replicateApiToken","falApiKey","githubToken"];
const MASK = "••••••••";
function configPath() { return path.join(app.getPath("userData"), "config.json"); }
function logError(line) {
  try { fs.appendFileSync(path.join(app.getPath("userData"), "ai-stoica-errors.log"), `[${new Date().toISOString()}] ${line}\n`); } catch {}
}
function defaults() {
  return {
    gatewayUrl: "http://127.0.0.1:8787",
    controlApiUrl: "",
    baseUrl: "http://127.0.0.1:20128/v1",
    apiKey: "",
    model: "",
    omniCommand: "omniroute.cmd",
    autoStartOmniRoute: true,
    startWithWindows: true,
    closeToTray: true,
    autoUpdate: true,
    speechModel: "openai/whisper-1",
    speechLanguage: "ro",
    imageModel: "",
    videoMode: "fast",
    videoModel: "bytedance/seedance-2.0-fast",
    videoCostPolicy: "free_only",
    videoProviderOrder: "pollinations,openrouter,gemini,fal,replicate",
    geminiVideoModel: "veo-3.1-fast-generate-preview",
    falVideoModel: "fal-ai/ltx-video",
    replicateVideoModel: "wan-video/wan-2.2-t2v-fast",
    openAiApiKey: "",
    openRouterApiKey: "",
    cerebrasApiKey: "",
    groqApiKey: "",
    geminiApiKey: "",
    mistralApiKey: "",
    nvidiaApiKey: "",
    cohereApiKey: "",
    pollinationsApiKey: "",
    cloudflareAccountId: "",
    cloudflareApiToken: "",
    hfToken: "",
    togetherApiKey: "",
    stabilityApiKey: "",
    replicateApiToken: "",
    falApiKey: "",
    directChatEnabled: true,
    directChatCostPolicy: "free_only",
    directChatProviderOrder: "cerebras,groq,gemini,mistral,nvidia,github,openrouter,cloudflare,cohere,huggingface,openai",
    cerebrasModel: "gpt-oss-120b",
    groqModel: "llama-3.3-70b-versatile",
    geminiModels: "gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite",
    mistralModel: "mistral-small-latest",
    nvidiaModel: "meta/llama-3.3-70b-instruct",
    githubModelsModel: "openai/gpt-4.1-mini",
    openRouterChatModel: "AUTO_FREE",
    cloudflareChatModel: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    cohereModel: "command-a-03-2025",
    huggingFaceChatModel: "meta-llama/Llama-3.3-70B-Instruct",
    openAiChatModels: "gpt-5-mini,gpt-5-nano",
    imageProviderMode: "auto",
    imageCostPolicy: "free_only",
    imageProviderOrder: "cloudflare,pollinations,huggingface,together,openrouter,fal,replicate,stability,openai",
    openAiImageModel: "gpt-image-1-mini",
    stabilityImageEngine: "core",
    replicateImageModel: "black-forest-labs/flux-schnell",
    falImageModel: "fal-ai/z-image/turbo",
    openRouterImageModel: "google/gemini-3.1-flash-image",
    openRouterVideoModel: "bytedance/seedance-2.0-fast",
    pollinationsImageModel: "black-forest-labs/flux.1-schnell",
    pollinationsVideoModel: "google/veo-3.1-fast",
    webSearchEnabled: true,
    projectContextEnabled: true,
    githubAutoContext: true,
    githubRepo: "",
    githubBranch: "main",
    githubToken: "",
    serverHost: "",
    serverPort: 22,
    serverUser: "root",
    serverKeyPath: ""
  };
}
function loadConfig() {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(configPath(), "utf8")); }
  catch (e) {
    if (fs.existsSync(configPath())) {
      // Moved aside once (not copied on every read), then the last good copy is put back in its place.
      try { fs.renameSync(configPath(), configPath().replace(/\.json$/, `.corrupt-${Date.now()}.json`)); } catch {}
      try { raw = JSON.parse(fs.readFileSync(configPath() + ".bak", "utf8")); fs.copyFileSync(configPath() + ".bak", configPath()); } catch { raw = null; }
      logError(`Config unreadable: ${e.message}${raw ? " (restored from backup)" : ""}`);
    }
    if (!raw || typeof raw !== "object") return defaults();
  }
  function secret(name){
    const encrypted=raw[name+"Encrypted"];
    if(encrypted&&safeStorage.isEncryptionAvailable()){
      try{return safeStorage.decryptString(Buffer.from(encrypted,"base64"))}catch{}
    }
    return typeof raw[name]==="string"?raw[name]:"";
  }
  const cfg={ ...defaults(), ...raw };
  for (const name of SECRET_KEYS) { cfg[name] = secret(name); delete cfg[name + "Encrypted"]; }
  if(/^ai[ _-]*(principal|stoica)$/i.test(String(cfg.model||"").trim()))cfg.model="";
  // Migrare 0.6.14: instalațiile vechi pornesc implicit pe profilul Video Rapid.
  if(!raw.videoMode){
    cfg.videoMode="fast";
    cfg.videoModel="bytedance/seedance-2.0-fast";
    cfg.openRouterVideoModel="bytedance/seedance-2.0-fast";
  }
  return cfg;
}
function saveConfig(input) {
  const old = loadConfig();
  const cfg = { ...old, ...input };
  const stored = {
    gatewayUrl: cfg.gatewayUrl || "http://127.0.0.1:8787", controlApiUrl: String(cfg.controlApiUrl || "").trim().replace(/\/+$/,""), baseUrl: cfg.baseUrl, model: /^ai[ _-]*(principal|stoica)$/i.test(String(cfg.model||"").trim())?"":String(cfg.model||"").trim(), omniCommand: cfg.omniCommand,
    autoStartOmniRoute: !!cfg.autoStartOmniRoute, startWithWindows: !!cfg.startWithWindows,
    closeToTray: cfg.closeToTray !== false, autoUpdate: cfg.autoUpdate !== false,
    speechModel: cfg.speechModel || "openai/whisper-1", speechLanguage: cfg.speechLanguage || "ro",
    directChatEnabled: cfg.directChatEnabled !== false,
    directChatCostPolicy: cfg.directChatCostPolicy==="allow_paid"?"allow_paid":"free_only",
    directChatProviderOrder: String(cfg.directChatProviderOrder || "cerebras,groq,gemini,mistral,nvidia,github,openrouter,cloudflare,cohere,huggingface,openai").trim(),
    cerebrasModel: String(cfg.cerebrasModel || "gpt-oss-120b").trim(),
    groqModel: String(cfg.groqModel || "llama-3.3-70b-versatile").trim(),
    geminiModels: String(cfg.geminiModels || "gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite").trim(),
    mistralModel: String(cfg.mistralModel || "mistral-small-latest").trim(),
    nvidiaModel: String(cfg.nvidiaModel || "meta/llama-3.3-70b-instruct").trim(),
    githubModelsModel: String(cfg.githubModelsModel || "openai/gpt-4.1-mini").trim(),
    openRouterChatModel: String(cfg.openRouterChatModel || "AUTO_FREE").trim(),
    cloudflareChatModel: String(cfg.cloudflareChatModel || "@cf/meta/llama-3.3-70b-instruct-fp8-fast").trim(),
    cohereModel: String(cfg.cohereModel || "command-a-03-2025").trim(),
    huggingFaceChatModel: String(cfg.huggingFaceChatModel || "meta-llama/Llama-3.3-70B-Instruct").trim(),
    openAiChatModels: String(cfg.openAiChatModels || "gpt-5-mini,gpt-5-nano").trim(),
    imageModel: String(cfg.imageModel || "").trim(),
    imageProviderMode: ["auto","fast","quality","free"].includes(String(cfg.imageProviderMode))?String(cfg.imageProviderMode):"auto",
    imageCostPolicy: cfg.imageCostPolicy==="allow_paid"?"allow_paid":"free_only",
    imageProviderOrder: String(cfg.imageProviderOrder || "cloudflare,pollinations,huggingface,together,openrouter,fal,replicate,stability,openai").trim(),
    cloudflareAccountId: String(cfg.cloudflareAccountId || "").trim(),
    openAiImageModel: String(cfg.openAiImageModel || "gpt-image-1-mini").trim(),
    stabilityImageEngine: ["core","ultra","sd3"].includes(String(cfg.stabilityImageEngine))?String(cfg.stabilityImageEngine):"core",
    replicateImageModel: String(cfg.replicateImageModel || "black-forest-labs/flux-schnell").trim(),
    falImageModel: String(cfg.falImageModel || "fal-ai/z-image/turbo").trim(),
    videoMode: ["fast","quality","free"].includes(String(cfg.videoMode))?String(cfg.videoMode):"fast",
    videoCostPolicy: cfg.videoCostPolicy==="allow_paid"?"allow_paid":"free_only",
    videoProviderOrder: String(cfg.videoProviderOrder || "pollinations,openrouter,gemini,fal,replicate").trim(),
    geminiVideoModel: String(cfg.geminiVideoModel || "veo-3.1-fast-generate-preview").trim(),
    falVideoModel: String(cfg.falVideoModel || "fal-ai/ltx-video").trim(),
    replicateVideoModel: String(cfg.replicateVideoModel || "wan-video/wan-2.2-t2v-fast").trim(),
    videoModel: String(cfg.videoModel || (cfg.videoMode==="quality"?"bytedance/seedance-2.5":"bytedance/seedance-2.0-fast")).trim(),
    openRouterImageModel: String(cfg.openRouterImageModel || "google/gemini-3.1-flash-image").trim(),
    openRouterVideoModel: String(cfg.openRouterVideoModel || (cfg.videoMode==="quality"?"bytedance/seedance-2.5":"bytedance/seedance-2.0-fast")).trim(),
    pollinationsImageModel: String(cfg.pollinationsImageModel || "black-forest-labs/flux.1-schnell").trim(),
    pollinationsVideoModel: String(cfg.pollinationsVideoModel || "google/veo-3.1-fast").trim(),
    webSearchEnabled: cfg.webSearchEnabled !== false,
    projectContextEnabled: cfg.projectContextEnabled !== false,
    githubAutoContext: cfg.githubAutoContext !== false,
    githubRepo: String(cfg.githubRepo || "").trim(),
    githubBranch: String(cfg.githubBranch || "main").trim() || "main",
    serverHost: String(cfg.serverHost || "").trim(),
    serverPort: Math.max(1, Math.min(65535, Number(cfg.serverPort || 22))),
    serverUser: String(cfg.serverUser || "root").trim() || "root",
    serverKeyPath: String(cfg.serverKeyPath || "").trim(),
    ownerEmail: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(cfg.ownerEmail || "").trim()) ? String(cfg.ownerEmail).trim().toLowerCase() : ""
  };
  for (const name of SECRET_KEYS) {
    const value = String(cfg[name] || "");
    if (!value || value === MASK) continue;
    if (safeStorage.isEncryptionAvailable()) stored[name + "Encrypted"] = safeStorage.encryptString(value).toString("base64");
    else stored[name] = value;
  }
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  const tmp = configPath() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(stored, null, 2), "utf8");
  if (fs.existsSync(configPath())) { try { fs.copyFileSync(configPath(), configPath() + ".bak"); } catch {} }
  for (let i = 0; ; i++) {
    // Windows antivirus/indexer can hold the file for a moment.
    try { fs.renameSync(tmp, configPath()); break; }
    catch (e) { if (i >= 5 || !["EPERM", "EBUSY", "EACCES"].includes(e.code)) throw e; const until = Date.now() + 60 * (i + 1); while (Date.now() < until) {} }
  }
  try { app.setLoginItemSettings({ openAtLogin: !!cfg.startWithWindows, args: ["--background"] }); } catch {}
  return cfg;
}

function omniPort() {
  try { return Number(new URL(loadConfig().baseUrl).port || 80); } catch { return 20128; }
}
function isPortOpen(port, host = "127.0.0.1", timeout = 900) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    let done = false;
    const finish = (ok) => { if (done) return; done = true; try { s.destroy(); } catch {} resolve(ok); };
    s.setTimeout(timeout); s.once("connect", () => finish(true)); s.once("timeout", () => finish(false)); s.once("error", () => finish(false));
    s.connect(port, host);
  });
}
async function ensureOmniRoute() {
  const cfg = loadConfig();
  const port = omniPort();
  if (await isPortOpen(port)) return true;
  if (!cfg.autoStartOmniRoute || process.platform !== "win32") return false;
  if (Date.now() - lastSpawn < 12000) return false;
  lastSpawn = Date.now();
  const cmd = String(cfg.omniCommand || "omniroute.cmd").trim();
  try {
    const quoted = cmd.includes(" ") ? `\"${cmd.replaceAll('"','')}\"` : cmd;
    const child = spawn("cmd.exe", ["/d", "/s", "/c", `${quoted} serve`], {
      windowsHide: true, detached: true, stdio: "ignore", shell: false,
      env: { ...process.env, OMNIROUTE_SERVER_HOST: "127.0.0.1" }
    });
    child.unref();
  } catch {}
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 650));
    if (await isPortOpen(port)) return true;
  }
  return false;
}

function publicConfig(cfg=loadConfig()) {
  const out = { ...cfg };
  for (const name of SECRET_KEYS) out[name] = cfg[name] ? MASK : "";
  return out;
}

async function systemStatus() {
  const cfg=loadConfig();
  return {
    omniRunning: await isPortOpen(omniPort()),
    gatewayRunning: await isPortOpen(8787),
    config: publicConfig(cfg)
  };
}

function createWindow(show = true) {
  mainWindow = new BrowserWindow({
    width: 1440, height: 920, minWidth: 980, minHeight: 680,
    backgroundColor: "#05070b", title: "AI Stoica — Stoica Enterprises AI", autoHideMenuBar: true,
    show: false,
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });

  const reveal = () => {
    if (show && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  };
  mainWindow.once("ready-to-show", reveal);
  const revealTimer = setTimeout(reveal, 3500);

  const EXTERNAL = /^(https?:|mailto:)/i;
  const openOutside = (url) => { if (EXTERNAL.test(String(url || ""))) shell.openExternal(String(url)).catch(() => {}); };
  // Links never replace the app window: web pages open in the system browser and never get the AI Stoica bridge.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { openOutside(url); return { action: "deny" }; });
  mainWindow.webContents.on("will-navigate", (e, url) => {
    if (url !== mainWindow.webContents.getURL()) { e.preventDefault(); openOutside(url); }
  });
  mainWindow.webContents.on("will-attach-webview", (e) => e.preventDefault());

  mainWindow.webContents.on("did-fail-load", (_e, code, desc, _url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    const safe = String(desc || "eroare necunoscută").replace(/[<>&]/g, "");
    mainWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(
      `<!doctype html><html><body style="margin:0;background:#05070b;color:#e9eef7;font-family:Segoe UI,sans-serif;display:grid;place-items:center;height:100vh">
      <div style="max-width:680px;padding:32px"><h1>AI Stoica nu a putut încărca interfața</h1>
      <p>Eroare: ${code} — ${safe}</p><p>Închide complet aplicația din system tray și pornește-o din nou.</p></div></body></html>`
    )).catch(() => {});
    reveal();
  });

  // ChatGPT-like editing: native Cut/Copy/Paste menu in every editable field.
  mainWindow.webContents.on("context-menu", (_event, params) => {
    const items = [];
    if (params.isEditable) {
      items.push(
        { role: "undo", enabled: !!params.editFlags?.canUndo },
        { role: "redo", enabled: !!params.editFlags?.canRedo },
        { type: "separator" },
        { role: "cut", enabled: !!params.editFlags?.canCut },
        { role: "copy", enabled: !!params.editFlags?.canCopy },
        { role: "paste", enabled: !!params.editFlags?.canPaste },
        { role: "selectAll" }
      );
    } else if (params.selectionText) {
      items.push({ role: "copy" }, { role: "selectAll" });
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: mainWindow });
  });

  // Keep Windows keyboard shortcuts reliable even with the application menu hidden.
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (!(input.control || input.meta) || input.type !== "keyDown") return;
    const key = String(input.key || "").toLowerCase();
    if (key === "c") { mainWindow.webContents.copy(); event.preventDefault(); }
    else if (key === "v") { mainWindow.webContents.paste(); event.preventDefault(); }
    else if (key === "x") { mainWindow.webContents.cut(); event.preventDefault(); }
    else if (key === "a") { mainWindow.webContents.selectAll(); event.preventDefault(); }
  });

  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    logError(`Renderer stopped: ${details.reason} / ${details.exitCode}`);
    if (details.reason !== "clean-exit" && !isQuitting) setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload(); }, 1000);
  });

  mainWindow.loadFile(path.join(__dirname, "dist", "index.html")).catch((e) => {
    logError(`loadFile failed: ${e.stack || e.message}`);
    reveal();
  });

  mainWindow.on("closed", () => clearTimeout(revealTimer));
  mainWindow.on("close", (e) => {
    if (!isQuitting && loadConfig().closeToTray !== false) { e.preventDefault(); mainWindow.hide(); }
  });
}

function showMain() {
  if (!mainWindow || mainWindow.isDestroyed()) { createWindow(true); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show(); mainWindow.focus();
}

function newerVersion(a, b) {
  const pa = String(a || "").split(/[.-]/).map((x) => parseInt(x, 10) || 0), pb = String(b || "").split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
  return false;
}

function createTray() {
  let icon = nativeImage.createFromPath(path.join(__dirname, "build", "icon.ico"));
  if (icon.isEmpty()) icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip("AI Stoica — rulează în fundal");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Deschide AI Stoica", click: showMain },
    { label: "Repornește OmniRoute", click: async () => { lastSpawn = 0; await ensureOmniRoute(); } },
    { type: "separator" },
    { label: "Închide complet", click: () => { isQuitting = true; app.quit(); } }
  ]));
  tray.on("double-click", showMain);
  tray.on("click", showMain);
}

// IPC handlers are registered before the window loads, so the interface never calls a handler that does not exist yet.
function registerIpcHandlers() {
  ipcMain.handle("config:get", () => publicConfig(loadConfig()));
  ipcMain.handle("config:set", async (_e, input) => {
    try {
      const current=loadConfig(),next={...(input&&typeof input==="object"?input:{})};
      for(const name of SECRET_KEYS){
        if(next[name]==="__CLEAR__")next[name]="";
        else if(!next[name]||next[name]===MASK)next[name]=current[name]||"";
        else next[name]=String(next[name]).trim();
      }
      const cfg2=saveConfig(next);ensureOmniRoute().catch(()=>{});return {ok:true,config:publicConfig(cfg2)};
    } catch (e) { logError(`Config save failed: ${e.message}`); return { ok:false, error:"Setările nu au putut fi salvate: " + e.message }; }
  });
  ipcMain.handle("system:status", () => systemStatus());
  ipcMain.handle("system:ensure-omni", () => ensureOmniRoute());
  ipcMain.handle("clipboard:write-text", (_e, value) => {
    try {
      clipboard.writeText(String(value ?? "").slice(0, 5_000_000));
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle("system:open-external", async (_e, rawUrl) => {
    try {
      const url = new URL(String(rawUrl || ""));
      if (!["http:", "https:", "mailto:"].includes(url.protocol)) return { ok: false, error: "Se pot deschide doar linkuri web (http/https) sau email." };
      await shell.openExternal(url.toString());
      return { ok: true };
    } catch (e) { return { ok: false, error: "Linkul nu a putut fi deschis: " + e.message }; }
  });
  ipcMain.handle("update:check", async () => {
    if (!app.isPackaged) return { ok: false, error: "Actualizările funcționează doar în aplicația instalată." };
    try {
      const result = await autoUpdater.checkForUpdates();
      const version = result?.updateInfo?.version || null;
      const available = typeof result?.isUpdateAvailable === "boolean" ? result.isUpdateAvailable : newerVersion(version, app.getVersion());
      return { ok: true, version, current: app.getVersion(), available };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.on("update:install", () => { isQuitting = true; autoUpdater.quitAndInstall(); });
}

app.on("second-instance", () => { if (app.isReady()) showMain(); });

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return;
  registerIpcHandlers();
  if (process.platform === "win32") app.setAppUserModelId("ro.stoica.aistoica");
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === "media");
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === "media"));
  const cfg = loadConfig();
  app.setLoginItemSettings({ openAtLogin: !!cfg.startWithWindows, args: ["--background"] });
  const background = process.argv.includes("--background");
  createWindow(!background);

  try {
    if (!(await isPortOpen(8787))) {
      gateway = startLocalGateway({
        dataDir: app.getPath("userData"), port: 8787, getOmniConfig: loadConfig,
        encryptSecret: (value) => safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(String(value)).toString("base64") : null,
        decryptSecret: (value) => safeStorage.decryptString(Buffer.from(String(value), "base64")),
        onAutomationResult: ({title,body}) => {
          try{
            if(Notification.isSupported())new Notification({title:`AI Stoica · ${title||"Automatizare"}`,body:String(body||"").slice(0,500)}).show();
          }catch{}
        }
      });
      gateway?.server?.on?.("error", (e) => logError(`Gateway error: ${e.stack || e.message}`));
    }
  } catch (e) {
    logError(`Gateway startup failed: ${e.stack || e.message}`);
  }
  createTray();
  ensureOmniRoute().catch(() => {});
  watchdog = setInterval(() => ensureOmniRoute().catch(() => {}), 30000);

  autoUpdater.autoDownload = true;
  autoUpdater.on("error", (e) => logError(`Update error: ${e?.message || e}`));
  autoUpdater.on("update-downloaded", () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("update-ready"); });
  if (cfg.autoUpdate !== false && app.isPackaged) autoUpdater.checkForUpdatesAndNotify().catch(() => {});

});

app.on("before-quit", () => { isQuitting = true; if (watchdog) clearInterval(watchdog); try { gateway?.close?.(); } catch {} });
app.on("window-all-closed", () => {});
app.on("activate", () => { if (app.isReady()) showMain(); });
