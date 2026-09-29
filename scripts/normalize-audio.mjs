import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { chromium } from "@playwright/test";

// Offline maintenance tool: decode prepared recordings, trim silence and write portable PCM WAV.
// Ordinary dev/build never invokes it or contacts an audio service.
const [preparedPath, rawDirectory] = process.argv.slice(2);
if (!preparedPath || !rawDirectory)
  throw new Error(
    "用法：node scripts/normalize-audio.mjs <prepared.json> <原始音频目录>",
  );
const entries = JSON.parse(await readFile(preparedPath, "utf8"));
await mkdir("public/audio", { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const entry of entries) {
    const raw = await readFile(join(resolve(rawDirectory), entry.rawFile));
    const output = await page.evaluate(async (base64) => {
      const context = new OfflineAudioContext(1, 1, 22050);
      const data = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const buffer = await context.decodeAudioData(data.buffer);
      const mono = new Float32Array(buffer.length);
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const samples = buffer.getChannelData(channel);
        for (let i = 0; i < mono.length; i++)
          mono[i] += samples[i] / buffer.numberOfChannels;
      }
      let first = 0,
        last = mono.length - 1,
        peak = 0;
      for (const sample of mono) peak = Math.max(peak, Math.abs(sample));
      if (peak < 0.001) throw new Error("音频为空或没有可听信号");
      const threshold = Math.max(0.002, peak * 0.012);
      while (first < last && Math.abs(mono[first]) < threshold) first++;
      while (last > first && Math.abs(mono[last]) < threshold) last--;
      // Keep margins to avoid clipping consonants; never alter pitch or concatenate words.
      first = Math.max(0, first - Math.round(buffer.sampleRate * 0.08));
      last = Math.min(
        mono.length - 1,
        last + Math.round(buffer.sampleRate * 0.12),
      );
      const length = last - first + 1,
        wav = new ArrayBuffer(44 + length * 2);
      const view = new DataView(wav),
        ascii = (offset, value) =>
          [...value].forEach((char, i) =>
            view.setUint8(offset + i, char.charCodeAt(0)),
          );
      ascii(0, "RIFF");
      view.setUint32(4, 36 + length * 2, true);
      ascii(8, "WAVE");
      ascii(12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, buffer.sampleRate, true);
      view.setUint32(28, buffer.sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      ascii(36, "data");
      view.setUint32(40, length * 2, true);
      const gain = 0.85 / peak;
      for (let i = 0; i < length; i++)
        view.setInt16(
          44 + i * 2,
          Math.round(Math.max(-1, Math.min(1, mono[first + i] * gain)) * 32767),
          true,
        );
      return {
        bytes: Array.from(new Uint8Array(wav)),
        duration: length / buffer.sampleRate,
      };
    }, raw.toString("base64"));
    const bytes = Buffer.from(output.bytes);
    await writeFile(join("public/audio", entry.file), bytes);
    entry.originalSHA256 = createHash("sha256").update(raw).digest("hex");
    entry.sha256 = createHash("sha256").update(bytes).digest("hex");
    entry.duration = Number(output.duration.toFixed(4));
    entry.bytes = bytes.length;
    entry.processing =
      "PCM WAV, mono 22050 Hz; peak 0.85; silence trimmed with 80ms/120ms margins";
    delete entry.rawFile;
  }
  entries.sort((a, b) => a.english.localeCompare(b.english, "en"));
  await writeFile(
    "public/audio/manifest.json",
    JSON.stringify(entries, null, 2) + "\n",
  );
  await writeFile(
    "src/audio-catalog.json",
    JSON.stringify(
      entries.map(({ english, file }) => ({ english, file })),
      null,
      2,
    ) + "\n",
  );
  const escape = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char],
    );
  const rows = entries
    .map(
      (entry) =>
        `<tr><td>${escape(entry.english)}</td><td>${entry.kind === "recorded" ? "真人录音" : "本地合成"}</td><td>${escape(entry.author)}</td><td><a href="${escape(entry.sourceURL)}">原始来源</a> · <a href="${escape(entry.licenseURL)}">${escape(entry.license)}</a></td></tr>`,
    )
    .join("\n");
  await writeFile(
    "public/audio/credits.html",
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>英音来源与许可</title><style>body{font:16px/1.6 system-ui;margin:2rem;max-width:1100px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:.5rem;text-align:left}a{color:#17578c}</style><h1>英音来源与许可</h1><p>共 ${entries.length} 项，${entries.filter((entry) => entry.kind === "recorded").length} 项真人录音，其余为 Piper en_GB-cori-high 本地合成。不是教材原录音。不同说话者的音色与重音可能不同。</p><p>全部文件转换为单声道 WAV、统一峰值、裁剪首尾静音；真人录音保留原作者与对应许可，修改后的录音继续采用同一许可。合成模型 Cori high 与训练语料由作者标为 public domain，生成片段以 CC0 提供。工具 Piper 的 GPL 许可不等同于声音文件的许可。</p><p><a href="manifest.json">逐项来源、口音依据、处理记录、生成参数与 SHA256 清单</a> · <a href="cori-model-card.txt">Cori 模型卡快照</a> · <a href="https://brycebeattie.com/files/tts/">模型作者的许可说明</a></p><table><thead><tr><th>英文项</th><th>类型</th><th>作者 / 声音</th><th>来源与许可</th></tr></thead><tbody>${rows}</tbody></table></html>\n`,
  );
  console.log(
    `Prepared ${entries.length} audio files, ${entries.reduce((sum, entry) => sum + entry.bytes, 0)} bytes.`,
  );
} finally {
  await browser.close();
}
