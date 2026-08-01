import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const productionCsp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-src 'none'; worker-src 'none'; media-src 'none'; base-uri 'none'; form-action 'none'";
const developmentCsp = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' http://127.0.0.1:5173 ws://127.0.0.1:5173; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";

export default defineConfig(({ command }) => ({
  root: ".",
  plugins: [
    react(),
    {
      name: "workbench-csp",
      transformIndexHtml(html) {
        return html.replace("__WORKBENCH_CSP__", command === "serve" ? developmentCsp : productionCsp);
      }
    }
  ],
  base: "./",
  build: {
    outDir: "dist/renderer",
    emptyOutDir: true
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true
  }
}));
