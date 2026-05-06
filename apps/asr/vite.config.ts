import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/stt": {
        target: "ws://localhost:3001",
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "./dist",
    emptyOutDir: true,
  },
});
