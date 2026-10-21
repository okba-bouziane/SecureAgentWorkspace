import { Injectable } from "@nestjs/common";
import client from "prom-client";

@Injectable()
export class MetricsService {
  readonly registry = new client.Registry();

  readonly httpRequests = new client.Counter({
    name: "saw_http_requests_total",
    help: "HTTP requests",
    labelNames: ["method", "route", "status"],
    registers: [this.registry],
  });
  readonly httpDuration = new client.Histogram({
    name: "saw_http_request_duration_seconds",
    help: "HTTP request latency",
    labelNames: ["method", "route"],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });
  readonly chatRuns = new client.Counter({
    name: "saw_chat_runs_total",
    help: "Agent runs by outcome",
    labelNames: ["outcome"],
    registers: [this.registry],
  });
  readonly toolCalls = new client.Counter({
    name: "saw_tool_calls_total",
    help: "Tool calls by tool and outcome",
    labelNames: ["tool", "outcome"],
    registers: [this.registry],
  });
  readonly guardrailEvents = new client.Counter({
    name: "saw_guardrail_events_total",
    help: "Guardrail interventions",
    labelNames: ["type"],
    registers: [this.registry],
  });
  readonly llmTokens = new client.Counter({
    name: "saw_llm_tokens_total",
    help: "LLM tokens (provider-reported or estimated)",
    labelNames: ["direction"],
    registers: [this.registry],
  });
  readonly llmLatency = new client.Histogram({
    name: "saw_llm_call_duration_seconds",
    help: "LLM call latency",
    buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
    registers: [this.registry],
  });
  readonly searchLatency = new client.Histogram({
    name: "saw_search_duration_seconds",
    help: "Hybrid search latency",
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    registers: [this.registry],
  });
  readonly ingestionJobs = new client.Counter({
    name: "saw_ingestion_jobs_total",
    help: "Ingestion jobs by outcome",
    labelNames: ["outcome"],
    registers: [this.registry],
  });
  readonly rateLimited = new client.Counter({
    name: "saw_rate_limited_total",
    help: "Requests rejected by the rate limiter",
    registers: [this.registry],
  });

  constructor() {
    client.collectDefaultMetrics({ register: this.registry, prefix: "saw_" });
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }
}
