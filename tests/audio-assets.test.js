import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { builtinSource } from "../src/words.js";
import { normalizeWord } from "../src/audio.js";

test("all built-in words have unique, licensed, non-silent PCM recordings with verified hashes", async () => {
  const catalog = JSON.parse(await readFile("src/audio-catalog.json", "utf8"));
  const manifest = JSON.parse(
    await readFile("public/audio/manifest.json", "utf8"),
  );
  assert.deepEqual(
    catalog,
    manifest.map(({ english, file }) => ({ english, file })),
  );
  const expected = builtinSource.groups
    .flatMap((group) => group.items)
    .map((item) => normalizeWord(item.english));
  assert.deepEqual(
    new Set(manifest.map((entry) => normalizeWord(entry.english))),
    new Set(expected),
  );
  assert.equal(manifest.length, new Set(expected).size);
  for (const entry of manifest) {
    assert.match(entry.file, /^[a-z-]+\.wav$/);
    assert.equal(entry.locale, "en-GB");
    assert.ok(["recorded", "synthesized"].includes(entry.kind));
    for (const key of ["sourceURL", "licenseURL", "accentEvidenceURL"])
      assert.equal(new URL(entry[key]).protocol, "https:");
    for (const key of [
      "author",
      "license",
      "accentEvidence",
      "processing",
      "originalSHA256",
    ])
      assert.ok(entry[key], `${entry.english}: ${key}`);
    if (entry.kind === "synthesized") {
      for (const key of [
        "tool",
        "voice",
        "modelSHA256",
        "date",
        "text",
        "modelLicense",
        "modelLicenseURL",
        "datasetLicense",
      ])
        assert.ok(entry.generation[key], key);
    }
    const bytes = await readFile(`public/audio/${entry.file}`);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      entry.sha256,
    );
    assert.equal(bytes.length, entry.bytes);
    assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
    assert.equal(bytes.toString("ascii", 8, 12), "WAVE");
    assert.equal(bytes.readUInt16LE(20), 1); // PCM, not an OS-specific codec.
    assert.equal(bytes.readUInt16LE(22), 1);
    assert.equal(bytes.readUInt32LE(24), 22050);
    assert.equal(bytes.readUInt16LE(34), 16);
    assert.equal(bytes.readUInt32LE(40), bytes.length - 44);
    assert.ok(entry.duration > 0.15 && entry.duration < 12, entry.english);
    let peak = 0;
    for (let offset = 44; offset < bytes.length; offset += 2)
      peak = Math.max(peak, Math.abs(bytes.readInt16LE(offset)));
    assert.ok(peak > 1000 && peak < 32000, entry.english);
  }
});
