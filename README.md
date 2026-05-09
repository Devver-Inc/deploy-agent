# Deploy Agent

Containerized deploy agent that manages Git repositories, per-branch deployments and PM2 processes — with Nginx as reverse proxy.

## Stack

- **Runtime:** [Bun](https://bun.sh)
- **Framework:** [Elysia](https://elysiajs.com)
- **Process Manager:** PM2
- **Reverse Proxy:** Nginx
- **Git Backend:** git-http-backend via fcgiwrap
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
| `DEVVER_MONGO_CA_FILE` | No    | `/var/run/secrets/devver/mongo/ca.crt` | Path to Mongo CA bundle used by `/mongo/databases` |
| `DEVVER_MONGO_CONNECTION_STRING_FILE` | Pod: **Yes** / Local: No | — | File containing the Mongo connection string mounted from the chart secret |
| `DEVVER_MONGO_CONNECTION_STRING` | Local only | — | Inline Mongo connection string fallback for local development |
| `DEVVER_MONGO_TLS_ALLOW_INVALID_CERTIFICATES` | No | auto in dev | Allows invalid Mongo TLS certs as local fallback |
| `NODE_ENV`          | No       | —            | `production` for deploys                             |
| `PORT`              | No       | `8080`       | Deploy Agent port                                    |

## Directory Structure (container)

```
/app
├── repos/            # Bare Git repos
├── deployments/      # Git worktrees per deploy (branch)
├── data/
│   ├── ports.json    # Allocated port mappings
│   └── repos.json    # Repo registry
├── nginx/
│   └── conf.d/       # Dynamic configs generated per deploy
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

### Deployments

| Method   | Endpoint                     | Description                 |
| -------- | ---------------------------- | --------------------------- |
| `POST`   | `/deploy`                    | Run a deployment            |
| `GET`    | `/deployments`               | List deployments (`?repo=`) |
| `DELETE` | `/deployments/:deploymentId` | Remove a deployment         |
| `GET`    | `/mongo/databases`           | List Mongo databases        |

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

### Mongo

```
GET /mongo/databases?orgSlug=my-org&projectSlug=my-project
```

Returns:

```json
[
  {
    "name": "app-db",
    "sizeOnDisk": 24576,
    "empty": false
  }
]
```

The agent connects internally to `${orgSlug}-${projectSlug}-mongo:27017` using
TLS. If `DEVVER_MONGO_CA_FILE` exists, it is used as the CA bundle. In
non-production environments, invalid certificates are allowed as a fallback
when no CA file is mounted, unless
`DEVVER_MONGO_TLS_ALLOW_INVALID_CERTIFICATES=false` is set.

In the pod, mount the chart secret and expose
`DEVVER_MONGO_CONNECTION_STRING_FILE` to the agent. For local development,
`DEVVER_MONGO_CONNECTION_STRING` can be used as a fallback when no secret file
is mounted.

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

# 3. Push code via Git HTTP
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
