import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(__dirname, "renderer"),
  base: "./",
  // The strict Content-Security-Policy in index.html blocks the inline React refresh script that the
  // Vite dev server injects, so it is removed only while developing (production builds keep it).
  plugins: [react(), {
    name: "ai-stoica-dev-csp",
    apply: "serve",
    transformIndexHtml: (html) => html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\s*/i, "")
  }],
  build: {
    outDir: path.join(__dirname, "dist"),
    emptyOutDir: true
  }
});
