import { describe, expect, it } from "vitest";
import { chunkMarkdown } from "../src/rag/chunker.js";
import { rerank } from "../src/rag/rerank.js";
import { reciprocalRankFusion } from "../src/rag/rrf.js";
import { queryTerms, toTsQuery } from "../src/rag/text.js";

describe("reciprocal rank fusion", () => {
  it("scores 1/(k+rank) per list and sums them", () => {
    const fused = reciprocalRankFusion(
      [
        { name: "fts", ids: [1, 2, 3] },
        { name: "vector", ids: [3, 1, 4] },
      ],
      60,
    );
    const byId = Object.fromEntries(fused.map((f) => [f.id, f]));
    expect(byId[1]!.score).toBeCloseTo(1 / 61 + 1 / 62, 10);
    expect(byId[3]!.score).toBeCloseTo(1 / 63 + 1 / 61, 10);
    expect(byId[2]!.ranks).toEqual({ fts: 2 });
    expect(byId[4]!.ranks).toEqual({ vector: 3 });
  });

  it("puts an item found by both retrievers above items found by one", () => {
    const fused = reciprocalRankFusion([
      { name: "fts", ids: [10, 11] },
      { name: "vector", ids: [12, 11] },
    ]);
    expect(fused[0]!.id).toBe(11);
  });

  it("is deterministic on ties and handles empty input", () => {
    expect(reciprocalRankFusion([])).toEqual([]);
    const a = reciprocalRankFusion([{ name: "a", ids: [5] }, { name: "b", ids: [4] }]);
    expect(a.map((x) => x.id)).toEqual([4, 5]);
  });
});

describe("rerank", () => {
  const items = [
    { id: 1, title: "Shipping", content: "Delivery takes five days", fusedScore: 0.032 },
    { id: 2, title: "Returns", content: "Customers can return keyboards within 30 days of delivery", fusedScore: 0.03 },
  ];
  it("promotes the passage that covers the query terms and phrase", () => {
    const out = rerank("return keyboards within 30 days", items, 2);
    expect(out[0]!.item.id).toBe(2);
  });
  it("respects topK", () => {
    expect(rerank("delivery", items, 1)).toHaveLength(1);
  });
});

describe("text helpers", () => {
  it("drops stopwords and builds an OR tsquery", () => {
    expect(queryTerms("What is the return policy?")).toEqual(["return", "policy"]);
    expect(toTsQuery("What is the return policy?")).toBe("return | policy");
    expect(toTsQuery("the and of")).toBeNull();
  });
  it("never lets tsquery operators through", () => {
    expect(toTsQuery("aa' | bb & !cc:*")).toBe("aa | bb | cc");
  });
});

describe("chunker", () => {
  it("prefixes chunks with title and nearest heading", () => {
    const chunks = chunkMarkdown("Guide", "# Guide\n\n## Alpha\n\nfirst para\n\n## Beta\n\nsecond para");
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.content).toBe("Guide > Alpha\nfirst para");
    expect(chunks[1]!.content).toBe("Guide > Beta\nsecond para");
  });
  it("splits long paragraphs", () => {
    const long = "Sentence number one is here. ".repeat(80);
    const chunks = chunkMarkdown("T", long, { maxChars: 300 });
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((c) => c.content.length < 400)).toBe(true);
  });
});
