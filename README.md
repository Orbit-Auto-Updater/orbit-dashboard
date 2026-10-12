# Linux Dash

Dashboard for monitoring Linux servers and the apps on them (Docker, PM2, systemd), installing package updates, and tracking vulnerable packages (CVEs). Each server runs the [linux-dash-agent](../linux-dash-agent), which connects out to this dashboard.

## Run it

```bash
pnpm install
pnpm build && pnpm start        # or `pnpm dev` while developing
```

Open the dashboard. The first visit goes to the **setup wizard**:

1. **Verify:** enter the one-time setup code printed in the server log (also in `data/setup-code`). This stops anyone else on the network from claiming a fresh install.
2. **Database:** pick **SQLite** (a file; zero setup) or **PostgreSQL** (recommended for production), then test the connection. **Create tables** creates the schema automatically.
3. **Owner account:** the first user, with every permission.
4. **Organisation:** your name and the URL servers use to reach the dashboard. You get an enrolment token and the install command for your first server.

Requires Node.js 22.13+ (SQLite uses the built-in `node:sqlite`, so there are no native modules to compile).

### Configuration

| Variable | Purpose |
| --- | --- |
| `LINUX_DASH_DATA_DIR` | Where `config.json`, the setup code and the default SQLite file live. Default `./data`. Keep it on persistent storage. |
| `DATABASE_URL` | Overrides the wizard's database choice: `postgres://user:pass@host/db?sslmode=require` or `sqlite:/path/to/file.db`. Tables are created on first start. |
| `AGENT_DIST_DIR` | Where agent release files are served from (`/install.sh`, `/downloads/…`). Default `data/agent`, falling back to `../linux-dash-agent/dist`. |

Put the dashboard behind HTTPS (a reverse proxy such as Caddy or nginx) in production. Session cookies are marked `Secure` when the request is HTTPS (`X-Forwarded-Proto` is honoured).

## Adding servers

1. Build the agent release once and give the dashboard the files:
   ```bash
   cd ../linux-dash-agent && make release
   cp -r dist ../linux-dash/data/agent
   ```
2. **Settings → Agent enrolment → New token.** Tokens choose the server's environment, which decides its update policy. They can expire or be limited to a number of servers.
3. On each server, as root:
   ```bash
   curl -fsSL https://dash.example.com/install.sh | sudo sh -s -- --token <TOKEN>
   ```
   The installer asks for anything else it needs. The script served by the dashboard already defaults to the dashboard's address.

## What's functional

- **Live monitoring:** CPU, memory, disk, network, load and uptime per server, with charts for the last few minutes, 1h, 24h and 7d. Samples are stored in the `metrics` table and pruned by the retention setting.
- **Actions:** start, stop and restart for containers, PM2 apps and watched systemd units; refresh; check for updates; install all, security-only or selected packages; reboot. Actions are queued, delivered on the agent's next report, and their results shown when they come back. Each one is checked against your role's permissions *and* the server's own agent config.
- **Updates:** pending packages across the fleet, bulk installs, run history. Each environment has an auto-update policy (window or interval, scope, exclusions, auto-reboot). It's pushed to agents, which then run it themselves.
- **Vulnerabilities (CVE alerts):** pending packages are checked at their installed version against [OSV.dev](https://osv.dev):
  - **Which distros:** Debian, Ubuntu, Alpine, Rocky and AlmaLinux. Packages the distribution flags as security updates are always listed too, so RHEL, Fedora and Arch hosts still get coverage.
  - **When it scans:** whenever a server's package list changes, and on a schedule.
  - **What you see:** CVSS scores, the fixed version for that server's own release, "Install fix", and ignore-with-reason.
  - **Alerting:** a per-server alert fires above a CVSS threshold.
- **Alerts:** CPU, memory, disk, offline, container crash loops and unhealthy containers, errored PM2 apps, failed units, CVEs, failed update runs, and reboots required. Alerts resolve automatically when the condition clears. Rules are editable, and acknowledging is supported. New alerts can be sent to a Slack-compatible webhook.
- **Users & roles:** password sign-in, invites by link (no email server needed), suspend and remove, and an editable permission matrix with custom roles. The owner role is protected.
- **Audit log** of every action, plus journald error logs from all servers.

**SSH:** each server has an SSH shortcut that copies `ssh user@host` and offers an `ssh://` link, so you connect with your own keys. The dashboard deliberately never holds SSH credentials and the agent has no shell command (see below).

## Security model

- Agents connect out over HTTPS and authenticate with a per-server secret (stored hashed).
- Commands come from a fixed list. The agent rejects anything its local config doesn't allow, so a compromised dashboard can't do more on a server than its owner permitted.
- Passwords use scrypt. Sessions are random tokens in an httpOnly, SameSite cookie, stored hashed. Logins are rate-limited. State-changing requests must be same-origin.
- Every API route checks the session and the role's permissions. The proxy only handles redirects.
- The SQLite file and `data/` are created private (`0600`/`0700`).

## Develop

```bash
pnpm test        # backend tests on SQLite and PostgreSQL (PGlite, in-process)
pnpm lint
node scripts/simulate-agents.mjs --server http://localhost:3000 --token <TOKEN>
```

`simulate-agents.mjs` enrols five fake servers (Ubuntu, Debian, Rocky, Alpine) that speak the real agent protocol, run real outdated package versions (so CVE scans find real advisories), and respond to actions. It's useful for exploring the UI without real servers.

### Layout

```
app/(app)/…            dashboard pages (client components polling the API)
app/setup, login, invite/[token]
app/api/…              route handlers: dashboard API, agent API (/api/agent/v1/*), setup wizard
app/install.sh, downloads/[file]   agent installer and binaries
proxy.ts               setup / sign-in redirects
instrumentation.ts     starts the background scheduler (offline checks, retention, CVE scans)
lib/server/            database (Kysely), migrations, auth, agent ingest, alerts, CVE scanning, queries
lib/client.ts          browser fetch helpers, polling hook, command runner
lib/permissions.ts     permission keys and built-in roles
```

Schema changes go in `lib/server/migrations.ts` as a new migration. They're applied automatically on start.
