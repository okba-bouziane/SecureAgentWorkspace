import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet, type JWTVerifyGetKey } from "jose";
import pg from "pg";
import { buildAgentGraph, type ChatModelLike } from "../src/agent/graph.js";
import type { AgentEvent } from "../src/agent/events.js";
import type { AgentTool } from "../src/agent/tools.js";
import { GuardrailsService } from "../src/guardrails/guardrails.service.js";
import { MetricsService } from "../src/metrics/metrics.service.js";
import { MemorySink } from "../src/tracing/memory-sink.js";
import { Tracer } from "../src/tracing/tracer.js";

/** Scripted chat model: a test double that replays prepared replies. The app itself never uses it. */
export class ScriptedChatModel implements ChatModelLike {
  readonly seen: BaseMessage[][] = [];
  private i = 0;
  constructor(private readonly script: (AIMessage | ((messages: BaseMessage[]) => AIMessage))[]) {}

  bindTools(): { invoke(messages: BaseMessage[]): Promise<AIMessage> } {
    return {
      invoke: async (messages) => {
        this.seen.push(messages);
        const next = this.script[this.i++];
        if (!next) throw new Error("ScriptedChatModel ran out of replies");
        return typeof next === "function" ? next(messages) : next;
      },
    };
  }
}

export const aiCall = (name: string, args: Record<string, unknown>, id = `call_${name}`) =>
  new AIMessage({ content: "", tool_calls: [{ id, name, args, type: "tool_call" }] });

export const aiText = (content: string) => new AIMessage({ content });

export function fakeTool(name: string, write: boolean, run: (args: Record<string, unknown>) => { text: string; isError?: boolean }): AgentTool & { calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  return {
    name,
    description: name,
    parameters: { type: "object", properties: {} },
    write,
    origin: "local",
    calls,
    async execute(args) {
      calls.push(args);
      const r = run(args);
      return { text: r.text, isError: r.isError ?? false };
    },
  };
}

export function harness(opts: { model: ChatModelLike; tools: AgentTool[]; maxSteps?: number }) {
  const events: AgentEvent[] = [];
  const sink = new MemorySink();
  const tracer = new Tracer([sink], { inPerM: 1, outPerM: 1 });
  const metrics = new MetricsService();
  const graph = buildAgentGraph({
    model: opts.model,
    tools: opts.tools,
    guardrails: new GuardrailsService(metrics),
    tracer,
    metrics,
    emit: (e) => events.push(e),
    checkpointer: new MemorySaver(),
    maxSteps: opts.maxSteps ?? 6,
  });
  const run = <T>(fn: () => Promise<T>) => tracer.trace({ name: "test", userSub: "u1" }, fn);
  return { graph, events, sink, run };
}

export async function makeJwks() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "RS256", use: "sig" };
  const jwks: JWTVerifyGetKey = createLocalJWKSet({ keys: [jwk] });
  const sign = (claims: Record<string, unknown>, o: { issuer?: string; audience?: string; expiresIn?: string; key?: CryptoKey } = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(o.issuer ?? "http://issuer.test/realms/x")
      .setAudience(o.audience ?? "mcp-server")
      .setSubject("user-1")
      .setIssuedAt()
      .setExpirationTime(o.expiresIn ?? "5m")
      .sign(o.key ?? privateKey);
  return { jwks, sign, privateKey };
}

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL;

export function testPool() {
  return new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
}

import type { Embedder } from "../src/rag/embeddings.js";
import { queryTerms } from "../src/rag/text.js";
import { EMBEDDING_DIM } from "../src/db/schema.js";

/** Deterministic bag-of-words hashing embedder, a test double so integration tests need no model download. */
export class HashEmbedder implements Embedder {
  failures = 0;
  calls = 0;
  async embed(texts: string[]): Promise<number[][]> {
    this.calls += 1;
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error("embedder unavailable");
    }
    return texts.map((t) => {
      const v = new Array<number>(EMBEDDING_DIM).fill(0);
      for (const term of queryTerms(t)) {
        let h = 2166136261;
        for (const ch of term) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
        v[h % EMBEDDING_DIM]! += 1;
      }
      const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
      return v.map((x) => x / norm);
    });
  }
}
