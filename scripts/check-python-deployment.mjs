import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  cp,
  writeFile,
  symlink,
  rename,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

// Test a real Python http.server against the built artifact and an atomically switched current.
// Only this temporary tree and localhost are used; no production SSH or Web service is touched.
const temp = await mkdtemp(join(tmpdir(), "dictation-python-"));
let server, browser;
try {
  const releases = join(temp, "releases");
  await mkdir(releases);
  for (const version of ["one", "two"]) {
    await cp(resolve("dist"), join(releases, version), { recursive: true });
    await writeFile(join(releases, version, "version.txt"), version);
  }
  const current = join(temp, "current");
  await symlink("releases/one", current);
  server = spawn(
    "python3",
    [
      "-u",
      "-m",
      "http.server",
      "0",
      "--bind",
      "127.0.0.1",
      "--directory",
      current,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const port = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(
      () =>
        reject(
          new Error("Python HTTP server did not become ready in 10 seconds"),
        ),
      10000,
    );
    server.stdout.on("data", (data) => {
      output += data;
      const match = output.match(/port (\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    server.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    server.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Python exited before readiness: ${code}`));
    });
  });
  // Consume request logging so the child's pipe cannot fill during browser testing.
  server.stderr.resume();
  const url = `http://127.0.0.1:${port}/`;
  assert.equal(await (await fetch(`${url}version.txt`)).text(), "one");
  browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400)
      errors.push(`${response.status()} ${response.url()}`);
  });
  await page.goto(url);
  assert.equal(
    await page.locator("#source-summary").textContent(),
    "11 组 · 161 个听写项",
  );
  await page.locator("#import-open").click();
  await page
    .locator("#word-file")
    .setInputFiles("public/examples/外研社7年级英语听写分组.pdf");
  await page.waitForFunction(
    () =>
      document
        .getElementById("import-summary")
        .textContent.includes("11 组 · 161 项"),
    undefined,
    { timeout: 30000 },
  );
  assert.deepEqual(errors, []);
  await symlink("releases/two", join(temp, "next"));
  await rename(join(temp, "next"), current);
  assert.equal(await (await fetch(`${url}version.txt`)).text(), "two");
  await page.reload();
  assert.equal(
    await page.locator("#source-summary").textContent(),
    "11 组 · 161 个听写项",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Python HTTP serving: real PDF/worker import and current switching without restart passed.",
  );
} finally {
  await browser?.close();
  if (server?.pid && server.exitCode === null && server.signalCode === null) {
    const exited = once(server, "exit");
    server.kill("SIGTERM");
    await exited;
  }
  await rm(temp, { recursive: true, force: true });
}
