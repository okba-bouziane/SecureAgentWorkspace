import { Plus } from "lucide-react";
import type { ThreadRow } from "../../lib/types";

interface Props {
  threads: ThreadRow[] | null;
  activeId: string;
  onOpen(id: string): void;
  onNew(): void;
}

export function ThreadList({ threads, activeId, onOpen, onNew }: Props) {
  return (
    <nav className="threads" aria-label="Conversations">
      <button className="btn new-chat" onClick={onNew}>
        <Plus size={15} aria-hidden /> New chat
      </button>
      <div className="threads-label muted small">Recent</div>
      {threads?.length === 0 && <div className="threads-empty muted small">No conversations yet.</div>}
      {threads?.map((t) => (
        <button
          key={t.id}
          className={`thread${t.id === activeId ? " active" : ""}`}
          aria-current={t.id === activeId ? "true" : undefined}
          onClick={() => onOpen(t.id)}
          title={t.title}
        >
          {t.title}
        </button>
      ))}
    </nav>
  );
}
