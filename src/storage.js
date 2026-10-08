import { validateGroups } from "./import.js";
import { createGlossary, mergeGlossary } from "./glossary.js";

const KEY = "ipad-dictation:v1";

/** Create a fresh snapshot with the agreed defaults and a supplied built-in source. */
export function defaultSnapshot(source) {
  return {
    version: 1,
    settings: { repeat: 1, interval: 10, voiceURI: "" },
    source,
    glossary: createGlossary(source),
    mistakes: [],
    lastCliSourceId: null,
    lastCliAudioQuality: null,
  };
}

/** Accept records saved before the cumulative glossary existed. */
function validateGlossary(glossary) {
  if (glossary == null) return;
  if (
    glossary.id !== "glossary-v1" ||
    typeof glossary.title !== "string" ||
    !glossary.title.trim() ||
    !Number.isInteger(glossary.nextItem) ||
    glossary.nextItem < 0 ||
    !Array.isArray(glossary.groups)
  )
    throw new Error("完整词表损坏。");
  validateGroups(glossary.groups);
  const ids = glossary.groups.flatMap((group) =>
    group.items.map((item) => item.id),
  );
  const numbers = ids.map((id) =>
    typeof id === "string" && id.startsWith("glossary-v1:")
      ? Number(id.slice("glossary-v1:".length))
      : NaN,
  );
  if (
    numbers.some((number) => !Number.isInteger(number) || number < 0) ||
    new Set(ids).size !== ids.length ||
    numbers.some((number) => number >= glossary.nextItem)
  )
    throw new Error("完整词表标识损坏。");
}

/** Validate the complete persisted boundary before restoring any settings or records. */
function validateSnapshot(value) {
  if (value?.version !== 1) throw new Error("本地记录版本不兼容。");
  if (
    value.lastCliAudioQuality !== undefined &&
    value.lastCliAudioQuality !== null &&
    !["standard", "premium"].includes(value.lastCliAudioQuality)
  )
    throw new Error("命令行音频品质记录损坏。");
  if (
    value.lastCliSourceId !== undefined &&
    value.lastCliSourceId !== null &&
    !/^cli-[a-f0-9]{64}$/.test(value.lastCliSourceId)
  )
    throw new Error("命令行词表记录损坏。");
  const s = value.settings,
    source = value.source;
  if (
    !s ||
    ![1, 2, 3].includes(s.repeat) ||
    !Number.isInteger(s.interval) ||
    s.interval < 1 ||
    s.interval > 60 ||
    typeof s.voiceURI !== "string"
  )
    throw new Error("本地设置损坏。");
  if (
    !source ||
    typeof source.id !== "string" ||
    !source.id ||
    typeof source.title !== "string" ||
    !Array.isArray(source.groups)
  )
    throw new Error("本地词表损坏。");
  validateGroups(source.groups);
  const ids = source.groups.flatMap((g) => g.items.map((i) => i.id));
  if (
    ids.some(
      (id) => typeof id !== "string" || !id.startsWith(`${source.id}:`),
    ) ||
    new Set(ids).size !== ids.length
  )
    throw new Error("本地词表标识损坏。");
  if (
    !Array.isArray(value.mistakes) ||
    value.mistakes.some((id) => !ids.includes(id))
  )
    throw new Error("错词记录与词表不匹配。");
  validateGlossary(value.glossary);
  return value;
}

/** Old records have no glossary; start from the built-in list and keep their current words. */
function ensureGlossary(snapshot, builtin) {
  if (!snapshot.glossary) {
    snapshot.glossary = createGlossary(builtin);
    if (snapshot.source?.id !== builtin.id)
      snapshot.glossary = mergeGlossary(snapshot.glossary, snapshot.source);
  }
  return snapshot;
}

/** Load without writing; damaged records stay protected until explicit user recovery. */
export function loadSnapshot(storage, builtin) {
  try {
    const raw = storage?.getItem(KEY);
    return {
      snapshot: raw
        ? ensureGlossary(validateSnapshot(JSON.parse(raw)), builtin)
        : defaultSnapshot(builtin),
      error: null,
      protected: false,
    };
  } catch (error) {
    return {
      snapshot: defaultSnapshot(builtin),
      error: `本地记录无法恢复：${error.message}。现使用内置词表，原记录尚未覆盖。`,
      protected: true,
    };
  }
}

/** Atomically save the complete snapshot, returning a user-facing error on failure. */
export function saveSnapshot(storage, snapshot) {
  try {
    validateSnapshot(snapshot);
    if (!storage) throw new Error("存储不可用");
    storage.setItem(KEY, JSON.stringify(snapshot));
    return null;
  } catch (error) {
    return `本次修改未保存：${error.message}。仍可继续练习。`;
  }
}
