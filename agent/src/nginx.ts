import { writeFileSync } from "fs";
import { config } from "./config";
import { store } from "./store";
import { AsyncMutex } from "./utils/async-mutex";
import { pollUntil } from "./utils/poll-until";
import { runOrThrow } from "./utils/exec";

// nginx.conf has one static preview server: `map $host $devver_upstream` includes
// routes.map, regenerated from the store. A swap is one write + one reload.
const mutex = new AsyncMutex();

/** The widget reads its context from /__devver/context, so the snippet is static. */
export function widgetConf(url: string): string {
  if (!url) return "";
  // Encoded so nothing can close the quotes or become an nginx $variable.
  const src = url.replace(/["'<>$\\\s;{}]/g, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
  return `sub_filter '</body>' '<script src="${src}" defer></script></body>';\n`;
}

export function routesMap(routes: { host: string; port: number }[]): string {
  return routes.map(({ host, port }) => `${host} 127.0.0.1:${port};\n`).join("");
}

/** Applies the store's routes and waits until nginx serves `expect`, if given. */
export function syncRoutes(expect?: { host: string; port: number }): Promise<void> {
  return mutex.run(async () => {
    writeFileSync(config.paths.routes, routesMap(store.all()));
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
