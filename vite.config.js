import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { validateAliyunManifest } from "./src/aliyun-audio.js";

/** Read only the private file index at startup/build; credentials never enter the browser bundle. */
function localAudioManifest() {
  let text;
  try {
    text = readFileSync("public/audio/aliyun/manifest.json", "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  return validateAliyunManifest(JSON.parse(text));
}

export default defineConfig({
  base: "./",
  define: { __ALIYUN_AUDIO__: JSON.stringify(localAudioManifest()) },
  build: { target: "safari16.4" },
  server: { host: "0.0.0.0" },
});
