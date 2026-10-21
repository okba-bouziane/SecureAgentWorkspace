import { AlertTriangle, RefreshCw, Search, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { get, post } from "../lib/api";
import type { Session } from "../lib/auth";
import type { DocumentRow, SearchHit } from "../lib/types";

const statusClass = (s: string) => (s === "ready" ? "ok" : s === "failed" ? "err" : "warn");

export default function KnowledgePage({ session }: { session: Session }) {
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [dead, setDead] = useState<{ documentId: string; title: string; error: string; attempts: number }[]>([]);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setDocs((await get<{ documents: DocumentRow[] }>("/knowledge/documents")).documents);
      if (session.isAdmin) setDead((await get<{ deadLetters: typeof dead }>("/knowledge/documents/dead-letters")).deadLetters);
    } catch {
      /* shown as an empty list */
    }
  }, [session.isAdmin]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  const inFlight = docs.some((d) => d.status === "queued" || d.status === "processing");
  useEffect(() => {
    if (!inFlight) return;
    const t = setInterval(() => void refresh(), 1500);
    return () => clearInterval(t);
  }, [inFlight, refresh]);

  async function onFile(f: File | undefined) {
    if (!f) return;
    setContent(await f.text());
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ""));
  }

  async function upload() {
    setMsg(null);
    try {
      const r = await post<{ id: string; status: string; duplicate: boolean }>("/knowledge/documents", { title, content, source: "upload" });
      setMsg({ kind: "ok", text: r.duplicate ? "Already indexed (same content, nothing queued)." : "Queued. The worker is chunking and embedding it." });
      setTitle("");
      setContent("");
      if (file.current) file.current.value = "";
      void refresh();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Upload failed" });
    }
  }

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    try {
      setHits((await get<{ hits: SearchHit[] }>(`/knowledge/search?q=${encodeURIComponent(query)}&k=6`)).hits);
    } catch (err) {
      setMsg({ kind: "err", text: err instanceof Error ? err.message : "Search failed" });
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Knowledge</h1>
        <div className="muted">Sample documents for a fictional shop, indexed in Postgres with full-text and vector search.</div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Hybrid search</h2>
        <form onSubmit={search} style={{ display: "flex", gap: 8 }}>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Try: how long do customers have to return a keyboard?" aria-label="Search query" />
          <button className="btn primary" type="submit" disabled={searching}>
            <Search size={15} /> Search
          </button>
        </form>
        {hits && (
          <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
            {hits.length === 0 && <div className="muted">No matching passages.</div>}
            {hits.map((h, i) => (
              <div key={h.chunkId} className="hit">
                <div className="hit-head">
                  <b>
                    {i + 1}. {h.title}
                  </b>
                  <span className="muted small">chunk {h.ordinal}</span>
                  {h.suspicious && (
                    <span className="badge err">
                      <AlertTriangle size={11} /> flagged: instruction-like text
                    </span>
                  )}
                </div>
                <div className="scores">
                  <div className="score">
                    <span>Full-text rank</span>
                    <b>{h.ftsRank ? `#${h.ftsRank}` : "-"}</b>
                  </div>
                  <div className="score">
                    <span>Vector rank</span>
                    <b>{h.vectorRank ? `#${h.vectorRank}` : "-"}</b>
                  </div>
                  <div className="score">
                    <span>Fused (RRF)</span>
                    <b>{h.fusedScore.toFixed(4)}</b>
                  </div>
                  <div className="score">
                    <span>Rerank</span>
                    <b>{h.rerankScore.toFixed(3)}</b>
                  </div>
                </div>
                <pre>{h.content}</pre>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid2">
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h2>Documents</h2>
            <button className="btn sm ghost" onClick={() => void refresh()} aria-label="Refresh">
              <RefreshCw size={14} />
            </button>
          </div>
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
                          <AlertTriangle size={11} /> poisoned content flagged
                        </span>
                      </div>
                    )}
                    {d.error && <div className="small" style={{ color: "var(--err)" }}>{d.error}</div>}
                  </td>
                  <td>
                    <span className={`badge ${statusClass(d.status)}`}>{d.status}</span>
                  </td>
                  <td>{d.chunkCount}</td>
                </tr>
              ))}
              {docs.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    No documents yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {dead.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <h2>Dead-letter queue</h2>
              {dead.map((d) => (
                <div key={d.documentId + d.error} className="small">
                  <b>{d.title}</b> failed after {d.attempts} attempts: <span className="muted">{d.error}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h2>Add a document</h2>
          {!session.isAdmin && <div className="banner warn" style={{ marginBottom: 10 }}>Only admins can add documents, because indexed text reaches every user's agent. You are signed in as {session.username}.</div>}
          <div className="drop">
            <input ref={file} type="file" accept=".md,.txt,text/markdown,text/plain" onChange={(e) => void onFile(e.target.files?.[0])} disabled={!session.isAdmin} aria-label="Choose a file" />
            <input type="text" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} disabled={!session.isAdmin} aria-label="Title" />
            <textarea rows={7} placeholder="Markdown or plain text" value={content} onChange={(e) => setContent(e.target.value)} disabled={!session.isAdmin} aria-label="Content" />
            <button className="btn primary" disabled={!session.isAdmin || !title.trim() || content.trim().length < 20} onClick={() => void upload()}>
              <Upload size={15} /> Ingest
            </button>
            {msg && <div className={`banner ${msg.kind === "ok" ? "warn" : "err"}`}>{msg.text}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
