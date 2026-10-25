import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  PORT: z.coerce.number().int().default(3001),
  WEB_ORIGIN: z.string().default("http://localhost:5173"),
  DATABASE_URL: z.string().default("postgres://saw:saw@localhost:5433/saw"),
  REDIS_URL: z.string().default("redis://localhost:6380"),

  OIDC_ISSUER: z.string().default("http://localhost:8081/realms/securemcp"),
  /** Where signing keys are fetched. Defaults to the issuer's certs endpoint. */
  OIDC_JWKS_URL: z.string().optional(),
  OIDC_AUDIENCE: z.string().default("mcp-server"),

  MCP_URL: z.string().default("http://localhost:3102/mcp"),

  LLM_BASE_URL: z.string().default("https://api.groq.com/openai/v1"),
  LLM_API_KEY: z.string().default(""),
  LLM_MODEL: z.string().default("openai/gpt-oss-120b"),
  /** Optional second guardrail layer: a prompt-injection classifier served on the same OpenAI-compatible endpoint. */
  GUARD_MODEL: z.string().optional(),
  /** Passed to reasoning models (for example gpt-oss): low | medium | high. Empty means provider default. */
  LLM_REASONING_EFFORT: z.string().default(""),
  LLM_TEMPERATURE: z.coerce.number().default(0),
  /** USD per 1M tokens, used only for the cost estimate shown on traces. */
  LLM_PRICE_IN_PER_M: z.coerce.number().default(0.15),
  LLM_PRICE_OUT_PER_M: z.coerce.number().default(0.6),

  EMBEDDING_MODEL: z.string().default("Xenova/all-MiniLM-L6-v2"),
  HF_CACHE_DIR: z.string().optional(),

  CHAT_RATE_LIMIT: z.coerce.number().int().default(20),
  CHAT_RATE_WINDOW_SECONDS: z.coerce.number().int().default(60),

  /** Daily caps on agent runs (0 = off). Protects a shared free LLM quota on public demos. */
  DAILY_RUN_CAP_GLOBAL: z.coerce.number().int().default(0),
  DAILY_RUN_CAP_PER_USER: z.coerce.number().int().default(0),

  INGEST_ATTEMPTS: z.coerce.number().int().default(3),
  INGEST_BACKOFF_MS: z.coerce.number().int().default(2000),
  INGEST_CONCURRENCY: z.coerce.number().int().default(2),
  SEED_ON_START: bool.default(false),
  SEED_DIR: z.string().default("./seed"),

  LANGFUSE_HOST: z.string().optional(),
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),

  MAX_AGENT_STEPS: z.coerce.number().int().default(6),

  /** Port of the worker's small /metrics and probe endpoint. */
  WORKER_METRICS_PORT: z.coerce.number().int().default(9101),
});

export type Config = z.infer<typeof schema> & { jwksUrl: string };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.parse(env);
  return {
    ...parsed,
    jwksUrl: parsed.OIDC_JWKS_URL ?? `${parsed.OIDC_ISSUER}/protocol/openid-connect/certs`,
  };
}
