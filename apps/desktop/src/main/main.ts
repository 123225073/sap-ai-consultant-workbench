import { app, BrowserWindow } from "electron";
import path from "node:path";

function createMainWindow(): void {
  const appRoot = app.getAppPath();
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 760,
    title: "SAP AI 顾问工作台",
    backgroundColor: "#f7f8fb",
    webPreferences: {
      preload: path.join(appRoot, "dist/preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;

  if (rendererUrl) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(path.join(appRoot, "dist/renderer/index.html"));
  }
}

app.whenReady().then(() => {
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
