import type { SpanRecord, SpanSink, TraceRecord } from "./types.js";

/** Keeps everything in memory. Used by tests. */
export class MemorySink implements SpanSink {
  traces = new Map<string, TraceRecord>();
  spans: SpanRecord[] = [];
  async startTrace(t: TraceRecord) {
    this.traces.set(t.id, { ...t });
  }
  async writeSpan(s: SpanRecord) {
    this.spans.push(s);
  }
  async endTrace(t: TraceRecord) {
    this.traces.set(t.id, { ...t });
  }
}
