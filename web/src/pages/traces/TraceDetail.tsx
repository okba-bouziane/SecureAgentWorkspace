import { useMemo, useState } from "react";
import { formatCost, formatMs } from "../../lib/format";
import type { SpanRow, TraceRow } from "../../lib/types";
import { flattenSpans } from "./spans";

interface Props {
  trace: TraceRow;
  spans: SpanRow[];
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="score">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

export function TraceDetail({ trace, spans }: Props) {
  const [openSpan, setOpenSpan] = useState<string | null>(null);
  const nodes = useMemo(() => flattenSpans(spans), [spans]);
  const traceStart = new Date(trace.startedAt).getTime();
  const offsetMs = (s: SpanRow) => new Date(s.startedAt).getTime() - traceStart;
  // The timeline is scaled to whichever is longer: the trace itself or the last span to finish.
  const timelineMs = Math.max(trace.durationMs ?? 1, ...spans.map((s) => offsetMs(s) + s.durationMs), 1);

  const totals = spans.reduce(
    (sum, s) => ({ input: sum.input + s.inputTokens, output: sum.output + s.outputTokens, cost: sum.cost + s.costUsd }),
    { input: 0, output: 0, cost: 0 },
  );

  return (
    <>
      <div className="totals">
        <Total label="Duration" value={formatMs(trace.durationMs)} />
        <Total label="Spans" value={String(spans.length)} />
        <Total label="Tokens in / out" value={`${totals.input} / ${totals.output}`} />
        <Total label="Est. cost" value={formatCost(totals.cost)} />
      </div>
      <div className="timeline">
        {nodes.map(({ span, depth }) => {
          const left = (offsetMs(span) / timelineMs) * 100;
          const width = (span.durationMs / timelineMs) * 100;
          const expanded = openSpan === span.id;
          return (
            <div key={span.id}>
              <div className="span-row">
                <button
                  className="span-name"
                  style={{ paddingLeft: 4 + depth * 16 }}
                  onClick={() => setOpenSpan(expanded ? null : span.id)}
                  aria-expanded={expanded}
                  title="Show attributes"
                >
                  <span className="badge">{span.kind}</span>
                  <span className="span-label">{span.name}</span>
                  {span.status === "error" && <span className="badge err">error</span>}
                  {span.inputTokens + span.outputTokens > 0 && (
                    <span className="muted small">
                      {span.inputTokens}/{span.outputTokens} tok
                    </span>
                  )}
                </button>
                <div className="bar-track" aria-hidden>
                  <div
                    className={`bar ${span.status === "error" ? "error" : span.kind}`}
                    style={{ left: `${Math.min(left, 99)}%`, width: `${Math.max(width, 0.4)}%` }}
                  />
                </div>
                <div className="dur">{formatMs(span.durationMs)}</div>
              </div>
              {expanded && (
                <div className="attrs mono">
                  <pre>{JSON.stringify(span.attributes, null, 2)}</pre>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
