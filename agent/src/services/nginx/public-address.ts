import { createHash } from "crypto";
import { config } from "../../config";

// One wildcard (*.preview...) serves every project, so the project goes in the
// same DNS label: Traefik routes `^.+--<projectId>\.<previewDomain>$` to this pod.
function hostLabel(deploymentId: string, projectId: string): string {
  const suffix = `--${projectId.toLowerCase()}`;
  const max = 63 - suffix.length;
  const label = deploymentId
    .replace(".", "--")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "");
  if (label.length <= max) return label + suffix;
  const hash = createHash("sha256").update(deploymentId).digest("hex").slice(0, 8);
  return `${label.slice(0, max - 9).replace(/-+$/, "")}-${hash}${suffix}`;
}

export function publicHost(
  deploymentId: string,
  previewDomain = config.previewDomain,
  projectId = config.projectId,
): string {
  if (!previewDomain || !projectId) {
    throw new Error("DEVVER_PREVIEW_DOMAIN and DEVVER_PROJECT_ID are required.");
  }
  return `${hostLabel(deploymentId, projectId)}.${previewDomain}`;
}
