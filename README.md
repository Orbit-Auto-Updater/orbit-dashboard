<div align="center">

<img src="docs/logo.svg" width="88" alt="Linux Dash logo">

# Linux Dash

**Monitor, patch and secure your Linux fleet from one dashboard.**

Live metrics for every server and the apps on it, one-click package updates with live logs, CVE alerts, and agents that update themselves.

[![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![SQLite](https://img.shields.io/badge/SQLite-built--in-003B57?style=flat-square&logo=sqlite&logoColor=white)](https://nodejs.org/api/sqlite.html)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?style=flat-square&logo=docker&logoColor=white)](DEPLOY.md)

[Quick start](#-quick-start) · [Adding servers](#-adding-servers) · [Network & firewall](#-network--firewall) · [Deploy guide](DEPLOY.md) · [Agent](../linux-dash-agent)

<br>

<picture>
  <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/overview-light.png">
  <img src="docs/screenshots/overview.png" alt="Fleet overview: health summary, critical issues banner, cluster utilisation and network charts" width="100%">
</picture>

</div>

<br>

## ✨ Highlights

<table>
<tr>
<td width="33%" valign="top">

### 📈 Live monitoring
CPU, memory, disk, network, load and uptime per server, with charts for live, 1h, 24h and 7d. Docker containers, PM2 apps and systemd units on every host.

</td>
<td width="33%" valign="top">

### 📦 Patching with live logs
Install all, security-only or selected packages across the fleet. Every install is a job that streams the package manager's output from the server as it runs.

</td>
<td width="33%" valign="top">

### 🛡️ CVE alerts
Pending packages are checked against [OSV.dev](https://osv.dev) at their installed version. CVSS scores, the fixed version for each release, and an "Install fix" button.

</td>
</tr>
<tr>
<td valign="top">

### 🤖 Self-updating agents
See every agent's version against the one this dashboard ships, and update outdated agents in one click. Agents verify, install, restart and roll back on their own.

</td>
<td valign="top">

### 🚨 Alerts that resolve themselves
CPU, memory, disk, offline hosts, crash loops, failed units, CVEs, failed updates and pending reboots. Editable rules and Slack-compatible webhooks.

</td>
<td valign="top">

### 👥 Users & roles
Password sign-in, invite links (no email server needed), and an editable permission matrix with custom roles. Every action is in the audit log.

</td>
</tr>
</table>

## 📸 Screenshots

<table>
<tr>
<td width="50%"><img src="docs/screenshots/job-live.png" alt="A running update job with per-server phases and live package-manager output"><p align="center"><sub><b>Live update job:</b> phases, installed packages and streamed output</sub></p></td>
<td width="50%"><img src="docs/screenshots/agents.png" alt="Agents page with shipped version, outdated agents and allowed remote actions"><p align="center"><sub><b>Agents:</b> versions, allowed actions and one-click updates</sub></p></td>
</tr>
<tr>
<td><img src="docs/screenshots/vulnerabilities.png" alt="Vulnerabilities page listing CVEs by severity"><p align="center"><sub><b>Vulnerabilities:</b> CVEs by severity with fixed versions</sub></p></td>
<td><img src="docs/screenshots/server-drawer.png" alt="Server detail drawer with metrics and actions"><p align="center"><sub><b>Server detail:</b> metrics, apps, updates and actions</sub></p></td>
</tr>
<tr>
<td><img src="docs/screenshots/servers.png" alt="Servers list"><p align="center"><sub><b>Servers:</b> the whole fleet at a glance</sub></p></td>
<td><img src="docs/screenshots/applications.png" alt="Applications page with Docker, PM2 and systemd"><p align="center"><sub><b>Applications:</b> Docker, PM2 and systemd</sub></p></td>
</tr>
</table>

## 🚀 Quick start

### With Docker (production)

```bash
cp .env.example .env    # set POSTGRES_PASSWORD, DOMAIN, ACME_EMAIL
docker compose --profile https up -d --build
docker compose logs dashboard | grep "setup code"
```

This runs the dashboard, PostgreSQL and Caddy (automatic HTTPS). The image also serves the agent installer and binaries.

> [!TIP]
> See **[DEPLOY.md](DEPLOY.md)** for SQLite, running behind your own reverse proxy, backups and upgrades.

<details>
<summary><b>From source</b></summary>

<br>

Requires **Node.js 22.13+**. SQLite uses the built-in `node:sqlite`, so there are no native modules to compile.

```bash
pnpm install
pnpm build && pnpm start        # or `pnpm dev` while developing
```

</details>

### First-run setup wizard

Open the dashboard. The first visit goes to the setup wizard:

<img src="docs/screenshots/setup.png" alt="Setup wizard" width="100%">

| Step | What happens |
| --- | --- |
| **1. Verify** | Enter the one-time setup code printed in the server log (also in `data/setup-code`). This stops anyone else on the network from claiming a fresh install. |
| **2. Database** | Pick **SQLite** (a file; zero setup) or **PostgreSQL** (recommended for production) and test the connection. **Create tables** creates the schema automatically. |
| **3. Owner account** | The first user, with every permission. |
| **4. Organisation** | Your name and the URL servers use to reach the dashboard. You get an enrolment token and the install command for your first server. |

### Configuration

| Variable | Purpose |
| --- | --- |
| `LINUX_DASH_DATA_DIR` | Where `config.json`, the setup code and the default SQLite file live. Default `./data`. Keep it on persistent storage. |
| `DATABASE_URL` | Overrides the wizard's database choice: `postgres://user:pass@host/db?sslmode=require` or `sqlite:/path/to/file.db`. Tables are created on first start. `DATABASE_URL_FILE` reads it from a file (Docker secrets). |
| `AGENT_DIST_DIR` | Where agent release files are served from (`/install.sh`, `/downloads/…`). Default `data/agent`, falling back to `../linux-dash-agent/dist`. |

> [!IMPORTANT]
> Put the dashboard behind HTTPS (a reverse proxy such as Caddy or nginx) in production. Session cookies are marked `Secure` when the request is HTTPS (`X-Forwarded-Proto` is honoured).

## ⚙️ How it works

```mermaid
flowchart LR
    subgraph fleet["Your servers"]
        A1["linux-dash-agent"]
        A2["linux-dash-agent"]
        A3["linux-dash-agent"]
    end
    subgraph dash["Dashboard host"]
        P["Caddy / reverse proxy<br/>:443"]
        D["Linux Dash<br/>Next.js"]
        DB[("PostgreSQL<br/>or SQLite")]
    end
    U(["Browser"])
    OSV["OSV.dev"]

    A1 & A2 & A3 -- "HTTPS, outbound only<br/>reports · job progress" --> P
    U -- HTTPS --> P
    P --> D
    D --> DB
    D -. "CVE lookups" .-> OSV
```

Every agent reports about every 10 seconds. The response carries any queued commands (restart, install updates, reboot, update the agent) and the server's update policy. The dashboard never connects to your servers.

## 🖥️ Adding servers

**1. Give the dashboard the agent release.** The Docker image already includes it. When running from source, build it once:

```bash
cd ../linux-dash-agent && make release VERSION=0.3.0
cp -r dist ../linux-dash/data/agent
```

**2. Create an enrolment token** on the **Agents** page. Tokens choose the server's environment, which decides its update policy. They can expire or be limited to a number of servers.

**3. Install the agent** on each server, as root:

```bash
curl -fsSL https://dash.example.com/install.sh | sudo sh -s -- --token <TOKEN>
```

The installer asks for anything else it needs. The script served by the dashboard already defaults to the dashboard's address.

> [!NOTE]
> Enrolment tokens are only used once per server. Each server then gets its own long-lived credential, so a token expiring never disconnects servers that already enrolled.

### Updating agents

When you ship a new agent version (rebuild the image, or `make release VERSION=x.y.z` and copy `dist` again), the **Agents** page shows which servers are outdated. **Update outdated** runs a live job: each agent downloads the release, verifies its SHA-256, checks that it runs and accepts its config, swaps itself in and restarts. If the new version doesn't report back, the agent restores the previous binary itself.

## 🔒 Network & firewall

Agents always connect **out** to the dashboard. Servers being monitored need **no inbound ports**, and the dashboard never connects to them.

### Dashboard host: inbound

| Port | From | Needed for |
| --- | --- | --- |
| **443/tcp** | Your users' browsers and every monitored server | HTTPS: the web UI, the agent API, `/install.sh` and `/downloads` |
| 80/tcp | Internet | Only with the bundled Caddy (`--profile https`): Let's Encrypt validation and the redirect to HTTPS. Not needed with `tls internal` or your own certificates. |
| 443/udp | Browsers | Optional HTTP/3 via Caddy; safe to leave closed |
| 3000/tcp | Localhost only | The dashboard container itself. Compose publishes it on `127.0.0.1` so only the reverse proxy reaches it. |

> [!WARNING]
> Don't open 3000 to the network. If you run without a proxy (testing on a LAN), open it only to trusted addresses. PostgreSQL (5432) stays on the internal Docker network and is never published; don't open it either.

### Dashboard host: outbound

| Destination | Needed for |
| --- | --- |
| `api.osv.dev:443` | CVE scanning (can be turned off in Settings) |
| Your webhook URL (e.g. `hooks.slack.com:443`) | Alert notifications, if configured |
| `acme-v02.api.letsencrypt.org:443` | Certificates, with the bundled Caddy |
| npm registry, `proxy.golang.org`, `fonts.googleapis.com` / `fonts.gstatic.com` | Only while **building** the Docker image |

### Monitored servers

| Direction | Rule |
| --- | --- |
| **Inbound** | Nothing. Close everything you don't otherwise need. |
| **Outbound** | The dashboard's address on 443 (or whatever port its URL uses), and your distribution's package mirrors (e.g. `archive.ubuntu.com`, `deb.debian.org`, `dl.rockylinux.org`) for checking and installing updates. |

The agent honours `HTTPS_PROXY` if servers can only reach the internet through a proxy.

SSH is unchanged: the server's **SSH** shortcut just copies `ssh user@host` for your own terminal. Keep allowing port 22 from wherever you already administer servers.

<details>
<summary><b>Example rules (ufw)</b></summary>

<br>

```bash
# Dashboard host (with the bundled Caddy)
sudo ufw allow 443/tcp
sudo ufw allow 80/tcp          # only for Let's Encrypt

# Monitored servers: nothing to open for Linux Dash.
# With an outbound allow-list, permit the dashboard:
sudo ufw allow out to <dashboard-ip> port 443 proto tcp
```

To limit who can reach the dashboard, restrict 443 to your office/VPN ranges **and** your servers' addresses, because agents need it too:

```bash
sudo ufw allow from 10.0.0.0/8 to any port 443 proto tcp
```

</details>

## 🧰 Features in detail

<details>
<summary><b>Live monitoring</b></summary>

<br>

CPU, memory, disk, network, load and uptime per server, with charts for the last few minutes, 1h, 24h and 7d. Samples are stored in the `metrics` table and pruned by the retention setting.

</details>

<details>
<summary><b>Actions</b></summary>

<br>

Start, stop and restart for containers, PM2 apps and watched systemd units; refresh; check for updates; install all, security-only or selected packages; reboot. Actions are queued, delivered on the agent's next report, and their results shown when they come back. Each one is checked against your role's permissions *and* the server's own agent config.

</details>

<details>
<summary><b>Live update jobs</b></summary>

<br>

Every install (from Updates, a server, or "Install fix" on a CVE) and every scheduled policy run is a job. Its page shows each server's phase (pre-flight, refresh, install, verify), packages appearing as they finish, and the package manager's output streamed from the server about once a second. You can follow the output or download it. Older agents fall back to the final output.

</details>

<details>
<summary><b>Updates & policies</b></summary>

<br>

Pending packages across the fleet, bulk installs and run history. Each environment has an auto-update policy (window or interval, scope, exclusions, auto-reboot). It's pushed to agents, which then run it themselves.

</details>

<details>
<summary><b>Agents page</b></summary>

<br>

Every server's agent version against the version this dashboard ships, and what each agent's own config allows. Outdated agents update in one click, as a live job. Each agent downloads the release from the dashboard, verifies its SHA-256, checks that it runs and accepts the server's config, then swaps itself in and restarts through systemd or OpenRC. The job completes when the server reports in on the new version. If it can't, the agent restores the previous binary itself. Each server can turn this off with `actions.agent_update: false`. Enrolment tokens live here too.

</details>

<details>
<summary><b>Vulnerabilities (CVE alerts)</b></summary>

<br>

Pending packages are checked at their installed version against [OSV.dev](https://osv.dev).

- **Which distros:** Debian, Ubuntu, Alpine, Rocky and AlmaLinux. Packages the distribution flags as security updates are always listed too, so RHEL, Fedora and Arch hosts still get coverage.
- **When it scans:** whenever a server's package list changes, and on a schedule.
- **What you see:** CVSS scores, the fixed version for that server's own release, "Install fix", and ignore-with-reason.
- **Alerting:** a per-server alert fires above a CVSS threshold.

</details>

<details>
<summary><b>Alerts</b></summary>

<br>

CPU, memory, disk, offline, container crash loops and unhealthy containers, errored PM2 apps, failed units, CVEs, failed update runs, and reboots required. Alerts resolve automatically when the condition clears. Rules are editable, and acknowledging is supported. New alerts can be sent to a Slack-compatible webhook.

</details>

<details>
<summary><b>Users, roles & audit</b></summary>

<br>

Password sign-in, invites by link (no email server needed), suspend and remove, and an editable permission matrix with custom roles. The owner role is protected. Every action goes in the audit log, alongside journald error logs from all servers.

</details>

<details>
<summary><b>SSH</b></summary>

<br>

Each server has an SSH shortcut that copies `ssh user@host` and offers an `ssh://` link, so you connect with your own keys. The dashboard deliberately never holds SSH credentials and the agent has no shell command (see below).

</details>

## 🛡️ Security model

- 🔑 **Per-server secrets.** Agents connect out over HTTPS and authenticate with their own secret, stored hashed.
- 🚧 **Allowlisted commands.** Commands come from a fixed list. The agent rejects anything its local config doesn't allow, so a compromised dashboard can't do more on a server than its owner permitted.
- 🔐 **Hardened sign-in.** Passwords use scrypt. Sessions are random tokens in an httpOnly, SameSite cookie, stored hashed. Logins are rate-limited. State-changing requests must be same-origin.
- 🧾 **Checked on every route.** Every API route checks the session and the role's permissions. The proxy only handles redirects.
- 📁 **Private files.** The SQLite file and `data/` are created private (`0600`/`0700`).

## 🛠️ Develop

```bash
pnpm test        # backend tests on SQLite and PostgreSQL (PGlite, in-process)
pnpm lint
node scripts/simulate-agents.mjs --server http://localhost:3000 --token <TOKEN>
```

`simulate-agents.mjs` enrols five fake servers (Ubuntu, Debian, Rocky, Alpine) that speak the real agent protocol, run real outdated package versions (so CVE scans find real advisories), and respond to actions, including live update jobs and agent updates. It's the easiest way to explore the UI without real servers.

<details>
<summary><b>Project layout</b></summary>

<br>

```
app/(app)/…                        dashboard pages (client components polling the API)
app/setup, login, invite/[token]   setup wizard, sign-in, invite acceptance
app/api/…                          route handlers: dashboard API, agent API (/api/agent/v1/*), setup
app/install.sh, downloads/[file]   agent installer and binaries
proxy.ts                           setup / sign-in redirects
instrumentation.ts                 starts the background scheduler (offline checks, retention, CVE scans)
lib/server/                        database (Kysely), migrations, auth, agent ingest, jobs, alerts, CVEs
lib/client.ts                      browser fetch helpers, polling hook, command runner
lib/permissions.ts                 permission keys and built-in roles
scripts/                           agent simulator, SQLite backup, standalone pruning
```

Schema changes go in `lib/server/migrations.ts` as a new migration. They're applied automatically on start.

</details>
