export async function runBoundedParallel<T, R>(
  items: T[],
  maxConcurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<Array<R | undefined>> {
  const concurrency = Math.max(1, Math.min(items.length || 1, Math.floor(maxConcurrency)));
  const results: Array<R | undefined> = Array.from({ length: items.length });
  let hasFailure = false;

  for (let start = 0; start < items.length && !hasFailure; start += concurrency) {
    const batch = items.slice(start, start + concurrency);
    const settled = await Promise.allSettled(batch.map((item, offset) => worker(item, start + offset)));

    settled.forEach((result, offset) => {
      const index = start + offset;
      if (result.status === "fulfilled") {
        results[index] = result.value;
      } else {
        hasFailure = true;
      }
    });
  }

  return results;
}
