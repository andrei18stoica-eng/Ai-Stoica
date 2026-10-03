const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("AIStoica", {
  getConfig: () => ipcRenderer.invoke("config:get"),
  setConfig: (cfg) => ipcRenderer.invoke("config:set", cfg),
  systemStatus: () => ipcRenderer.invoke("system:status"),
  ensureOmni: () => ipcRenderer.invoke("system:ensure-omni"),
  onUpdateReady: (cb) => {
    const listener = () => { try { cb(); } catch {} };
    ipcRenderer.on("update-ready", listener);
    return () => ipcRenderer.removeListener("update-ready", listener);
  },
  openExternal: (url) => ipcRenderer.invoke("system:open-external", url),
  checkUpdate: () => ipcRenderer.invoke("update:check"),
  installUpdate: () => ipcRenderer.send("update:install"),
  writeClipboardText: (value) => ipcRenderer.invoke("clipboard:write-text", value)
});
