import { randomUUID } from "node:crypto";
import type { SpanRecord, SpanSink, TraceRecord } from "./types.js";

export interface LangfuseOptions {
  host: string;
  publicKey: string;
  secretKey: string;
  fetchImpl?: typeof fetch;
}

/**
 * Optional export to Langfuse through its public ingestion API. Spans are
 * buffered per trace and sent in one batch when the trace ends.
 */
export class LangfuseSink implements SpanSink {
  private readonly buffer = new Map<string, SpanRecord[]>();
  private readonly doFetch: typeof fetch;

  constructor(private readonly opts: LangfuseOptions) {
    this.doFetch = opts.fetchImpl ?? fetch;
  }

  async startTrace(t: TraceRecord): Promise<void> {
    this.buffer.set(t.id, []);
  }

  async writeSpan(s: SpanRecord): Promise<void> {
    this.buffer.get(s.traceId)?.push(s);
  }

  async endTrace(t: TraceRecord): Promise<void> {
    const spans = this.buffer.get(t.id) ?? [];
    this.buffer.delete(t.id);
    const now = new Date().toISOString();
    const batch: unknown[] = [
      {
        id: randomUUID(),
        type: "trace-create",
        timestamp: now,
        body: { id: t.id, name: t.name, userId: t.userSub, sessionId: t.threadId, timestamp: t.startedAt.toISOString() },
      },
      ...spans.map((s) => {
        const end = new Date(s.startedAt.getTime() + s.durationMs).toISOString();
        const common = {
          id: s.id,
          traceId: s.traceId,
          parentObservationId: s.parentId ?? undefined,
          name: s.name,
          startTime: s.startedAt.toISOString(),
          endTime: end,
          level: s.status === "error" ? "ERROR" : "DEFAULT",
          metadata: s.attributes,
        };
        return s.kind === "llm"
          ? {
              id: randomUUID(),
              type: "generation-create",
              timestamp: now,
              body: { ...common, usage: { input: s.inputTokens, output: s.outputTokens, unit: "TOKENS" } },
            }
          : { id: randomUUID(), type: "span-create", timestamp: now, body: common };
      }),
    ];
    const auth = Buffer.from(`${this.opts.publicKey}:${this.opts.secretKey}`).toString("base64");
    const res = await this.doFetch(`${this.opts.host.replace(/\/$/, "")}/api/public/ingestion`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
      body: JSON.stringify({ batch }),
    });
    if (!res.ok) throw new Error(`Langfuse ingestion failed: ${res.status}`);
  }
}
