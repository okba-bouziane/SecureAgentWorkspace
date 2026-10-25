import { Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Banner } from "../../components/ui";
import { post } from "../../lib/api";
import type { Session } from "../../lib/auth";
import { errorText } from "../../lib/errors";

const MIN_CONTENT_LENGTH = 20; // same minimum the API enforces

interface Props {
  session: Session;
  onUploaded(): void;
}

export function UploadPanel({ session, onUploaded }: Props) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const allowed = session.isAdmin;

  async function readFile(file: File | undefined) {
    if (!file) return;
    setContent(await file.text());
    if (!title) setTitle(file.name.replace(/\.[^.]+$/, ""));
  }

  async function upload() {
    setMsg(null);
    setUploading(true);
    try {
      const result = await post<{ duplicate: boolean }>("/knowledge/documents", { title, content, source: "upload" });
      setMsg({
        kind: "ok",
        text: result.duplicate ? "Already indexed (same content, nothing queued)." : "Queued. The worker is chunking and embedding it.",
      });
      setTitle("");
      setContent("");
      if (fileInput.current) fileInput.current.value = "";
      onUploaded();
    } catch (e) {
      setMsg({ kind: "err", text: errorText(e, "Upload failed") });
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="card" aria-labelledby="upload-title">
      <h2 id="upload-title">Add a document</h2>
      {!allowed && (
        <Banner kind="warn">
          Only admins can add documents, because indexed text reaches every user's agent. You are signed in as {session.username}.
        </Banner>
      )}
      <div className="drop">
        <input ref={fileInput} type="file" accept=".md,.txt,text/markdown,text/plain" onChange={(e) => void readFile(e.target.files?.[0])} disabled={!allowed} aria-label="Choose a file" />
        <input type="text" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} disabled={!allowed} aria-label="Title" />
        <textarea rows={7} placeholder="Markdown or plain text" value={content} onChange={(e) => setContent(e.target.value)} disabled={!allowed} aria-label="Content" />
        <button className="btn primary" disabled={!allowed || uploading || !title.trim() || content.trim().length < MIN_CONTENT_LENGTH} onClick={() => void upload()}>
          <Upload size={15} aria-hidden /> {uploading ? "Queuing..." : "Ingest"}
        </button>
        {msg && <Banner kind={msg.kind}>{msg.text}</Banner>}
      </div>
    </section>
  );
}
