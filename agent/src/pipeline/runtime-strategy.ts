import { existsSync, readFileSync } from "fs";
import { join } from "path";

export type RuntimeProxyProfile = "generic" | "node-frontend";
export type RuntimePhase = "install" | "build" | "run";

export interface RuntimePlan {
  readonly id: string;
  readonly installCommand: string;
  readonly startCommand?: string;
  readonly beforeInstallCommands: readonly string[];
  readonly proxyProfile: RuntimeProxyProfile;
  environment(servicePath: string, phase: RuntimePhase): Record<string, string>;
  prepareStart(command: string, port: number, servicePath: string): string;
}

interface RuntimeDetectionContext {
  readonly servicePath: string;
  readonly procfileStart?: string;
}

interface RuntimeStrategy {
  matches(context: RuntimeDetectionContext): boolean;
  resolve(context: RuntimeDetectionContext): RuntimePlan;
}

interface RuntimePlanOptions {
  id: string;
  installCommand: string;
  startCommand?: string;
  beforeInstallCommands?: readonly string[];
  proxyProfile?: RuntimeProxyProfile;
  environment?: (
    servicePath: string,
    phase: RuntimePhase,
  ) => Record<string, string>;
  prepareStart?: (
    command: string,
    port: number,
    servicePath: string,
  ) => string;
}

function createRuntimePlan({
  id,
  installCommand,
  startCommand,
  beforeInstallCommands = [],
  proxyProfile = "generic",
  environment = () => ({}),
  prepareStart = (command) => command,
}: RuntimePlanOptions): RuntimePlan {
  return {
    id,
    installCommand,
    startCommand,
    beforeInstallCommands,
    proxyProfile,
    environment,
    prepareStart,
  };
}

function hasFile(servicePath: string, file: string): boolean {
  return existsSync(join(servicePath, file));
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

function nodeEnvironment(
  _servicePath: string,
  phase: RuntimePhase,
): Record<string, string> {
  return {
    npm_config_cache: "/app/caches/npm",
    BUN_INSTALL_CACHE_DIR: "/app/caches/bun",
    ...(phase === "run" ? { NODE_ENV: "production" } : {}),
  };
}

function pythonEnvironment(servicePath: string): Record<string, string> {
  const virtualEnv = join(servicePath, ".venv");
  return {
    PIP_CACHE_DIR: "/app/caches/pip",
    POETRY_CACHE_DIR: "/app/caches/pip",
    POETRY_VIRTUALENVS_IN_PROJECT: "true",
    VIRTUAL_ENV: virtualEnv,
    PATH: `${join(virtualEnv, "bin")}:${process.env.PATH ?? ""}`,
    PYTHONUNBUFFERED: "1",
  };
}

function rubyEnvironment(servicePath: string): Record<string, string> {
  return {
    BUNDLE_CACHE_PATH: "/app/caches/gem",
    BUNDLE_GLOBAL_GEM_CACHE: "true",
    BUNDLE_PATH: join(servicePath, ".bundle"),
  };
}

function goEnvironment(): Record<string, string> {
  return {
    GOPATH: "/app/caches/go",
    GOMODCACHE: "/app/caches/go/pkg/mod",
    GOCACHE: "/app/caches/go/build",
  };
}

function prepareNodeStart(
  command: string,
  port: number,
  needsCliPort: boolean,
): string {
  if (!needsCliPort && !/(^|\s)vite(?:\s|$)/.test(command)) return command;
  if (/--port(?:=|\s+)\S+|\bPORT=\S+/.test(command)) return command;

  const flags = `--port ${port} --host 0.0.0.0`;
  return /\b(npm|yarn|pnpm|bun)\s+run\b/.test(command)
    ? `${command} -- ${flags}`
    : `${command} ${flags}`;
}

function createNodePlan(
  context: RuntimeDetectionContext,
  packageManager: "bun" | "npm",
  installCommand: string,
): RuntimePlan {
  const start = readNodeStart(context.servicePath, packageManager);
  return createRuntimePlan({
    id: `node/${packageManager}`,
    installCommand,
    startCommand: start?.command ?? context.procfileStart,
    proxyProfile: "node-frontend",
    environment: nodeEnvironment,
    prepareStart: (command, port) =>
      prepareNodeStart(command, port, start?.needsCliPort ?? false),
  });
}

function createPipPlan(
  context: RuntimeDetectionContext,
  installCommand: string,
): RuntimePlan {
  return createRuntimePlan({
    id: "python/pip",
    installCommand,
    startCommand: context.procfileStart,
    beforeInstallCommands: ["python -m venv .venv"],
    environment: pythonEnvironment,
    prepareStart: preparePythonStart,
  });
}

function preparePythonStart(
  command: string,
  _port: number,
  servicePath: string,
): string {
  const match = command.match(/^([A-Za-z0-9._-]+)(.*)$/);
  if (
    !match ||
    /^python(?:3(?:\.\d+)?)?$/.test(match[1]) ||
    !existsSync(join(servicePath, ".venv", "bin", match[1]))
  ) {
    return command;
  }
  return `python "$VIRTUAL_ENV/bin/${match[1]}"${match[2]}`;
}

// Order is part of the Interface: specific lockfiles win before generic manifests.
// A new runtime extends this catalog without changing pipeline stages.
const runtimeStrategies: readonly RuntimeStrategy[] = [
  {
    matches: ({ servicePath }) =>
      hasFile(servicePath, "package.json") &&
      (hasFile(servicePath, "bun.lock") || hasFile(servicePath, "bun.lockb")),
    resolve: (context) =>
      createNodePlan(context, "bun", "bun install --frozen-lockfile"),
  },
  {
    matches: ({ servicePath }) =>
      hasFile(servicePath, "package.json") &&
      hasFile(servicePath, "package-lock.json"),
    resolve: (context) => createNodePlan(context, "npm", "npm ci"),
  },
  {
    matches: ({ servicePath }) => hasFile(servicePath, "package.json"),
    resolve: (context) => createNodePlan(context, "bun", "bun install"),
  },
  {
    matches: ({ servicePath }) => {
      if (hasFile(servicePath, "poetry.lock")) return true;
      const pyproject = join(servicePath, "pyproject.toml");
      return (
        existsSync(pyproject) &&
        readFileSync(pyproject, "utf8").includes("[tool.poetry]")
      );
    },
    resolve: (context) =>
      createRuntimePlan({
        id: "python/poetry",
        installCommand: "poetry install --only main --no-interaction",
        startCommand: context.procfileStart,
        environment: pythonEnvironment,
        prepareStart: preparePythonStart,
      }),
  },
  {
    matches: ({ servicePath }) => hasFile(servicePath, "requirements.txt"),
    resolve: (context) =>
      createPipPlan(context, "python -m pip install -r requirements.txt"),
  },
  {
    matches: ({ servicePath }) => hasFile(servicePath, "pyproject.toml"),
    resolve: (context) => createPipPlan(context, "python -m pip install ."),
  },
  {
    matches: ({ servicePath }) => hasFile(servicePath, "Gemfile"),
    resolve: (context) =>
      createRuntimePlan({
        id: "ruby/bundler",
        installCommand: "bundle install",
        startCommand:
          context.procfileStart &&
          !context.procfileStart.startsWith("bundle exec ")
            ? `bundle exec ${context.procfileStart}`
            : context.procfileStart,
        environment: rubyEnvironment,
      }),
  },
  {
    matches: ({ servicePath }) => hasFile(servicePath, "go.mod"),
    resolve: (context) =>
      createRuntimePlan({
        id: "go/modules",
        installCommand: "go mod download",
        startCommand: context.procfileStart,
        environment: goEnvironment,
      }),
  },
];

export function resolveRuntime(servicePath: string): RuntimePlan | null {
  if (!existsSync(servicePath)) return null;

  const context: RuntimeDetectionContext = {
    servicePath,
    procfileStart: readProcfileStart(servicePath),
  };
  const strategy = runtimeStrategies.find((candidate) =>
    candidate.matches(context),
  );
  return strategy?.resolve(context) ?? null;
}
