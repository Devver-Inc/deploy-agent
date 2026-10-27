import { createHash } from "crypto";
import { safeBranch } from "../../utils/branch";
import { config } from "../../config";

export interface PublicAddress {
  host?: string;
  path: string;
}

export function deploymentPath(
  repo: string,
  branch: string,
  service: string,
): string {
  return `/${repo}/${safeBranch(branch)}${service !== "web" ? `/${service}` : ""}`;
}

function hostLabel(deploymentId: string): string {
  const label = deploymentId
    .replace(".", "--")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "");
  if (label.length <= 63) return label;
  const hash = createHash("sha256").update(deploymentId).digest("hex").slice(0, 8);
  return `${label.slice(0, 54).replace(/-+$/, "")}-${hash}`;
}

export function publicAddress(
  deploymentId: string,
  repo: string,
  branch: string,
  service: string,
  previewDomain = config.previewDomain,
): PublicAddress {
  return previewDomain
    ? { host: `${hostLabel(deploymentId)}.${previewDomain}`, path: "" }
    : { path: deploymentPath(repo, branch, service) };
}
