export const formatMs = (ms: number | null): string =>
  ms === null ? "-" : ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms.toFixed(ms < 10 ? 1 : 0)} ms`;

export const formatCost = (usd: number): string => (usd === 0 ? "$0" : usd < 0.0001 ? "<$0.0001" : `$${usd.toFixed(4)}`);
