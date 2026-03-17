export function prepareSmartCommand(cmd: string, port: number): string {
  const needsDoubleDash = /\b(npm|yarn|pnpm|bun)\s+run\b/.test(cmd);
  const hasPortInCmd = /--port\s+\d+|PORT=\d+/.test(cmd);

  if (hasPortInCmd) return cmd.replace(/--port\s+\d+/, `--port ${port}`);

  const flags = `--port ${port} --host 0.0.0.0`;
  return needsDoubleDash ? `${cmd} -- ${flags}` : `${cmd} ${flags}`;
}

export function buildEnvVars(
  extraEnv: Record<string, string>,
): Record<string, string> {
  return { NODE_ENV: "production", ...extraEnv };
}
