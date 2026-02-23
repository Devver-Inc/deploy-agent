import { t } from "elysia";
import { DeployStage, ErrorCode } from "./types";

export const RepoSchema = t.Object({
  name: t.String(),
  createdAt: t.String(),
  pushUrl: t.String(),
});

export const ApiErrorSchema = t.Object({
  success: t.Literal(false),
  error: t.Object({
    code: t.String(),
    message: t.String(),
    details: t.Optional(t.String()),
  }),
});

export const PM2ProcessSchema = t.Object({
  name: t.String(),
  pm_id: t.Number(),
  status: t.Union([
    t.Literal("online"),
    t.Literal("stopped"),
    t.Literal("errored"),
  ]),
  cpu: t.Number(),
  memory: t.Number(),
});

export const DeploymentSchema = t.Object({
  repo: t.String(),
  branch: t.String(),
  deploymentId: t.String(),
  services: t.Record(t.String(), t.Number()),
  processes: t.Array(PM2ProcessSchema),
});

export const DeploySuccessSchema = t.Object({
  success: t.Literal(true),
  branch: t.String(),
  commit: t.String(),
  services: t.Record(
    t.String(),
    t.Object({ port: t.Number(), url: t.String() }),
  ),
  duration: t.Number(),
});

export const DeployErrorSchema = t.Object({
  success: t.Literal(false),
  error: t.Object({
    code: t.Enum(ErrorCode),
    message: t.String(),
    logs: t.Optional(t.String()),
    step: t.Optional(t.Number()),
    stage: t.Optional(t.Enum(DeployStage)),
    service: t.Optional(t.String()),
    rollback: t.Optional(
      t.Object({
        attempted: t.Boolean(),
        success: t.Boolean(),
        message: t.Optional(t.String()),
      }),
    ),
  }),
  duration: t.Number(),
});

export const LogEntrySchema = t.Object({
  service: t.String(),
  level: t.Union([t.Literal("info"), t.Literal("error")]),
  message: t.String(),
  timestamp: t.String(),
});
