/**
 * A simple promise-chain mutex for serializing async operations.
 *
 * Usage:
 *   const mutex = new AsyncMutex();
 *   const result = await mutex.run(() => doExclusiveWork());
 */
export class AsyncMutex {
  private queue: Promise<void> = Promise.resolve();

  async run<T>(fn: () => Promise<T> | T): Promise<T> {
    let release: () => void = () => {};
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.queue;
    this.queue = previous.then(() => next);
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

/**
 * A keyed mutex — maintains independent locks per string key.
 * Completed entries are automatically cleaned up.
 *
 * Usage:
 *   const mutex = new KeyedAsyncMutex();
 *   const result = await mutex.run("key", () => doExclusiveWork());
 */
export class KeyedAsyncMutex {
  private locks = new Map<string, Promise<void>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release: () => void = () => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chain = previous.then(() => current);
    this.locks.set(key, chain);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(key) === chain) {
        this.locks.delete(key);
      }
    }
  }
}
