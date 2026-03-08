export function buildProcessName(
  service: string,
  deploymentId: string,
  port: number,
): string {
  return `${service}-${deploymentId}-${port}`;
}

export function matchesProcess(processName: string, service: string, deploymentId: string): boolean {
  return new RegExp(`^${service}-${deploymentId}-\\d+$`).test(processName);
}

export function matchesDeployment(processName: string, deploymentId: string): boolean {
  return new RegExp(`-${deploymentId}-\\d+$`).test(processName);
}
