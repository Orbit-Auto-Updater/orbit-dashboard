# syntax=docker/dockerfile:1.7
#
# Linux Dash dashboard: production image.
#
# The agent's source is passed as a named build context so the image can serve
# the installer and agent binaries (/install.sh, /downloads/*) itself:
#
#   docker build --build-context agent=../linux-dash-agent -t linux-dash .
#
# (docker compose does this for you; see compose.yaml.)

ARG NODE_VERSION=24.14.0
ARG GO_VERSION=1.26

# ---------------------------------------------------------------- agent ---
# Cross-compile the agent on the build machine's native platform.
FROM --platform=$BUILDPLATFORM golang:${GO_VERSION}-alpine AS agent-build
WORKDIR /src
COPY --from=agent go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY --from=agent . .
ARG AGENT_VERSION=dev
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    set -eux; \
    mkdir -p /dist; \
    for arch in amd64 arm64 arm 386; do \
      CGO_ENABLED=0 GOOS=linux GOARCH=$arch go build -trimpath \
        -ldflags "-s -w -X main.version=${AGENT_VERSION}" \
        -o /dist/linux-dash-agent-linux-$arch ./cmd/linux-dash-agent; \
    done; \
    cp deploy/install.sh /dist/install.sh; \
    echo "${AGENT_VERSION}" > /dist/VERSION; \
    cd /dist && sha256sum linux-dash-agent-linux-* > SHA256SUMS

# ----------------------------------------------------------------- deps ---
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ---------------------------------------------------------------- build ---
FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN pnpm build

# -------------------------------------------------------------- runtime ---
FROM node:${NODE_VERSION}-alpine AS runtime

RUN apk add --no-cache tini \
 && addgroup -S -g 10001 linuxdash \
 && adduser -S -D -H -u 10001 -G linuxdash linuxdash \
 && mkdir -p /data /app/.next/cache \
 && chown linuxdash:linuxdash /data /app/.next/cache \
 && chmod 0700 /data

WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    LINUX_DASH_DATA_DIR=/data \
    AGENT_DIST_DIR=/app/agent-dist

# Application files are owned by root and read-only to the app user; only
# /data (and the Next.js cache) are writable.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/scripts/backup-sqlite.mjs ./scripts/backup-sqlite.mjs
COPY --from=agent-build /dist ./agent-dist

USER linuxdash
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1

# tini forwards SIGTERM so in-flight requests finish before the container stops.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]

LABEL org.opencontainers.image.title="Linux Dash" \
      org.opencontainers.image.description="Fleet monitoring, patching and CVE alerts for Linux servers"
