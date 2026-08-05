import {
  getRuntimeEnv,
  type RuntimeLanguage,
} from "../pipeline/runtime-detector";

export function prepareStartCommand(
  cmd: string,
  port: number,
  language?: RuntimeLanguage,
  needsCliPort = false,
): string {
  if (
    language !== "node" ||
    (!needsCliPort && !/(^|\s)vite(?:\s|$)/.test(cmd))
  ) {
    return cmd;
  }

  const needsDoubleDash = /\b(npm|yarn|pnpm|bun)\s+run\b/.test(cmd);
  const hasPortInCmd = /--port(?:=|\s+)\S+|\bPORT=\S+/.test(cmd);

  if (hasPortInCmd) return cmd;

  const flags = `--port ${port} --host 0.0.0.0`;
  return needsDoubleDash ? `${cmd} -- ${flags}` : `${cmd} ${flags}`;
}

/**
 * Builds the environment variables for a deployed process.
 * Merges cache directories (so installs reuse persistent volumes)
 * with the user-provided extra env and sensible defaults.
 */
export function buildEnvVars(
  extraEnv: Record<string, string>,
  language?: RuntimeLanguage,
  servicePath?: string,
): Record<string, string> {
  return {
    ...(language === "node" ? { NODE_ENV: "production" } : {}),
    ...(language && servicePath ? getRuntimeEnv(language, servicePath) : {}),
    ...extraEnv,
  };
}
