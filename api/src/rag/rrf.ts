export interface RankedList {
  name: string;
  /** Ids ordered best first. */
  ids: number[];
}

export interface FusedItem {
  id: number;
  score: number;
  /** 1-based rank in each list that contained the item. */
  ranks: Record<string, number>;
}

/**
 * Reciprocal Rank Fusion: score(d) = sum over lists of 1 / (k + rank(d)).
 * Rewards documents that rank well in several lists without needing comparable scores.
 */
export function reciprocalRankFusion(lists: RankedList[], k = 60): FusedItem[] {
  const fused = new Map<number, FusedItem>();
  for (const list of lists) {
    list.ids.forEach((id, index) => {
      const rank = index + 1;
      const item = fused.get(id) ?? { id, score: 0, ranks: {} };
      item.score += 1 / (k + rank);
      item.ranks[list.name] = rank;
      fused.set(id, item);
    });
  }
  return [...fused.values()].sort((a, b) => b.score - a.score || a.id - b.id);
}
