/**
 * Map `items` through async `fn` with at most `limit` tasks in flight. Results keep input
 * order. Used to fan out file I/O (image cache fills, index rebuild reads) without starving
 * the JS thread or the SAF document provider.
 */
export const mapWithConcurrency = async <T, R>(
    items: readonly T[],
    limit: number,
    fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
    const results = new Array<R>(items.length);
    let next = 0;

    const worker = async () => {
        while (next < items.length) {
            const index = next;
            next += 1;
            results[index] = await fn(items[index], index);
        }
    };

    const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
    await Promise.all(workers);
    return results;
};
