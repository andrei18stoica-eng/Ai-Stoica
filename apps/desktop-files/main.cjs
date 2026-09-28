const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");

let mainWindow;

function createWindow(){
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#05070b",
    title: "AI Stoica Files",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "dist", "index.html"));
  mainWindow.setMenuBarVisibility(false);

  mainWindow.webContents.setWindowOpenHandler(({url}) => {
    if(/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
}

ipcMain.handle("save-file", async (_event, {name, base64}) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: name || "AI-Stoica-file",
    properties: ["showOverwriteConfirmation"]
  });
  if(result.canceled || !result.filePath) return { canceled: true };
  fs.writeFileSync(result.filePath, Buffer.from(base64, "base64"));
  return { canceled: false, path: result.filePath };
});

ipcMain.handle("open-external", async (_event, url) => {
  if(/^https?:\/\//i.test(String(url||""))) await shell.openExternal(url);
  return true;
});

app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if(process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if(BrowserWindow.getAllWindows().length === 0) createWindow(); });
