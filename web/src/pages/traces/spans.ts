import type { SpanRow } from "../../lib/types";

export interface SpanNode {
  span: SpanRow;
  depth: number;
}

/** Orders spans depth-first (parent, then its children by start time) and records each span's depth for indentation. */
export function flattenSpans(spans: SpanRow[]): SpanNode[] {
  const ids = new Set(spans.map((s) => s.id));
  const childrenOf = new Map<string | null, SpanRow[]>();
  for (const s of spans) {
    const parent = s.parentId && ids.has(s.parentId) ? s.parentId : null; // orphans become roots
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), s]);
  }
  const out: SpanNode[] = [];
  const walk = (parent: string | null, depth: number) => {
    const children = [...(childrenOf.get(parent) ?? [])].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    for (const span of children) {
      out.push({ span, depth });
      walk(span.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
