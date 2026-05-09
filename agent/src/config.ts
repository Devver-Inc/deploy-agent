export const config = {
  paths: {
    deployments: "/app/deployments",
    repos: "/app/repos",
    pm2Data: "/app/data/pm2",
    portsFile: "/app/data/ports.json",
    reposFile: "/app/data/repos.json",
    nginxConfDir: "/app/nginx/conf.d",
  },
  mongo: {
    connectionString: process.env.DEVVER_MONGO_CONNECTION_STRING,
  },
} as const;
