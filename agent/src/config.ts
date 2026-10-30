const env = process.env;

export const config = {
  port: Number(env.PORT ?? 8080),
  secret: env.DEVVER_SECRET,
  projectId: env.DEVVER_PROJECT_ID,
  organizationId: env.DEVVER_ORGANIZATION_ID,
  previewDomain: env.DEVVER_PREVIEW_DOMAIN?.toLowerCase(),
  widgetUrl: env.DEVVER_WIDGET_URL ?? "",
  backendUrl: env.DEVVER_BACKEND_URL?.replace(/\/+$/, ""),
  mongoUrl: env.DEVVER_MONGO_CONNECTION_STRING,
  paths: {
    repos: "/app/repos",
    deployments: "/app/deployments",
    caches: "/app/caches",
    store: "/app/data/deployments.json",
    routes: "/app/nginx/routes.map",
    widget: "/app/nginx/widget.conf",
  },
};
