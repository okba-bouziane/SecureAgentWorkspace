/** Longest tool result preview sent to the browser. */
export const PREVIEW_LIMIT = 1500;

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

export type Emit = (event: AgentEvent) => void;
