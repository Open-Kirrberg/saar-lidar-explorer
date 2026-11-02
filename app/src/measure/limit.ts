/** Run async tasks with at most `limit` in flight (tasks start lazily, in order). Pure; tested in tests/measure.test.ts. */
export async function runLimited(tasks: readonly (() => Promise<unknown>)[], limit: number): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const t = tasks[next++];
      try {
        await t();
      } catch {
        /* each task reports its own failure */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, worker));
}
