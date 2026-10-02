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

function configPath() { return path.join(app.getPath("userData"), "config.json"); }
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
    falVideoModel: "fal-ai/wan/v2.2-a14b/text-to-video",
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
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), "utf8"));
    function secret(name){
      const encrypted=raw[name+"Encrypted"];
      if(encrypted&&safeStorage.isEncryptionAvailable()){
        try{return safeStorage.decryptString(Buffer.from(encrypted,"base64"))}catch{}
      }
      return typeof raw[name]==="string"?raw[name]:"";
    }
    const apiKey=secret("apiKey");
    const openAiApiKey=secret("openAiApiKey");
    const openRouterApiKey=secret("openRouterApiKey");
    const cerebrasApiKey=secret("cerebrasApiKey");
    const groqApiKey=secret("groqApiKey");
    const geminiApiKey=secret("geminiApiKey");
    const mistralApiKey=secret("mistralApiKey");
    const nvidiaApiKey=secret("nvidiaApiKey");
    const cohereApiKey=secret("cohereApiKey");
    const pollinationsApiKey=secret("pollinationsApiKey");
    const cloudflareApiToken=secret("cloudflareApiToken");
    const hfToken=secret("hfToken");
    const togetherApiKey=secret("togetherApiKey");
    const stabilityApiKey=secret("stabilityApiKey");
    const replicateApiToken=secret("replicateApiToken");
    const falApiKey=secret("falApiKey");
    const githubToken=secret("githubToken");
    const cfg={ ...defaults(), ...raw, apiKey, openAiApiKey, openRouterApiKey, cerebrasApiKey, groqApiKey, geminiApiKey, mistralApiKey, nvidiaApiKey, cohereApiKey, pollinationsApiKey, cloudflareApiToken, hfToken, togetherApiKey, stabilityApiKey, replicateApiToken, falApiKey, githubToken };
    if(/^ai[ _-]*(principal|stoica)$/i.test(String(cfg.model||"").trim()))cfg.model="";
    // Migrare 0.6.14: instalațiile vechi pornesc implicit pe profilul Video Rapid.
    if(!raw.videoMode){
      cfg.videoMode="fast";
      cfg.videoModel="bytedance/seedance-2.0-fast";
      cfg.openRouterVideoModel="bytedance/seedance-2.0-fast";
    }
    return cfg;
  } catch { return defaults(); }
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
    falVideoModel: String(cfg.falVideoModel || "fal-ai/wan/v2.2-a14b/text-to-video").trim(),
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
    serverKeyPath: String(cfg.serverKeyPath || "").trim()
  };
  function storeSecret(name,value){
    if(!value)return;
    if(safeStorage.isEncryptionAvailable())stored[name+"Encrypted"]=safeStorage.encryptString(value).toString("base64");
    else stored[name]=value;
  }
  storeSecret("apiKey",cfg.apiKey);
  storeSecret("openAiApiKey",cfg.openAiApiKey);
  storeSecret("openRouterApiKey",cfg.openRouterApiKey);
  storeSecret("cerebrasApiKey",cfg.cerebrasApiKey);
  storeSecret("groqApiKey",cfg.groqApiKey);
  storeSecret("geminiApiKey",cfg.geminiApiKey);
  storeSecret("mistralApiKey",cfg.mistralApiKey);
  storeSecret("nvidiaApiKey",cfg.nvidiaApiKey);
  storeSecret("cohereApiKey",cfg.cohereApiKey);
  storeSecret("pollinationsApiKey",cfg.pollinationsApiKey);
  storeSecret("cloudflareApiToken",cfg.cloudflareApiToken);
  storeSecret("hfToken",cfg.hfToken);
  storeSecret("togetherApiKey",cfg.togetherApiKey);
  storeSecret("stabilityApiKey",cfg.stabilityApiKey);
  storeSecret("replicateApiToken",cfg.replicateApiToken);
  storeSecret("falApiKey",cfg.falApiKey);
  storeSecret("githubToken",cfg.githubToken);
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(stored, null, 2), "utf8");
  app.setLoginItemSettings({ openAtLogin: !!cfg.startWithWindows, args: ["--background"] });
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
  return {
    ...cfg,
    apiKey: cfg.apiKey ? "••••••••" : "",
    openAiApiKey: cfg.openAiApiKey ? "••••••••" : "",
    openRouterApiKey: cfg.openRouterApiKey ? "••••••••" : "",
    cerebrasApiKey: cfg.cerebrasApiKey ? "••••••••" : "",
    groqApiKey: cfg.groqApiKey ? "••••••••" : "",
    geminiApiKey: cfg.geminiApiKey ? "••••••••" : "",
    mistralApiKey: cfg.mistralApiKey ? "••••••••" : "",
    nvidiaApiKey: cfg.nvidiaApiKey ? "••••••••" : "",
    cohereApiKey: cfg.cohereApiKey ? "••••••••" : "",
    pollinationsApiKey: cfg.pollinationsApiKey ? "••••••••" : "",
    cloudflareApiToken: cfg.cloudflareApiToken ? "••••••••" : "",
    hfToken: cfg.hfToken ? "••••••••" : "",
    togetherApiKey: cfg.togetherApiKey ? "••••••••" : "",
    stabilityApiKey: cfg.stabilityApiKey ? "••••••••" : "",
    replicateApiToken: cfg.replicateApiToken ? "••••••••" : "",
    falApiKey: cfg.falApiKey ? "••••••••" : "",
    githubToken: cfg.githubToken ? "••••••••" : ""
  };
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

  mainWindow.webContents.on("did-fail-load", (_e, code, desc) => {
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
    try {
      fs.appendFileSync(path.join(app.getPath("userData"), "ai-stoica-errors.log"),
        `[${new Date().toISOString()}] Renderer stopped: ${details.reason} / ${details.exitCode}\n`);
    } catch {}
  });

  mainWindow.loadFile(path.join(__dirname, "dist", "index.html")).catch((e) => {
    try {
      fs.appendFileSync(path.join(app.getPath("userData"), "ai-stoica-errors.log"),
        `[${new Date().toISOString()}] loadFile failed: ${e.stack || e.message}\n`);
    } catch {}
    reveal();
  });

  mainWindow.on("closed", () => clearTimeout(revealTimer));
  mainWindow.on("close", (e) => {
    if (!isQuitting && loadConfig().closeToTray !== false) { e.preventDefault(); mainWindow.hide(); }
  });
}

function createTray() {
  let icon = nativeImage.createFromPath(path.join(__dirname, "build", "icon.ico"));
  if (icon.isEmpty()) icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip("AI Stoica — rulează în fundal");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Deschide AI Stoica", click: () => { mainWindow.show(); mainWindow.focus(); } },
    { label: "Repornește OmniRoute", click: async () => { lastSpawn = 0; await ensureOmniRoute(); } },
    { type: "separator" },
    { label: "Închide complet", click: () => { isQuitting = true; app.quit(); } }
  ]));
  tray.on("double-click", () => { mainWindow.show(); mainWindow.focus(); });
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
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
        onAutomationResult: ({title,body}) => {
          try{
            if(Notification.isSupported())new Notification({title:`AI Stoica · ${title||"Automatizare"}`,body:String(body||"").slice(0,500)}).show();
          }catch{}
        }
      });
      gateway?.server?.on?.("error", (e) => {
        try {
          fs.appendFileSync(path.join(app.getPath("userData"), "ai-stoica-errors.log"),
            `[${new Date().toISOString()}] Gateway error: ${e.stack || e.message}\n`);
        } catch {}
      });
    }
  } catch (e) {
    try {
      fs.appendFileSync(path.join(app.getPath("userData"), "ai-stoica-errors.log"),
        `[${new Date().toISOString()}] Gateway startup failed: ${e.stack || e.message}\n`);
    } catch {}
  }
  createTray();
  ensureOmniRoute().catch(() => {});
  watchdog = setInterval(() => ensureOmniRoute().catch(() => {}), 30000);

  autoUpdater.autoDownload = true;
  if (cfg.autoUpdate !== false) autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  autoUpdater.on("update-downloaded", () => mainWindow?.webContents.send("update-ready"));

  ipcMain.handle("config:get", () => publicConfig(loadConfig()));
  ipcMain.handle("config:set", async (_e, input) => {
    const current=loadConfig(),next={...(input||{})};
    for(const name of ["apiKey","openAiApiKey","openRouterApiKey","cerebrasApiKey","groqApiKey","geminiApiKey","mistralApiKey","nvidiaApiKey","cohereApiKey","pollinationsApiKey","cloudflareApiToken","hfToken","togetherApiKey","stabilityApiKey","replicateApiToken","falApiKey","githubToken"]){
      if(!next[name]||next[name]==="••••••••")next[name]=current[name]||"";
    }
    const cfg2=saveConfig(next);await ensureOmniRoute();return {ok:true,config:publicConfig(cfg2)};
  });
  ipcMain.handle("system:status", () => systemStatus());
  ipcMain.handle("system:ensure-omni", () => ensureOmniRoute());
  ipcMain.handle("system:set-startup", (_e, enabled) => { const cfg2 = saveConfig({ startWithWindows: !!enabled }); return { ok: true, enabled: cfg2.startWithWindows }; });
  ipcMain.handle("clipboard:write-text", (_e, value) => {
    try {
      clipboard.writeText(String(value ?? ""));
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle("clipboard:read-text", () => {
    try { return { ok: true, text: clipboard.readText() }; }
    catch (e) { return { ok: false, text: "", error: e.message }; }
  });
  ipcMain.handle("system:open-external", async (_e, rawUrl) => {
    try {
      const url = new URL(String(rawUrl || ""));
      if (!["http:", "https:"].includes(url.protocol)) return { ok: false, error: "Protocol nepermis." };
      await shell.openExternal(url.toString());
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle("external:open", async (_e, rawUrl) => {
    try {
      const url = new URL(String(rawUrl || ""));
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("Protocol nepermis.");
      await shell.openExternal(url.toString());
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle("update:check", async () => {
    try { const result = await autoUpdater.checkForUpdates(); return { ok: true, version: result?.updateInfo?.version || null }; }
    catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.on("update:install", () => autoUpdater.quitAndInstall());
});

app.on("before-quit", () => { isQuitting = true; if (watchdog) clearInterval(watchdog); });
app.on("window-all-closed", () => {});
app.on("activate", () => { if (mainWindow) mainWindow.show(); });
