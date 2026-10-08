import test from "node:test";
import assert from "node:assert/strict";
import { loadSnapshot, saveSnapshot, defaultSnapshot } from "../src/storage.js";
import { builtinSource } from "../src/words.js";
import { createGlossary } from "../src/glossary.js";

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

test("old snapshots remain readable and command source marker is validated", () => {
  const old = defaultSnapshot(builtinSource);
  delete old.lastCliSourceId;
  delete old.lastCliAudioQuality;
  assert.equal(
    loadSnapshot({ getItem: () => JSON.stringify(old) }, builtinSource).error,
    null,
  );
  const next = defaultSnapshot(builtinSource);
  next.lastCliSourceId = `cli-${"a".repeat(64)}`;
  let saved;
  assert.equal(
    saveSnapshot({ setItem: (_key, value) => (saved = value) }, next),
    null,
  );
  assert.equal(JSON.parse(saved).lastCliSourceId, next.lastCliSourceId);
  next.lastCliAudioQuality = "premium";
  assert.equal(saveSnapshot({ setItem() {} }, next), null);
  next.lastCliAudioQuality = "invalid";
  assert.match(saveSnapshot({ setItem() {} }, next), /保存/);
  next.lastCliAudioQuality = "standard";
  next.lastCliSourceId = "../../invalid";
  assert.match(saveSnapshot({ setItem() {} }, next), /保存/);
});

test("records saved before the glossary still restore the built-in list and current words", () => {
  const old = defaultSnapshot(builtinSource);
  delete old.glossary;
  old.source = {
    id: "import-test",
    title: "新增",
    groups: [
      {
        label: "第 1 组",
        items: [{ id: "import-test:0:0", english: "apple", chinese: "苹果" }],
      },
    ],
  };
  old.mistakes = [];
  const loaded = loadSnapshot(
    { getItem: () => JSON.stringify(old) },
    builtinSource,
  );
  assert.equal(loaded.error, null);
  const items = loaded.snapshot.glossary.groups.flatMap((group) => group.items);
  assert.equal(items.length, 162);
  assert.equal(items.at(-1).english, "apple");
  assert.deepEqual(
    loaded.snapshot.glossary.groups.slice(0, 11).map((group) => group.label),
    createGlossary(builtinSource).groups.map((group) => group.label),
  );
});
