import { readFile, stat, writeFile, rename, rm, mkdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import {
  parseEditable,
  parseCsv,
  extractPdfGroups,
  makeSource,
  regroup,
  validateGroups,
} from "../src/import.js";
import { normalizeWord } from "../src/audio.js";
import {
  validateAliyunManifest,
  validatePublishedList,
} from "../src/aliyun-audio.js";
import { builtinSource } from "../src/words.js";
import { generateAudio } from "./generate-aliyun-audio.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const defaultOutput = join(projectRoot, "public/audio/aliyun");

/** Read an optional index; only a missing file is normal, while malformed content fails. */
async function readOptionalJson(path) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
  return JSON.parse(text);
}

/**
 * Read the last published list for audio repair, falling back only when it is absent.
 * Invalid data stops the command before synthesis; canonical groups retain the
 * content identity when the same list is republished with another audio quality.
 */
async function readCurrentSource(outputDirectory) {
  try {
    const payload = await readOptionalJson(
      join(outputDirectory, "active-list.json"),
    );
    const source =
      payload === undefined ? builtinSource : validatePublishedList(payload);
    // Remove occurrence IDs before hashing, so repairing audio preserves list identity.
    return { title: source.title, groups: validateGroups(source.groups) };
  } catch (error) {
    throw new Error(`当前词表读取失败：${error.message}`);
  }
}

/** Parse a local list with the same item validation and default grouping as browser import. */
export async function readInputSource(inputPath) {
  const extension = extname(inputPath).toLowerCase();
  if (![".txt", ".csv", ".pdf"].includes(extension))
    throw new Error("请选择 TXT、CSV 或文字版 PDF 词表。");
  const file = await stat(inputPath);
  if (!file.isFile()) throw new Error("词表路径不是普通文件。");
  if (file.size > 20 * 1024 * 1024)
    throw new Error("文件超过 20 MB，请拆分后导入。");
  const bytes = await readFile(inputPath);
  if (bytes.length > 20 * 1024 * 1024)
    throw new Error("文件超过 20 MB，请拆分后导入。");
  let groups;
  if (extension === ".pdf") {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      useSystemFonts: true,
    });
    try {
      const doc = await task.promise;
      if (doc.numPages > 100)
        throw new Error("每次最多读取 100 页，请拆分文件。");
      const pages = [];
      for (let i = 1; i <= doc.numPages; i++)
        pages.push((await (await doc.getPage(i)).getTextContent()).items);
      groups = extractPdfGroups(pages);
    } catch (error) {
      throw new Error(`PDF 导入失败：${error.message}`);
    } finally {
      await task.destroy();
    }
  } else {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    groups = extension === ".csv" ? parseCsv(text) : parseEditable(text);
  }
  if (groups.length === 1 && groups[0].items.length > 15)
    groups = regroup(groups);
  const filename = basename(inputPath);
  return { title: filename.slice(0, -extension.length), groups };
}

/**
 * Publish a list only after every entry has a generated or reusable recording.
 * Both qualities hold the same root lock through generation, atomic publication
 * and build, while recordings stay in separate directories. Failed synthesis
 * retains the previous published list and completed audio for a later retry.
 */
export async function importAliyunList({
  inputPath,
  outputDirectory = defaultOutput,
  voice,
  speechRate,
  quality = "standard",
  rate,
  execute = false,
  env = process.env,
  signal,
  generate = generateAudio,
  build = () => promisify(exec)("npm run build", { cwd: projectRoot }),
  log = console.log,
} = {}) {
  if (!["standard", "premium"].includes(quality))
    throw new Error("品质请选择 standard 或 premium。");
  const premium = quality === "premium";
  if ((premium && speechRate !== undefined) || (!premium && rate !== undefined))
    throw new Error("精品使用 --rate，标准版使用 --speech-rate。");
  const audioDirectory = premium
    ? join(outputDirectory, "premium")
    : outputDirectory;
  const prepare = async () => {
    const source = inputPath
      ? await readInputSource(inputPath)
      : await readCurrentSource(outputDirectory);
    if (!inputPath) {
      const payload = await readOptionalJson(
        join(audioDirectory, "manifest.json"),
      );
      if (payload !== undefined) {
        const manifest = validateAliyunManifest(payload);
        voice ??= manifest.voice;
        if (premium) rate ??= manifest.rate;
        else speechRate ??= manifest.speechRate;
      }
    }
    voice ??= premium ? "Emily_v3.1" : "emily";
    speechRate ??= 0;
    rate ??= 1;
    const words = source.groups.flatMap((group) =>
      group.items.map((item) => item.english),
    );
    log(
      `词表「${source.title}」：${source.groups.length} 组、${words.length} 项。`,
    );
    return {
      ...source,
      words,
      generateOptions: {
        words,
        outputDirectory: audioDirectory,
        quality,
        voice,
        speechRate,
        rate,
        execute,
        env,
        signal,
        log,
      },
    };
  };
  if (!execute) {
    const { generateOptions } = await prepare();
    return generate(generateOptions);
  }
  signal?.throwIfAborted();
  await mkdir(outputDirectory, { recursive: true });
  const lock = join(outputDirectory, ".import.lock");
  try {
    await mkdir(lock);
  } catch (error) {
    if (error.code === "EEXIST")
      throw new Error(
        "另一个词表导入任务正在运行，或上次异常退出遗留锁；确认无进程后再移除 .import.lock。",
      );
    throw error;
  }
  try {
    const { title, groups, words, generateOptions } = await prepare();
    const summary = await generate(generateOptions);
    signal?.throwIfAborted();
    const manifest = validateAliyunManifest(
      JSON.parse(await readFile(join(audioDirectory, "manifest.json"), "utf8")),
    );
    if (
      manifest.voice !== voice ||
      (premium
        ? manifest.version !== 2 || manifest.rate !== rate
        : manifest.version !== 1 || manifest.speechRate !== speechRate)
    )
      throw new Error("生成清单与本次声音配置不一致，词表未发布。");
    const covered = new Set(manifest.entries.map((entry) => entry.english));
    if (words.some((word) => !covered.has(normalizeWord(word))))
      throw new Error("音频清单未覆盖全部词表项，词表未发布。");
    const id = `cli-${createHash("sha256")
      .update(JSON.stringify({ title, groups }))
      .digest("hex")}`;
    const source = makeSource(groups, title, id);
    const target = join(outputDirectory, "active-list.json");
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(
        temporary,
        JSON.stringify({ version: 1, source, audioQuality: quality }, null, 2) +
          "\n",
        { flag: "wx" },
      );
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
    await build();
    log("词表和音频已发布；刷新本地网页即可加载。远程网站还需显式部署。");
    return summary;
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

/** Run the local maintenance command; a preview never sends paid requests. */
async function main() {
  const { values } = parseArgs({
    options: {
      input: { type: "string" },
      quality: { type: "string", default: "standard" },
      voice: { type: "string" },
      "speech-rate": { type: "string" },
      rate: { type: "string" },
      execute: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log(
      "npm run import:aliyun -- [--input words.txt|words.csv|words.pdf] [--quality standard|premium] [--voice 音色] [--execute]\n标准版：emily/eric，--speech-rate -500～500。精品：Emily/Eric/Luna/Luca_v3.1，--rate 0.5～2。\n不带 --input 时补齐已发布词表，未发布过则使用内置词表；沿用所选品质的已有配置。默认仅预览；--execute 才下载并发布。",
    );
    return;
  }
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    await importAliyunList({
      inputPath: values.input,
      quality: values.quality,
      voice: values.voice,
      rate: values.rate === undefined ? undefined : Number(values.rate),
      speechRate:
        values["speech-rate"] === undefined
          ? undefined
          : Number(values["speech-rate"]),
      execute: values.execute,
      signal: controller.signal,
    });
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
