import type { AgentEvent, HistoryItem, PendingCall, SourceRef } from "./types";

export interface Step {
  id: string;
  name: string;
  args: Record<string, unknown>;
  write: boolean;
  state: "running" | "done" | "error" | "waiting";
  preview?: string;
  durationMs?: number;
  neutralised?: number;
}

export interface Turn {
  id: string;
  question: string;
  steps: Step[];
  sources: SourceRef[];
  approval: PendingCall[] | null;
  answer?: string;
  redactions?: Record<string, number>;
  blocked?: boolean;
  warning?: string;
  error?: string;
  running: boolean;
}

export const newTurn = (question: string): Turn => ({ id: crypto.randomUUID(), question, steps: [], sources: [], approval: null, running: true });

/** Folds one streamed event into a turn. Pure, so it is easy to test. */
export function applyEvent(turn: Turn, e: AgentEvent): Turn {
  switch (e.type) {
    case "tool_call": {
      const exists = turn.steps.some((s) => s.id === e.id);
      const step: Step = { id: e.id, name: e.name, args: e.args, write: e.write, state: "running" };
      return { ...turn, approval: null, steps: exists ? turn.steps.map((s) => (s.id === e.id ? { ...s, state: "running" } : s)) : [...turn.steps, step] };
    }
    case "tool_result":
      return {
        ...turn,
        steps: turn.steps.map((s) =>
          s.id === e.id ? { ...s, state: e.isError ? "error" : "done", preview: e.preview, durationMs: e.durationMs, neutralised: e.neutralised } : s,
        ),
      };
    case "sources": {
      const known = new Set(turn.sources.map((s) => s.tag));
      return { ...turn, sources: [...turn.sources, ...e.sources.filter((s) => !known.has(s.tag))] };
    }
    case "approval_required":
      return { ...turn, approval: e.calls };
    case "guardrail":
      return { ...turn, blocked: true };
    case "message":
      return { ...turn, answer: e.content, redactions: e.redactions };
    case "warning":
      return { ...turn, warning: e.message };
    case "error":
      return { ...turn, error: e.message, running: false };
    case "done":
      return { ...turn, running: false };
    default:
      return turn;
  }
}

/** Rebuilds turns from the stored message history of a thread. */
export function turnsFromHistory(items: HistoryItem[], pending: PendingCall[]): Turn[] {
  const turns: Turn[] = [];
  let cur: Turn | null = null;
  for (const item of items) {
    if (item.role === "user") {
      cur = { ...newTurn(item.content), running: false };
      turns.push(cur);
    } else if (!cur) {
      continue;
    } else if (item.role === "assistant") {
      if (item.toolCalls?.length) {
        for (const c of item.toolCalls) cur.steps.push({ id: c.id, name: c.name, args: c.args, write: false, state: "waiting" });
      } else {
        cur.answer = item.content;
      }
    } else if (item.role === "tool") {
      const step = cur.steps.find((s) => s.id === item.toolCallId);
      if (step) {
        step.state = item.isError ? "error" : "done";
        step.preview = item.content;
      }
      for (const s of item.sources ?? []) if (!cur.sources.some((x) => x.tag === s.tag)) cur.sources.push(s);
    }
  }
  const last = turns.at(-1);
  if (last && pending.length) {
    last.approval = pending;
    for (const p of pending) {
      const step = last.steps.find((s) => s.id === p.id);
      if (step) step.write = true;
    }
  }
  return turns;
}
