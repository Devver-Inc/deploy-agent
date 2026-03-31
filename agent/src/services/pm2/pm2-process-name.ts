function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const regexCache = new Map<string, RegExp>();

function getCachedRegex(pattern: string): RegExp {
  let re = regexCache.get(pattern);
  if (!re) {
    re = new RegExp(pattern);
    regexCache.set(pattern, re);
  }
  return re;
}

export function buildProcessName(
  service: string,
  deploymentId: string,
  port: number,
): string {
  return `${service}-${deploymentId}-${port}`;
}

export function matchesProcess(
  processName: string,
  service: string,
  deploymentId: string,
): boolean {
  const pattern = `^${escapeRegex(service)}-${escapeRegex(deploymentId)}-\\d+$`;
  return getCachedRegex(pattern).test(processName);
}

export function matchesDeployment(
  processName: string,
  deploymentId: string,
): boolean {
  const pattern = `-${escapeRegex(deploymentId)}-\\d+$`;
  return getCachedRegex(pattern).test(processName);
}

export function extractPortFromProcessName(
  processName: string,
): number | undefined {
  const match = processName.match(/-(\d+)$/);
  return match ? parseInt(match[1], 10) : undefined;
}
