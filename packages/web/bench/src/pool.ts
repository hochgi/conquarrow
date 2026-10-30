/**
 * Bounded concurrency with results in input order, so a run's output never
 * depends on which job happened to finish first.
 */

export const runPool = async <T, R>(
  items: readonly T[],
  cap: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  if (!Number.isInteger(cap) || cap < 1) throw new Error(`concurrency must be a positive integer, got ${String(cap)}`);
  const results = new Map<number, R>();
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index] as T;
      results.set(index, await worker(item, index));
    }
  };
  await Promise.all(Array.from({ length: Math.min(cap, items.length) }, lane));
  return items.map((_, index) => results.get(index) as R);
};

/** Job `j` goes to chunk `j mod k`, with `k = min(n, jobs)`. */
export const chunkRoundRobin = <T>(items: readonly T[], n: number): T[][] => {
  const k = Math.max(1, Math.min(n, items.length));
  const chunks: T[][] = Array.from({ length: k }, () => []);
  items.forEach((item, index) => chunks[index % k]?.push(item));
  return chunks;
};

/** Inverse of {@link chunkRoundRobin} over each chunk's in-order results. */
export const unchunk = <R>(chunkResults: readonly (readonly R[])[], total: number): R[] => {
  const k = chunkResults.length;
  return Array.from({ length: total }, (_, index) => {
    const hit = chunkResults[index % k]?.[Math.floor(index / k)];
    if (hit === undefined) throw new Error(`worker returned no result for job ${String(index)}`);
    return hit;
  });
};
