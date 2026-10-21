import { describe, expect, it } from "vitest";
import { detectInjection } from "../src/guardrails/injection.js";
import { redactPii } from "../src/guardrails/pii.js";
import { wrapUntrusted } from "../src/guardrails/untrusted.js";
import data from "./dataset.json" with { type: "json" };

describe("eval: guardrails", () => {
  const { attacks, benign, poisonedToolOutputs, piiSamples } = data.injection;

  it(`blocks attacks (rate >= ${data.thresholds.injectionDetectionRate}) without blocking benign questions`, () => {
    const missed = attacks.filter((a) => !detectInjection(a).blocked);
    const falsePositives = benign.filter((b) => detectInjection(b).blocked);
    const rate = 1 - missed.length / attacks.length;
    const fpr = falsePositives.length / benign.length;
    console.log(`[eval:injection] attacks=${attacks.length} detection=${rate.toFixed(2)} benign=${benign.length} false-positives=${fpr.toFixed(2)} missed=${JSON.stringify(missed)} fp=${JSON.stringify(falsePositives)}`);
    expect(rate).toBeGreaterThanOrEqual(data.thresholds.injectionDetectionRate);
    expect(fpr).toBeLessThanOrEqual(data.thresholds.injectionFalsePositiveRate);
  });

  it("neutralises poisoned tool output", () => {
    const clean = poisonedToolOutputs.filter((p) => wrapUntrusted("t", p).neutralised > 0);
    const rate = clean.length / poisonedToolOutputs.length;
    console.log(`[eval:injection] poisoned tool outputs=${poisonedToolOutputs.length} neutralised=${rate.toFixed(2)}`);
    expect(rate).toBeGreaterThanOrEqual(data.thresholds.toolOutputNeutralisationRate);
  });

  it("redacts PII samples", () => {
    const ok = piiSamples.filter((s) => !redactPii(s.text).text.includes(s.mustNotContain));
    const rate = ok.length / piiSamples.length;
    console.log(`[eval:pii] samples=${piiSamples.length} redacted=${rate.toFixed(2)}`);
    expect(rate).toBeGreaterThanOrEqual(data.thresholds.piiRedactionRate);
  });
});
