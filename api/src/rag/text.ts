const STOPWORDS = new Set(
  "a an and are as at be but by can could do does did for from had has have how i if in into is it its me my of on or our so than that the their them then there these they this to up us was we were what when where which who why will with would you your about after all any been being both each few more most other some such only own same too very just not no nor".split(" "),
);

/** Lowercased alphanumeric terms without stopwords. */
export function queryTerms(text: string): string[] {
  const terms = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
  return [...new Set(terms)];
}

/** Builds a safe OR tsquery (`a | b | c`) from free text, or null when nothing is searchable. */
export function toTsQuery(text: string): string | null {
  const terms = queryTerms(text);
  return terms.length ? terms.join(" | ") : null;
}
