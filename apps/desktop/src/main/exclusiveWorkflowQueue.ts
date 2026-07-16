function cancellationError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("任务已取消。", "AbortError");
}

async function waitForPrevious(previous: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return previous.catch(() => undefined);
  if (signal.aborted) throw cancellationError(signal);
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(cancellationError(signal));
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    previous.catch(() => undefined).then(() => {
      cleanup();
      resolve();
    });
  });
}

export class ExclusiveWorkflowQueue {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(key: string, operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => current);
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    try {
      await waitForPrevious(previous, signal);
      signal?.throwIfAborted();
      return await operation();
    } finally {
      release();
    }
  }
}
