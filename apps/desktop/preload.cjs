const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("AIStoica", {
  getConfig: () => ipcRenderer.invoke("config:get"),
  setConfig: (cfg) => ipcRenderer.invoke("config:set", cfg),
  systemStatus: () => ipcRenderer.invoke("system:status"),
  ensureOmni: () => ipcRenderer.invoke("system:ensure-omni"),
  setStartup: (enabled) => ipcRenderer.invoke("system:set-startup", enabled),
  onUpdateReady: (cb) => ipcRenderer.on("update-ready", cb),
  openExternal: (url) => ipcRenderer.invoke("external:open", url),
  checkUpdate: () => ipcRenderer.invoke("update:check"),
  installUpdate: () => ipcRenderer.send("update:install")
});
