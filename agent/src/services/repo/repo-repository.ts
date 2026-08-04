import type { RepoConfig } from "../../types";

export type { RepoConfig } from "../../types";

export interface ReposRegistry {
  [name: string]: RepoConfig;
}

export interface RepoRepository {
  getAll(): RepoConfig[];
  get(name: string): RepoConfig | undefined;
  set(name: string, config: RepoConfig): void;
  remove(name: string): void;
}
