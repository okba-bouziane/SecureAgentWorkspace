import { useEffect, useMemo, useState } from "react";
import { get } from "../lib/api";
import type { SpanRow, TraceRow } from "../lib/types";

interface Node {
  span: SpanRow;
  depth: number;
}

function flatten(spans: SpanRow[]): Node[] {
  const children = new Map<string | null, SpanRow[]>();
  for (const s of spans) {
    const key = s.parentId && spans.some((x) => x.id === s.parentId) ? s.parentId : null;
    children.set(key, [...(children.get(key) ?? []), s]);
  }
  const out: Node[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const s of (children.get(parent) ?? []).sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
      out.push({ span: s, depth });
      walk(s.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

const fmtMs = (ms: number | null) => (ms === null ? "-" : ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms.toFixed(ms < 10 ? 1 : 0)} ms`);
const fmtCost = (c: number) => (c === 0 ? "$0" : c < 0.0001 ? "<$0.0001" : `$${c.toFixed(4)}`);

export default function TracesPage() {
  const [traces, setTraces] = useState<TraceRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ trace: TraceRow; spans: SpanRow[] } | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    void get<{ traces: TraceRow[] }>("/traces?limit=50").then((r) => {
      setTraces(r.traces);
      setSelected((cur) => cur ?? r.traces[0]?.id ?? null);
    });
  }, []);
  useEffect(() => {
    if (!selected) return;
    void get<{ trace: TraceRow; spans: SpanRow[] }>(`/traces/${selected}`).then(setDetail);
  }, [selected]);

  const nodes = useMemo(() => (detail ? flatten(detail.spans) : []), [detail]);
  const t0 = detail ? new Date(detail.trace.startedAt).getTime() : 0;
  const total = Math.max(detail?.trace.durationMs ?? 1, ...nodes.map((n) => new Date(n.span.startedAt).getTime() - t0 + n.span.durationMs), 1);
  const sums = useMemo(
    () =>
      detail?.spans.reduce(
        (a, s) => ({ i: a.i + s.inputTokens, o: a.o + s.outputTokens, c: a.c + s.costUsd }),
        { i: 0, o: 0, c: 0 },
      ) ?? { i: 0, o: 0, c: 0 },
    [detail],
  );

  return (
    <div className="page">
      <div className="page-head">
        <h1>Traces</h1>
        <div className="muted">Every chat run is a trace: guardrails, LLM calls, tool calls, retrieval and the approval wait. Token counts come from the provider when reported, otherwise they are estimated. Cost is an estimate from configured prices.</div>
      </div>
      <div className="traces">
        <div className="card" style={{ padding: 8 }}>
          {traces.length === 0 && <div className="muted" style={{ padding: 10 }}>No traces yet. Send a chat message first.</div>}
          {traces.map((t) => (
            <button key={t.id} className={`trace-item${t.id === selected ? " active" : ""}`} onClick={() => setSelected(t.id)}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <b>{t.username ?? "user"}</b>
                <span className="muted small">{new Date(t.startedAt).toLocaleTimeString()}</span>
              </div>
              <div className="muted small">
                {fmtMs(t.durationMs)} - {t.spanCount} spans - {t.inputTokens + t.outputTokens} tokens - {fmtCost(t.costUsd)}
                {t.status === "error" && <span className="badge err" style={{ marginLeft: 6 }}>error</span>}
              </div>
            </button>
          ))}
        </div>
        <div className="card">
          {!detail && <div className="muted">Select a trace.</div>}
          {detail && (
            <>
              <div className="totals">
                <div className="score"><span>Duration</span><b>{fmtMs(detail.trace.durationMs)}</b></div>
                <div className="score"><span>Spans</span><b>{detail.spans.length}</b></div>
                <div className="score"><span>Tokens in / out</span><b>{sums.i} / {sums.o}</b></div>
                <div className="score"><span>Est. cost</span><b>{fmtCost(sums.c)}</b></div>
              </div>
              {nodes.map(({ span, depth }) => {
                const left = ((new Date(span.startedAt).getTime() - t0) / total) * 100;
                const width = (span.durationMs / total) * 100;
                return (
                  <div key={span.id}>
                    <div className="span-row">
                      <button className="span-name" style={{ paddingLeft: 4 + depth * 16 }} onClick={() => setOpen(open === span.id ? null : span.id)} title="Show attributes">
                        <span className="badge">{span.kind}</span>
                        <span>{span.name}</span>
                        {span.status === "error" && <span className="badge err">error</span>}
                        {span.inputTokens + span.outputTokens > 0 && <span className="muted small">{span.inputTokens}/{span.outputTokens} tok</span>}
                      </button>
                      <div className="bar-track">
                        <div className={`bar ${span.status === "error" ? "error" : span.kind}`} style={{ left: `${Math.min(left, 99)}%`, width: `${Math.max(width, 0.4)}%` }} />
                      </div>
                      <div className="dur">{fmtMs(span.durationMs)}</div>
                    </div>
                    {open === span.id && (
                      <div className="attrs mono">
                        <pre>{JSON.stringify(span.attributes, null, 2)}</pre>
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
