/** Message to show for anything that was thrown, with a fallback for non-Error values. */
export const errorText = (err: unknown, fallback: string): string => (err instanceof Error ? err.message : fallback);
