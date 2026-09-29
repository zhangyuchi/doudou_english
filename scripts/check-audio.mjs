import assert from "node:assert/strict";

/** Verify actual deployed audio under the caller's root or subdirectory URL. */
export async function checkAudio(page) {
  const result = await page.evaluate(async () => {
    const context = new AudioContext();
    try {
      const response = await fetch(
        new URL("audio/manifest.json", document.baseURI),
      );
      if (!response.ok)
        throw new Error(`Audio manifest HTTP ${response.status}`);
      const entries = await response.json();
      for (const entry of entries) {
        const response = await fetch(
          new URL(`audio/${entry.file}`, document.baseURI),
        );
        if (!response.ok)
          throw new Error(`${entry.english}: HTTP ${response.status}`);
        const decoded = await context.decodeAudioData(
          await response.arrayBuffer(),
        );
        if (Math.abs(decoded.duration - entry.duration) > 0.002)
          throw new Error(`${entry.english}: duration mismatch`);
      }
      return entries.length;
    } finally {
      await context.close();
    }
  });
  assert.equal(result, 161);
  await page.locator("#voice-preview").click();
  await page.waitForFunction(
    () =>
      document.getElementById("playback-title").textContent ===
      "听一词，写一词。",
  );
  await page.locator("#review-start").click();
  await page.waitForFunction(
    () =>
      document.getElementById("playback-title").textContent ===
      "慢慢写，不着急",
  );
  await page.locator("#play-toggle").click();
}
