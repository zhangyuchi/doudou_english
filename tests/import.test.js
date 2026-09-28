import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  extractPdfGroups,
  parseEditable,
  parseCsv,
  toEditable,
} from "../src/import.js";

test("the real vocabulary PDF retains 11 groups, 161 items and whole phrases", async () => {
  const data = new Uint8Array(
    await readFile(
      new URL(
        "../public/examples/外研社7年级英语听写分组.pdf",
        import.meta.url,
      ),
    ),
  );
  const task = getDocument({ data });
  const doc = await task.promise;
  try {
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++)
      pages.push((await (await doc.getPage(i)).getTextContent()).items);
    const groups = extractPdfGroups(pages);
    assert.deepEqual(
      groups.map((g) => g.items.length),
      [10, 15, 15, 15, 15, 15, 15, 15, 15, 15, 16],
    );
    assert.equal(groups[0].items[2].english, "point out");
    assert.equal(groups[2].items[0].english, "primary school");
    assert.equal(groups[8].items[12].english, "against the law");
    assert.equal(groups[10].items[15].english, "firework");
    assert.match(groups[0].items[0].chinese, /缺乏/);
    assert.equal(
      parseEditable(toEditable(groups)).flatMap((g) => g.items).length,
      161,
    );
  } finally {
    await task.destroy();
  }
});

test("a page with only numbers and no vocabulary is rejected", () => {
  assert.throws(
    () =>
      extractPdfGroups([
        [{ str: "1. 2. 3.", transform: [1, 0, 0, 1, 0, 100], height: 10 }],
      ]),
    /词表/,
  );
});

test("editable text preserves phrases, duplicate words, optional translations and groups", () => {
  const groups = parseEditable(
    "point out\t指出\nword\t词\nword\t单词\n\nprimary school\t小学\nhello",
  );
  assert.deepEqual(
    groups.map((g) => g.items.length),
    [3, 2],
  );
  assert.equal(groups[0].items[0].english, "point out");
  assert.equal(groups[1].items[1].chinese, "");
  assert.throws(() => parseEditable("中文内容"), /英文/);
});

test("CSV supports quoted commas and explicit groups without treating text as HTML", () => {
  const groups = parseCsv(
    'english,chinese,group\n"point out","指出,指明",1\nhello,"<img src=x onerror=alert(1)>",2',
  );
  assert.deepEqual(
    groups.map((g) => g.items.length),
    [1, 1],
  );
  assert.equal(groups[0].items[0].chinese, "指出,指明");
  assert.match(groups[1].items[0].chinese, /<img/);
  assert.throws(() => parseCsv('english,chinese\n"hello,你好'), /引号/);
});
