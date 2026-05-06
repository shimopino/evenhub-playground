import { defineConfig } from "vite";

export default defineConfig({
  server: { host: true, port: 5176 },
  build: {
    outDir: "./dist",
    emptyOutDir: true,
  },
});
