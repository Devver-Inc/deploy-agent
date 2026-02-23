export interface RepoConfig {
  name: string;
  baseUrl: string;
  createdAt: string;
}

export interface ReposRegistry {
  [name: string]: RepoConfig;
}

export interface RepoRepository {
  getAll(): RepoConfig[];
  get(name: string): RepoConfig | undefined;
  set(name: string, config: RepoConfig): void;
  remove(name: string): void;
}
