import { describe, expect, it } from "vitest";
import type { SpanRow } from "../../lib/types";
import { flattenSpans } from "./spans";

const span = (id: string, parentId: string | null, startedAt: string): SpanRow => ({
  id,
  parentId,
  name: id,
  kind: "tool",
  status: "ok",
  startedAt,
  durationMs: 1,
  attributes: {},
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
});

describe("flattenSpans", () => {
  it("lists children right after their parent with increasing depth", () => {
    const nodes = flattenSpans([
      span("b", "a", "2026-01-01T00:00:02Z"),
      span("c", null, "2026-01-01T00:00:03Z"),
      span("a", null, "2026-01-01T00:00:01Z"),
    ]);
    expect(nodes.map((n) => [n.span.id, n.depth])).toEqual([["a", 0], ["b", 1], ["c", 0]]);
  });

  it("treats a span whose parent is missing as a root", () => {
    expect(flattenSpans([span("x", "gone", "2026-01-01T00:00:01Z")])).toEqual([expect.objectContaining({ depth: 0 })]);
  });
});
