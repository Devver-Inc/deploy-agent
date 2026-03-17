import { KeyedAsyncMutex } from "../../utils/async-mutex";

export class DeploymentLock {
  private mutex = new KeyedAsyncMutex();

  async withLock<T>(deploymentId: string, work: () => Promise<T>): Promise<T> {
    return this.mutex.run(deploymentId, work);
  }
}
