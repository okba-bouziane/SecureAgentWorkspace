import { HumanMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { randomUUID } from "node:crypto";
import type { AgentEvent } from "../../src/agent/events.js";
import { buildAgentGraph, type ChatModelLike } from "../../src/agent/graph.js";
import type { AgentTool } from "../../src/agent/tools.js";
import { GuardrailsService } from "../../src/guardrails/guardrails.service.js";
import { MetricsService } from "../../src/metrics/metrics.service.js";
import { estimateCostUsd, type Pricing } from "../../src/tracing/cost.js";
import { MemorySink } from "../../src/tracing/memory-sink.js";
import { Tracer } from "../../src/tracing/tracer.js";
import { judge, type JudgeModel } from "./judge.js";
import { checkCitations, scoreCase, type AnswerCase, type CaseResult, type RetrievedPassage } from "./scoring.js";

export interface RunnerDeps {
  /** The agent's model (the real one in the live run, a scripted double in CI). */
  model: ChatModelLike;
  judgeModel: JudgeModel;
  /** The real search_knowledge tool in the live run. */
  searchTool: AgentTool;
  pricing: Pricing;
  maxSteps?: number;
}

/** Wraps search_knowledge so the eval sees the exact passages (tag, title, full text) the agent read. */
function recordingSearch(tool: AgentTool, into: RetrievedPassage[]): AgentTool {
  return {
    ...tool,
    async execute(args) {
      const outcome = await tool.execute(args);
      const titles = new Map((outcome.sources ?? []).map((s) => [s.tag, s.title]));
      for (const block of outcome.text.split(/\n\n(?=\[S\d+\])/)) {
        const m = block.match(/^\[(S\d+)\]\s*([\s\S]*)$/);
        if (m && !into.some((p) => p.tag === m[1])) into.push({ tag: m[1]!, title: titles.get(m[1]!) ?? "", text: m[2]!.trim() });
      }
      return outcome;
    },
  };
}

/** Runs one question through the real agent graph (guardrails, tool loop, output redaction), then grades it. */
export async function runCase(c: AnswerCase, deps: RunnerDeps): Promise<CaseResult> {
  const passages: RetrievedPassage[] = [];
  const events: AgentEvent[] = [];
  const sink = new MemorySink();
  const tracer = new Tracer([sink], deps.pricing);
  const metrics = new MetricsService();
  const graph = buildAgentGraph({
    model: deps.model,
    tools: [recordingSearch(deps.searchTool, passages)],
    guardrails: new GuardrailsService(metrics),
    tracer,
    metrics,
    emit: (e) => events.push(e),
    checkpointer: new MemorySaver(),
    maxSteps: deps.maxSteps ?? 6,
  });

  const started = performance.now();
  await tracer.trace({ name: "eval.answer", userSub: "eval" }, () =>
    graph.invoke({ messages: [new HumanMessage(c.q)] }, { configurable: { thread_id: randomUUID() } }),
  );
  const latencyMs = performance.now() - started;

  const answer = [...events].reverse().find((e): e is Extract<AgentEvent, { type: "message" }> => e.type === "message")?.content ?? "";
  const llmSpans = sink.spans.filter((s) => s.kind === "llm");
  const inputTokens = llmSpans.reduce((n, s) => n + s.inputTokens, 0);
  const outputTokens = llmSpans.reduce((n, s) => n + s.outputTokens, 0);

  const verdict = await judge(deps.judgeModel, c, passages, answer);
  const citations = checkCitations(answer, passages, c.expect);
  const { score, passed } = scoreCase(c, verdict, citations);
  return {
    id: c.id,
    kind: c.kind,
    q: c.q,
    answer,
    verdict,
    citations,
    latencyMs,
    inputTokens,
    outputTokens,
    costUsd: estimateCostUsd(inputTokens, outputTokens, deps.pricing),
    llmCalls: llmSpans.length,
    score,
    passed,
  };
}
