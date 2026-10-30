# Deploy Agent

One container per project. It holds the project's bare Git repos, runs every deployment
(branch × service) as a PM2 process and serves each one on its own preview host through nginx.

The agent is an executor: the backend says "run this ref with these commands on this host"
and the agent makes it exist. Ids, hosts and the user env come from the backend.

## Stack

- **Runtime:** [Bun](https://bun.sh) + [Elysia](https://elysiajs.com)
- **Processes:** PM2 (`pm2-runtime` is PID 1 and supervises nginx, sshd and the agent)
- **Proxy:** nginx, one static server with a `map $host → port`
- **Git:** sshd + git-shell, reached only through the git-gateway
- **Container:** Alpine Linux

## Ports

| Port | Who reaches it | Serves |
| ---- | -------------- | ------ |
| 80   | Internet (Traefik `*.preview` route) | Previews only; unknown hosts get 404 |
| 8080 | backend only (Service + NetworkPolicy) | Agent API, `x-devver-secret` header |
| 22   | git-gateway only (NetworkPolicy) | `git push` |

## Environment Variables

| Variable | Required | Description |
| -------- | -------- | ----------- |
| `DEVVER_SECRET` | **Yes** | Per-project API token (from Vault through ESO) |
| `DEVVER_PROJECT_ID` | **Yes** | Project id; suffix of every preview host |
| `DEVVER_PREVIEW_DOMAIN` | **Yes** | e.g. `preview.devver.app` |
| `DEVVER_ORGANIZATION_ID` | No | Returned by `/__devver/context` |
| `DEVVER_BACKEND_URL` | No | Internal backend URL; enables the boot reconcile |
| `DEVVER_WIDGET_URL` | No | Overlay script injected before `</body>` |
| `DEVVER_GIT_GATEWAY_PUBLIC_KEY` | No | The only key sshd accepts. Unset: no SSH access |
| `DEVVER_MONGO_CONNECTION_STRING` | No | Used by `GET /databases/mongo` |

User code never sees these: install, build and start get only `PATH`, `HOME`, `LANG`, `TZ`,
the runtime's cache variables, `PORT`/`HOST` and the deployment's own env.

## API

Types: [agent/src/contract.ts](agent/src/contract.ts). Every error is `{ code, message, logs? }`.

| Method | Path | Result |
| ------ | ---- | ------ |
| `PUT` | `/deployments/:id` | `text/event-stream`: `phase`… then `done` (status) or `failed` (error) |
| `GET` | `/deployments` | `DeploymentStatus[]` |
| `DELETE` | `/deployments/:id` | 204 |
| `POST` | `/deployments/:id/{restart,stop,start}` | 204 |
| `GET` | `/deployments/:id/logs?tail=200` | `text/plain` |
| `POST` / `DELETE` | `/repos/:name` | 204 (idempotent) |
| `GET` | `/databases/mongo` | databases of the project's Mongo |
| `GET` | `/health` | no auth |

```ts
PUT body = { repo, ref, host, service: { root?, install?, build?, start? }, env? }
DeploymentStatus = { id, repo, ref, commit, host, status: "running" | "stopped" | "failed", startedAt }
```

The same `id` with the same commit, host and service is a no-op, so the backend can resend
everything safely. Push URL: `ssh://<projectId>@<git host>/app/repos/<repo>.git`.

## How a deploy runs

1. **checkout:** `git worktree add --detach` of the commit into a new `deployments/<id>/<release>`.
2. **install:** skipped when the lockfiles hash equals the running release's: `node_modules` is
   hardlinked (`cp -al`) from it. Otherwise the runtime's install runs (caches on the same volume).
3. **build:** `.next/cache` and `node_modules/.vite` are hardlinked from the previous release first.
4. **start:** PM2 starts the app on a new free port; it must answer on `$PORT` within 60 s.
5. **route:** `routes.map` is rewritten, nginx reloads, the old process and directory are deleted.

A failure before the swap deletes only the new release; the old one keeps serving. Releases are
never moved. A Node app sent without `build`/`start` runs its `dev` script.

A push only stores the code: deploys happen when the CLI asks the backend. On boot the agent asks the backend
for the desired deployments (`GET /internal/projects/:projectId/deployments`) and applies them.

## Container layout

```
/app
├── repos/<repo>.git               # bare repos (git user)
├── deployments/<id>/<release>/    # immutable releases (deploy user)
├── caches/                        # npm/bun/pip/gem/go, same volume as deployments (hardlinks)
├── data/deployments.json          # id → running release, port, host, commit
└── nginx/routes.map, widget.conf  # generated
```

## Development

```bash
cd agent
bun install
bun run typecheck && bun test
```
