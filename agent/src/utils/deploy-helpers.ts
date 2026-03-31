export function buildEnvVars(
  extraEnv: Record<string, string>,
): Record<string, string> {
  return { NODE_ENV: "production", ...extraEnv };
}
