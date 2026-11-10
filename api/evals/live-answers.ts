// Live answer-quality eval: runs every question in dataset.json "answers" through the real agent graph
// (real model, real hybrid search over the seed documents, guardrails on), then grades each answer with a
// judge model from a different family. Reports correctness, faithfulness, citations, abstention,
// latency and cost per answer, and writes the full results to evals/results/.
//
// Needs Postgres with pgvector (TEST_DATABASE_URL, e.g. `docker compose up -d postgres`) and LLM_API_KEY.
//   npm run evals:answers
// Not part of CI: it depends on an external model. The scoring code it uses is tested in answers.eval.ts.
import { ChatOpenAI } from "@langchain/openai";
import type { AIMessage, BaseMessage } from "@langchain/core/messages";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { errorMessage } from "../src/common/errors.js";
import { openAiCompatibleFactory, retryDelayMs, withRateLimitRetry } from "../src/agent/llm.js";
import { searchKnowledgeTool } from "../src/agent/tools.js";
import { loadConfig } from "../src/config.js";
import { migrate } from "../src/db/db.js";
import { processIngestion } from "../src/ingestion/processor.js";
import { MetricsService } from "../src/metrics/metrics.service.js";
import { TransformersEmbedder } from "../src/rag/embeddings.js";
import { RagService } from "../src/rag/rag.service.js";
import { MemorySink } from "../src/tracing/memory-sink.js";
import { Tracer } from "../src/tracing/tracer.js";
import type { JudgeModel } from "./answers/judge.js";
import { runCase } from "./answers/runner.js";
import { summarize, type AnswerCase, type CaseResult } from "./answers/scoring.js";
import data from "./dataset.json" with { type: "json" };

const cfg = loadConfig();
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Set TEST_DATABASE_URL to a Postgres with pgvector (see the README).");
if (!cfg.LLM_API_KEY) throw new Error("Set LLM_API_KEY (see .env.example).");
const judgeModelName = process.env.JUDGE_MODEL ?? "qwen/qwen3.8-27b";
const paceMs = Number(process.env.PACE_MS ?? 4000);
const only = process.env.ONLY?.split(",");

const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
const embedder = new TransformersEmbedder({ EMBEDDING_MODEL: "Xenova/all-MiniLM-L6-v2", HF_CACHE_DIR: process.env.HF_CACHE_DIR });
await migrate(pool);
await pool.query("TRUNCATE documents CASCADE");
const seedDir = join(import.meta.dirname, "..", "seed");
for (const file of (await readdir(seedDir)).filter((f) => f.endsWith(".md")).sort()) {
  const content = await readFile(join(seedDir, file), "utf8");
  const title = content.match(/^#\s+(.+)$/m)![1]!;
  const { rows } = await pool.query(`INSERT INTO documents (title, content_hash, uploaded_by) VALUES ($1, md5($2), 'eval') RETURNING id`, [title, content]);
  await processIngestion(pool, embedder, { documentId: rows[0].id, title, content });
}
const rag = new RagService(pool, embedder, new Tracer([new MemorySink()], { inPerM: 0, outPerM: 0 }), new MetricsService());

const judgeChat = new ChatOpenAI({
  model: judgeModelName,
  apiKey: cfg.LLM_API_KEY,
  temperature: 0,
  configuration: { baseURL: cfg.LLM_BASE_URL },
});
const judgeModel: JudgeModel = {
  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await judgeChat.invoke(messages);
      } catch (err) {
        const wait = retryDelayMs(errorMessage(err));
        if (wait === null || attempt >= 6) throw err;
        await new Promise((r) => setTimeout(r, Math.max(wait, 4000 * (attempt + 1))));
      }
    }
  },
};

const pricing = { inPerM: cfg.LLM_PRICE_IN_PER_M, outPerM: cfg.LLM_PRICE_OUT_PER_M };
const cases = (data.answers as AnswerCase[]).filter((c) => !only || only.includes(c.id));
const results: CaseResult[] = [];
for (const c of cases) {
  const r = await runCase(c, {
    model: withRateLimitRetry(openAiCompatibleFactory(cfg)()),
    judgeModel,
    searchTool: searchKnowledgeTool(rag),
    pricing,
  });
  results.push(r);
  const flags = [
    r.verdict.correctness,
    r.verdict.faithful ? "" : "UNFAITHFUL",
    r.citations.invalid.length ? `invalid-cites=${r.citations.invalid.join("/")}` : "",
    r.kind !== "unanswerable" && !r.citations.hitsExpected ? "no-expected-cite" : "",
    r.verdict.followedInjection ? "FOLLOWED-INJECTION" : "",
  ].filter(Boolean);
  console.log(`${r.passed ? "PASS" : "FAIL"}  ${c.id.padEnd(24)} ${(r.latencyMs / 1000).toFixed(1)}s  ${flags.join(" ")}`);
  await new Promise((res) => setTimeout(res, paceMs)); // free-tier tokens-per-minute limits
}
await pool.end();

const s = summarize(results);
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
console.log(`
model ${cfg.LLM_MODEL} (reasoning ${cfg.LLM_REASONING_EFFORT || "default"}), judge ${judgeModelName}, ${s.questions} questions (${s.answerable} answerable, ${s.unanswerable} unanswerable)
correctness ${s.correctness.toFixed(3)} | faithfulness ${pct(s.faithfulness)} | expected source cited ${pct(s.citationHitRate)} | made-up citations ${s.invalidCitations}
abstention on unanswerable ${pct(s.abstentionRate)} | planted instructions followed ${s.injectionFollowed} | strict pass ${pct(s.passRate)}
latency p50 ${(s.latencyP50Ms / 1000).toFixed(2)}s p95 ${(s.latencyP95Ms / 1000).toFixed(2)}s | tokens/answer ${s.meanInputTokens.toFixed(0)} in, ${s.meanOutputTokens.toFixed(0)} out
cost/answer $${s.meanCostUsd.toFixed(5)} ($${s.costPer1000Usd.toFixed(2)} per 1,000) at $${pricing.inPerM}/$${pricing.outPerM} per 1M tokens`);

const outDir = join(import.meta.dirname, "results");
await mkdir(outDir, { recursive: true });
const file = join(outDir, `answers-${cfg.LLM_MODEL.replace(/[^\w.-]+/g, "_")}.json`);
await writeFile(
  file,
  JSON.stringify({ runAt: new Date().toISOString(), model: cfg.LLM_MODEL, reasoningEffort: cfg.LLM_REASONING_EFFORT || null, judge: judgeModelName, pricing, summary: s, results }, null, 2) + "\n",
);
console.log(`\nwrote ${file}`);

const t = data.thresholds;
const ok =
  s.correctness >= t.answerCorrectness &&
  s.faithfulness >= t.answerFaithfulness &&
  s.citationHitRate >= t.answerCitationHitRate &&
  s.abstentionRate >= t.answerAbstentionRate &&
  s.injectionFollowed === 0 &&
  s.invalidCitations === 0;
process.exit(ok || only ? 0 : 1);
