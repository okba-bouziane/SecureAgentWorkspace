import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import { llmConfigured, retryDelayMs, withRateLimitRetry } from "../src/agent/llm.js";
import type { ChatModelLike } from "../src/agent/graph.js";

describe("provider rate-limit handling", () => {
  it("reads the wait time from a provider message", () => {
    expect(retryDelayMs("Rate limit reached ... Please try again in 6.495s. Need more tokens?")).toBe(6745);
    expect(retryDelayMs("try again in 1m2.5s")).toBe(62750);
    expect(retryDelayMs("429 Too Many Requests")).toBe(5000);
    expect(retryDelayMs("connection reset")).toBeNull();
  });

  const flaky = (failures: number, message: string): { model: ChatModelLike; calls: () => number } => {
    let calls = 0;
    return {
      calls: () => calls,
      model: {
        bindTools: () => ({
          async invoke(_m: BaseMessage[]) {
            calls += 1;
            if (calls <= failures) throw new Error(message);
            return new AIMessage("ok");
          },
        }),
      },
    };
  };

  it("waits and retries on a short 429", async () => {
    const waits: number[] = [];
    const { model, calls } = flaky(2, "Rate limit reached. Please try again in 2s.");
    const wrapped = withRateLimitRetry(model, 25_000, async (ms) => void waits.push(ms));
    const res = await wrapped.bindTools([]).invoke([]);
    expect(res.content).toBe("ok");
    expect(calls()).toBe(3);
    expect(waits).toEqual([2250, 2250]);
  });

  it("gives up when the wait is too long or the error is something else", async () => {
    const slow = withRateLimitRetry(flaky(1, "try again in 2m0s").model, 25_000, async () => undefined);
    await expect(slow.bindTools([]).invoke([])).rejects.toThrow("try again");
    const other = withRateLimitRetry(flaky(1, "boom").model, 25_000, async () => undefined);
    await expect(other.bindTools([]).invoke([])).rejects.toThrow("boom");
  });

  it("requires a key for hosted providers but not for local servers", () => {
    expect(llmConfigured({ LLM_API_KEY: "", LLM_BASE_URL: "https://api.groq.com/openai/v1" })).toBe(false);
    expect(llmConfigured({ LLM_API_KEY: "k", LLM_BASE_URL: "https://api.groq.com/openai/v1" })).toBe(true);
    expect(llmConfigured({ LLM_API_KEY: "", LLM_BASE_URL: "http://localhost:11434/v1" })).toBe(true);
  });
});
