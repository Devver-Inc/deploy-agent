# Deploy Agent

Containerized deploy agent that manages Git repositories, per-branch deployments and PM2 processes — with Nginx as reverse proxy.

## Stack

- **Runtime:** [Bun](https://bun.sh)
- **Framework:** [Elysia](https://elysiajs.com)
- **Process Manager:** PM2
- **Reverse Proxy:** Nginx
- **Git Backend:** sshd + git-shell behind the git-gateway, git-http-backend via fcgiwrap (tokens)
- **Container:** Alpine Linux (Docker)

## Prerequisites

- Docker & Docker Compose
- (Local dev) Bun >= 1.x, Node.js >= 18

## Quick Start

### Docker (production)

```bash
docker compose up -d
```

The container exposes a single port:

| Port   | Service                                          |
| ------ | ------------------------------------------------ |
| `3080` | Nginx — reverse proxy for the API + Git HTTP backend |

> The Deploy Agent API runs internally on port `8080` and is proxied by Nginx. It is not exposed to the host.

### Local dev

```bash
cd agent
bun install
bun run dev   # watch mode
```

## Environment Variables

| Variable            | Required | Default      | Description                                          |
| ------------------- | -------- | ------------ | ---------------------------------------------------- |
| `DEVVER_SECRET`     | **Yes**  | —            | API authentication secret (`x-devver-secret` header) |
| `DEVVER_DATA_DIR`   | No       | `/app`       | Base directory for repos, deployments and data       |
| `DEVVER_WIDGET_URL` | No       | CDN jsdelivr | Devver overlay script URL                            |
| `DEVVER_PROJECT_ID` / `DEVVER_GIT_AUTH_URL` | Git push: **Yes** | — | Project and platform used to authorize Git tokens and SSH keys |
| `DEVVER_GIT_SSH_HOST` | No | — | git-gateway host, e.g. `git.devver.app`; adds `sshPushUrl` to `/repos` |
| `DEVVER_GIT_GATEWAY_PUBLIC_KEY` | No | — | The only key sshd accepts (the git-gateway's). Unset: no SSH access |
| `DEVVER_PREVIEW_DOMAIN` | **Yes** | — | e.g. `preview.example.com`: each deployment is served on its own host (see below). Needs wildcard DNS + TLS |
| `DEVVER_MONGO_CONNECTION_STRING` | Mongo catalog: **Yes** | — | Mongo connection string used by `/databases/mongo` |
| `DEVVER_POSTGRES_CONNECTION_STRING` | PostgreSQL catalog: **Yes** | — | PostgreSQL connection string used by `/databases/postgres` |
| `DEVVER_REDIS_CONNECTION_STRING` | Redis catalog: **Yes** | — | Redis connection string used by `/databases/redis` |
| `NODE_ENV`          | No       | —            | `production` for deploys                             |
| `PORT`              | No       | `8080`       | Deploy Agent port                                    |

## Directory Structure (container)

```
/app
├── repos/            # Bare Git repos
├── deployments/      # Git worktrees per deploy: <repo>/<branch> (web), <repo>.api/<branch> (api)
├── caches/           # npm/bun/pip/gem/go caches — keep on the same volume as deployments (hardlinks)
├── data/
│   ├── ports.json    # Allocated port mappings
│   └── repos.json    # Repo registry
├── nginx/
│   └── sites.d/      # One server block per deployment host
└── agent/            # Agent source code
```

## API

All endpoints (except `/health`) require the `x-devver-secret` header.

### Health

```
GET /health
```

### Repositories

| Method   | Endpoint       | Description                     |
| -------- | -------------- | ------------------------------- |
| `GET`    | `/repos`       | List all repos                  |
| `POST`   | `/repos`       | Create a bare Git repo          |
| `DELETE` | `/repos/:name` | Remove repo and its deployments |

**POST /repos** body:

```json
{ "name": "my-project", "baseUrl": "app.example.com" }
```

### Git push

Developers push over SSH with their own key, through the [git-gateway](../git-gateway):

```bash
git remote add devver ssh://<projectId>@git.devver.app/app/repos/my-app.git
git push devver main
```

The gateway authorizes the developer's key with the backend and connects to this agent as `git`
using its own key (`DEVVER_GIT_GATEWAY_PUBLIC_KEY`), so the agent's port 22 must stay inside the cluster.
HTTP pushes with a Git token (`/git/<repo>.git`) keep working.

### Deployments

| Method   | Endpoint                     | Description                 |
| -------- | ---------------------------- | --------------------------- |
| `POST`   | `/deploy`                    | Run a deployment            |
| `GET`    | `/deployments`               | List deployments (`?repo=`) |
| `DELETE` | `/deployments/:deploymentId` | Remove a deployment         |
| `GET`    | `/databases/:engine`         | List Mongo, PostgreSQL or Redis databases |

**POST /deploy** body:

```json
{
  "repo": "my-project",
  "branch": "feat/login",
  "commit": "abc1234",
  "projectId": "proj_xxx",
  "organizationId": "org_xxx",
  "overlayAccessControl": {
    "commentPermission": "team_only"
  },
  "service": {
    "web": {
      "root": "apps/web",
      "install": "bun install",
      "build": "bun run build",
      "start": "bun run start"
    },
    "api": {
      "start": "bun run start"
    }
  },
  "env": {
    "DATABASE_URL": "postgres://..."
  }
}
```

### PM2 (process control)

| Method | Endpoint       | Description           |
| ------ | -------------- | --------------------- |
| `POST` | `/pm2/start`   | Start a PM2 process   |
| `POST` | `/pm2/stop`    | Stop a PM2 process    |
| `POST` | `/pm2/restart` | Restart a PM2 process |

Body: `{ "name": "pm2-process" }`

### Logs

```
GET /logs/:deploymentId
```

### Databases

```
GET /databases/:engine
```

Supported engines are `mongo`, `postgres`, and `redis`. Mongo returns:

```json
[
  {
    "name": "app-db",
    "sizeOnDisk": 24576,
    "empty": false
  }
]
```

The legacy `/mongo/databases` route remains available during client migration.

The agent uses the matching `DEVVER_*_CONNECTION_STRING` directly. A typical Mongo value is:

```txt
mongodb://root:senha@test-overlay-test-db-mongo:27017/admin?authSource=admin&tls=true&tlsAllowInvalidCertificates=true
```

Each request deploys one service. `web` and `api` of the same branch are independent deployments
(own worktree, port, PM2 process and Nginx config) and can be deployed in parallel:

| Service | `deploymentId`        | URL                                      |
| ------- | --------------------- | ---------------------------------------- |
| `web`   | `<repo>-<branch>`     | `<repo>-<branch>.<DEVVER_PREVIEW_DOMAIN>`  |
| `api`   | `<repo>.api-<branch>` | `<repo>--api-<branch>.<DEVVER_PREVIEW_DOMAIN>` |

Each deployment runs at `/` on its own host, so client-side routing, the app's own `/api/*` routes,
CSS/fonts and dev-server HMR work unchanged. The agent refuses to start without `DEVVER_PREVIEW_DOMAIN`.
Infra: a wildcard DNS record and TLS certificate for `*.preview.example.com`,
routed to the agent's port 80 with the `Host` header preserved.

**Dev mode:** for a Node `web` service sent without `build` and `start`, the agent skips the build
and runs the app's `dev` script (no `NODE_ENV=production`). Send `build`/`start` to deploy a production build.

Deploys of different deployments run concurrently; the same deployment is serialized.
An `api` deployment created before this scheme (stored under `<repo>-<branch>`) is removed
automatically on the next deploy of that branch.

## Deploy Pipeline

1. **Validation** — verifies repo, branch and service config
2. **Worktree** — creates/updates Git worktree for the branch
3. **Install** — runs install command (e.g. `bun install`)
4. **Build** — runs build command (e.g. `bun run build`)
5. **Process** — registers and starts processes via PM2
6. **Nginx** — generates dynamic config and reloads Nginx

On failure, automatic rollback reverts all completed stages.

## Tests

```bash
cd agent
bun test
```

## End-to-End Walkthrough

```bash
# 1. Health check
curl http://localhost:3080/health

# 2. Create a repo
curl -X POST http://localhost:3080/repos \
  -H "Content-Type: application/json" \
  -H "x-devver-secret: dev-secret-123" \
  -d '{"name": "my-app", "baseUrl": "app.local"}'

# 3. Push code via Git HTTP (SSH goes through the git-gateway)
git remote add devver http://localhost:3080/git/my-app.git
git push devver main

# 4. Deploy
curl -X POST http://localhost:3080/deploy \
  -H "Content-Type: application/json" \
  -H "x-devver-secret: dev-secret-123" \
  -d '{
    "repo": "my-app",
    "branch": "main",
    "overlayAccessControl": {"commentPermission": "team_only"},
    "service": {"web": {"start": "bun run start"}}
  }'

# 5. Check deployments
curl http://localhost:3080/deployments \
  -H "x-devver-secret: dev-secret-123"
```
