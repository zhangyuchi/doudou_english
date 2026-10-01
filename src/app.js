import "./style.css";
import { builtinSource } from "./words.js";
import { DictationPlayer, isBritish } from "./player.js";
import { BundledAudio, bundledVoice } from "./audio.js";
import audioCatalog from "./audio-catalog.json";
import {
  makeAliyunVoice,
  validateAliyunManifest,
  validatePublishedSource,
} from "./aliyun-audio.js";
import {
  parseFile,
  parseEditable,
  toEditable,
  regroup,
  makeSource,
} from "./import.js";
import { loadSnapshot, saveSnapshot } from "./storage.js";

const $ = (id) => document.getElementById(id);
let storage;
try {
  storage = window.localStorage;
} catch {
  storage = null;
}
const loaded = loadSnapshot(storage, builtinSource);
let snapshot = loaded.snapshot;
let protectedStorage = loaded.protected;
let groupIndex = 0,
  mode = "review",
  wrongMode = false,
  voices = [bundledVoice],
  importGeneration = 0;
let queue = [];
const running = (state) =>
  ["speaking", "repeat-gap", "writing-gap"].includes(state.phase);
const builtinAudio = new BundledAudio({
  catalog: audioCatalog,
  baseURL: new URL(`${import.meta.env.BASE_URL}audio/`, document.baseURI).href,
});
const aliyunAssets = new Map();

/** Read files from the current site on every page load, including after a CLI publish. */
async function readPublishedJson(name) {
  const url = new URL(
    `${import.meta.env.BASE_URL}audio/aliyun/${name}`,
    document.baseURI,
  );
  const response = await fetch(url, { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error(`读取 ${name} 失败（HTTP ${response.status}）。`);
  // Vite can serve its HTML fallback when a private JSON file has not been generated.
  if (response.headers.get("content-type")?.includes("text/html")) return null;
  return response.json();
}

/**
 * Load each private catalog independently, then apply a complete published list.
 * A quality switch preserves mistakes for the same source; repeated publication
 * preserves manual choices, and damaged storage remains protected.
 */
async function loadPublishedAssets() {
  for (const quality of ["standard", "premium"]) {
    try {
      const directory = quality === "premium" ? "premium/" : "";
      const manifest = await readPublishedJson(`${directory}manifest.json`);
      if (!manifest) continue;
      validateAliyunManifest(manifest);
      if (manifest.version !== (quality === "premium" ? 2 : 1))
        throw new Error("音频清单与所在品质目录不一致。");
      if (manifest.entries.length)
        aliyunAssets.set(quality, {
          manifest,
          voice: makeAliyunVoice(manifest),
          audio: new BundledAudio({
            catalog: manifest.entries,
            baseURL: new URL(
              `${import.meta.env.BASE_URL}audio/aliyun/${directory}`,
              document.baseURI,
            ).href,
          }),
        });
    } catch (error) {
      message(
        `${quality === "premium" ? "精品" : "标准"}英音加载失败：${error.message}`,
        true,
      );
    }
  }
  try {
    const published = await readPublishedJson("active-list.json");
    if (!published) return;
    const quality = published.audioQuality ?? "standard";
    const assets = aliyunAssets.get(quality);
    if (!assets) throw new Error("命令行词表缺少对应品质的阿里云音频清单。");
    const source = validatePublishedSource(published, assets.manifest);
    if (
      source.id === snapshot.lastCliSourceId &&
      quality === (snapshot.lastCliAudioQuality ?? "standard")
    )
      return;
    if (protectedStorage) {
      message("命令行词表未自动导入：请先处理受保护的本地记录。", true);
      return;
    }
    if (snapshot.source.id !== source.id) snapshot.mistakes = [];
    snapshot.source = source;
    snapshot.lastCliSourceId = source.id;
    snapshot.lastCliAudioQuality = quality;
    snapshot.settings.voiceURI = assets.voice.voiceURI;
    persist();
  } catch (error) {
    message(`本地音频或词表加载失败：${error.message}`, true);
  }
}

/** Route recorded playback by the explicitly selected voice; a missing item never switches sources. */
function selectedAudio() {
  for (const assets of aliyunAssets.values())
    if (currentVoice()?.voiceURI === assets.voice.voiceURI) return assets.audio;
  return builtinAudio;
}

// DictationPlayer owns the lifecycle; every recorded driver is cancelled on each transition.
const audio = {
  canPlay: (item) => selectedAudio().canPlay(item),
  play: (item, callbacks) => selectedAudio().play(item, callbacks),
  unlock: () => selectedAudio().unlock(),
  cancel() {
    builtinAudio.cancel();
    for (const assets of aliyunAssets.values()) assets.audio.cancel();
  },
};
const player = new DictationPlayer({
  audio,
  synth: window.speechSynthesis,
  createUtterance: (text) => new SpeechSynthesisUtterance(text),
  onChange: renderPlayback,
});

/** Display recoverable feedback without injecting imported markup. */
function message(text, warning = false) {
  $("message").textContent = text;
  $("message").hidden = !text;
  $("message").classList.toggle("warning", warning);
}

/** Persist one complete snapshot; protected old data require explicit recovery. */
function persist() {
  const error = protectedStorage
    ? "原本地记录尚未覆盖；点击下方按钮后才重新保存。"
    : saveSnapshot(storage, snapshot);
  storageWarning(error);
}

/** Keep saving errors visible independently from playback feedback. */
function storageWarning(text) {
  $("storage-warning").hidden = !text;
  $("storage-warning").querySelector("span").textContent = text || "";
  $("storage-recover").hidden = !protectedStorage;
}

/** Build safe DOM nodes for both built-in and user-provided content. */
function element(tag, text, className) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (className) e.className = className;
  return e;
}

/** Derive the current normal or wrong-word queue without modifying source data. */
function selectedItems() {
  return wrongMode
    ? snapshot.source.groups
        .flatMap((g) => g.items)
        .filter((i) => snapshot.mistakes.includes(i.id))
    : snapshot.source.groups[groupIndex].items;
}

/** Refresh selected group, progress and lists after a source or mode selection. */
function renderSource() {
  const source = snapshot.source;
  $("source-title").textContent = source.title;
  $("source-summary").textContent =
    `${source.groups.length} 组 · ${source.groups.flatMap((g) => g.items).length} 个听写项`;
  $("builtin-button").hidden = source.id === builtinSource.id;
  $("group-list").replaceChildren();
  source.groups.forEach((group, index) => {
    const button = element(
      "button",
      undefined,
      `group-card${!wrongMode && index === groupIndex ? " selected" : ""}`,
    );
    button.setAttribute(
      "aria-pressed",
      String(!wrongMode && index === groupIndex),
    );
    button.append(
      element("span", String(index + 1).padStart(2, "0"), "group-number"),
      element("span", group.label, "group-name"),
      element("span", `${group.items.length} 项`, "group-size"),
    );
    button.onclick = () => {
      player.stop();
      wrongMode = false;
      groupIndex = index;
      mode = "review";
      renderSource();
    };
    $("group-list").append(button);
  });
  queue = selectedItems();
  $("group-title").textContent = wrongMode
    ? "错词复习"
    : source.groups[groupIndex].label;
  $("item-count").textContent = `${queue.length} 个听写项`;
  $("mistakes-count").textContent = snapshot.mistakes.length;
  player.setQueue(queue);
  applySettings();
  renderWords();
  renderMode();
}

/** Render review and answer rows safely and keep duplicate occurrences independent. */
function renderWords() {
  for (const view of ["review", "answers"]) {
    const list = $(`${view}-list`);
    list.replaceChildren();
    if (!queue.length) {
      list.append(
        element(
          "p",
          "还没有错词。核对听写后勾选不熟悉的词，就可以在这里练习。",
          "empty-note",
        ),
      );
      continue;
    }
    queue.forEach((item, index) => {
      const row = element("div", undefined, "word-row");
      row.append(
        element("span", String(index + 1).padStart(2, "0"), "word-index"),
      );
      const content = element("div", undefined, "word-content");
      const english = element("button", item.english, "english-button");
      english.setAttribute("aria-label", `朗读 ${item.english}`);
      english.disabled = !canRead(item);
      english.onclick = () => speakOne(item);
      content.append(
        english,
        element("p", item.chinese || "未提供中文释义", "chinese"),
      );
      row.append(content);
      if (view === "review") {
        const sound = element("button", "♪", "speaker-mark");
        sound.setAttribute("aria-label", `播放 ${item.english}`);
        sound.disabled = !canRead(item);
        sound.onclick = () => speakOne(item);
        row.append(sound);
      } else {
        const label = element("label", undefined, "mistake-check");
        const check = element("input");
        check.type = "checkbox";
        check.checked = snapshot.mistakes.includes(item.id);
        check.setAttribute("aria-label", `标记错词 ${item.english}`);
        check.onchange = () => {
          snapshot.mistakes = check.checked
            ? [...new Set([...snapshot.mistakes, item.id])]
            : snapshot.mistakes.filter((id) => id !== item.id);
          persist();
          $("mistakes-count").textContent = snapshot.mistakes.length;
          if (wrongMode) {
            player.stop();
            queue = selectedItems();
            player.setQueue(queue);
            $("item-count").textContent = `${queue.length} 个听写项`;
            renderWords();
          }
        };
        label.append(check, element("span", "错词"));
        row.append(label);
      }
      list.append(row);
    });
  }
  $("review-start").disabled = !queue.length || !canReadQueue();
  renderVoiceHelp();
  $("wrong-practice").disabled = !snapshot.mistakes.length;
}

/** Switch between visible words and hidden paper-dictation without retaining old playback. */
function setMode(next) {
  player.stop();
  mode = next;
  player.setQueue(queue);
  applySettings();
  renderMode();
  message("");
}

/** Keep visible panels and mode-button accessibility state in agreement. */
function renderMode() {
  for (const name of ["review", "dictation", "answers"])
    $(`${name}-view`).hidden = mode !== name;
  document
    .querySelectorAll("[data-mode]")
    .forEach((button) =>
      button.setAttribute("aria-pressed", String(button.dataset.mode === mode)),
    );
  renderPlayback(player.state);
}

/** Select only an actual British voice; stored names never imply an available voice. */
function currentVoice() {
  return (
    voices.find((v) => v.voiceURI === snapshot.settings.voiceURI) ||
    voices[0] ||
    null
  );
}

/** Availability uses the same catalog matching as playback. */
function canRead(item) {
  return !!currentVoice() && (!currentVoice().recorded || audio.canPlay(item));
}
function canReadQueue() {
  return queue.every(canRead);
}
/** Display coverage for the selected local source rather than mixing recordings. */
function renderVoiceHelp() {
  const covered = queue.filter((item) => audio.canPlay(item)).length;
  const label =
    currentVoice()?.voiceURI === "aliyun-premium-en-GB"
      ? "阿里云精品英音"
      : currentVoice()?.voiceURI === "aliyun-en-GB"
        ? "阿里云英音"
        : "预置英音";
  $("voice-help").textContent = currentVoice()?.recorded
    ? `${label}覆盖 ${covered} / ${queue.length} 项。${covered < queue.length ? "未收录项可选择其他英音，或补充录音后练习。" : "声音随网站提供，无需下载系统语音。"}`
    : "正在使用设备的英国英语声音，音质由系统提供；可切回预置英音。";
}

/** Keep the bundled voice available even when the OS exposes no English voices. */
function refreshVoices() {
  const previous = currentVoice()?.voiceURI;
  voices = [
    bundledVoice,
    ...[...aliyunAssets.values()].map((assets) => assets.voice),
    ...(window.speechSynthesis?.getVoices() || []).filter(isBritish),
  ];
  $("voice-select").replaceChildren();
  for (const voice of voices) {
    const option = element(
      "option",
      voice.recorded ? voice.name : `${voice.name} · 系统英音`,
    );
    option.value = voice.voiceURI;
    $("voice-select").append(option);
  }
  $("voice-select").value = currentVoice().voiceURI;
  // A notification with the same selected voice must preserve a paused countdown.
  if (previous !== currentVoice().voiceURI) applySettings();
  renderWords();
  renderPlayback(player.state);
}

/** Configure all playback paths from the same validated UI settings. */
function applySettings() {
  player.configure({ ...snapshot.settings, voice: currentVoice() });
  $("repeat-select").value = snapshot.settings.repeat;
  $("interval-input").value = snapshot.settings.interval;
  document
    .querySelectorAll("[data-interval]")
    .forEach((b) =>
      b.setAttribute(
        "aria-pressed",
        String(Number(b.dataset.interval) === snapshot.settings.interval),
      ),
    );
}

/** Use the same cancellable player for single-word review and voice previews. */
function speakOne(item) {
  player.preview(item);
}

/** Present progress without exposing the current English or Chinese in dictation mode. */
function renderPlayback(state) {
  const active = running(state),
    available = !!currentVoice() && canReadQueue(),
    total = queue.length;
  $("progress-label").textContent = total
    ? `${wrongMode ? "错词练习" : snapshot.source.groups[groupIndex].label} · 第 ${Math.min(state.index + 1, total)} / ${total} 项`
    : "没有待练习单词";
  const labels = {
    idle: ["听一词，写一词。", "答案暂时隐藏，拿起笔就可以开始。", "▶"],
    speaking: [
      "正在朗读",
      `第 ${state.reading + 1} / ${player.settings.repeat} 遍，请仔细听。`,
      "♪",
    ],
    "repeat-gap": [
      "稍候，再听一遍",
      "两次朗读之间短暂停顿。",
      Math.ceil(state.remaining / 1000),
    ],
    "writing-gap": [
      "慢慢写，不着急",
      "写完后稍等，下一项会自动播放。",
      Math.ceil(state.remaining / 1000),
    ],
    paused: [
      "已暂停",
      player.pausedPhase === "speaking"
        ? "继续时会重读当前这一遍。"
        : "继续后从剩余书写时间开始。",
      "Ⅱ",
    ],
    complete: ["这一组，完成了。", "展开答案，看看哪些词还需要再练。", "✓"],
    error: ["朗读暂时停止", state.error, "!"],
  };
  const [title, help, number] = labels[state.phase] || labels.idle;
  $("playback-title").textContent = title;
  $("playback-help").textContent = help;
  $("countdown-number").textContent = number;
  $("countdown-disc").style.setProperty(
    "--sweep",
    state.phase === "writing-gap"
      ? `${360 * (1 - state.remaining / (player.settings.interval * 1000))}deg`
      : "0deg",
  );
  const fraction = total
    ? state.phase === "complete"
      ? 1
      : state.index / total
    : 0;
  $("progress-fill").style.width = `${fraction * 100}%`;
  document
    .querySelector(".progress-track")
    .setAttribute("aria-valuenow", String(Math.round(fraction * 100)));
  $("play-toggle").textContent = active
    ? "暂停"
    : state.phase === "paused"
      ? "继续"
      : state.phase === "complete"
        ? "再练一遍"
        : "开始听写";
  $("play-toggle").disabled = !available || !total;
  $("previous").disabled = !total || state.index <= 0;
  $("next").disabled = !total || state.index >= total - 1;
  $("replay").disabled = !available || !total;
  for (const id of ["repeat-select", "interval-input"]) $(id).disabled = active;
  document
    .querySelectorAll("[data-interval]")
    .forEach((b) => (b.disabled = active));
  $("voice-select").disabled = active;
  $("voice-preview").disabled =
    !currentVoice() || active || state.phase === "paused" || !previewItem();
  if (state.phase === "error" && mode !== "dictation")
    message(state.error, true);
}

/** Validate and apply settings while paused; a changed value restarts the current item. */
function changeSetting(key, value) {
  if (running(player.state)) return;
  if (
    key === "interval" &&
    (!Number.isInteger(value) || value < 1 || value > 60)
  ) {
    message("书写间隔请输入 1—60 秒的整数。", true);
    $("interval-input").value = snapshot.settings.interval;
    return;
  }
  snapshot.settings[key] = value;
  applySettings();
  persist();
  message("");
}

/** Parse a file into a preview without ever replacing the active source on failure. */
async function importFile(file) {
  if (!file) return;
  const generation = ++importGeneration;
  $("import-status").textContent = "正在读取文件，请稍候…";
  $("import-confirm").disabled = true;
  try {
    let groups = await parseFile(file);
    if (generation !== importGeneration) return;
    if (groups.length === 1 && groups[0].items.length > 15)
      groups = regroup(groups);
    $("import-title").value = file.name.replace(/\.[^.]+$/, "");
    $("import-text").value = toEditable(groups);
    $("import-status").textContent =
      "文件已读取。请核对单词、释义和分组，修正后再确认。";
    validatePreview();
  } catch (error) {
    if (generation === importGeneration) {
      $("import-status").textContent = error.message;
      $("import-summary").textContent = "当前词表保持不变。";
    }
  }
}

/** Check editable text before enabling the explicit source replacement action. */
function validatePreview() {
  try {
    const groups = parseEditable($("import-text").value);
    $("import-summary").textContent =
      `${groups.length} 组 · ${groups.flatMap((g) => g.items).length} 项 · 每组 ${groups.map((g) => g.items.length).join(" / ")} 项`;
    $("import-confirm").disabled = false;
  } catch (error) {
    $("import-summary").textContent = error.message;
    $("import-confirm").disabled = true;
  }
}

/** Close and invalidate pending imports so late results cannot reopen or mutate a preview. */
function closeImport() {
  importGeneration++;
  $("import-dialog").close();
}

/** Replace a confirmed source and its mistakes together; write failures stay visible. */
function useSource(source) {
  player.stop();
  snapshot.source = source;
  snapshot.mistakes = [];
  groupIndex = 0;
  wrongMode = false;
  mode = "review";
  persist();
  renderSource();
}

document
  .querySelectorAll("[data-mode]")
  .forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
document
  .querySelectorAll("[data-interval]")
  .forEach(
    (b) =>
      (b.onclick = () => changeSetting("interval", Number(b.dataset.interval))),
  );
$("repeat-select").onchange = (e) =>
  changeSetting("repeat", Number(e.target.value));
$("interval-input").onchange = (e) =>
  changeSetting("interval", Number(e.target.value));
$("voice-select").onchange = (e) => {
  snapshot.settings.voiceURI = e.target.value;
  applySettings();
  persist();
  renderWords();
};
/** Prefer the familiar preview; a custom catalog may contain only words from an imported list. */
function previewItem() {
  const guitar = { english: "guitar" };
  return canRead(guitar) ? guitar : queue.find(canRead);
}
$("voice-preview").onclick = () => {
  const item = previewItem();
  if (item) speakOne(item);
};
$("voices-refresh").onclick = refreshVoices;
window.speechSynthesis?.addEventListener("voiceschanged", refreshVoices);
$("review-start").onclick = () => {
  setMode("dictation");
  player.start();
};
$("play-toggle").onclick = () => {
  if (running(player.state)) player.pause();
  else if (player.state.phase === "paused") player.resume();
  else player.start();
};
$("replay").onclick = () => player.replay();
$("previous").onclick = () => player.move(-1);
$("next").onclick = () => player.move(1);
$("show-answers").onclick = () => setMode("answers");
const openWrong = () => {
  player.stop();
  wrongMode = true;
  mode = "review";
  renderSource();
};
$("mistakes-open").onclick = openWrong;
$("wrong-practice").onclick = openWrong;
$("builtin-button").onclick = () => {
  if (window.confirm("返回内置词表会清空当前词表的错词记录，是否继续？"))
    useSource(structuredClone(builtinSource));
};
$("storage-recover").onclick = () => {
  protectedStorage = false;
  persist();
};
$("import-open").onclick = () => {
  player.stop();
  importGeneration++;
  $("word-file").value = "";
  $("import-title").value = "";
  $("import-text").value = "";
  $("import-summary").textContent = "";
  $("import-status").textContent =
    "支持当前中英词表 PDF。也可以在下方直接粘贴单词。";
  $("import-confirm").disabled = true;
  $("import-dialog").showModal();
};
$("word-file").onchange = (e) => importFile(e.target.files[0]);
$("import-text").oninput = validatePreview;
$("import-close").onclick = closeImport;
$("import-cancel").onclick = closeImport;
$("import-dialog").addEventListener("cancel", () => {
  importGeneration++;
});
$("regroup-button").onclick = () => {
  try {
    $("import-text").value = toEditable(
      regroup(parseEditable($("import-text").value)),
    );
    validatePreview();
  } catch (error) {
    $("import-summary").textContent = error.message;
  }
};
$("import-confirm").onclick = () => {
  try {
    const groups = parseEditable($("import-text").value);
    const id = `import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    useSource(
      makeSource(groups, $("import-title").value.trim() || "我的词表", id),
    );
    closeImport();
    message("词表已切换，可以先试听和复习。");
  } catch (error) {
    $("import-summary").textContent = error.message;
  }
};
document.addEventListener("visibilitychange", () => {
  if (document.hidden) player.pause();
});
window.addEventListener("pagehide", () => player.stop());

await loadPublishedAssets();
renderSource();
refreshVoices();
storageWarning(loaded.error);
