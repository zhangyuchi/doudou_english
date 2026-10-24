import Papa from "papaparse";

const MAX_ITEMS = 2000;
const ENGLISH = /^[A-Za-z]+(?:[\s'’.-][A-Za-z]+)*$/;

/** Validate and number a parsed word list; invalid input never reaches saved state. */
export function validateGroups(groups) {
  const clean = groups
    .filter((g) => g.items.length)
    .map((group, index) => ({
      label: group.label || `第 ${index + 1} 组`,
      items: group.items.map((item) => {
        const english = String(item.english || "")
          .trim()
          .replace(/\s+/g, " ");
        const chinese = String(item.chinese || "").trim();
        if (!ENGLISH.test(english) || english.length > 100)
          throw new Error(`请检查英文项：${english || "空白项"}`);
        if (chinese.length > 500)
          throw new Error("单项释义过长，请缩短后导入。");
        return { english, chinese };
      }),
    }));
  const count = clean.reduce((n, g) => n + g.items.length, 0);
  if (!count) throw new Error("没有识别到英文词表，请导入含单词的文件。");
  if (count > MAX_ITEMS) throw new Error("每次最多导入 2000 项，请拆分文件。");
  return clean;
}

/** Parse editable one-item-per-line text, keeping phrases and blank-line groups intact. */
export function parseEditable(text) {
  const groups = [];
  let items = [];
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      if (items.length) {
        groups.push({ items });
        items = [];
      }
      continue;
    }
    let english, chinese;
    if (line.includes("\t")) [english, ...chinese] = line.split("\t");
    else {
      const match = line.match(/^([A-Za-z]+(?:[ '’.-][A-Za-z]+)*)\s*(.*)$/);
      if (!match) throw new Error(`这一行未识别到英文：${line}`);
      english = match[1];
      chinese = [match[2]];
    }
    items.push({ english, chinese: chinese.join("\t") });
  }
  if (items.length) groups.push({ items });
  return validateGroups(groups);
}

/** Render groups as editable tab-separated text; blank lines preserve group boundaries. */
export function toEditable(groups) {
  return groups
    .map((g) => g.items.map((i) => `${i.english}\t${i.chinese}`).join("\n"))
    .join("\n\n");
}

/** Read quoted CSV using PapaParse and optionally preserve its group column. */
export function parseCsv(text) {
  const parsed = Papa.parse(text.replace(/^\uFEFF/, ""), {
    skipEmptyLines: "greedy",
  });
  if (parsed.errors.length)
    throw new Error("CSV 格式错误，请检查分隔符或未闭合的引号。");
  const rows = parsed.data;
  const first = rows[0]?.map((s) => s.trim().toLowerCase()) || [];
  const hasHeader = ["english", "英文", "单词", "word"].includes(first[0]);
  if (hasHeader) rows.shift();
  const groups = [];
  for (const row of rows) {
    if (row.length > 3)
      throw new Error(
        "CSV 应为英文、中文、组号三列；释义中的逗号请用引号包住。",
      );
    const label = row[2]?.trim() || "导入词表";
    let group = groups.find((g) => g.label === label);
    if (!group) {
      group = { label, items: [] };
      groups.push(group);
    }
    group.items.push({ english: row[0], chinese: row[1] || "" });
  }
  return validateGroups(groups);
}

/** Split a multi-entry PDF row at English tokens while keeping Chinese meanings together. */
function rowItems(text) {
  const items = [];
  const pattern = /([A-Za-z]+(?:[ \t'’.-][A-Za-z]+)*)([^A-Za-z]*)/g;
  for (const match of text.matchAll(pattern)) {
    if (/[\u3400-\u9fff]/.test(match[2]))
      items.push({ english: match[1], chinese: match[2].trim() });
  }
  return items;
}

/**
 * Recover row order and visible groups from PDF.js text coordinates.
 * This targets text-layer bilingual lists; ambiguous layouts remain editable before use.
 */
export function extractPdfGroups(pages) {
  const groups = [];
  for (const page of pages) {
    const sorted = page
      .filter((x) => x.str?.trim() && x.transform)
      .sort(
        (a, b) =>
          b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4],
      );
    const rows = [];
    for (const item of sorted) {
      let row = rows.find((r) => Math.abs(r.y - item.transform[5]) < 3);
      if (!row) {
        row = { y: item.transform[5], parts: [] };
        rows.push(row);
      }
      row.parts.push(item);
    }
    const lines = rows
      .map((row) => ({
        y: row.y,
        items: rowItems(
          row.parts
            .sort((a, b) => a.transform[4] - b.transform[4])
            .map((x) => x.str)
            .join(" "),
        ),
      }))
      .filter((r) => r.items.length);
    const gaps = lines
      .slice(1)
      .map((r, i) => lines[i].y - r.y)
      .filter((x) => x > 3)
      .sort((a, b) => a - b);
    const typical = gaps.length
      ? gaps[Math.floor((gaps.length - 1) / 2)]
      : Infinity;
    let current = [];
    for (let i = 0; i < lines.length; i++) {
      if (i && lines[i - 1].y - lines[i].y > typical * 1.45) {
        groups.push({ items: current });
        current = [];
      }
      current.push(...lines[i].items);
    }
    if (current.length) groups.push({ items: current });
  }
  return validateGroups(groups);
}

/** Regroup an existing list without changing its order or item content. */
export function regroup(groups, size = 15) {
  const items = groups.flatMap((g) => g.items);
  const result = [];
  for (let i = 0; i < items.length; i += size)
    result.push({
      label: `第 ${result.length + 1} 组`,
      items: items.slice(i, i + size),
    });
  return result;
}

/** Give every occurrence its own stable ID within a newly confirmed source. */
export function makeSource(groups, title, id) {
  return {
    id,
    title,
    groups: validateGroups(groups).map((g, gi) => ({
      ...g,
      items: g.items.map((item, i) => ({ ...item, id: `${id}:${gi}:${i}` })),
    })),
  };
}
