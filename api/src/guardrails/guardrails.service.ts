import { Inject, Injectable } from "@nestjs/common";
import { CONFIG } from "../common/tokens.js";
import type { Config } from "../config.js";
import { MetricsService } from "../metrics/metrics.service.js";
import { detectInjection, type InjectionVerdict } from "./injection.js";
import { redactPii, type RedactionResult } from "./pii.js";
import { wrapUntrusted, type WrappedOutput } from "./untrusted.js";

@Injectable()
export class GuardrailsService {
  constructor(
    @Inject(MetricsService) private readonly metrics: MetricsService,
    @Inject(CONFIG) private readonly cfg?: Pick<Config, "GUARD_MODEL" | "LLM_BASE_URL" | "LLM_API_KEY">,
  ) {}

  /** Layer 1: pattern heuristics. Layer 2 (optional): a prompt-injection classifier model. */
  async checkUserInput(text: string): Promise<InjectionVerdict> {
    const verdict = detectInjection(text);
    if (!verdict.blocked && this.cfg?.GUARD_MODEL) {
      const score = await this.classify(text);
      if (score !== null && score >= 0.5) {
        verdict.blocked = true;
        verdict.matches.push(`classifier:${score.toFixed(2)}`);
      }
    }
    if (verdict.blocked) this.metrics.guardrailEvents.inc({ type: "input_blocked" });
    return verdict;
  }

  wrapToolOutput(source: string, raw: string): WrappedOutput {
    const wrapped = wrapUntrusted(source, raw);
    if (wrapped.neutralised > 0) this.metrics.guardrailEvents.inc({ type: "tool_output_neutralised" }, wrapped.neutralised);
    return wrapped;
  }

  redactOutput(text: string): RedactionResult {
    const result = redactPii(text);
    const total = Object.values(result.redactions).reduce((a, b) => a + b, 0);
    if (total > 0) this.metrics.guardrailEvents.inc({ type: "pii_redacted" }, total);
    return result;
  }

  private async classify(text: string): Promise<number | null> {
    const cfg = this.cfg;
    if (!cfg?.GUARD_MODEL) return null;
    try {
      const res = await fetch(`${cfg.LLM_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.LLM_API_KEY}` },
        body: JSON.stringify({ model: cfg.GUARD_MODEL, messages: [{ role: "user", content: text.slice(0, 2000) }] }),
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const score = Number.parseFloat(body.choices?.[0]?.message?.content ?? "");
      return Number.isFinite(score) ? score : null;
    } catch {
      return null; // fail open: the heuristic layer already ran
    }
  }
}
