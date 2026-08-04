import { existsSync, readFileSync } from "fs";
import { join } from "path";

export type RuntimeLanguage = "node" | "python" | "ruby" | "go";
export type RuntimePackageManager =
  | "bun"
  | "npm"
  | "pip"
  | "poetry"
  | "bundler"
  | "gomod";

export interface DetectedRuntime {
  language: RuntimeLanguage;
  packageManager: RuntimePackageManager;
  installCmd: string;
  startCmd?: string;
  needsCliPort?: boolean;
}

function readProcfileStart(servicePath: string): string | undefined {
  const procfile = join(servicePath, "Procfile");
  if (!existsSync(procfile)) return undefined;
  return readFileSync(procfile, "utf8")
    .split(/\r?\n/)
    .find((line) => line.startsWith("web:"))
    ?.slice(4)
    .trim();
}

function readNodeStart(
  servicePath: string,
  packageManager: "bun" | "npm",
): { command: string; needsCliPort: boolean } | undefined {
  try {
    const packageJson = JSON.parse(
      readFileSync(join(servicePath, "package.json"), "utf8"),
    ) as { scripts?: { start?: unknown } };
    const start = packageJson.scripts?.start;
    return typeof start === "string"
      ? {
          command: `${packageManager} run start`,
          needsCliPort: /(^|\s)vite(?:\s|$)/.test(start),
        }
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Detects the project runtime by inspecting lockfiles and manifest files
 * inside `servicePath` (the resolved root of the service within the worktree).
 *
 * Detection priority is based on specificity:
 *   1. bun.lockb / bun.lock → Bun (Node)
 *   2. package-lock.json     → npm (Node)
 *   3. poetry.lock/tool.poetry → Poetry (Python)
 *   4. requirements/pyproject → pip (Python)
 *   5. Gemfile               → bundler (Ruby)
 *   6. go.mod                → Go modules
 *
 * If none match, returns null — the caller decides whether to throw or fall back.
 */
export function detectRuntime(servicePath: string): DetectedRuntime | null {
  if (!existsSync(servicePath)) return null;

  // ── Node.js family ───────────────────────────────────────
  const hasPackageJson = existsSync(join(servicePath, "package.json"));
  const procfileStart = readProcfileStart(servicePath);

  if (hasPackageJson) {
    if (
      existsSync(join(servicePath, "bun.lock")) ||
      existsSync(join(servicePath, "bun.lockb"))
    ) {
      const start = readNodeStart(servicePath, "bun");
      return {
        language: "node",
        packageManager: "bun",
        installCmd: "bun install --frozen-lockfile",
        startCmd: start?.command ?? procfileStart,
        needsCliPort: start?.needsCliPort,
      };
    }

    if (existsSync(join(servicePath, "package-lock.json"))) {
      const start = readNodeStart(servicePath, "npm");
      return {
        language: "node",
        packageManager: "npm",
        installCmd: "npm ci",
        startCmd: start?.command ?? procfileStart,
        needsCliPort: start?.needsCliPort,
      };
    }

    // package.json without a lockfile — assume bun as default
    const start = readNodeStart(servicePath, "bun");
    return {
      language: "node",
      packageManager: "bun",
      installCmd: "bun install",
      startCmd: start?.command ?? procfileStart,
      needsCliPort: start?.needsCliPort,
    };
  }

  // ── Python family ────────────────────────────────────────
  const pyprojectPath = join(servicePath, "pyproject.toml");
  if (
    existsSync(join(servicePath, "poetry.lock")) ||
    (existsSync(pyprojectPath) &&
      readFileSync(pyprojectPath, "utf8").includes("[tool.poetry]"))
  ) {
    return {
      language: "python",
      packageManager: "poetry",
      installCmd: "poetry install --only main --no-interaction",
      startCmd: procfileStart,
    };
  }

  if (existsSync(join(servicePath, "requirements.txt"))) {
    return {
      language: "python",
      packageManager: "pip",
      installCmd: "python -m pip install -r requirements.txt",
      startCmd: procfileStart,
    };
  }

  if (existsSync(pyprojectPath)) {
    return {
      language: "python",
      packageManager: "pip",
      installCmd: "python -m pip install .",
      startCmd: procfileStart,
    };
  }

  // ── Ruby ──────────────────────────────────────────────────
  if (existsSync(join(servicePath, "Gemfile"))) {
    return {
      language: "ruby",
      packageManager: "bundler",
      installCmd: "bundle install",
      startCmd:
        procfileStart && !procfileStart.startsWith("bundle exec ")
          ? `bundle exec ${procfileStart}`
          : procfileStart,
    };
  }

  // ── Go ────────────────────────────────────────────────────
  if (existsSync(join(servicePath, "go.mod"))) {
    return {
      language: "go",
      packageManager: "gomod",
      installCmd: "go mod download",
      startCmd: procfileStart,
    };
  }

  return null;
}

/**
 * Returns the isolated runtime environment plus persistent download caches.
 * Application dependencies stay inside the service worktree.
 */
export function getRuntimeEnv(
  language: RuntimeLanguage,
  servicePath: string,
): Record<string, string> {
  switch (language) {
    case "node":
      return {
        npm_config_cache: "/app/caches/npm",
        BUN_INSTALL_CACHE_DIR: "/app/caches/bun",
      };
    case "python":
      return {
        PIP_CACHE_DIR: "/app/caches/pip",
        POETRY_CACHE_DIR: "/app/caches/pip",
        POETRY_VIRTUALENVS_IN_PROJECT: "true",
        VIRTUAL_ENV: join(servicePath, ".venv"),
        PATH: `${join(servicePath, ".venv", "bin")}:${process.env.PATH ?? ""}`,
        PYTHONUNBUFFERED: "1",
      };
    case "ruby":
      return {
        BUNDLE_CACHE_PATH: "/app/caches/gem",
        BUNDLE_GLOBAL_GEM_CACHE: "true",
        BUNDLE_PATH: join(servicePath, ".bundle"),
      };
    case "go":
      return {
        GOPATH: "/app/caches/go",
        GOMODCACHE: "/app/caches/go/pkg/mod",
        GOCACHE: "/app/caches/go/build",
      };
  }
}
