# Coolify build pack for flext. Replaces nixpacks, for two reasons:
#
#   1. No apt. Nixpacks' generated image runs `apt-get update` solely to install curl+wget that
#      Coolify injects and this app never uses. That step took down a listify production deploy on
#      2026-07-22 when archive.ubuntu.com resolved IPv6-only on a host with no IPv6 egress.
#   2. Correct layer ordering. Nixpacks emits `COPY . /app/.` BEFORE `bun i`, so editing any single
#      file invalidates the install layer and forces a full reinstall on every deploy. Here the
#      manifests are copied first, so `bun install` re-runs only when a dependency actually changes.
#
# Unlike the listify draft this is derived from, there are no build-time ARGs and no BuildKit secret
# mount: flext's build reads no environment at all. Nothing uses VITE_PUBLIC_*, the root env.ts has
# no importers, and server/env.ts validates lazily on first read rather than at import. Verified
# 2026-07-28 — if that stops being true, the build will fail loudly rather than silently inline a
# missing value.
#
# Coolify: Build Pack → Dockerfile, location /Dockerfile, port 3000.

# ── deps — keyed only on the manifests, so source edits don't bust the install ────────────────
FROM oven/bun:1.3.6 AS deps
WORKDIR /app

COPY package.json bun.lock ./

# --frozen-lockfile so a drifted bun.lock fails the build here rather than silently resolving
# something other than what was tested locally.
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

# ── build ─────────────────────────────────────────────────────────────────────────────────────
FROM deps AS build
WORKDIR /app

COPY . .

RUN bun run build

# ── runtime — build output only ───────────────────────────────────────────────────────────────
FROM oven/bun:1.3.6-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# nitro's `preset: "bun"` traces its dependencies into .output/server/node_modules, so the runtime
# stage needs the build output and nothing else — no node_modules, no source, no nix store.
COPY --from=build /app/.output ./.output

EXPOSE 3000

# bun rather than curl: the slim image ships no HTTP client, and adding one would reintroduce the
# apt layer this Dockerfile exists to remove. start-period covers boot, so a slow first start is
# not reported as unhealthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD bun -e "const r = await fetch('http://127.0.0.1:3000/api/health'); process.exit(r.ok ? 0 : 1)"

CMD ["bun", "run", ".output/server/index.mjs"]
