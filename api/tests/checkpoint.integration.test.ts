import { HumanMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { afterAll, describe, expect, it } from "vitest";
import { buildAgentGraph } from "../src/agent/graph.js";
import { GuardrailsService } from "../src/guardrails/guardrails.service.js";
import { MetricsService } from "../src/metrics/metrics.service.js";
import { MemorySink } from "../src/tracing/memory-sink.js";
import { Tracer } from "../src/tracing/tracer.js";
import { aiCall, aiText, fakeTool, ScriptedChatModel, TEST_DATABASE_URL } from "./helpers.js";

describe.skipIf(!TEST_DATABASE_URL)("approval survives a restart (Postgres checkpointer)", () => {
  const savers: PostgresSaver[] = [];
  afterAll(async () => {
    await Promise.all(savers.map((s) => s.end()));
  });

  const build = (saver: PostgresSaver, model: ScriptedChatModel, tool: ReturnType<typeof fakeTool>) =>
    buildAgentGraph({
      model,
      tools: [tool],
      guardrails: new GuardrailsService(new MetricsService()),
      tracer: new Tracer([new MemorySink()], { inPerM: 0, outPerM: 0 }),
      emit: () => undefined,
      checkpointer: saver,
      maxSteps: 4,
    });

  it("pauses in one process and resumes in another with the same thread id", async () => {
    const first = PostgresSaver.fromConnString(TEST_DATABASE_URL!);
    await first.setup();
    savers.push(first);
    const thread = { configurable: { thread_id: `restart-${Date.now()}` } };
    const tool = fakeTool("update_order_status", true, () => ({ text: '{"id":4,"status":"shipped"}' }));

    const g1 = build(first, new ScriptedChatModel([aiCall("update_order_status", { id: 4, status: "shipped" })]), tool);
    await g1.invoke({ messages: [new HumanMessage("ship order 4")] }, thread);
    expect((await g1.getState(thread)).next).toEqual(["approval"]);

    // A brand new saver and graph, as after an API restart.
    const second = PostgresSaver.fromConnString(TEST_DATABASE_URL!);
    savers.push(second);
    const g2 = build(second, new ScriptedChatModel([aiText("Shipped.")]), tool);
    expect((await g2.getState(thread)).next).toEqual(["approval"]);
    await g2.invoke(new Command({ resume: { approved: true } }), thread);

    expect(tool.calls).toEqual([{ id: 4, status: "shipped" }]);
    expect((await g2.getState(thread)).next).toEqual([]);
  });
});
