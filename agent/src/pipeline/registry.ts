import { gitManager } from "../services/git-manager";
import { pm2Manager } from "../services/pm2-manager";
import { nginxManager } from "../services/nginx-manager";
import { portManager } from "../services/port-manager";
import { repoManager } from "../services/repo-manager";
import type { ServiceRegistry } from "./contracts";

export type { ServiceRegistry } from "./contracts";

export const defaultRegistry: ServiceRegistry = {
  git: gitManager,
  pm2: pm2Manager,
  nginx: nginxManager,
  port: portManager,
  repo: repoManager,
};
