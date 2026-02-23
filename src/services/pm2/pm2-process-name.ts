export function buildProcessName(
  service: string,
  deploymentId: string,
  port: number,
): string {
  return `${service}-${deploymentId}-${port}`;
}
