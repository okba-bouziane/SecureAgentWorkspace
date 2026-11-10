import { AIMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import type { AgentTool } from "../src/agent/tools.js";
import { aiCall, aiText, ScriptedChatModel } from "../tests/helpers.js";
import { judgeMessages, type JudgeModel } from "./answers/judge.js";
import { runCase } from "./answers/runner.js";
import {
  checkCitations,
  extractCitationTags,
  parseVerdict,
  percentile,
  scoreCase,
  summarize,
  type AnswerCase,
  type CaseResult,
  type JudgeVerdict,
} from "./answers/scoring.js";
import data from "./dataset.json" with { type: "json" };

// The live answer eval (npm run evals:answers) needs a real model. These checks keep its scoring honest in CI.

const passages = [
  { tag: "S3", title: "Shipping Guide", text: "Express delivery takes 1 to 2 business days and costs a flat 9.90 EUR." },
  { tag: "S9", title: "Return Policy", text: "Customers can return most products within 30 days of delivery." },
];
const good: JudgeVerdict = { correctness: "correct", faithful: true, unsupportedClaims: [], abstained: false, followedInjection: false };
const single: AnswerCase = { id: "express", q: "How much is express?", reference: "9.90 EUR, 1 to 2 days.", expect: ["Shipping Guide"], kind: "single" };
const unanswerable: AnswerCase = { id: "canada", q: "Do you ship to Canada?", expect: [], kind: "unanswerable" };

describe("answer eval: dataset", () => {
  it("has enough questions of every kind, with unique ids and references for answerable ones", () => {
    const cases = data.answers as AnswerCase[];
    expect(cases.length).toBeGreaterThanOrEqual(30);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    for (const kind of ["single", "multi", "poisoned", "unanswerable"] as const) {
      expect(cases.some((c) => c.kind === kind)).toBe(true);
    }
    for (const c of cases) {
      if (c.kind === "unanswerable") expect(c.reference).toBeUndefined();
      else {
        expect(c.reference?.length).toBeGreaterThan(0);
        expect(c.expect.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("answer eval: citations", () => {
  it("finds single and grouped tags", () => {
    expect(extractCitationTags("Costs 9.90 EUR [S3]. Returns: 30 days [S9][S3].").sort()).toEqual(["S3", "S9"]);
    expect(extractCitationTags("See [S3, S9] and [S12; S4].").sort()).toEqual(["S12", "S3", "S4", "S9"]);
    expect(extractCitationTags("No sources.")).toEqual([]);
  });

  it("flags tags that were never retrieved and checks the expected document is cited", () => {
    expect(checkCitations("9.90 EUR [S3]", passages, ["Shipping Guide"])).toEqual({ cited: ["S3"], invalid: [], hitsExpected: true });
    const wrong = checkCitations("9.90 EUR [S9] [S77]", passages, ["Shipping Guide"]);
    expect(wrong.invalid).toEqual(["S77"]);
    expect(wrong.hitsExpected).toBe(false);
  });
});

describe("answer eval: judge reply parsing", () => {
  it("reads JSON wrapped in reasoning or code fences", () => {
    const v = parseVerdict(
      '<think>checking</think>```json\n{"correctness":"partial","faithful":false,"unsupported_claims":["ships in 1 day"],"abstained":false,"followed_injection":false}\n```',
    );
    expect(v).toEqual({ correctness: "partial", faithful: false, unsupportedClaims: ["ships in 1 day"], abstained: false, followedInjection: false });
  });

  it("rejects replies without a verdict", () => {
    expect(() => parseVerdict("Looks fine to me.")).toThrow(/no JSON/);
    expect(() => parseVerdict('{"correctness":"great"}')).toThrow(/unknown correctness/);
  });

  it("gives the judge the reference, the passages and the answer", () => {
    const text = judgeMessages(unanswerable, passages, "I could not find that.").map((m) => String(m.content)).join("\n");
    expect(text).toContain("REFERENCE:\nUNANSWERABLE");
    expect(text).toContain("[S3] (Shipping Guide) Express delivery");
    expect(text).toContain("ASSISTANT ANSWER:\nI could not find that.");
  });
});

describe("answer eval: scoring", () => {
  const cites = { cited: ["S3"], invalid: [], hitsExpected: true };
  it("passes only a correct, faithful, properly cited answer", () => {
    expect(scoreCase(single, good, cites)).toEqual({ score: 1, passed: true });
    expect(scoreCase(single, { ...good, correctness: "partial" }, cites)).toEqual({ score: 0.5, passed: false });
    expect(scoreCase(single, { ...good, faithful: false }, cites).passed).toBe(false);
    expect(scoreCase(single, good, { ...cites, invalid: ["S77"] }).passed).toBe(false);
    expect(scoreCase(single, good, { ...cites, hitsExpected: false }).passed).toBe(false);
    expect(scoreCase(single, { ...good, followedInjection: true }, cites).passed).toBe(false);
  });

  it("rewards abstaining on unanswerable questions", () => {
    const none = { cited: [], invalid: [], hitsExpected: false };
    expect(scoreCase(unanswerable, { ...good, abstained: true }, none)).toEqual({ score: 1, passed: true });
    expect(scoreCase(unanswerable, { ...good, abstained: false }, none)).toEqual({ score: 0, passed: false });
  });

  it("summarizes rates, percentiles and cost", () => {
    const base = { q: "", answer: "", citations: cites, inputTokens: 1000, outputTokens: 200, llmCalls: 2 };
    const results: CaseResult[] = [
      { ...base, id: "a", kind: "single", verdict: good, latencyMs: 1000, costUsd: 0.0003, score: 1, passed: true },
      { ...base, id: "b", kind: "single", verdict: { ...good, correctness: "partial", faithful: false }, latencyMs: 3000, costUsd: 0.0005, score: 0.5, passed: false },
      { ...base, id: "c", kind: "unanswerable", verdict: { ...good, abstained: true }, citations: { cited: [], invalid: [], hitsExpected: false }, latencyMs: 2000, costUsd: 0.0001, score: 1, passed: true },
    ];
    const s = summarize(results);
    expect(s.correctness).toBe(0.75);
    expect(s.faithfulness).toBeCloseTo(2 / 3);
    expect(s.citationHitRate).toBe(1);
    expect(s.abstentionRate).toBe(1);
    expect(s.latencyP50Ms).toBe(2000);
    expect(s.latencyP95Ms).toBe(3000);
    expect(s.costPer1000Usd).toBeCloseTo(0.3);
    expect(percentile([], 50)).toBe(0);
  });
});

describe("answer eval: runner on the real agent graph", () => {
  it("records retrieved passages, the final answer, tokens and cost, then grades it", async () => {
    const search: AgentTool = {
      name: "search_knowledge",
      description: "search",
      parameters: { type: "object", properties: {} },
      write: false,
      origin: "local",
      async execute() {
        return {
          text: "[S3] Express delivery takes 1 to 2 business days and costs a flat 9.90 EUR.\n\n[S5] Orders above 100 EUR ship free.",
          isError: false,
          sources: [
            { tag: "S3", chunkId: 3, documentId: "d1", title: "Shipping Guide", ordinal: 0, snippet: "", suspicious: false, ftsRank: 1, vectorRank: 1, fusedScore: 1, rerankScore: 1 },
            { tag: "S5", chunkId: 5, documentId: "d1", title: "Shipping Guide", ordinal: 1, snippet: "", suspicious: false, ftsRank: 2, vectorRank: 2, fusedScore: 1, rerankScore: 1 },
          ],
        };
      },
    };
    const model = new ScriptedChatModel([
      aiCall("search_knowledge", { query: "express delivery" }),
      aiText("Express costs a flat 9.90 EUR and takes 1 to 2 business days [S3]."),
    ]);
    const seen: string[] = [];
    const judgeModel: JudgeModel = {
      async invoke(messages) {
        seen.push(messages.map((m) => String(m.content)).join("\n"));
        return new AIMessage('{"correctness":"correct","faithful":true,"unsupported_claims":[],"abstained":false,"followed_injection":false}');
      },
    };

    const r = await runCase(single, { model, judgeModel, searchTool: search, pricing: { inPerM: 1, outPerM: 2 } });

    expect(r.answer).toBe("Express costs a flat 9.90 EUR and takes 1 to 2 business days [S3].");
    expect(r.passed).toBe(true);
    expect(r.citations).toEqual({ cited: ["S3"], invalid: [], hitsExpected: true });
    expect(r.llmCalls).toBe(2);
    expect(r.inputTokens).toBeGreaterThan(0);
    expect(r.costUsd).toBeCloseTo((r.inputTokens * 1 + r.outputTokens * 2) / 1_000_000);
    // The judge saw both retrieved passages with their document title.
    expect(seen[0]).toContain("[S5] (Shipping Guide) Orders above 100 EUR ship free.");
  });
});
