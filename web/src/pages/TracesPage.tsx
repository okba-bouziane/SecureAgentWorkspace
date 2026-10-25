import { useEffect, useState } from "react";
import { Banner, EmptyNote, Loading } from "../components/ui";
import { get } from "../lib/api";
import { errorText } from "../lib/errors";
import type { SpanRow, TraceRow } from "../lib/types";
import { TraceDetail } from "./traces/TraceDetail";
import { TraceList } from "./traces/TraceList";

const TRACE_LIMIT = 50;

interface TraceWithSpans {
  trace: TraceRow;
  spans: SpanRow[];
}

export default function TracesPage() {
  const [traces, setTraces] = useState<TraceRow[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TraceWithSpans | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    get<{ traces: TraceRow[] }>(`/traces?limit=${TRACE_LIMIT}`)
      .then((r) => {
        setTraces(r.traces);
        setSelectedId(r.traces[0]?.id ?? null);
      })
      .catch((e) => setError(errorText(e, "Could not load traces")));
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let stale = false; // ignore the answer if another trace was picked meanwhile
    setDetail(null);
    get<TraceWithSpans>(`/traces/${selectedId}`)
      .then((d) => !stale && setDetail(d))
      .catch((e) => !stale && setError(errorText(e, "Could not load the trace")));
    return () => {
      stale = true;
    };
  }, [selectedId]);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Traces</h1>
        <div className="muted">
          Every chat run is a trace: guardrails, LLM calls, tool calls, retrieval and the approval wait. Token counts come from the provider when reported, otherwise they are estimated. Cost is an estimate from configured prices.
        </div>
      </div>
      {error && <Banner kind="err">{error}</Banner>}
      {traces === null && !error && <Loading label="Loading traces" />}
      {traces && (
        <div className="traces">
          <div className="card card-tight">
            <TraceList traces={traces} selectedId={selectedId} onSelect={setSelectedId} />
          </div>
          <div className="card">
            {traces.length === 0 && <EmptyNote>Select a trace once you have sent a message.</EmptyNote>}
            {traces.length > 0 && !detail && !error && <Loading label="Loading trace" />}
            {detail && <TraceDetail key={detail.trace.id} trace={detail.trace} spans={detail.spans} />}
          </div>
        </div>
      )}
    </div>
  );
}
