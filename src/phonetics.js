import table from "./phonetics.json" with { type: "json" };

const keyOf = (english) => english.trim().replace(/\s+/g, " ").toLowerCase();

/** British IPA for a built-in word. Imported words with no entry stay blank. */
export function phoneticFor(english) {
  if (typeof english !== "string" || !english.trim()) return "";
  return table[keyOf(english)] || "";
}

/** Prefer an explicit phonetic, then the built-in table. Empty means show nothing. */
export function phoneticLabel(item) {
  const value = String(
    item?.phonetic || phoneticFor(item?.english) || "",
  ).trim();
  return value ? `/${value}/` : "";
}
