import { ChatOpenAI } from "@langchain/openai";
import type { Config } from "../config.js";
import type { AIMessage, BaseMessage } from "@langchain/core/messages";
import type { ChatModelLike } from "./graph.js";

export type ChatModelFactory = () => ChatModelLike;

const LOCAL_HOST = /(localhost|127\.0\.0\.1|host\.docker\.internal|ollama)/i;

/** Ollama and other local servers accept any key; hosted providers need a real one. */
export function llmConfigured(cfg: Pick<Config, "LLM_API_KEY" | "LLM_BASE_URL">): boolean {
  return cfg.LLM_API_KEY.length > 0 || LOCAL_HOST.test(cfg.LLM_BASE_URL);
}

/** One OpenAI-compatible endpoint: Groq by default, Ollama or any other compatible server by env. */
export function openAiCompatibleFactory(cfg: Config): ChatModelFactory {
  return () =>
    withRateLimitRetry(
      new ChatOpenAI({
        model: cfg.LLM_MODEL,
        apiKey: cfg.LLM_API_KEY || "not-needed",
        temperature: cfg.LLM_TEMPERATURE,
        configuration: { baseURL: cfg.LLM_BASE_URL },
        maxRetries: 1,
        ...(cfg.LLM_REASONING_EFFORT ? { modelKwargs: { reasoning_effort: cfg.LLM_REASONING_EFFORT } } : {}),
      }) as unknown as ChatModelLike,
    );
}

/** Seconds a provider asks us to wait, from "try again in 6.5s" style messages. */
export function retryDelayMs(message: string): number | null {
  const m = message.match(/try again in\s+(?:(\d+)m)?\s*([\d.]+)s/i);
  if (!m) return /429|rate limit/i.test(message) ? 5000 : null;
  return Math.ceil(((Number(m[1] ?? 0) * 60) + Number(m[2])) * 1000) + 250;
}

/** Free-tier providers enforce tokens-per-minute limits; wait out short 429s instead of failing the run. */
export function withRateLimitRetry(model: ChatModelLike, maxWaitMs = 50_000, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))): ChatModelLike {
  return {
    bindTools(tools) {
      const bound = model.bindTools(tools);
      return {
        async invoke(messages: BaseMessage[]): Promise<AIMessage> {
          for (let attempt = 0; ; attempt++) {
            try {
              return await bound.invoke(messages);
            } catch (err) {
              const wait = retryDelayMs(err instanceof Error ? err.message : String(err));
              if (wait === null || wait > maxWaitMs || attempt >= 6) throw err;
              // Providers under-report the wait when other requests share the window, so back off at least a little more each time.
              await sleep(Math.max(wait, 4000 * (attempt + 1)));
            }
          }
        },
      };
    },
  };
}
