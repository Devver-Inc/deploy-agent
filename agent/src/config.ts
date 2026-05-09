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
  mongo: {
    port: 27017,
    caFile:
      process.env.DEVVER_MONGO_CA_FILE ??
      "/var/run/secrets/devver/mongo/ca.crt",
    connectionString: process.env.DEVVER_MONGO_CONNECTION_STRING,
    connectionStringFile: process.env.DEVVER_MONGO_CONNECTION_STRING_FILE,
    tlsAllowInvalidCertificates:
      process.env.DEVVER_MONGO_TLS_ALLOW_INVALID_CERTIFICATES === "true"
        ? true
        : process.env.DEVVER_MONGO_TLS_ALLOW_INVALID_CERTIFICATES === "false"
          ? false
          : process.env.NODE_ENV !== "production",
  },
} as const;
