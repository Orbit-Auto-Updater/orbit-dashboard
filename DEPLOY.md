# Deploying Linux Dash with Docker

The image contains the dashboard and the agent's installer and binaries for amd64, arm64, arm and 386. That means `curl https://your-dashboard/install.sh | sudo sh` works as soon as it's up.

## What's in the box

| File | Purpose |
| --- | --- |
| `Dockerfile` | Multi-stage build: Go stage (agent binaries), pnpm install, Next.js standalone build, ~200 MB Alpine runtime |
| `compose.yaml` | Production stack: dashboard + PostgreSQL 17, plus Caddy with automatic HTTPS under the `https` profile |
| `compose.sqlite.yaml` | Single container using SQLite, for small fleets or trying it out |
| `Caddyfile` | HTTPS reverse proxy config used by the `https` profile |
| `.env.example` | Settings for the compose files |

The image:
- **Runs as non-root:** uid 10001. The app files are read-only to it; only `/data` is writable.
- **Uses `tini` as PID 1:** `SIGTERM` reaches the server, which finishes in-flight requests before exiting (`stop_grace_period: 30s`).
- **Has a healthcheck:** `GET /api/health`, which reports whether the app and its database work.
- **Sets security headers:** CSP, `X-Frame-Options`, `nosniff`, `Referrer-Policy` and `Permissions-Policy`. `X-Powered-By` is off, and Caddy adds HSTS.
- **Is locked down under compose:** read-only root filesystem, `cap_drop: ALL`, `no-new-privileges`, a memory limit and rotated logs.

## Requirements

- Docker Engine 24+ with Compose v2.17+. `additional_contexts` is used to pull in the agent source.
- This repository and `linux-dash-agent` side by side:
  ```
  linux-dash/
  ├── linux-dash/          ← you are here
  └── linux-dash-agent/
  ```
- Network access during the build (npm registry, Go module proxy, Google Fonts; fonts are bundled at build time).

## Production: PostgreSQL + HTTPS

1. Point a DNS name (e.g. `dash.example.com`) at the host and open ports 80 and 443.
2. Configure:
   ```bash
   cp .env.example .env
   # set POSTGRES_PASSWORD (openssl rand -hex 24), DOMAIN and ACME_EMAIL
   ```
3. Start:
   ```bash
   docker compose --profile https up -d --build
   docker compose logs dashboard | grep "setup code"
   ```
4. Open `https://dash.example.com` and follow the setup wizard. The database is already configured through `DATABASE_URL`, so the database step just creates the tables. Set the **dashboard address for agents** to `https://dash.example.com`.

Caddy gets and renews the Let's Encrypt certificate itself.

**Internal networks without public DNS:** in `Caddyfile`, replace the `email` line with `tls internal`. Then copy Caddy's root certificate to your servers:
```bash
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt .
```
Install the agent with `--ca-file root.crt`; the installer will also offer this option itself.

### Behind your own reverse proxy

Run `docker compose up -d --build` without the `https` profile. The dashboard is then published on `127.0.0.1:3000` (change it with `DASHBOARD_BIND` / `DASHBOARD_PORT`). Your proxy must:

- pass the original `Host` header and set `X-Forwarded-Proto: https` and `X-Forwarded-For`. These are used for secure cookies, the same-origin check and login rate limiting.
- allow request bodies of at least 16 MB (`client_max_body_size 16m` in nginx). Agents send their reports here.
- terminate TLS. Agents refuse plain HTTP unless explicitly configured otherwise.

## Small setups: SQLite

```bash
docker compose -f compose.sqlite.yaml up -d --build
docker compose -f compose.sqlite.yaml logs dashboard | grep "setup code"
```

In the wizard, choose **SQLite** and keep the default path, `/data/linux-dash.db`. Put HTTPS in front before exposing it beyond the host.

## Building the image directly

```bash
docker build --build-context agent=../linux-dash-agent --build-arg AGENT_VERSION=0.1.0 -t linux-dash:0.1.0 .

# multi-arch, pushed to a registry
docker buildx build --platform linux/amd64,linux/arm64 \
  --build-context agent=../linux-dash-agent -t registry.example.com/linux-dash:0.1.0 --push .
```

Run it on its own:
```bash
docker run -d --name linux-dash -p 127.0.0.1:3000:3000 -v linux-dash-data:/data \
  -e DATABASE_URL=postgres://user:pass@db:5432/linuxdash \
  --read-only --tmpfs /tmp --tmpfs /app/.next/cache:uid=10001,gid=10001 \
  --cap-drop ALL --security-opt no-new-privileges linux-dash:0.1.0
```

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `DATABASE_URL` | none | `postgres://…` or `sqlite:/data/linux-dash.db`. If unset, the setup wizard asks. |
| `DATABASE_URL_FILE` | none | Read the URL from a file instead, e.g. a Docker secret at `/run/secrets/database_url`, so the password isn't in the environment. |
| `LINUX_DASH_DATA_DIR` | `/data` | Config, setup code and SQLite database. Must be persistent. |
| `AGENT_DIST_DIR` | `/app/agent-dist` | Agent installer and binaries served at `/install.sh` and `/downloads/`. |
| `PORT` / `HOSTNAME` | `3000` / `0.0.0.0` | Listen address inside the container. |
| `TZ` | `UTC` | Log timestamps. |

**Bind mounts:** if you mount a host directory at `/data` instead of a named volume, make it owned by uid 10001 (`chown -R 10001:10001 ./data && chmod 700 ./data`).

## Backups

**PostgreSQL:**
```bash
docker compose exec -T postgres pg_dump -U linuxdash -Fc linuxdash > linux-dash-$(date +%F).dump
# restore into an empty database:
docker compose exec -T postgres pg_restore -U linuxdash -d linuxdash --clean < linux-dash-2026-10-12.dump
```

**SQLite.** This is an online backup, safe while the dashboard runs:
```bash
docker compose -f compose.sqlite.yaml exec dashboard node scripts/backup-sqlite.mjs
docker compose -f compose.sqlite.yaml cp dashboard:/data/backups ./backups
```

Also back up the `/data` volume itself: `config.json` holds the database connection chosen in the wizard.

## Upgrading

```bash
git pull                       # in both repositories
docker compose --profile https up -d --build
```

Database migrations run automatically when the new container starts. Rebuilding the image also refreshes the agent binaries served at `/downloads`; set `AGENT_VERSION` in `.env` so the dashboard knows which version it ships. Then open **Agents → Update outdated** to upgrade every server in one click. Agents older than 0.3.0 don't support self-update yet: re-run the install command on them once, and the installer keeps their config.

## Operations

- **Logs:** `docker compose logs -f dashboard` (JSON files rotated at 10 MB × 5).
- **Health:** `docker compose ps` shows health status; `curl -s localhost:3000/api/health` returns `{"status":"ok","setup":"complete","database":"ok"}`.
- **Lost the setup code?** `docker compose exec dashboard cat /data/setup-code`. It only exists until setup completes.
- **Changing the Postgres password later:** the `postgres` image only applies `POSTGRES_PASSWORD` on first start. Change it with `ALTER USER linuxdash PASSWORD '…'`, then update `.env` and recreate the dashboard.
