import test from "node:test";
import assert from "node:assert/strict";
import { loadSnapshot, saveSnapshot, defaultSnapshot } from "../src/storage.js";
import { builtinSource } from "../src/words.js";

test("a single snapshot restores settings, source and source-scoped mistakes", () => {
  let raw = null;
  const store = {
    getItem: () => raw,
    setItem: (k, v) => {
      raw = v;
    },
  };
  const snapshot = defaultSnapshot(builtinSource);
  snapshot.settings.repeat = 3;
  snapshot.settings.interval = 15;
  snapshot.mistakes = [builtinSource.groups[0].items[0].id];
  assert.equal(saveSnapshot(store, snapshot), null);
  assert.deepEqual(loadSnapshot(store, builtinSource).snapshot, snapshot);
});

test("damaged, unknown and out-of-range snapshots fall back visibly and do not overwrite", () => {
  for (const raw of [
    "{bad",
    JSON.stringify({ version: 99 }),
    JSON.stringify({
      ...defaultSnapshot(builtinSource),
      settings: { repeat: 8, interval: 10 },
    }),
  ]) {
    const store = {
      getItem: () => raw,
      setItem() {
        assert.fail("load must not overwrite");
      },
    };
    const result = loadSnapshot(store, builtinSource);
    assert.ok(result.error);
    assert.equal(result.snapshot.settings.repeat, 1);
    assert.equal(result.protected, true);
  }
});

test("storage quota and permissions fail explicitly while keeping in-memory data usable", () => {
  const store = {
    getItem() {
      throw new Error("permission");
    },
    setItem() {
      throw new Error("quota");
    },
  };
  assert.ok(loadSnapshot(store, builtinSource).error);
  assert.match(saveSnapshot(store, defaultSnapshot(builtinSource)), /保存/);
});

test("mistakes referring to another source cannot be restored", () => {
  const data = defaultSnapshot(builtinSource);
  data.mistakes = ["foreign:0:0"];
  assert.ok(
    loadSnapshot({ getItem: () => JSON.stringify(data) }, builtinSource).error,
  );
});
