# Wakapi on Coolify

Self-hosted, WakaTime-compatible time-tracking backend for the personal OS. The editor plugin
dual-writes every heartbeat here and to WakaTime; the app reads hours per project from here.
Public URL: `https://wakapi.flext.dev`.

Wakapi is a **Docker service, not a package** — the same treatment listify gives `apps/electric`.
Nothing in `flext` imports it; the app talks to it over HTTP.

## Version pin

`ghcr.io/muety/wakapi:2.17.6`, never `:latest`. 2.17.6 (2026-08-19) fixed a *critical
authentication bypass due to a shared cache key namespace*. Anything older is unsafe to expose;
anything newer gets adopted deliberately, after reading its release notes, by editing the tag in
`compose.yaml` and redeploying.

## Environment (set in Coolify, never in the repo)

| Variable | Value |
|---|---|
| `WAKAPI_DB_HOST` | The MySQL service's name on Coolify's docker network (the same instance flext uses) |
| `WAKAPI_DB_NAME` | `wakapi` — a dedicated schema, see below |
| `WAKAPI_DB_USER` / `WAKAPI_DB_PASSWORD` | A dedicated user with rights on that schema only |
| `WAKAPI_PASSWORD_SALT` | Random, long, generated once (`openssl rand -hex 32`); changing it invalidates every password |
| `WAKAPI_PUBLIC_URL` | `https://wakapi.flext.dev` |
| `WAKAPI_ALLOW_SIGNUP` | `true` for the first boot only, then `false` (compose defaults it to `false`) |

Fixed in `compose.yaml`: `WAKAPI_DB_TYPE=mysql`, `WAKAPI_DB_PORT=3306`,
`WAKAPI_INSECURE_COOKIES=false` (Wakapi's default is `true`, which is only right on localhost),
`WAKAPI_DISABLE_FRONTPAGE=true` (single user, no landing page).

Import tuning, if ever needed: `WAKAPI_IMPORT_MAX_RATE` (default 24 hours between successful
imports per user), `WAKAPI_IMPORT_BACKOFF_MIN` (default 5 minutes between attempts).

## Database

A dedicated `wakapi` schema and user on the existing MySQL instance. Wakapi auto-migrates on
boot, so the schema starts empty; the only manual DDL is creating it:

```sql
CREATE DATABASE wakapi CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'wakapi'@'%' IDENTIFIED BY '<password>';
GRANT ALL PRIVILEGES ON wakapi.* TO 'wakapi'@'%';
FLUSH PRIVILEGES;
```

This is the operator's action — nothing in this repo runs DDL against production.

## Coolify

1. Project **flext.dev** → **+ New resource** → **Docker Compose** (from the `flext` git source),
   branch `personal-os-architecture` (or wherever this file lives), compose location
   `/deploy/wakapi/compose.yaml`.
2. Fill the environment variables above. Coolify reads the `${VAR}` placeholders and lists them.
3. Enable **Connect to predefined network** so the container can reach the MySQL service by name.
4. Set the domain `https://wakapi.flext.dev` on the `wakapi` service, port `3000`.
5. Deploy with `WAKAPI_ALLOW_SIGNUP=true`, open the URL, create the one account, then set it to
   `false` and redeploy. Confirm `/signup` refuses.
6. Settings → API key: that value goes into `~/.wakatime.cfg` (dual-write) and into the flext
   app's env when the ingest lands.

The image ships its own `HEALTHCHECK` (`/app/healthcheck`, 120 s start period); Coolify shows it.

## Rolling back

- **Bad release:** change the tag in `compose.yaml` back to the previous pin and redeploy.
  Migrations are forward-only, so only go back across a release that shipped a migration if you
  also restore the `wakapi` schema from the pre-upgrade backup.
- **Bad import:** imports are rate-limited to one success per 24 h per user; a botched one cannot
  simply be re-run at once. Heartbeats are plain rows in `heartbeats` — the schema is small enough
  to inspect and clean by hand if it comes to that.
- **Abandon Wakapi entirely:** the editor plugin keeps writing to WakaTime the whole time (see the
  plan's Task 1.3), so nothing is lost; remove the `[api_urls]` block and delete the resource.

## First-week checklist

- Import the full WakaTime history **while WakaTime Premium is still active** — the free plan's
  paywall makes Wakapi's importer see an empty dump and report success.
- Verify the earliest heartbeat matches the WakaTime account's real start date.
- After ten minutes of coding, confirm the same heartbeat shows in both dashboards.
