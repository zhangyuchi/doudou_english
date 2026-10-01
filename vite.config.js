import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: { target: "safari16.4" },
  server: { host: "0.0.0.0" },
});
