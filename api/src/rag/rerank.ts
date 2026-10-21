import { queryTerms } from "./text.js";

export interface RerankInput {
  id: number;
  title: string;
  content: string;
  fusedScore: number;
}

export interface Reranked<T extends RerankInput> {
  item: T;
  rerankScore: number;
}

/**
 * A deliberately simple, deterministic reranker. It blends the fused score
 * with query-term coverage and a bonus for adjacent query terms. A
 * cross-encoder would replace this in production.
 */
export function rerank<T extends RerankInput>(query: string, items: T[], topK: number): Reranked<T>[] {
  const terms = queryTerms(query);
  const maxFused = Math.max(...items.map((i) => i.fusedScore), Number.EPSILON);
  const scored = items.map((item) => {
    const haystack = `${item.title} ${item.content}`.toLowerCase();
    const covered = terms.filter((t) => haystack.includes(t)).length;
    const coverage = terms.length ? covered / terms.length : 0;
    let phrase = 0;
    for (let i = 0; i < terms.length - 1; i++) {
      if (haystack.includes(`${terms[i]} ${terms[i + 1]}`)) {
        phrase = 1;
        break;
      }
    }
    const rerankScore = 0.6 * (item.fusedScore / maxFused) + 0.3 * coverage + 0.1 * phrase;
    return { item, rerankScore };
  });
  return scored.sort((a, b) => b.rerankScore - a.rerankScore || a.item.id - b.item.id).slice(0, topK);
}
