import { AlertTriangle, RefreshCw } from "lucide-react";
import { Banner, EmptyNote, Loading } from "../../components/ui";
import type { DeadLetterRow, DocumentRow } from "../../lib/types";

const STATUS_BADGE: Record<DocumentRow["status"], string> = { ready: "ok", failed: "err", queued: "warn", processing: "warn" };

interface Props {
  /** null while the first load is in flight. */
  docs: DocumentRow[] | null;
  deadLetters: DeadLetterRow[];
  error: string | null;
  onRefresh(): void;
}

export function DocumentsPanel({ docs, deadLetters, error, onRefresh }: Props) {
  return (
    <section className="card" aria-labelledby="docs-title">
      <div className="card-head">
        <h2 id="docs-title">Documents</h2>
        <button className="btn sm ghost" onClick={onRefresh} aria-label="Refresh documents" title="Refresh">
          <RefreshCw size={14} aria-hidden />
        </button>
      </div>
      {error && <Banner kind="err">{error}</Banner>}
      {docs === null && !error && <Loading label="Loading documents" />}
      {docs && docs.length === 0 && <EmptyNote>No documents yet.</EmptyNote>}
      {docs && docs.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Chunks</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td>
                    {d.title}
                    {d.suspicious && (
                      <div>
                        <span className="badge err">
                          <AlertTriangle size={11} aria-hidden /> poisoned content flagged
                        </span>
                      </div>
                    )}
                    {d.error && <div className="small error-text">{d.error}</div>}
                  </td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[d.status]}`}>{d.status}</span>
                  </td>
                  <td>{d.chunkCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {deadLetters.length > 0 && (
        <div className="dead-letters">
          <h2>Dead-letter queue</h2>
          {deadLetters.map((d) => (
            <div key={d.documentId + d.error} className="small">
              <b>{d.title}</b> failed after {d.attempts} attempts: <span className="muted">{d.error}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
