import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import {
  Annotation,
  END,
  MessagesAnnotation,
  START,
  StateGraph,
  interrupt,
  isGraphInterrupt,
  type BaseCheckpointSaver,
} from "@langchain/langgraph";
import { randomUUID } from "node:crypto";
import type { GuardrailsService } from "../guardrails/guardrails.service.js";
import type { MetricsService } from "../metrics/metrics.service.js";
import { estimateTokens } from "../tracing/cost.js";
import type { Tracer } from "../tracing/tracer.js";
import type { AgentEvent, Emit, PendingCall, SourceRef } from "./events.js";
import { BLOCKED_REPLY, SYSTEM_PROMPT } from "./prompt.js";
import { toOpenAiTools, type AgentTool } from "./tools.js";

/** What the graph needs from a chat model. Real model: ChatOpenAI. Tests: a scripted double. */
export interface ChatModelLike {
  bindTools(tools: unknown[]): { invoke(messages: BaseMessage[]): Promise<AIMessage> };
}

export interface ApprovalDecision {
  approved: boolean;
}

export interface GraphDeps {
  model: ChatModelLike;
  tools: AgentTool[];
  guardrails: Pick<GuardrailsService, "checkUserInput" | "wrapToolOutput" | "redactOutput">;
  tracer: Tracer;
  metrics?: Pick<MetricsService, "toolCalls" | "llmTokens" | "llmLatency" | "chatRuns">;
  emit: Emit;
  checkpointer: BaseCheckpointSaver;
  maxSteps: number;
  modelName?: string;
}

const AgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
  /** Tool-call ids the human rejected in the current step. */
  rejected: Annotation<string[]>({ reducer: (_a, b) => b, default: () => [] }),
  steps: Annotation<number>({ reducer: (_a, b) => b, default: () => 0 }),
  blocked: Annotation<boolean>({ reducer: (_a, b) => b, default: () => false }),
});

type State = typeof AgentState.State;

const textOf = (m: BaseMessage): string =>
  typeof m.content === "string" ? m.content : JSON.stringify(m.content);

export function buildAgentGraph(deps: GraphDeps) {
  const toolsByName = new Map(deps.tools.map((t) => [t.name, t]));
  const isWrite = (name: string) => toolsByName.get(name)?.write ?? true; // unknown tools fail closed
  const { tracer, guardrails, emit } = deps;

  const guard = async (state: State): Promise<Partial<State>> => {
    const last = [...state.messages].reverse().find((m) => m instanceof HumanMessage);
    const text = last ? textOf(last) : "";
    const verdict = await tracer.span(
      "guardrail.input",
      "guardrail",
      async (h) => {
        const v = await guardrails.checkUserInput(text);
        h.setAttributes({ blocked: v.blocked, score: v.score, matches: v.matches });
        return v;
      },
    );
    if (verdict.blocked) {
      emit({ type: "guardrail", verdict: "blocked", matches: verdict.matches });
      emit({ type: "message", content: BLOCKED_REPLY, redactions: {} });
      deps.metrics?.chatRuns.inc({ outcome: "blocked" });
      return { messages: [new AIMessage({ content: BLOCKED_REPLY })], blocked: true, steps: 0 };
    }
    return { blocked: false, steps: 0, rejected: [] };
  };

  const agent = async (state: State): Promise<Partial<State>> => {
    if (state.steps >= deps.maxSteps) {
      return { messages: [new AIMessage({ content: "I reached my step limit for this request, so I stopped here." })], steps: state.steps + 1 };
    }
    const bound = deps.model.bindTools(toOpenAiTools(deps.tools));
    const input = [new SystemMessage(SYSTEM_PROMPT), ...state.messages];
    const response = await tracer.span(
      "llm.chat",
      "llm",
      async (h) => {
        const stop = deps.metrics?.llmLatency.startTimer();
        try {
          const res = await bound.invoke(input);
          const inTok = res.usage_metadata?.input_tokens ?? estimateTokens(input.map(textOf).join("\n"));
          const outTok = res.usage_metadata?.output_tokens ?? estimateTokens(textOf(res) + JSON.stringify(res.tool_calls ?? []));
          h.setUsage(inTok, outTok);
          h.setAttributes({
            model: deps.modelName ?? "configured-model",
            usageSource: res.usage_metadata ? "provider" : "estimated",
            toolCalls: (res.tool_calls ?? []).map((c) => c.name),
          });
          deps.metrics?.llmTokens.inc({ direction: "input" }, inTok);
          deps.metrics?.llmTokens.inc({ direction: "output" }, outTok);
          return res;
        } finally {
          stop?.();
        }
      },
    );
    for (const call of response.tool_calls ?? []) call.id ??= `call_${randomUUID().slice(0, 8)}`;
    return { messages: [response], steps: state.steps + 1 };
  };

  const lastAi = (state: State): AIMessage => state.messages.at(-1) as AIMessage;

  const routeAfterAgent = (state: State): "approval" | "tools" | "answer" => {
    const calls = lastAi(state).tool_calls ?? [];
    if (calls.length === 0) return "answer";
    return calls.some((c) => isWrite(c.name)) ? "approval" : "tools";
  };

  const approval = async (state: State): Promise<Partial<State>> => {
    const writeCalls = (lastAi(state).tool_calls ?? []).filter((c) => isWrite(c.name));
    const pending: PendingCall[] = writeCalls.map((c) => ({ id: c.id as string, name: c.name, args: c.args as Record<string, unknown> }));
    let decision: ApprovalDecision | undefined;
    let paused: unknown;
    await tracer.span("approval.wait", "approval", async (h) => {
      h.setAttributes({ tools: pending.map((p) => p.name) });
      try {
        // On first execution this throws and the graph pauses; on resume it returns the human's answer.
        decision = interrupt({ kind: "approval", calls: pending }) as ApprovalDecision;
        h.setAttributes({ decision: decision.approved ? "approved" : "rejected" });
      } catch (err) {
        if (!isGraphInterrupt(err)) throw err;
        h.setAttributes({ state: "awaiting_human" });
        paused = err;
      }
    });
    if (paused) throw paused;
    return { rejected: decision?.approved ? [] : pending.map((p) => p.id) };
  };

  const tools = async (state: State): Promise<Partial<State>> => {
    const out: ToolMessage[] = [];
    const sourceBatch: SourceRef[] = [];
    for (const call of lastAi(state).tool_calls ?? []) {
      const id = call.id as string;
      const args = (call.args ?? {}) as Record<string, unknown>;
      const tool = toolsByName.get(call.name);
      emit({ type: "tool_call", id, name: call.name, args, write: isWrite(call.name) });

      if (state.rejected.includes(id)) {
        const text = "The human reviewer rejected this action. It was not executed.";
        deps.metrics?.toolCalls.inc({ tool: call.name, outcome: "rejected" });
        emit({ type: "tool_result", id, name: call.name, isError: true, preview: text, neutralised: 0, durationMs: 0 });
        out.push(new ToolMessage({ content: text, tool_call_id: id, name: call.name, status: "error" }));
        continue;
      }
      if (!tool) {
        const text = `Unknown tool '${call.name}'.`;
        emit({ type: "tool_result", id, name: call.name, isError: true, preview: text, neutralised: 0, durationMs: 0 });
        out.push(new ToolMessage({ content: text, tool_call_id: id, name: call.name, status: "error" }));
        continue;
      }

      const t0 = performance.now();
      const result = await tracer.span(
        `tool.${tool.name}`,
        tool.name === "search_knowledge" ? "retrieval" : "tool",
        async (h) => {
          h.setAttributes({ origin: tool.origin, write: tool.write, args });
          try {
            const r = await tool.execute(args);
            h.setAttributes({ isError: r.isError });
            return r;
          } catch (err) {
            return { text: `Tool failed: ${err instanceof Error ? err.message : String(err)}`, isError: true } as const;
          }
        },
      );
      const wrapped = guardrails.wrapToolOutput(tool.name, result.text);
      const durationMs = performance.now() - t0;
      deps.metrics?.toolCalls.inc({ tool: tool.name, outcome: result.isError ? "error" : "ok" });
      const sources = "sources" in result ? (result.sources ?? []) : [];
      sourceBatch.push(...sources);
      emit({
        type: "tool_result",
        id,
        name: tool.name,
        isError: result.isError,
        preview: guardrails.redactOutput(wrapped.clean).text.slice(0, 1500),
        neutralised: wrapped.neutralised,
        durationMs,
      });
      out.push(
        new ToolMessage({
          content: wrapped.text,
          tool_call_id: id,
          name: tool.name,
          status: result.isError ? "error" : "success",
          artifact: sources,
        }),
      );
    }
    if (sourceBatch.length) emit({ type: "sources", sources: sourceBatch });
    return { messages: out, rejected: [] };
  };

  const answer = async (state: State): Promise<Partial<State>> => {
    const last = lastAi(state);
    const redacted = await tracer.span("guardrail.output", "guardrail", async (h) => {
      const r = guardrails.redactOutput(textOf(last));
      h.setAttributes({ redactions: r.redactions });
      return r;
    });
    emit({ type: "message", content: redacted.text, redactions: redacted.redactions });
    deps.metrics?.chatRuns.inc({ outcome: "completed" });
    // Same id: the reducer replaces the original message with the redacted one in the stored history.
    return { messages: [new AIMessage({ content: redacted.text, id: last.id })] };
  };

  return new StateGraph(AgentState)
    .addNode("guard", guard)
    .addNode("agent", agent)
    .addNode("approval", approval)
    .addNode("tools", tools)
    .addNode("answer", answer)
    .addEdge(START, "guard")
    .addConditionalEdges("guard", (s: State) => (s.blocked ? END : "agent"), { [END]: END, agent: "agent" })
    .addConditionalEdges("agent", routeAfterAgent, { approval: "approval", tools: "tools", answer: "answer" })
    .addEdge("approval", "tools")
    .addEdge("tools", "agent")
    .addEdge("answer", END)
    .compile({ checkpointer: deps.checkpointer });
}

export type AgentGraph = ReturnType<typeof buildAgentGraph>;
export type { AgentEvent };
