export const config = {
  paths: {
    deployments: "/app/deployments",
    repos: "/app/repos",
    pm2Data: "/app/data/pm2",
    portsFile: "/app/data/ports.json",
    reposFile: "/app/data/repos.json",
    nginxSitesDir: "/app/nginx/sites.d",
  },
  previewDomain: process.env.DEVVER_PREVIEW_DOMAIN?.toLowerCase(),
  projectId: process.env.DEVVER_PROJECT_ID,
  databases: {
    mongo: process.env.DEVVER_MONGO_CONNECTION_STRING,
    postgres: process.env.DEVVER_POSTGRES_CONNECTION_STRING,
    redis: process.env.DEVVER_REDIS_CONNECTION_STRING,
  },
} as const;
