export type SpanKind = "agent" | "guardrail" | "llm" | "tool" | "retrieval" | "embedding" | "approval" | "internal";

export interface TraceRecord {
  id: string;
  userSub: string;
  username?: string;
  threadId?: string;
  name: string;
  status: "ok" | "error";
  startedAt: Date;
  endedAt?: Date;
  durationMs?: number;
}

export interface SpanRecord {
  id: string;
  traceId: string;
  parentId: string | null;
  name: string;
  kind: SpanKind;
  status: "ok" | "error";
  startedAt: Date;
  durationMs: number;
  attributes: Record<string, unknown>;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/** Where finished spans go. Several sinks can run at once (Postgres, Langfuse, memory in tests). */
export interface SpanSink {
  startTrace(trace: TraceRecord): Promise<void>;
  writeSpan(span: SpanRecord): Promise<void>;
  endTrace(trace: TraceRecord): Promise<void>;
}
