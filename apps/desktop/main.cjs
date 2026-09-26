const { app, BrowserWindow, ipcMain, safeStorage, Tray, Menu, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");
const net = require("net");
const { spawn } = require("child_process");
const { autoUpdater } = require("electron-updater");
const { startLocalGateway } = require("./local-gateway.cjs");

let mainWindow;
let tray;
let isQuitting = false;
let gateway;
let watchdog;
let lastSpawn = 0;

function configPath() { return path.join(app.getPath("userData"), "config.json"); }
function defaults() {
  return {
    baseUrl: "http://127.0.0.1:20128/v1",
    apiKey: "",
    model: "Ai principal",
    omniCommand: "omniroute.cmd",
    autoStartOmniRoute: true,
    startWithWindows: true
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
    baseUrl: cfg.baseUrl, model: cfg.model, omniCommand: cfg.omniCommand,
    autoStartOmniRoute: !!cfg.autoStartOmniRoute, startWithWindows: !!cfg.startWithWindows
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
      windowsHide: true, detached: true, stdio: "ignore", shell: false
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
    show,
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  mainWindow.loadFile(path.join(__dirname, "dist", "index.html"));
  mainWindow.on("close", (e) => {
    if (!isQuitting) { e.preventDefault(); mainWindow.hide(); }
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

app.whenReady().then(async () => {
  if (process.platform === "win32") app.setAppUserModelId("ro.stoica.aistoica");
  const cfg = loadConfig();
  app.setLoginItemSettings({ openAtLogin: !!cfg.startWithWindows, args: ["--background"] });
  gateway = startLocalGateway({ dataDir: app.getPath("userData"), port: 8787, getOmniConfig: loadConfig });
  const background = process.argv.includes("--background");
  createWindow(!background);
  createTray();
  ensureOmniRoute().catch(() => {});
  watchdog = setInterval(() => ensureOmniRoute().catch(() => {}), 30000);

  autoUpdater.autoDownload = true;
  autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  autoUpdater.on("update-downloaded", () => mainWindow?.webContents.send("update-ready"));

  ipcMain.handle("config:get", () => loadConfig());
  ipcMain.handle("config:set", async (_e, input) => { const cfg2 = saveConfig(input || {}); await ensureOmniRoute(); return { ok: true, config: { ...cfg2, apiKey: cfg2.apiKey ? "••••••••" : "" } }; });
  ipcMain.handle("system:status", () => systemStatus());
  ipcMain.handle("system:ensure-omni", () => ensureOmniRoute());
  ipcMain.handle("system:set-startup", (_e, enabled) => { const cfg2 = saveConfig({ startWithWindows: !!enabled }); return { ok: true, enabled: cfg2.startWithWindows }; });
  ipcMain.on("update:install", () => autoUpdater.quitAndInstall());
});

app.on("before-quit", () => { isQuitting = true; if (watchdog) clearInterval(watchdog); });
app.on("window-all-closed", () => {});
app.on("activate", () => { if (mainWindow) mainWindow.show(); });
