const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aiStoicaDesktop", {
  saveFile: (payload) => ipcRenderer.invoke("save-file", payload),
  openExternal: (url) => ipcRenderer.invoke("open-external", url)
});
