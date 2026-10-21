import { describe, expect, it } from "vitest";
import { applyEvent, newTurn, turnsFromHistory } from "./turns";

describe("applyEvent", () => {
  it("builds a turn from a stream of events", () => {
    let t = newTurn("List orders");
    t = applyEvent(t, { type: "tool_call", id: "c1", name: "list_orders", args: {}, write: false });
    expect(t.steps[0]?.state).toBe("running");
    t = applyEvent(t, { type: "tool_result", id: "c1", name: "list_orders", isError: false, preview: "[]", neutralised: 0, durationMs: 12 });
    t = applyEvent(t, { type: "message", content: "None.", redactions: {} });
    t = applyEvent(t, { type: "done", status: "completed" });
    expect(t).toMatchObject({ running: false, answer: "None.", steps: [{ state: "done", durationMs: 12 }] });
  });

  it("holds an approval request and clears it when the tool runs", () => {
    let t = newTurn("Ship 4");
    t = applyEvent(t, { type: "approval_required", calls: [{ id: "w", name: "update_order_status", args: { id: 4 } }] });
    expect(t.approval).toHaveLength(1);
    t = applyEvent(t, { type: "tool_call", id: "w", name: "update_order_status", args: { id: 4 }, write: true });
    expect(t.approval).toBeNull();
  });

  it("deduplicates sources by tag", () => {
    const s = { tag: "S1", chunkId: 1, documentId: "d", title: "T", ordinal: 0, snippet: "", suspicious: false, ftsRank: 1, vectorRank: 1, fusedScore: 0.03, rerankScore: 1 };
    let t = newTurn("q");
    t = applyEvent(t, { type: "sources", sources: [s] });
    t = applyEvent(t, { type: "sources", sources: [s] });
    expect(t.sources).toHaveLength(1);
  });
});

describe("turnsFromHistory", () => {
  it("groups messages into turns and restores a pending approval", () => {
    const turns = turnsFromHistory(
      [
        { role: "user", content: "Ship order 4" },
        { role: "assistant", content: "", toolCalls: [{ id: "w", name: "update_order_status", args: { id: 4 } }] },
      ],
      [{ id: "w", name: "update_order_status", args: { id: 4 } }],
    );
    expect(turns).toHaveLength(1);
    expect(turns[0]?.approval).toHaveLength(1);
    expect(turns[0]?.steps[0]?.write).toBe(true);
  });
});
