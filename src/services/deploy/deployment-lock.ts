export class DeploymentLock {
  private locks = new Map<string, Promise<void>>();

  async withLock<T>(deploymentId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(deploymentId) ?? Promise.resolve();
    let release: () => void = () => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chain = previous.then(() => current);

    this.locks.set(deploymentId, chain);

    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.locks.get(deploymentId) === chain) {
        this.locks.delete(deploymentId);
      }
    }
  }
}
