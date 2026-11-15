import { mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname } from "path";
import { config } from "./config";

interface RepoState {
  install?: string;
  prepared?: boolean;
}

function load(): Record<string, RepoState> {
  try {
    return JSON.parse(readFileSync(config.paths.repoState, "utf8"));
  } catch {
    return {};
  }
}

let state = load();

function update(repo: string, change: RepoState): void {
  state = { ...state, [repo]: { ...state[repo], ...change } };
  mkdirSync(dirname(config.paths.repoState), { recursive: true });
  const tmp = `${config.paths.repoState}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  renameSync(tmp, config.paths.repoState);
}

export const repoState = {
  install: (repo: string): string | undefined => state[repo]?.install,
  setInstall: (repo: string, install: string | undefined) => update(repo, { install }),
  prepared: (repo: string): boolean => !!state[repo]?.prepared,
  markPrepared: (repo: string) => update(repo, { prepared: true }),
};
