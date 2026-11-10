/**
 * Brings model citation styles to the one the UI renders: [S12].
 * gpt-oss models often write 【S12】 or 【S12†L1-L4】 (their browsing format), or pad tags with zero-width spaces
 * ([\u200bS12\u200b]); the UI would show all of these as plain text.
 */
const PAD = "[\\s\\u200b-\\u200d\\u2060\\ufeff]*";
const FULLWIDTH = new RegExp(`【${PAD}(S\\d+)(?:†[^】]*)?${PAD}】`, "g");
const PADDED = new RegExp(`\\[${PAD}(S\\d+)${PAD}\\]`, "g");

export function normalizeCitations(text: string): string {
  return text
    .replace(FULLWIDTH, "[$1]")
    .replace(PADDED, "[$1]")
    .replace(/\[(S\d+(?:\s*[,;]\s*S\d+)+)\]/g, (_m, group: string) =>
      group
        .split(/[,;]/)
        .map((t) => `[${t.trim()}]`)
        .join(""),
    );
}
