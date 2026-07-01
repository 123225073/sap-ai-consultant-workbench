import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("workbench", {
  getAppInfo: () => ({
    name: "SAP AI 顾问工作台",
    edition: "个人版 MVP",
    phase: "Phase 1A"
  })
});
