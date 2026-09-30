import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { chromium } from "@playwright/test";
import { generateAudio } from "../scripts/generate-aliyun-audio.mjs";

test(
  "a built private site plays generated Aliyun files by word, blocks missing words, and contains no credentials",
  { timeout: 45000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "aliyun-web-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    await cp("src", join(root, "src"), { recursive: true });
    await cp("index.html", join(root, "index.html"));
    await symlink(resolve("node_modules"), join(root, "node_modules"), "dir");
    const outputDirectory = join(root, "public/audio/aliyun");
    const bytes = await readFile("public/audio/guitar.wav");
    await generateAudio({
      outputDirectory,
      words: ["apple", "primary school"],
      execute: true,
      env: {
        ALIYUN_NLS_APPKEY: "test-private-appkey",
        ALIYUN_NLS_TOKEN: "test-private-token",
      },
      fetch: async () =>
        new Response(bytes, { headers: { "Content-Type": "audio/mpeg" } }),
      log() {},
    });
    await promisify(execFile)(
      process.execPath,
      [
        resolve("node_modules/vite/bin/vite.js"),
        "build",
        "--config",
        resolve("vite.config.js"),
      ],
      { cwd: root },
    );
    const manifest = JSON.parse(
      await readFile(join(outputDirectory, "manifest.json"), "utf8"),
    );
    const hits = [];
    const server = createServer(async (request, response) => {
      const path = new URL(request.url, "http://localhost").pathname;
      try {
        const data = await readFile(
          join(root, "dist", path === "/" ? "index.html" : path),
        );
        hits.push(path);
        response.setHeader(
          "Content-Type",
          path.endsWith(".js")
            ? "text/javascript"
            : path.endsWith(".css")
              ? "text/css"
              : path.endsWith(".wav")
                ? "audio/wav"
                : "text/html",
        );
        if (path.endsWith(".js"))
          assert.doesNotMatch(
            data.toString(),
            /test-private-|CreateToken|nls-meta\.cn-shanghai/,
          );
        response.end(data);
      } catch {
        response.writeHead(404);
        response.end();
      }
    });
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    t.after(() => new Promise((done) => server.close(done)));
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page
      .locator("#voice-select option[value='aliyun-en-GB']")
      .waitFor({ state: "attached" });
    await page.locator("#voice-select").selectOption("aliyun-en-GB");
    await page.locator("#import-open").click();
    await page
      .locator("#import-text")
      .fill("apple\t苹果\nprimary school\t小学");
    await page.locator("#import-confirm").click();
    await page.locator("#voice-preview").click();
    await page.waitForFunction(
      () =>
        document.getElementById("playback-title").textContent ===
        "听一词，写一词。",
    );
    assert.ok(hits.includes(`/audio/aliyun/${manifest.entries[0].file}`));
    assert.equal(await page.locator("#review-start").isEnabled(), true);
    await page.locator("#review-start").click();
    await page.waitForFunction(
      () =>
        document.getElementById("playback-title").textContent ===
        "慢慢写，不着急",
    );
    await page.locator("#play-toggle").click();
    await page.getByRole("button", { name: "① 复习单词" }).click();
    await page.locator("#import-open").click();
    await page.locator("#import-text").fill("apple\t苹果\nmissing\t缺少");
    await page.locator("#import-confirm").click();
    assert.match(
      await page.locator("#voice-help").textContent(),
      /阿里云.*1 \/ 2/,
    );
    assert.equal(await page.locator("#review-start").isDisabled(), true);
    assert.equal(
      await page
        .getByRole("button", { name: "朗读 missing", exact: true })
        .isDisabled(),
      true,
    );
    await page.locator("#voice-select").selectOption("bundled-en-GB");
    assert.equal(
      await page.locator("#voice-select").inputValue(),
      "bundled-en-GB",
    );
  },
);
