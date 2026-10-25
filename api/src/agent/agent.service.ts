import type { BaseMessage } from "@langchain/core/messages";
import { HumanMessage } from "@langchain/core/messages";
import { Command, type BaseCheckpointSaver } from "@langchain/langgraph";
import { ConflictException, HttpException, Inject, Injectable } from "@nestjs/common";
import type { AuthUser } from "../auth/jwt-verifier.js";
import { errorMessage } from "../common/errors.js";
import { CHAT_MODEL_FACTORY, CHECKPOINTER, CONFIG, MCP_GATEWAY_FACTORY, TRACER } from "../common/tokens.js";
import type { Config } from "../config.js";
import { GuardrailsService } from "../guardrails/guardrails.service.js";
import type { McpGatewayFactory } from "../mcp/mcp-gateway.js";
import { MetricsService } from "../metrics/metrics.service.js";
import { RagService } from "../rag/rag.service.js";
import type { Tracer } from "../tracing/tracer.js";
import type { AgentEvent, Emit, PendingCall } from "./events.js";
import { buildAgentGraph, type AgentGraph } from "./graph.js";
import { pendingCallsOf, toHistoryItem, type HistoryItem } from "./history.js";
import { llmConfigured, type ChatModelFactory } from "./llm.js";
import { ThreadStore } from "./threads.js";
import { mcpTools, searchKnowledgeTool, type AgentTool } from "./tools.js";

export type { HistoryItem } from "./history.js";

type RunInput = { messages: HumanMessage[] } | Command;
// LangGraph types a resume Command by node name; ours carries only the human's decision, so we narrow it here.
type GraphInput = Parameters<AgentGraph["invoke"]>[0];
type RunOutcome = "completed" | "blocked" | "error";

/** Runs the agent graph for one user and one conversation thread. */
@Injectable()
export class AgentService {
  constructor(
    @Inject(CONFIG) private readonly cfg: Config,
    @Inject(CHECKPOINTER) private readonly checkpointer: BaseCheckpointSaver,
    @Inject(CHAT_MODEL_FACTORY) private readonly modelFactory: ChatModelFactory,
    @Inject(MCP_GATEWAY_FACTORY) private readonly gatewayFactory: McpGatewayFactory,
    @Inject(GuardrailsService) private readonly guardrails: GuardrailsService,
    @Inject(RagService) private readonly rag: RagService,
    @Inject(TRACER) private readonly tracer: Tracer,
    @Inject(MetricsService) private readonly metrics: MetricsService,
    @Inject(ThreadStore) private readonly threads: ThreadStore,
  ) {}

  listThreads(user: AuthUser) {
    return this.threads.listFor(user);
  }

  async history(threadId: string, user: AuthUser): Promise<{ items: HistoryItem[]; pending: PendingCall[] }> {
    await this.threads.assertOwner(threadId, user);
    // Reading state needs no tools or emitter, only the checkpoint.
    const snapshot = await this.buildGraph(() => undefined, []).getState(threadConfig(threadId));
    const messages = (snapshot.values as { messages?: BaseMessage[] }).messages ?? [];
    return {
      items: messages.map((m) => toHistoryItem(m, this.guardrails)),
      pending: pendingCallsOf(snapshot),
    };
  }

  /** Starts (or continues) a conversation with a new user message. */
  async sendMessage(user: AuthUser, threadId: string, message: string, emit: Emit): Promise<void> {
    if (await this.threads.exists(threadId, user)) {
      const { pending } = await this.history(threadId, user);
      if (pending.length) throw new ConflictException("This thread is waiting for an approval decision");
      await this.threads.touch(threadId);
    } else {
      await this.threads.create(threadId, user, message);
    }
    await this.run(user, threadId, { messages: [new HumanMessage(message)] }, emit);
  }

  /** Resumes a paused run with the human's decision. */
  async decide(user: AuthUser, threadId: string, approved: boolean, emit: Emit): Promise<void> {
    const { pending } = await this.history(threadId, user);
    if (!pending.length) throw new ConflictException("No approval is pending on this thread");
    await this.threads.touch(threadId);
    await this.run(user, threadId, new Command({ resume: { approved } }), emit);
  }

  private buildGraph(emit: Emit, tools: AgentTool[]): AgentGraph {
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

  /** One traced run. Failures reach the client as `error` + `done` events; HTTP errors propagate. */
  private async run(user: AuthUser, threadId: string, input: RunInput, emit: Emit): Promise<void> {
    let outcome: RunOutcome = "completed";
    const send: Emit = (event: AgentEvent) => {
      if (event.type === "guardrail") outcome = "blocked";
      emit(event);
    };

    if (!llmConfigured(this.cfg)) {
      send({ type: "error", message: "No LLM is configured. Set LLM_API_KEY (and LLM_BASE_URL / LLM_MODEL) and restart the API." });
      send({ type: "done", status: "error" });
      return;
    }

    // The gateway carries this user's token, so SecureMCP applies this user's role to every tool call.
    const gateway = this.gatewayFactory(user.token);
    try {
      await this.tracer.trace({ name: "chat", userSub: user.sub, username: user.username, threadId }, async () => {
        send({ type: "run_started", threadId, traceId: this.tracer.currentTraceId() });
        const tools = await this.loadTools(gateway, send);
        const graph = this.buildGraph(send, tools);
        await graph.invoke(input as GraphInput, threadConfig(threadId));

        const pending = pendingCallsOf(await graph.getState(threadConfig(threadId)));
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

  /** Local knowledge search plus whatever SecureMCP offers this user. The agent still works if SecureMCP is down. */
  private async loadTools(gateway: ReturnType<McpGatewayFactory>, send: Emit): Promise<AgentTool[]> {
    const local = searchKnowledgeTool(this.rag);
    try {
      const remote = await this.tracer.span("mcp.list_tools", "tool", () => mcpTools(gateway));
      return [local, ...remote];
    } catch (err) {
      send({ type: "warning", message: `SecureMCP tools unavailable: ${errorMessage(err)}` });
      return [local];
    }
  }
}

const threadConfig = (threadId: string) => ({ configurable: { thread_id: threadId } });

function friendlyError(err: unknown): string {
  const msg = errorMessage(err);
  if (/401|invalid api key|authentication/i.test(msg)) return "The LLM provider rejected the API key.";
  if (/429|rate limit/i.test(msg)) return "The LLM provider is rate limiting requests. Try again shortly.";
  return `The agent run failed: ${msg.slice(0, 300)}`;
}
