import { createHash } from "crypto";
import { config } from "../../config";

function hostLabel(deploymentId: string): string {
  const label = deploymentId
    .replace(".", "--")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "");
  if (label.length <= 63) return label;
  const hash = createHash("sha256").update(deploymentId).digest("hex").slice(0, 8);
  return `${label.slice(0, 54).replace(/-+$/, "")}-${hash}`;
}

export function publicHost(
  deploymentId: string,
  previewDomain = config.previewDomain,
): string {
  if (!previewDomain) throw new Error("DEVVER_PREVIEW_DOMAIN is not set.");
  return `${hostLabel(deploymentId)}.${previewDomain}`;
}
