/**
 * Bounded-concurrency async map.
 *
 * Runs `mapper` over `items` with at most `concurrency` tasks in flight.
 * Results preserve input order.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let next = 0;

  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await mapper(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}
