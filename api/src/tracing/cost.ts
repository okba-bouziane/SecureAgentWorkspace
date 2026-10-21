/** Rough token estimate (about 4 characters per token) used when the provider reports no usage. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface Pricing {
  inPerM: number;
  outPerM: number;
}

export function estimateCostUsd(inputTokens: number, outputTokens: number, p: Pricing): number {
  return (inputTokens * p.inPerM + outputTokens * p.outPerM) / 1_000_000;
}
