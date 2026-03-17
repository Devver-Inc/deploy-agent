const BASE_DIR = process.env.DEVVER_DATA_DIR ?? "/app";

export const config = {
  paths: {
    deployments: `${BASE_DIR}/deployments`,
    repos: `${BASE_DIR}/repos`,
    pm2Data: `${BASE_DIR}/data/pm2`,
    portsFile: `${BASE_DIR}/data/ports.json`,
    reposFile: `${BASE_DIR}/data/repos.json`,
    nginxConfDir: `${BASE_DIR}/nginx/conf.d`,
  },
} as const;
