import { useCallback, useEffect, useState } from "react";
import { get } from "../lib/api";
import type { Session } from "../lib/auth";
import { errorText } from "../lib/errors";
import type { DeadLetterRow, DocumentRow } from "../lib/types";
import { DocumentsPanel } from "./knowledge/DocumentsPanel";
import { SearchPanel } from "./knowledge/SearchPanel";
import { UploadPanel } from "./knowledge/UploadPanel";

const POLL_MS = 1500;

export default function KnowledgePage({ session }: { session: Session }) {
  const [docs, setDocs] = useState<DocumentRow[] | null>(null);
  const [deadLetters, setDeadLetters] = useState<DeadLetterRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setDocs((await get<{ documents: DocumentRow[] }>("/knowledge/documents")).documents);
      if (session.isAdmin) {
        setDeadLetters((await get<{ deadLetters: DeadLetterRow[] }>("/knowledge/documents/dead-letters")).deadLetters);
      }
      setError(null);
    } catch (e) {
      setError(errorText(e, "Could not load documents"));
    }
  }, [session.isAdmin]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // While the worker is still chunking and embedding, poll so the status badges update on their own.
  const inFlight = docs?.some((d) => d.status === "queued" || d.status === "processing") ?? false;
  useEffect(() => {
    if (!inFlight) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [inFlight, refresh]);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Knowledge</h1>
        <div className="muted">Sample documents for a fictional shop, indexed in Postgres with full-text and vector search.</div>
      </div>
      <SearchPanel />
      <div className="grid2">
        <DocumentsPanel docs={docs} deadLetters={deadLetters} error={error} onRefresh={() => void refresh()} />
        <UploadPanel session={session} onUploaded={() => void refresh()} />
      </div>
    </div>
  );
}
