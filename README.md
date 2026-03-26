# Multica

AI-native task management platform — like Linear, but with AI agents as first-class citizens.

For the full local development workflow, see [Local Development Guide](LOCAL_DEVELOPMENT.md).

## Prerequisites

- [Node.js](https://nodejs.org/) (v20+)
- [pnpm](https://pnpm.io/) (v10.28+)
- [Go](https://go.dev/) (v1.26+)
- [Docker](https://www.docker.com/)

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Copy environment variables for the shared main environment
cp .env.example .env

# 3. One-time setup: ensure shared PostgreSQL, create the app DB, run migrations
make setup

# 4. Start backend + frontend
make start
```

Open your configured `FRONTEND_ORIGIN` in the browser. By default that is [http://localhost:3000](http://localhost:3000).

Main checkout uses `.env`. A Git worktree should generate its own `.env.worktree` and use the explicit worktree targets:

```bash
make worktree-env
make setup-worktree
make start-worktree
```

Every checkout shares the same PostgreSQL container on `localhost:5432`. Isolation now happens at the database level:

- `.env` typically uses `POSTGRES_DB=multica`
- each `.env.worktree` gets its own `POSTGRES_DB`, such as `multica_my_feature_702`
- backend/frontend ports still stay unique per worktree

That keeps one Docker container and one volume, while still isolating schema and data per worktree.

## Project Structure

```
├── server/             # Go backend (Chi + sqlc + gorilla/websocket)
│   ├── cmd/            # server, daemon, migrate
│   ├── internal/       # Core business logic
│   ├── migrations/     # SQL migrations
│   └── sqlc.yaml       # sqlc config
├── apps/
│   └── web/            # Next.js 16 frontend
├── packages/           # Shared TypeScript packages
│   ├── ui/             # Component library (shadcn/ui + Radix)
│   ├── types/          # Shared type definitions
│   ├── sdk/            # API client SDK
│   ├── store/          # State management
│   ├── hooks/          # Shared React hooks
│   └── utils/          # Utility functions
├── Makefile            # Backend commands
├── docker-compose.yml  # PostgreSQL + pgvector
└── .env.example        # Environment variable template
```

## Commands

### Frontend

| Command | Description |
|---------|-------------|
| `pnpm dev:web` | Start Next.js dev server (uses `FRONTEND_PORT`, default `3000`) |
| `pnpm build` | Build all TypeScript packages |
| `pnpm typecheck` | Run TypeScript type checking |
| `pnpm test` | Run TypeScript tests |

### Backend

| Command | Description |
|---------|-------------|
| `make dev` | Run Go server (uses `PORT`, default `8080`) |
| `make daemon` | Run local agent daemon |
| `make test` | Run Go tests |
| `make build` | Build server & daemon binaries |
| `make sqlc` | Regenerate sqlc code from SQL |

### Database

| Command | Description |
|---------|-------------|
| `make db-up` | Start the shared PostgreSQL container |
| `make db-down` | Stop the shared PostgreSQL container |
| `make migrate-up` | Ensure the current DB exists, then run migrations |
| `make migrate-down` | Rollback database migrations for the current DB |
| `make worktree-env` | Generate an isolated `.env.worktree` for the current worktree |
| `make setup-main` / `make start-main` | Force use of the shared main `.env` |
| `make setup-worktree` / `make start-worktree` | Force use of isolated `.env.worktree` |

## CLI (`multica`)

The CLI manages authentication, workspace configuration, and the local agent daemon.

### Install

```bash
brew tap multica-ai/tap
brew install multica-cli
```

Or build from source:

```bash
make build
cp server/bin/multica /usr/local/bin/multica   # or ~/.local/bin/multica
```

### Authentication

```bash
multica auth login          # Open browser to authenticate (one-click if already logged in)
multica auth login --token  # Paste a personal access token manually
multica auth status         # Show current auth status
multica auth logout         # Remove stored token
```

Credentials are saved to `~/.multica/config.json`.

### Workspaces

```bash
multica workspace list      # List all workspaces you belong to
```

### Daemon Watch List

The daemon monitors one or more workspaces for tasks. Manage which workspaces are watched:

```bash
multica watch <workspace-id>    # Add a workspace to the watch list
multica unwatch <workspace-id>  # Remove a workspace from the watch list
multica watches                 # Show the current watch list
```

The watch list is stored in `~/.multica/config.json`. Changes are picked up by a running daemon within 5 seconds (hot-reload).

### Local Agent Daemon

The daemon polls watched workspaces for tasks and executes them using locally installed AI agents (Claude Code, Codex).

```bash
# 1. Authenticate
multica auth login

# 2. Add workspaces to watch
multica watch <workspace-id>

# 3. Start the daemon
multica daemon
```

The daemon auto-detects available agent CLIs (`claude`, `codex`) on your PATH. When a task is claimed, it creates an isolated execution environment, runs the agent, and reports results back to the server.

### Other Commands

```bash
multica agent list          # List agents in the current workspace
multica runtime list        # List registered runtimes
multica config show         # Show CLI configuration
multica version             # Show CLI version
```

## Environment Variables

See [`.env.example`](.env.example) for all available variables:

- `DATABASE_URL` — PostgreSQL connection string
- `POSTGRES_DB` — Database name for the current checkout or worktree
- `POSTGRES_PORT` — Shared PostgreSQL host port (fixed to `5432`)
- `PORT` — Backend server port (default: 8080)
- `FRONTEND_PORT` / `FRONTEND_ORIGIN` — Frontend port and browser origin
- `JWT_SECRET` — JWT signing secret
- `MULTICA_APP_URL` — Browser origin for CLI login callback (default: `http://localhost:3000`)
- `MULTICA_DAEMON_ID` / `MULTICA_DAEMON_DEVICE_NAME` — Stable daemon identity for runtime registration
- `MULTICA_CLAUDE_PATH` / `MULTICA_CLAUDE_MODEL` — Claude Code executable and optional model override
- `MULTICA_CODEX_PATH` / `MULTICA_CODEX_MODEL` — Codex executable and optional model override
- `MULTICA_WORKSPACES_ROOT` — Base directory for agent execution environments (default: `~/multica_workspaces`)
- `NEXT_PUBLIC_API_URL` — Frontend → backend API URL
- `NEXT_PUBLIC_WS_URL` — Frontend → backend WebSocket URL

## Local Development Notes

- `make setup`, `make start`, `make dev`, and `make test` now require an env file. They fail fast if `.env` or `.env.worktree` is missing.
- `make stop` only stops the backend/frontend processes for the current checkout. It does not stop the shared PostgreSQL container.
- Use `make db-down` only when you explicitly want to shut down the shared local PostgreSQL instance for every checkout.
