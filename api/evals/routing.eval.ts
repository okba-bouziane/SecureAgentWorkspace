import { HumanMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import { aiCall, aiText, fakeTool, harness, ScriptedChatModel } from "../tests/helpers.js";
import data from "./dataset.json" with { type: "json" };

/**
 * Structural routing eval: given a model that emits the expected tool call, does the graph gate it correctly?
 * Read tools must run directly; write and unknown tools must pause for approval before executing.
 * (Whether the real model picks the right tool is measured separately by `npm run evals:live`.)
 */
describe("eval: tool routing and approval gating", () => {
  it(`gates every case correctly (accuracy >= ${data.thresholds.routingAccuracy})`, async () => {
    let correct = 0;
    for (const [i, c] of data.routing.entries()) {
      const tools = [
        fakeTool("list_orders", false, () => ({ text: "[]" })),
        fakeTool("get_order", false, () => ({ text: "{}" })),
        fakeTool("get_audit_log", false, () => ({ text: "[]" })),
        fakeTool("search_knowledge", false, () => ({ text: "no results" })),
        fakeTool("update_order_status", true, () => ({ text: "{}" })),
      ];
      const h = harness({ model: new ScriptedChatModel([aiCall(c.tool, c.args), aiText("done")]), tools });
      const cfg = { configurable: { thread_id: `route-${i}` } };
      await h.run(() => h.graph.invoke({ messages: [new HumanMessage(c.prompt)] }, cfg));
      const state = await h.graph.getState(cfg);
      const paused = state.next.includes("approval");
      const executed = tools.some((t) => (t as unknown as { calls: unknown[] }).calls.length > 0);
      const gate = paused ? "approval" : "direct";
      if (gate === c.gate && (gate === "direct" ? executed : !executed)) correct += 1;
      else console.log(`[eval:routing] MISMATCH ${c.prompt}: got ${gate}, expected ${c.gate}`);
    }
    const accuracy = correct / data.routing.length;
    console.log(`[eval:routing] cases=${data.routing.length} accuracy=${accuracy.toFixed(3)}`);
    expect(accuracy).toBeGreaterThanOrEqual(data.thresholds.routingAccuracy);
  });
});
