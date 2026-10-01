import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readInputSource,
  importAliyunList,
} from "../scripts/import-aliyun-list.mjs";
import { validatePublishedSource } from "../src/aliyun-audio.js";
import { generateAudio } from "../scripts/generate-aliyun-audio.mjs";
import { builtinSource } from "../src/words.js";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "aliyun-list-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("premium imports publish with isolated audio and repair the current list with inherited settings", async (t) => {
  const root = await fixture(t);
  const outputDirectory = join(root, "audio");
  const inputPath = join(root, "premium.txt");
  await writeFile(inputPath, "apple\t苹果\nprimary school\t小学\n");
  const wav = await readFile("public/audio/guitar.wav");
  const requests = [];
  const options = {
    outputDirectory,
    execute: true,
    quality: "premium",
    env: {
      DASHSCOPE_API_KEY: "test-key",
      DASHSCOPE_WORKSPACE_ID: "test-workspace",
    },
    generate: (settings) =>
      generateAudio({
        ...settings,
        fetch: async (_url, init) => {
          requests.push(init);
          return init.method === "POST"
            ? Response.json({
                output: {
                  finish_reason: "stop",
                  audio: {
                    url: "https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/a.wav",
                  },
                },
                usage: { input_tokens: 2, output_tokens: 10 },
              })
            : new Response(wav, { headers: { "Content-Type": "audio/wav" } });
        },
      }),
    build: async () => {},
    log() {},
  };
  await importAliyunList({
    ...options,
    inputPath,
    voice: "Eric_v3.1",
    rate: 0.8,
  });
  const path = join(outputDirectory, "active-list.json");
  const original = await readFile(path, "utf8");
  assert.equal(JSON.parse(original).audioQuality, "premium");
  const manifest = JSON.parse(
    await readFile(join(outputDirectory, "premium/manifest.json"), "utf8"),
  );
  await assert.rejects(readFile(join(outputDirectory, "manifest.json")), {
    code: "ENOENT",
  });
  assert.equal(manifest.voice, "Eric_v3.1");
  assert.equal(
    validatePublishedSource(JSON.parse(original), manifest).title,
    "premium",
  );
  await rm(join(outputDirectory, "premium", manifest.entries[0].file));
  requests.length = 0;
  const repaired = await importAliyunList(options);
  assert.equal(repaired.generated, 1);
  assert.equal(repaired.skipped, 1);
  assert.equal(JSON.parse(requests[0].body).input.rate, 0.8);
  assert.equal(await readFile(path, "utf8"), original);
  const failurePath = join(root, "other.csv");
  await writeFile(failurePath, "english,chinese\nnew,新\n");
  await assert.rejects(
    importAliyunList({
      ...options,
      inputPath: failurePath,
      voice: "Eric_v3.1",
      rate: 0.8,
      generate: async () => {
        throw new Error("simulated failure");
      },
    }),
    /failure/,
  );
  assert.equal(await readFile(path, "utf8"), original);
  await mkdir(join(outputDirectory, ".import.lock"));
  await assert.rejects(importAliyunList(options), /另一个|锁/);
});

test("without input, preview uses the built-in list when no list has been published", async (t) => {
  const root = await fixture(t);
  const outputDirectory = join(root, "audio");
  await importAliyunList({
    outputDirectory,
    generate: async ({ words, execute, voice, speechRate }) => {
      assert.deepEqual(
        words,
        builtinSource.groups.flatMap((group) =>
          group.items.map((item) => item.english),
        ),
      );
      assert.equal(execute, false);
      assert.equal(voice, "emily");
      assert.equal(speechRate, 0);
      return { total: 161, skipped: 0, pending: 161, generated: 0 };
    },
    build: async () => assert.fail("preview must not build"),
    log() {},
  });
  await assert.rejects(readFile(join(outputDirectory, "active-list.json")), {
    code: "ENOENT",
  });
});

test("without input, repair uses the published list and voice and preserves its identity", async (t) => {
  const root = await fixture(t);
  const inputPath = join(root, "current.txt");
  const outputDirectory = join(root, "audio");
  await writeFile(inputPath, "apple\t苹果\n\nprimary school\t小学\n");
  const wav = await readFile("public/audio/guitar.wav");
  const requests = [];
  const options = {
    outputDirectory,
    execute: true,
    env: { ALIYUN_NLS_APPKEY: "test-appkey", ALIYUN_NLS_TOKEN: "test-token" },
    generate: (settings) =>
      generateAudio({
        ...settings,
        fetch: async (_url, init) => {
          requests.push(JSON.parse(init.body));
          return new Response(wav, {
            headers: { "Content-Type": "audio/wav" },
          });
        },
      }),
    build: async () => {},
    log() {},
  };
  await importAliyunList({
    ...options,
    inputPath,
    voice: "eric",
    speechRate: -100,
  });
  const publishedPath = join(outputDirectory, "active-list.json");
  const original = await readFile(publishedPath, "utf8");
  const manifest = JSON.parse(
    await readFile(join(outputDirectory, "manifest.json"), "utf8"),
  );
  await rm(join(outputDirectory, manifest.entries[0].file));
  requests.length = 0;
  const result = await importAliyunList(options);
  assert.equal(result.generated, 1);
  assert.equal(result.skipped, 1);
  assert.deepEqual(
    requests.map((request) => [
      request.text,
      request.voice,
      request.speech_rate,
    ]),
    [["apple", "eric", -100]],
  );
  assert.equal(await readFile(publishedPath, "utf8"), original);
  await writeFile(
    join(outputDirectory, manifest.entries[1].file),
    "damaged WAV",
  );
  requests.length = 0;
  const repaired = await importAliyunList(options);
  assert.equal(repaired.generated, 1);
  assert.equal(repaired.skipped, 1);
  assert.equal(requests[0].text, "primary school");
  requests.length = 0;
  const reused = await importAliyunList({ ...options, env: {} });
  assert.equal(reused.generated, 0);
  assert.equal(reused.skipped, 2);
  assert.equal(requests.length, 0);
  await assert.rejects(
    importAliyunList({ ...options, voice: "emily" }),
    /配置|音色/,
  );
  assert.equal(requests.length, 0);
  for (const invalid of ["broken", "null"]) {
    await writeFile(publishedPath, invalid);
    await assert.rejects(importAliyunList(options), /词表/);
  }
  assert.equal(requests.length, 0);
});

test("CLI parses TXT, CSV and text PDF with browser grouping and limits", async (t) => {
  const root = await fixture(t);
  const txt = join(root, "mine.txt");
  const csv = join(root, "mine.csv");
  const pdf = join(root, "mine.pdf");
  await writeFile(txt, "Apple\t苹果\n\nprimary school\t小学\n");
  await writeFile(
    csv,
    "english,chinese,group\nApple,苹果,1\nprimary school,小学,2\n",
  );
  await cp("public/examples/外研社7年级英语听写分组.pdf", pdf);
  for (const file of [txt, csv]) {
    const source = await readInputSource(file);
    assert.deepEqual(
      source.groups.map((g) => g.items[0].english),
      ["Apple", "primary school"],
    );
    assert.equal(source.title, "mine");
  }
  const source = await readInputSource(pdf);
  assert.equal(source.groups.length, 11);
  assert.equal(source.groups.flatMap((g) => g.items).length, 161);
  await writeFile(join(root, "bad.pdf"), "not a PDF");
  await assert.rejects(readInputSource(join(root, "bad.pdf")), /PDF/);
  await assert.rejects(
    readInputSource(join(root, "missing.xlsx")),
    /TXT|CSV|PDF/,
  );
});

test("only one import command can generate and publish at a time", async (t) => {
  const root = await fixture(t);
  const inputPath = join(root, "words.txt");
  const outputDirectory = join(root, "audio");
  await writeFile(inputPath, "apple\t苹果\n");
  const started = Promise.withResolvers();
  const hold = Promise.withResolvers();
  const first = importAliyunList({
    inputPath,
    outputDirectory,
    execute: true,
    generate: async () => {
      started.resolve();
      await hold.promise;
    },
    build: async () => {},
    log() {},
  });
  await started.promise;
  try {
    await assert.rejects(
      importAliyunList({
        inputPath,
        outputDirectory,
        execute: true,
        generate: async () => assert.fail("second call must not synthesize"),
        build: async () => {},
        log() {},
      }),
      /另一个|锁/,
    );
  } finally {
    hold.reject(new Error("stop first import"));
    await assert.rejects(first, /stop first import/);
  }
});

test("preview does not publish; failed synthesis preserves old source; success publishes a covered source", async (t) => {
  const root = await fixture(t);
  const inputPath = join(root, "practice.txt");
  const outputDirectory = join(root, "audio");
  await writeFile(inputPath, "Apple\t苹果\nprimary school\t小学\n");
  let calls = 0;
  const generate = async ({ words, execute }) => {
    calls++;
    assert.deepEqual(words, ["Apple", "primary school"]);
    if (!execute) return { total: 2, pending: 2, skipped: 0, generated: 0 };
    if (calls === 2) throw new Error("simulated network failure");
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(
      join(outputDirectory, "manifest.json"),
      JSON.stringify({
        version: 1,
        voice: "emily",
        speechRate: 0,
        entries: ["apple", "primary school"].map((english) => ({
          english,
          file: `${"a".repeat(64)}.wav`,
          sha256: "b".repeat(64),
          bytes: 100,
        })),
      }),
    );
    return { total: 2, pending: 2, skipped: 0, generated: 2 };
  };
  let builds = 0;
  const options = {
    inputPath,
    outputDirectory,
    generate,
    build: async () => builds++,
    log() {},
  };
  await importAliyunList(options);
  await assert.rejects(readFile(join(outputDirectory, "active-list.json")), {
    code: "ENOENT",
  });
  await assert.rejects(
    importAliyunList({ ...options, execute: true }),
    /network/,
  );
  await assert.rejects(readFile(join(outputDirectory, "active-list.json")), {
    code: "ENOENT",
  });
  const summary = await importAliyunList({ ...options, execute: true });
  assert.equal(summary.generated, 2);
  const published = JSON.parse(
    await readFile(join(outputDirectory, "active-list.json"), "utf8"),
  );
  assert.equal(published.version, 1);
  assert.match(published.source.id, /^cli-[a-f0-9]{64}$/);
  assert.deepEqual(
    published.source.groups[0].items.map((item) => item.english),
    ["Apple", "primary school"],
  );
  assert.equal(builds, 1);
  const manifest = JSON.parse(
    await readFile(join(outputDirectory, "manifest.json"), "utf8"),
  );
  assert.equal(
    validatePublishedSource(published, manifest).id,
    published.source.id,
  );
  manifest.entries.pop();
  assert.throws(() => validatePublishedSource(published, manifest), /覆盖/);
  await writeFile(
    join(outputDirectory, "manifest.json"),
    JSON.stringify(manifest),
  );
  await assert.rejects(
    importAliyunList({
      ...options,
      execute: true,
      generate: async () => ({
        total: 2,
        skipped: 2,
        pending: 0,
        generated: 0,
      }),
    }),
    /未覆盖/,
  );
  assert.equal(builds, 1);
  assert.deepEqual(
    JSON.parse(
      await readFile(join(outputDirectory, "active-list.json"), "utf8"),
    ),
    published,
  );
});
