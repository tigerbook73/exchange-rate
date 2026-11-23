import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { serwist } from "@serwist/vite";
import { fileURLToPath } from "node:url";

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    cloudflare({
      persistState: { path: ".wrangler/state" },
      inspectorPort: false,
    }),
    serwist({
      swSrc: "src/sw/sw.ts",
      swDest: fileURLToPath(new URL("./dist/client/sw.js", import.meta.url)),
      globDirectory: "dist/client",
      globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2,webmanifest}"],
      globIgnores: ["**/sw.js", "**/_headers", "**/_redirects"],
      rollupFormat: "iife",
      disable: command !== "build",
    }),
  ],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: { port: 3000, strictPort: true },
  preview: { port: 8788, strictPort: true },
}));
