import { EmptyNote } from "../../components/ui";
import { formatCost, formatMs } from "../../lib/format";
import type { TraceRow } from "../../lib/types";

interface Props {
  traces: TraceRow[];
  selectedId: string | null;
  onSelect(id: string): void;
}

export function TraceList({ traces, selectedId, onSelect }: Props) {
  if (traces.length === 0) return <EmptyNote>No traces yet. Send a chat message first.</EmptyNote>;
  return (
    <div className="trace-list">
      {traces.map((t) => (
        <button key={t.id} className={`trace-item${t.id === selectedId ? " active" : ""}`} aria-pressed={t.id === selectedId} onClick={() => onSelect(t.id)}>
          <div className="trace-item-head">
            <b>{t.username ?? "user"}</b>
            <span className="muted small">{new Date(t.startedAt).toLocaleTimeString()}</span>
          </div>
          <div className="muted small">
            {formatMs(t.durationMs)} - {t.spanCount} spans - {t.inputTokens + t.outputTokens} tokens - {formatCost(t.costUsd)}
            {t.status === "error" && <span className="badge err">error</span>}
          </div>
        </button>
      ))}
    </div>
  );
}
