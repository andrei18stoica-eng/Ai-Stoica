const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("AIStoica", {
  getConfig: () => ipcRenderer.invoke("config:get"),
  setConfig: (cfg) => ipcRenderer.invoke("config:set", cfg),
  systemStatus: () => ipcRenderer.invoke("system:status"),
  ensureOmni: () => ipcRenderer.invoke("system:ensure-omni"),
  setStartup: (enabled) => ipcRenderer.invoke("system:set-startup", enabled),
  onUpdateReady: (cb) => ipcRenderer.on("update-ready", cb),
  openExternal: (url) => ipcRenderer.invoke("system:open-external", url),
  checkUpdate: () => ipcRenderer.invoke("update:check"),
  installUpdate: () => ipcRenderer.send("update:install"),
  writeClipboardText: (value) => ipcRenderer.invoke("clipboard:write-text", value),
  readClipboardText: () => ipcRenderer.invoke("clipboard:read-text")
});
