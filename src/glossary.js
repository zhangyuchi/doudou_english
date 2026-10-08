const GLOSSARY_ID = "glossary-v1";

const normalizeEnglish = (english) =>
  english.trim().replace(/\s+/g, " ").toLowerCase();

/** Copy the built-in list into the cumulative glossary without sharing its ids. */
export function createGlossary(builtin) {
  let nextItem = 0;
  return {
    id: GLOSSARY_ID,
    title: "完整词表",
    nextItem: builtin.groups.reduce(
      (count, group) => count + group.items.length,
      0,
    ),
    groups: builtin.groups.map((group) => ({
      label: group.label,
      items: group.items.map((item) => ({
        english: item.english,
        chinese: item.chinese || "",
        id: `${GLOSSARY_ID}:${nextItem++}`,
      })),
    })),
  };
}

/**
 * Append words that are not already in the glossary.
 * An existing entry keeps its meaning; a later import can only fill a blank one.
 */
export function mergeGlossary(glossary, incoming) {
  const groups = glossary.groups.map((group) => ({
    label: group.label,
    items: group.items.map((item) => ({ ...item })),
  }));
  const seen = new Map();
  for (const group of groups)
    for (const item of group.items)
      seen.set(normalizeEnglish(item.english), item);
  let nextItem =
    glossary.nextItem ??
    groups.reduce((count, group) => count + group.items.length, 0);
  for (const group of incoming.groups || []) {
    const fresh = [];
    for (const item of group.items || []) {
      const english = String(item.english || "")
        .trim()
        .replace(/\s+/g, " ");
      if (!english) continue;
      const key = normalizeEnglish(english);
      const existing = seen.get(key);
      const chinese = String(item.chinese || "").trim();
      if (existing) {
        if (!existing.chinese && chinese) existing.chinese = chinese;
        continue;
      }
      const created = {
        english,
        chinese,
        id: `${glossary.id}:${nextItem++}`,
      };
      seen.set(key, created);
      fresh.push(created);
    }
    if (!fresh.length) continue;
    const label = incomingLabel(incoming.title, group.label);
    let target = groups.find((entry) => entry.label === label);
    if (!target) {
      target = { label, items: [] };
      groups.push(target);
    }
    target.items.push(...fresh);
  }
  return { ...glossary, nextItem, groups };
}

function incomingLabel(title, label) {
  const name = String(title || "").trim();
  const group = String(label || "").trim() || "导入词表";
  if (!name || name === group) return group;
  return `${name} · ${group}`;
}
