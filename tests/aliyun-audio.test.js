import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import {
  generateAudio,
  readWords,
  createTokenProvider,
} from "../scripts/generate-aliyun-audio.mjs";

function wav() {
  const data = Buffer.alloc(364);
  data.write("RIFF");
  data.writeUInt32LE(data.length - 8, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(16000, 24);
  data.writeUInt32LE(32000, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(320, 40);
  data.writeInt16LE(1000, 44);
  return data;
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "aliyun-audio-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const requests = [];
  const options = {
    words: ["Apple", "apple", "primary school"],
    outputDirectory: join(root, "audio"),
    execute: true,
    env: {
      ALIYUN_NLS_APPKEY: "private-appkey",
      ALIYUN_NLS_TOKEN: "private-token",
    },
    fetch: async (url, init) => {
      requests.push({ url, ...init });
      return new Response(wav(), { headers: { "Content-Type": "audio/mpeg" } });
    },
    log() {},
  };
  return { root, options, requests };
}

test("TXT/CSV lists preserve complete phrases and reuse browser normalization", async (t) => {
  const f = await fixture(t);
  const txt = join(f.root, "words.txt"),
    csv = join(f.root, "words.csv");
  await writeFile(
    txt,
    "\ufeffApple\t苹果\n\nprimary school\t小学\napple\t苹果\n",
  );
  await writeFile(
    csv,
    'english,chinese,group\nApple,苹果,1\nprimary school,"小学,学校",2\n',
  );
  assert.deepEqual(await readWords(txt), ["apple", "primary school"]);
  assert.deepEqual(await readWords(csv), ["apple", "primary school"]);
  await writeFile(txt, "../../secret\n");
  await assert.rejects(readWords(txt), /英文/);
});

test("preview needs no credentials, makes no requests and writes no files", async (t) => {
  const f = await fixture(t);
  const summary = await generateAudio({
    ...f.options,
    execute: false,
    env: {},
  });
  assert.deepEqual(summary, { total: 2, skipped: 0, pending: 2, generated: 0 });
  assert.equal(f.requests.length, 0);
  await assert.rejects(
    readFile(join(f.options.outputDirectory, "manifest.json")),
    { code: "ENOENT" },
  );
});

test("generation POSTs a whole word or phrase and saves a secret-free, resumable catalog", async (t) => {
  const f = await fixture(t);
  const summary = await generateAudio(f.options);
  assert.equal(summary.generated, 2);
  assert.equal(f.requests.length, 2);
  assert.equal(
    f.requests[0].url,
    "https://nls-gateway-cn-shanghai.aliyuncs.com/stream/v1/tts",
  );
  assert.equal(f.requests[0].method, "POST");
  assert.equal(f.requests[0].headers["X-NLS-Token"], "private-token");
  assert.deepEqual(JSON.parse(f.requests[1].body), {
    appkey: "private-appkey",
    text: "primary school",
    voice: "emily",
    format: "wav",
    sample_rate: 16000,
    speech_rate: 0,
  });
  const raw = await readFile(
    join(f.options.outputDirectory, "manifest.json"),
    "utf8",
  );
  assert.doesNotMatch(raw, /private-|token|appkey/i);
  const manifest = JSON.parse(raw);
  assert.equal(manifest.entries.length, 2);
  assert.equal(manifest.voice, "emily");
  assert.deepEqual(
    await readFile(join(f.options.outputDirectory, manifest.entries[0].file)),
    wav(),
  );
  const resumed = await generateAudio({ ...f.options, env: {} });
  assert.equal(resumed.skipped, 2);
  assert.equal(resumed.generated, 0);
  assert.equal(f.requests.length, 2);
});

test("corrupted saved audio is regenerated, but changing voice never overwrites the catalog", async (t) => {
  const f = await fixture(t);
  await generateAudio(f.options);
  const manifest = JSON.parse(
    await readFile(join(f.options.outputDirectory, "manifest.json"), "utf8"),
  );
  await writeFile(
    join(f.options.outputDirectory, manifest.entries[0].file),
    "broken",
  );
  assert.equal((await generateAudio(f.options)).generated, 1);
  await assert.rejects(generateAudio({ ...f.options, voice: "eric" }), /配置/);
  assert.equal(f.requests.length, 3);
});

test("an API JSON error stops without publishing it as audio and keeps prior successful words", async (t) => {
  const f = await fixture(t);
  let calls = 0;
  await assert.rejects(
    generateAudio({
      ...f.options,
      fetch: async () =>
        ++calls === 1
          ? new Response(wav(), { headers: { "Content-Type": "audio/mpeg" } })
          : new Response(
              JSON.stringify({
                status: 40000001,
                message: "private-token private-appkey",
              }),
              { headers: { "Content-Type": "application/json" } },
            ),
    }),
    (error) => {
      assert.match(error.message, /primary school.*40000001/);
      assert.doesNotMatch(error.message, /private-/);
      return true;
    },
  );
  const manifest = JSON.parse(
    await readFile(join(f.options.outputDirectory, "manifest.json"), "utf8"),
  );
  assert.deepEqual(
    manifest.entries.map((entry) => entry.english),
    ["apple"],
  );
  const resumed = await generateAudio(f.options);
  assert.equal(resumed.generated, 1);
  assert.equal(resumed.skipped, 1);
});

test("HTML or JSON with an audio MIME and aborted requests cannot enter the manifest", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    generateAudio({
      ...f.options,
      fetch: async () =>
        new Response("not a WAV", {
          headers: { "Content-Type": "audio/mpeg" },
        }),
    }),
    /WAV/,
  );
  await assert.rejects(
    readFile(join(f.options.outputDirectory, "manifest.json")),
    { code: "ENOENT" },
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    generateAudio({ ...f.options, signal: controller.signal }),
  );
  assert.equal(f.requests.length, 0);
});

test("single-writer lock and unknown manifest paths are rejected before paid requests", async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.options.outputDirectory, ".generate.lock"), {
    recursive: true,
  });
  await assert.rejects(generateAudio(f.options), /另一个|锁/);
  await rm(join(f.options.outputDirectory, ".generate.lock"), {
    recursive: true,
  });
  await writeFile(
    join(f.options.outputDirectory, "manifest.json"),
    JSON.stringify({
      version: 1,
      voice: "emily",
      speechRate: 0,
      entries: [{ english: "apple", file: "../secret.wav" }],
    }),
  );
  await assert.rejects(generateAudio(f.options), /清单/);
  assert.equal(f.requests.length, 0);
});

test("Token requests are cached and refreshed according to the actual expiry", async () => {
  let time = 100000,
    calls = 0;
  const getToken = createTokenProvider({
    env: { ALIYUN_AK_ID: "private-id", ALIYUN_AK_SECRET: "private-secret" },
    now: () => time,
    createToken: async () => ({
      Token: { Id: `token-${++calls}`, ExpireTime: 200 },
    }),
  });
  assert.equal(await getToken(), "token-1");
  assert.equal(await getToken(), "token-1");
  time = 180000;
  assert.equal(await getToken(), "token-2");
  assert.equal(calls, 2);
});

test("invalid PCM fields and RIFF lengths never count as saved or reusable audio", async (t) => {
  const f = await fixture(t);
  for (const [offset, value, width] of [
    [22, 0, 2],
    [24, 0, 4],
    [34, 0, 2],
    [32, 1, 2],
    [28, 1, 4],
    [4, 1, 4],
  ]) {
    const invalid = wav();
    if (width === 2) invalid.writeUInt16LE(value, offset);
    else invalid.writeUInt32LE(value, offset);
    await assert.rejects(
      generateAudio({
        ...f.options,
        fetch: async () =>
          new Response(invalid, { headers: { "Content-Type": "audio/mpeg" } }),
      }),
      /WAV/,
    );
  }
  await assert.rejects(
    readFile(join(f.options.outputDirectory, "manifest.json")),
    { code: "ENOENT" },
  );
});

test("Token SDK failures expose only a safe code, never request details or credentials", async () => {
  const getToken = createTokenProvider({
    env: { ALIYUN_AK_ID: "private-id", ALIYUN_AK_SECRET: "private-secret" },
    createToken: async () => {
      throw Object.assign(new Error("private-secret signed-url"), {
        code: "SignatureDoesNotMatch",
      });
    },
  });
  await assert.rejects(getToken(), (error) => {
    assert.match(error.message, /SignatureDoesNotMatch/);
    assert.doesNotMatch(error.message, /private-|signed-url/);
    return true;
  });
});

test("SDK HTTP debug logging cannot disclose credentials or successful Token responses", async (t) => {
  const server = createServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        Token: {
          Id: "private-token",
          ExpireTime: Math.floor(Date.now() / 1000) + 3600,
        },
      }),
    );
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => new Promise((done) => server.close(done)));
  const code = `
    import {createRequire} from 'node:module';
    import assert from 'node:assert/strict';
    import {createTokenProvider} from './scripts/generate-aliyun-audio.mjs';
    const require = createRequire(import.meta.url);
    const sdk = require('@alicloud/pop-core');
    const sdkRequire = createRequire(require.resolve('@alicloud/pop-core'));
    const httpx = sdkRequire('httpx');
    const httpRequire = createRequire(sdkRequire.resolve('httpx'));
    const loggers = [sdkRequire('debug'), httpRequire('debug')];
    const probes = loggers.map(logger => logger('restoration-probe'));
    const enabledBefore = probes.map(probe => probe.enabled);
    sdk.RPCClient.prototype.request = async () => {
      const response = await httpx.request('http://127.0.0.1:${server.address().port}/', {method:'POST', data:'private-id private-secret'});
      return JSON.parse(await httpx.read(response, 'utf8'));
    };
    const token = await createTokenProvider({env:{ALIYUN_AK_ID:'private-id',ALIYUN_AK_SECRET:'private-secret'}})();
    assert.deepEqual(probes.map(probe => probe.enabled), enabledBefore);
    console.log('acquired:', Boolean(token));
  `;
  const result = await promisify(execFile)(
    process.execPath,
    ["--input-type=module", "-e", code],
    { cwd: resolve("."), env: { ...process.env, DEBUG: "*" } },
  );
  assert.match(result.stdout, /acquired: true/);
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /private-id|private-secret|private-token/,
  );
});
