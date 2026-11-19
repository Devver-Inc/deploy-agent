import { writeFileSync } from "fs";
import { config } from "./config";
import { store } from "./store";
import { AsyncMutex } from "./utils/async-mutex";
import { pollUntil } from "./utils/poll-until";
import { runOrThrow } from "./utils/exec";

const mutex = new AsyncMutex();

export function widgetConf(url: string): string {
  if (!url) return "";
  // Encoded so nothing can close the quotes or become an nginx $variable.
  const src = url.replace(/["'<>$\\\s;{}]/g, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
  return `sub_filter '</body>' '<script src="${src}" defer></script></body>';\n`;
}

export function routesMap(routes: { host: string; port: number }[]): string {
  return routes.map(({ host, port }) => `${host} 127.0.0.1:${port};\n`).join("");
}

/** Each deployment's host, plus each alias on its deployment's port; an alias to a missing deployment is skipped. */
export function routeList(
  releases: { id: string; host: string; port: number }[],
  aliases: Record<string, string>,
): { host: string; port: number }[] {
  const byId = new Map(releases.map((r) => [r.id, r]));
  const aliased = Object.entries(aliases).flatMap(([host, id]) => {
    const release = byId.get(id);
    return release ? [{ host, port: release.port }] : [];
  });
  return [...releases, ...aliased];
}

/** Replaces the whole table, so replaying it changes nothing. */
export async function setAliases(table: { host: string; deploymentId: string }[]): Promise<void> {
  store.setAliases(Object.fromEntries(table.map((a) => [a.host, a.deploymentId])));
  await syncRoutes();
}

export function syncRoutes(expect?: { host: string; port: number }): Promise<void> {
  return mutex.run(async () => {
    writeFileSync(config.paths.routes, routesMap(routeList(store.all(), store.aliases())));
    await runOrThrow(["nginx", "-s", "reload"]);
    if (!expect) return;
    // `nginx -s reload` returns before the new workers serve the new map.
    await pollUntil(
      async () => {
        const response = await fetch("http://127.0.0.1/", {
          headers: { host: expect.host },
          redirect: "manual",
          signal: AbortSignal.timeout(2000),
        }).catch(() => undefined);
        return response?.headers.get("x-devver-upstream") === `127.0.0.1:${expect.port}`;
      },
      10_000,
      `nginx did not route ${expect.host} to port ${expect.port} within 10s`,
      50,
    );
  });
}

export function writeWidgetConf(): void {
  writeFileSync(config.paths.widget, widgetConf(config.widgetUrl));
}
