import { normalizeWord } from "./audio.js";
import { validateGroups } from "./import.js";

export const aliyunVoices = {
  emily: "Emily · 英式女声",
  eric: "Eric · 英式男声",
};
export const premiumModel = "qwen-audio-3.1-tts-flash";
export const premiumVoices = {
  "Emily_v3.1": "Emily · 英式女声",
  "Eric_v3.1": "Eric · 英式男声",
  "Luna_v3.1": "Luna · 英式女声",
  "Luca_v3.1": "Luca · 英式男声",
};

/** Validate the private generated catalog before using it as a file index or browser voice. */
export function validateAliyunManifest(manifest) {
  const standard =
    manifest?.version === 1 &&
    Object.hasOwn(aliyunVoices, manifest.voice) &&
    Number.isInteger(manifest.speechRate) &&
    Math.abs(manifest.speechRate) <= 500;
  const premium =
    manifest?.version === 2 &&
    manifest.model === premiumModel &&
    Object.hasOwn(premiumVoices, manifest.voice) &&
    Number.isFinite(manifest.rate) &&
    manifest.rate >= 0.5 &&
    manifest.rate <= 2 &&
    manifest.sampleRate === 24000;
  if ((!standard && !premium) || !Array.isArray(manifest.entries))
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
  const premium = manifest.version === 2;
  return {
    lang: "en-GB",
    voiceURI: premium ? "aliyun-premium-en-GB" : "aliyun-en-GB",
    recorded: true,
    name: `${premium ? "阿里云精品英音" : "阿里云英音"} · ${(premium ? premiumVoices : aliyunVoices)[manifest.voice]}`,
  };
}

/** Validate list structure independently so the CLI can repair missing audio. */
export function validatePublishedList(payload) {
  const source = payload?.source;
  if (
    payload?.version !== 1 ||
    (payload.audioQuality !== undefined &&
      !["standard", "premium"].includes(payload.audioQuality)) ||
    !/^cli-[a-f0-9]{64}$/.test(source?.id) ||
    typeof source.title !== "string" ||
    !source.title.trim() ||
    source.title.length > 200 ||
    !Array.isArray(source.groups) ||
    source.groups.some(
      (group) => typeof group.label !== "string" || !Array.isArray(group.items),
    )
  )
    throw new Error("命令行词表格式无效。");
  validateGroups(source.groups);
  for (const [groupIndex, group] of source.groups.entries()) {
    for (const [itemIndex, item] of group.items.entries()) {
      if (item.id !== `${source.id}:${groupIndex}:${itemIndex}`)
        throw new Error("命令行词表标识无效。");
    }
  }
  return source;
}

/** Accept a published list only when its IDs are sound and every item has Aliyun audio. */
export function validatePublishedSource(payload, manifest) {
  validateAliyunManifest(manifest);
  const source = validatePublishedList(payload);
  const covered = new Set(manifest.entries.map((entry) => entry.english));
  if (
    source.groups.some((group) =>
      group.items.some((item) => !covered.has(normalizeWord(item.english))),
    )
  )
    throw new Error("阿里云音频未覆盖命令行词表全部项目。");
  return source;
}
