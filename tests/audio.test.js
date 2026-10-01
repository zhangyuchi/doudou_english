import test from "node:test";
import assert from "node:assert/strict";
import { BundledAudio, normalizeWord } from "../src/audio.js";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
function fixture() {
  const load = deferred(),
    decode = deferred();
  const sources = [];
  let resumes = 0,
    requests = 0,
    signal;
  const context = {
    state: "suspended",
    destination: {},
    resume() {
      resumes++;
      this.state = "running";
      return Promise.resolve();
    },
    decodeAudioData: () => decode.promise,
    createBufferSource() {
      const source = {
        connect() {},
        start() {
          this.started = true;
        },
        stop() {
          this.stopped = true;
        },
        disconnect() {},
      };
      sources.push(source);
      return source;
    },
  };
  const audio = new BundledAudio({
    catalog: [{ english: "primary school", file: "primary-school.wav" }],
    baseURL: "https://example.com/practice/audio/",
    contextFactory: () => context,
    fetch: (url, options) => {
      requests++;
      signal = options.signal;
      assert.equal(
        url,
        "https://example.com/practice/audio/primary-school.wav",
      );
      return load.promise;
    },
  });
  const finish = async () => {
    load.resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
    await new Promise((resolve) => setImmediate(resolve));
    decode.resolve({ duration: 1 });
    await new Promise((resolve) => setImmediate(resolve));
  };
  return {
    audio,
    context,
    load,
    decode,
    sources,
    finish,
    resumes: () => resumes,
    requests: () => requests,
    signal: () => signal,
  };
}
test("catalog lookup normalizes case, spaces and curly apostrophes consistently", () => {
  assert.equal(normalizeWord("  PRIMARY   school "), "primary school");
  assert.equal(normalizeWord("Let’s"), "let's");
  const f = fixture();
  assert.equal(f.audio.canPlay({ english: " PRIMARY  school " }), true);
  assert.equal(f.audio.canPlay({ english: "unknown" }), false);
});
test("audio unlock happens synchronously before loading, and only actual end completes", async () => {
  const f = fixture();
  let ended = 0;
  const playing = f.audio.play(
    { english: "PRIMARY school" },
    { onend: () => ended++, onerror: assert.fail },
  );
  assert.equal(f.resumes(), 1);
  await f.finish();
  await playing;
  assert.equal(f.sources[0].started, true);
  assert.equal(ended, 0);
  f.sources[0].onended();
  assert.equal(ended, 1);
  await f.audio.play(
    { english: "primary school" },
    { onend() {}, onerror: assert.fail },
  );
  assert.equal(f.requests(), 1);
});
test("recorded playback selects the media session before unlocking a muted iPad context", async (t) => {
  const previous = Object.getOwnPropertyDescriptor(navigator, "audioSession");
  const session = { type: "ambient" };
  Object.defineProperty(navigator, "audioSession", {
    value: session,
    configurable: true,
  });
  t.after(() => {
    if (previous) Object.defineProperty(navigator, "audioSession", previous);
    else delete navigator.audioSession;
  });
  const f = fixture();
  let ended = 0;
  let failure;
  f.audio.contextFactory = () => {
    assert.equal(
      session.type,
      "playback",
      "media routing precedes context creation",
    );
    return f.context;
  };
  f.context.resume = () => {
    assert.equal(
      session.type,
      "playback",
      "ambient audio is muted on this device",
    );
    f.context.state = "running";
    return Promise.resolve();
  };
  const playing = f.audio.play(
    { english: "primary school" },
    { onend: () => ended++, onerror: (error) => (failure = error) },
  );
  assert.equal(session.type, "playback");
  assert.equal(f.context.state, "running");
  await f.finish();
  await playing;
  assert.equal(failure, undefined);
  assert.equal(f.sources[0].started, true);
  assert.equal(ended, 0);
  f.sources[0].onended();
  assert.equal(ended, 1);
  session.type = "ambient";
  await f.audio.play(
    { english: "primary school" },
    { onend() {}, onerror: assert.fail },
  );
  assert.equal(session.type, "playback");
  assert.equal(f.requests(), 1);
});

test("a rejected media session reports failure without starting or completing audio", async (t) => {
  const previous = Object.getOwnPropertyDescriptor(navigator, "audioSession");
  Object.defineProperty(navigator, "audioSession", {
    value: {
      set type(value) {
        assert.equal(value, "playback");
        throw new Error("media session unavailable");
      },
    },
    configurable: true,
  });
  t.after(() => {
    if (previous) Object.defineProperty(navigator, "audioSession", previous);
    else delete navigator.audioSession;
  });
  const f = fixture();
  let failure;
  const playing = f.audio.play(
    { english: "primary school" },
    { onend: assert.fail, onerror: (error) => (failure = error) },
  );
  await f.finish();
  await playing;
  assert.match(failure.message, /media session unavailable/);
  assert.equal(f.audio.context, null);
  assert.equal(f.requests(), 0);
  assert.equal(f.sources.length, 0);
});
for (const stage of ["fetch", "decode"])
  test(`cancellation during ${stage} cannot produce late audio`, async () => {
    const f = fixture();
    let callbacks = 0;
    const playing = f.audio.play(
      { english: "primary school" },
      { onend: () => callbacks++, onerror: () => callbacks++ },
    );
    await new Promise((resolve) => setImmediate(resolve));
    if (stage === "decode") {
      f.load.resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
      await new Promise((resolve) => setImmediate(resolve));
    }
    f.audio.cancel();
    await f.finish();
    await playing;
    assert.equal(f.signal().aborted, true);
    assert.equal(f.sources.length, 0);
    assert.equal(callbacks, 0);
  });
test("cancellation stops playing source and detaches ended callback", async () => {
  const f = fixture();
  let ended = 0;
  const playing = f.audio.play(
    { english: "primary school" },
    { onend: () => ended++, onerror: assert.fail },
  );
  await f.finish();
  await playing;
  const old = f.sources[0].onended;
  f.audio.cancel();
  old();
  assert.equal(f.sources[0].stopped, true);
  assert.equal(f.sources[0].onended, null);
  assert.equal(ended, 0);
});
test("HTTP, decode and context failures report errors without completion", async () => {
  for (const stage of ["http", "decode", "resume"]) {
    const f = fixture();
    let failure;
    if (stage === "resume")
      f.context.resume = () => Promise.reject(new Error("blocked"));
    const playing = f.audio.play(
      { english: "primary school" },
      { onend: assert.fail, onerror: (error) => (failure = error) },
    );
    if (stage === "http") f.load.resolve({ ok: false, status: 404 });
    else await new Promise((resolve) => setImmediate(resolve));
    if (stage === "decode") {
      f.load.resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
      await new Promise((resolve) => setImmediate(resolve));
      f.decode.reject(new Error("bad audio"));
    }
    await playing;
    assert.ok(failure instanceof Error);
    assert.equal(f.sources.length, 0);
  }
});

test("a source that fails to start can still be cancelled and recovered", async () => {
  const f = fixture();
  let failure;
  f.context.createBufferSource = () => ({
    connect() {},
    start() {
      throw new Error("start failed");
    },
    stop() {
      throw new Error("not started");
    },
    disconnect() {},
  });
  const playing = f.audio.play(
    { english: "primary school" },
    {
      onend: assert.fail,
      onerror: (error) => {
        failure = error;
        f.audio.cancel();
      },
    },
  );
  await f.finish();
  await assert.doesNotReject(playing);
  assert.match(failure.message, /start failed/);
  assert.equal(f.audio.source, null);
});
