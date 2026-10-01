import { readFile, writeFile, mkdir, rename, rm } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createRequire } from "node:module";
import { builtinSource } from "../src/words.js";
import { parseEditable, parseCsv, validateGroups } from "../src/import.js";
import { normalizeWord } from "../src/audio.js";
import {
  aliyunVoices,
  premiumVoices,
  premiumModel,
  validateAliyunManifest,
} from "../src/aliyun-audio.js";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const defaultOutput = join(projectRoot, "public/audio/aliyun");
const endpoint = "https://nls-gateway-cn-shanghai.aliyuncs.com/stream/v1/tts";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Identify locally authored diagnostics so third-party error text cannot leak request secrets. */
class AudioResponseError extends Error {}

/** Load the built-in list or an existing TXT/CSV format, keeping each phrase intact. */
export async function readWords(inputPath) {
  let groups = builtinSource.groups;
  if (inputPath) {
    const extension = extname(inputPath).toLowerCase();
    if (![".txt", ".csv"].includes(extension))
      throw new Error("脚本支持 TXT/CSV；PDF 请先在网页导入并整理为 TXT。");
    const bytes = await readFile(inputPath);
    if (bytes.length > 20 * 1024 * 1024) throw new Error("词表超过 20 MB。");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    groups = extension === ".csv" ? parseCsv(text) : parseEditable(text);
  }
  return [
    ...new Set(
      groups.flatMap((group) =>
        group.items.map((item) => normalizeWord(item.english)),
      ),
    ),
  ];
}

/**
 * Cache NLS credentials only in memory and refresh by the provider's actual expiry.
 * An explicit temporary Token takes precedence; official RPC SDK owns AK signing.
 * SDK failures are reduced to a safe code so signed URLs and credentials cannot escape.
 */
export function createTokenProvider({
  env = process.env,
  createToken,
  now = Date.now,
} = {}) {
  let cached;
  return async () => {
    if (env.ALIYUN_NLS_TOKEN) return env.ALIYUN_NLS_TOKEN;
    if (!env.ALIYUN_AK_ID || !env.ALIYUN_AK_SECRET)
      throw new Error(
        "请配置 ALIYUN_AK_ID / ALIYUN_AK_SECRET，或临时 ALIYUN_NLS_TOKEN。",
      );
    if (cached && cached.ExpireTime * 1000 > now() + 30000) return cached.Id;
    let result;
    try {
      if (createToken) result = await createToken();
      else {
        const require = createRequire(import.meta.url);
        const sdkRequire = createRequire(require.resolve("@alicloud/pop-core"));
        const httpRequire = createRequire(sdkRequire.resolve("httpx"));
        // The SDK's HTTP debug output includes signed requests and returned Tokens.
        // This sequential CLI suppresses its logger copies until the response is consumed.
        const loggers = [
          ...new Set([sdkRequire("debug"), httpRequire("debug")]),
        ];
        // debug 3's disable() returns nothing; capture both settings before either mutates DEBUG.
        const settings = loggers.map((logger) => logger.load());
        loggers.forEach((logger) => logger.disable());
        try {
          const { default: sdk } = await import("@alicloud/pop-core");
          const client = new sdk.RPCClient({
            accessKeyId: env.ALIYUN_AK_ID,
            accessKeySecret: env.ALIYUN_AK_SECRET,
            endpoint: "https://nls-meta.cn-shanghai.aliyuncs.com",
            apiVersion: "2019-02-28",
          });
          result = await client.request(
            "CreateToken",
            {},
            { method: "POST", timeout: 10000 },
          );
        } finally {
          loggers.forEach((logger, index) => logger.enable(settings[index]));
        }
      }
    } catch (error) {
      const code = /^[A-Za-z0-9_.-]{1,80}$/.test(error.code)
        ? error.code
        : "请求失败";
      throw new Error(
        `获取 NLS Token 失败（${code}），请检查权限、凭证和网络。`,
      );
    }
    const token = result?.Token;
    if (
      !token?.Id ||
      !Number.isFinite(token.ExpireTime) ||
      token.ExpireTime * 1000 <= now()
    )
      throw new Error("获取 NLS Token 失败：响应缺少有效 Token 或过期时间。");
    cached = token;
    return cached.Id;
  };
}

/** Reject non-audio and truncated PCM files before they can become resumable successes. */
function validateWav(bytes) {
  if (
    bytes.length <= 44 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WAVE" ||
    bytes.readUInt32LE(4) !== bytes.length - 8
  )
    throw new AudioResponseError("服务未返回有效 WAV 音频。");
  let blockAlign;
  const dataSizes = [];
  for (let offset = 12; offset < bytes.length; ) {
    if (offset + 8 > bytes.length)
      throw new AudioResponseError("WAV 音频不完整。");
    const kind = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (offset + 8 + size + (size % 2) > bytes.length)
      throw new AudioResponseError("WAV 音频不完整。");
    if (kind === "fmt ") {
      if (blockAlign || size < 16 || bytes.readUInt16LE(offset + 8) !== 1)
        throw new AudioResponseError("WAV 不是 PCM 格式。");
      const channels = bytes.readUInt16LE(offset + 10);
      const sampleRate = bytes.readUInt32LE(offset + 12);
      const byteRate = bytes.readUInt32LE(offset + 16);
      blockAlign = bytes.readUInt16LE(offset + 20);
      const bits = bytes.readUInt16LE(offset + 22);
      if (
        channels < 1 ||
        channels > 8 ||
        sampleRate < 1 ||
        sampleRate > 192000 ||
        ![8, 16, 24, 32].includes(bits) ||
        blockAlign !== (channels * bits) / 8 ||
        byteRate !== sampleRate * blockAlign
      )
        throw new AudioResponseError("WAV PCM 格式参数无效。");
    }
    if (kind === "data") dataSizes.push(size);
    offset += 8 + size + (size % 2);
  }
  if (
    !blockAlign ||
    !dataSizes.length ||
    dataSizes.some((size) => size === 0 || size % blockAlign !== 0)
  )
    throw new AudioResponseError("WAV 音频缺少格式或声音数据。");
}

/** Missing indexes are normal; malformed existing indexes must not be silently discarded. */
async function loadManifest(directory, configuration) {
  let raw;
  try {
    raw = await readFile(join(directory, "manifest.json"), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { ...configuration, entries: [] };
    throw error;
  }
  let manifest;
  try {
    manifest = validateAliyunManifest(JSON.parse(raw));
  } catch {
    throw new Error("已有阿里云音频清单无效，请先检查或恢复备份。");
  }
  if (
    Object.entries(configuration).some(
      ([key, value]) => manifest[key] !== value,
    )
  )
    throw new Error(
      `已有音频配置不同；请备份并移走 ${directory} 后重新生成，避免混声。`,
    );
  return manifest;
}

/**
 * Synthesize one premium item and immediately download its complete WAV.
 * Only the workspace endpoint receives the key; signed download URLs are never logged
 * or persisted, and only Beijing OSS HTTPS hosts may receive an unauthenticated GET.
 */
async function downloadPremiumAudio({
  word,
  configuration,
  env,
  fetcher,
  signal,
}) {
  const requestSignal = () =>
    AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])]);
  const response = await fetcher(
    `https://${env.DASHSCOPE_WORKSPACE_ID}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer`,
    {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.DASHSCOPE_API_KEY}`,
      },
      body: JSON.stringify({
        model: configuration.model,
        input: {
          text: word,
          voice: configuration.voice,
          format: "wav",
          sample_rate: configuration.sampleRate,
          rate: configuration.rate,
        },
      }),
      signal: requestSignal(),
    },
  );
  let result;
  try {
    result = await response.json();
  } catch {
    throw new AudioResponseError(
      `精品接口未返回 JSON（HTTP ${response.status}）。`,
    );
  }
  if (!response.ok || result?.code) {
    const code =
      typeof result?.code === "string" &&
      /^(InvalidApiKey|InvalidParameter|AccessDenied|Unauthorized|Throttling|QuotaExceeded|ModelNotFound|InternalError|BadRequest)$/.test(
        result.code,
      )
        ? `，错误码 ${result.code}`
        : "";
    throw new AudioResponseError(
      `精品接口失败：HTTP ${response.status}${code}。`,
    );
  }
  if (
    result?.output?.finish_reason !== "stop" ||
    typeof result.output.audio?.url !== "string"
  )
    throw new AudioResponseError("精品合成未完成或缺少音频下载地址。");
  let url;
  try {
    url = new URL(result.output.audio.url);
  } catch {
    throw new AudioResponseError("精品音频下载地址无效。");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    !/^[a-z0-9][a-z0-9-]*\.oss-cn-beijing\.aliyuncs\.com$/.test(url.hostname)
  )
    throw new AudioResponseError("精品音频下载地址不是北京阿里云 OSS 地址。");
  url.protocol = "https:";
  signal?.throwIfAborted();
  const audio = await fetcher(url.href, {
    method: "GET",
    redirect: "error",
    signal: requestSignal(),
  });
  if (
    !audio.ok ||
    !/^(audio\/|application\/octet-stream(?:;|$))/i.test(
      audio.headers.get("content-type") || "",
    )
  )
    throw new AudioResponseError(`精品音频下载失败：HTTP ${audio.status}。`);
  const bytes = Buffer.from(await audio.arrayBuffer());
  const usage = result.usage;
  return {
    bytes,
    usage:
      usage &&
      Number.isSafeInteger(usage.input_tokens) &&
      usage.input_tokens >= 0 &&
      Number.isSafeInteger(usage.output_tokens) &&
      usage.output_tokens >= 0
        ? { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens }
        : null,
  };
}

/** A successful index entry is reusable only while its file, configuration and checksum match. */
async function reusable(entry, directory, filename) {
  if (!entry || entry.file !== filename) return false;
  try {
    const bytes = await readFile(join(directory, entry.file));
    validateWav(bytes);
    return bytes.length === entry.bytes && sha256(bytes) === entry.sha256;
  } catch (error) {
    if (error.code && error.code !== "ENOENT") throw error;
    return false;
  }
}

/** Publish one complete file by rename; failures never leave a truncated final filename. */
async function atomicWrite(path, data) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, data, { flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/**
 * Preview or sequentially generate a private catalog under one writer lock.
 * Each validated audio file is committed before its index, so completed words survive failures.
 * No synthesis retry is automatic: an ambiguous network failure may already have been billed.
 */
export async function generateAudio({
  words,
  inputPath,
  outputDirectory,
  quality = "standard",
  voice,
  speechRate = 0,
  rate = 1,
  execute = false,
  env = process.env,
  fetch: fetcher = globalThis.fetch,
  getToken,
  signal,
  log = console.log,
} = {}) {
  if (!["standard", "premium"].includes(quality))
    throw new Error("品质请选择 standard 或 premium。");
  const premium = quality === "premium";
  outputDirectory ??= premium ? join(defaultOutput, "premium") : defaultOutput;
  voice ??= premium ? "Emily_v3.1" : "emily";
  if (
    premium
      ? !Object.hasOwn(premiumVoices, voice) ||
        !Number.isFinite(rate) ||
        rate < 0.5 ||
        rate > 2 ||
        speechRate !== 0
      : !Object.hasOwn(aliyunVoices, voice) ||
        !Number.isInteger(speechRate) ||
        Math.abs(speechRate) > 500
  )
    throw new Error(
      premium
        ? "请选择精品英音 Emily/Eric/Luna/Luca_v3.1，rate 范围 0.5～2；精品不支持 speech-rate。"
        : "请选择 emily/eric 英音，语速应为 -500～500 的整数。",
    );
  const configuration = premium
    ? { version: 2, model: premiumModel, voice, rate, sampleRate: 24000 }
    : { version: 1, voice, speechRate };
  words = words
    ? [
        ...new Set(
          validateGroups([
            { items: words.map((english) => ({ english })) },
          ])[0].items.map((item) => normalizeWord(item.english)),
        ),
      ]
    : await readWords(inputPath);
  const filenames = new Map(
    words.map((word) => [
      word,
      `${sha256(JSON.stringify(premium ? { word, ...configuration } : { word, voice, speechRate }))}.wav`,
    ]),
  );
  let lock;
  if (execute) {
    signal?.throwIfAborted();
    await mkdir(outputDirectory, { recursive: true });
    lock = join(outputDirectory, ".generate.lock");
    try {
      await mkdir(lock);
    } catch (error) {
      if (error.code === "EEXIST")
        throw new Error(
          "另一个生成任务正在运行，或上次退出遗留锁；确认无进程后再移除 .generate.lock。",
        );
      throw error;
    }
  }
  try {
    const manifest = await loadManifest(outputDirectory, configuration);
    const entries = new Map(
      manifest.entries.map((entry) => [entry.english, entry]),
    );
    const pending = [];
    for (const word of words)
      if (
        !(await reusable(
          entries.get(word),
          outputDirectory,
          filenames.get(word),
        ))
      )
        pending.push(word);
    const summary = {
      total: words.length,
      skipped: words.length - pending.length,
      pending: pending.length,
      generated: 0,
      ...(premium ? { inputTokens: 0, outputTokens: 0 } : {}),
    };
    log(
      `共 ${summary.total} 项，已有 ${summary.skipped} 项，待生成 ${summary.pending} 项；${premium ? "精品按实际输入/输出 Token 计费，预览不估算费用。" : `按起步价估算合成费 ${(pending.length * 0.0035).toFixed(4)} 元（试用/资源包另计）。`}`,
    );
    if (!execute || !pending.length) {
      if (!execute) log("仅预览，未调用 API；添加 --execute 才开始生成。");
      return summary;
    }
    if (premium) {
      if (!env.DASHSCOPE_API_KEY)
        throw new Error("请在 .env.local 配置北京地域 DASHSCOPE_API_KEY。");
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(env.DASHSCOPE_WORKSPACE_ID || ""))
        throw new Error("请在 .env.local 配置有效 DASHSCOPE_WORKSPACE_ID。");
    } else {
      if (!env.ALIYUN_NLS_APPKEY) throw new Error("请配置 ALIYUN_NLS_APPKEY。");
      getToken ||= createTokenProvider({ env });
    }
    for (const word of pending) {
      signal?.throwIfAborted();
      const token = premium ? null : await getToken();
      signal?.throwIfAborted();
      let response;
      try {
        let bytes, usage;
        if (premium)
          ({ bytes, usage } = await downloadPremiumAudio({
            word,
            configuration,
            env,
            fetcher,
            signal,
          }));
        else {
          response = await fetcher(endpoint, {
            method: "POST",
            redirect: "error",
            headers: {
              "Content-Type": "application/json",
              "X-NLS-Token": token,
            },
            body: JSON.stringify({
              appkey: env.ALIYUN_NLS_APPKEY,
              text: word,
              voice,
              format: "wav",
              sample_rate: 16000,
              speech_rate: speechRate,
            }),
            signal: AbortSignal.any([
              AbortSignal.timeout(30000),
              ...(signal ? [signal] : []),
            ]),
          });
          if (
            !response.ok ||
            !/^audio\//i.test(response.headers.get("content-type") || "")
          ) {
            let status;
            try {
              status = (await response.json()).status;
            } catch {
              /* Non-JSON error pages contain no useful safe status. */
            }
            throw new AudioResponseError(
              `接口失败：HTTP ${response.status}${Number.isSafeInteger(status) ? `，状态 ${status}` : ""}。`,
            );
          }
          bytes = Buffer.from(await response.arrayBuffer());
        }
        // Aliyun streams WAV with estimated lengths. Only normalize its canonical
        // PCM header after the HTTP body completes; disk reuse stays strictly checked.
        if (
          bytes.length > 44 &&
          bytes.toString("ascii", 0, 4) === "RIFF" &&
          bytes.toString("ascii", 8, 16) === "WAVEfmt " &&
          bytes.readUInt32LE(16) === 16 &&
          bytes.readUInt16LE(20) === 1 &&
          bytes.toString("ascii", 36, 40) === "data" &&
          bytes.readUInt32LE(4) === bytes.readUInt32LE(40) + 36
        ) {
          bytes.writeUInt32LE(bytes.length - 8, 4);
          bytes.writeUInt32LE(bytes.length - 44, 40);
        }
        validateWav(bytes);
        signal?.throwIfAborted();
        const file = filenames.get(word);
        await atomicWrite(join(outputDirectory, file), bytes);
        entries.set(word, {
          english: word,
          file,
          sha256: sha256(bytes),
          bytes: bytes.length,
          generatedAt: new Date().toISOString(),
          ...(usage ? { usage } : {}),
        });
        manifest.entries = [...entries.values()];
        await atomicWrite(
          join(outputDirectory, "manifest.json"),
          JSON.stringify(manifest, null, 2) + "\n",
        );
        summary.generated++;
        if (usage) {
          summary.inputTokens += usage.inputTokens;
          summary.outputTokens += usage.outputTokens;
        }
        log(`已保存 ${word}（${summary.generated}/${summary.pending}）。`);
      } catch (error) {
        // Fetch/SDK diagnostics may include request credentials; only our own safe failures escape.
        const detail =
          error instanceof AudioResponseError
            ? error.message
            : "网络、写入或取消错误，请检查后重跑。";
        throw new Error(
          `${word}：${detail} 已保存 ${summary.generated} 项；重跑会跳过成功项。`,
        );
      }
    }
    if (premium)
      log(
        `本次已保存音频中可统计的输入 Token：${summary.inputTokens}，输出 Token：${summary.outputTokens}（以供应商账单为准）。`,
      );
    return summary;
  } finally {
    if (lock) await rm(lock, { recursive: true, force: true });
  }
}

/** Run the maintenance command locally; ordinary dev/build never invokes paid generation. */
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
      "npm run audio:aliyun -- [--input words.txt|words.csv] [--quality standard|premium] [--voice 音色] [--execute]\n标准版默认 emily，--speech-rate -500～500。精品默认 Emily_v3.1，--rate 0.5～2。默认内置词表、仅预览；凭证写入本地 .env.local。需要自动导入及 PDF 时使用 import:aliyun。",
    );
    return;
  }
  if (
    (values.quality === "premium" && values["speech-rate"] !== undefined) ||
    (values.quality === "standard" && values.rate !== undefined)
  )
    throw new Error("精品使用 --rate，标准版使用 --speech-rate。");
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    await generateAudio({
      inputPath: values.input,
      quality: values.quality,
      voice: values.voice,
      speechRate:
        values["speech-rate"] === undefined
          ? undefined
          : Number(values["speech-rate"]),
      rate: values.rate === undefined ? undefined : Number(values.rate),
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
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
