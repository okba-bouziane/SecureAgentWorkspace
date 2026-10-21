import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { estimateCostUsd, type Pricing } from "./cost.js";
import type { SpanKind, SpanRecord, SpanSink, TraceRecord } from "./types.js";

interface Ctx {
  traceId: string;
  spanId: string | null;
  pending: Promise<unknown>[];
}

export interface SpanHandle {
  setAttributes(attrs: Record<string, unknown>): void;
  setUsage(inputTokens: number, outputTokens: number): void;
}

const NOOP: SpanHandle = { setAttributes() {}, setUsage() {} };
const newId = (bytes: number) => randomBytes(bytes).toString("hex");

/**
 * Small OpenTelemetry-style tracer: a trace holds a tree of spans, context
 * travels through AsyncLocalStorage, and finished spans go to the configured sinks.
 */
export class Tracer {
  private readonly als = new AsyncLocalStorage<Ctx>();

  constructor(
    private readonly sinks: SpanSink[],
    private readonly pricing: Pricing,
  ) {}

  currentTraceId(): string | undefined {
    return this.als.getStore()?.traceId;
  }

  async trace<T>(
    meta: { name: string; userSub: string; username?: string; threadId?: string },
    fn: () => Promise<T>,
  ): Promise<T> {
    const startedAt = new Date();
    const t0 = performance.now();
    const record: TraceRecord = { id: newId(16), status: "ok", startedAt, ...meta };
    await this.fanOut((s) => s.startTrace(record));
    const ctx: Ctx = { traceId: record.id, spanId: null, pending: [] };
    try {
      return await this.als.run(ctx, fn);
    } catch (err) {
      record.status = "error";
      throw err;
    } finally {
      await Promise.allSettled(ctx.pending);
      record.endedAt = new Date();
      record.durationMs = performance.now() - t0;
      await this.fanOut((s) => s.endTrace(record));
    }
  }

  async span<T>(name: string, kind: SpanKind, fn: (h: SpanHandle) => Promise<T>, attrs: Record<string, unknown> = {}): Promise<T> {
    const parent = this.als.getStore();
    if (!parent) return fn(NOOP);

    const attributes: Record<string, unknown> = { ...attrs };
    let inputTokens = 0;
    let outputTokens = 0;
    const handle: SpanHandle = {
      setAttributes: (a) => Object.assign(attributes, a),
      setUsage: (i, o) => {
        inputTokens = i;
        outputTokens = o;
      },
    };
    const spanId = newId(8);
    const startedAt = new Date();
    const t0 = performance.now();
    let status: "ok" | "error" = "ok";
    const ctx: Ctx = { traceId: parent.traceId, spanId, pending: parent.pending };
    try {
      return await this.als.run(ctx, () => fn(handle));
    } catch (err) {
      status = "error";
      attributes.error = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      const record: SpanRecord = {
        id: spanId,
        traceId: parent.traceId,
        parentId: parent.spanId,
        name,
        kind,
        status,
        startedAt,
        durationMs: performance.now() - t0,
        attributes,
        inputTokens,
        outputTokens,
        costUsd: estimateCostUsd(inputTokens, outputTokens, this.pricing),
      };
      parent.pending.push(this.fanOut((s) => s.writeSpan(record)));
    }
  }

  private async fanOut(op: (s: SpanSink) => Promise<void>): Promise<void> {
    await Promise.allSettled(this.sinks.map((s) => op(s)));
  }
}
