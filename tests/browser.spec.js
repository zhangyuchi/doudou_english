import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";

const pdf = fileURLToPath(
  new URL("../public/examples/外研社7年级英语听写分组.pdf", import.meta.url),
);

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
