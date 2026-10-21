import { INJECTION_PATTERNS } from "./patterns.js";

export interface InjectionVerdict {
  blocked: boolean;
  score: number;
  matches: string[];
}

export const BLOCK_THRESHOLD = 5;

/** Scores text against the instruction-like patterns. Used on user input (block) and tool output (neutralise). */
export function detectInjection(text: string, threshold = BLOCK_THRESHOLD): InjectionVerdict {
  let score = 0;
  const matches: string[] = [];
  for (const p of INJECTION_PATTERNS) {
    if (p.regex.test(text)) {
      score += p.weight;
      matches.push(p.name);
    }
  }
  return { blocked: score >= threshold, score, matches };
}
