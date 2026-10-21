import { randomUUID } from "node:crypto";
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { Command, type BaseCheckpointSaver } from "@langchain/langgraph";
import { ConflictException, HttpException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { AuthUser } from "../auth/jwt-verifier.js";
import { CHAT_MODEL_FACTORY, CHECKPOINTER, CONFIG, MCP_GATEWAY_FACTORY, PG_POOL, TRACER } from "../common/tokens.js";
import type { Config } from "../config.js";
import type { Pool } from "../db/db.js";
import { GuardrailsService } from "../guardrails/guardrails.service.js";
import type { McpGatewayFactory } from "../mcp/mcp-gateway.js";
import { MetricsService } from "../metrics/metrics.service.js";
import { RagService } from "../rag/rag.service.js";
import type { Tracer } from "../tracing/tracer.js";
import type { AgentEvent, Emit, PendingCall, SourceRef } from "./events.js";
import { buildAgentGraph, type AgentGraph } from "./graph.js";
import { llmConfigured, type ChatModelFactory } from "./llm.js";
import { mcpTools, searchKnowledgeTool, type AgentTool } from "./tools.js";

export interface HistoryItem {
  role: "user" | "assistant" | "tool";
  content: string;
  id?: string;
  toolCalls?: { id: string; name: string; args: Record<string, unknown> }[];
  toolCallId?: string;
  name?: string;
  isError?: boolean;
  sources?: SourceRef[];
}

@Injectable()
export class AgentService {
  constructor(
    @Inject(CONFIG) private readonly cfg: Config,
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CHECKPOINTER) private readonly checkpointer: BaseCheckpointSaver,
    @Inject(CHAT_MODEL_FACTORY) private readonly modelFactory: ChatModelFactory,
    @Inject(MCP_GATEWAY_FACTORY) private readonly gatewayFactory: McpGatewayFactory,
    @Inject(GuardrailsService) private readonly guardrails: GuardrailsService,
    @Inject(RagService) private readonly rag: RagService,
    @Inject(TRACER) private readonly tracer: Tracer,
    @Inject(MetricsService) private readonly metrics: MetricsService,
  ) {}

  async listThreads(user: AuthUser) {
    const { rows } = await this.pool.query(
      `SELECT id, title, updated_at AS "updatedAt" FROM threads WHERE user_sub=$1 ORDER BY updated_at DESC LIMIT 50`,
      [user.sub],
    );
    return rows;
  }

  private async assertOwner(threadId: string, user: AuthUser): Promise<void> {
    const { rows } = await this.pool.query<{ user_sub: string }>(`SELECT user_sub FROM threads WHERE id=$1`, [threadId]);
    if (!rows[0] || rows[0].user_sub !== user.sub) throw new NotFoundException("Thread not found");
  }

  async history(threadId: string, user: AuthUser): Promise<{ items: HistoryItem[]; pending: PendingCall[] }> {
    await this.assertOwner(threadId, user);
    const graph = this.graph(user, () => undefined, []);
    const snap = await graph.getState({ configurable: { thread_id: threadId } });
    const messages = ((snap.values as { messages?: BaseMessage[] }).messages ?? []) as BaseMessage[];
    return { items: messages.map((m) => this.toItem(m)), pending: this.pendingOf(snap) };
  }

  private toItem(m: BaseMessage): HistoryItem {
    const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    if (m instanceof HumanMessage) return { role: "user", content: text, id: m.id };
    if (m instanceof ToolMessage) {
      const inner = text.match(/<untrusted_tool_output[^>]*>\n?([\s\S]*?)\n?<\/untrusted_tool_output>/)?.[1] ?? text;
      return {
        role: "tool",
        content: this.guardrails.redactOutput(inner).text.slice(0, 1500),
        toolCallId: m.tool_call_id,
        name: m.name,
        isError: m.status === "error",
        sources: Array.isArray(m.artifact) ? (m.artifact as SourceRef[]) : undefined,
      };
    }
    const ai = m as AIMessage;
    return {
      role: "assistant",
      id: ai.id,
      content: this.guardrails.redactOutput(text).text,
      toolCalls: (ai.tool_calls ?? []).map((c) => ({ id: c.id ?? "", name: c.name, args: c.args as Record<string, unknown> })),
    };
  }

  private pendingOf(snap: { tasks?: { interrupts?: { value?: unknown }[] }[] }): PendingCall[] {
    const value = snap.tasks?.flatMap((t) => t.interrupts ?? [])[0]?.value as { calls?: PendingCall[] } | undefined;
    return value?.calls ?? [];
  }

  private graph(user: AuthUser, emit: Emit, tools: AgentTool[]): AgentGraph {
    return buildAgentGraph({
      model: this.modelFactory(),
      tools,
      guardrails: this.guardrails,
      tracer: this.tracer,
      metrics: this.metrics,
      emit,
      checkpointer: this.checkpointer,
      maxSteps: this.cfg.MAX_AGENT_STEPS,
      modelName: this.cfg.LLM_MODEL,
    });
  }

  /** Starts (or continues) a conversation with a new user message. */
  async sendMessage(user: AuthUser, threadId: string, message: string, emit: Emit): Promise<void> {
    const existing = await this.pool.query<{ user_sub: string }>(`SELECT user_sub FROM threads WHERE id=$1`, [threadId]);
    if (existing.rows[0] && existing.rows[0].user_sub !== user.sub) throw new NotFoundException("Thread not found");
    if (existing.rows[0]) {
      const h = await this.history(threadId, user);
      if (h.pending.length) throw new ConflictException("This thread is waiting for an approval decision");
      await this.pool.query(`UPDATE threads SET updated_at=now() WHERE id=$1`, [threadId]);
    } else {
      await this.pool.query(`INSERT INTO threads (id, user_sub, title) VALUES ($1,$2,$3)`, [threadId, user.sub, message.slice(0, 80)]);
    }
    await this.execute(user, threadId, { messages: [new HumanMessage(message)] }, emit);
  }

  /** Resumes a paused run with the human's decision. */
  async decide(user: AuthUser, threadId: string, approved: boolean, emit: Emit): Promise<void> {
    const h = await this.history(threadId, user);
    if (!h.pending.length) throw new ConflictException("No approval is pending on this thread");
    await this.pool.query(`UPDATE threads SET updated_at=now() WHERE id=$1`, [threadId]);
    await this.execute(user, threadId, new Command({ resume: { approved } }), emit);
  }

  private async execute(user: AuthUser, threadId: string, input: { messages: HumanMessage[] } | Command, emit: Emit): Promise<void> {
    let outcome: "completed" | "blocked" | "error" = "completed";
    const send: Emit = (e: AgentEvent) => {
      if (e.type === "guardrail") outcome = "blocked";
      emit(e);
    };
    if (!llmConfigured(this.cfg)) {
      send({ type: "error", message: "No LLM is configured. Set LLM_API_KEY (and LLM_BASE_URL / LLM_MODEL) and restart the API." });
      send({ type: "done", status: "error" });
      return;
    }

    const gateway = this.gatewayFactory(user.token);
    try {
      await this.tracer.trace({ name: "chat", userSub: user.sub, username: user.username, threadId }, async () => {
        send({ type: "run_started", threadId, traceId: this.tracer.currentTraceId() });
        let tools: AgentTool[] = [searchKnowledgeTool(this.rag)];
        try {
          tools = [searchKnowledgeTool(this.rag), ...(await this.tracer.span("mcp.list_tools", "tool", () => mcpTools(gateway)))];
        } catch (err) {
          send({ type: "warning", message: `SecureMCP tools unavailable: ${err instanceof Error ? err.message : String(err)}` });
        }
        const graph = this.graph(user, send, tools);
        const config = { configurable: { thread_id: threadId } };
        await graph.invoke(input as never, config);
        const snap = await graph.getState(config);
        const pending = this.pendingOf(snap);
        if (pending.length) {
          send({ type: "approval_required", calls: pending });
          send({ type: "done", status: "awaiting_approval" });
        } else {
          send({ type: "done", status: outcome });
        }
      });
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.metrics.chatRuns.inc({ outcome: "error" });
      send({ type: "error", message: friendlyError(err) });
      send({ type: "done", status: "error" });
    } finally {
      await gateway.close();
    }
  }

  newThreadId(): string {
    return randomUUID();
  }
}

function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/401|invalid api key|authentication/i.test(msg)) return "The LLM provider rejected the API key.";
  if (/429|rate limit/i.test(msg)) return "The LLM provider is rate limiting requests. Try again shortly.";
  return `The agent run failed: ${msg.slice(0, 300)}`;
}
