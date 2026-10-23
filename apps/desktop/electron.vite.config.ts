import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// electron-vite runs from this package folder, so paths are relative to it.
const here = (...parts: string[]) => resolve(process.cwd(), ...parts);

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ["@vshare/protocol"] })],
    build: {
      outDir: "out/main",
      rollupOptions: { input: { index: here("electron/main.ts") } },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ["@vshare/protocol"] })],
    build: {
      outDir: "out/preload",
      rollupOptions: { input: { index: here("electron/preload.ts") } },
    },
  },
  renderer: {
    root: "src",
    plugins: [react({})],
    build: {
      outDir: here("out/renderer"),
      emptyOutDir: true,
      rollupOptions: { input: here("src/index.html") },
    },
  },
});
