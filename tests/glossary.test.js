import test from "node:test";
import assert from "node:assert/strict";
import { builtinSource, linkExtensions } from "../src/words.js";
import { createGlossary, mergeGlossary } from "../src/glossary.js";

const linked = linkExtensions(builtinSource.groups);
const items = linked.flatMap((group) => group.items);
const byEnglish = (english) => items.find((item) => item.english === english);

test("the original list stays intact and phrases point back at their headword", () => {
  assert.equal(items.length, 161);
  assert.equal(linked.length, 11);
  assert.equal(builtinSource.groups[0].items[0].extensionOf, undefined);
  assert.deepEqual(
    items.filter((item) => item.extensionOf).map((item) => item.english),
    ["in fact", "primary school", "pick up", "against the law", "throw away"],
  );
  assert.equal(byEnglish("in fact").extensionOf, "fact");
  assert.equal(byEnglish("primary school").extensionOf, "primary");
  assert.equal(byEnglish("pick up").extensionOf, "pick");
  assert.equal(byEnglish("against the law").extensionOf, "law");
  assert.equal(byEnglish("throw away").extensionOf, "throw");
  assert.deepEqual(
    byEnglish("fact").extensions.map((item) => item.english),
    ["in fact"],
  );
  assert.equal(byEnglish("without").extensionOf, "");
  assert.deepEqual(byEnglish("without").extensions, []);
  assert.equal(byEnglish("point out").extensionOf, "");
});

test("imports add new words and keep words already in the complete list", () => {
  const base = createGlossary(builtinSource);
  const first = mergeGlossary(base, {
    title: "本周新词",
    groups: [
      {
        label: "第 1 组",
        items: [
          { english: "apple", chinese: "苹果" },
          { english: "Without", chinese: "没有" },
          { english: "green apple", chinese: "青苹果" },
        ],
      },
    ],
  });
  const words = first.groups.flatMap((group) => group.items);
  assert.equal(words.length, 163);
  assert.equal(words[0].chinese, "缺乏，没有");
  assert.equal(first.groups.at(-1).label, "本周新词 · 第 1 组");
  assert.deepEqual(
    first.groups.at(-1).items.map((item) => item.english),
    ["apple", "green apple"],
  );
  const filled = mergeGlossary(
    {
      ...base,
      groups: base.groups.map((group) => ({
        ...group,
        items: group.items.map((item) =>
          item.english === "fact" ? { ...item, chinese: "" } : item,
        ),
      })),
    },
    {
      title: "补释义",
      groups: [
        { label: "第 1 组", items: [{ english: "fact", chinese: "事实" }] },
      ],
    },
  );
  assert.equal(filled.groups.flatMap((group) => group.items).length, 161);
  assert.equal(
    filled.groups
      .flatMap((group) => group.items)
      .find((item) => item.english === "fact").chinese,
    "事实",
  );
  const second = mergeGlossary(first, {
    title: "再来一批",
    groups: [
      {
        label: "第 1 组",
        items: [
          { english: "apple", chinese: "苹果" },
          { english: "pear", chinese: "梨" },
        ],
      },
    ],
  });
  assert.equal(second.groups.flatMap((group) => group.items).length, 164);
  assert.equal(second.groups.at(-1).label, "再来一批 · 第 1 组");
  assert.equal(second.groups.at(-1).items[0].english, "pear");
  assert.equal(base.groups.flatMap((group) => group.items).length, 161);
});
