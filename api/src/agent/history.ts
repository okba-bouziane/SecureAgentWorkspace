import { HumanMessage, ToolMessage, type AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { GuardrailsService } from "../guardrails/guardrails.service.js";
import { PREVIEW_LIMIT, type PendingCall, type SourceRef } from "./events.js";

/** One message as the web app shows it when a conversation is reopened. */
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

const UNTRUSTED_WRAPPER = /<untrusted_tool_output[^>]*>\n?([\s\S]*?)\n?<\/untrusted_tool_output>/;

type Redactor = Pick<GuardrailsService, "redactOutput">;

/** Turns a stored LangGraph message into the shape sent to the browser, redacting PII again on the way out. */
export function toHistoryItem(m: BaseMessage, guardrails: Redactor): HistoryItem {
  const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
  if (m instanceof HumanMessage) return { role: "user", content: text, id: m.id };

  if (m instanceof ToolMessage) {
    // The model saw the fenced text; the user only needs what is inside the fence.
    const inner = text.match(UNTRUSTED_WRAPPER)?.[1] ?? text;
    return {
      role: "tool",
      content: guardrails.redactOutput(inner).text.slice(0, PREVIEW_LIMIT),
      toolCallId: m.tool_call_id,
      name: m.name,
      isError: m.status === "error",
      sources: Array.isArray(m.artifact) ? (m.artifact as SourceRef[]) : undefined,
    };
  }

  const ai = m as AIMessage;
  return {
    role: "assistant",
    id: ai.id,
    content: guardrails.redactOutput(text).text,
    toolCalls: (ai.tool_calls ?? []).map((c) => ({ id: c.id ?? "", name: c.name, args: c.args as Record<string, unknown> })),
  };
}

/** The approval request a paused run is waiting on (empty when nothing is pending). */
export function pendingCallsOf(snapshot: { tasks?: { interrupts?: { value?: unknown }[] }[] }): PendingCall[] {
  const value = snapshot.tasks?.flatMap((t) => t.interrupts ?? [])[0]?.value as { calls?: PendingCall[] } | undefined;
  return value?.calls ?? [];
}
