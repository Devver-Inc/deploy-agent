import { t, type Static } from "elysia";

// The agent's whole API surface. backend-service mirrors these types.
export const ID_PATTERN = "^[a-z0-9][a-z0-9-]{0,62}$";
export const REPO_PATTERN = "^[a-z0-9][a-z0-9-]{0,62}$";
export const HOST_PATTERN =
  "^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$";
// Branch or commit; no leading "-" so it can never be read as an option.
export const REF_PATTERN = "^(?!-)(?!.*\\.\\.)(?!.*//)[A-Za-z0-9._/-]{1,200}$";

export const ServiceSpec = t.Object({
  root: t.Optional(t.String()),
  install: t.Optional(t.String()),
  build: t.Optional(t.String()),
  start: t.Optional(t.String()),
});

export const Deployment = t.Object({
  repo: t.String({ pattern: REPO_PATTERN }),
  ref: t.String({ pattern: REF_PATTERN }),
  host: t.String({ pattern: HOST_PATTERN }),
  service: ServiceSpec,
  env: t.Optional(t.Record(t.String(), t.String())),
});

export type ServiceSpec = Static<typeof ServiceSpec>;
export type Deployment = Static<typeof Deployment>;

export type Phase = "checkout" | "install" | "build" | "start" | "route";

export interface DeploymentStatus {
  id: string;
  repo: string;
  ref: string;
  commit: string;
  host: string;
  status: "running" | "stopped" | "failed";
  startedAt: string;
}

export interface ApiError {
  code: string;
  message: string;
  logs?: string;
}
