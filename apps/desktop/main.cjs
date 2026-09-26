const { app, BrowserWindow, ipcMain, safeStorage, Tray, Menu, nativeImage, session, shell, clipboard } = require("electron");
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
    baseUrl: "http://127.0.0.1:20128/v1",
    apiKey: "",
    model: "Ai principal",
    omniCommand: "omniroute.cmd",
    autoStartOmniRoute: true,
    startWithWindows: true,
    closeToTray: true,
    autoUpdate: true,
    speechModel: "openai/whisper-1",
    speechLanguage: "ro"
  };
}
function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), "utf8"));
    let apiKey = "";
    if (raw.apiKeyEncrypted && safeStorage.isEncryptionAvailable()) {
      try { apiKey = safeStorage.decryptString(Buffer.from(raw.apiKeyEncrypted, "base64")); } catch {}
    } else if (typeof raw.apiKey === "string") apiKey = raw.apiKey;
    return { ...defaults(), ...raw, apiKey };
  } catch { return defaults(); }
}
function saveConfig(input) {
  const old = loadConfig();
  const cfg = { ...old, ...input };
  const stored = {
    gatewayUrl: cfg.gatewayUrl || "http://127.0.0.1:8787", baseUrl: cfg.baseUrl, model: cfg.model, omniCommand: cfg.omniCommand,
    autoStartOmniRoute: !!cfg.autoStartOmniRoute, startWithWindows: !!cfg.startWithWindows,
    closeToTray: cfg.closeToTray !== false, autoUpdate: cfg.autoUpdate !== false,
    speechModel: cfg.speechModel || "openai/whisper-1", speechLanguage: cfg.speechLanguage || "ro"
  };
  if (cfg.apiKey) {
    if (safeStorage.isEncryptionAvailable()) stored.apiKeyEncrypted = safeStorage.encryptString(cfg.apiKey).toString("base64");
    else stored.apiKey = cfg.apiKey;
  }
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

async function systemStatus() {
  return {
    omniRunning: await isPortOpen(omniPort()),
    gatewayRunning: await isPortOpen(8787),
    config: { ...loadConfig(), apiKey: loadConfig().apiKey ? "••••••••" : "" }
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
      gateway = startLocalGateway({ dataDir: app.getPath("userData"), port: 8787, getOmniConfig: loadConfig });
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

  ipcMain.handle("config:get", () => loadConfig());
  ipcMain.handle("config:set", async (_e, input) => { const cfg2 = saveConfig(input || {}); await ensureOmniRoute(); return { ok: true, config: { ...cfg2, apiKey: cfg2.apiKey ? "••••••••" : "" } }; });
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
