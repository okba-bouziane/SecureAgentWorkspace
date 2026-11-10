import { describe, expect, it } from "vitest";
import { normalizeCitations } from "../src/agent/citations.js";
import { aiCall, aiText, fakeTool, harness, ScriptedChatModel } from "./helpers.js";
import { HumanMessage } from "@langchain/core/messages";

describe("citations", () => {
  it("rewrites gpt-oss style tags to the [S12] form the UI renders", () => {
    expect(normalizeCitations("Costs 9.90 EUR【S290】.")).toBe("Costs 9.90 EUR[S290].");
    expect(normalizeCitations("See 【S12†L1-L4】 and 【 S3 】")).toBe("See [S12] and [S3]");
    expect(normalizeCitations("Both [S3, S9] and [S1; S2].")).toBe("Both [S3][S9] and [S1][S2].");
    expect(normalizeCitations("Steps [\u200bS300\u200b] and [ S4 ]")).toBe("Steps [S300] and [S4]");
  });

  it("leaves other text alone", () => {
    expect(normalizeCitations("Order [4] is 【paid】 [S7].")).toBe("Order [4] is 【paid】 [S7].");
  });

  it("is applied to the final answer the agent sends", async () => {
    const search = fakeTool("search_knowledge", false, () => ({ text: "[S290] Express costs 9.90 EUR." }));
    const model = new ScriptedChatModel([aiCall("search_knowledge", { query: "express" }), aiText("Express costs 9.90 EUR【S290】.")]);
    const h = harness({ model, tools: [search] });
    await h.run(() => h.graph.invoke({ messages: [new HumanMessage("express?")] }, { configurable: { thread_id: "c1" } }));
    const message = h.events.find((e) => e.type === "message");
    expect(message).toMatchObject({ content: "Express costs 9.90 EUR[S290]." });
  });
});
