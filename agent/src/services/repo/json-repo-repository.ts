import { JsonRegistry } from "../../utils/registry";
import type {
  RepoConfig,
  RepoRepository,
  ReposRegistry,
} from "./repo-repository";
import { config } from "../../config";

export class JsonRepoRepository implements RepoRepository {
  private registry = new JsonRegistry<ReposRegistry>(
    config.paths.reposFile,
    {},
  );

  getAll(): RepoConfig[] {
    return Object.values(this.registry.entries);
  }

  get(name: string): RepoConfig | undefined {
    const repo = this.registry.get(name);
    if (!repo) return undefined;
    return { ...repo };
  }

  set(name: string, config: RepoConfig): void {
    this.registry.set(name, { ...config });
  }

  remove(name: string): void {
    this.registry.remove(name);
  }
}
