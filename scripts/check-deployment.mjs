import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { checkAudio } from "./check-audio.mjs";

// Serve only the built artifact under a non-root prefix to catch deployment path mistakes.
const root = resolve("dist");
const contentTypes = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".pdf": "application/pdf",
  ".wasm": "application/wasm",
};
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(
    new URL(req.url, "http://localhost").pathname,
  );
  const relative = path.replace(/^\/practice\//, "");
  const file = resolve(root, relative || "index.html");
  if (!path.startsWith("/practice/") || !file.startsWith(`${root}/`)) {
    res.writeHead(404).end();
    return;
  }
  try {
    const data = await readFile(file);
    res
      .writeHead(200, {
        "Content-Type":
          contentTypes[extname(file)] || "application/octet-stream",
      })
      .end(data);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400)
      errors.push(`${response.status()} ${response.url()}`);
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/practice/`);
  assert.equal(
    await page.locator("#source-summary").textContent(),
    "11 组 · 161 个听写项",
  );
  await checkAudio(page);
  await page.locator("#import-open").click();
  await page
    .locator("#word-file")
    .setInputFiles("public/examples/外研社7年级英语听写分组.pdf");
  await page.waitForFunction(
    () =>
      document
        .getElementById("import-summary")
        .textContent.includes("11 组 · 161 项"),
    { timeout: 30000 },
  );
  assert.deepEqual(errors, []);
  console.log(
    "Built dist works under /practice/: 161 decoded audio files, real playback, app, PDF import, worker and assets load successfully.",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
