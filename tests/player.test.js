import test from "node:test";
import assert from "node:assert/strict";
import { DictationPlayer } from "../src/player.js";

function fixture(repeat = 1, interval = 10) {
  let time = 0,
    id = 0;
  const tasks = new Map();
  const spoken = [];
  const synth = { speak: (u) => spoken.push(u), cancel() {} };
  const timers = {
    now: () => time,
    setTimeout: (fn, ms) => {
      tasks.set(++id, { at: time + ms, fn });
      return id;
    },
    clearTimeout: (id) => tasks.delete(id),
  };
  const player = new DictationPlayer({
    synth,
    createUtterance: (text) => ({ text }),
    timers,
    onChange() {},
  });
  player.setQueue([
    { id: "1", english: "hello" },
    { id: "2", english: "point out" },
  ]);
  player.configure({ repeat, interval, voice: { lang: "en-GB" } });
  const advance = (ms) => {
    const end = time + ms;
    for (;;) {
      const entry = [...tasks]
        .filter(([, t]) => t.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry) break;
      time = entry[1].at;
      tasks.delete(entry[0]);
      entry[1].fn();
    }
    time = end;
  };
  return { player, spoken, advance, end: () => spoken.at(-1).onend() };
}

for (const repeat of [1, 2, 3])
  test(`${repeat} readings finish before the writing interval begins`, () => {
    const f = fixture(repeat);
    f.player.start();
    assert.equal(f.player.state.phase, "speaking");
    for (let i = 1; i <= repeat; i++) {
      assert.equal(f.spoken.length, i);
      f.end();
      if (i < repeat) {
        assert.equal(f.player.state.phase, "repeat-gap");
        f.advance(999);
        assert.equal(f.spoken.length, i);
        f.advance(1);
      }
    }
    assert.equal(f.player.state.phase, "writing-gap");
    f.advance(9999);
    assert.equal(f.player.state.index, 0);
    f.advance(1);
    assert.equal(f.player.state.index, 1);
    for (let i = 1; i <= repeat; i++) {
      f.end();
      if (i < repeat) f.advance(1000);
    }
    f.advance(9999);
    assert.notEqual(f.player.state.phase, "complete");
    f.advance(1);
    assert.equal(f.player.state.phase, "complete");
  });

test("pause freezes a countdown and resumes its exact remaining time", () => {
  const f = fixture();
  f.player.start();
  f.end();
  f.advance(3000);
  f.player.pause();
  f.advance(20000);
  assert.equal(f.player.state.index, 0);
  f.player.resume();
  f.advance(6999);
  assert.equal(f.player.state.index, 0);
  f.advance(1);
  assert.equal(f.player.state.index, 1);
});

test("stale completion after replay or stop cannot advance the queue", () => {
  const f = fixture();
  f.player.start();
  const old = f.spoken[0];
  f.player.replay();
  old.onend();
  assert.equal(f.player.state.phase, "speaking");
  assert.equal(f.spoken.length, 2);
  f.player.stop();
  f.spoken.at(-1).onend();
  f.advance(20000);
  assert.equal(f.player.state.phase, "idle");
  assert.equal(f.spoken.length, 2);
});

test("speech pause and resume rereads the interrupted word without counting it twice", () => {
  const f = fixture(2);
  f.player.start();
  const old = f.spoken[0];
  f.player.pause();
  old.onend();
  f.player.resume();
  assert.equal(f.spoken.length, 2);
  f.end();
  f.advance(1000);
  assert.equal(f.spoken.length, 3);
  f.end();
  assert.equal(f.player.state.phase, "writing-gap");
});

test("errors and unavailable or American voices never silently advance", () => {
  const f = fixture();
  f.player.configure({ voice: { lang: "en-US" } });
  f.player.start();
  assert.equal(f.spoken.length, 0);
  assert.equal(f.player.state.phase, "error");
  f.player.configure({ voice: { lang: "en-GB" } });
  f.player.start();
  f.spoken.at(-1).onerror({ error: "network" });
  f.advance(20000);
  assert.equal(f.player.state.index, 0);
  assert.equal(f.player.state.phase, "error");
});

test("changing queue or settings cancels waiting and old speech", () => {
  const f = fixture();
  f.player.start();
  f.end();
  f.advance(2000);
  f.player.pause();
  f.player.configure({ repeat: 3, interval: 15 });
  assert.equal(f.player.state.phase, "idle");
  f.player.setQueue([{ id: "new", english: "new" }]);
  f.advance(20000);
  assert.equal(f.spoken.length, 1);
  f.player.start();
  assert.equal(f.spoken.at(-1).text, "new");
});

test("replay after completion repeats the last word rather than restarting the group", () => {
  const f = fixture();
  f.player.start();
  f.end();
  f.advance(10000);
  f.end();
  f.advance(10000);
  assert.equal(f.player.state.phase, "complete");
  f.player.replay();
  assert.equal(f.spoken.at(-1).text, "point out");
  assert.equal(f.player.state.index, 1);
});

test("a silent speech-engine failure surfaces without advancing", () => {
  const f = fixture();
  f.player.start();
  f.advance(30000);
  assert.equal(f.player.state.phase, "error");
  assert.equal(f.player.state.index, 0);
  assert.equal(f.spoken.length, 1);
});

function audioFixture(repeat = 1) {
  const f = fixture(repeat);
  const clips = [];
  let cancelled = 0;
  f.player.audio = {
    canPlay: (item) => item.english !== "unknown",
    play: (item, callbacks) => clips.push({ item, ...callbacks }),
    cancel: () => cancelled++,
    unlock() {},
  };
  f.player.configure({ voice: { lang: "en-GB", recorded: true } });
  return { ...f, clips, cancelled: () => cancelled };
}

test("bundled audio works without an operating-system speech engine and waits for real completion", () => {
  const f = audioFixture(2);
  f.player.synth = null;
  f.player.start();
  assert.equal(f.clips.length, 1);
  assert.equal(f.spoken.length, 0);
  f.advance(2000);
  assert.equal(f.player.state.phase, "speaking");
  f.clips[0].onend();
  assert.equal(f.player.state.phase, "repeat-gap");
  f.advance(1000);
  assert.equal(f.clips.length, 2);
  f.clips[1].onend();
  assert.equal(f.player.state.phase, "writing-gap");
  f.advance(9999);
  assert.equal(f.player.state.index, 0);
  f.advance(1);
  assert.equal(f.clips[2].item.english, "point out");
});

test("cancelled audio callbacks and playback failures cannot advance or switch to system speech", () => {
  const f = audioFixture();
  f.player.start();
  assert.equal(f.clips.length, 1);
  const old = f.clips[0];
  f.player.replay();
  old.onend();
  assert.equal(f.player.state.phase, "speaking");
  f.clips[1].onerror(new Error("404"));
  assert.equal(f.player.state.phase, "error");
  f.advance(30000);
  assert.equal(f.player.state.index, 0);
  assert.equal(f.spoken.length, 0);
  assert.ok(f.cancelled() > 0);
});

test("audio preview preserves the selected queue, position and dictation settings", () => {
  const f = audioFixture(3);
  f.player.move(1);
  assert.equal(typeof f.player.preview, "function");
  f.player.preview({ english: "guitar" });
  assert.equal(f.clips[0].item.english, "guitar");
  f.clips[0].onend();
  assert.equal(f.player.state.phase, "idle");
  assert.equal(f.player.state.index, 1);
  assert.equal(f.player.settings.repeat, 3);
  assert.equal(f.player.settings.interval, 10);
  f.player.start();
  assert.equal(f.clips[1].item.english, "point out");
  f.clips[1].onend();
  assert.equal(f.player.state.phase, "repeat-gap");
});

test("starting during an audio preview cancels it and begins the selected dictation item", () => {
  const f = audioFixture();
  assert.equal(typeof f.player.preview, "function");
  f.player.preview({ english: "guitar" });
  const old = f.clips[0];
  f.player.start();
  old.onend();
  assert.equal(f.clips[1].item.english, "hello");
  assert.equal(f.player.state.phase, "speaking");
});

test("a missing bundled clip blocks the whole session before playing any item", () => {
  const f = audioFixture();
  f.player.setQueue([{ english: "hello" }, { english: "unknown" }]);
  f.player.start();
  assert.equal(f.player.state.phase, "error");
  assert.match(f.player.state.error, /预置英音/);
  assert.equal(f.clips.length, 0);
  assert.equal(f.spoken.length, 0);
});

test("preview is unavailable while a countdown is paused and cannot discard its remaining time", () => {
  const f = audioFixture();
  f.player.start();
  f.clips[0].onend();
  f.advance(3000);
  f.player.pause();
  f.player.preview({ english: "guitar" });
  assert.equal(f.clips.length, 1);
  assert.equal(f.player.state.phase, "paused");
  assert.equal(f.player.state.remaining, 7000);
  f.advance(5000);
  f.player.resume();
  f.advance(6999);
  assert.equal(f.clips.length, 1);
  f.advance(1);
  assert.equal(f.clips.length, 2);
});
