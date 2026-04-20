import { z } from "zod";

const ConfigSchema = z.object({
  baseDir: z.string().default("/app"),
  devverSecret: z.string().min(32),
  widgetUrl: z.string().url().startsWith("https://"),
  port: z.coerce.number().int().min(1).max(65535).default(8080),
});

export type Config = z.infer<typeof ConfigSchema>;

function loadConfig(): Config {
  const env = {
    baseDir: process.env.DEVVER_DATA_DIR ?? "/app",
    devverSecret: process.env.DEVVER_SECRET,
    widgetUrl: process.env.DEVVER_WIDGET_URL,
    port: process.env.PORT,
  };

  try {
    return ConfigSchema.parse(env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join(", ");
      throw new Error(`Config validation failed: ${issues}`);
    }
    throw error;
  }
}

const _config = loadConfig();

export const config = {
  baseDir: _config.baseDir,
  devverSecret: _config.devverSecret,
  widgetUrl: _config.widgetUrl,
  port: _config.port,
  paths: {
    deployments: `${_config.baseDir}/deployments`,
    repos: `${_config.baseDir}/repos`,
    pm2Data: `${_config.baseDir}/data/pm2`,
    portsFile: `${_config.baseDir}/data/ports.json`,
    reposFile: `${_config.baseDir}/data/repos.json`,
    nginxConfDir: `${_config.baseDir}/nginx/conf.d`,
  },
} as const;