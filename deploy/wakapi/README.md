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

## Load on a shared box

This box also runs Coolify, flext.dev and its MySQL, and other apps. What Wakapi adds:

**Steady state — negligible.** A single Go binary; expect it to idle in the tens of MB of RSS and
at ~0% CPU. The write path is one small `INSERT` per heartbeat, and the WakaTime plugin sends at
most one heartbeat per file every two minutes while you are actually typing — a few hundred rows a
day, well under one write per minute averaged out. Reads come off pre-computed summaries, not off
the heartbeats table.

**Growth — tens of MB a year.** A heartbeat row is a couple of hundred bytes with its indexes;
a few hundred a day is roughly 150k–200k rows a year.

**Three spikes worth scheduling around:**

1. **The initial WakaTime import** (Task 1.2) is the only sustained write event — years of history
   at `import_batch_size: 50` heartbeats per transaction. Run it overnight, once.
2. **The first daily aggregation after that import** (`02:15` by default) walks everything the
   import just inserted. Subsequent runs only touch the previous day.
3. **`OPTIMIZE TABLE`, monthly.** On InnoDB this rebuilds the table, and `mysqld` is shared with
   the other apps here — so `compose.yaml` moves it to `04:00` on the 1st, off Wakapi's `08:00`
   default.

`compose.yaml` also disables the leaderboard (single user; its default schedule recalculates twice
a day) and sets a `512M` memory ceiling — a cap, not a reservation, so a runaway import cannot
starve the neighbours.

**Not tuned, but available if the box gets tight:** `WAKAPI_DATA_RETENTION_MONTHS` (default `-1`,
keep forever) and `WAKAPI_AGGREGATION_TIME`. Note `heartbeat_max_age` defaults to `4320h` (180
days) — heartbeats older than that are rejected at the API, which is why the plan keeps permanent
dual-write to WakaTime rather than relying on a later backfill.

## If an import lands nothing

Two behaviours in Wakapi 2.17.6 (`routes/settings.go`, `services/imports/wakatime_dump.go`) make a
failed import look like a successful one:

1. **"Success" is recorded before any data arrives.** The handler writes its `last_import_success`
   key as soon as the importer hands back a channel — which happens immediately, because the dump
   is fetched asynchronously. A run that dies later still arms the 24-hour rate limit, so the
   obvious retry is refused with *"last import ran less than 24 hours ago"*.
2. **A single polling error aborts the run for good.** The poll loop asks WakaTime every 10 seconds
   whether the dump is ready; any error closes the heartbeat channel and the import ends silently
   with zero rows. The importer's own source documents a recurring `unexpected EOF` from WakaTime
   here (upstream issue #602). A container restart does the same thing — the poll loop is an
   in-process goroutine, so nothing survives it.

**Recovery.** Set `WAKAPI_IMPORT_MAX_RATE=0` in Coolify, redeploy, re-run the import, then put it
back to `24`. The dump already sitting on WakaTime gets reused rather than regenerated: the
importer treats *"Wait for your current export to expire before creating another"* as "use the
existing one", so the retry starts at the download, not at the back of WakaTime's queue.

**If the dump path keeps failing,** tick **use legacy importer** on the import form. It pages
through WakaTime's heartbeats API day by day instead of downloading one large dump — slower, but
it has no in-memory decode step and no single point of failure.

**Confirming the outcome** — the log line that tells the truth is
`downloaded heartbeats for user count=… importedCount=…`. Anything else is optimism. From outside:

```bash
curl -s -H "Authorization: Basic $(printf '%s' "$WAKAPI_API_KEY" | base64)" \
  https://wakapi.flext.dev/api/compat/wakatime/v1/users/current/all_time_since_today
```
