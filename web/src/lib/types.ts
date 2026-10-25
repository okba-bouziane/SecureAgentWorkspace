export interface SourceRef {
  tag: string;
  chunkId: number;
  documentId: string;
  title: string;
  ordinal: number;
  snippet: string;
  suspicious: boolean;
  ftsRank: number | null;
  vectorRank: number | null;
  fusedScore: number;
  rerankScore: number;
}

export interface PendingCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type AgentEvent =
  | { type: "run_started"; threadId: string; traceId?: string }
  | { type: "guardrail"; verdict: "blocked"; matches: string[] }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown>; write: boolean }
  | { type: "tool_result"; id: string; name: string; isError: boolean; preview: string; neutralised: number; durationMs: number }
  | { type: "sources"; sources: SourceRef[] }
  | { type: "approval_required"; calls: PendingCall[] }
  | { type: "message"; content: string; redactions: Record<string, number> }
  | { type: "warning"; message: string }
  | { type: "error"; message: string }
  | { type: "done"; status: "completed" | "awaiting_approval" | "blocked" | "error" };

export interface HistoryItem {
  role: "user" | "assistant" | "tool";
  content: string;
  id?: string;
  toolCalls?: { id: string; name: string; args: Record<string, unknown> }[];
  toolCallId?: string;
  name?: string;
  isError?: boolean;
  sources?: SourceRef[];
}

export interface DocumentRow {
  id: string;
  title: string;
  source: string | null;
  status: "queued" | "processing" | "ready" | "failed";
  error: string | null;
  chunkCount: number;
  suspicious: boolean;
  uploadedBy: string;
  createdAt: string;
}

export interface SearchHit {
  chunkId: number;
  documentId: string;
  title: string;
  ordinal: number;
  content: string;
  suspicious: boolean;
  ftsRank: number | null;
  vectorRank: number | null;
  ftsScore: number | null;
  vectorScore: number | null;
  fusedScore: number;
  rerankScore: number;
}

export interface TraceRow {
  id: string;
  username: string | null;
  threadId: string | null;
  name: string;
  status: string;
  startedAt: string;
  durationMs: number | null;
  spanCount: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface SpanRow {
  id: string;
  parentId: string | null;
  name: string;
  kind: string;
  status: string;
  startedAt: string;
  durationMs: number;
  attributes: Record<string, unknown>;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface ThreadRow {
  id: string;
  title: string;
}

export interface DeadLetterRow {
  documentId: string;
  title: string;
  error: string;
  attempts: number;
}
