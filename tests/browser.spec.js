import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { makeSource } from "../src/import.js";

const pdf = fileURLToPath(
  new URL("../public/examples/外研社7年级英语听写分组.pdf", import.meta.url),
);

// Private files on the developer's machine must not change test fixtures.
test.beforeEach(async ({ page }) => {
  await page.route("**/audio/aliyun/**", (route) =>
    route.fulfill({ status: 404 }),
  );
});

async function mockVoices(page, british = true) {
  await page.addInitScript((available) => {
    class Utterance {
      constructor(text) {
        this.text = text;
      }
    }
    window.SpeechSynthesisUtterance = Utterance;
    let timer;
    const voices = [
      { lang: "en-US", name: "American", voiceURI: "us" },
      ...(available
        ? [{ lang: "en-GB", name: "British test voice", voiceURI: "uk" }]
        : []),
    ];
    const synth = {
      getVoices: () => voices,
      addEventListener() {},
      cancel() {
        clearTimeout(timer);
      },
      speak(u) {
        window.__spoken ??= [];
        window.__spoken.push({ text: u.text, lang: u.lang, voice: u.voice });
        timer = setTimeout(() => u.onend?.(), 50);
      },
    };
    Object.defineProperty(window, "speechSynthesis", {
      value: synth,
      configurable: true,
    });
  }, british);
}

test("iPad layout, English voice, hidden answers, pause and selected-item start", async ({
  page,
}) => {
  await mockVoices(page);
  await page.goto("/");
  await expect(page.locator("#source-summary")).toHaveText(
    "11 组 · 161 个听写项",
  );
  await expect(page.locator("#voice-select option")).toHaveCount(2);
  await expect(page.locator("#voice-select")).toHaveValue("bundled-en-GB");
  await page.locator("#voice-select").selectOption("uk");
  await page.getByRole("button", { name: "② 纸上听写" }).click();
  await expect(page.locator("#repeat-select")).toHaveValue("1");
  await expect(page.locator("#interval-input")).toHaveValue("10");
  await expect(page.locator("#review-view")).toBeHidden();
  await page.locator("#next").click();
  await page.locator("#play-toggle").click();
  await expect
    .poll(() => page.evaluate(() => window.__spoken?.at(-1).text))
    .toBe("sentence");
  await expect
    .poll(() => page.evaluate(() => window.__spoken?.at(-1).voice.lang))
    .toBe("en-GB");
  await expect(page.locator("#playback-title")).toHaveText("慢慢写，不着急");
  await page.locator("#play-toggle").click();
  await expect(page.locator("#playback-title")).toHaveText("已暂停");
  await page.locator('[data-interval="15"]').click();
  await expect(page.locator("#interval-input")).toHaveValue("15");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: `test-results/${test.info().project.name}-dictation.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 1080, height: 810 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
});

test("the provided PDF imports in browser and cancel preserves the active list", async ({
  page,
}) => {
  await mockVoices(page);
  await page.goto("/");
  await page.locator("#import-open").click();
  await page.locator("#word-file").setInputFiles(pdf);
  await expect(page.locator("#import-summary")).toContainText(
    "11 组 · 161 项",
    { timeout: 30000 },
  );
  await expect(page.locator("#import-text")).toHaveValue(/point out/);
  await page.locator("#import-cancel").click();
  await expect(page.locator("#source-title")).toHaveText("外研社七年级英语");
  await page.locator("#import-open").click();
  await page.locator("#word-file").setInputFiles(pdf);
  await expect(page.locator("#import-confirm")).toBeEnabled({ timeout: 30000 });
  await page.locator("#import-title").fill("我的 PDF 词表");
  await page.locator("#import-confirm").click();
  await expect(page.locator("#source-title")).toHaveText("我的 PDF 词表");
  await expect(page.locator("#group-list button")).toHaveCount(11);
  await page.reload();
  await expect(page.locator("#source-title")).toHaveText("我的 PDF 词表");
});

test("imported text is safe, mistakes survive refresh and wrong words can be removed", async ({
  page,
}) => {
  await mockVoices(page);
  await page.goto("/");
  await page.locator("#import-open").click();
  await page.locator("#import-title").fill("新词表");
  await page
    .locator("#import-text")
    .fill("hello\t<img src=x onerror=alert(1)>\nprimary school\t小学");
  await page.locator("#import-confirm").click();
  await expect(page.locator("#review-list")).toContainText(
    "<img src=x onerror=alert(1)>",
  );
  await expect(page.locator("#review-list img")).toHaveCount(0);
  await page.getByRole("button", { name: "③ 核对答案" }).click();
  await page
    .getByRole("checkbox", { name: "标记错词 hello", exact: true })
    .check();
  await page.reload();
  await expect(page.locator("#mistakes-count")).toHaveText("1");
  await page.locator("#mistakes-open").click();
  await expect(page.locator("#item-count")).toHaveText("1 个听写项");
  await page.getByRole("button", { name: "③ 核对答案" }).click();
  // The row removes itself immediately, so assert the resulting queue rather than the detached checkbox.
  await page
    .getByRole("checkbox", { name: "标记错词 hello", exact: true })
    .click();
  await expect(page.locator("#item-count")).toHaveText("0 个听写项");
});

test("bundled audio plays and advances without any system British voice", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "speechSynthesis", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.goto("/");
  await expect(page.locator("#voice-select")).toHaveValue("bundled-en-GB");
  await expect(page.locator("#voice-preview")).toBeEnabled();
  await page.locator("#voice-preview").click();
  await expect(page.locator("#playback-title")).toHaveText("听一词，写一词。");
  await page.getByRole("button", { name: "② 纸上听写" }).click();
  await page.locator("#interval-input").fill("1");
  await page.locator("#interval-input").dispatchEvent("change");
  await page.locator("#play-toggle").click();
  await expect(page.locator("#progress-label")).toContainText("第 2 / 10 项", {
    timeout: 15000,
  });
  await page.locator("#play-toggle").click();
  expect(await page.evaluate(() => window.__spoken?.length || 0)).toBe(0);
});

test("bundled and Aliyun recordings request media playback before creating an iPad audio context", async ({
  page,
}) => {
  const wav = await readFile("public/audio/guitar.wav");
  const file = `${"d".repeat(64)}.wav`;
  await page.route("**/audio/aliyun/manifest.json", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        version: 1,
        voice: "emily",
        speechRate: 0,
        entries: [
          {
            english: "without",
            file,
            sha256: "e".repeat(64),
            bytes: wav.length,
          },
        ],
      }),
    }),
  );
  await page.route(`**/audio/aliyun/${file}`, (route) =>
    route.fulfill({ contentType: "audio/wav", body: wav }),
  );
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "audioSession", {
      value: { type: "auto" },
      configurable: true,
    });
    const NativeContext = window.AudioContext;
    window.__recordedStarts = 0;
    window.AudioContext = class extends NativeContext {
      constructor(...args) {
        if (navigator.audioSession.type !== "playback")
          throw new Error("The device mutes ambient recorded audio.");
        super(...args);
      }
      createBufferSource(...args) {
        const source = super.createBufferSource(...args);
        const start = source.start.bind(source);
        source.start = (...startArgs) => {
          window.__recordedStarts++;
          return start(...startArgs);
        };
        return source;
      }
    };
  });
  await page.goto("/");
  expect(await page.evaluate(() => navigator.audioSession.type)).toBe("auto");
  let starts = 0;
  for (const voice of ["bundled-en-GB", "aliyun-en-GB"]) {
    await page.locator("#voice-select").selectOption(voice);
    await page.evaluate(() => (navigator.audioSession.type = "ambient"));
    await page.locator("#voice-preview").click();
    await expect
      .poll(() => page.evaluate(() => window.__recordedStarts))
      .toBe(++starts);
    expect(await page.evaluate(() => navigator.audioSession.type)).toBe(
      "playback",
    );
    await expect(page.locator("#playback-title")).toHaveText(
      "听一词，写一词。",
    );
  }
});

test("preview preserves selected item and repeat settings, voice refresh preserves pause", async ({
  page,
}) => {
  await mockVoices(page);
  await page.goto("/");
  await page.locator("#voice-select").selectOption("uk");
  await page.getByRole("button", { name: "② 纸上听写" }).click();
  await page.locator("#repeat-select").selectOption("2");
  await page.locator("#next").click();
  await page.locator("#voice-preview").click();
  await expect(page.locator("#playback-title")).toHaveText("听一词，写一词。");
  await page.locator("#play-toggle").click();
  await expect
    .poll(() => page.evaluate(() => window.__spoken?.at(-1).text))
    .toBe("sentence");
  await expect(page.locator("#playback-title")).toHaveText("稍候，再听一遍");
  await page.locator("#play-toggle").click();
  await expect(page.locator("#voice-preview")).toBeDisabled();
  await page.locator("#voices-refresh").click();
  await expect(page.locator("#playback-title")).toHaveText("已暂停");
  await page.locator("#play-toggle").click();
  await expect.poll(() => page.evaluate(() => window.__spoken?.length)).toBe(3);
});

test("unknown imported audio blocks a session but allows explicit system British speech", async ({
  page,
}) => {
  await mockVoices(page);
  await page.goto("/");
  await page.locator("#import-open").click();
  await page
    .locator("#import-text")
    .fill("without\t没有\nnew unfamiliar phrase\t新词");
  await page.locator("#import-confirm").click();
  await expect(page.locator("#voice-help")).toContainText("1 / 2");
  await expect(page.locator("#review-start")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "播放 without", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", {
      name: "播放 new unfamiliar phrase",
      exact: true,
    }),
  ).toBeDisabled();
  await page.locator("#voice-select").selectOption("uk");
  await page.locator("#review-start").click();
  await expect
    .poll(() => page.evaluate(() => window.__spoken?.at(-1).text))
    .toBe("without");
});

test("audio download failure stops without switching voices or advancing", async ({
  page,
}) => {
  await mockVoices(page);
  await page.route("**/audio/without.wav", (route) =>
    route.fulfill({ status: 404 }),
  );
  await page.goto("/");
  await page.locator("#review-start").click();
  await expect(page.locator("#playback-title")).toHaveText("朗读暂时停止");
  await expect(page.locator("#playback-help")).toContainText("404");
  await expect(page.locator("#progress-label")).toContainText("第 1 / 10 项");
  expect(await page.evaluate(() => window.__spoken?.length || 0)).toBe(0);
});

test("malformed saved data stay intact until explicit recovery", async ({
  page,
}) => {
  await mockVoices(page);
  await page.goto("/");
  await page.evaluate(() =>
    localStorage.setItem("ipad-dictation:v1", "broken"),
  );
  await page.reload();
  await expect(page.locator("#storage-warning")).toContainText("尚未覆盖");
  await page.getByRole("button", { name: "② 纸上听写" }).click();
  await page.locator('[data-interval="15"]').click();
  expect(
    await page.evaluate(() => localStorage.getItem("ipad-dictation:v1")),
  ).toBe("broken");
  await page.locator("#storage-recover").click();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("ipad-dictation:v1")).settings.interval,
    ),
  ).toBe(15);
});

test("a newly published list appears after refresh, plays Aliyun audio and respects later manual choice", async ({
  page,
}) => {
  const wav = await readFile("public/audio/guitar.wav");
  const file = `${"a".repeat(64)}.wav`;
  let version = 0;
  const published = (word, hash) => ({
    version: 1,
    source: makeSource(
      [{ label: "第 1 组", items: [{ english: word, chinese: "测试" }] }],
      `命令词表 ${word}`,
      `cli-${hash.repeat(64)}`,
    ),
  });
  const lists = [
    null,
    published("newword", "a"),
    published("nextword", "b"),
    published("missingword", "c"),
  ];
  await page.route("**/audio/aliyun/manifest.json", (route) =>
    version === 0
      ? route.fulfill({ status: 404 })
      : route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            version: 1,
            voice: "emily",
            speechRate: 0,
            entries: ["newword", "nextword"].map((english) => ({
              english,
              file,
              sha256: "b".repeat(64),
              bytes: wav.length,
            })),
          }),
        }),
  );
  await page.route("**/audio/aliyun/active-list.json", (route) =>
    version === 0
      ? route.fulfill({ status: 404 })
      : route.fulfill({
          contentType: "application/json",
          body: JSON.stringify(lists[version]),
        }),
  );
  await page.route(`**/audio/aliyun/${file}`, (route) =>
    route.fulfill({ contentType: "audio/wav", body: wav }),
  );
  await page.goto("/");
  await expect(page.locator("#source-title")).toHaveText("外研社七年级英语");
  version = 1;
  await page.reload();
  await expect(page.locator("#source-title")).toHaveText("命令词表 newword");
  await expect(page.locator("#voice-select")).toHaveValue("aliyun-en-GB");
  await page.locator("#voice-preview").click();
  await expect(page.locator("#playback-title")).toHaveText("听一词，写一词。");
  await page.getByRole("button", { name: "③ 核对答案" }).click();
  await page.getByRole("checkbox", { name: "标记错词 newword" }).check();
  await page.reload();
  await expect(page.locator("#mistakes-count")).toHaveText("1");
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#builtin-button").click();
  await page.reload();
  await expect(page.locator("#source-title")).toHaveText("外研社七年级英语");
  version = 2;
  await page.reload();
  await expect(page.locator("#source-title")).toHaveText("命令词表 nextword");
  await expect(page.locator("#mistakes-count")).toHaveText("0");
  version = 3;
  await page.reload();
  await expect(page.locator("#source-title")).toHaveText("命令词表 nextword");
  await expect(page.locator("#message")).toContainText("未覆盖");
});

test("premium publication switches voice without losing same-list mistakes and survives a broken standard catalog", async ({
  page,
}) => {
  const wav = await readFile("public/audio/guitar.wav");
  const file = `${"a".repeat(64)}.wav`;
  const entries = [
    { english: "apple", file, sha256: "b".repeat(64), bytes: wav.length },
  ];
  const source = makeSource(
    [{ items: [{ english: "apple", chinese: "苹果" }] }],
    "精品测试",
    `cli-${"d".repeat(64)}`,
  );
  let phase = 0;
  await page.route("**/audio/aliyun/manifest.json", (route) =>
    route.fulfill({
      contentType: "application/json",
      body:
        phase === 2
          ? "broken"
          : JSON.stringify({
              version: 1,
              voice: "emily",
              speechRate: 0,
              entries,
            }),
    }),
  );
  await page.route("**/audio/aliyun/premium/manifest.json", (route) =>
    phase === 0
      ? route.fulfill({ status: 404 })
      : route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            version: 2,
            model: "qwen-audio-3.1-tts-flash",
            voice: "Emily_v3.1",
            rate: 1,
            sampleRate: 24000,
            entries,
          }),
        }),
  );
  await page.route("**/audio/aliyun/active-list.json", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        version: 1,
        source,
        audioQuality: phase === 0 ? "standard" : "premium",
      }),
    }),
  );
  await page.route(`**/audio/aliyun/**/${file}`, (route) =>
    route.fulfill({ contentType: "audio/wav", body: wav }),
  );
  await page.goto("/");
  await expect(page.locator("#voice-select")).toHaveValue("aliyun-en-GB");
  await page.getByRole("button", { name: "③ 核对答案" }).click();
  await page.getByRole("checkbox", { name: "标记错词 apple" }).check();
  phase = 1;
  await page.reload();
  await expect(page.locator("#voice-select")).toHaveValue(
    "aliyun-premium-en-GB",
  );
  await expect(page.locator("#mistakes-count")).toHaveText("1");
  await expect(page.locator("#voice-select option")).toContainText([
    "预置英音",
    "阿里云英音",
    "阿里云精品英音",
  ]);
  const audio = page.waitForResponse((response) =>
    response.url().includes(`/audio/aliyun/premium/${file}`),
  );
  await page.locator("#voice-preview").click();
  expect((await audio).status()).toBe(200);
  await expect(page.locator("#playback-title")).toHaveText("听一词，写一词。");
  await page.locator("#voice-select").selectOption("aliyun-en-GB");
  await page.reload();
  await expect(page.locator("#voice-select")).toHaveValue("aliyun-en-GB");
  await expect(page.locator("#mistakes-count")).toHaveText("1");
  await page.locator("#voice-select").selectOption("aliyun-premium-en-GB");
  phase = 2;
  await page.reload();
  await expect(page.locator("#voice-select")).toHaveValue(
    "aliyun-premium-en-GB",
  );
  await expect(page.locator("#source-title")).toHaveText("精品测试");
  await expect(page.locator("#voice-help")).toContainText("精品英音覆盖 1 / 1");
  await expect(page.locator("#mistakes-count")).toHaveText("1");
});
