/// <reference types="vite/client" />

interface WorkbenchBridge {
  getAppInfo: () => {
    name: string;
    edition: string;
    phase: string;
  };
}

interface Window {
  workbench?: WorkbenchBridge;
}
