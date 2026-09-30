import { normalizeWord } from "./audio.js";

export const aliyunVoices = {
  emily: "Emily · 英式女声",
  eric: "Eric · 英式男声",
};

/** Validate the private generated catalog before using it as a file index or browser voice. */
export function validateAliyunManifest(manifest) {
  if (
    manifest?.version !== 1 ||
    !Object.hasOwn(aliyunVoices, manifest.voice) ||
    !Number.isInteger(manifest.speechRate) ||
    Math.abs(manifest.speechRate) > 500 ||
    !Array.isArray(manifest.entries)
  )
    throw new Error("阿里云音频清单格式无效。");
  const words = new Set();
  for (const entry of manifest.entries) {
    if (
      typeof entry.english !== "string" ||
      !/^[a-z]+(?:[ '.-][a-z]+)*$/.test(entry.english) ||
      entry.english !== normalizeWord(entry.english) ||
      entry.english.length > 100 ||
      words.has(entry.english) ||
      !/^[a-f0-9]{64}\.wav$/.test(entry.file) ||
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes <= 44
    )
      throw new Error("阿里云音频清单包含无效或重复的条目。");
    words.add(entry.english);
  }
  return manifest;
}

/** Describe generated British audio as an explicit local choice, independent of the OS. */
export function makeAliyunVoice(manifest) {
  validateAliyunManifest(manifest);
  return {
    lang: "en-GB",
    voiceURI: "aliyun-en-GB",
    recorded: true,
    name: `阿里云英音 · ${aliyunVoices[manifest.voice]}`,
  };
}
