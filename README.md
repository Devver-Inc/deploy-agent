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
aube install
aube run dev   # watch mode
```

## Environment Variables

| Variable            | Required | Default      | Description                                          |
| ------------------- | -------- | ------------ | ---------------------------------------------------- |
| `DEVVER_SECRET`     | **Yes**  | —            | API authentication secret (`x-devver-secret` header) |
| `DEVVER_DATA_DIR`   | No       | `/app`       | Base directory for repos, deployments and data       |
| `DEVVER_WIDGET_URL` | No       | CDN jsdelivr | Devver overlay script URL                            |
| `DEVVER_MONGO_CONNECTION_STRING` | Mongo routes: **Yes** | — | Full Mongo connection string used by `/mongo/databases` |
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
      "install": "aube install",
      "build": "aube run build",
      "start": "aube run start"
    },
    "api": {
      "start": "aube run start"
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
GET /mongo/databases
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

The agent uses `DEVVER_MONGO_CONNECTION_STRING` directly. A typical value is:

```txt
mongodb://root:senha@test-overlay-test-db-mongo:27017/admin?authSource=admin&tls=true&tlsAllowInvalidCertificates=true
```

## Deploy Pipeline

1. **Validation** — verifies repo, branch and service config
2. **Worktree** — creates/updates Git worktree for the branch
3. **Install** — runs install command (e.g. `aube install`)
4. **Build** — runs build command (e.g. `aube run build`)
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
    "service": {"web": {"start": "aube run start"}}
  }'

# 5. Check deployments
curl http://localhost:3080/deployments \
  -H "x-devver-secret: dev-secret-123"
```
