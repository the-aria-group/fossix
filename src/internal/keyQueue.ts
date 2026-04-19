export class KeyQueue {
  private readonly chainByKey = new Map<string, Promise<unknown>>();

  public enqueue<T>(key: string, callback: () => Promise<T>): Promise<T> {
    const current = this.chainByKey.get(key) ?? Promise.resolve(undefined);
    const chained = current.then(callback, callback);

    const cleanup = chained.finally(() => {
      if (this.chainByKey.get(key) === cleanup) {
        this.chainByKey.delete(key);
      }
    });

    this.chainByKey.set(key, cleanup);
    return chained;
  }
}
